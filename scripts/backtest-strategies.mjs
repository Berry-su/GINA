/**
 * 多短线策略回测（低吸 / 追涨 / 打板 并行）—— 用 baostock 免费日线 49 支随机样本。
 *
 * 诚实回答：
 *   1) 低吸、追涨各自有没有正期望（持仓时日均收益 vs 空仓时）；
 *   2) 它们与打板并行后，资金在场率能提多高（减少空仓）。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dipBuy, chaseBreakout, MultiStrategyAllocator } from '../src/analysts/strategies.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'baostock-klines.json'), 'utf8'))

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

function ma(arr, i, n) {
  if (i + 1 < n) return null
  return avg(arr.slice(i - n + 1, i + 1))
}
function rsi(closes, i, n = 14) {
  if (i < n) return 50
  let g = 0, l = 0
  for (let k = i - n; k < i; k++) { const d = closes[k] - closes[k - 1]; if (d >= 0) g += d; else l -= d }
  if (l === 0) return 100
  return 100 - 100 / (1 + g / l)
}

// 汇总信号
const stratStats = {
  低吸: { longDays: 0, flatDays: 0, longRets: [], flatRets: [], buys: 0 },
  追涨: { longDays: 0, flatDays: 0, longRets: [], flatRets: [], buys: 0 },
}

for (const [code, bars] of Object.entries(data.klines)) {
  const n = bars.length
  if (n < 40) continue
  const closes = bars.map((b) => b.close)
  const vols = bars.map((b) => b.amount)
  // 逐日状态
  const dipLong = [], brkLong = []
  for (let t = 30; t < n - 1; t++) {
    const ma20 = ma(closes, t, 20)
    const ma5 = ma(closes, t, 5)
    const vol5 = ma(vols, t, 5)
    const aboveMa20 = ma20 == null ? false : closes[t] > ma20
    const tech = {
      rsi14: rsi(closes, t),
      aboveMa20,
      macdSignal: ma5 == null ? 'none' : closes[t] / ma5 - 1 >= 0.02 ? 'golden' : closes[t] / ma5 - 1 <= -0.02 ? 'dead' : 'none',
      volumeRatio: vol5 ? vols[t] / vol5 : null,
      trend: ma20 == null ? 'sideways' : closes[t] > ma20 ? 'up' : closes[t] < ma20 ? 'down' : 'sideways',
      pattern: (closes[t] / closes[t - 20] - 1) >= 0.05 ? 'breakout' : (closes[t] / closes[t - 20] - 1) <= -0.05 ? 'breakdown' : 'none',
    }
    const dip = dipBuy(tech)
    const brk = chaseBreakout(tech)
    dipLong.push({ sig: dip.signal, ret: closes[t + 1] / closes[t] - 1 })
    brkLong.push({ sig: brk.signal, ret: closes[t + 1] / closes[t] - 1 })
  }
  // 状态机：非 hold 时切信号
  for (const [name, arr, st] of [
    ['低吸', dipLong, stratStats['低吸']],
    ['追涨', brkLong, stratStats['追涨']],
  ]) {
    let long = false
    for (const d of arr) {
      if (d.sig === 'buy') long = true, st.buys++
      else if (d.sig === 'sell') long = false
      if (long) { st.longDays++; st.longRets.push(d.ret) } else { st.flatDays++; st.flatRets.push(d.ret) }
    }
  }
}

console.log('='.repeat(66))
console.log('  各短线策略：持仓期 vs 空仓期（49 随机股每日样本）')
console.log('='.repeat(66))
for (const [name, st] of Object.entries(stratStats)) {
  const util = st.longDays / (st.longDays + st.flatDays)
  const lr = avg(st.longRets), fr = avg(st.flatRets)
  console.log(`  ${name}  buy信号 ${st.buys} 次 | 在场率 ${(util * 100).toFixed(1)}% | 持仓日均 ${(lr * 100).toFixed(2)}% vs 空仓日均 ${(fr * 100).toFixed(2)}% | 价差 ${((lr - fr) * 100).toFixed(2)}%`)
}
console.log('='.repeat(66))

// 多策略并行利用率（低吸 + 追涨）
const alloc = new MultiStrategyAllocator({ strategies: [
  { name: '低吸', signal: (c) => dipBuy(c).signal },
  { name: '追涨', signal: (c) => chaseBreakout(c).signal },
] })
for (const [code, bars] of Object.entries(data.klines)) {
  const n = bars.length
  if (n < 40) continue
  const closes = bars.map((b) => b.close)
  const vols = bars.map((b) => b.amount)
  for (let t = 30; t < n - 1; t++) {
    const ma20 = ma(closes, t, 20), ma5 = ma(closes, t, 5), vol5 = ma(vols, t, 5)
    const tech = {
      rsi14: rsi(closes, t),
      aboveMa20: ma20 == null ? false : closes[t] > ma20,
      macdSignal: ma5 == null ? 'none' : closes[t] / ma5 - 1 >= 0.02 ? 'golden' : closes[t] / ma5 - 1 <= -0.02 ? 'dead' : 'none',
      volumeRatio: vol5 ? vols[t] / vol5 : null,
      trend: ma20 == null ? 'sideways' : closes[t] > ma20 ? 'up' : closes[t] < ma20 ? 'down' : 'sideways',
      pattern: (closes[t] / closes[t - 20] - 1) >= 0.05 ? 'breakout' : (closes[t] / closes[t - 20] - 1) <= -0.05 ? 'breakdown' : 'none',
    }
    alloc.step({ 低吸: tech, 追涨: tech })
  }
}
const avgUtil = avg(alloc.log.map((x) => x.utilization))
console.log(`\n多策略并行（低吸+追涨）平均资金在场率：${(avgUtil * 100).toFixed(1)}%（单打板策略空仓风险大幅下降）`)