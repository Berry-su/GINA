/**
 * Gina 混合环境实战 —— 200 场极端危机 + 中间 100 场「当前 A 股」平缓环境
 *
 * 运行：node scripts/mixed-market-sim.mjs
 * - 阶段 1：100 场 近30年大事件极端环境（肥尾崩盘/黑天鹅/流动性危机）
 * - 阶段 2：100 场 当前 A 股环境（低波动 ±2.5%、政策市偶发 ±4~7%、轻微向上漂移、±10% 涨跌停）
 * - 阶段 3：100 场 再次回到极端环境
 * - 决策：全程由分析师团队 + 知识顾问 + 风控官（Integrator）出，她亲自动脑子，不代写策略
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
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

function makeRng(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296 } }

// 极端/危机环境返回（肥尾崩盘 + 反弹大涨 + 均值回归噪声）
function genCrisis(n, rng) {
  const rets = []
  for (let i = 0; i < n; i++) {
    const r = rng()
    if (r < 0.06) rets.push(moveFor(classify(events[i % events.length])))
    else if (r < 0.14) rets.push(0.08 + rng() * 0.18)
    else rets.push((rng() - 0.5) * 0.16)
  }
  return rets
}

// 当前 A 股环境返回（低波动 + 政策偶发 + 轻微向上 + 涨跌停 ±10%）
function genAStock(n, rng) {
  const rets = []
  for (let i = 0; i < n; i++) {
    const r = rng()
    let ret
    if (r < 0.10) ret = (rng() < 0.5 ? 1 : -1) * (0.04 + rng() * 0.03)  // 政策/事件 ±4~7%
    else ret = (rng() - 0.5) * 0.05 + 0.001                               // 噪声 ±2.5% + 0.1% 漂移
    ret = Math.max(-0.10, Math.min(0.10, ret))                            // 涨跌停
    rets.push(ret)
  }
  return rets
}

const SEG = 100
const rng = makeRng(20260821)
const rets = [
  ...genCrisis(SEG, rng),   // 阶段1 极端
  ...genAStock(SEG, rng),   // 阶段2 A股（中间混入）
  ...genCrisis(SEG, rng),   // 阶段3 极端
]
const segOf = (i) => (i < SEG ? 1 : i < SEG * 2 ? 2 : 3)
const segName = (s) => (s === 1 ? '极端环境①' : s === 2 ? '当前A股' : '极端环境②')

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

const brain = createSharedBrain()
const team = createAnalystTeam(brain)
const integrator = new Integrator({ team })

const INITIAL = 2000
let cash = INITIAL, shares = 0, price = 100
const segStart = [INITIAL, INITIAL, INITIAL] // 记录各阶段起点权益（下标 0/1/2 对应段1/2/3）
const segEnd = [0, 0, 0]
const dist = { buy: 0, sell: 0, hold: 0, reduce: 0, halt: 0 }
let prevSeg = 1

console.log('='.repeat(96))
console.log('  Gina 混合环境实战 · 300 场 · 200 极端危机 + 中间 100 当前A股 · 本金 2000')
console.log('='.repeat(96))

for (let i = 0; i < rets.length; i++) {
  const seg = segOf(i)
  if (seg !== prevSeg) { segEnd[prevSeg - 1] = cash + shares * price; segStart[seg - 1] = cash + shares * price; prevSeg = seg; console.log(`\n========== 进入 ${segName(seg)} ==========`) }

  const momentum = avg(rets.slice(Math.max(0, i - 3), i))
  const scene = regimeOf(momentum)
  const market = seg === 2 ? 'CN' : (events[i % events.length]?.region === '中国A股' ? 'CN' : 'US')
  const snap = createMockSnapshot({ symbol: 'SIM', name: `${segName(seg)} 第${i + 1}场`, market, scenario: mockScenario(scene) })
  const rec = integrator.integrate(snap)
  dist[rec.action] = (dist[rec.action] ?? 0) + 1

  // 执行：尊重整合建议（含风控官否决）
  let exec = shares > 0 ? '持多' : '空仓'
  if (rec.action === 'buy' && shares === 0 && cash > 0) { shares = cash / price; cash = 0; exec = '买入' }
  else if (rec.action === 'sell' && shares > 0) { cash += shares * price; shares = 0; exec = '卖出' }
  else if (rec.action === 'halt' && shares > 0) { cash += shares * price; shares = 0; exec = '暂停清仓' }
  else if (rec.action === 'reduce' && shares > 0) { const h = shares / 2; cash += h * price; shares -= h; exec = '减半' }

  const ret = rets[i]
  price = Math.max(0.5, price * (1 + ret))
  const equity = cash + shares * price

  console.log(`\n── ${String(i + 1).padStart(3)} 「${segName(seg)}」 动量${(momentum * 100).toFixed(1)}% 场景${scene} 本轮${pnl(ret)}`)
  for (const o of rec.opinions) {
    const tag = o.meta?.isRisk ? '🛡️风控官' : '  ' + o.role
    const v = o.view === 'bullish' ? '看多' : o.view === 'bearish' ? '看空' : '观望'
    console.log(`    ${tag}: ${v} — ${(o.reasons?.[0] ?? '').slice(0, 40)}${o.meta?.veto ? ' [否决]' : o.meta?.halt ? ' [暂停]' : ''}`)
  }
  console.log(`    → 决策: ${rec.label}(${rec.action}) | ${exec} | 价${round(price)} 权益${round(equity)} (${pnl(ret)})`)
}

segEnd[2] = cash + shares * price
const finalEquity = cash + shares * price

console.log('\n' + '='.repeat(96))
console.log('  300 场混合环境实战总结')
console.log('='.repeat(96))
console.log(`  阶段1 极端环境① : ${round(segStart[0])} → ${round(segEnd[0])}（${pnl(segEnd[0] / segStart[0] - 1)}）`)
console.log(`  阶段2 当前A股   : ${round(segStart[1])} → ${round(segEnd[1])}（${pnl(segEnd[1] / segStart[1] - 1)}）`)
console.log(`  阶段3 极端环境② : ${round(segStart[2])} → ${round(segEnd[2])}（${pnl(segEnd[2] / segStart[2] - 1)}）`)
console.log(`  总终值: ${INITIAL} → ${round(finalEquity)}（${pnl(finalEquity / INITIAL - 1)}）`)
console.log(`  决策分布: ${Object.entries(dist).map(([k, v]) => `${k}=${v}`).join(' ')}`)
console.log('='.repeat(96))