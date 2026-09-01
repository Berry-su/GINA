// src/knowledge/ingestion/chunker.js —— 文本切分器
//
// 策略（按优先级）：
//   1. 章节边界（chapters 数组）→ 保留章节
//   2. 章节内按段落切（空行 \n\n）
//   3. 段 > 500 字符 → 句向量相似度切（用本地 embedding 算相邻句余弦）
//   4. 段 < 50 字符 → 跟下一段合并
// 目标：每段 200-500 字符
//
// 输出：chunks: [{text, chapter, startLine, endLine, charCount}]
//
// 关联 ADR-004 §3.2.3

const DEFAULT_TARGET_MIN = 200
const DEFAULT_TARGET_MAX = 500
const DEFAULT_MIN_CHUNK = 50
const MAX_CHUNK = 1500
const SENTENCE_SPLIT_RE = /[。.!?！？\n]+/g

/**
 * 主切分入口
 * @param {{text: string, chapters: Array, metadata: object}} parsed
 * @param {object} [opts]
 * @param {object} [opts.embedding] 可选本地 embedding 模块（用于句向量切分）
 * @param {number} [opts.targetMin=200]
 * @param {number} [opts.targetMax=500]
 * @returns {Array<{text, chapter, startLine, endLine, charCount}>}
 */
export function chunkText(parsed, { embedding = null, targetMin = DEFAULT_TARGET_MIN, targetMax = DEFAULT_TARGET_MAX } = {}) {
  const text = String(parsed?.text || '')
  const chapters = Array.isArray(parsed?.chapters) && parsed.chapters.length > 0
    ? parsed.chapters
    : [{ title: '(全文)', startLine: 0, endLine: text.split('\n').length - 1 }]
  const lines = text.split('\n')

  const chunks = []
  for (const ch of chapters) {
    const chapterText = lines.slice(ch.startLine, ch.endLine + 1).join('\n')
    if (!chapterText.trim()) continue
    // 1. 按段落切
    const paragraphs = chapterText.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean)
    // 2. 短段合并
    const merged = _mergeShort(paragraphs, DEFAULT_MIN_CHUNK)
    // 3. 长段切分（用句向量 或 简单按句切）
    for (const m of merged) {
      if (m.length <= MAX_CHUNK) {
        chunks.push({
          text: m,
          chapter: ch.title,
          startLine: ch.startLine,
          endLine: ch.endLine,
          charCount: m.length,
        })
      } else {
        const sub = embedding
          ? _splitByEmbedding(m, targetMin, targetMax, embedding)
          : _splitBySentence(m, targetMin, targetMax)
        for (const s of sub) {
          chunks.push({
            text: s,
            chapter: ch.title,
            startLine: ch.startLine,
            endLine: ch.endLine,
            charCount: s.length,
          })
        }
      }
    }
  }
  return chunks
}

function _mergeShort(paragraphs, minLen) {
  const out = []
  let buf = ''
  for (const p of paragraphs) {
    if (p.length < minLen) {
      buf = buf ? `${buf}\n\n${p}` : p
    } else {
      if (buf) {
        out.push(`${buf}\n\n${p}`)
        buf = ''
      } else {
        out.push(p)
      }
    }
  }
  if (buf) out.push(buf)
  return out
}

function _splitBySentence(text, minLen, maxLen) {
  const sentences = text.split(SENTENCE_SPLIT_RE).map(s => s.trim()).filter(Boolean)
  if (sentences.length === 0) return [text]
  const out = []
  let buf = ''
  for (const s of sentences) {
    if (!buf) {
      buf = s
    } else if ((buf + ' ' + s).length <= maxLen) {
      buf = buf + ' ' + s
    } else {
      if (buf.length >= minLen) {
        out.push(buf)
        buf = s
      } else {
        buf = buf + ' ' + s
      }
    }
  }
  if (buf) out.push(buf)
  return out.length > 0 ? out : [text]
}

async function _splitByEmbedding(text, minLen, maxLen, embedding) {
  // 降级到 sentence 切分（embedding 不可用或失败时）
  if (!embedding || typeof embedding.computeEmbedding !== 'function') {
    return _splitBySentence(text, minLen, maxLen)
  }
  try {
    const sentences = text.split(SENTENCE_SPLIT_RE).map(s => s.trim()).filter(Boolean)
    if (sentences.length < 2) return [text]
    // 算每句 embedding
    const vectors = []
    for (const s of sentences) {
      const v = await embedding.computeEmbedding(s)
      vectors.push(v || [])
    }
    // 算相邻句余弦相似度，在相似度 < 0.4 处切
    const THRESHOLD = 0.4
    const breaks = new Set([0, sentences.length])
    for (let i = 1; i < sentences.length; i++) {
      const sim = _cosine(vectors[i - 1], vectors[i])
      if (sim < THRESHOLD) breaks.add(i)
    }
    const sortedBreaks = [...breaks].sort((a, b) => a - b)
    const out = []
    for (let i = 0; i < sortedBreaks.length - 1; i++) {
      const from = sortedBreaks[i]
      const to = sortedBreaks[i + 1]
      const seg = sentences.slice(from, to).join('。')
      if (seg.trim()) out.push(seg)
    }
    return out.length > 0 ? out : [text]
  } catch {
    return _splitBySentence(text, minLen, maxLen)
  }
}

function _cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d > 0 ? dot / d : 0
}
