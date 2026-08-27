/**
 * Gina 真实历史回测 —— A 股（Tushare）
 *
 * 运行：
 *   node scripts/backtest-astock.mjs [ts_code] [start_date] [end_date]
 *   node scripts/backtest-astock.mjs --selftest      # 无 token 时用合成数据自检引擎机制（非真实 alpha）
 *
 * 与合成模拟的本质区别：这里用真实历史 K 线（真实量价微观结构）+ 可选真实估值/资金流，
 * 用「无未来函数」的逐日回放，让分析师团队在真实市场结构上做决策，回答：
 *   - 她的「买入/卖出」信号之后，真实前瞻收益是否跑赢市场基准（= 是否有 alpha）；
 *   - 主动管理能否跑赢买入持有、回撤是否更小。
 *
 * 无未来函数约定：第 t 天用 bars[0..t-1] 计算信号，按 bars[t-1].close 成交，用 bars[t]/bars[t-1]-1 结算；
 * 前瞻收益只在「事后统计」阶段计算。
 *
 * 数据维度现状（诚实标注）：
 *   - 技术面：真实（价格/成交量 → 动量/均线/RSI/量比）；
 *   - 基本面：真实（daily_basic 的 PE/PB，若拉到）；
 *   - 资金面：真实（moneyflow 的主力净流入/换手，若拉到）；
 *   - 宏观/情绪：由量能与动量做确定性推导（占位，尚未接新闻源）。
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createSharedBrain, createAnalystTeam, Integrator } from '../src/analysts/index.js'
import { normalizeSnapshot } from '../src/analysts/market-snapshot.js'
import { loadDataSourcesConfig } from '../src/finance-data-sources/config.js'
import { fetchJson } from '../src/finance-data-sources/http-client.js'
import { distillTradingLessons, generateTradingSkill } from '../src/memory/trading-skill-generator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TUSHARE = 'http://api.tushare.pro'
const SKILLS_DIR = join(__dirname, '..', 'skills')

const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%'
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

// ─── 数据获取 ────────────────────────────────────────────────────────

async function tusharePost({ token, apiName, params, fields, proxyUrl }) {
  const data = await fetchJson(TUSHARE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
    proxyUrl,
  })
  if (data?.code !== 0) {
    throw new Error(`Tushare ${apiName} 错误 code=${data?.code}: ${data?.msg ?? '未知'}`)
  }
  const fs = data?.data?.fields ?? []
  const items = data?.data?.items ?? []
  return items.map((vals) => { const r = {}; fs.forEach((f, i) => { r[f] = vals[i] }); return r })
}

async function fetchTushareDaily({ token, tsCode, startDate, endDate, proxyUrl }) {
  const rows = await tusharePost({
    token, apiName: isIndexCode(tsCode) ? 'index_daily' : 'daily',
    params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
    fields: 'ts_code,trade_date,open,high,low,close,pre_close,pct_chg,vol,amount',
    proxyUrl,
  })
  return rows
    .map((r) => ({
      date: r.trade_date, open: Number(r.open), high: Number(r.high), low: Number(r.low),
      close: Number(r.close), preClose: Number(r.pre_close), pctChg: Number(r.pct_chg) / 100,
      volume: Number(r.vol), amount: Number(r.amount),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** 估值（PE/PB）按日 map；失败返回空对象。 */
async function fetchDailyBasic({ token, tsCode, startDate, endDate, proxyUrl }) {
  try {
    const rows = await tusharePost({
      token, apiName: 'daily_basic',
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: 'trade_date,pe,pe_ttm,pb,total_mv',
      proxyUrl,
    })
    const m = {}
    for (const r of rows) m[r.trade_date] = { pe: numOrNull(r.pe), pb: numOrNull(r.pb), mv: numOrNull(r.total_mv) }
    return m
  } catch { return {} }
}

/** 资金流（主力净流入/换手）按日 map；失败返回空对象。 */
async function fetchMoneyflow({ token, tsCode, startDate, endDate, proxyUrl }) {
  try {
    const rows = await tusharePost({
      token, apiName: 'moneyflow',
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: 'trade_date,net_mf_amount,net_mf_rate,turnover_rate',
      proxyUrl,
    })
    const m = {}
    for (const r of rows) m[r.trade_date] = { mainForce: numOrNull(r.net_mf_amount), turnover: numOrNull(r.turnover_rate) }
    return m
  } catch { return {} }
}

function numOrNull(v) { const n = typeof v === 'number' ? v : Number(v); return Number.isNaN(n) ? null : n }

/** 判断 ts_code 是否指数（上证指数/沪深300 等 SH 000xxx，深证成指/创业板指 等 SZ 399xxx）。 */
function isIndexCode(tsCode) {
  const [code, mkt] = tsCode.split('.')
  const m = (mkt ?? '').toUpperCase()
  if (m === 'SH') return /^000\d{3}$/.test(code)
  if (m === 'SZ') return /^399\d{3}$/.test(code)
  return false
}

/**
 * 东方财富免费历史日 K（无需 token/积分，纯 HTTP JSON）。
 * 作为 Tushare 不可用（积分不足/无权限）时的自动降级数据源。
 * kline 列：date,open,close,high,low,volume,amount,振幅,涨跌幅,涨跌额,换手率。
 */
async function fetchEastmoneyDaily({ tsCode, startDate, endDate, proxyUrl }) {
  const [code, mkt] = tsCode.split('.')
  const secid = ((mkt ?? '').toUpperCase() === 'SH' ? '1' : '0') + '.' + code
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&beg=${startDate}&end=${endDate}`
  const data = await fetchJson(url, { proxyUrl })
  const klines = data?.data?.klines ?? []
  const bars = klines.map((line) => {
    const p = String(line).split(',')
    const close = Number(p[2])
    const change = Number(p[9]) // 涨跌额
    return {
      date: p[0].replace(/-/g, ''),
      open: Number(p[1]), close, high: Number(p[3]), low: Number(p[4]),
      volume: Number(p[5]), amount: Number(p[6]),
      preClose: close - change,
      pctChg: Number(p[8]) / 100,
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
  return bars
}

/** 合成自检数据（明确标注：非真实 alpha，仅验证引擎机制），含持续趋势分段，让团队能出信号。 */
function makeSynthetic(seed = 20260822) {
  let s = seed >>> 0
  const rng = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296 }
  const N = 300
  const bars = []
  const fin = {}
  const ff = {}
  let close = 100
  let trend = 0.002
  let left = 0
  for (let i = 0; i < N; i++) {
    if (left <= 0) { trend = rng() < 0.55 ? 0.002 + rng() * 0.002 : -0.002 - rng() * 0.002; left = 15 + Math.floor(rng() * 25) }
    const r = trend + (rng() - 0.5) * 0.02
    const preClose = close
    close = Math.max(1, close * (1 + r))
    const date = `S${String(i).padStart(4, '0')}`
    bars.push({ date, open: preClose, high: Math.max(preClose, close), low: Math.min(preClose, close), close, preClose, pctChg: r, volume: 1e6 * (1 + rng() * 2), amount: 0 })
    fin[date] = { pe: r >= 0 ? 15 : 50, pb: r >= 0 ? 2 : 6, mv: 1e12 }
    ff[date] = { mainForce: r >= 0 ? 5000 : -5000, turnover: 3 }
    left--
  }
  return { bars, finByDate: fin, ffByDate: ff }
}

// ─── 技术指标（无未来函数：只用 [0..t-1] 区间） ───────────────────────

function ma(arr, start, count) {
  const seg = arr.slice(start, start + count).filter((x) => typeof x === 'number' && !Number.isNaN(x))
  return seg.length ? seg.reduce((s, x) => s + x, 0) / seg.length : null
}
function rsi(closes, t, period = 14) {
  if (t < period) return 50
  let gain = 0, loss = 0
  for (let k = t - period; k < t; k++) { const d = closes[k] - closes[k - 1]; if (d >= 0) gain += d; else loss -= d }
  if (loss === 0) return 100
  return 100 - 100 / (1 + gain / loss)
}

function buildSnapshot(bars, t, finByDate = {}, ffByDate = {}) {
  const closes = bars.map((b) => b.close)
  const vols = bars.map((b) => b.volume)
  const c = closes[t - 1]
  const momentum5 = t >= 6 ? c / closes[t - 6] - 1 : 0
  const momentum20 = t >= 21 ? c / closes[t - 21] - 1 : 0
  const ma20 = ma(closes, t - 20, 20)
  const ma60 = t >= 61 ? ma(closes, t - 60, 60) : null
  const rsi14 = rsi(closes, t, 14)
  const vol5 = ma(vols, t - 5, 5)
  const volumeRatio = vol5 ? vols[t - 1] / vol5 : null

  // 量能趋势 → 流动性推导（20 日量能较 60 日量能）
  const vol20 = ma(vols, t - 20, 20)
  const vol60 = t >= 61 ? ma(vols, t - 60, 60) : null
  const liquidity = vol20 != null && vol60 != null ? (vol20 > vol60 * 1.1 ? 'loose' : vol20 < vol60 * 0.9 ? 'tight' : 'neutral') : 'neutral'

  const fin = finByDate[bars[t - 1].date] ?? {}
  const ff = ffByDate[bars[t - 1].date] ?? {}

  return normalizeSnapshot({
    symbol: 'SIM',
    name: bars[t - 1].date,
    market: 'CN',
    price: c,
    change1d: t >= 1 ? c / closes[t - 1] - 1 : 0,
    technical: {
      trend: c > (ma20 ?? c) ? 'up' : c < (ma20 ?? c) ? 'down' : 'sideways',
      aboveMa20: ma20 == null ? false : c > ma20,
      aboveMa60: ma60 == null ? false : c > ma60,
      macdSignal: momentum5 >= 0.02 ? 'golden' : momentum5 <= -0.02 ? 'dead' : 'none',
      rsi14: Math.round(rsi14),
      volumeRatio,
      pattern: momentum5 >= 0.05 ? 'breakout' : momentum5 <= -0.05 ? 'breakdown' : 'none',
      support: Math.round(c * 0.95 * 100) / 100,
      resistance: Math.round(c * 1.05 * 100) / 100,
    },
    fundamental: {
      pe: fin.pe ?? null,
      pb: fin.pb ?? null,
      peg: null, roe: null, revenueGrowth: null, profitGrowth: null,
      industryProsperity: momentum20 > 0 ? 'up' : momentum20 < 0 ? 'down' : 'flat',
      valuationPercentile: null, debtRatio: null,
    },
    macro: { liquidity, policyBias: 'neutral', interestRate: null, geopoliticalRisk: 'medium', currencyPressure: 'stable' },
    fundFlow: {
      northboundNet: null,
      dragonTigerNetBuy: null,
      marginBalanceTrend: 'flat',
      mainForceNet: ff.mainForce != null ? ff.mainForce / 10000 : null, // 万元 → 亿
      turnoverRate: ff.turnover ?? null,
    },
    sentiment: {
      fearGreedIndex: Math.round(clamp(50 + momentum20 * 1000, 0, 100)),
      sectorHeat: momentum20 > 0.03 ? 'hot' : momentum20 < -0.03 ? 'cold' : 'warm',
      themeHeat: 'warm',
      limitUpCount: null, limitDownCount: null,
      abnormalVolatility: false,
    },
  })
}

// ─── 主流程 ───────────────────────────────────────────────────────────

async function runBacktest(data) {
  const { bars, finByDate, ffByDate, label } = data
  const LOOKBACK = 30
  const N = bars.length
  if (N < LOOKBACK + 20) throw new Error(`样本过短（${N} 天），需要至少 ${LOOKBACK + 20} 天`)

  const brain = createSharedBrain()
  const team = createAnalystTeam(brain)
  const integrator = new Integrator({ team })

  const INITIAL = 2000
  let cash = INITIAL, shares = 0
  let peak = INITIAL, maxDD = 0
  const dist = { buy: 0, sell: 0, hold: 0, reduce: 0, halt: 0 }
  const signals = []
  const momEntries = [] // 技术面动量因子：mom20 正负 → 前瞻收益
  const closes = bars.map((b) => b.close)
  let trades = 0

  for (let t = LOOKBACK; t < N; t++) {
    const entryPrice = bars[t - 1].close
    const snap = buildSnapshot(bars, t, finByDate, ffByDate)
    const rec = integrator.integrate(snap)
    dist[rec.action] = (dist[rec.action] ?? 0) + 1

    if (rec.action === 'buy' && shares === 0 && cash > 0) { shares = cash / entryPrice; cash = 0; trades++ }
    else if (rec.action === 'sell' && shares > 0) { cash += shares * entryPrice; shares = 0; trades++ }
    else if (rec.action === 'halt' && shares > 0) { cash += shares * entryPrice; shares = 0; trades++ }
    else if (rec.action === 'reduce' && shares > 0) { const h = shares / 2; cash += h * entryPrice; shares -= h; trades++ }

    const ret = bars[t].close / entryPrice - 1
    const equity = cash + shares * bars[t].close
    if (equity > peak) peak = equity
    if (peak > 0) maxDD = Math.max(maxDD, (peak - equity) / peak)

    if (rec.action === 'buy' || rec.action === 'sell' || rec.action === 'halt' || rec.action === 'reduce') {
      signals.push({ entryIdx: t - 1, action: rec.action })
    }
    const mom20 = t >= 21 ? closes[t - 1] / closes[t - 21] - 1 : 0
    momEntries.push({ entryIdx: t - 1, positive: mom20 > 0 })
  }

  const finalEquity = cash + shares * bars[N - 1].close
  const bhEquity = (INITIAL / bars[LOOKBACK - 1].close) * bars[N - 1].close

  const fwd = (entryIdx, k) => (entryIdx + k < N ? bars[entryIdx + k].close / bars[entryIdx].close - 1 : null)
  const allFwd = []
  for (let e = LOOKBACK - 1; e < N - 5; e++) { const f = fwd(e, 5); if (f != null) allFwd.push(f) }
  const bucket = { buy: [], sell: [], halt: [] }
  for (const sg of signals) {
    const f = fwd(sg.entryIdx, 5)
    if (f == null) continue
    if (sg.action === 'buy') bucket.buy.push(f)
    else if (sg.action === 'sell') bucket.sell.push(f)
    else if (sg.action === 'halt') bucket.halt.push(f)
  }
  const momUpFwd = [], momDownFwd = []
  for (const m of momEntries) {
    const f = fwd(m.entryIdx, 5)
    if (f == null) continue
    if (m.positive) momUpFwd.push(f); else momDownFwd.push(f)
  }

  return {
    label, days: N - LOOKBACK, finalEquity, bhEquity, maxDD, dist, trades,
    buyFwd5: bucket.buy, sellFwd5: bucket.sell, haltFwd5: bucket.halt, marketFwd5: allFwd,
    momUpFwd5: momUpFwd, momDownFwd5: momDownFwd,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const selftest = args.includes('--selftest')
  const pos = args.filter((a) => !a.startsWith('--'))
  const tsCode = pos[0] ?? '000001.SH'
  const startDate = pos[1] ?? '20200101'
  const endDate = pos[2] ?? '20231231'

  const cfg = loadDataSourcesConfig()
  const token = cfg.tushareToken
  const proxyUrl = cfg.proxyEnabled ? cfg.proxy : null

  let data
  if (selftest) {
    data = { ...makeSynthetic(), label: '合成自检（非真实 alpha）' }
    console.log('⚠ 合成自检：验证回测引擎机制。合成价格无真实市场结构，结果不可作为 alpha 证据。')
  } else {
    // 优先 Tushare（有 token 时），无 token/无权限/报错则自动降级东方财富免费行情
    let source = '东方财富(免费)'
    let bars, finByDate = {}, ffByDate = {}
    if (token) {
      try {
        bars = await fetchTushareDaily({ token, tsCode, startDate, endDate, proxyUrl })
        if (!isIndexCode(tsCode)) {
          finByDate = await fetchDailyBasic({ token, tsCode, startDate, endDate, proxyUrl })
          ffByDate = await fetchMoneyflow({ token, tsCode, startDate, endDate, proxyUrl })
        }
        source = 'Tushare'
      } catch (e) {
        console.log(`⚠ Tushare 不可用（${e?.message}），自动降级到东方财富免费行情。`)
        bars = await fetchEastmoneyDaily({ tsCode, startDate, endDate, proxyUrl })
      }
    } else {
      console.log('未配置 Tushare token，使用东方财富免费行情。')
      bars = await fetchEastmoneyDaily({ tsCode, startDate, endDate, proxyUrl })
    }
    data = { bars, finByDate, ffByDate, label: `真实数据 ${tsCode} ${startDate}~${endDate} [${source}]` }
  }

  const r = await runBacktest(data)
  const buyAvg = r.buyFwd5.length ? avg(r.buyFwd5) : null
  const sellAvg = r.sellFwd5.length ? avg(r.sellFwd5) : null
  const haltAvg = r.haltFwd5.length ? avg(r.haltFwd5) : null
  const mktAvg = avg(r.marketFwd5)

  console.log('\n' + '='.repeat(88))
  console.log(`  Gina 真实历史回测 · ${r.label}`)
  console.log('='.repeat(88))
  console.log(`  Gina 终值:  ${round(r.finalEquity)}（${pnl(r.finalEquity / 2000 - 1)}）`)
  console.log(`  买入持有:   ${round(r.bhEquity)}（${pnl(r.bhEquity / 2000 - 1)}）`)
  console.log(`  最大回撤:   ${(r.maxDD * 100).toFixed(1)}%   交易次数: ${r.trades}   有效样本: ${r.days} 天`)
  console.log(`  决策分布:   ${Object.entries(r.dist).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  console.log(`  ── 信号前瞻 5 日收益（alpha 检验） ──`)
  console.log(`   买入后:   ${buyAvg == null ? '无' : pnl(buyAvg)}（${r.buyFwd5.length} 次）`)
  console.log(`   卖出后:   ${sellAvg == null ? '无' : pnl(sellAvg)}（${r.sellFwd5.length} 次）`)
  console.log(`   暂停后:   ${haltAvg == null ? '无' : pnl(haltAvg)}（${r.haltFwd5.length} 次）`)
  console.log(`   市场平均: ${pnl(mktAvg)}`)
  const edge = buyAvg == null ? null : buyAvg - mktAvg
  console.log(`   → 买入信号超额(alpha): ${edge == null ? 'N/A' : pnl(edge)}  ${edge != null ? (edge > 0 ? '（有正向预测力）' : '（无正向预测力）') : ''}`)
  const momUp = r.momUpFwd5.length ? avg(r.momUpFwd5) : null
  const momDown = r.momDownFwd5.length ? avg(r.momDownFwd5) : null
  console.log(`  ── 技术面动量因子（20 日）alpha 检验 ──`)
  console.log(`   动量>0 后 5 日: ${momUp == null ? '无' : pnl(momUp)}（${r.momUpFwd5.length} 天）`)
  console.log(`   动量<=0 后 5 日: ${momDown == null ? '无' : pnl(momDown)}（${r.momDownFwd5.length} 天）`)
  const momSpread = (momUp == null || momDown == null) ? null : (momUp - mktAvg)
  console.log(`   → 动量多空价差: ${momUp == null || momDown == null ? 'N/A' : pnl(momUp - momDown)}  ${momSpread != null ? (momSpread > 0 ? '（动量因子有正向 alpha）' : '（动量因子无正向 alpha）') : ''}`)
  console.log('='.repeat(88))

  // 闭环：把回测教训蒸馏为交易技能（skills/trading/）。合成自检不落盘，避免把噪声 alpha 写成永久技能。
  if (selftest) {
    console.log('\n  （合成自检不生成交易技能；用真实数据回测时才落盘 skills/trading/）')
    return
  }
  const lessons = distillTradingLessons(r, r.label)
  console.log('\n  生成交易策略技能（skills/trading/）：')
  for (const lesson of lessons) {
    const res = generateTradingSkill(lesson, SKILLS_DIR)
    console.log(`    ${res.ok ? '✓' : '·'} ${lesson.name}  ${res.ok ? '' : `(${res.reason ?? res.message ?? '已存在'})`}`)
  }
  if (lessons.length) {
    const first = lessons[0]
    console.log(`\n  ── 示例技能 SKILL.md（${first.name}） ──`)
    // 直接读取写入的 SKILL.md 展示
    try {
      const { readFileSync } = await import('node:fs')
      const p = join(SKILLS_DIR, 'trading', first.name, 'SKILL.md')
      console.log(readFileSync(p, 'utf8').split('\n').slice(0, 24).join('\n'))
    } catch { /* 忽略读取失败 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })