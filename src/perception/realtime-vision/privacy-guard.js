// privacy-guard.js — 实时视野隐私保护
//
// 老板 9-07 翻身纪律 + 9-07 实时视野 B 隐私红线：
//   1. 默认关闭（必须 grant 才开）
//   2. 不持久化原始帧（缓存仅保留 hash + 描述）
//   3. 不传云（仅本地 VLM）
//   4. 帧缓存上限（防 OOM）
//   5. URL 白名单
//   6. 仅本地 consent

import {
  defaultConsentState,
  grant,
  revoke,
  isGranted,
  ALLOWED_DETECTORS,
  NETWORK_BLOCKED_HOSTS,
  MAX_TRACKER_WINDOW,
} from '../visual-emotion/privacy-guard.js'

// 视觉 emotion 的 privacy-guard 0.x 没 export isLocalOnly，从 index 拿
import { isLocalOnly } from '../visual-emotion/privacy-guard.js'

// 实时视野专用 — 帧缓存上限
const DEFAULT_FRAME_CACHE_MAX = 20
const MAX_FRAME_CACHE_MAX = 100

// ─── 实时视野专用 API ──────────────────────────────────────

// 清理帧缓存（保持上限）
export function trimFrameCache(cache, max = DEFAULT_FRAME_CACHE_MAX) {
  if (!cache || cache.size <= max) return cache
  // LRU：删最早的
  const firstKey = cache.keys().next().value
  if (firstKey) cache.delete(firstKey)
  return cache
}

// 强制清空所有帧缓存
export function clearFrameCache(cache) {
  if (cache) cache.clear()
  return cache
}

// 限制缓存上限
export function clampCacheMax(max) {
  if (typeof max !== 'number' || !isFinite(max) || max <= 0) return DEFAULT_FRAME_CACHE_MAX
  return Math.min(MAX_FRAME_CACHE_MAX, Math.floor(max))
}

// 清理实时视野 stream state（关摄像头 + 清缓存 + 停止定时器）
export function clearRealtimeState(state) {
  if (!state) return null
  if (state.samplingTimer) {
    clearInterval(state.samplingTimer)
    state.samplingTimer = null
  }
  if (state.stream) {
    try {
      const tracks = state.stream.getTracks?.() || []
      for (const t of tracks) {
        if (typeof t.stop === 'function') t.stop()
      }
    } catch {}
  }
  state.stream = null
  state.enabled = false
  state.startedAt = null
  state.lastFrameAt = null
  return state
}

// 验证观察结果（已分析过的描述）不包含原始帧引用
const FORBIDDEN_FIELDS = [
  'frame', 'rawFrame', 'pixels', 'imageData', 'canvas',
  'buffer', 'arrayBuffer', 'videoElement', 'mediaStream',
  'facePixels', 'landmarks',
]
export function isObservationClean(observation) {
  if (!observation) return true
  for (const f of FORBIDDEN_FIELDS) {
    if (f in observation) return false
  }
  return true
}

// sanitize 观察结果（剥原始帧引用）
export function sanitizeObservation(observation) {
  if (!observation || typeof observation !== 'object') return null
  const clean = {}
  for (const [k, v] of Object.entries(observation)) {
    if (FORBIDDEN_FIELDS.includes(k)) continue
    if (k === 'frame' || k === 'rawFrame') continue  // 双重保护
    clean[k] = v
  }
  return clean
}

// 重新 export 给 index 一处汇总
export { isLocalOnly, defaultConsentState, grant, revoke, isGranted, ALLOWED_DETECTORS, NETWORK_BLOCKED_HOSTS, MAX_TRACKER_WINDOW } from '../visual-emotion/privacy-guard.js'

export {
  DEFAULT_FRAME_CACHE_MAX,
  MAX_FRAME_CACHE_MAX,
  FORBIDDEN_FIELDS,
}
