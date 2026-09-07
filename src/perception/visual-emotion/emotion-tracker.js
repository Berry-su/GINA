// emotion-tracker.js — 表情跟踪 + 稳定化（滑动窗口）
//
// 定位：单帧人脸表情容易"跳"（neutral → happy → neutral 在 100ms 内）。
// 用滑动窗口（默认 5 帧 = ~2.5s）+ 加权平均，得到稳定输出。
//
// 硬约束:
//   - 仅当 ≥ MIN_FRAMES 帧时输出稳定值（否则返回 null）
//   - 加权：最近帧权重更高（指数衰减）
//   - 没人脸时输出 null（不强行猜）
//   - 旧窗口自动清理

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_WINDOW_SIZE = 5
const MIN_FRAMES_FOR_OUTPUT = 3
const MAX_AGE_MS = 10_000  // 窗口内最大帧间隔
const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'disgusted', 'fearful']

// ─── 状态 ───────────────────────────────────────────────────

export function defaultTrackerState(options = {}) {
  return {
    windowSize: options.windowSize || DEFAULT_WINDOW_SIZE,
    frames: [],   // [{at, expressions: {neutral: 0.x, ...}, faceCount, confidence}]
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function expDecay(ageMs, halfLifeMs) {
  // 指数衰减：age=0 → 1，age=halfLife → 0.5
  if (ageMs < 0) return 1
  return Math.pow(0.5, ageMs / halfLifeMs)
}

function pruneOldFrames(frames, now, maxAgeMs) {
  return frames.filter(f => typeof f.at === 'number' && (now - f.at) < maxAgeMs)
}

function trimToWindow(frames, size) {
  if (frames.length <= size) return frames
  return frames.slice(-size)
}

function aggregateExpressions(frames, now) {
  // 加权平均（最近帧权重高，halfLife 1.5s）
  const halfLifeMs = 1500
  const result = {}
  for (const expr of EXPRESSIONS) result[expr] = 0
  let totalWeight = 0
  for (const f of frames) {
    const age = now - f.at
    if (age < 0) continue
    const w = expDecay(age, halfLifeMs)
    if (!f.expressions) continue
    for (const expr of EXPRESSIONS) {
      const v = typeof f.expressions[expr] === 'number' ? f.expressions[expr] : 0
      result[expr] += v * w
    }
    totalWeight += w
  }
  if (totalWeight <= 0) return null
  for (const expr of EXPRESSIONS) {
    result[expr] = result[expr] / totalWeight
  }
  return result
}

function dominantExpression(expressions) {
  if (!expressions) return null
  let best = null
  let bestScore = -1
  for (const [expr, score] of Object.entries(expressions)) {
    if (typeof score === 'number' && score > bestScore) {
      bestScore = score
      best = expr
    }
  }
  return best
}

// ─── 公开 API ───────────────────────────────────────────────

// 添加一帧的表情到滑动窗口
//   options: { state, expressions, faceCount, confidence, now }
export function addFrame(options = {}) {
  const state = options.state || defaultTrackerState()
  if (!options.expressions || typeof options.expressions !== 'object') return state
  const now = typeof options.now === 'number' ? options.now : Date.now()
  state.frames = trimToWindow(
    pruneOldFrames(state.frames, now, MAX_AGE_MS),
    state.windowSize,
  )
  state.frames.push({
    at: now,
    expressions: options.expressions,
    faceCount: typeof options.faceCount === 'number' ? options.faceCount : 1,
    confidence: typeof options.confidence === 'number' ? options.confidence : 0,
  })
  return state
}

// 获取当前稳定表情
//   options: { state, now }
//   返回: { dominant, scores, confidence, frameCount, stable } | null
export function getStableEmotion(options = {}) {
  const state = options.state || defaultTrackerState()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const fresh = trimToWindow(
    pruneOldFrames(state.frames, now, MAX_AGE_MS),
    state.windowSize,
  )
  if (fresh.length < MIN_FRAMES_FOR_OUTPUT) {
    return null
  }
  const scores = aggregateExpressions(fresh, now)
  if (!scores) return null
  const dominant = dominantExpression(scores)
  const confidence = scores[dominant] || 0
  // confidence 高的才标 stable
  const stable = confidence >= 0.4
  return {
    dominant,
    scores,
    confidence,
    frameCount: fresh.length,
    stable,
  }
}

// 重置窗口
export function resetTracker(state) {
  state.frames = []
  return state
}

// 设置窗口大小
export function setWindowSize(state, size) {
  if (typeof size === 'number' && size > 0) {
    state.windowSize = Math.floor(size)
    state.frames = trimToWindow(state.frames, state.windowSize)
  }
  return state
}

export {
  DEFAULT_WINDOW_SIZE,
  MIN_FRAMES_FOR_OUTPUT,
  MAX_AGE_MS,
  aggregateExpressions,
  dominantExpression,
  EXPRESSIONS,
}
