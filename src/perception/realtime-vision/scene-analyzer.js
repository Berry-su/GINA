// scene-analyzer.js — 场景理解（VLM 串接）
//
// 定位：拿到一帧（变化检测后）→ 调 VLM 描述"老板当前在看什么"。
// 跟 multimodal/vlm.js 共用，但专门为实时场景优化：
//   - 短 prompt（"描述这张图"）
//   - 超时（2s），超时就丢弃
//   - 缓存（同图不重 VLM）
//
// 硬约束：
//   - 不持久化原始帧（prompt 只发 image，不缓存像素到 disk）
//   - emotion-isolation：场景描述只进文本流
//   - 注入 VLM（不硬编码 GPT-4o / Qwen）

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_CACHE_MAX = 20

// ─── 状态 ───────────────────────────────────────────────────

export function defaultAnalyzerState(options = {}) {
  return {
    cacheMax: options.cacheMax || DEFAULT_CACHE_MAX,
    cache: new Map(),  // frame hash → description
    analyzeCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    lastAnalyzeAt: null,
    lastDescription: null,
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function trimCache(cache, max) {
  if (cache.size <= max) return
  // 简单 LRU：删最早的
  const firstKey = cache.keys().next().value
  if (firstKey) cache.delete(firstKey)
}

// ─── Mock 描述器（测试用） ─────────────────────────────────

export function createMockDescriber(options = {}) {
  const desc = options.description || 'mock scene'
  return {
    type: 'mock',
    async describe(frame, opts = {}) {
      return { description: desc, confidence: 0.8, mock: true }
    },
  }
}

// ─── 主导出：分析单帧 ──────────────────────────────────────

//   options: { describer, state, frame, frameHash, timeoutMs }
//   describer: 必须有 describe(frame) → { description, confidence } | async
//   返回: { description, confidence, cached, durationMs, error }
export async function analyzeScene(options = {}) {
  const state = options.state || defaultAnalyzerState()
  const describer = options.describer
  const frame = options.frame
  const hash = options.frameHash
  if (!describer || typeof describer.describe !== 'function') {
    return { description: null, confidence: 0, cached: false, error: 'describer required' }
  }
  if (!frame && !hash) {
    return { description: null, confidence: 0, cached: false, error: 'frame or frameHash required' }
  }
  const start = Date.now()
  // 缓存查
  if (hash && state.cache.has(hash)) {
    state.cacheHits += 1
    const cached = state.cache.get(hash)
    return {
      description: cached.description,
      confidence: cached.confidence,
      cached: true,
      durationMs: 0,
    }
  }
  state.cacheMisses += 1
  // 调 VLM（带超时）
  try {
    const result = await Promise.race([
      describer.describe(frame, { hash }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('analyze timeout')), options.timeoutMs || state.timeoutMs)),
    ])
    const description = result?.description || null
    const confidence = typeof result?.confidence === 'number' ? result.confidence : 0
    // 缓存
    if (hash && description) {
      state.cache.set(hash, { description, confidence })
      trimCache(state.cache, state.cacheMax)
    }
    state.analyzeCount += 1
    state.lastAnalyzeAt = Date.now()
    state.lastDescription = description
    return {
      description,
      confidence,
      cached: false,
      durationMs: Date.now() - start,
    }
  } catch (e) {
    return {
      description: null,
      confidence: 0,
      cached: false,
      durationMs: Date.now() - start,
      error: e?.message || String(e),
    }
  }
}

// 重置缓存
export function clearCache(state) {
  if (state && state.cache) state.cache.clear()
  return state
}

// 概览
export function getAnalyzerStats(state) {
  return {
    analyzeCount: state.analyzeCount || 0,
    cacheHits: state.cacheHits || 0,
    cacheMisses: state.cacheMisses || 0,
    cacheSize: state.cache?.size || 0,
    cacheMax: state.cacheMax,
    lastAnalyzeAt: state.lastAnalyzeAt,
    lastDescription: state.lastDescription,
  }
}

export {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CACHE_MAX,
}
