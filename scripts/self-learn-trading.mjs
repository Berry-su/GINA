/**
 * Gina 自学习交易闭环 v2 —— 学会止损 + 择时 + 大量练习逼近 10 倍
 *
 * 运行：node scripts/self-learn-trading.mjs
 * - 本金 2000，目标 10 倍（20000）
 * - 决策方向：市场状态(regime) → 动作(long/short/cash)，由「按历史净盈亏」的自主学习决定
 * - 风控：自带 15% 移动止损（对应植入知识里的 stop_loss / 危机风控），防爆仓
 * - 大量练习：100 集 × 200 场，每集独立市场（避免过拟合），结束后给总结
 *
 * 说明：此处的「学习记忆」= 各状态×动作的累计净盈亏（随练习更新）；不调用 recordReflection，
 * 以免把通用「error-recovery/tool-usage」技能刷进仓库——失败经验直接写进策略表。
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

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

function genReturns(n, seed) {
  let s = seed >>> 0
  const rand = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296 }
  const rets = []
  for (let i = 0; i < n; i++) {
    const r = rand()
    if (r < 0.06) rets.push(moveFor(classify(events[i % events.length])))
    else if (r < 0.14) rets.push(0.08 + rand() * 0.18)
    else rets.push((rand() - 0.5) * 0.16)
  }
  return rets
}

const REGIMES = ['bullish', 'bearish', 'crisis', 'neutral']
const ACTIONS = ['long', 'short', 'cash']
function regimeOf(m) {
  if (m < -0.10) return 'crisis'
  if (m < -0.04) return 'bearish'
  if (m > 0.06) return 'bullish'
  return 'neutral'
}

// 学习记忆：各状态×动作 累计净盈亏
const net = Object.fromEntries(REGIMES.map((r) => [r, Object.fromEntries(ACTIONS.map((a) => [a, 0]))]))
// 先验 = 追涨杀跌
net.bullish.long = 0.5; net.bearish.short = 0.5; net.crisis.short = 0.5; net.neutral.cash = 0.5

function pickAction(regime, rand) {
  if (rand() < 0.05) return ACTIONS[Math.floor(rand() * ACTIONS.length)]
  let best = 'cash'
  for (const a of ACTIONS) if (net[regime][a] > net[regime][best]) best = a
  return best
}

const INITIAL = 2000
const TARGET = 20000
const STOP = 0.15 // 移动止损 15%
const EPISODES = 100
const N = 200

const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(0) + '%'

let best = { equity: 0, episode: 0, policy: null, stops: 0 }
let targetEpisode = null

console.log('='.repeat(100))
console.log(`  Gina 自学习交易闭环 v2 · ${EPISODES} 集 × ${N} 场 · 本金 2000 · 目标 10 倍 · 15% 移动止损`)
console.log('='.repeat(100))

for (let ep = 0; ep < EPISODES; ep++) {
  const seed = 20260820 + ep * 10007
  const returns = genReturns(N, seed)
  let s2 = seed >>> 0
  const rand = () => { s2 = (1664525 * s2 + 1013904223) >>> 0; return s2 / 4294967296 }

  let cash = INITIAL, shares = 0, price = 100
  let epPeak = INITIAL
  let stops = 0

  for (let i = 0; i < N; i++) {
    const lookback = returns.slice(Math.max(0, i - 3), i)
    const momentum = lookback.length ? lookback.reduce((s, x) => s + x, 0) / lookback.length : 0
    const regime = regimeOf(momentum)
    const action = pickAction(regime, rand)

    const prevEquity = cash + shares * price
    // 执行（做多/做空/现金）
    if (action === 'long') {
      if (shares < 0) { cash += shares * price; shares = 0 }
      if (shares === 0 && cash > 0) { shares = cash / price; cash = 0 }
    } else if (action === 'short') {
      if (shares > 0) { cash += shares * price; shares = 0 }
      if (shares === 0 && cash > 0) { const n = cash / price; shares = -n; cash += n * price }
    } else if (shares !== 0) {
      cash += shares * price; shares = 0
    }

    const ret = returns[i]
    price = Math.max(0.5, price * (1 + ret))
    let equity = cash + shares * price

    // 移动止损：权益跌破本集峰值 15% 即清仓（对应 stop_loss 知识）
    if (shares !== 0 && equity < epPeak * (1 - STOP)) {
      cash += shares * price; shares = 0; equity = cash; stops++
    }
    if (equity < 0.01) { equity = 0; cash = 0; shares = 0 }

    if (equity > epPeak) epPeak = equity
    const delta = equity - prevEquity
    net[regime][action] += delta
  }

  const finalEquity = cash + shares * price
  const curPolicy = Object.fromEntries(REGIMES.map((r) => [r, pickAction(r, () => 0)]))
  if (finalEquity > best.equity) {
    best = { equity: finalEquity, episode: ep + 1, policy: { ...curPolicy }, stops }
  }
  if (finalEquity >= TARGET && targetEpisode == null) targetEpisode = ep + 1

  console.log(`第 ${String(ep + 1).padStart(3)} 集 | 终值 ${String(round(finalEquity)).padStart(9)} (${pnl(finalEquity / INITIAL - 1)}) | 止损${stops}次 | [${Object.entries(curPolicy).map(([r, a]) => `${r}→${a}`).join(' ')}]${finalEquity >= TARGET ? ' ★达标' : ''}`)
}

console.log('\n' + '='.repeat(100))
console.log('  自学习闭环总结')
console.log('='.repeat(100))
console.log(`  练习集数: ${EPISODES}  最佳集: 第 ${best.episode} 集  最佳终值: ${round(best.equity)}（${pnl(best.equity / INITIAL - 1)}）`)
console.log(`  学到的最佳策略: ${Object.entries(best.policy ?? {}).map(([r, a]) => `${r}→${a.toUpperCase()}`).join('  ')}`)
console.log(`  10 倍目标(20000): ${targetEpisode ? '✅ 达成于第 ' + targetEpisode + ' 集' : '❌ 未达成'}`)
console.log('='.repeat(100))