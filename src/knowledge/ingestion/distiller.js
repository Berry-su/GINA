// src/knowledge/ingestion/distiller.js —— LLM 蒸馏（chunk → facts + 关键概念）
//
// 策略：每 chunk 调一次 LLM，提取 5-10 核心 facts + 关键概念
// 失败处理：LLM 调用失败 → 抛 IngestionError，带 step='distilling' + chunk 索引
//
// 关联 ADR-004 §3.2.3

const DEFAULT_TARGET_FACTS = 5
const MAX_TARGET_FACTS = 10

const DISTILL_SYSTEM_PROMPT = `你是一个知识蒸馏专家。从给定文本块中提取 5-10 条核心事实（facts）和 3-5 个关键概念（concepts）。

严格返回 JSON 格式：
{
  "facts": [
    {"text": "事实描述（不超过 100 字）", "importance": 0.0-1.0}
  ],
  "concepts": ["概念1", "概念2", "概念3"]
}

要求：
1. facts 是陈述性事实（不是问题或观点）
2. importance 反映 fact 的"对全书知识体系的价值"
3. concepts 是从 fact 抽出的"可被独立检索的关键概念"，如 "市场情绪"、"止损纪律"
4. 不输出 JSON 以外的内容
5. 文本与知识无关时返回空数组
`

/**
 * 蒸馏一个 chunk
 * @param {object} llm 主仓 LLM 接口 { chat: async ({system, user, temperature, responseFormat}) => ... }
 * @param {{text: string, chapter: string, charCount: number}} chunk
 * @param {object} [opts]
 * @param {number} [opts.targetFacts=5]
 * @param {number} [opts.chunkIndex]
 * @param {object} [opts.signal] AbortSignal
 * @returns {Promise<{facts: Array, concepts: string[]}>}
 */
export async function distillChunk(llm, chunk, { targetFacts = DEFAULT_TARGET_FACTS, chunkIndex = -1, signal = null } = {}) {
  if (!llm || typeof llm.chat !== 'function') {
    throw new Error('distillChunk: llm.chat is not a function')
  }
  const text = String(chunk?.text || '').trim()
  if (!text) {
    return { facts: [], concepts: [] }
  }
  if (text.length > 8000) {
    // 截断防止单 chunk 超 LLM 限制
    return await _distillOne(llm, text.slice(0, 8000) + '\n[...截断...]', chunk, targetFacts, chunkIndex, signal)
  }
  return await _distillOne(llm, text, chunk, targetFacts, chunkIndex, signal)
}

async function _distillOne(llm, text, chunk, targetFacts, chunkIndex, signal) {
  const userMsg = `章节：${chunk.chapter || '(无)'}\n\n文本块：\n${text}\n\n请提取 ${targetFacts}-${MAX_TARGET_FACTS} 条核心 facts 和 3-5 个关键概念。返回严格 JSON。`
  try {
    const result = await llm.chat({
      system: DISTILL_SYSTEM_PROMPT,
      user: userMsg,
      temperature: 0.1,
      responseFormat: 'json',
      signal,
    })
    const parsed = _parseLlmJson(result)
    if (!parsed) {
      throw new Error(`LLM 返回非 JSON: ${String(result).slice(0, 200)}`)
    }
    const facts = Array.isArray(parsed.facts) ? parsed.facts.slice(0, MAX_TARGET_FACTS).map(f => ({
      text: String(f?.text || '').slice(0, 500),
      importance: Math.max(0, Math.min(1, Number(f?.importance) || 0.5)),
    })).filter(f => f.text) : []
    const concepts = Array.isArray(parsed.concepts) ? parsed.concepts.slice(0, 5).map(c => String(c || '').trim()).filter(Boolean) : []
    return { facts, concepts }
  } catch (err) {
    if (signal?.aborted) throw err
    throw new Error(`distill chunk ${chunkIndex} failed: ${err?.message || err}`)
  }
}

/**
 * 蒸馏多个 chunks（带并发控制）
 * @param {object} llm
 * @param {Array} chunks
 * @param {object} [opts]
 * @param {number} [opts.concurrency=3]
 * @param {function} [opts.onProgress] (i, total, result) => void
 * @param {object} [opts.signal]
 * @returns {Promise<Array<{chunkIndex, facts, concepts, chunk}>>}
 */
export async function distillChunks(llm, chunks, { concurrency = 3, onProgress = null, signal = null, throwOnAllFail = true } = {}) {
  const results = new Array(chunks.length)
  let nextIdx = 0
  async function worker() {
    while (true) {
      const i = nextIdx++
      if (i >= chunks.length) return
      if (signal?.aborted) return
      const chunk = chunks[i]
      try {
        const r = await distillChunk(llm, chunk, { chunkIndex: i, signal })
        results[i] = { chunkIndex: i, chunk, ...r }
      } catch (err) {
        if (signal?.aborted) return
        results[i] = { chunkIndex: i, chunk, facts: [], concepts: [], error: err.message }
      }
      if (onProgress) onProgress(i + 1, chunks.length, results[i])
    }
  }
  const workers = []
  for (let i = 0; i < concurrency; i++) workers.push(worker())
  await Promise.all(workers)
  // 如果所有 chunk 都失败，抛 IngestionError（让 pipeline 不静默）
  if (throwOnAllFail) {
    const failedCount = results.filter(r => r && r.error).length
    if (failedCount > 0 && failedCount === results.length) {
      const sample = results[0]?.error || 'unknown'
      throw new Error(`all ${results.length} chunks failed to distill. First error: ${sample}`)
    }
  }
  return results
}

function _parseLlmJson(result) {
  if (!result) return null
  if (typeof result === 'object' && Array.isArray(result.facts)) return result
  if (typeof result === 'object' && 'content' in result) {
    return _parseLlmJson(result.content)
  }
  if (typeof result === 'string') {
    // 尝试从 markdown code block 提取
    const m = result.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
    const text = m ? m[1] : result
    try { return JSON.parse(text) } catch { return null }
  }
  return null
}
