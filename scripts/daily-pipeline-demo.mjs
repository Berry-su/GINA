/**
 * 每日真实交易流水线 —— 演示（mock 新闻 + mock 下单）
 * 跑通：信息接收 → 分发选股 → 09:30 交易 三段闭环。
 * 真实环境：把 newsSources 换成 RssNewsSource、broker 切 mode='http'。
 */
import { DailyTradingPipeline, getSessionState } from '../src/trading/daily-pipeline.js'
import { createMockNewsSources } from '../src/finance-data-engine/news-source.js'
import { dipBuy, chaseBreakout } from '../src/analysts/strategies.js'
import { MiniQMTBrokerAdapter } from '../src/finance-data-sources/broker.js'

const pipeline = new DailyTradingPipeline({
  newsSources: createMockNewsSources({ count: 6 }), // 华尔街/彭博/路透/FT/财新/上证报
  strategies: [
    { name: '低吸', signal: (c) => dipBuy(c).signal },
    { name: '追涨', signal: (c) => chaseBreakout(c).signal },
  ],
  broker: new MiniQMTBrokerAdapter({ mode: 'mock', accountId: 'DEMO' }),
  onEvent: (phase, p) => {
    if (phase === 'news') console.log(`  [信息接收] 收到 ${p.count} 条新闻`)
    else if (phase === 'select') console.log(`  [选股] 宏观流动性=${p.macro?.liquidity} 政策=${p.macro?.policyBias} | 候选热度Top: ${(p.candidates?.[0]?.name ?? '—')}`)
    else if (phase === 'allocate') console.log(`  [资金分配] 并行策略在场率 ${(p.utilization * 100).toFixed(0)}%`)
    else if (phase === 'trade') console.log(`  [交易] 下单 ${p.orders.length} 笔`)
  },
})

console.log('='.repeat(64))
console.log('  Gina 每日真实交易流水线 · 演示一轮')
console.log('='.repeat(64))

// 各市场当前盘态（美中时差）
console.log(`  US 盘态: ${getSessionState('US').label}   CN 盘态: ${getSessionState('CN').label}\n`)

const { news, selection, orders } = await pipeline.runDailyCycle()

console.log('\n  ── 一轮闭环结果 ──')
console.log(`  信息 ${news.length} 条 → 宏观[${selection.macro.liquidity}/${selection.macro.policyBias}/${selection.macro.geopoliticalRisk}]`)
console.log(`  信息热度候选: ${selection.candidates.slice(0, 5).map((c) => `${c.name}(${c.score})`).join('  ') || '—'}`)
console.log(`  下单: ${orders.length ? orders.map((o) => `${o.symbol}:${o.side}→${o.status}`).join(' ') : '无信号（mock 技术面中性，需真实行情才触发）'}`)
console.log('='.repeat(64))
console.log('  已可 startDaily() 接入 MarketAwareScheduler：US 盘后收华尔街、CN 盘前选股、09:30 交易。')