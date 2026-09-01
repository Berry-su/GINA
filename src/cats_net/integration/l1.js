/**
 * C-3.2 L1 ACI 预判 → CATS-Net 节点化
 *
 * 把 ACI 预判注入决策（语义记忆预判 / 工具链模式预判 / 定时预热）
 * 全部入 CATS-Net，并落 aci_injection_log 表（可观测性）。
 *
 * 节点结构：
 *   - l1_strategy_<kind>                  3 个策略 concept
 *   - l1_injection_<unix_ms>              每次注入决策
 *   - aci_injection_log 表                SQLite log（可观测性）
 *
 * 触发点：
 *   - l1.recordInjection(...)             每次 ACI 注入决策
 *   - l1.markInjectionUsed(id)            LLM 实际使用某注入（reward signal）
 *   - l1.getInjectionStats()              统计
 *
 * 情绪严格隔离：strategy 不含 emotion 字段
 */

import { upsertNode, safeConnect, makeId, sanitizeAttrs } from './_base.js'

const LAYER = 'L1'

const STRATEGY_KINDS = Object.freeze({
  SEMANTIC_MEMORY_PREFETCH: 'semantic_memory_prefetch',
  TOOL_CHAIN_PREFETCH: 'tool_chain_prefetch',
  TEMPORAL_WARMUP: 'temporal_warmup',
})

const STRATEGY_NAMES = Object.freeze({
  semantic_memory_prefetch: '语义记忆预判',
  tool_chain_prefetch: '工具链模式预判',
  temporal_warmup: '定时预热',
})

const LOG_TABLE = 'aci_injection_log'

/**
 * 确保 aci_injection_log 表存在
 * @param {object} db better-sqlite3 db
 */
function ensureLogTable(db) {
  if (!db || typeof db.exec !== 'function') return
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${LOG_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      ts_ms INTEGER NOT NULL,
      strategy TEXT NOT NULL,
      confidence REAL NOT NULL,
      target_concept TEXT,
      duration_ms INTEGER,
      used INTEGER NOT NULL DEFAULT 0,
      catsnet_injection_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_${LOG_TABLE}_ts ON ${LOG_TABLE}(ts_ms);
    CREATE INDEX IF NOT EXISTS idx_${LOG_TABLE}_strategy ON ${LOG_TABLE}(strategy);
  `)
}

export class L1Integration {
  /**
   * @param {object} ctx IntegrationContext（需要 db 可选）
   */
  constructor(ctx) {
    this.ctx = ctx
    this.catsNet = ctx.catsNet
    this.db = ctx.db
    if (this.db) ensureLogTable(this.db)
    this._ensureStrategies()
    this._seq = 0  // 序列号，防止同毫秒 collision
  }

  /**
   * 预置 3 个策略 concept（CATS-Net 中只创建一次）
   * @private
   */
  _ensureStrategies() {
    for (const [kind, name] of Object.entries(STRATEGY_NAMES)) {
      const id = makeId(LAYER, 'strategy', kind)
      upsertNode(this.catsNet, id, {
        _layer: LAYER,
        name,
        type: 'action',
        level: 'semantic',
        attributes: { kind, name, registeredAt: Date.now() },
      })
    }
  }

  /**
   * 记录一次 ACI 注入决策
   * @param {object} opts
   * @param {string} opts.strategy 三选一：semantic_memory_prefetch / tool_chain_prefetch / temporal_warmup
   * @param {number} opts.confidence [0,1]
   * @param {string} [opts.target] 触发的 CATS-Net concept id（可选）
   * @param {number} [opts.durationMs] 注入耗时
   * @param {string} [opts.context] 额外 context
   * @returns {{injectionId: string, logId: number|null}}
   */
  recordInjection({ strategy, confidence, target = null, durationMs = null, context = null } = {}) {
    if (!STRATEGY_NAMES[strategy]) {
      throw new RangeError(`未知 ACI 策略: ${strategy}，合法值: ${Object.keys(STRATEGY_NAMES).join(', ')}`)
    }
    const conf = Math.max(0, Math.min(1, Number(confidence) || 0))
    const tsMs = Date.now()
    this._seq = (this._seq || 0) + 1
    const injectionId = makeId(LAYER, 'injection', `${tsMs}_${this._seq}`)

    // 1) 入 CATS-Net
    const node = upsertNode(this.catsNet, injectionId, {
      _layer: LAYER,
      name: `ACI 注入: ${strategy}`,
      type: 'action',
      level: 'semantic',
      activation: conf,
      confidence: conf,
      attributes: sanitizeAttrs({
        strategy,
        confidence: conf,
        target: target || '',
        durationMs: typeof durationMs === 'number' ? durationMs : 0,
        ts: tsMs,
        context: typeof context === 'string' ? context.slice(0, 100) : '',
      }),
    })

    // 边：injection → strategy
    safeConnect(this.catsNet, injectionId, makeId(LAYER, 'strategy', strategy), conf, 'used_strategy', false)
    // 边：injection → target（若有）
    if (target && this.catsNet.hasNode(target)) {
      safeConnect(this.catsNet, injectionId, target, conf, 'triggered', false)
    }

    // 2) 落 log 表
    let logId = null
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO ${LOG_TABLE} (ts_ms, strategy, confidence, target_concept, duration_ms, used, catsnet_injection_id)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `)
        const r = stmt.run(tsMs, strategy, conf, target || null, durationMs || null, injectionId)
        logId = Number(r.lastInsertRowid) || null
      } catch (err) {
        // log 失败不阻塞主流程
        this.ctx.trace(LAYER, 'logError', { error: String(err) })
      }
    }

    this.ctx.bumpLayer(LAYER)
    this.ctx.trace(LAYER, 'recordInjection', { injectionId, strategy, conf })
    return { injectionId, logId, node }
  }

  /**
   * 标记某次注入被 LLM 实际使用（reward signal）
   * @param {string} injectionId
   * @returns {boolean}
   */
  markInjectionUsed(injectionId) {
    if (!this.db) return false
    try {
      const r = this.db.prepare(`UPDATE ${LOG_TABLE} SET used = 1 WHERE catsnet_injection_id = ?`).run(injectionId)
      return r.changes > 0
    } catch {
      return false
    }
  }

  /**
   * 注入统计
   * @returns {object|null} 统计信息；无 db 时返回 null
   */
  getInjectionStats() {
    if (!this.db) return null
    try {
      const total = this.db.prepare(`SELECT COUNT(*) AS n FROM ${LOG_TABLE}`).get().n
      const used = this.db.prepare(`SELECT COUNT(*) AS n FROM ${LOG_TABLE} WHERE used = 1`).get().n
      const byStrategy = this.db.prepare(`
        SELECT strategy, COUNT(*) AS total, SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) AS used
        FROM ${LOG_TABLE}
        GROUP BY strategy
      `).all()
      return {
        total,
        used,
        usedRate: total > 0 ? used / total : 0,
        byStrategy: byStrategy.reduce((acc, row) => {
          acc[row.strategy] = {
            total: row.total,
            used: row.used,
            usedRate: row.total > 0 ? row.used / row.total : 0,
          }
          return acc
        }, {}),
      }
    } catch {
      return null
    }
  }

  /**
   * 获取最近 N 条注入决策
   * @param {number} [limit=10]
   * @returns {Array<object>}
   */
  getRecentInjections(limit = 10) {
    if (!this.db) return []
    try {
      return this.db.prepare(`
        SELECT * FROM ${LOG_TABLE}
        ORDER BY ts_ms DESC LIMIT ?
      `).all(Math.max(1, limit))
    } catch {
      return []
    }
  }

  /**
   * 返回 L1 子图快照
   * @returns {Array}
   */
  getL1Snapshot() {
    const out = []
    for (const node of this.catsNet.nodes.values()) {
      if (node.deletedAt != null) continue
      if (!node.id.startsWith('l1_')) continue
      out.push({
        id: node.id,
        name: node.name,
        level: node.level,
        activation: node.activation,
        strategy: node.attributes?.strategy,
      })
    }
    return out
  }
}

L1Integration.STRATEGY_KINDS = STRATEGY_KINDS

export default L1Integration
