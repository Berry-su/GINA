/**
 * 短线策略库 —— 除打板外的多套短线打法 + 多策略并行调度（规则 + 知识，离线确定性）
 *
 * 覆盖用户要求的四类短线手法：
 *   - 打板（追涨停）  → 已有 RideStreakTrader（骑连板）
 *   - 低吸（跌多了买） → dipBuy
 *   - 追涨（趋势突破） → chaseBreakout
 *   - 做 T（日内高抛低吸）→ waveT
 *
 * 多策略并行：MultiStrategyAllocator 把资金在「当前有信号」的策略间分配，减少空仓、提高资金利用率。
 */

/** 低吸：超卖 + 企稳 → 买；反弹到 20 日线/RSI 回暖 → 卖。 */
export function dipBuy(tech = {}) {
  const rsi = tech.rsi14
  let signal = 'hold'
  let score = 0
  const reasons = []
  if (rsi != null && rsi <= 30) {
    score += 2
    reasons.push(`RSI ${rsi} 超卖`)
    if (tech.pattern !== 'breakdown') { score += 1; reasons.push('止跌企稳') }
  }
  if (tech.macdSignal === 'golden') { score += 1; reasons.push('MACD 金叉') }
  if (score >= 2 && tech.trend !== 'down') signal = 'buy'
  if (rsi != null && rsi >= 60) { signal = 'sell'; reasons.push(`RSI ${rsi} 回暖，止盈`) }
  if (tech.aboveMa20) { signal = 'sell'; reasons.push('反弹到 20 日线') }
  return { signal, score, reasons }
}

/** 追涨：放量突破 + 趋势多头 → 买；跌破 20 日线/破位 → 卖。 */
export function chaseBreakout(tech = {}) {
  let signal = 'hold'
  let score = 0
  const reasons = []
  if (tech.trend === 'up') { score += 1; reasons.push('趋势向上') }
  if (tech.pattern === 'breakout') { score += 2; reasons.push('突破关键位') }
  if (tech.volumeRatio != null && tech.volumeRatio >= 1.2) { score += 1; reasons.push('放量') }
  if (score >= 3) signal = 'buy'
  if (tech.pattern === 'breakdown' || tech.aboveMa20 === false) { signal = 'sell'; reasons.push('破位') }
  return { signal, score, reasons }
}

/**
 * 做 T：日内高抛低吸（需分钟线），当场降低成本或锁仓。
 * @param {Array} minutes [{open,high,low,close}...] 当日分钟线
 * @param {{cost:number, held:boolean}} [ref] {成本价, 是否持仓}
 * @returns {{action:'buy'|'sell'|'hold', reason:string}}
 */
export function waveT(minutes = [], ref = {}) {
  if (!minutes.length) return { action: 'hold', reason: '无分钟数据' }
  const first = minutes[0]
  const last = minutes[minutes.length - 1]
  const dayHigh = Math.max(...minutes.map((m) => m.high))
  const dayLow = Math.min(...minutes.map((m) => m.low))
  const cost = ref.cost ?? last.close
  const held = ref.held ?? false
  // 仓内高抛：尾盘冲高或较成本涨 3%+
  if (held && last.close >= cost * 1.03) {
    return { action: 'sell', reason: `日内冲高 +${((last.close / cost - 1) * 100).toFixed(1)}%，高抛` }
  }
  // 空仓低吸：回落接近日低且较开盘 -2% 以下
  if (!held && last.close <= first.open * 0.98 && last.close <= dayLow * 1.01) {
    return { action: 'buy', reason: `回落至日低附近 ${last.close.toFixed(2)}，低吸` }
  }
  return { action: 'hold', reason: '无 T 点' }
}

/**
 * 多策略并行资金调度：把可用资金在「当前有看多信号」的策略间分配，减少空仓。
 */
export class MultiStrategyAllocator {
  /**
   * @param {object} [options]
   * @param {number} [options.maxExposure] 最大总仓位（默认 1 = 满仓）
   * @param {Array<{name:string, signal:(ctx)=>'buy'|'sell'|'hold'}>} [options.strategies]
   */
  constructor({ maxExposure = 1, strategies = [] } = {}) {
    this.maxExposure = maxExposure
    this.strategies = strategies
    this.positions = new Map() // name -> { long:boolean }
    this.log = []
  }

  /** 每个交易日推进：各策略出信号，分配资金，返回本日持仓与利用率。 */
  step(ctxs = {}) {
    const longs = []
    for (const s of this.strategies) {
      const ctx = ctxs[s.name] ?? {}
      const sig = s.signal(ctx)
      if (sig === 'buy') { this.positions.set(s.name, { long: true }); longs.push(s.name) }
      else if (sig === 'sell') { this.positions.set(s.name, { long: false }) }
      // 'hold'：保持原状
    }
    const active = [...this.positions.entries()].filter(([, p]) => p.long).map(([n]) => n)
    const share = active.length ? Math.min(1, this.maxExposure / active.length) : 0
    const allocation = Object.fromEntries(active.map((n) => [n, share]))
    const utilization = Math.min(this.maxExposure, active.length * share)
    this.log.push({ active: [...active], allocation, utilization })
    return { allocation, utilization, idle: this.maxExposure - utilization }
  }
}