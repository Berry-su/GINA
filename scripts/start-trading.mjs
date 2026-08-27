/**
 * Gina 每日交易 · 常驻入口
 *
 * 用法：
 *   node scripts/start-trading.mjs --once   # 立即跑一个完整交易日周期（测试/演示）
 *   node scripts/start-trading.mjs          # 常驻：分区域(US盘后/CN盘前)定时跑，每日落盘日志
 *
 * 每个周期：收信息(Google News RSS 经 Clash) → 题材 → 高弹性小票 → baostock 行情打分
 *           → 今日买哪只 → 下单(mock) → 落盘日志 data/daily-logs/<YYYYMMDD>.json
 * 日志是为了日后复盘「信息选时」：看她选的题材/票，是否领先于后续涨幅。
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { loadDataSourcesConfig } from '../src/finance-data-sources/config.js'
import { createRssNewsSources } from '../src/finance-data-sources/rss-news.js'
import { scanThemes, splitThemes, mapThemesToStocks, flatCandidates } from '../src/trading/theme-stock-map.js'
import { scoreCandidate } from '../src/analysts/attacker.js'
import { createAnalystTeam, Integrator, normalizeSnapshot } from '../src/analysts/index.js'
import { analyzeMarketNews, marketFearGreed } from '../src/finance-data-engine/snapshot-builder.js'
import { analyzeTiming, appendSnapshot, loadHistory, SIGNAL_PRIORITY } from '../src/trading/theme-heat-tracker.js'
import { reflectDailyPicks } from './reflect-daily-picks.mjs'
import { MiniQMTBrokerAdapter } from '../src/finance-data-sources/broker.js'
import { getSessionState, minutesInTimeZone } from '../src/finance-data-engine/market-calendar.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const limit = (code) => (/^(30|688)/.test(code) ? 0.20 : 0.10)
const LOG_DIR = join(root, 'data', 'daily-logs')

const cfg = loadDataSourcesConfig()
const sources = createRssNewsSources(cfg.newsFeeds, { proxyUrl: cfg.proxyEnabled ? cfg.proxy : null })
const broker = new MiniQMTBrokerAdapter({ mode: 'mock', accountId: 'GINA' })

// ── 由历史日线推导技术面 + 搭建分析师团队可消费的 MarketSnapshot ──
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const ema = (vals, n) => {
  const k = 2 / (n + 1)
  let e = vals[0]
  const out = [e]
  for (let i = 1; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out.push(e) }
  return out
}
function rsi14(closes) {
  if (closes.length < 15) return 50
  let g = 0
  let l = 0
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) g += d
    else l -= d
  }
  if (l === 0) return 100
  return 100 - 100 / (1 + (g / 14) / (l / 14))
}
function deriveTechnical(bars) {
  const closes = bars.map((b) => b.close).filter((v) => v > 0)
  const n = closes.length
  const last = bars[bars.length - 1]
  const ma20 = n >= 20 ? mean(closes.slice(-20)) : mean(closes)
  const ma60 = n >= 60 ? mean(closes.slice(-60)) : ma20
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const macd = e12[e12.length - 1] - e26[e26.length - 1]
  const mom20 = n >= 21 ? closes[n - 1] / closes[n - 21] - 1 : 0
  const hi20 = n >= 20 ? Math.max(...closes.slice(-20)) : Math.max(...closes)
  const lo20 = n >= 20 ? Math.min(...closes.slice(-20)) : Math.min(...closes)
  const turns = bars.map((b) => b.turnover ?? 0).filter((t) => t > 0)
  const avgTurn = mean(turns.slice(-20)) || 1
  return {
    trend: mom20 > 0.03 ? 'up' : mom20 < -0.03 ? 'down' : 'sideways',
    aboveMa20: last.close > ma20,
    aboveMa60: last.close > ma60,
    macdSignal: macd >= 0 ? 'golden' : 'dead',
    rsi14: Math.round(rsi14(closes)),
    volumeRatio: last.turnover > 0 ? last.turnover / avgTurn : 1,
    pattern: last.close >= hi20 ? 'breakout' : last.close <= lo20 ? 'breakdown' : 'none',
  }
}
function buildPickSnapshot({ code, name, bars, macro, fearGreed, themeHeat, sig }) {
  const last = bars[bars.length - 1]
  return normalizeSnapshot({
    symbol: code,
    name,
    market: 'CN',
    price: last.close,
    change1d: last.pctChg,
    technical: deriveTechnical(bars),
    fundamental: {
      pe: last.pe ?? null,
      pb: last.pb ?? null,
      industryProsperity: themeHeat === 'hot' ? 'up' : themeHeat === 'cold' ? 'down' : 'flat',
    },
    macro: { liquidity: macro.liquidity, policyBias: macro.policyBias, geopoliticalRisk: macro.geopoliticalRisk },
    fundFlow: { turnoverRate: last.turnover ?? null, marginBalanceTrend: 'flat' },
    sentiment: {
      fearGreedIndex: fearGreed,
      sectorHeat: (sig === 'EMERGE' || sig === 'RISE') ? 'hot' : 'warm',
      themeHeat: (sig === 'EMERGE' || sig === 'RISE') ? 'hot' : themeHeat,
      abnormalVolatility: (last.turnover ?? 0) > 20,
    },
  })
}

/**
 * 全否重选：候选池被风控官/宏观环境全部否决时，回退到「短线攻击手」纯动量通道重选。
 * 不经过宏观环境否决，只按攻击手分（低价优先/小盘优先/连板惯性/涨停）选前 3 只，
 * 保证交易绝不空仓（用户硬约束）。
 * @param {Array<object>} picks 已被否决的候选
 * @returns {Array<object>} 重选后的可买候选
 */
function reselectPicks(picks) {
  // 按攻击手分降序取前 3；即便全为 0 分也照样选出（宁可买，不可空仓）
  return picks
    .slice()
    .sort((a, b) => (b.attacker ?? 0) - (a.attacker ?? 0))
    .slice(0, 3)
    .map((p) => ({
      ...p,
      vetoed: false,
      halted: false,
      action: 'buy',
      score: (p.attacker ?? 0) + (p.timingBoost ?? 0),
      reselected: true,
      reasons: [...(p.reasons ?? []).filter((r) => !r.includes('风控官')), '全否重选：回退攻击手连板/低价通道'],
      analyst: `${p.analyst ?? ''}；[全否重选]`,
    }))
}

async function runCycle() {
  const news = []
  for (const s of sources) { try { news.push(...(await s.fetch())) } catch { /* 跳过 */ } }

  const themes = scanThemes(news)
  const today = new Date().toISOString().slice(0, 10)
  const history = loadHistory()
  const themeHeatObj = Object.fromEntries(themes)
  // 信息选时：识别「爆发前先手 / 持续升温」的题材（什么时候买）
  const timing = analyzeTiming(themeHeatObj, history, { baselineDays: 3 })
  appendSnapshot(today, themeHeatObj)
  const signalByTheme = new Map(timing.map((t) => [t.theme, t.signal]))

  // 分析师团队（6 人：5 分析师 + 风控官）+ 整合器：分析所有信息/风险，选出获利最高的股票
  const macroInfo = analyzeMarketNews(news)
  const fearGreed = marketFearGreed([])
  const team = createAnalystTeam()
  const integrator = new Integrator({ team, minBullish: 3 })

  const { attack, macro } = splitThemes(themes)
  // 选时优先：爆发前先手 / 升温题材排前，已爆炒的题材靠后
  attack.sort((a, b) => (SIGNAL_PRIORITY[signalByTheme.get(b[0]) ?? 'QUIET'] - SIGNAL_PRIORITY[signalByTheme.get(a[0]) ?? 'QUIET']) || (b[1] - a[1]))
  const mapped = mapThemesToStocks(attack, { top: 3, perTheme: 3 })
  const candidates = flatCandidates(mapped)

  // 候选池补充通道：当日涨停池里的「低价 + 连板」小票（AKShare），
  // 弥补题材→龙头映射漏掉当天真正在连板的低价票（用户：低价连板票不能漏）。
  try {
    execSync('python3 scripts/fetch-ztpool-today.py', { cwd: root, stdio: 'ignore' })
    const ztPath = join(root, 'data', 'ztpool-today.json')
    if (existsSync(ztPath)) {
      const zt = JSON.parse(readFileSync(ztPath, 'utf8'))
      const seen = new Set(candidates.map((c) => c.code))
      for (const z of zt) {
        if (seen.has(z.code)) continue
        seen.add(z.code)
        candidates.push({ code: z.code, name: z.name, theme: z.industry || '连板/低价' })
      }
    }
  } catch { /* 涨停池拉取失败不影响主流程 */ }

  writeFileSync(join(root, 'data', 'picks-candidates.json'), JSON.stringify(candidates), 'utf8')

  let picks = []
  try {
    execSync('python3 scripts/fetch-picks.py', { cwd: root, stdio: 'ignore' })
    const kPath = join(root, 'data', 'picks-klines.json')
    if (existsSync(kPath)) {
      const kd = JSON.parse(readFileSync(kPath, 'utf8'))
      for (const [code, info] of Object.entries(kd)) {
        const bars = info.bars
        if (bars.length < 25) continue
        const last = bars[bars.length - 1]
        const lim = limit(code)
        const isLimitUp = last.pctChg >= lim - 0.005
        let streak = 0
        for (let i = bars.length - 1; i >= 0 && bars[i].pctChg >= lim - 0.005; i--) streak++
        const floatMcap = last.turnover > 0 ? (last.amount / (last.turnover / 100)) / 1e8 : null
        const mom20 = bars[bars.length - 1].close / bars[bars.length - 21].close - 1
        const theme = candidates.find((x) => x.code === code)?.theme ?? ''
        const sc = scoreCandidate({ price: last.close, floatMcap, turnover: last.turnover, streak, isLimitUp })
        // 信息选时加分：爆发前先手/升温题材加分，已爆炒题材降分（追高回避）
        const sig = signalByTheme.get(theme) ?? 'QUIET'
        const timingBoost = { EMERGE: 3, RISE: 2, HOT: -2, QUIET: 0 }[sig] ?? 0

        // 分析师团队对每只候选独立分析（信息+风险），产出共识 + 风控官否决
        const snap = buildPickSnapshot({ code, name: info.name, bars, macro: macroInfo, fearGreed, themeHeat: macroInfo.themeHeat, sig })
        const ana = integrator.integrate(snap)
        const vetoed = ana.vetoed || ana.halt
        const consensusPts = ana.bullish - ana.bearish * 0.5
        const score = vetoed ? -999 : sc.score + timingBoost + consensusPts

        const reasons = sc.reasons.slice()
        if (sig === 'EMERGE') reasons.push('题材爆发前先手')
        else if (sig === 'RISE') reasons.push('题材持续升温')
        else if (sig === 'HOT') reasons.push('题材已爆炒(追高回避)')
        if (ana.action === 'buy') reasons.push(`${ana.bullish} 位分析师看多达成共识`)
        else reasons.push(`分析师 看多${ana.bullish}/看空${ana.bearish}/观望${ana.neutral}·${ana.label}`)
        if (vetoed) reasons.push(`风控官否决：${ana.vetoReason ?? ana.reason}`)

        picks.push({ code, name: info.name, theme, signal: sig, price: last.close, floatMcap, turnover: last.turnover, streak, isLimitUp, mom20, score, attacker: sc.score, timingBoost, bullish: ana.bullish, bearish: ana.bearish, neutral: ana.neutral, action: ana.action, vetoed, analyst: ana.summary, reasons })
      }
    }
  } catch { /* 行情拉取失败则仅保留题材候选 */ }
  picks.sort((a, b) => b.score - a.score)

  // 全否重选兜底：所有候选被否决（无一只可买）时，回退攻击手通道重选，绝不空仓
  const buyable = picks.filter((p) => !p.vetoed && p.score >= 4)
  if (buyable.length === 0 && picks.length > 0) {
    picks = reselectPicks(picks)
    console.log(`  [全否重选] 候选全被否决 → 回退攻击手连板/低价通道，重选出 ${picks.length} 只可买标的`)
  }

  const orders = []
  const top = picks[0]
  if (top && !top.vetoed && top.score >= 4) {
    orders.push(await broker.placeOrder({ symbol: `${top.code}`.padEnd(6, '.SH'), side: 'buy', size: 0, price: top.price }, { authorized: true }))
  }

  const rec = {
    date: new Date().toISOString().slice(0, 10),
    markets: { US: getSessionState('US').label, CN: getSessionState('CN').label },
    macro: Object.fromEntries(macro),
    info_count: news.length,
    attack: Object.fromEntries(attack),
    timing,
    candidates: candidates.map((c) => ({ code: c.code, name: c.name, theme: c.theme })),
    picks: picks.map((p) => ({ ...p, floatMcap: p.floatMcap ? Math.round(p.floatMcap) : null })),
    top: top ? { code: top.code, name: top.name, theme: top.theme, signal: top.signal, price: top.price, score: top.score, bullish: top.bullish, bearish: top.bearish, neutral: top.neutral, action: top.action, analyst: top.analyst } : null,
    orders,
  }
  mkdirSync(LOG_DIR, { recursive: true })
  writeFileSync(join(LOG_DIR, `${rec.date}.json`), JSON.stringify(rec, null, 2), 'utf8')

  // 落库到数据库（memories 表），避免选股结果只依赖 JSON 文件、丢失后无法查询。
  // 动态 import + try-catch：即使 db 不可用（如 better-sqlite3 ABI 不匹配）也不影响选股主流程。
  try {
    const { insertMemory } = await import('../src/capabilities/db.js')
    for (const p of picks) {
      insertMemory({
        event_type: 'trading_pick',
        title: `盘前选股 ${p.name}(${p.code})`,
        content: `${rec.date} 盘前选中 ${p.name}(${p.code})·${p.theme || '—'} 现价${p.price ?? '—'} 综合分${p.score} 连板${p.streak}${p.isLimitUp ? ' 涨停' : ''}`,
        detail: JSON.stringify({ date: rec.date, code: p.code, name: p.name, theme: p.theme, signal: p.signal, price: p.price, floatMcap: p.floatMcap, streak: p.streak, isLimitUp: p.isLimitUp, score: p.score, action: p.action, vetoed: p.vetoed, analyst: p.analyst }),
        entities: [p.code],
        concepts: ['交易', '盘前选股', p.theme || '题材'].filter(Boolean),
        tags: ['kind:trading_pick', 'domain:trading'],
        salience: 4,
        timestamp: new Date().toISOString(),
      })
    }
    if (picks.length) console.log(`  已落库: ${picks.length} 只票 → memories 表 (event_type=trading_pick)`)
  } catch (e) {
    console.warn(`  [落库] 写入数据库失败(不影响选股): ${e?.message || e}`)
  }

  // 实战 → 反思 → 蒸馏：回看往日 pick 胜负，反思失败点，蒸馏交易技能
  try { rec.reflection = reflectDailyPicks() } catch (e) { rec.reflection = { error: e?.message ?? 'unknown' } }

  return rec
}

const fmtTime = (d = new Date()) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return f.format(d)
}

function printResult(rec) {
  console.log('='.repeat(66))
  console.log(`  [${fmtTime()}] Gina 每日交易 · 单周期结果`)
  console.log('='.repeat(66))
  console.log(`  信息 ${rec.info_count} 条 | 宏观 ${Object.keys(rec.macro).join('/') || '—'} | 盘态 US[${rec.markets.US}] CN[${rec.markets.CN}]`)
  console.log('  ── 题材选时（信息先手） ──')
  if (rec.timing.length) {
    for (const t of rec.timing.slice(0, 6)) console.log(`    [${t.signal}] ${t.theme} 热度${t.heat} 基线${t.baseline} Δ${t.delta >= 0 ? '+' : ''}${t.delta} · ${t.label}`)
  } else {
    console.log('    （暂无题材信号）')
  }
  console.log('  ── 分析师团队 + 选股排名（今日短炒目标） ──')
  const picks = rec.picks ?? []
  if (picks.length) {
    for (const p of picks.slice(0, 5)) {
      const price = p.price != null ? `现价 ${p.price}` : ''
      const vote = p.vetoed ? '[风控否决]' : `[看多${p.bullish}/看空${p.bearish}]`
      console.log(`    ${String(p.code)} ${p.name}（${p.theme || '—'}）${price} 综合 ${p.score} ${vote} ${(p.reasons ?? []).join('、')}`)
    }
  } else {
    console.log('    （暂无候选，等行情/信号）')
  }
  if (rec.top) {
    console.log(`  今日最该打: ${rec.top.name}(${rec.top.code})·${rec.top.theme}[${rec.top.signal}] 综合 ${rec.top.score} · 分析师[看多${rec.top.bullish}/看空${rec.top.bearish}/观望${rec.top.neutral}]`)
    if (rec.top.analyst) console.log(`    分析师逐一看法: ${rec.top.analyst}`)
  } else {
    console.log('  今日最该打: 无达标（风控否决或综合分不足，等信号）')
  }
  console.log(`  下单: ${rec.orders.length ? rec.orders.map((o) => `${o.symbol}:${o.side}→${o.status}`).join(' ') : '无'}`)
  console.log(`  已落盘: data/daily-logs/${rec.date}.json`)
  const rf = rec.reflection
  if (rf && rf.evaluatedCount) console.log(`  回看反思: 累计 ${rf.totalPicks} pick | 有后续数据 ${rf.evaluatedCount} | +5日命中率 ${(rf.hit5 * 100).toFixed(0)}% | 失败 ${rf.failureCount} 笔`)
  else if (rf) console.log(`  回看反思: 累计 ${rf.totalPicks ?? 0} pick | 待后续数据验证 ${rf.pendingCount ?? 0} 笔`)
  console.log('='.repeat(66))
}

const once = process.argv.includes('--once')

if (once) {
  const rec = await runCycle()
  printResult(rec)
} else {
  console.log('Gina 每日交易常驻启动…（每日 CN 盘前 09:00 / 收盘 15:00 各一次；Ctrl-C 停止）')
  // 盘前/收盘各一次，避免 24h 高频打新闻/行情被限流
  const CN_TARGETS = [9 * 60, 15 * 60] // 09:00 盘前（收隔夜美股+国内早报选股）· 15:00 收盘（复盘落盘）
  const fmtClock = (mins) => `${String(Math.floor((mins % 1440) / 60)).padStart(2, '0')}:${String((mins % 1440) % 60).padStart(2, '0')}`
  const minutesUntilNext = (now = new Date()) => {
    const m = minutesInTimeZone(now, 'Asia/Shanghai')
    for (const t of CN_TARGETS) if (t > m) return t - m
    return (24 * 60 - m) + CN_TARGETS[0] // 跨到明天盘前
  }

  const runAndArm = async () => {
    console.log(`\n[${fmtTime()}] 跑批开始（收信息 → 选时 → 选股 → 下单）`)
    let rec = null
    try { rec = await runCycle() } catch (e) { console.error(`[${fmtTime()}] 运行异常: ${e?.message}`) }
    if (rec) printResult(rec)
    const d = minutesUntilNext()
    const nextClock = fmtClock(minutesInTimeZone(new Date(), 'Asia/Shanghai') + d)
    const until = d >= 60 ? `${Math.floor(d / 60)} 小时 ${d % 60} 分` : `${d} 分钟`
    console.log(`  下次运行: ${nextClock}（约 ${until}后）\n`)
    setTimeout(runAndArm, d * 60000) // 不 unref：让进程常驻
  }

  await runAndArm()
}