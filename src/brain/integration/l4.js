/**
 * C-3.4 L4 知识大脑 → CATS-Net 知识条目概念化
 *
 * 把知识条目（5 大领域：投资/交易/危机/编程/通用）全部入 CATS-Net，
 * 知识条目间关系（is_a / prerequisite_for / conflicts_with）作为边。
 *
 * 节点结构：
 *   - l4_kb_<domain>_<slug>               知识条目（5 大领域）
 *   - ingestion 通路已写 CATS-Net（验收）
 *
 * 触发点：
 *   - l4.ingestKnowledge(...)             单条知识条目入图
 *   - l4.linkKnowledge(fromId, toId, ...) 关系入图
 *   - l4.verifyIngestionPipeline()        验收 ingestion 通路
 *
 * 情绪严格隔离：知识条目 attributes 不含 emotion 字段
 */

import { upsertNode, safeConnect, makeId, sanitizeAttrs } from './_base.js'

const LAYER = 'L4'

const DOMAINS = Object.freeze({
  INVEST: 'invest',
  TRADE: 'trade',
  CRISIS: 'crisis',
  CODE: 'code',
  GENERAL: 'general',
})

const RELATIONS = Object.freeze({
  IS_A: 'is_a',                     // 继承
  PREREQUISITE_FOR: 'prerequisite_for',  // 前置
  CONFLICTS_WITH: 'conflicts_with',  // 冲突
  RELATED_TO: 'related_to',          // 相关
  EXEMPLIFIES: 'exemplifies',        // 例证
})

const RELATION_WEIGHTS = Object.freeze({
  is_a: 1.0,
  prerequisite_for: 0.8,
  conflicts_with: 0.5,
  related_to: 0.5,
  exemplifies: 0.6,
})

export class L4Integration {
  /**
   * @param {object} ctx IntegrationContext
   */
  constructor(ctx) {
    this.ctx = ctx
    this.catsNet = ctx.catsNet
    this.knowledge = ctx.knowledge  // 可选：主仓 knowledge helpers
    this.ingestion = ctx.ingestion  // 可选：主仓 ingestion pipeline
  }

  /**
   * 入图一条知识条目
   * @param {object} opts
   * @param {string} opts.domain 5 大领域之一
   * @param {string} opts.slug 条目 slug
   * @param {string} [opts.name]
   * @param {string} [opts.content]
   * @param {string} [opts.type='abstract']  entity / abstract
   * @param {string} [opts.level='semantic'] episodic / semantic / abstract
   * @param {number} [opts.confidence=0.7]
   * @param {Array<{domain:string, slug:string, relation:string, weight?:number}>} [opts.relations]
   * @returns {string} concept id
   */
  ingestKnowledge({
    domain,
    slug,
    name = null,
    content = '',
    type = 'abstract',
    level = 'semantic',
    confidence = 0.7,
    relations = [],
  } = {}) {
    if (!DOMAINS[domain.toUpperCase?.()]) {
      // 兼容小写
      if (!Object.values(DOMAINS).includes(domain)) {
        throw new RangeError(`未知 domain: ${domain}，合法值: ${Object.values(DOMAINS).join(', ')}`)
      }
    }
    if (!slug) {
      throw new TypeError('ingestKnowledge 需要 slug')
    }
    const id = makeId(LAYER, 'kb', `${domain}_${slug}`)
    upsertNode(this.catsNet, id, {
      _layer: LAYER,
      name: name || `${domain}: ${slug}`,
      type: type === 'entity' ? 'entity' : 'abstract',
      level: ['episodic', 'semantic', 'abstract'].includes(level) ? level : 'semantic',
      confidence: Math.max(0, Math.min(1, confidence)),
      attributes: sanitizeAttrs({
        domain,
        slug,
        content: typeof content === 'string' ? content.slice(0, 1000) : '',
        ingestedAt: Date.now(),
      }),
    })

    // 关系边
    for (const rel of relations) {
      if (!rel || typeof rel !== 'object') continue
      if (!RELATIONS[rel.relation?.toUpperCase?.()] && !Object.values(RELATIONS).includes(rel.relation)) continue
      const targetId = makeId(LAYER, 'kb', `${rel.domain}_${rel.slug}`)
      const w = typeof rel.weight === 'number' ? rel.weight : RELATION_WEIGHTS[rel.relation] || 0.5
      safeConnect(this.catsNet, id, targetId, w, rel.relation, false)
    }

    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'ingestKnowledge', { id, domain, slug, relations: relations.length })
    return id
  }

  /**
   * 给已有知识条目建关系
   * @param {string} fromId 源 concept id（完整 id，如 l4_kb_invest_value_investing）
   * @param {string} toId 目标 concept id
   * @param {string} relationType 见 RELATIONS
   * @param {number} [weight]
   * @returns {boolean}
   */
  linkKnowledge(fromId, toId, relationType, weight) {
    if (!RELATIONS[relationType?.toUpperCase?.()] && !Object.values(RELATIONS).includes(relationType)) {
      throw new RangeError(`未知 relation: ${relationType}`)
    }
    const w = typeof weight === 'number' ? weight : RELATION_WEIGHTS[relationType] || 0.5
    const ok = safeConnect(this.catsNet, fromId, toId, w, relationType, false)
    if (ok) this.ctx.trace(LAYER, 'linkKnowledge', { fromId, toId, relationType, w })
    return ok
  }

  /**
   * 按域查询
   * @param {string} domain
   * @returns {Array}
   */
  getKnowledgeByDomain(domain) {
    if (!Object.values(DOMAINS).includes(domain)) return []
    const out = []
    const prefix = makeId(LAYER, 'kb', `${domain}_`)
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith(prefix)) continue
      out.push({
        id: node.id,
        name: node.name,
        level: node.level,
        confidence: node.confidence,
        slug: node.attributes?.slug,
        domain: node.attributes?.domain,
      })
    }
    return out
  }

  /**
   * 验收 ingestion 通路是否真写 CATS-Net
   * @returns {{ok: boolean, reason?: string}}
   */
  verifyIngestionPipeline() {
    if (!this.ingestion || typeof this.ingestion.ingestText !== 'function') {
      // 退化：检查 CATS-Net 是否有 L4 节点
      const l4Nodes = this._countL4Nodes()
      if (l4Nodes === 0) {
        return { ok: false, reason: 'CATS-Net 无 L4 节点（无 ingestion 实例 + 无显式 ingestKnowledge 调用）' }
      }
      return { ok: true, reason: 'CATS-Net 已有 L4 节点（显式 ingestKnowledge 已建）', l4Nodes }
    }
    // 真实 ingestion：模拟 ingest 一个 text 片段
    try {
      const result = this.ingestion.ingestText({
        text: 'CATS-Net 概念网络是 GINA 大脑的核心。它包含 ConceptNode 节点和层级激活扩散机制。',
        topic: 'CATS-Net',
        source: 'l4-verify',
      })
      if (result && typeof result === 'object') {
        if (result.nodes > 0) {
          return { ok: true, reason: 'ingestion 真写 CATS-Net', nodes: result.nodes }
        }
        return { ok: false, reason: 'ingestion 返回 nodes=0', result }
      }
      return { ok: false, reason: 'ingestion 返回非预期' }
    } catch (err) {
      return { ok: false, reason: 'ingestion 抛错: ' + String(err) }
    }
  }

  /**
   * 统计 L4 节点数
   * @private
   */
  _countL4Nodes() {
    let n = 0
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (node.id.startsWith('l4_')) n += 1
    }
    return n
  }

  /**
   * 返回 L4 子图快照
   * @returns {Array}
   */
  getL4Snapshot() {
    return this._countL4Nodes() > 0
      ? Array.from(this.catsNet.nodes.values())
          .filter((n) => n.deletedAt == null && n.id.startsWith('l4_'))
          .map((n) => ({
            id: n.id,
            name: n.name,
            level: n.level,
            domain: n.attributes?.domain,
            slug: n.attributes?.slug,
            confidence: n.confidence,
          }))
      : []
  }
}

L4Integration.DOMAINS = DOMAINS
L4Integration.RELATIONS = RELATIONS

export default L4Integration
