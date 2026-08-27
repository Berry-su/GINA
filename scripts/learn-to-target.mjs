/**
 * Gina 自学习交易 —— 通过「反思 → 调整策略 → 再实战」迭代逼近 10 倍目标
 *
 * 运行：node scripts/learn-to-target.mjs
 * - 本金 2000，目标 10 倍（20000）
 * - 学习对象：策略 policy = 市场状态(regime) → 动作(long/short/cash)
 * - 每集 200 场（每集独立生成市场，避免过拟合），结束后按「各状态实际盈亏」更新策略
 * - 每集失败即 recordReflection 让 Gina 沉淀教训
 * - regime 由动量推导，与分析师团队给出的「看多/看空/危机」诊断一一对应
 *
 * 初始策略 = 追涨杀跌（看多→做多、看空/危机→做空），正是前几次验证亏损的方向；
 * 学习机制 = 多臂老虎机式「按历史净盈亏选动作」+ 5% 探索。
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
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
function regimeOf(momentum) {
  if (momentum < -0.10) return 'crisis'
  if (momentum < -0.04) return 'bearish'
  if (momentum > 0.06) return 'bullish'
  return 'neutral'
}

// 学习状态：各状态×动作 的累计净盈亏
const net = Object.fromEntries(REGIMES.map((r) => [r, Object.fromEntries(ACTIONS.map((a) => [a, 0]))]))
// 初始先验 = 追涨杀跌（给一点偏向，让策略从旧方向起步）
net.bullish.long = 0.5; net.bearish.short = 0.5; net.crisis.short = 0.5; net.neutral.cash = 0.5

function chooseAction(regime, rand) {
  const scores = net[regime]
  // 5% 探索
  if (rand() < 0.05) return ACTIONS[Math.floor(rand() * ACTIONS.length)]
  return ACTIONS.reduce((best, a) => (scores[a] > scores[best] ? a : best), 'cash')
}

function applyPosition(action, state, price) {
  const st = state
  if (action === 'long') {
    if (st.shares < 0) { st.cash += st.shares * price; st.shares = 0 }
    if (st.shares === 0 && st.cash > 0) { st.shares = st.cash / price; st.cash = 0 }
  } else if (action === 'short') {
    if (st.shares > 0) { st.cash += st.shares * price; st.shares = 0 }
    if (st.shares === 0 && st.cash > 0) { const n = st.cash / price; st.shares = -n; st.cash += n * price }
  } else { // cash 平仓
    if (st.shares !== 0) { st.cash += st.shares * price; st.shares = 0 }
  }
}

const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(0) + '%'

const INITIAL = 2000
const TARGET = 20000
const MAX_EPISODES = 30
let bestEquity = 0
let bestEpisode = 0
let bestPolicy = null
let targetEpisode = null

console.log('='.repeat(100))
console.log('  Gina 自学习交易 · 200 场/集 · 本金 2000 · 目标 10 倍（通过反思迭代逼近）')
console.log('='.repeat(100))
console.log('  初始策略(先验): ' + Object.entries(net).map(([r, m]) => `${r}→${ACTIONS.reduce((b, a) => (m[a] > m[b] ? a : b), 'cash').toUpperCase()}`).join('  '))

for (let ep = 0; ep < MAX_EPISODES; ep++) {
  const returns = genReturns(200, 20260820 + ep * 10007)
  let s2 = (20260820 + ep * 10007) >>> 0
  const rand = () => { s2 = (1664525 * s2 + 1013904223) >>> 0; return s2 / 4294967296 }

  const state = { cash: INITIAL, shares: 0 }
  let price = 100
  const roundPnl = Object.fromEntries(REGIMES.map((r) => [r, 0]))

  for (let i = 0; i < returns.length; i++) {
    const lookback = returns.slice(Math.max(0, i - 3), i)
    const momentum = lookback.length ? lookback.reduce((s, x) => s + x, 0) / lookback.length : 0
    const regime = regimeOf(momentum)
    const action = chooseAction(regime, rand)

    const prevEquity = state.cash + state.shares * price
    applyPosition(action, state, price)
    const ret = returns[i]
    price = Math.max(0.5, price * (1 + ret))
    let equity = state.cash + state.shares * price
    if (equity < 0.01) { equity = 0; state.cash = 0; state.shares = 0 }

    // 第 i 场发生盈亏归属到「当前 regime × 动作」
    const delta = equity - prevEquity
    net[regime][action] += delta
    roundPnl[regime] += delta
  }

  const finalEquity = state.cash + state.shares * price
  const curPolicy = Object.fromEntries(REGIMES.map((r) => [r, ACTIONS.reduce((b, a) => (net[r][a] > net[r][b] ? a : b), 'cash')]))

  if (finalEquity > bestEquity) {
    bestEquity = finalEquity; bestEpisode = ep + 1; bestPolicy = { ...curPolicy }
  }
  if (finalEquity >= TARGET && targetEpisode == null) targetEpisode = ep + 1

  await recordReflection({
    outcome: finalEquity >= INITIAL ? 'success' : 'failure',
    note: `学习第${ep + 1}集：策略=${Object.entries(curPolicy).map(([r, a]) => `${r}${a}`).join(',')} 终值=${round(finalEquity)}`,
    metrics: { episode: ep + 1, finalEquity, return: finalEquity / INITIAL - 1 },
    source: 'trading-learning',
  })

  console.log(`第 ${String(ep + 1).padStart(2)} 集 | 终值 ${String(round(finalEquity)).padStart(9)} (${pnl(finalEquity / INITIAL - 1)}) | 策略 [${Object.entries(curPolicy).map(([r, a]) => `${r}→${a}`).join(' ')}]${finalEquity >= TARGET ? '  ★达标' : ''}`)
}

console.log('\n' + '='.repeat(100))
console.log('  学习结果汇总')
console.log('='.repeat(100))
console.log(`  迭代集数: ${MAX_EPISODES}  最佳集: 第 ${bestEpisode} 集  最佳终值: ${round(bestEquity)}（${pnl(bestEquity / INITIAL - 1)}）`)
console.log(`  学到的最佳策略: ${Object.entries(bestPolicy ?? {}).map(([r, a]) => `${r}→${a.toUpperCase()}`).join('  ')}`)
console.log(`  10 倍目标(20000): ${targetEpisode ? '✅ 达成于第 ' + targetEpisode + ' 集' : '❌ 未达成'}`)
console.log('='.repeat(100))