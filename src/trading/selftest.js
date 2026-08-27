// 交易核心移植自检（Phase 2 smoke test）
import {
  PositionManager,
  RiskController,
  TradingEngine,
  BreakoutStrategy,
  KnowledgeAdvisor,
  MarketRegimeAdvisor,
} from './index.js'

const alwaysBuy = { onTick: () => ({ action: 'buy', reason: 'test' }) }
const engine = new TradingEngine({
  positionManager: new PositionManager({ initialEquity: 1000000 }),
  riskController: new RiskController(),
  strategy: alwaysBuy,
})

const r = engine.processTick({ symbol: 'AAPL', close: 100, open: 100, high: 100, low: 100 })
console.log('TRADING_SELFTEST_OK')
console.log('order_status=' + r.order.status)
console.log('has_position=' + engine.positionManager.hasPosition('AAPL'))

// 止损触发
engine.processTick({ symbol: 'AAPL', close: 90, open: 90, high: 90, low: 90 })
console.log('stop_loss_triggered=' + (!engine.positionManager.hasPosition('AAPL')))

// 顾问降级（无知识源）不崩
const ka = new KnowledgeAdvisor()
console.log('knowledge_reason=' + JSON.stringify(ka.explain(['value_investing']).reason))

const ma = new MarketRegimeAdvisor()
console.log('regime_level=' + ma.assess(['panic']).level)