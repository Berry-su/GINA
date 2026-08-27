/**
 * Gina 长期滚动训练 —— 持续换新市场练习 + 定期样本外考核，看是否持续进步
 *
 * 运行：node scripts/rolling-learn.mjs
 * - 500 集滚动训练（每集都是没见过的市场）
 * - 长期记忆 = 各状态×动作的累计净盈亏 + 计数（跨集累积，不遗忘）
 * - 探索率随训练递减（先探索后收敛）
 * - 每 50 集冻结策略，放到固定 100 个全新市场考核，输出成长曲线
 * - 15% 移动止损（对应 stop_loss 知识）
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
const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }
const N = 200
const STOP = 0.15

// 长期记忆：累计净盈亏 + 计数（先验轻偏 cash）
const sum = Object.fromEntries(REGIMES.map((r) => [r, Object.fromEntries(ACTIONS.map((a) => [a, 0]))]))
const cnt = Object.fromEntries(REGIMES.map((r) => [r, Object.fromEntries(ACTIONS.map((a) => [a, 0]))]))
for (const r of REGIMES) { sum[r].cash = 0.1; cnt[r].cash = 1 }

function greedyPolicy() {
  return Object.fromEntries(REGIMES.map((r) => {
    let best = 'cash'
    for (const a of ACTIONS) {
      const va = cnt[r][a] > 0 ? sum[r][a] / cnt[r][a] : -Infinity
      const vb = cnt[r][best] > 0 ? sum[r][best] / cnt[r][best] : -Infinity
      if (va > vb) best = a
    }
    return [r, best]
  }))
}

// 执行一轮（可选更新记忆）
function stepPolicy(state, action) {
  const s = state
  if (action === 'long') { if (s.shares < 0) { s.cash += s.shares * s.price; s.shares = 0 } if (s.shares === 0 && s.cash > 0) { s.shares = s.cash / s.price; s.cash = 0 } }
  else if (action === 'short') { if (s.shares > 0) { s.cash += s.shares * s.price; s.shares = 0 } if (s.shares === 0 && s.cash > 0) { const n = s.cash / s.price; s.shares = -n; s.cash += n * s.price } }
  else if (s.shares !== 0) { s.cash += s.shares * s.price; s.shares = 0 }
}

// 用冻结策略模拟一个市场，返回终值 + 最大回撤
function simulatePolicy(policy, returns) {
  const st = { cash: 2000, shares: 0, price: 100 }
  let equity = 2000, peak = 2000, maxDD = 0
  for (let i = 0; i < N; i++) {
    const regime = regimeOf(avg(returns.slice(Math.max(0, i - 3), i)))
    stepPolicy(st, policy[regime])
    st.price = Math.max(0.5, st.price * (1 + returns[i]))
    equity = st.cash + st.shares * st.price
    if (st.shares !== 0 && equity < peak * (1 - STOP)) { st.cash += st.shares * st.price; st.shares = 0; equity = st.cash }
    if (equity < 0.01) { equity = 0; st.cash = 0; st.shares = 0 }
    if (equity > peak) peak = equity
    if (peak > 0) maxDD = Math.max(maxDD, (peak - equity) / peak)
  }
  return { equity: st.cash + st.shares * st.price, maxDD }
}

// 固定考核集（100 个全新市场，永不用于训练）
const EVAL_N = 100
const EVAL_SEED = 60_000_000
const evalMarkets = Array.from({ length: EVAL_N }, (_, i) => genReturns(N, EVAL_SEED + i * 10007))

function evaluate(policy) {
  const eq = [], dd = []
  for (const m of evalMarkets) { const r = simulatePolicy(policy, m); eq.push(r.equity); dd.push(r.maxDD) }
  const sorted = [...eq].sort((a, b) => a - b)
  const median = (sorted[Math.floor(sorted.length / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2
  return {
    median, worst: Math.min(...eq), best: Math.max(...eq),
    winRate: eq.filter((x) => x > 2000).length / eq.length,
    tenXRate: eq.filter((x) => x >= 20000).length / eq.length,
    avgDrawdown: dd.reduce((s, x) => s + x, 0) / dd.length,
  }
}

const TRAIN_N = 500
const TRAIN_SEED = 1_000_000

console.log('='.repeat(100))
console.log(`  Gina 长期滚动训练 · ${TRAIN_N} 集随机新市场 · 每 50 集样本外考核（${EVAL_N} 题）`)
console.log('='.repeat(100))
console.log(`  集数    中位数    最坏     最好     正收益  10倍率  平均回撤  策略`)

for (let ep = 0; ep < TRAIN_N; ep++) {
  const epsilon = 0.10 * (1 - ep / TRAIN_N) + 0.02
  const returns = genReturns(N, TRAIN_SEED + ep * 10007)
  let s2 = (TRAIN_SEED + ep * 10007) >>> 0
  const rand = () => { s2 = (1664525 * s2 + 1013904223) >>> 0; return s2 / 4294967296 }

  const st = { cash: 2000, shares: 0, price: 100 }
  let peak = 2000
  for (let i = 0; i < N; i++) {
    const regime = regimeOf(avg(returns.slice(Math.max(0, i - 3), i)))
    const action = rand() < epsilon
      ? ACTIONS[Math.floor(rand() * 3)]
      : greedyPolicy()[regime]
    const prev = st.cash + st.shares * st.price
    stepPolicy(st, action)
    st.price = Math.max(0.5, st.price * (1 + returns[i]))
    let equity = st.cash + st.shares * st.price
    if (st.shares !== 0 && equity < peak * (1 - STOP)) { st.cash += st.shares * st.price; st.shares = 0; equity = st.cash }
    if (equity < 0.01) { equity = 0; st.cash = 0; st.shares = 0 }
    if (equity > peak) peak = equity
    sum[regime][action] += equity - prev
    cnt[regime][action] += 1
  }

  if ((ep + 1) % 50 === 0) {
    const pol = greedyPolicy()
    const m = evaluate(pol)
    const polStr = Object.entries(pol).map(([r, a]) => `${r}${a[0]}`).join('/')
    console.log(`  ${String(ep + 1).padStart(5)}  ${String(round(m.median)).padStart(8)}  ${String(round(m.worst)).padStart(7)}  ${String(round(m.best)).padStart(7)}  ${(m.winRate * 100).toFixed(0).padStart(5)}%  ${(m.tenXRate * 100).toFixed(0).padStart(4)}%  ${(m.avgDrawdown * 100).toFixed(1).padStart(7)}%  ${polStr}`)
  }
}

console.log('\n' + '='.repeat(100))
console.log('  最终学到策略:', Object.entries(greedyPolicy()).map(([r, a]) => `${r}→${a.toUpperCase()}`).join('  '))
console.log('='.repeat(100))