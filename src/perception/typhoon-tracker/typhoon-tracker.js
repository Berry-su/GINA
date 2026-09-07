// typhoon-tracker.js — 通用台风监测 + 位置匹配
//
// 定位：拉所有台风 + 跟老板当前位置匹配 + 老板移动时自动重新评估。
// 复用 geo-tracker 的位置（已完工），不动老板。
//
// 集成：
//   typhoon-fetcher (5min/poll NMC 全球台风)
//     → impact-detector (路径 + 老板位置)
//       → typhoon-tracker (emit 'typhoon_alert_v2' + dedup)
//         → 复用现有 typhoon-alert UI 弹窗
//         → 跟 geo-tracker 联动 (老板移动时自动重新评估)

import {
  fetchOnce,
  fetchAllActiveTyphoons,
  fetchNmcAlerts,
  TYPHOON_LEVELS,
  TYPHOON_LEVEL_LABELS,
} from './typhoon-fetcher.js'
import { detectImpact, detectAllImpacts, IMPACT_LEVELS, IMPACT_LABELS_ZH } from './impact-detector.js'

// ─── 常量 ───────────────────────────────────────────────────

// DEFAULT_POLL_INTERVAL_MS 来自 typhoon-fetcher（5 分钟），但不能 import 避免重名冲突
const MAX_IMPACT_HISTORY = 32
const DEFAULT_DEDUP_MS = 60 * 60 * 1000  // 1 小时内同台风不重复
const DEFAULT_POLL_INTERVAL_MS_LOCAL = 5 * 60 * 1000  // 5 分钟

// ─── 状态 ───────────────────────────────────────────────────

export function defaultTrackerState(options = {}) {
  return {
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS_LOCAL,
    enabled: false,
    timer: null,
    location: options.location || null,
    lastFetch: null,
    lastImpacts: [],
    impactHistory: [],
    dedupMs: options.dedupMs || DEFAULT_DEDUP_MS,
    startedAt: null,
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function clampInterval(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return DEFAULT_POLL_INTERVAL_MS_LOCAL
  return Math.max(60 * 1000, Math.floor(ms))
}

function trimHistory(arr, max) {
  if (arr.length <= max) return arr
  return arr.slice(-max)
}

function pruneCooldown(arr, cooldownMs, now) {
  return arr.filter(a => typeof a.at === 'number' && (now - a.at) < cooldownMs)
}

// ─── emit（dedup） ───────────────────────────────────────

function emitImpacts(state, impacts, options = {}) {
  if (!Array.isArray(impacts) || impacts.length === 0) return 0
  const now = Date.now()
  const recent = pruneCooldown(state.impactHistory, state.dedupMs, now)
  const emitted = []
  for (const impact of impacts) {
    // dedup: 1 小时内同台风不重复
    const dup = recent.find(r => r.typhoonName === impact.typhoonName && r.level === impact.level)
    if (dup) continue
    const record = {
      at: now,
      typhoonName: impact.typhoonName,
      level: impact.level,
      distanceKm: impact.distanceKm,
      severity: impact.severity,
      message: impact.message,
    }
    state.impactHistory = trimHistory([...recent, record], MAX_IMPACT_HISTORY)
    emitted.push(impact)
    if (typeof options.onImpact === 'function') {
      try { options.onImpact(impact, state) } catch (e) { /* swallow */ }
    }
  }
  return emitted.length
}

// ─── 监测启动 / 停止 ───────────────────────────────────────

// 启动持续监测
//   options: { state, intervalMs, location, fetcher, onImpact, onUpdate, onError }
export function startTracking(options = {}) {
  const state = options.state || defaultTrackerState()
  if (state.enabled) {
    return { state, error: 'tracking already started' }
  }
  state.pollIntervalMs = clampInterval(options.intervalMs)
  state.location = options.location || state.location
  state.enabled = true
  state.startedAt = Date.now()
  const poll = async () => {
    if (!state.enabled) return
    try {
      const r = await fetchOnce({ fetcher: options.fetcher })
      state.lastFetch = r
      // 影响检测
      if (state.location) {
        const impactResult = detectAllImpacts({
          typhoons: r.typhoons,
          location: state.location,
        })
        state.lastImpacts = impactResult.impacts
        emitImpacts(state, impactResult.impacts, { onImpact: options.onImpact })
      }
      if (typeof options.onUpdate === 'function') {
        try { options.onUpdate(state, r) } catch {}
      }
    } catch (e) {
      if (typeof options.onError === 'function') {
        try { options.onError(e, state) } catch {}
      }
    }
  }
  // 立即跑一次
  poll()
  state.timer = setInterval(poll, state.pollIntervalMs)
  if (typeof state.timer.unref === 'function') state.timer.unref()
  return { state, error: null }
}

export function stopTracking(state) {
  if (!state) return null
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.enabled = false
  return state
}

export function isTracking(state) {
  return !!(state && state.enabled && state.timer)
}

// ─── 老板位置更新（跟 geo-tracker 联动） ──────────────────

// 老板移动后调这个 → 重新评估影响
//   options: { state, location, fetcher }
export async function onLocationChanged(options = {}) {
  const state = options.state
  if (!state) return null
  state.location = options.location || state.location
  if (!state.location) return state
  // 立即评估一次
  const r = await fetchOnce({ fetcher: options.fetcher })
  state.lastFetch = r
  if (state.location) {
    const impactResult = detectAllImpacts({
      typhoons: r.typhoons,
      location: state.location,
    })
    state.lastImpacts = impactResult.impacts
    emitImpacts(state, impactResult.impacts, { onImpact: options.onImpact })
  }
  return state
}

// ─── 单次评估（手动触发） ────────────────────────────────

export async function evaluateOnce(options = {}) {
  const state = options.state || defaultTrackerState()
  if (options.location) state.location = options.location
  const r = await fetchOnce({ fetcher: options.fetcher })
  state.lastFetch = r
  let impacts = []
  if (state.location) {
    const result = detectAllImpacts({ typhoons: r.typhoons, location: state.location })
    impacts = result.impacts
    state.lastImpacts = impacts
    emitImpacts(state, impacts, { onImpact: options.onImpact })
  }
  return { typhoons: r.typhoons, impacts, location: state.location, fetchedAt: r.combinedAt }
}

// ─── 概览 ──────────────────────────────────────────────────

export function getTrackerOverview(state) {
  if (!state) return null
  return {
    running: state.enabled,
    pollIntervalMs: state.pollIntervalMs,
    startedAt: state.startedAt,
    location: state.location,
    activeTyphoons: state.lastFetch?.typhoons?.length || 0,
    lastImpactCount: state.lastImpacts.length,
    lastImpactLevel: state.lastImpacts[0]?.level || null,
    impactHistoryCount: state.impactHistory.length,
  }
}

// ─── 注入对话（meta-info 段） ────────────────────────────

export function injectForTyphoon(state, options = {}) {
  const typhoons = state.lastFetch?.typhoons || []
  const impacts = state.lastImpacts || []
  const lines = [
    `## 台风监测 (typhoon-tracker · v1)`,
    '',
    `- 当前位置: ${state.location?.city || '?'} (${state.location?.country || '?'})`,
    `- 监测台风: ${typhoons.length} 个`,
  ]
  if (typhoons.length > 0) {
    lines.push('')
    lines.push('活跃台风：')
    for (const t of typhoons.slice(0, 5)) {
      lines.push(`  - ${t.name} (${t.levelLabel}) @ ${t.lat?.toFixed(1)},${t.lon?.toFixed(1)} 风速 ${t.maxWind || '?'} m/s`)
    }
  }
  if (impacts.length > 0) {
    lines.push('')
    lines.push(`⚠️ 影响老板（${impacts.length}）：`)
    for (const i of impacts) {
      lines.push(`  - [${i.severity}] ${i.message}`)
    }
  } else {
    lines.push('')
    lines.push(`✅ 当前无影响`)
  }
  lines.push('')
  lines.push('（这是 GINA 台风监测 meta-info，**不进决策路径**。）')
  return lines.join('\n')
}

export {
  MAX_IMPACT_HISTORY,
  DEFAULT_DEDUP_MS,
}
