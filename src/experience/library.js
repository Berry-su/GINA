// src/experience/library.js —— GINA 经验库
//
// 设计哲学（2026-09-01 老板拍板 · C-4.5）：
//   - 记忆 = 发生的事（src/memory/injector.js L2 三层记忆）
//   - 经验 = 学到的（从反思抽出的抽象教训）
//   - 反思 → 经验 → 长期沉淀闭环
//   - 下次遇到相似场景，经验优先于通用知识
//   - 跟 CATS-Net 概念网络联动：高频经验提升对应 concept 的 salience
//   - 跟 direction 联动：当前 direction 领域经验优先级 +0.2
//
// 持久化：SQLite experience 表（已通过 src/db/schema.js 创建）
//   区别于 src/memory/experience-collector.js（JSONL 行为日志，职责正交）
//
// 关联 ADR-004 §3.3

import { getDB } from '../db/connection.js'

const SCHEMA_VERSION = 1
const DEFAULT_CONFIDENCE = 0.5
const FEEDBACK_POS_DELTA = 0.1
const FEEDBACK_NEG_DELTA = 0.2
const CONFIDENCE_CEIL = 0.95
const CONFIDENCE_FLOOR = 0.1
const TRIGGER_KEYWORD_COUNT = 3
const TRIGGER_KEYWORD_MAX_LEN = 12

function _hashTrigger(trigger) {
  if (!trigger) return ''
  // 简单 hash：lowercase + 移除标点 + 取前 100 字符
  const normalized = String(trigger).toLowerCase()
    .replace(/[\s\p{P}]+/gu, ' ')
    .trim()
    .slice(0, 100)
  // djb2 hash
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) & 0xFFFFFFFF
  }
  return `sig_${(hash >>> 0).toString(16)}`
}

function _extractKeywords(text) {
  if (!text) return []
  // 简单：去掉停用词 + 取 2-12 字符的"词"
  const stop = new Set(['的', '了', '是', '在', '和', '与', '或', '这', '那', '一个', '一种', '一些', '什么', '怎么', '为什么', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'i', 'you', 'he', 'she', 'it', 'we', 'they'])
  const cleaned = String(text).toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && w.length <= TRIGGER_KEYWORD_MAX_LEN && !stop.has(w))
  return cleaned.slice(0, TRIGGER_KEYWORD_COUNT * 2)
}

function _safeJsonParse(s, defaultVal) {
  if (!s) return defaultVal
  if (typeof s === 'object') return s
  try { return JSON.parse(s) } catch { return defaultVal }
}

function _nowIso() { return new Date().toISOString() }

export class ExperienceLibrary {
  /**
   * @param {object} [opts]
   * @param {object} [opts.db] 可选 DB 实例
   * @param {object} [opts.catsNet] 可选 CATS-Net 实例（联动 concept salience）
   * @param {object} [opts.episodic] 可选 episodic memory 引用（保留以备后续联动）
   */
  constructor({ db = null, catsNet = null, episodic = null } = {}) {
    this.db = db || getDB()
    this.catsNet = catsNet
    this.episodic = episodic
    // schema 已在 schema.js 集中建表，这里只验证存在
    this._ensureTable()
  }

  _ensureTable() {
    try {
      this.db.exec(`SELECT 1 FROM experience LIMIT 1`)
    } catch (err) {
      console.warn('[experience-library] experience table missing, schema not initialized:', err?.message || err)
    }
  }

  /**
   * 记录一条经验（fire-and-forget 不阻塞主循环）
   * @param {object} entry
   * @param {string} entry.trigger     触发场景描述
   * @param {string} entry.action      当时做的动作
   * @param {string} entry.result      当时的结果
   * @param {string} entry.learned     学到的教训
   * @param {number} [entry.confidence=0.5]
   * @param {string} [entry.source='reflection']
   * @param {string[]} [entry.relatedConcepts=[]]
   * @param {Buffer|null} [entry.embedding=null]
   * @returns {number} experience row id
   */
  record({ trigger, action, result, learned, confidence = DEFAULT_CONFIDENCE, source = 'reflection', relatedConcepts = [], embedding = null } = {}) {
    if (!trigger || !action || !result || !learned) {
      console.warn('[experience-library] record: missing required field')
      return -1
    }
    const triggerSig = _hashTrigger(trigger)
    const conf = Math.max(0, Math.min(1, Number(confidence) || DEFAULT_CONFIDENCE))
    const sourceStr = String(source || 'reflection').slice(0, 60)
    const conceptsJson = JSON.stringify(Array.isArray(relatedConcepts) ? relatedConcepts : [])

    let id = -1
    try {
      // 查找 trigger_sig 已有记录（合并：use_count +1, confidence 加权平均）
      const existing = this.db.prepare(
        'SELECT id, use_count, confidence FROM experience WHERE trigger_sig = ? ORDER BY use_count DESC LIMIT 1'
      ).get(triggerSig)

      if (existing) {
        const newUse = (existing.use_count || 0) + 1
        const newConf = ((existing.confidence * existing.use_count) + conf) / newUse
        this.db.prepare(`
          UPDATE experience
          SET use_count = ?, confidence = ?, updated_at = ?
          WHERE id = ?
        `).run(newUse, newConf, _nowIso(), existing.id)
        id = existing.id
      } else {
        const info = this.db.prepare(`
          INSERT INTO experience
            (trigger_sig, trigger, action, result, learned, confidence, since, source, related_concepts, embedding, use_count)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 1)
        `).run(
          triggerSig,
          String(trigger).slice(0, 500),
          String(action).slice(0, 500),
          String(result).slice(0, 500),
          String(learned).slice(0, 1000),
          conf,
          sourceStr,
          conceptsJson,
          embedding
        )
        id = info.lastInsertRowid

        // 联动 CATS-Net：高频经验提升 concept salience
        if (this.catsNet && Array.isArray(relatedConcepts) && relatedConcepts.length > 0) {
          try {
            for (const conceptId of relatedConcepts) {
              const node = this.catsNet.getNode?.(conceptId)
              if (node && typeof node.bump === 'function') {
                node.bump()
              } else if (node && typeof node.bumpActivation === 'function') {
                node.bumpActivation(0.05)
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[experience-library] record failed:', err?.message || err)
      return -1
    }
    return id
  }

  /**
   * 查询类似经验
   * @param {object} opts
   * @param {string} opts.currentContext 当前场景文本
   * @param {number} [opts.limit=5]
   * @param {number} [opts.minConfidence=0.3]
   * @param {string|null} [opts.directionTopic=null] 当前 direction 主题，匹配的经验 +0.2 优先级
   * @returns {Array}
   */
  query({ currentContext, limit = 5, minConfidence = 0.3, directionTopic = null } = {}) {
    if (!currentContext) return []
    const seen = new Set()
    const out = []
    const sig = _hashTrigger(currentContext)

    // 1. trigger_sig 精确匹配
    try {
      const rows = this.db.prepare(`
        SELECT * FROM experience WHERE trigger_sig = ? AND confidence >= ?
        ORDER BY confidence DESC, use_count DESC LIMIT ?
      `).all(sig, minConfidence, limit)
      for (const r of rows) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        out.push(this._rowToExp(r, directionTopic))
      }
    } catch {}

    // 2. 关键词 LIKE fallback
    if (out.length < limit) {
      const keywords = _extractKeywords(currentContext)
      for (const kw of keywords) {
        if (out.length >= limit) break
        try {
          const more = this.db.prepare(`
            SELECT * FROM experience
            WHERE trigger LIKE ? AND confidence >= ?
              ${seen.size > 0 ? `AND id NOT IN (${[...seen].join(',')})` : ''}
            ORDER BY confidence DESC, use_count DESC LIMIT ?
          `).all(`%${kw}%`, minConfidence, limit - out.length)
          for (const r of more) {
            if (seen.has(r.id)) continue
            seen.add(r.id)
            out.push(this._rowToExp(r, directionTopic))
            if (out.length >= limit) break
          }
        } catch {}
      }
    }

    // 更新 last_used（best-effort）
    if (out.length > 0) {
      const ids = out.map(r => r.id)
      try {
        this.db.prepare(`UPDATE experience SET last_used = datetime('now') WHERE id IN (${ids.join(',')})`).run()
      } catch {}
    }
    return out.slice(0, limit)
  }

  _rowToExp(row, directionTopic = null) {
    let score = Number(row.confidence) || 0
    // direction 加权：触发场景含 direction topic 关键词 → +0.2
    if (directionTopic && typeof directionTopic === 'string') {
      const topicLower = directionTopic.toLowerCase()
      if (row.trigger && row.trigger.toLowerCase().includes(topicLower)) {
        score = Math.min(1, score + 0.2)
      }
    }
    return {
      id: row.id,
      trigger: row.trigger,
      action: row.action,
      result: row.result,
      learned: row.learned,
      confidence: Number(row.confidence) || 0,
      since: row.since,
      last_used: row.last_used,
      use_count: row.use_count,
      feedback_pos: row.feedback_pos,
      feedback_neg: row.feedback_neg,
      source: row.source,
      related_concepts: _safeJsonParse(row.related_concepts, []),
      relevance_score: score,
    }
  }

  /**
   * 老板反馈（强化 / 弱化）
   * @param {number} id experience row id
   * @param {object} opts
   * @param {boolean} [opts.worked=true]
   * @param {string|null} [opts.better=null] 更优的方案
   */
  feedback(id, { worked = true, better = null } = {}) {
    if (!Number.isInteger(id) || id <= 0) return false
    try {
      if (worked) {
        this.db.prepare(`
          UPDATE experience
          SET feedback_pos = feedback_pos + 1,
              confidence = MIN(?, confidence + ?),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(CONFIDENCE_CEIL, FEEDBACK_POS_DELTA, id)
      } else {
        this.db.prepare(`
          UPDATE experience
          SET feedback_neg = feedback_neg + 1,
              confidence = MAX(?, confidence - ?),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(CONFIDENCE_FLOOR, FEEDBACK_NEG_DELTA, id)
        if (better) {
          this.record({ trigger: better, action: 'better_approach', result: 'pending', learned: better, confidence: DEFAULT_CONFIDENCE, source: 'manual' })
        }
      }
      return true
    } catch (err) {
      console.warn('[experience-library] feedback failed:', err?.message || err)
      return false
    }
  }

  /** 列出所有经验（调试用，limit 默认 100） */
  list({ limit = 100, minConfidence = 0 } = {}) {
    try {
      return this.db.prepare(`
        SELECT * FROM experience
        WHERE confidence >= ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(minConfidence, limit).map(r => this._rowToExp(r))
    } catch {
      return []
    }
  }

  /** 统计信息 */
  stats() {
    try {
      const total = this.db.prepare('SELECT COUNT(*) AS c FROM experience').get()?.c || 0
      const avgConf = this.db.prepare('SELECT AVG(confidence) AS a FROM experience').get()?.a || 0
      const bySource = this.db.prepare(`
        SELECT source, COUNT(*) AS c FROM experience GROUP BY source
      `).all()
      return { total, avgConfidence: Number(avgConf) || 0, bySource }
    } catch {
      return { total: 0, avgConfidence: 0, bySource: [] }
    }
  }
}

// 单例 helper
let _instance = null
export function getExperienceLibrary(opts = {}) {
  if (!_instance) _instance = new ExperienceLibrary(opts)
  return _instance
}

export function resetExperienceLibraryForTest() {
  _instance = null
}

// 导出常量（供外部 / 测试引用）
export const EXPERIENCE_CONSTANTS = Object.freeze({
  SCHEMA_VERSION,
  DEFAULT_CONFIDENCE,
  FEEDBACK_POS_DELTA,
  FEEDBACK_NEG_DELTA,
  CONFIDENCE_CEIL,
  CONFIDENCE_FLOOR,
})
