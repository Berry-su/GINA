/**
 * C-3.7 L7 决策层 → CATS-Net 决策=概念聚合
 *
 * 把 6 分析师 + 风控官 + 整合器 全部入 CATS-Net：
 *   - 6 分析师 = 6 个 concept 群（每个分析师有自己的子图）
 *   - 整合器 = 跨分析师 concept 聚合
 *   - 风控官 = 高优先级 concept (risk_officer_veto, salience=1.0)
 *   - 决策 = "decision_<ts>" concept 节点
 *   - 决策可解释性：每个决策 concept 都有 reasoning 子图
 *
 * 节点结构：
 *   - l7_analyst_<name>                    6 个分析师
 *   - l7_analyst_output_<analyst>_<ts>    每次输出
 *   - l7_risk_officer_veto                风控官（salience=1.0）
 *   - l7_decision_<ts>                    决策
 *
 * 触发点：
 *   - l7.registerAnalyst(...)             一次性注册 6 分析师 + 风控官
 *   - l7.recordAnalystOutput(...)         每次评分
 *   - l7.recordDecision(...)              整合器调
 *   - l7.getDecisionExplanation(id)       返回子图
 *   - l7.getRecentDecisions({limit})      决策历史
 *
 * 情绪严格隔离：决策 attributes / analyst output 严格不含 emotion 字段
 */

import { upsertNode, safeConnect, makeId, sanitizeAttrs } from './_base.js'

const LAYER = 'L7'

const DEFAULT_ANALYSTS = Object.freeze([
  { name: 'macro', domain: '宏观经济', methodology: 'GDP/CPI/利率' },
  { name: 'technical', domain: '技术分析', methodology: 'K线/均线/MACD' },
  { name: 'fundamental', domain: '基本面', methodology: '财报/估值' },
  { name: 'sentiment', domain: '情绪面', methodology: '舆情/资金流' },
  { name: 'fundflow', domain: '资金流', methodology: '北向/主力' },
  { name: 'attacker', domain: '反向辩论', methodology: '空头视角/挑刺' },
])

const RISK_OFFICER_ID = 'l7_risk_officer_veto'

export class L7Integration {
  /**
   * @param {object} ctx IntegrationContext
   */
  constructor(ctx) {
    this.ctx = ctx
    this.catsNet = ctx.catsNet
    this.analysts = ctx.analysts || null
    /** @type {Set<string> 已注册分析师 */
    this._registered = new Set()
  }

  /**
   * 一次性注册所有分析师 + 风控官
   * @param {Array<{name:string, domain?:string, methodology?:string}>} [analysts]
   * @returns {number} 注册数
   */
  registerAnalysts(analysts = DEFAULT_ANALYSTS) {
    let n = 0
    for (const a of analysts) {
      if (this._registered.has(a.name)) continue
      const id = makeId(LAYER, 'analyst', a.name)
      upsertNode(this.catsNet, id, {
        _layer: LAYER,
        name: `分析师: ${a.name}`,
        type: 'entity',
        level: 'abstract',
        confidence: 0.9,
        attributes: sanitizeAttrs({
          name: a.name,
          domain: a.domain || '',
          methodology: a.methodology || '',
          registeredAt: Date.now(),
        }),
      })
      // 风控官特殊：高 salience
      if (a.name === 'risk_officer' || a.name === 'risk') {
        const node = this.catsNet.getNode(id)
        if (node) {
          node.boost(10)  // 把 salience 拉满
        }
      }
      this._registered.add(a.name)
      n += 1
    }
    // 注册风控官（如果不在列表里）
    if (!this._registered.has('risk_officer')) {
      upsertNode(this.catsNet, RISK_OFFICER_ID, {
        _layer: LAYER,
        name: '风控官 veto',
        type: 'relation',
        level: 'abstract',
        confidence: 1.0,
        activation: 0.5,
        attributes: sanitizeAttrs({
          name: 'risk_officer',
          domain: '风控',
          methodology: '一票否决',
          registeredAt: Date.now(),
        }),
      })
      const node = this.catsNet.getNode(RISK_OFFICER_ID)
      if (node) node.boost(10)
      this._registered.add('risk_officer')
      n += 1
    }
    if (n > 0) this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'registerAnalysts', { count: n })
    return n
  }

  /**
   * 记录一次分析师输出
   * @param {object} opts
   * @param {string} opts.analyst
   * @param {number} opts.score [-1, 1]（1=强买, -1=强卖）
   * @param {number} [opts.confidence=0.5]
   * @param {string} [opts.reasoning] 简短推理
   * @param {number} [opts.ts=Date.now()]
   * @returns {string} output concept id
   */
  recordAnalystOutput({ analyst, score, confidence = 0.5, reasoning = '', ts = Date.now() } = {}) {
    if (!analyst) throw new TypeError('recordAnalystOutput 需要 analyst')
    if (typeof score !== 'number' || Number.isNaN(score)) {
      throw new TypeError('score 需要数值')
    }
    if (!this._registered.has(analyst)) {
      this.registerAnalysts([{ name: analyst, domain: analyst, methodology: 'auto' }])
    }
    const outputId = makeId(LAYER, 'analyst_output', `${analyst}_${ts}`)
    const analystId = makeId(LAYER, 'analyst', analyst)
    upsertNode(this.catsNet, outputId, {
      _layer: LAYER,
      name: `${analyst} 输出 @ ${ts}`,
      type: 'relation',
      level: 'abstract',
      activation: Math.abs(score),
      confidence: Math.max(0, Math.min(1, confidence)),
      attributes: sanitizeAttrs({
        analyst,
        score: Math.max(-1, Math.min(1, score)),
        confidence: Math.max(0, Math.min(1, confidence)),
        reasoning: String(reasoning).slice(0, 300),
        ts,
      }),
    })
    // 边：analyst → output (produced)
    safeConnect(this.catsNet, analystId, outputId, 1.0, 'produced', false)
    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'recordAnalystOutput', { analyst, score, outputId })
    return outputId
  }

  /**
   * 记录一次决策（整合器调）
   * @param {object} opts
   * @param {string} [opts.summary]
   * @param {Array<{analyst:string, score:number, confidence?:number, reasoning?:string}>} opts.analystOutputs
   * @param {number} [opts.riskScore=0]
   * @param {string[]} [opts.adoptedTools] L6 决策采用的工具名
   * @param {string} [opts.outcome='pending'] pending / adopted / rejected / vetoed
   * @param {number} [opts.ts=Date.now()]
   * @returns {string} decision concept id
   */
  recordDecision({
    summary = '',
    analystOutputs = [],
    riskScore = 0,
    adoptedTools = [],
    outcome = 'pending',
    ts = Date.now(),
  } = {}) {
    if (!Array.isArray(analystOutputs) || analystOutputs.length === 0) {
      throw new TypeError('recordDecision 需要至少 1 个 analystOutput')
    }
    const decisionId = makeId(LAYER, 'decision', String(ts))
    upsertNode(this.catsNet, decisionId, {
      _layer: LAYER,
      name: `Decision @ ${ts}`,
      type: 'relation',
      level: 'abstract',
      confidence: 0.8,
      attributes: sanitizeAttrs({
        summary: String(summary).slice(0, 300),
        riskScore: Math.max(0, Math.min(1, riskScore)),
        outcome,
        ts,
        adoptedTools: adoptedTools.join(','),
      }),
    })

    // 边：analyst_outputs → decision
    for (const out of analystOutputs) {
      if (!out || typeof out !== 'object') continue
      const outputId = this.recordAnalystOutput({
        analyst: out.analyst,
        score: out.score,
        confidence: out.confidence,
        reasoning: out.reasoning,
        ts: out.ts || ts,
      })
      const score = Math.abs(Number(out.score) || 0)
      safeConnect(this.catsNet, outputId, decisionId, score, 'input_to', false)
    }

    // 风控官边
    if (riskScore > 0.7) {
      safeConnect(this.catsNet, RISK_OFFICER_ID, decisionId, riskScore, 'vetoed', false)
    }

    // 工具边（L6）
    for (const toolName of adoptedTools) {
      const toolId = makeId('L6', 'tool', toolName)
      if (this.catsNet.hasNode(toolId)) {
        safeConnect(this.catsNet, decisionId, toolId, 0.5, 'used_tool', false)
      }
    }

    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'recordDecision', { decisionId, analystOutputs: analystOutputs.length, riskScore, adoptedTools: adoptedTools.length })
    return decisionId
  }

  /**
   * 返回决策的可解释性子图
   * @param {string} decisionId
   * @returns {{decision: object|null, inputs: Array, risks: Array, tools: Array}}
   */
  getDecisionExplanation(decisionId) {
    const decision = this.catsNet.getNode(decisionId)
    if (!decision) return { decision: null, inputs: [], risks: [], tools: [] }
    const inputs = []
    const risks = []
    const tools = []

    // 1) 出边：decision → tool (used_tool)
    for (const [targetId, meta] of decision.connections) {
      const target = this.catsNet.getNode(targetId)
      if (!target) continue
      if (meta.type === 'used_tool' || target.id.startsWith('l6_tool_')) {
        tools.push({ id: target.id, name: target.attributes?.name, weight: meta.weight })
      }
    }

    // 2) 入边：output → decision (input_to) + risk_officer → decision (vetoed)
    for (const [sourceId, sourceNode] of this.catsNet.nodes) {
      if (sourceNode.deletedAt != null) continue
      if (!sourceNode.connections) continue
      const meta = sourceNode.connections.get(decisionId)
      if (!meta) continue
      if ((meta.type === 'input_to' || sourceId.startsWith('l7_analyst_output_')) && meta.type === 'input_to') {
        inputs.push({
          id: sourceId,
          analyst: sourceNode.attributes?.analyst,
          score: sourceNode.attributes?.score,
          confidence: sourceNode.attributes?.confidence,
          reasoning: sourceNode.attributes?.reasoning,
          ts: sourceNode.attributes?.ts,
        })
      } else if (meta.type === 'vetoed' || sourceId === RISK_OFFICER_ID) {
        risks.push({ id: sourceId, name: sourceNode.name, weight: meta.weight })
      }
    }

    return {
      decision: {
        id: decision.id,
        summary: decision.attributes?.summary,
        outcome: decision.attributes?.outcome,
        riskScore: decision.attributes?.riskScore,
        ts: decision.attributes?.ts,
      },
      inputs,
      risks,
      tools,
    }
  }

  /**
   * 最近 N 条决策
   * @param {object} [opts]
   * @param {number} [opts.limit=10]
   * @returns {Array}
   */
  getRecentDecisions({ limit = 10 } = {}) {
    const out = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith('l7_decision_')) continue
      out.push({
        id: node.id,
        summary: node.attributes?.summary,
        outcome: node.attributes?.outcome,
        riskScore: node.attributes?.riskScore,
        ts: node.attributes?.ts,
      })
    }
    out.sort((a, b) => (b.ts || 0) - (a.ts || 0))
    return out.slice(0, Math.max(1, limit))
  }

  /**
   * 标记风控官对某决策的 veto
   * @param {string} decisionId
   * @param {string} reason
   * @returns {boolean}
   */
  vetoDecision(decisionId, reason = '') {
    const node = this.catsNet.getNode(decisionId)
    if (!node) return false
    safeConnect(this.catsNet, RISK_OFFICER_ID, decisionId, 1.0, 'vetoed', false)
    if (node.attributes) {
      node.attributes.outcome = 'vetoed'
      node.attributes.vetoReason = String(reason).slice(0, 200)
    }
    node._record?.({ op: 'riskOfficerVeto', reason })
    this.ctx.trace(LAYER, 'vetoDecision', { decisionId, reason })
    return true
  }

  /**
   * 返回 L7 子图快照
   * @returns {{analysts: Array, decisions: Array, riskOfficer: object|null}}
   */
  getL7Snapshot() {
    const analysts = []
    const decisions = []
    let riskOfficer = null
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (node.id.startsWith('l7_analyst_') && !node.id.includes('_output_')) {
        analysts.push({ id: node.id, name: node.attributes?.name, domain: node.attributes?.domain })
      } else if (node.id.startsWith('l7_analyst_output_')) {
        // 跳过（只统计聚合）
      } else if (node.id.startsWith('l7_decision_')) {
        decisions.push({
          id: node.id,
          summary: node.attributes?.summary,
          outcome: node.attributes?.outcome,
          ts: node.attributes?.ts,
        })
      } else if (node.id === RISK_OFFICER_ID) {
        riskOfficer = { id: node.id, name: node.name, salience: node.salience }
      }
    }
    return { analysts, decisions, riskOfficer }
  }
}

L7Integration.RISK_OFFICER_ID = RISK_OFFICER_ID
L7Integration.DEFAULT_ANALYSTS = DEFAULT_ANALYSTS

export default L7Integration
