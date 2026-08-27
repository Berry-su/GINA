/**
 * Gina 自学习交易 —— 稳健训练 + 全新测试集（样本外）评估
 *
 * 运行：node scripts/train-evaluate.mjs
 * 目的：看她学会的策略是否「真记住教训、能复用到没见过的难题」，而非只对旧题过拟合。
 * - 训练：N 集（她看不到测试集种子）
 * - 测试：冻结策略后，在「全新种子市场」上跑，统计稳健指标
 * - 对比：同一批测试难题下，旧策略(追涨杀跌) vs 学到策略 的终值
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const N = 200
const STOP = 0.15

// 旧策略（她要超越/修正的）
const baseline = { bullish: 'long', bearish: 'short', crisis: 'short', neutral: 'cash' }

function simulate(policy, returns) {
  let cash = 2000, shares = 0, price = 100
  let equity = 2000, peak = 2000, maxDD = 0, stops = 0
  for (let i = 0; i < returns.length; i++) {
    const momentum = avg(returns.slice(Math.max(0, i - 3), i))
    const regime = regimeOf(momentum)
    const action = policy[regime]

    if (action === 'long') {
      if (shares < 0) { cash += shares * price; shares = 0 }
      if (shares === 0 && cash > 0) { shares = cash / price; cash = 0 }
    } else if (action === 'short') {
      if (shares > 0) { cash += shares * price; shares = 0 }
      if (shares === 0 && cash > 0) { const n = cash / price; shares = -n; cash += n * price }
    } else if (shares !== 0) {
      cash += shares * price; shares = 0
    }

    price = Math.max(0.5, price * (1 + returns[i]))
    equity = cash + shares * price
    if (shares !== 0 && equity < peak * (1 - STOP)) { cash += shares * price; shares = 0; equity = cash; stops++ }
    if (equity < 0.01) { equity = 0; cash = 0; shares = 0 }
    if (equity > peak) peak = equity
    if (peak > 0) maxDD = Math.max(maxDD, (peak - equity) / peak)
  }
  return { equity: cash + shares * price, maxDD, stops }
}

const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }
const pnl = (p) => (p >= 0 ? '+' : '') + (p * 100).toFixed(0) + '%'

const TRAIN_N = 50
const TEST_N = 50
const TRAIN_SEED = 1_000_000
const TEST_SEED = 7_000_000 // 测试集种子从远离训练集处起

// 学习记忆（累计净盈亏）
const net = Object.fromEntries(REGIMES.map((r) => [r, Object.fromEntries(ACTIONS.map((a) => [a, 0]))]))
net.bullish.long = 0.5; net.bearish.short = 0.5; net.crisis.short = 0.5; net.neutral.cash = 0.5

// ── 训练（bandit + 5% 探索，累计净盈亏） ──
for (let ep = 0; ep < TRAIN_N; ep++) {
  const returns = genReturns(N, TRAIN_SEED + ep * 10007)
  let s2 = (TRAIN_SEED + ep * 10007) >>> 0
  const rand = () => { s2 = (1664525 * s2 + 1013904223) >>> 0; return s2 / 4294967296 }
  let cash = 2000, shares = 0, price = 100
  for (let i = 0; i < N; i++) {
    const momentum = avg(returns.slice(Math.max(0, i - 3), i))
    const regime = regimeOf(momentum)
    const action = rand() < 0.05 ? ACTIONS[Math.floor(rand() * 3)] : ACTIONS.reduce((b, a) => (net[regime][a] > net[regime][b] ? a : b), 'cash')
    const prev = cash + shares * price
    if (action === 'long') { if (shares < 0) { cash += shares * price; shares = 0 } if (shares === 0 && cash > 0) { shares = cash / price; cash = 0 } }
    else if (action === 'short') { if (shares > 0) { cash += shares * price; shares = 0 } if (shares === 0 && cash > 0) { const n = cash / price; shares = -n; cash += n * price } }
    else if (shares !== 0) { cash += shares * price; shares = 0 }
    price = Math.max(0.5, price * (1 + returns[i]))
    const now = cash + shares * price
    net[regime][action] += now - prev
  }
}
const learned = Object.fromEntries(REGIMES.map((r) => [r, ACTIONS.reduce((b, a) => (net[r][a] > net[r][b] ? a : b), 'cash')]))

// ── 测试（冻结策略，跑全新种子） ──
const res = (policy) => {
  const eq = [], dd = [], stopSum = []
  for (let i = 0; i < TEST_N; i++) {
    const r = simulate(policy, genReturns(N, TEST_SEED + i * 10007))
    eq.push(r.equity); dd.push(r.maxDD); stopSum.push(r.stops)
  }
  const sorted = [...eq].sort((a, b) => a - b)
  const median = (sorted[Math.floor(sorted.length / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2
  return {
    median,
    mean: eq.reduce((s, x) => s + x, 0) / eq.length,
    min: Math.min(...eq), max: Math.max(...eq),
    winRate: eq.filter((x) => x > 2000).length / TEST_N,
    tenXRate: eq.filter((x) => x >= 20000).length / TEST_N,
    avgDrawdown: dd.reduce((s, x) => s + x, 0) / dd.length,
    eq, dd,
  }
}

const Rbase = res(baseline)
const Rlearn = res(learned)

console.log('='.repeat(100))
console.log(`  Gina 自学习交易 · 稳健评估（训练 ${TRAIN_N} 集 → 全新测试 ${TEST_N} 集）`)
console.log('='.repeat(100))
console.log(`  旧策略（追涨杀跌）: ${Object.entries(baseline).map(([r, a]) => `${r}→${a}`).join(' ')}`)
console.log(`  学到策略          : ${Object.entries(learned).map(([r, a]) => `${r}→${a.toUpperCase()}`).join(' ')}`)
console.log('')
console.log(`  指标（${TEST_N} 个全新市场，样本外）`)
const pad = (s, w) => String(s).padStart(w)
const lbl = (s, w) => String(s).padEnd(w)
console.log(`  ${lbl('', 12)}${pad('旧策略', 14)}${pad('学到策略', 14)}`)
console.log(`  ${lbl('中位数终值', 12)}${pad(round(Rbase.median), 14)}${pad(round(Rlearn.median), 14)}`)
console.log(`  ${lbl('平均终值', 12)}${pad(round(Rbase.mean), 14)}${pad(round(Rlearn.mean), 14)}`)
console.log(`  ${lbl('最差终值', 12)}${pad(round(Rbase.min), 14)}${pad(round(Rlearn.min), 14)}`)
console.log(`  ${lbl('最好终值', 12)}${pad(round(Rbase.max), 14)}${pad(round(Rlearn.max), 14)}`)
console.log(`  ${lbl('正收益占比', 12)}${pad((Rbase.winRate * 100).toFixed(0) + '%', 14)}${pad((Rlearn.winRate * 100).toFixed(0) + '%', 14)}`)
console.log(`  ${lbl('10倍命中率', 12)}${pad((Rbase.tenXRate * 100).toFixed(0) + '%', 14)}${pad((Rlearn.tenXRate * 100).toFixed(0) + '%', 14)}`)
console.log(`  ${lbl('平均最大回撤', 12)}${pad((Rbase.avgDrawdown * 100).toFixed(1) + '%', 14)}${pad((Rlearn.avgDrawdown * 100).toFixed(1) + '%', 14)}`)
console.log('')
console.log('  ── 逐题对照（同一批全新难题，旧策略 vs 学到策略 终值） ──')
for (let i = 0; i < TEST_N; i++) {
  const a = Rbase.eq[i], b = Rlearn.eq[i]
  const mark = b > a ? '↑胜' : b < a ? '↓败' : '＝'
  console.log(`  题${String(i + 1).padStart(2)} | 旧 ${String(round(a)).padStart(9)} | 学 ${String(round(b)).padStart(9)} ${mark}`)
}
console.log('='.repeat(100))