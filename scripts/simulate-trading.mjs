/**
 * Gina 模拟实战交易 —— 激进短线模式（200 场 · 无未来泄漏 · 支持做空）
 *
 * 运行：node scripts/simulate-trading.mjs
 * - 本金 2000，目标 10 倍（20000）
 * - 每场打印 5 分析师 + 风控官完整讨论 + 激进决策 + 执行
 * - 激进：以 5 位分析师多空共识为准，忽略风控官暂停
 *   · 看多≥3 → 全仓做多；看空≥3 → 全仓做空（卖空）；否则持有
 * - 每场权益回撤即 recordReflection 让 Gina 反思
 *
 * 无未来泄漏：第 i 场快照只由「已发生 returns[0..i-1]」动量推导；真实涨跌在决策后生效。
 * 做空模型：shares<0 为空头，卖空所得计入现金作担保，无杠杆 1x；权益≤0 视为爆仓清零。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createSharedBrain, createAnalystTeam, Integrator, createMockSnapshot } from '../src/analysts/index.js'
import { recordReflection } from '../src/memory/reflection-executor.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'seed-data', 'market-crises.json'), 'utf8'))
const events = [...(data.cases ?? [])].sort((a, b) => a.year - b.year || String(a.id).localeCompare(b.id))

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
function moveFor(s) {
  switch (s) {
    case 'crisis_hard': return -0.45
    case 'crisis': return -0.30
    case 'bearish': return -0.20
    case 'bullish': return 0.30
    default: return 0
  }
}

let seed = 20260820
function rand() { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296 }

const TOTAL = 200
const returns = []
for (let i = 0; i < TOTAL; i++) {
  const r = rand()
  if (r < 0.06) returns.push(moveFor(classify(events[i % events.length])))
  else if (r < 0.14) returns.push(0.08 + rand() * 0.18)
  else returns.push((rand() - 0.5) * 0.16)
}

const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(0) + '%'

const brain = createSharedBrain()
const team = createAnalystTeam(brain)
const integrator = new Integrator({ team })

const INITIAL = 2000
const TARGET = 20000
let cash = INITIAL
let shares = 0 // 正=多头，负=空头
let price = 100
let peak = INITIAL
let maxDrawdown = 0
let wins = 0
let losses = 0
let reflections = 0
let targetHitRound = null
let blownUp = false

console.log('='.repeat(100))
console.log('  Gina 模拟实战交易 · 激进短线(含做空) · 200 场 · 本金 2000 · 目标 10 倍（无未来泄漏）')
console.log('='.repeat(100))

for (let i = 0; i < TOTAL; i++) {
  const lookback = returns.slice(Math.max(0, i - 3), i)
  const momentum = lookback.length ? lookback.reduce((s, x) => s + x, 0) / lookback.length : 0
  const scene = momentum < -0.10 ? 'crisis' : momentum < -0.04 ? 'bearish' : momentum > 0.06 ? 'bullish' : 'neutral'
  const snap = createMockSnapshot({ symbol: 'SIM', name: `第${i + 1}场`, market: 'US', scenario: scene })
  const rec = integrator.integrate(snap)

  const action = rec.bullish >= 3 ? 'buy' : rec.bearish >= 3 ? 'sell' : 'hold'

  const prevEquity = cash + shares * price
  let exec = shares > 0 ? '持多不动' : shares < 0 ? '持空不动' : '空仓'
  if (action === 'buy') {
    if (shares < 0) { cash += shares * price; shares = 0 }          // 平空
    if (shares === 0 && cash > 0) { shares = cash / price; cash = 0; exec = '全仓做多' }
  } else if (action === 'sell') {
    if (shares > 0) { cash += shares * price; shares = 0 }          // 平多
    if (shares === 0 && cash > 0) { const n = cash / price; shares = -n; cash += n * price; exec = '全仓做空' }
  }

  const ret = returns[i]
  price = Math.max(0.5, price * (1 + ret))
  let equity = cash + shares * price
  if (equity < 0.01) { equity = 0; cash = 0; shares = 0; blownUp = true; exec = '爆仓' }

  peak = Math.max(peak, equity)
  if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak)
  if (equity >= prevEquity) wins++; else losses++
  if (equity >= TARGET && targetHitRound == null) targetHitRound = i + 1

  console.log(`\n──── 第 ${String(i + 1).padStart(3)} 场 ──── 动量 ${(momentum * 100).toFixed(1)}% → 场景「${scene}」| 本轮 ${pnl(ret)}`)
  for (const o of rec.opinions) {
    const tag = o.meta?.isRisk ? '🛡️风控官' : '  ' + o.role
    const v = o.view === 'bullish' ? '看多' : o.view === 'bearish' ? '看空' : '观望'
    const flag = o.meta?.veto ? ' [一票否决]' : o.meta?.halt ? ' [暂停]' : ''
    console.log(`    ${tag}: ${v} — ${(o.reasons?.[0] ?? '').slice(0, 42)}${flag}`)
  }
  console.log(`    → 激进决策: ${action === 'buy' ? '做多' : action === 'sell' ? '做空' : '观望'}（看多${rec.bullish}/看空${rec.bearish}/观望${5 - rec.bullish - rec.bearish}）| ${exec} | 价 ${round(price)} 权益 ${round(equity)} (${pnl((equity - prevEquity) / Math.max(1, prevEquity))})`)

  if (equity < prevEquity) {
    try {
      await recordReflection({
        outcome: 'failure',
        note: `模拟第${i + 1}场：动量${(momentum * 100).toFixed(1)}%判断「${scene}」，权益回撤 ${round(prevEquity)}→${round(equity)}`,
        metrics: { equity, drawdown: (prevEquity - equity) / Math.max(1, prevEquity) },
        source: 'simulation',
      })
      reflections++
      console.log(`    🧠 [反思] 记录失败经验：${round(prevEquity)} → ${round(equity)}`)
    } catch { /* 忽略写库失败 */ }
  }
}

const finalEquity = cash + shares * price
console.log('\n' + '='.repeat(100))
console.log('  200 场模拟总结（含做空）')
console.log('='.repeat(100))
console.log(`  本金: ${INITIAL}  终值: ${round(finalEquity)}（${pnl((finalEquity / INITIAL - 1))}）`)
console.log(`  峰值: ${round(peak)}  最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`)
console.log(`  胜场: ${wins}  负场: ${losses}  反思次数: ${reflections}  爆仓: ${blownUp ? '是' : '否'}`)
console.log(`  10 倍目标(20000): ${targetHitRound ? '✅ 达成于第 ' + targetHitRound + ' 场' : '❌ 未达成'}`)
console.log('='.repeat(100))