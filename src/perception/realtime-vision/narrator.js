// narrator.js — 边看边说触发器
//
// 定位：scene-analyzer 检测到场景变化 ≥30% 后，是否主动开口？
// 老板 9-07 14:25 拍板：30% 变化才主动开口。
//
// 硬约束（老板 9-07 翻身纪律 + 主动预判纪律）：
//   - 默认不主动发消息，只 emit `realtime:observation` 事件
//   - 必须 humanApproved=true 才直接说（dryRun 默认）
//   - silent 模式 / 离线 / 锁屏 → 完全关闭
//   - 30 分钟内同描述不重复（cooldown）
//   - 老板说"别说话" → 立即停

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000  // 30 分钟
const MIN_CONFIDENCE = 0.5
const DEFAULT_MIN_CHANGE_SCORE = 0.3          // 30% 变化
const MAX_HISTORY = 64

// ─── 状态 ───────────────────────────────────────────────────

export function defaultNarratorState(options = {}) {
  return {
    cooldownMs: options.cooldownMs || DEFAULT_COOLDOWN_MS,
    minConfidence: options.minConfidence || MIN_CONFIDENCE,
    minChangeScore: options.minChangeScore || DEFAULT_MIN_CHANGE_SCORE,
    enabled: options.enabled !== false,
    silent: options.silent === true,
    humanApproved: options.humanApproved === true,
    lastObservations: [],   // [{hash, description, at, score}]
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function trimHistory(arr, max) {
  if (arr.length <= max) return arr
  return arr.slice(-max)
}

function pruneCooldown(arr, cooldownMs, now) {
  return arr.filter(o => typeof o.at === 'number' && (now - o.at) < cooldownMs)
}

// ─── 主导出：决定是否开口 ──────────────────────────────────

//   options: {
//     state, observation: { description, confidence, changeScore, hash },
//     userActivity: { online, screenLocked },
//     now,
//   }
//   返回: { shouldNarrate, reason, narrateType, observation }
export function shouldNarrate(options = {}) {
  const state = options.state || defaultNarratorState()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const obs = options.observation || {}
  const userActivity = options.userActivity || { online: true, screenLocked: false }

  // 1) silent 模式
  if (state.silent) {
    return { shouldNarrate: false, reason: 'silent mode', narrateType: 'silent', observation: obs }
  }
  // 2) 离线 / 锁屏
  if (userActivity.online === false || userActivity.screenLocked === true) {
    return { shouldNarrate: false, reason: 'user offline or screen locked', narrateType: 'silent', observation: obs }
  }
  // 3) disabled
  if (state.enabled === false) {
    return { shouldNarrate: false, reason: 'narrator disabled', narrateType: 'silent', observation: obs }
  }
  // 4) 没观察
  if (!obs.description) {
    return { shouldNarrate: false, reason: 'no observation', narrateType: 'silent', observation: obs }
  }
  // 5) 变化度门槛
  const score = clamp01(obs.changeScore != null ? obs.changeScore : 1)
  if (score < state.minChangeScore) {
    return { shouldNarrate: false, reason: `change score ${score.toFixed(2)} < ${state.minChangeScore}`, narrateType: 'silent', observation: obs }
  }
  // 6) confidence 门槛
  const conf = clamp01(obs.confidence != null ? obs.confidence : 0)
  if (conf < state.minConfidence) {
    return { shouldNarrate: false, reason: `confidence ${conf.toFixed(2)} < ${state.minConfidence}`, narrateType: 'silent', observation: obs }
  }
  // 7) dedup + cooldown
  const recent = pruneCooldown(state.lastObservations, state.cooldownMs, now)
  const dup = recent.find(o => o.hash === obs.hash || o.description === obs.description)
  if (dup) {
    return { shouldNarrate: false, reason: 'duplicate (cooldown)', narrateType: 'silent', observation: obs }
  }
  // 8) 决定 narrateType
  let narrateType = 'log'
  if (state.humanApproved === true) {
    narrateType = 'speak'
  }
  // 9) 记录
  const record = {
    hash: obs.hash || null,
    description: obs.description,
    at: now,
    score,
    confidence: conf,
  }
  state.lastObservations = trimHistory([...recent, record], MAX_HISTORY)
  return {
    shouldNarrate: true,
    reason: `change ${score.toFixed(2)}, conf ${conf.toFixed(2)}`,
    narrateType,
    observation: obs,
  }
}

// ─── 状态管理 ──────────────────────────────────────────────

export function setSilent(state, silent = true) {
  state.silent = silent
  return state
}

export function setEnabled(state, enabled = true) {
  state.enabled = enabled
  return state
}

export function setHumanApproved(state, approved = true) {
  state.humanApproved = approved
  return state
}

export function clearHistory(state) {
  state.lastObservations = []
  return state
}

export function getHistory(state) {
  return state.lastObservations || []
}

export {
  DEFAULT_COOLDOWN_MS,
  MIN_CONFIDENCE,
  DEFAULT_MIN_CHANGE_SCORE,
  MAX_HISTORY,
}
