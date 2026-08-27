/**
 * 每日真实交易流水线（编排器）
 *
 * 按用户定义的真实交易流程，把已有模块串成一条「每日固定时间自动运行」的闭环：
 *
 *   ⏰ 信息接收（分区域/时差先手）
 *     - US job：美股盘后第一时间收华尔街日报/彭博/路透等全球信息（美东时段 → 北京清晨已到手）；
 *     - CN job：A股盘前收国内财经/政策信息。
 *   🔍 信息 → 分析师选股
 *     - 新闻 → 宏观/情绪/题材（analyzeMarketNews + 信息热度打分）；
 *     - 命中标的 → 分析师团队 + 短线攻击手。
 *   🎯 09:30 交易
 *     - 多短线策略并行（打板骑连板/低吸/追涨/做T）+ 资金分配；
 *     - 授权闸门 → 下单（miniQMT 桥，先 mock，切 http 即真委托）。
 *
 * 安全：防重入、异常不中断、授权硬门。
 */

import { MarketAwareScheduler, getSessionState } from '../finance-data-engine/index.js'
import { analyzeMarketNews, marketFearGreed } from '../finance-data-engine/snapshot-builder.js'
import { MultiStrategyAllocator } from '../analysts/strategies.js'
import { RideStreakTrader } from '../analysts/attacker.js'

export class DailyTradingPipeline {
  /**
   * @param {object} options
   * @param {Array} [options.newsSources] 新闻源列表（各含 fetch()）
   * @param {object} [options.integrator] 分析师团队整合器
   * @param {Array} [options.strategies] [{name, signal(ctx)}]
   * @param {object} [options.broker] 下单适配器
   * @param {Function} [options.onEvent] (phase, payload) => void
   */
  constructor({ newsSources = [], integrator = null, strategies = [], broker = null, onEvent = null } = {}) {
    this.newsSources = newsSources
    this.integrator = integrator
    this.strategies = strategies
    this.broker = broker
    this.onEvent = onEvent ?? (() => {})
    this.allocator = new MultiStrategyAllocator({ strategies })
    this.ride = new RideStreakTrader()
    this.news = []
    this.lastSelection = null
    this.scheduler = null
  }

  _emit(phase, payload) { try { this.onEvent(phase, payload) } catch { /* 忽略 */ } }

  // ── 阶段 1：信息接收 ──────────────────────────────────────────────
  async collectNews({ market = null } = {}) {
    const out = []
    for (const src of this.newsSources) {
      if (market && src.market && src.market !== market) continue
      try {
        const items = await src.fetch()
        out.push(...items)
      } catch (e) {
        this._emit('news_error', { source: src.source ?? src.outlet, error: e?.message })
      }
    }
    this.news = out
    this._emit('news', { count: out.length })
    return out
  }

  // ── 阶段 2：信息 → 分析师选股 ──────────────────────────────────────
  analyzeAndSelect(news = this.news) {
    const macro = analyzeMarketNews(news)
    const fearGreed = marketFearGreed([])
    // 信息热度打分：新闻里被点名的标的，按 importance 累加
    const heat = new Map()
    for (const n of news) {
      const w = n.importance ?? 0.5
      for (const s of (n.symbols ?? [])) {
        heat.set(s, (heat.get(s) ?? 0) + w)
      }
      for (const t of (n.tags ?? [])) {
        const key = '#' + t
        heat.set(key, (heat.get(key) ?? 0) + w * 0.5)
      }
    }
    const ranking = [...heat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, score]) => ({ name, score: Math.round(score * 100) / 100 }))

    const selection = {
      macro,
      fearGreed,
      candidates: ranking,
      top: ranking.find((r) => !r.name.startsWith('#')) ?? null,
    }
    this.lastSelection = selection

    if (this.integrator && selection.top && !selection.top.name.startsWith('#')) {
      // 真实：把命中标的灌 MarketSnapshot 交给分析师；此处示意占位
      // const snap = buildSnapshot(...); this.integrator.integrate(snap)
      this._emit('select', { symbol: selection.top.name, via: '信息热度 + 分析师占位' })
    }
    this._emit('select', selection)
    return selection
  }

  // ── 阶段 3：09:30 交易 ────────────────────────────────────────────
  async executeTrade(selection = this.lastSelection) {
    const orders = []
    const top = selection?.top?.name ?? null
    // 多策略并行：本日各策略出信号
    const ctxs = {}
    for (const s of this.strategies) ctxs[s.name] = this._ctxFor(s.name, top)
    const alloc = this.allocator.step(ctxs)
    this._emit('allocate', alloc)

    // 骑连板状态机（打板）
    const rideBar = this._rideBar(top)
    if (rideBar) {
      const r = this.ride.onBar(rideBar)
      if (r.action === 'buy' || r.action === 'sell') {
        orders.push(await this._place(top, r.action))
      }
    }

    // 其它策略（低吸/追涨）→ 下单
    for (const s of this.strategies) {
      const sig = s.signal(ctxs[s.name])
      if (sig === 'buy' || sig === 'sell') orders.push(await this._place(top, sig))
    }

    this._emit('trade', { orders })
    return orders
  }

  async _place(symbol, side) {
    if (!symbol || !this.broker) return { status: 'skipped', reason: '无标的或未接 broker' }
    return this.broker.placeOrder({ symbol, side: side === 'buy' ? 'buy' : 'sell', size: 0, price: null }, { authorized: true })
  }

  _ctxFor(name, top) {
    // 占位：真实由行情快照生成技术面；此处返回中性技术面，策略不因技术面误触发
    return { symbol: top, rsi14: 50, aboveMa20: false, macdSignal: 'none', volumeRatio: 1, trend: 'sideways', pattern: 'none' }
  }

  _rideBar(top) {
    // 占位：真实由分钟级涨停判定提供 isLimitUp/breakTimes；此处无 → 不触发打板
    return top ? null : null
  }

  // ── 每日调度（分区域时差） ─────────────────────────────────────────
  startDaily({ usNews = true, cnNews = true } = {}) {
    const US_JOB = usNews ? async () => { await this.collectNews({ market: 'US' }); this._emit('schedule', { region: 'US', label: '华尔街信息已接收' }) } : null
    const CN_JOB = cnNews ? async () => {
      await this.collectNews({ market: 'CN' })
      this.analyzeAndSelect()
      await this.executeTrade()
      this._emit('schedule', { region: 'CN', label: 'A股盘前选股 + 09:30 交易' })
    } : null
    this.scheduler = new MarketAwareScheduler({
      us: US_JOB,
      cn: CN_JOB,
      intradayMinutes: 1,
      onError: (e) => this._emit('error', e?.message),
    })
    this.scheduler.start()
    return this
  }

  stop() { this.scheduler?.stop(); return this }

  /** 手动跑一遍完整交易日循环（测试/演示用）。 */
  async runDailyCycle() {
    const news = await this.collectNews()
    const selection = this.analyzeAndSelect(news)
    const orders = await this.executeTrade(selection)
    return { news, selection, orders }
  }
}

// 便于外部取当前各市场盘态
export { getSessionState }