// src/knowledge/ingestion/pipeline.js —— 5 阶段 pipeline 编排
//
// 流程：parse → chunk → distill → graph → store
// 失败不静默：抛 IngestionError 带 step + source + 补救路径
// 关联 ADR-004 §3.2.2

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { parsePdf } from './parsers/pdf.js'
import { parseEpub } from './parsers/epub.js'
import { parseMd } from './parsers/md.js'
import { chunkText } from './chunker.js'
import { distillChunks } from './distiller.js'
import { graphFromFacts } from './grapher.js'
import { storeIngestion } from './storage.js'

export class IngestionError extends Error {
  constructor(message, step, source, recoverable = true) {
    super(`[ingestion ${step}] ${source}: ${message}`)
    this.name = 'IngestionError'
    this.step = step
    this.source = source
    this.recoverable = recoverable
  }
}

const STATUS_STATES = ['idle', 'parsing', 'chunking', 'distilling', 'graphing', 'storing', 'done', 'error', 'cancelled']

export class IngestionPipeline {
  /**
   * @param {object} opts
   * @param {object} opts.llm 主仓 LLM 接口（必填）
   * @param {object} [opts.catsNet] CATS-Net 实例
   * @param {object} [opts.db] SQLite DB 实例
   * @param {object} [opts.embedding] 可选本地 embedding 模块
   * @param {object} [opts.direction] 可选方向控制器 { get() }
   * @param {number} [opts.concurrency=3] 蒸馏并发数
   */
  constructor({ llm, catsNet = null, db = null, embedding = null, direction = null, concurrency = 3 } = {}) {
    if (!llm || typeof llm.chat !== 'function') {
      throw new Error('IngestionPipeline requires llm with chat()')
    }
    this.llm = llm
    this.catsNet = catsNet
    this.db = db
    this.embedding = embedding
    this.direction = direction
    this.concurrency = concurrency
    this._status = { state: 'idle', progress: 0, currentFile: null, startedAt: null, finishedAt: null, error: null }
    this._abortController = null
  }

  status() {
    return { ...this._status }
  }

  cancel() {
    if (this._abortController) {
      this._abortController.abort()
    }
    this._setStatus('cancelled', this._status.progress, this._status.currentFile)
  }

  /**
   * 消化一个文件
   * @param {object} opts
   * @param {string} opts.path
   * @param {string} [opts.topic=null]
   * @param {string} [opts.source='file']
   * @returns {Promise<{nodes: number, facts: number, relations: number, duration: number, chapters: number}>}
   */
  async ingestFile({ path: filePath, topic = null, source = 'file' } = {}) {
    if (!filePath) throw new IngestionError('path is required', 'start', '(none)')
    this._abortController = new AbortController()
    const signal = this._abortController.signal
    const t0 = Date.now()
    this._setStatus('parsing', 0.1, filePath)

    let parsed
    try {
      parsed = await this._parseByPath(filePath)
    } catch (err) {
      this._setStatus('error', 0, filePath, err.message)
      throw new IngestionError(err.message, 'parsing', filePath)
    }
    if (signal.aborted) throw new IngestionError('cancelled', 'parsing', filePath)

    this._setStatus('chunking', 0.3, filePath)
    const chunks = chunkText(parsed, { embedding: this.embedding })
    if (signal.aborted) throw new IngestionError('cancelled', 'chunking', filePath)

    this._setStatus('distilling', 0.5, filePath)
    const direction = this.direction?.get?.()?.topic || null
    const directionBoost = direction && topic && _similarity(direction, topic) > 0.3 ? 0.1 : 0
    let distilled
    try {
      distilled = await distillChunks(this.llm, chunks, {
        concurrency: this.concurrency,
        signal,
        onProgress: (done, total) => {
          this._setStatus('distilling', 0.5 + 0.2 * (done / Math.max(1, total)), filePath)
        },
      })
    } catch (err) {
      this._setStatus('error', 0, filePath, err.message)
      throw new IngestionError(err.message, 'distilling', filePath, false)
    }
    if (signal.aborted) throw new IngestionError('cancelled', 'distilling', filePath)

    this._setStatus('graphing', 0.75, filePath)
    const { nodes, relations } = graphFromFacts(distilled, { topic, directionBoost })
    if (signal.aborted) throw new IngestionError('cancelled', 'graphing', filePath)

    this._setStatus('storing', 0.85, filePath)
    let stored
    try {
      const allFacts = []
      for (const d of distilled) {
        if (Array.isArray(d.facts)) allFacts.push(...d.facts)
      }
      stored = await storeIngestion({
        nodes, facts: allFacts, path: filePath, topic, source,
        catsNet: this.catsNet, db: this.db, embedding: this.embedding,
      })
    } catch (err) {
      this._setStatus('error', 0, filePath, err.message)
      throw new IngestionError(err.message, 'storing', filePath, false)
    }

    this._setStatus('done', 1, filePath)
    return {
      nodes: nodes.length,
      catsNetNodes: stored.catsNetNodes,
      memories: stored.memories,
      facts: allFacts_count(distilled),
      relations: relations.length,
      chunks: chunks.length,
      chapters: parsed.chapters?.length || 0,
      duration: Date.now() - t0,
    }
  }

  /**
   * 消化纯文本
   * @param {object} opts
   * @param {string} opts.text
   * @param {string} [opts.topic=null]
   * @param {string} [opts.source='text']
   * @returns {Promise<{...}>}
   */
  async ingestText({ text, topic = null, source = 'text' } = {}) {
    if (!text) throw new IngestionError('text is required', 'start', '(none)')
    this._abortController = new AbortController()
    const signal = this._abortController.signal
    const t0 = Date.now()
    this._setStatus('parsing', 0.1, '(text)')

    // text 走 markdown 解析器
    const { parseMdText } = await import('./parsers/md.js')
    const parsed = await parseMdText(text)
    if (signal.aborted) throw new IngestionError('cancelled', 'parsing', '(text)')

    return await this._runAfterParse(parsed, { topic, source, t0, signal })
  }

  async _runAfterParse(parsed, { topic, source, t0, signal }) {
    this._setStatus('chunking', 0.3, this._status.currentFile || '(text)')
    const chunks = chunkText(parsed, { embedding: this.embedding })
    if (signal.aborted) throw new IngestionError('cancelled', 'chunking', this._status.currentFile || '(text)')

    this._setStatus('distilling', 0.5, this._status.currentFile || '(text)')
    const direction = this.direction?.get?.()?.topic || null
    const directionBoost = direction && topic && _similarity(direction, topic) > 0.3 ? 0.1 : 0
    let distilled
    try {
      distilled = await distillChunks(this.llm, chunks, { concurrency: this.concurrency, signal })
    } catch (err) {
      this._setStatus('error', 0, this._status.currentFile || '(text)', err.message)
      throw new IngestionError(err.message, 'distilling', this._status.currentFile || '(text)', false)
    }

    this._setStatus('graphing', 0.75, this._status.currentFile || '(text)')
    const { nodes, relations } = graphFromFacts(distilled, { topic, directionBoost })

    this._setStatus('storing', 0.85, this._status.currentFile || '(text)')
    const allFacts = []
    for (const d of distilled) {
      if (Array.isArray(d.facts)) allFacts.push(...d.facts)
    }
    const stored = await storeIngestion({
      nodes, facts: allFacts, path: this._status.currentFile || '(text)', topic, source,
      catsNet: this.catsNet, db: this.db, embedding: this.embedding,
    })

    this._setStatus('done', 1, this._status.currentFile || '(text)')
    return {
      nodes: nodes.length,
      catsNetNodes: stored.catsNetNodes,
      memories: stored.memories,
      facts: allFacts.length,
      relations: relations.length,
      chunks: chunks.length,
      chapters: parsed.chapters?.length || 0,
      duration: Date.now() - t0,
    }
  }

  async _parseByPath(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.pdf') return await parsePdf(filePath)
    if (ext === '.epub') return await parseEpub(filePath)
    if (ext === '.md' || ext === '.markdown') return await parseMd(filePath)
    if (ext === '.txt') {
      const raw = await fs.readFile(filePath, 'utf-8')
      const { parseMdText } = await import('./parsers/md.js')
      return await parseMdText(raw)
    }
    throw new Error(`unsupported file extension: ${ext}. Supported: .pdf .epub .md .markdown .txt`)
  }

  _setStatus(state, progress, currentFile, error = null) {
    if (!STATUS_STATES.includes(state)) return
    this._status = {
      ...this._status,
      state,
      progress: Math.max(0, Math.min(1, progress || 0)),
      currentFile: currentFile || this._status.currentFile,
      startedAt: this._status.startedAt || (state !== 'idle' ? Date.now() : null),
      finishedAt: ['done', 'error', 'cancelled'].includes(state) ? Date.now() : null,
      error: error || null,
    }
  }
}

function allFacts_count(distilled) {
  let n = 0
  for (const d of distilled) {
    if (Array.isArray(d.facts)) n += d.facts.length
  }
  return n
}

function _similarity(a, b) {
  if (!a || !b) return 0
  const A = String(a).toLowerCase()
  const B = String(b).toLowerCase()
  if (A === B) return 1
  if (A.includes(B) || B.includes(A)) return 0.6
  // Jaccard
  const aTokens = new Set(A.split(/\W+/).filter(Boolean))
  const bTokens = new Set(B.split(/\W+/).filter(Boolean))
  const inter = [...aTokens].filter(t => bTokens.has(t)).length
  const uni = new Set([...aTokens, ...bTokens]).size
  return uni > 0 ? inter / uni : 0
}
