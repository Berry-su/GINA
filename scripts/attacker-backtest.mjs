/**
 * Gina 短线攻击手 · 带选股因子打板 vs 无差别打板 对比回测（A 股 · 东方财富免费行情）
 *
 * 结论来源：factor-scan.mjs 在随机抽样的全市场宇宙里发现三个选股 alpha：
 *   - 低价（<10 元，尤其 <5 元）涨停次日连板率高；
 *   - 小盘（流通市值 30-100 亿）连板率高；
 *   - 天量换手（>20%）次日开盘卖是负收益，要避开。
 *
 * 本脚本把这三个因子做成「短线攻击手」打分器，对比两条满仓滚动策略：
 *   - 无差别：每天无脑买当日涨幅最高的涨停股；
 *   - 带选股：每天只买「打分最高」且过阈值的涨停股；
 *   两者都是次日开盘必卖（T+1），单标的同时只持一支，满仓滚动，目标 2000→20000。
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { fetchJson } from '../src/finance-data-sources/http-client.js'
import { scoreCandidate } from '../src/analysts/attacker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%'
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const COST = 0.0015 // 往返成本

function limitPct(code) { return /^(30|688)/.test(code) ? 0.20 : 0.10 }
const isLimit = (code, pct) => pct >= limitPct(code) - 0.005

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// clist 限流时的备用多样性标的池（大/中/小盘、多行业混合，非妖股池）
const FALLBACK_UNIVERSE = [
  '601398', '600519', '601318', '600036', '000858', '300750', '002594', '000333', '601899', '600900',
  '601088', '600276', '300059', '600030', '601012', '002475', '000001', '600887', '603288', '300760',
  '601138', '002230', '300014', '600893', '601633',
  '600776', '000957', '002432', '300313', '002771', '000592', '600868', '000676', '300184', '600130',
  '000633', '002248', '601606', '300341', '600126',
].map((code) => ({ code }))

async function fetchClist() {
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
  let all = []
  // 全市场按市值降序，55 页×100；抽 5 个分布页（大中小兼有）做无偏采样，降低限流
  for (const pn of [1, 12, 24, 40, 55]) {
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=${fs}&fields=f12,f14,f20`
    let diff = []
    for (let attempt = 0; attempt < 2 && !diff.length; attempt++) {
      try { const data = await fetchJson(url, {}); diff = data?.data?.diff ?? [] } catch { /* 抖动重试 */ }
      if (!diff.length) await sleep(500)
    }
    if (diff.length) all = all.concat(diff)
  }
  return all.map((d) => ({ code: String(d.f12), name: d.f14 }))
}

function sample(list, n, seed) {
  let s = seed >>> 0
  const rng = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296 }
  const idx = new Set()
  while (idx.size < Math.min(n, list.length)) idx.add(Math.floor(rng() * list.length))
  return [...idx].map((i) => list[i])
}

async function fetchEastmoney(code, startDate, endDate) {
  const market = code.startsWith('6') || code.startsWith('9') ? '1' : '0'
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${code}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&beg=${startDate}&end=${endDate}`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await fetchJson(url, {})
      const klines = data?.data?.klines ?? []
      if (klines.length) {
        return klines.map((line) => {
          const p = String(line).split(',')
          const close = Number(p[2])
          const change = Number(p[9])
          return {
            date: p[0].replace(/-/g, ''), open: Number(p[1]), close,
            high: Number(p[3]), low: Number(p[4]), amount: Number(p[6]),
            turnover: Number(p[10]), preClose: close - change, pctChg: Number(p[8]) / 100,
          }
        }).sort((a, b) => a.date.localeCompare(b.date))
      }
    } catch { /* 网络/限流，重试 */ }
    await sleep(600 + attempt * 600)
  }
  return []
}

async function main() {
  const args = process.argv.slice(2)
  const nn = args.find((a) => /^\d+$/.test(a))
  const N = nn ? Number(nn) : 60
  const dates = args.filter((a) => /^\d{8}$/.test(a))
  const startDate = dates[0] ?? '20200101'
  const endDate = dates[1] ?? '20231231'
  const THRESHOLD = 4 // 含「涨停 +1」

  console.log('='.repeat(88))
  console.log(`  Gina 短线攻击手 · 带选股 vs 无差别 打板 · 随机抽样 ${N} 支 · ${startDate}~${endDate}`)
  console.log('='.repeat(88))

  // 优先用 baostock 免费缓存（scripts/baostock-fetch.py 生成），否则回落东财 HTTP
  const CACHE = join(__dirname, '..', 'data', 'baostock-klines.json')
  let stocks = []
  if (existsSync(CACHE)) {
    const data = JSON.parse(readFileSync(CACHE, 'utf8'))
    stocks = Object.entries(data.klines ?? {}).map(([code, bars]) => ({ code, bars }))
    console.log(`  从 baostock 免费缓存加载 ${stocks.length} 支（无 token/积分/限流）\n`)
  } else {
    let universe = sample(await fetchClist(), N, 20260822)
    if (universe.length < 20) {
      console.log('  ⚠ clist 限流，改用固定多样性标的池')
      universe = FALLBACK_UNIVERSE
    }
    console.log(`  拉取 ${universe.length} 支历史日 K ...`)
    const CONC = 3
    for (let i = 0; i < universe.length; i += CONC) {
      const batch = universe.slice(i, i + CONC)
      const res = await Promise.all(batch.map(async (u) => {
        try { const bars = await fetchEastmoney(u.code, startDate, endDate); return bars.length >= 40 ? { code: u.code, bars } : null } catch { return null }
      }))
      for (const r of res) if (r) stocks.push(r)
      await sleep(300)
    }
    console.log(`  有效标的 ${stocks.length} 支\n`)
  }

  // 收集所有非一字涨停事件
  const events = []
  for (const s of stocks) {
    for (let i = 0; i < s.bars.length - 1; i++) {
      const b = s.bars[i]
      if (!isLimit(s.code, b.pctChg)) continue
      const isYiZi = b.open === b.high && b.high === b.low && b.low === b.close
      if (isYiZi) continue
      let streak = 0
      for (let k = i; k >= 0 && isLimit(s.code, s.bars[k].pctChg); k--) streak++
      const next = s.bars[i + 1]
      const mcap = b.turnover > 0 ? (b.amount / (b.turnover / 100)) / 1e8 : 999
      events.push({
        code: s.code, date: b.date, price: b.close, turnover: b.turnover, mcap, streak, pctChg: b.pctChg,
        opened: b.low < b.close, // 盘中最低价低于收盘涨停价 = 盘中打开过（炸板回封，真实可成交）
        nextOpen: next.open, nextClose: next.close, nextPct: next.pctChg,
        ret: next.open / b.close - 1 - COST,
        score: 0,
      })
    }
  }
  for (const e of events) e.score = scoreCandidate({ price: e.price, floatMcap: e.mcap, turnover: e.turnover, streak: e.streak, isLimitUp: true }).score

  // 每个成交假设下：按日期分组，每日各策略只挑一支（满仓单店）
  const build = (eventList) => {
    const byDate = new Map()
    for (const e of eventList) { const arr = byDate.get(e.date) ?? []; arr.push(e); byDate.set(e.date, arr) }
    const days = [...byDate.keys()].sort()
    const pick = (dayEvents, mode) => {
      if (!dayEvents.length) return null
      if (mode === 'plain') return dayEvents.reduce((a, b) => (b.pctChg > a.pctChg ? b : a))
      const el = dayEvents.filter((e) => e.score >= THRESHOLD)
      if (!el.length) return null
      return el.reduce((a, b) => (b.score > a.score ? b : (b.score === a.score && b.pctChg > a.pctChg ? b : a)))
    }
    const simulate = (mode) => {
      const picked = days.map((d) => pick(byDate.get(d), mode)).filter(Boolean)
      let equity = 2000, peak = 2000, dd = 0, wins = 0, cont = 0
      for (const e of picked) {
        equity *= (1 + e.ret)
        if (equity > peak) peak = equity
        dd = Math.max(dd, (peak - equity) / peak)
        if (e.ret > 0) wins++
        if (isLimit(e.code, e.nextPct)) cont++
      }
      return { picks: picked, equity, dd, winRate: picked.length ? wins / picked.length : 0, contRate: picked.length ? cont / picked.length : 0 }
    }
    return { simulate, days, byDate, pick }
  }

  const opt = build(events)                        // 乐观成交：非一字涨停都能买
  const real = build(events.filter((e) => e.opened)) // 真实成交：只能买盘中打开过(炸板回封)

  const row = (name, r) => {
    console.log(`  ${name.padEnd(16)} 交易 ${String(r.picks.length).padStart(4)} 次 | 胜率 ${(r.winRate * 100).toFixed(1).padStart(5)}% | 连板率 ${(r.contRate * 100).toFixed(1).padStart(5)}% | 2000→${String(round(r.equity)).padStart(12)}（${pnl(r.equity / 2000 - 1).padStart(9)}） | 回撤 ${(r.dd * 100).toFixed(1).padStart(5)}%`)
  }
  const tenX = (r) => (r.equity >= 20000 ? '✅ 达 10 倍' : `未到 10 倍（差 ${round(20000 / Math.max(r.equity, 1))} 倍）`)

  console.log('  ── 乐观成交（非一字涨停都能买进） ──')
  row('无差别', opt.simulate('plain'))
  row('带选股', opt.simulate('smart'))
  console.log('  ── 真实成交（只能买盘中打开过/炸板回封） ──')
  const realPlain = real.simulate('plain')
  const realSmart = real.simulate('smart')
  row('无差别', realPlain)
  row('带选股', realSmart)

  console.log('\n  10 倍结论：')
  console.log(`    乐观·带选股   ${tenX(opt.simulate('smart'))}`)
  console.log(`    真实·带选股   ${tenX(realSmart)}   ← 贴近现实的答案`)

  // 选股子集特征（真实成交口径）
  console.log('\n  ── 短线攻击手选股子集特征（真实成交口径） ──')
  const realEvents = events.filter((e) => e.opened)
  const realSmartSet = real.days.map((d) => real.pick(real.byDate.get(d), 'smart')).filter(Boolean)
  const g = (list) => ({
    n: list.length,
    avgRet: avg(list.map((e) => e.ret)),
    avgPrice: avg(list.map((e) => e.price)),
    avgMcap: avg(list.map((e) => e.mcap)),
    highTurnPct: (list.filter((e) => e.turnover > 20).length / list.length * 100),
  })
  const ga = g(realEvents), gs = g(realSmartSet)
  console.log(`  全部可成交涨停: ${String(ga.n).padStart(4)} 次 | 次日开盘 ${pnl(ga.avgRet)} | 均价 ${ga.avgPrice.toFixed(1)} 元 | 均流通市值 ${ga.avgMcap.toFixed(0)} 亿 | 天量换手占比 ${ga.highTurnPct.toFixed(0)}%`)
  console.log(`  带选股子集:     ${String(gs.n).padStart(4)} 次 | 次日开盘 ${pnl(gs.avgRet)} | 均价 ${gs.avgPrice.toFixed(1)} 元 | 均流通市值 ${gs.avgMcap.toFixed(0)} 亿 | 天量换手占比 ${gs.highTurnPct.toFixed(0)}%`)
  console.log('='.repeat(88))
}

function round(v, d = 2) { const f = 10 ** d; return Math.round(v * f) / f }

main().catch((e) => { console.error(e); process.exit(1) })