/**
 * 分析师团队 —— 短线攻击手 (attacker.js)
 *
 * 与「保守共识」的分析师团队不同，本模块是 Gina 的「进攻」能力：
 *   - 保守团队（AnalystTeam + Integrator）回答「能不能拿、要不要降仓」，偏防守；
 *   - 短线攻击手回答「满仓打哪一支」，偏进攻：从涨停/候选池里挑最可能连板的标的。
 *
 * 选股 alpha（来自真实验证，见 scripts/factor-scan.mjs）：
 *   1) 低价股优先（<5 元最强）；
 *   2) 小盘优先（流通市值 30-100 亿最强）；
 *   3) 天量换手（>20%）是见顶信号，要避开；
 *   4) 连板（≥2 板）有惯性加成。
 *
 * 权限链不变：攻击手只产出「选股建议 + 攻击评分」，最终下单仍需用户授权。
 */

/**
 * 短线攻击手对单个候选股打分。
 * @param {object} c 候选
 * @param {string} c.symbol
 * @param {number} c.price      现价（元）
 * @param {number} [c.floatMcap] 流通市值（亿元）
 * @param {number} [c.turnover]  换手率（%）
 * @param {number} [c.streak]    连板数
 * @param {boolean} [c.isLimitUp] 是否涨停
 * @returns {{score:number, reasons:string[]}}
 */
export function scoreCandidate(c = {}) {
  let score = 0
  const reasons = []

  const price = Number(c.price)
  if (Number.isFinite(price)) {
    if (price < 5) { score += 3; reasons.push(`低价 ${price} 元`) }
    else if (price < 10) { score += 2; reasons.push(`中低价 ${price} 元`) }
    else if (price < 20) { score += 1 }
  }

  const mcap = Number(c.floatMcap)
  if (Number.isFinite(mcap)) {
    if (mcap >= 30 && mcap < 100) { score += 2; reasons.push(`小盘 ${mcap.toFixed(0)} 亿`) }
    else if (mcap < 30) { score += 1; reasons.push(`微盘 ${mcap.toFixed(0)} 亿`) }
  }

  const turnover = Number(c.turnover)
  if (Number.isFinite(turnover)) {
    if (turnover > 20) { score -= 2; reasons.push(`换手 ${turnover.toFixed(1)}% 过热(见顶信号)`) }
    else if (turnover >= 5 && turnover <= 10) { score += 1; reasons.push(`换手适中 ${turnover.toFixed(1)}%`) }
  }

  // 分钟级盘口因子（数据源提供时可加分；来自真实验证：炸1次=强、尾盘封/开板=弱）
  const breaks = Number(c.breakTimes)
  if (Number.isFinite(breaks)) {
    if (breaks === 1) { score += 2; reasons.push('炸1次回封(强)') }
    else if (breaks >= 2) { score -= 2; reasons.push(`炸${breaks}次(分歧大)`) }
  }
  if (typeof c.firstSeal === 'string' && c.firstSeal) {
    if (c.firstSeal >= '1400') { score -= 2; reasons.push('尾盘才封(弱)') }
    else if (c.firstSeal < '1000') { score += 1; reasons.push('早封') }
  }
  if (c.closeSealed === false) { score -= 2; reasons.push('尾盘开板(弱)') }

  if (+c.streak >= 2) { score += 1; reasons.push(`${c.streak} 连板`) }
  if (c.isLimitUp) { score += 1; reasons.push('涨停') }

  return { score, reasons }
}

export class ShortTermAttacker {
  /**
   * @param {object} [options]
   * @param {number} [options.buyThreshold] 攻击评分阈值，达到才建议满仓攻击
   */
  constructor({ buyThreshold = 3 } = {}) {
    this.buyThreshold = buyThreshold
  }

  /**
   * 对单只候选给攻击建议。
   * @returns {{attack:boolean, score:number, reasons:string[]}}
   */
  score(candidate) {
    const { score, reasons } = scoreCandidate(candidate)
    return { attack: score >= this.buyThreshold, score, reasons }
  }

  /**
   * 从候选池里挑出最该攻击的一支（满仓买入建议），无信号返回 null。
   * @param {Array<object>} candidates
   * @returns {{symbol:string, score:number, reasons:string[]}|null}
   */
  pick(candidates = []) {
    let best = null
    for (const c of candidates) {
      const r = this.score(c)
      if (!r.attack) continue
      if (!best || r.score > best.score) best = { ...c, ...r }
    }
    return best
  }

  /** 全部候选的攻击排序（供盘前/盘中展示）。 */
  rank(candidates = []) {
    return candidates
      .map((c) => ({ ...c, ...this.score(c) }))
      .sort((a, b) => b.score - a.score)
  }
}

/**
 * 短线攻击手 v2 —— 骑连板持仓状态机。
 *
 * 真实验证结论：打板的 10 倍来自「骑连板」（持有到开板），而非「次日必卖」。
 * 本状态机落实这条规则：
 *   - 空仓：只在可买涨停（非一字，优先炸1次/收盘封住）且评分达标时满仓入场；
 *   - 持仓：只要当日仍涨停就继续骑（不卖）；一旦开板（不再涨停）→ 次日/当日离场。
 */
export class RideStreakTrader {
  /**
   * @param {object} [options]
   * @param {number} [options.buyThreshold] 入场评分阈值
   */
  constructor({ buyThreshold = 4 } = {}) {
    this.buyThreshold = buyThreshold
    this.state = 'flat' // 'flat' | 'riding'
    this.position = null // { symbol, entryPrice, streakDays }
  }

  /**
   * 每个交易日推进一次状态机。
   * @param {object} bar 当日观察（空仓时=最该打的候选；持仓时=持仓股当日）
   * @returns {{action:'buy'|'hold'|'sell', symbol?:string, reason:string}}
   */
  onBar(bar = {}) {
    if (this.state === 'flat') {
      const buyable = bar.isLimitUp && (bar.breakTimes == null ? true : bar.breakTimes > 0)
      const sc = scoreCandidate(bar).score
      if (buyable && sc >= this.buyThreshold) {
        this.state = 'riding'
        this.position = { symbol: bar.symbol, entryPrice: bar.price, streakDays: 1 }
        return { action: 'buy', symbol: bar.symbol, reason: `骑连板入场 ${bar.symbol}（评分 ${sc}）` }
      }
      return { action: 'hold', reason: '空仓等待可买涨停' }
    }

    // riding：持有连板
    if (bar.isLimitUp) {
      this.position.streakDays += 1
      return { action: 'hold', reason: `连板持有·第 ${this.position.streakDays} 板` }
    }
    const p = this.position
    this.state = 'flat'
    this.position = null
    return { action: 'sell', reason: `开板离场（骑了 ${p.streakDays} 板）` }
  }

  /** 当前是否持有。 */
  get holding() { return this.state === 'riding' }
}