// trigger.js — 主动 / 被动触发器（90/10）
//
// 定位：GINA 不是每分钟都"主动问自己"，多数学习是被外部信号触发；
// 但留 10% 主动 slot 避免完全被动（避免学到"什么都不做"）。
//
// 触发模式：
//   'passive' 外部信号：失败/用户反馈/情绪负面/低满意度 → 立即触发
//   'active'  主动信号：自问"最近哪儿不懂" → 限频 + 预算保护
//   'skip'    跳过（无信号且主动配额已用完 / 处于冷却期）
//
// 主动比例控制：滑动窗口内 active/(active+passive) 目标 10%，passive 90%。
// 频率限制：默认最少 60s 间隔（避免抖动）+ 每日主动配额上限。

import fs from 'node:fs'
import path from 'node:path'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_ACTIVE_RATIO = 0.10               // 目标主动比例
const DEFAULT_MIN_INTERVAL_MS = 60_000          // 两次触发最小间隔
const DEFAULT_DAILY_ACTIVE_QUOTA = 10           // 24h 主动触发上限
const DEFAULT_COOLDOWN_AFTER_PASSIVE_MS = 5_000 // 被动触发后冷却
const DEFAULT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_MIN_PASSIVE_SIGNAL = 0.2          // 触发被动模式的最低信号
const MAX_HISTORY = 1024

// ─── 状态管理 ───────────────────────────────────────────────

export function defaultState(options = {}) {
  return {
    version: 1,
    activeRatio: options.activeRatio ?? DEFAULT_ACTIVE_RATIO,
    minIntervalMs: options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    dailyActiveQuota: options.dailyActiveQuota ?? DEFAULT_DAILY_ACTIVE_QUOTA,
    cooldownAfterPassiveMs: options.cooldownAfterPassiveMs ?? DEFAULT_COOLDOWN_AFTER_PASSIVE_MS,
    quotaWindowMs: options.quotaWindowMs ?? DEFAULT_QUOTA_WINDOW_MS,
    history: [],   // [{ at, mode, signal, reason }]
  }
}

export function loadState(statePath) {
  if (!statePath) return defaultState()
  try {
    if (!fs.existsSync(statePath)) return defaultState()
    const raw = fs.readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.history)) {
      throw new Error('trigger state malformed')
    }
    return { ...defaultState(), ...parsed }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[trigger] state load failed, rebuilding:', e.message)
    }
    return defaultState()
  }
}

export function saveState(state, statePath) {
  if (!statePath) return
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const tmp = statePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, statePath)
}

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function clampInt(x, lo, hi) {
  if (typeof x !== 'number' || !isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, Math.floor(x)))
}

function pruneHistory(history, windowMs, now) {
  const cutoff = now - windowMs
  return history.filter(h => typeof h.at === 'number' && h.at >= cutoff)
}

function trimHistory(history, max = MAX_HISTORY) {
  if (history.length <= max) return history
  return history.slice(-max)
}

// ─── 公开 API ───────────────────────────────────────────────

// 决定本次是否触发 + 触发模式。
//   options: {
//     signals: { failure, feedback, emotion, satisfaction, ... },  // 0-1 强度
//     state, now, forceActive, forcePassive
//   }
//   返回: { mode: 'active'|'passive'|'skip', reason, signal, currentActiveRatio, quotaRemaining }
export function decide(options = {}) {
  const state = options.state || defaultState()
  const now = typeof options.now === 'number' ? options.now : Date.now()

  // 1) 强制模式优先（测试/外部 override）
  if (options.forcePassive === true) {
    return commit(state, 'passive', -1, 'forced passive', now)
  }
  if (options.forceActive === true) {
    // 主动也检查配额/冷却
    const cooldownOk = isCooldownOk(state, now)
    const quotaOk = hasActiveQuota(state, now)
    if (cooldownOk && quotaOk) {
      return commit(state, 'active', -1, 'forced active', now)
    }
    return {
      mode: 'skip',
      reason: `forced active denied: cooldownOk=${cooldownOk}, quotaOk=${quotaOk}`,
      signal: -1,
      currentActiveRatio: activeRatioInWindow(state, now),
      quotaRemaining: activeQuotaRemaining(state, now),
    }
  }

  // 2) 收集 passive 信号强度（取 max）
  const sig = options.signals || {}
  const signal = clamp01(
    Math.max(
      clamp01(sig.failure),
      clamp01(sig.feedback),
      clamp01(sig.emotion),
      clamp01(sig.satisfaction),
      clamp01(sig.taskFailed),
      clamp01(sig.userFrustrated),
    ),
  )

  // 3) 高 passive 信号 → 立即 passive 触发
  if (signal >= DEFAULT_MIN_PASSIVE_SIGNAL) {
    return commit(state, 'passive', signal, `passive signal ${signal.toFixed(2)}`, now)
  }

  // 4) passive 信号低：考虑主动模式（带配额 + 冷却 + 比例控制）
  const cooldownOk = isCooldownOk(state, now)
  const quotaOk = hasActiveQuota(state, now)
  const currentRatio = activeRatioInWindow(state, now)
  const ratioBelowTarget = currentRatio < state.activeRatio

  if (cooldownOk && quotaOk && ratioBelowTarget) {
    return commit(state, 'active', 0, `active (ratio ${currentRatio.toFixed(3)} < ${state.activeRatio})`, now)
  }

  // 5) 跳过
  let reason = 'skip: '
  if (!cooldownOk) reason += 'cooldown; '
  if (!quotaOk) reason += 'quota exhausted; '
  if (!ratioBelowTarget) reason += `ratio OK (${currentRatio.toFixed(3)} >= ${state.activeRatio}); `
  if (reason === 'skip: ') reason += 'no signal; '

  return {
    mode: 'skip',
    reason: reason.trim(),
    signal,
    currentActiveRatio: currentRatio,
    quotaRemaining: activeQuotaRemaining(state, now),
  }
}

// 记录一次触发结果（commit 后 state 已更新；此函数额外提供 dry-run 记录接口）
export function recordTrigger(mode, signal, reason, options = {}) {
  const state = options.state || defaultState()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  return commit(state, mode, signal, reason, now)
}

// 当前窗口内主动比例
export function activeRatioInWindow(state, now = Date.now()) {
  const recent = pruneHistory(state.history, state.quotaWindowMs, now)
  if (recent.length === 0) return 0
  const activeN = recent.filter(h => h.mode === 'active').length
  return activeN / recent.length
}

// 剩余主动配额
export function activeQuotaRemaining(state, now = Date.now()) {
  const recent = pruneHistory(state.history, state.quotaWindowMs, now)
  const used = recent.filter(h => h.mode === 'active').length
  return Math.max(0, state.dailyActiveQuota - used)
}

// 是否处于冷却期
export function isCooldownOk(state, now = Date.now()) {
  if (state.history.length === 0) return true
  // 找最后一次
  const last = state.history[state.history.length - 1]
  if (!last || typeof last.at !== 'number') return true
  // 主动触发后需要等 minIntervalMs；被动触发后只等 cooldownAfterPassiveMs
  const interval = last.mode === 'active' ? state.minIntervalMs : state.cooldownAfterPassiveMs
  return (now - last.at) >= interval
}

function hasActiveQuota(state, now = Date.now()) {
  return activeQuotaRemaining(state, now) > 0
}

// 写入 history + 修剪
function commit(state, mode, signal, reason, now) {
  state.history.push({ at: now, mode, signal, reason })
  state.history = trimHistory(pruneHistory(state.history, state.quotaWindowMs, now))
  return {
    mode,
    reason,
    signal,
    currentActiveRatio: activeRatioInWindow(state, now),
    quotaRemaining: activeQuotaRemaining(state, now),
  }
}

export function resetForTest() {
  return defaultState()
}

export {
  DEFAULT_ACTIVE_RATIO,
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_DAILY_ACTIVE_QUOTA,
  DEFAULT_COOLDOWN_AFTER_PASSIVE_MS,
  DEFAULT_MIN_PASSIVE_SIGNAL,
  clamp01,
  clampInt,
}
