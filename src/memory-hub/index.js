/**
 * 统一记忆中枢 MemoryHub（迁移集成 · 完美融合层）
 *
 * 目标：让「个人记忆 / 知识记忆 / CATS-Net 抽象空间」三处合一，暴露统一访问接口，
 * 供分析师团队、交易风控、危机顾问、知识顾问等所有下游模块共享「同一个大脑记忆」。
 *
 * 设计原则：
 *   - 唯一持久化真源 = jarvis.db 的 memories 表（复用主体已有 insertMemory 等 API，不新建表、不改 schema）；
 *   - 知识记忆 event_type='knowledge'，个人/观察记忆 event_type='observation'；
 *   - CATS-Net 作为「概念抽象 + 记忆投影」层；
 *   - retrieve() 统一召回：jarvis.db 全文/概念命中 + CATS-Net 抽象空间痕迹，合并去重排序。
 *
 * 容错：所有数据库/CATS-Net 调用包 try/catch，内核或数据库不可用时降级不崩。
 */

import { CatsNet } from '../cats_net/index.js'
import {
  insertMemory,
  searchMemories,
  getMemoriesByEntity,
} from '../capabilities/db.js'

const KNOWLEDGE_SOURCES = new Set([
  'market_case', 'investment_book', 'investment_technique', 'investor_case', 'seed_knowledge',
])

function safeParse(v, fallback = []) {
  if (Array.isArray(v)) return v
  if (typeof v !== 'string') return fallback
  try {
    const p = JSON.parse(v)
    return Array.isArray(p) ? p : fallback
  } catch {
    return fallback
  }
}

export class MemoryHub {
  /**
   * @param {object} [options]
   * @param {CatsNet|null} [options.catsNet] CATS-Net 实例（缺省新建）
   */
  constructor({ catsNet = null } = {}) {
    this.catsNet = catsNet ?? new CatsNet({ maxIterations: 200, timeoutMs: 10000 })
    this._aborted = false
  }

  abort() { this._aborted = true; return this }
  clearAbort() { this._aborted = false; return this }
  isAborted() { return this._aborted }
  hasAbstractSpace() { return !!this.catsNet }

  /**
   * 写入一条观察/知识进入统一记忆（jarvis.db memories 表）。
   * @param {object} obs
   * @returns {object|null}
   */
  addObservation(obs = {}) {
    if (this._aborted) return null
    const content = typeof obs.content === 'string' ? obs.content : ''
    if (!content) return null
    const concepts = Array.isArray(obs.concepts) ? obs.concepts : []
    const tags = Array.isArray(obs.tags) ? obs.tags : []
    const source = typeof obs.source === 'string' ? obs.source : 'observation'
    const eventType = KNOWLEDGE_SOURCES.has(source) ? 'knowledge' : 'observation'
    const salience = 1 + Math.round((Number.isFinite(obs.importance) ? obs.importance : 1) * 4)

    try {
      insertMemory({
        event_type: eventType,
        content,
        detail: '',
        title: content.slice(0, 60),
        mem_id: typeof obs.id === 'string' && obs.id ? obs.id : undefined,
        concepts,
        tags: [source, ...tags],
        salience,
        timestamp: new Date().toISOString(),
      })
      console.log(`[memory-hub] 写入统一记忆: ${eventType} concepts=[${concepts.join(',')}]`)
      return { id: obs.id ?? null, content }
    } catch (err) {
      console.log(`[memory-hub] 写入降级(数据库不可用): ${err.message}`)
      return null
    }
  }

  /**
   * 统一检索：jarvis.db 全文/概念命中 + CATS-Net 抽象空间痕迹。
   * @param {string[]|string} query 概念 id 或标签/关键词
   * @param {object} [options]
   * @returns {Array<{layer:string, entry:object, score:number}>}
   */
  retrieve(query = [], { limit = 10 } = {}) {
    if (this._aborted) return []
    const words = (Array.isArray(query) ? query : [query]).filter((x) => typeof x === 'string' && x)

    // 1) jarvis.db 全文检索（FTS5 命中 title/content/concepts/tags）
    let results = []
    if (words.length > 0) {
      try {
        const hits = searchMemories(words.join(' '), limit)
        for (const m of hits) results.push({ layer: 'longTerm', entry: this._toEntry(m), score: 0.85 })
      } catch { /* 降级 */ }
      // 2) 概念 JSON 精确命中
      try {
        for (const c of words) {
          for (const m of getMemoriesByEntity(c, limit)) {
            results.push({ layer: 'longTerm', entry: this._toEntry(m), score: 0.9 })
          }
        }
      } catch { /* 降级 */ }
    }

    // 3) CATS-Net 抽象空间记忆痕迹
    try {
      if (this.catsNet && typeof this.catsNet.retrieveMemory === 'function') {
        const abs = this.catsNet.retrieveMemory(words, { limit, minScore: 0 })
        for (const h of abs) {
          results.push({
            layer: 'abstract',
            entry: { id: h.entry.id, label: h.entry.label, content: h.entry.content, concepts: h.entry.concepts ?? [] },
            score: h.score ?? 0,
          })
        }
      }
    } catch { /* 降级 */ }

    // 去重 + 排序
    const seen = new Set()
    const uniq = []
    for (const r of results) {
      const key = r.entry?.label || r.entry?.content || r.entry?.id
      if (!key || seen.has(key)) continue
      seen.add(key)
      uniq.push(r)
    }
    uniq.sort((a, b) => b.score - a.score)
    return uniq.slice(0, limit)
  }

  stats() {
    return { hasAbstractSpace: this.hasAbstractSpace(), aborted: this._aborted }
  }

  _toEntry(m) {
    return {
      id: m.mem_id ?? String(m.id ?? ''),
      label: m.title || String(m.content ?? '').slice(0, 40),
      content: m.content ?? '',
      concepts: safeParse(m.concepts),
      tags: safeParse(m.tags),
      strength: (Number(m.salience) || 3) / 5,
      eventType: m.event_type ?? 'observation',
    }
  }
}

let _hub = null

/** 获取全局 MemoryHub 单例。 */
export function getMemoryHub(catsNet = null) {
  if (!_hub) _hub = new MemoryHub({ catsNet })
  return _hub
}