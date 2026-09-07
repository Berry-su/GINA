// suggester.js — 主动开口建议器
//
// 定位：把 predictor 的预判结果转成"是否主动开口"的判断。
//
// 硬约束（老板 9-07 拍板 + 9-07 翻身纪律）:
//   - **默认不主动发消息**：只 emit `anticipation:suggested` 事件
//   - 老板说"别打扰" → 降级到只 log，不 emit
//   - 预判错时不重复（dedup by content hash + cooldown 30 min）
//   - 老板不在线 / 屏幕锁 → 完全关闭
//
// 输入: predict() 输出
// 输出: { shouldSuggest, intent, reason, suggestType: 'emit' | 'log' | 'silent' }

import { createHash } from 'node:crypto'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000  // 30 分钟
const MIN_CONFIDENCE_TO_SUGGEST = 0.5
const MIN_CONFIDENCE_TO_EMIT = 0.65
const MAX_HISTORY = 128  // 已 emit 过的建议历史

// ─── 状态 ───────────────────────────────────────────────────

export function defaultSuggesterState(options = {}) {
  return {
    version: 1,
    cooldownMs: options.cooldownMs || DEFAULT_COOLDOWN_MS,
    minConfidence: options.minConfidence || MIN_CONFIDENCE_TO_SUGGEST,
    minConfidenceToEmit: options.minConfidenceToEmit || MIN_CONFIDENCE_TO_EMIT,
    enabled: options.enabled !== false,         // 默认启用
    silent: options.silent === true,             // 老板说"别打扰"
    lastSuggestions: [],   // [{hash, type, at, intentType, content}]
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function hashSuggestion(intent) {
  const payload = JSON.stringify({
    type: intent.type,
    reason: (intent.reason || '').slice(0, 100),
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

function trimHistory(arr, max) {
  if (arr.length <= max) return arr
  return arr.slice(-max)
}

function pruneCooldown(arr, cooldownMs, now) {
  return arr.filter(s => typeof s.at === 'number' && (now - s.at) < cooldownMs)
}

// ─── 主入口 ────────────────────────────────────────────────

// 决定是否建议 + 怎么建议
//   options: {
//     prediction: predict() 的输出,
//     state: suggester state,
//     userActivity: { online: bool, screenLocked: bool },
//     now: number,
//     eventEmitter: { emit(event, payload) } | null  // 注入 emit
//   }
//   返回: { shouldSuggest, intent, reason, suggestType, hash, state }
export function suggest(options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const state = options.state || defaultSuggesterState()
  const prediction = options.prediction || { intents: [] }
  const userActivity = options.userActivity || { online: true, screenLocked: false }

  // 1) 老板说"别打扰" → silent
  if (state.silent) {
    return { shouldSuggest: false, reason: 'silent mode', suggestType: 'silent', state }
  }
  // 2) 离线 / 锁屏 → silent
  if (userActivity.online === false || userActivity.screenLocked === true) {
    return { shouldSuggest: false, reason: 'user offline or screen locked', suggestType: 'silent', state }
  }
  // 3) 整个功能 disabled
  if (state.enabled === false) {
    return { shouldSuggest: false, reason: 'anticipation disabled', suggestType: 'silent', state }
  }
  // 4) 没有候选
  if (!Array.isArray(prediction.intents) || prediction.intents.length === 0) {
    return { shouldSuggest: false, reason: 'no intent candidates', suggestType: 'silent', state }
  }
  // 5) 取 top 1
  const top = prediction.intents[0]
  if (!top || typeof top.confidence !== 'number') {
    return { shouldSuggest: false, reason: 'invalid top intent', suggestType: 'silent', state }
  }
  // 6) 信心度门槛
  if (top.confidence < state.minConfidence) {
    return { shouldSuggest: false, reason: `confidence ${top.confidence.toFixed(2)} < ${state.minConfidence}`, suggestType: 'silent', state }
  }
  // 7) dedup + cooldown
  const hash = hashSuggestion(top)
  const recent = pruneCooldown(state.lastSuggestions, state.cooldownMs, now)
  const dup = recent.find(s => s.hash === hash)
  if (dup) {
    return { shouldSuggest: false, reason: `duplicate (cooldown ${state.cooldownMs}ms)`, suggestType: 'silent', state, hash }
  }
  // 8) 决定建议类型
  let suggestType = 'log'
  if (top.confidence >= state.minConfidenceToEmit) {
    suggestType = 'emit'
  }
  // 9) 记录到历史
  const record = { hash, type: suggestType, at: now, intentType: top.type, content: (top.reason || '').slice(0, 100) }
  state.lastSuggestions = trimHistory([...recent, record], MAX_HISTORY)
  return {
    shouldSuggest: true,
    intent: top,
    reason: top.reason,
    suggestType,
    hash,
    state,
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

export function clearHistory(state) {
  state.lastSuggestions = []
  return state
}

export function getSuggestionHistory(state) {
  return state.lastSuggestions || []
}

export {
  DEFAULT_COOLDOWN_MS,
  MIN_CONFIDENCE_TO_SUGGEST,
  MIN_CONFIDENCE_TO_EMIT,
  MAX_HISTORY,
  hashSuggestion,
}
