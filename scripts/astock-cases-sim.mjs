/**
 * Gina A股真实案例实战 —— 10000 场（50 集 × 200 场，每集独立本金 2000）
 *
 * 运行：node scripts/astock-cases-sim.mjs
 *
 * 为什么按「集」跑而不是一条 10000 日连续复利曲线：
 *   - 连续复利曲线会把历史案例的极端涨幅反复复利，要么熔断到 0、要么虚高到几十万倍，都是失真；
 *   - 按集重置本金，统计「终值分布 / 胜率 / 回撤 / 回避率」，才是可信的实战战绩，也避免过拟合。
 *
 * 市场模型（尊重 A 股 ±10% 涨跌停，均值回复）：
 *   - 约 30% 时间进入「真实案例块」：14 个真实 A 股大事件轮番抽取；
 *     下跌案例 = 多日连跌 + 随后的 V 型反弹（崩盘→政策底→修复，符合 A 股真实节奏）；
 *     上涨案例（5·19 / 9·24）= 多日连涨 + 小幅回踩；
 *   - 其余为普通交易日：±2% 零均值噪声，±10% 涨跌停。
 *
 * 决策：分析师团队（5 名分析师 + 风控官一票否决）→ Integrator 整合，全程她亲自动脑子。
 * 每天把真实动量喂给风控官（change1d=动量），危机识别基于真实趋势而非静态模板。
 * 学习：亏损的集会写入反思（recordReflection），结束后沉淀一次知识分析，形成闭环。
 *
 * 输出：开场节选分析师讨论 + 每集一行 + 逐案例汇总 + 终值分布/胜率/回撤/回避率 + 反思闭环。
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createSharedBrain, createAnalystTeam, Integrator, createMockSnapshot } from '../src/analysts/index.js'
import { recordReflection, analyzeReflections } from '../src/memory/reflection-executor.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'seed-data', 'market-crises.json'), 'utf8'))
const allCases = [...(data.cases ?? [])].sort((a, b) => a.year - b.year || String(a.id).localeCompare(b.id))
const cnCases = allCases.filter((e) => e.region === '中国A股')

const CRISIS_SET = new Set(['panic', 'systemic_risk', 'liquidity_crisis', 'black_swan', 'credit_crunch', 'currency_crisis', 'debt_crisis', 'circuit_breaker'])
const BUBBLE_SET = new Set(['bubble', 'over_speculation', 'margin_trading', 'leverage', 'carry_trade'])

function classify(c) {
  const s = new Set(c.concepts ?? [])
  if (c.id === 'cn_1999_519_bull' || c.id === 'cn_2024_924_rally') return 'bullish'
  const hard = s.has('systemic_risk') || s.has('liquidity_crisis')
  if ([...CRISIS_SET].some((x) => s.has(x))) return hard ? 'crisis_hard' : 'crisis'
  if ([...BUBBLE_SET].some((x) => s.has(x))) return 'bearish'
  return 'neutral'
}

function makeRng(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296 } }

const EPISODES = 50
const N = 200
const TOTAL_FIELDS = EPISODES * N // 10000
const SEED_BASE = 20260822

// 生成一集（200 场）的真实 A 股案例 + 普通交易日收益率
function genEpisode(seed) {
  const rng = makeRng(seed)
  const returns = []
  const dayCase = []
  const pushLeg = (days, mag, name) => {
    for (let k = 0; k < days && returns.length < N; k++) {
      let r = mag === 0 ? 0 : mag * (0.7 + rng() * 0.6)
      r = Math.max(-0.10, Math.min(0.10, r))
      returns.push(r)
      dayCase.push(name)
    }
  }
  while (returns.length < N) {
    if (rng() < 0.30) {
      const c = cnCases[Math.floor(rng() * cnCases.length)]
      const cls = classify(c)
      if (cls === 'bullish') {
        pushLeg(4 + Math.floor(rng() * 2), 0.07, c.name)         // 政策牛连涨
        pushLeg(2 + Math.floor(rng() * 2), -0.03, c.name)        // 情绪过热回踩
      } else if (cls === 'neutral') {
        pushLeg(3, 0, c.name)
      } else {
        const hard = cls === 'crisis_hard' || cls === 'crisis'
        const days = hard ? 4 + Math.floor(rng() * 3) : 3 + Math.floor(rng() * 2)
        const dn = hard ? 0.08 + rng() * 0.02 : 0.05 + rng() * 0.02
        pushLeg(days, -dn, c.name)        // 崩盘/连跌
        pushLeg(days, dn * 0.7, c.name)   // V 型反弹（收回约 70%）
      }
    } else {
      const days = 3 + Math.floor(rng() * 18)
      for (let k = 0; k < days && returns.length < N; k++) {
        let r = (rng() - 0.5) * 0.04
        r = Math.max(-0.10, Math.min(0.10, r))
        returns.push(r)
        dayCase.push(null)
      }
    }
  }
  return { returns, dayCase }
}

function regimeOf(m) { if (m < -0.10) return 'crisis'; if (m < -0.04) return 'bearish'; if (m > 0.06) return 'bullish'; return 'neutral' }
function mockScenario(s) {
  if (s === 'bullish') return 'bullish'
  if (s === 'crisis') return 'crisis'
  if (s === 'bearish') return 'bearish'
  return 'neutral'
}
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(0) + '%'
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

const brain = createSharedBrain()
const team = createAnalystTeam(brain)
const integrator = new Integrator({ team })

const INITIAL = 2000
const BH_SHARES = INITIAL / 100 // 买入持有：20 股从不交易

async function run() {
  const finals = []        // 每集 Gina 终值
  const bhFinals = []      // 每集买入持有终值
  const maxDDs = []        // 每集最大回撤
  const totalDist = { buy: 0, sell: 0, hold: 0, reduce: 0, halt: 0 }
  const caseAgg = new Map()
  let avoidCount = 0, downCaseDays = 0
  let upRounds = 0, downRounds = 0
  const reflectionQueue = []

  console.log('='.repeat(96))
  console.log(`  Gina A股真实案例实战 · ${TOTAL_FIELDS} 场（${EPISODES} 集 × ${N} 场） · 每集本金 ${INITIAL} · 14 个真实 A 股大事件`)
  console.log('='.repeat(96))
  console.log(`  决策：分析师团队（5 分析师 + 风控官一票否决）→ Integrator | 每集独立复盘 | 亏损写入反思闭环\n`)

  for (let ep = 0; ep < EPISODES; ep++) {
    const { returns, dayCase } = genEpisode(SEED_BASE + ep * 10007)
    let cash = INITIAL, shares = 0, price = 100
    let peak = INITIAL, maxDD = 0
    const dist = { buy: 0, sell: 0, hold: 0, reduce: 0, halt: 0 }

    for (let i = 0; i < N; i++) {
      const momentum = avg(returns.slice(Math.max(0, i - 3), i))
      const scene = regimeOf(momentum)
      const snap = createMockSnapshot({
        symbol: 'SIM',
        name: dayCase[i] ?? `A股第${i + 1}场`,
        market: 'CN',
        scenario: mockScenario(scene),
        overrides: { change1d: momentum, technical: { trend: scene === 'bearish' || scene === 'crisis' ? 'down' : scene === 'bullish' ? 'up' : 'sideways' } },
      })
      const rec = integrator.integrate(snap)
      dist[rec.action] = (dist[rec.action] ?? 0) + 1

      let exec = shares > 0 ? '持多' : '空仓'
      if (rec.action === 'buy' && shares === 0 && cash > 0) { shares = cash / price; cash = 0; exec = '买入' }
      else if (rec.action === 'sell' && shares > 0) { cash += shares * price; shares = 0; exec = '卖出' }
      else if (rec.action === 'halt' && shares > 0) { cash += shares * price; shares = 0; exec = '暂停清仓' }
      else if (rec.action === 'reduce' && shares > 0) { const h = shares / 2; cash += h * price; shares -= h; exec = '减半' }

      const oldPrice = price
      const prevEquity = cash + shares * oldPrice
      const hadSharesBeforeUpdate = shares > 0
      const ret = returns[i]
      price = Math.max(0.5, oldPrice * (1 + ret))
      const equity = cash + shares * price

      if (equity > peak) peak = equity
      if (peak > 0) maxDD = Math.max(maxDD, (peak - equity) / peak)
      if (equity >= prevEquity + 1e-9) upRounds++; else if (equity < prevEquity - 1e-9) downRounds++

      if (dayCase[i] && ret < -0.01) {
        downCaseDays++
        if (!hadSharesBeforeUpdate) avoidCount++
      }

      // 开场节选：完整展示分析师团队运作（第 1 集前 5 场）
      if (ep === 0 && i < 5) {
        const seg = dayCase[i] ? `案例「${dayCase[i]}」` : '普通日'
        console.log(`\n── ${String(i + 1).padStart(3)} ${seg} 动量${(momentum * 100).toFixed(1)}% 场景${scene} 本轮${pnl(ret)}`)
        for (const o of rec.opinions) {
          const tag = o.meta?.isRisk ? '🛡风控官' : '  ' + o.role
          const v = o.view === 'bullish' ? '看多' : o.view === 'bearish' ? '看空' : '观望'
          console.log(`    ${tag}: ${v} — ${(o.reasons?.[0] ?? '').slice(0, 40)}${o.meta?.veto ? ' [否决]' : o.meta?.halt ? ' [暂停]' : ''}`)
        }
        console.log(`    → 决策: ${rec.label}(${rec.action}) | ${exec} | 价${round(price)} 权益${round(equity)}`)
      }
    }

    const finalEquity = cash + shares * price
    const bhEquity = BH_SHARES * price
    finals.push(finalEquity)
    bhFinals.push(bhEquity)
    maxDDs.push(maxDD)
    for (const k of Object.keys(totalDist)) totalDist[k] += dist[k]

    // 逐案例命中次数（按本集 dayCase 去重计数）
    const seen = new Set(dayCase.filter(Boolean))
    for (const name of seen) {
      const a = caseAgg.get(name) ?? { n: 0 }
      a.n++
      caseAgg.set(name, a)
    }

    // 亏损集写入反思队列
    if (finalEquity < INITIAL) {
      reflectionQueue.push({
        note: `[A股实战第${ep + 1}集] 终值 ${round(finalEquity)}（${pnl(finalEquity / INITIAL - 1)}），最大回撤 ${(maxDD * 100).toFixed(1)}%；教训：危机中仓位过重/止损不及时`,
        lossPct: (INITIAL - finalEquity) / INITIAL,
      })
    }

    console.log(`  第 ${String(ep + 1).padStart(2)} 集 | Gina ${round(finalEquity)} (${pnl(finalEquity / INITIAL - 1)}) | 持有 ${round(bhEquity)} (${pnl(bhEquity / INITIAL - 1)}) | 回撤 ${(maxDD * 100).toFixed(1)}% | [${Object.entries(dist).map(([k, v]) => `${k}=${v}`).join(' ')}]`)
  }

  const wins = finals.filter((x) => x > INITIAL).length
  const tenX = finals.filter((x) => x >= INITIAL * 10).length
  const avgDD = avg(maxDDs)
  const avoidRate = downCaseDays ? (avoidCount / downCaseDays) : 0

  console.log('\n' + '='.repeat(96))
  console.log('  A股真实案例实战总结（10000 场 · 50 集）')
  console.log('='.repeat(96))
  console.log(`  Gina 终值:  最好 ${round(Math.max(...finals))}   中位 ${round(median(finals))}   最差 ${round(Math.min(...finals))}`)
  console.log(`  买入持有:    最好 ${round(Math.max(...bhFinals))}   中位 ${round(median(bhFinals))}   最差 ${round(Math.min(...bhFinals))}`)
  console.log(`  胜率(终值>2000): ${wins}/${EPISODES}（${(wins / EPISODES * 100).toFixed(0)}%）   10 倍命中: ${tenX}/${EPISODES}`)
  console.log(`  平均最大回撤: ${(avgDD * 100).toFixed(1)}%`)
  console.log(`  下跌案例回避率: ${(avoidRate * 100).toFixed(1)}%`)
  console.log(`  上涨场 ${upRounds} / 下跌场 ${downRounds}`)
  console.log(`  决策分布(合计): ${Object.entries(totalDist).map(([k, v]) => `${k}=${v}`).join(' ')}`)

  console.log('\n  ── 14 个真实 A 股大事件 · 命中集数 ──')
  for (const c of cnCases) {
    const a = caseAgg.get(c.name)
    console.log(`    ${c.year} ${c.name.padEnd(22)} ${a ? String(a.n).padStart(3) + ' 集' : '未触发'}`)
  }

  // 反思闭环：取损失最大的几集写入记忆
  reflectionQueue.sort((x, y) => y.lossPct - x.lossPct)
  let reflections = 0
  for (const r of reflectionQueue.slice(0, 10)) {
    try {
      await recordReflection({ outcome: 'failure', note: r.note, metrics: { learning: 1, efficiency: 0.5 }, source: 'astock-sim' })
      reflections++
    } catch (e) {
      console.warn('[reflection] 写入失败:', e?.message)
    }
  }
  console.log(`\n  反思写入: ${reflections} 条（取亏损最大集，失败经验进入记忆闭环）`)

  const analysis = await analyzeReflections(10).catch(() => null)
  console.log('='.repeat(96))
  return { analysis }
}

run().catch((e) => { console.error(e); process.exit(1) })