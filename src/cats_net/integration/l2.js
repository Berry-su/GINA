/**
 * C-3.3 L2 三层记忆 ↔ CATS-Net 概念双向
 *
 * 把 L2 记忆（episodic / semantic / procedural）的每个 memory node
 * 跟 CATS-Net concept 双向引用，并补 episodic_memory 时间索引。
 *
 * 节点结构：
 *   - l2_mem_<memoryId>                   每个 memory 节点（episodic 层）
 *   - memory 表 catsnet_concept_id 字段   双向引用
 *   - episodic_memory 表 + 索引           时间索引
 *
 * 触发点：
 *   - l2.recordMemory(...)                新记忆写入时
 *   - l2.findConceptsForMemory(memId)     memory → concept
 *   - l2.findMemoriesForConcept(conceptId) concept → memory
 *   - l2.getRecentMemories({fromT, toT})  时间索引查询
 *
 * 情绪严格隔离：memory attributes 不含 emotion 字段
 */

import { upsertNode, safeConnect, makeId, sanitizeAttrs } from './_base.js'

const LAYER = 'L2'

const EPISODIC_VIEW = 'episodic_memory'

function ensureEpisodicSchema(db) {
  if (!db || typeof db.exec !== 'function') return
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${EPISODIC_VIEW} (
      memory_id TEXT PRIMARY KEY,
      catsnet_concept_id TEXT,
      ts_ms INTEGER NOT NULL,
      importance REAL,
      content TEXT,
      activation REAL DEFAULT 1.0,
      level TEXT DEFAULT 'episodic',
      source TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_${EPISODIC_VIEW}_ts ON ${EPISODIC_VIEW}(ts_ms);
    CREATE INDEX IF NOT EXISTS idx_${EPISODIC_VIEW}_concept ON ${EPISODIC_VIEW}(catsnet_concept_id);
    CREATE INDEX IF NOT EXISTS idx_${EPISODIC_VIEW}_importance ON ${EPISODIC_VIEW}(importance);
  `)
}

export class L2Integration {
  /**
   * @param {object} ctx IntegrationContext（需要 db 可选）
   */
  constructor(ctx) {
    this.ctx = ctx
    this.catsNet = ctx.catsNet
    this.db = ctx.db
    this.memory = ctx.memory  // 可选：主仓 memory helpers
    this.embedding = ctx.embedding  // 可选：本地 embedding
    if (this.db) ensureEpisodicSchema(this.db)
  }

  /**
   * 记录一条 memory，写双向引用
   * @param {object} opts
   * @param {string} opts.memoryId
   * @param {string} [opts.content]
   * @param {string} [opts.type='observation']  observation / fact / episode / skill
   * @param {number} [opts.importance=0.5]
   * @param {string[]} [opts.concepts] 关联的 CATS-Net concept id 列表
   * @param {number} [opts.ts=Date.now()]
   * @param {string} [opts.source]
   * @param {string} [opts.level='episodic'] episodic / semantic / procedural
   * @returns {{conceptId: string, written: boolean}}
   */
  recordMemory({
    memoryId,
    content = '',
    type = 'observation',
    importance = 0.5,
    concepts = [],
    ts = Date.now(),
    source = '',
    level = 'episodic',
  } = {}) {
    if (!memoryId) {
      throw new TypeError('recordMemory 需要 memoryId')
    }
    const conceptId = makeId(LAYER, 'mem', memoryId)
    const imp = Math.max(0, Math.min(1, importance))

    // 1) 写 CATS-Net 节点
    upsertNode(this.catsNet, conceptId, {
      _layer: LAYER,
      name: `Memory: ${memoryId}`,
      type: 'entity',
      level: ['episodic', 'semantic', 'procedural'].includes(level) ? level : 'episodic',
      activation: imp,
      confidence: imp,
      attributes: sanitizeAttrs({
        memoryId,
        type,
        content: typeof content === 'string' ? content.slice(0, 500) : '',
        importance: imp,
        source,
        ts,
      }),
    })

    // 2) 关联到其他 concept（instance_of 边）
    for (const cid of concepts) {
      if (typeof cid !== 'string' || !this.catsNet.hasNode(cid)) continue
      safeConnect(this.catsNet, conceptId, cid, imp, 'instance_of', false)
    }

    // 3) 写 episodic_memory 表（双向引用 + 时间索引）
    let written = false
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO ${EPISODIC_VIEW}
            (memory_id, catsnet_concept_id, ts_ms, importance, content, activation, level, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        stmt.run(memoryId, conceptId, ts, imp, String(content).slice(0, 2000), imp, level, source)
        written = true
      } catch (err) {
        this.ctx.trace(LAYER, 'episodicInsertError', { error: String(err), memoryId })
      }
    }

    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'recordMemory', { memoryId, conceptId, concepts: concepts.length, written })
    return { conceptId, written }
  }

  /**
   * memory → concept（双向查找）
   * @param {string} memoryId
   * @returns {string|null} 对应的 CATS-Net concept id
   */
  findConceptsForMemory(memoryId) {
    const conceptId = makeId(LAYER, 'mem', memoryId)
    return this.catsNet.hasNode(conceptId) ? conceptId : null
  }

  /**
   * concept → memory（双向查找）
   * @param {string} conceptId
   * @returns {string[]}
   */
  findMemoriesForConcept(conceptId) {
    const out = []
    if (!this.db) {
      // 退化：扫 CATS-Net 节点
      for (const node of this.catsNet.nodes.values()) {
        if (node.deletedAt != null) continue
        if (node.id.startsWith(`${LAYER.toLowerCase()}_mem_`)) {
          // 检查是否有边指向 conceptId
          if (node.connections.has(conceptId)) {
            out.push(node.attributes?.memoryId || node.id.replace(/^l2_mem_/, ''))
          }
        }
      }
      return out
    }
    try {
      const rows = this.db.prepare(`
        SELECT memory_id FROM ${EPISODIC_VIEW}
        WHERE catsnet_concept_id = ? OR memory_id = ?
        ORDER BY ts_ms DESC
      `).all(conceptId, conceptId)
      return rows.map((r) => r.memory_id)
    } catch {
      return []
    }
  }

  /**
   * 时间窗口查询记忆
   * @param {object} [opts]
   * @param {number} [opts.fromT]
   * @param {number} [opts.toT]
   * @param {number} [opts.minImportance=0]
   * @param {number} [opts.limit=100]
   * @returns {Array<{memoryId:string, conceptId:string, ts:number, importance:number, content:string}>}
   */
  getRecentMemories({ fromT, toT, minImportance = 0, limit = 100 } = {}) {
    if (!this.db) return []
    const conditions = []
    const args = []
    if (typeof fromT === 'number') {
      conditions.push('ts_ms >= ?')
      args.push(fromT)
    }
    if (typeof toT === 'number') {
      conditions.push('ts_ms <= ?')
      args.push(toT)
    }
    if (typeof minImportance === 'number' && minImportance > 0) {
      conditions.push('importance >= ?')
      args.push(minImportance)
    }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
    args.push(Math.max(1, limit))
    try {
      return this.db.prepare(`
        SELECT memory_id AS memoryId, catsnet_concept_id AS conceptId, ts_ms AS ts,
               importance, content, level
        FROM ${EPISODIC_VIEW}
        ${where}
        ORDER BY ts_ms DESC
        LIMIT ?
      `).all(...args)
    } catch {
      return []
    }
  }

  /**
   * 激活某条 memory 对应的 concept（让 CATS-Net 后续扩散能用到）
   * @param {string} memoryId
   * @param {number} [amount=0.5]
   * @returns {boolean}
   */
  activateMemory(memoryId, amount = 0.5) {
    const conceptId = findConceptsForMemory(this.catsNet, memoryId)
    if (!conceptId) return false
    return this.catsNet.activate(conceptId, amount) != null
  }

  /**
   * 返回 L2 子图快照
   * @returns {Array}
   */
  getL2Snapshot() {
    const out = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith('l2_')) continue
      out.push({
        id: node.id,
        name: node.name,
        level: node.level,
        activation: node.activation,
        memoryId: node.attributes?.memoryId,
        importance: node.attributes?.importance,
      })
    }
    return out
  }
}

function findConceptsForMemory(catsNet, memoryId) {
  const conceptId = makeId(LAYER, 'mem', memoryId)
  return catsNet.hasNode(conceptId) ? conceptId : null
}

export default L2Integration
