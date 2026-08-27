/**
 * Gina 短线攻击手 · 全自动闭环演示
 *
 * 串起：选股(ShortTermAttacker.pick) → 骑连板(RideStreakTrader) → 下单(MiniQMTBrokerAdapter)
 * 当前用 mock 下单成交验证闭环；Windows 装好 miniQMT 后，把 broker mode 切 'http' 即接真实通道。
 */

import { ShortTermAttacker, RideStreakTrader } from '../src/analysts/index.js'
import { MiniQMTBrokerAdapter } from '../src/finance-data-sources/broker.js'

const attacker = new ShortTermAttacker({ buyThreshold: 4 })
const trader = new RideStreakTrader({ buyThreshold: 4 })
const broker = new MiniQMTBrokerAdapter({ mode: 'mock', accountId: 'DEMO' })

// 模拟 5 个交易日（候选池 + 持有标的状态）
const days = [
  { date: 'D1', flat: true, candidates: [
    { symbol: '600776.SH', name: '东方通信', isLimitUp: true, breakTimes: 1, firstSeal: '0935', closeSealed: true, price: 8, floatMcap: 50, turnover: 8, streak: 1 },
    { symbol: '000001.SZ', name: '平安银行', isLimitUp: false, price: 12, floatMcap: 3000, turnover: 1, streak: 0 },
  ] },
  { date: 'D2', flat: false, held: { symbol: '600776.SH', isLimitUp: true, breakTimes: 0, closeSealed: true, price: 8.8, floatMcap: 50, turnover: 3, streak: 2 } },
  { date: 'D3', flat: false, held: { symbol: '600776.SH', isLimitUp: true, breakTimes: 0, closeSealed: true, price: 9.68, floatMcap: 50, turnover: 2, streak: 3 } },
  { date: 'D4', flat: false, held: { symbol: '600776.SH', isLimitUp: false, price: 9.2, floatMcap: 50, turnover: 12, streak: 3 } },
  { date: 'D5', flat: true, candidates: [] },
]

let equity = 2000
for (const d of days) {
  const lines = [`${d.date} → `]
  if (trader.holding) {
    const r = trader.onBar(d.held)
    lines.push(`决策:${r.action}(${r.reason})`)
    if (r.action === 'sell') {
      const fill = await broker.placeOrder({ symbol: d.held.symbol, side: 'sell', size: 0, price: d.held.price }, { authorized: true })
      lines.push(`下单卖出 ${fill.symbol} → ${fill.status}(${fill.reason})`)
      equity *= 1.0  // 示意：真实按成交价结算，mock 不换算
    } else {
      lines.push(`继续骑连板（持仓中）`)
    }
  } else {
    const picked = attacker.pick(d.candidates)
    if (picked) {
      const r = trader.onBar(picked)
      lines.push(`选股:${picked.symbol}(${picked.name}) 评分${picked.score} | 决策:${r.action}(${r.reason})`)
      if (r.action === 'buy') {
        const fill = await broker.placeOrder({ symbol: picked.symbol, side: 'buy', size: 0, price: picked.price }, { authorized: true })
        lines.push(`下单买入 ${fill.symbol} → ${fill.status}(${fill.reason})`)
      }
    } else {
      lines.push('无达标候选 → 空仓等待')
    }
  }
  console.log(lines.join(' '))
}

console.log('\n闭环打通：选股 → 骑连板 → 开板离场 → 下单（mock 成交）。切 broker mode=\'http\' 即接 miniQMT。')