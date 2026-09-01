/**
 * C-3.6 L6 工具市场 → CATS-Net 工具=概念，调用=激活扩散
 *
 * 把工具注册 / 调用全部入 CATS-Net：
 *   - 工具 = concept (l6_tool_<name>, level=semantic, type=action)
 *   - attributes: {description, schema, category, securityLevel}
 *   - 5 层免疫 = securityLevel 属性（0-4）
 *   - 调用 = activate(1.0) + 沿 use_tool 边扩散
 *   - 工具可信度 = salience 动态调整（成功 +0.01 / 失败 -0.05）
 *
 * 触发点：
 *   - l6.registerTool(...)               工具注册时
 *   - l6.recordCall(toolName, success)   工具调用完成时
 *   - l6.getToolCredibility(toolName)    0-1
 *   - l6.getToolsByCategory(cat)         分类查询
 *
 * 情绪严格隔离：工具 attributes 不含 emotion 字段
 */

import { upsertNode, safeConnect, makeId, sanitizeAttrs } from './_base.js'

const LAYER = 'L6'

const SECURITY_LEVELS = Object.freeze({
  PUBLIC: 0,           // 公开工具（如搜索、读文件）
  STANDARD: 1,         // 标准工具（如常用 API）
  PRIVILEGED: 2,       // 特权工具（如写文件、执行命令）
  DANGEROUS: 3,        // 危险工具（如修改系统设置）
  CRITICAL: 4,         // 极高权限（如删除数据、改密）—— 需人工审批
})

const CREDIBILITY_DELTA = Object.freeze({
  SUCCESS: 0.01,
  FAILURE: -0.05,
})

/**
 * 方向加权融合系数（30% 偏向 direction 领域成功率，70% 走全局）
 * 老板 9-01 拍板 ADR-003 §3.2.6：30% 加权，不抢全局可信度的"主信号"地位
 */
const DIRECTION_WEIGHT = 0.3

/**
 * 反思深度（direction 领域失败时多抓 1 轮上下文）
 * 老板 9-01 拍板 ADR-003 §3.2.6：direction 领域失败反思 ×2
 */
const REFLECTION_DEPTH_MULTIPLIER = 2.0

export class L6Integration {
  /**
   * @param {object} ctx IntegrationContext
   */
  constructor(ctx) {
    this.ctx = ctx
    this.catsNet = ctx.catsNet
    this.registry = ctx.capabilityRegistry || null
    /** @type {Map<string, number> 缓存 credibility（避免每次扫图） */
    this._credCache = new Map()
  }

  /**
   * 注册一个工具到 CATS-Net
   * @param {object} opts
   * @param {string} opts.name 工具名
   * @param {string} [opts.description]
   * @param {object} [opts.schema] 工具 schema（JSON Schema）
   * @param {string} [opts.category] 工具分类
   * @param {number} [opts.securityLevel=1]
   * @param {number} [opts.confidence=1.0]
   * @param {number} [opts.initialSalience=0.5] 初始 salience（credibility）
   * @returns {string} concept id
   */
  registerTool({ name, description = '', schema = null, category = '', securityLevel = 1, confidence = 1.0, initialSalience = 0.5 } = {}) {
    if (!name) throw new TypeError('registerTool 需要 name')
    const sl = Math.max(0, Math.min(4, securityLevel))
    const id = makeId(LAYER, 'tool', name)
    const node = upsertNode(this.catsNet, id, {
      _layer: LAYER,
      name: `Tool: ${name}`,
      type: 'action',
      level: 'semantic',
      confidence: Math.max(0, Math.min(1, confidence)),
      attributes: sanitizeAttrs({
        name,
        description: description.slice(0, 500),
        schema: schema ? JSON.stringify(schema).slice(0, 1000) : '',
        category,
        securityLevel: sl,
        registeredAt: Date.now(),
      }),
    })
    // 设置初始 salience（credibility 起点 = 0.5，尚未被验证）
    node.salience = Math.max(0, Math.min(1, initialSalience))
    this._credCache.set(name, node.salience)
    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'registerTool', { id, name, securityLevel: sl })
    return id
  }

  /**
   * 记录一次工具调用
   * @param {string} name
   * @param {object} [opts]
   * @param {boolean} [opts.success=true]
   * @param {number} [opts.durationMs]
   * @param {string} [opts.context] 简短 context（最近任务）
   * @param {boolean} [opts.directionMatched=false] 本次调用是否落在当前 direction 领域
   * @returns {{credibility: number, called: boolean, directionMatched: boolean, reflectHooked: boolean}}
   */
  recordCall(name, { success = true, durationMs = null, context = '', directionMatched = false } = {}) {
    if (!name) return { credibility: 0, called: false, directionMatched: false, reflectHooked: false }
    const id = makeId(LAYER, 'tool', name)
    const node = this.catsNet.getNode(id)
    if (!node) {
      // 自动注册（懒注册）
      this.registerTool({ name, securityLevel: 1 })
    }
    const target = this.catsNet.getNode(id)
    if (!target) return { credibility: 0, called: false, directionMatched: false, reflectHooked: false }

    // 1) 激活工具
    target.activate(1.0, 'l6:toolCall')

    // 2) 更新 credibility (salience) —— 直接修改，因为 boost(1.01) 在 salience=1.0 时不生效
    // direction 领域工具：delta ×1.5（老板 9-01 拍板：direction 领域成功率/失败率单独加权）
    const dirMatch = directionMatched === true
    const dirMultiplier = dirMatch ? 1.5 : 1.0
    const baseDelta = success ? CREDIBILITY_DELTA.SUCCESS : CREDIBILITY_DELTA.FAILURE
    const delta = baseDelta * dirMultiplier
    // 初始 salience = confidence (默认 1.0)；clamp [0.1, 1.0]
    let next = target.salience + delta
    if (next < 0.1) next = 0.1
    if (next > 1.0) next = 1.0
    target.salience = next
    target._record?.({ op: 'credibilityUpdate', delta, salience: next, directionMatched: dirMatch })
    this._credCache.set(name, target.salience)

    // 3) 记录到 attributes（最近 5 次调用）
    const history = Array.isArray(target.attributes.callHistory)
      ? target.attributes.callHistory
      : []
    history.push({ ts: Date.now(), success, durationMs, context: context.slice(0, 60), directionMatched: dirMatch })
    while (history.length > 5) history.shift()
    target.attributes.callHistory = history
    // 4) direction 领域成功率 / 失败率单独统计（attributes.directionStats）
    if (dirMatch) {
      const ds = (target.attributes.directionStats && typeof target.attributes.directionStats === 'object')
        ? target.attributes.directionStats
        : { calls: 0, successes: 0, failures: 0, lastTs: 0 }
      ds.calls = (ds.calls || 0) + 1
      if (success) ds.successes = (ds.successes || 0) + 1
      else ds.failures = (ds.failures || 0) + 1
      ds.lastTs = Date.now()
      target.attributes.directionStats = ds
    }
    target._record?.({ op: 'toolCall', success, durationMs, directionMatched: dirMatch })

    // 5) 反思 hook：direction 领域失败 → 自动 record experience with directionMatch=true
    //    按 ADR-003 §3.2.6：反思深度 ×2（contextWindow=2）
    let reflectHooked = false
    if (!success && dirMatch) {
      try {
        const cb = this.ctx.reflectionHook
        if (typeof cb === 'function') {
          cb({
            trigger: `tool_failure:${name}`,
            action: `call(${name})`,
            result: 'failed',
            learned: `方向领域工具 ${name} 失败，需复盘调用条件 / 参数 / 调用栈`,
            confidence: 0.5,
            directionMatch: true,
            contextWindow: REFLECTION_DEPTH_MULTIPLIER,
            relatedConcepts: [id],
            ts: Date.now(),
          })
          reflectHooked = true
        }
      } catch (err) {
        this.ctx.trace(LAYER, 'reflectHookError', { name, error: String(err) })
      }
    }

    this.ctx.trace(LAYER, 'recordCall', { name, success, cred: target.salience, directionMatched: dirMatch, reflectHooked })
    return { credibility: target.salience, called: true, directionMatched: dirMatch, reflectHooked }
  }

  /**
   * 获取工具可信度（0-1）
   * @param {string} name
   * @param {object} [opts]
   * @param {string} [opts.directionTopic] 当前 direction topic（提供时按 30% 偏向 direction 领域 salience）
   * @returns {number} 0-1
   */
  getToolCredibility(name, { directionTopic = null } = {}) {
    if (!name) return 0
    const id = makeId(LAYER, 'tool', name)
    const node = this.catsNet.getNode(id)
    if (!node) return 0
    if (!directionTopic || typeof directionTopic !== 'string') {
      return node.salience
    }
    // direction 领域：直接读 directionStats 算子集成功率，再回退到 salience
    const ds = node.attributes?.directionStats
    if (ds && ds.calls > 0) {
      // 方向领域 salience：成功率线性映射 [0.1, 1.0]
      const dirScore = 0.1 + 0.9 * (ds.successes / ds.calls)
      // 30% direction 加权（老板 9-01 拍板）：baseScore + (dirScore - baseScore) * 0.3
      const baseScore = node.salience
      return baseScore + (dirScore - baseScore) * DIRECTION_WEIGHT
    }
    // 无 direction 数据 → 仍按 topic 关键词重判定（如果 concept 名字含 topic 关键词）
    const t = directionTopic.toLowerCase()
    if (t && String(node.attributes?.name || '').toLowerCase().includes(t)) {
      return node.salience  // 仍按全局 salience（无独立统计时不臆造）
    }
    return node.salience
  }

  /**
   * 按分类查询
   * @param {string} category
   * @returns {Array}
   */
  getToolsByCategory(category) {
    const out = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith('l6_tool_')) continue
      if (node.attributes?.category !== category) continue
      out.push({
        id: node.id,
        name: node.attributes?.name,
        salience: node.salience,
        securityLevel: node.attributes?.securityLevel,
        lastCallAt: node.attributes?.callHistory?.slice(-1)?.[0]?.ts,
      })
    }
    return out
  }

  /**
   * 按安全等级查询
   * @param {number} level
   * @returns {Array}
   */
  getToolsBySecurityLevel(level) {
    const out = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith('l6_tool_')) continue
      if (node.attributes?.securityLevel !== level) continue
      out.push({
        id: node.id,
        name: node.attributes?.name,
        category: node.attributes?.category,
        salience: node.salience,
      })
    }
    return out
  }

  /**
   * 注册两个工具的协同关系（高频共现自动建边）
   * @param {string} toolA
   * @param {string} toolB
   * @param {number} [count=1] 共现次数
   */
  linkCoOccurrence(toolA, toolB, count = 1) {
    const aId = makeId(LAYER, 'tool', toolA)
    const bId = makeId(LAYER, 'tool', toolB)
    const w = Math.max(0, Math.min(1, count / 100))  // 100 次归一化
    return safeConnect(this.catsNet, aId, bId, w, 'used_with', true)
  }

  /**
   * 决策节点使用某工具（建边）
   * @param {string} decisionConceptId 如 'l7_decision_<ts>'
   * @param {string} toolName
   * @param {number} [confidence=0.5]
   * @returns {boolean}
   */
  recordToolUsedByDecision(decisionConceptId, toolName, confidence = 0.5) {
    if (!decisionConceptId || !toolName) return false
    const toolId = makeId(LAYER, 'tool', toolName)
    return safeConnect(this.catsNet, decisionConceptId, toolId, confidence, 'used_tool', false)
  }

  /**
   * 返回 L6 子图快照
   * @returns {Array}
   */
  getL6Snapshot() {
    const out = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith('l6_')) continue
      out.push({
        id: node.id,
        name: node.name,
        level: node.level,
        name_attr: node.attributes?.name,
        category: node.attributes?.category,
        securityLevel: node.attributes?.securityLevel,
        salience: node.salience,
      })
    }
    return out
  }
}

L6Integration.SECURITY_LEVELS = SECURITY_LEVELS

export default L6Integration
