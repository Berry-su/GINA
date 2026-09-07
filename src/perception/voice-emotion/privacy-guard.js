// privacy-guard.js — 声纹情绪隐私保护
//
// 与视觉情绪一致：
//   1. 麦克风默认关闭（必须 grant 才开）
//   2. 不持久化原始音频（检测后立即丢弃）
//   3. 不传云（仅本地 prosody 推断）
//   4. emotion 仍走 ADR-002 meta-info 隔离
//   5. consent 显式同意门

import {
  isLocalOnly,
  defaultConsentState,
  grant,
  revoke,
  isGranted,
  ALLOWED_DETECTORS,
  NETWORK_BLOCKED_HOSTS,
  MAX_TRACKER_WINDOW,
} from '../visual-emotion/privacy-guard.js'

// 兼容：如果视觉 emotion 的 privacy-guard 没 export isLocalOnly（旧版），从 index 拿
import * as VEPrivacy from '../visual-emotion/privacy-guard.js'

// ─── 声纹专用 ──────────────────────────────────────────────

// 声纹特征可能反向识别说话人（声纹 = 生物特征）
// 所以 raw 音频 + pitch 直方图都不能持久化
const FORBIDDEN_PERSISTENT_FIELDS = [
  'rawAudio',
  'rawBuffer',
  'audioBuffer',
  'mediaStream',
  'pitchHistogram',     // 长期累积的音高分布 = 声纹特征
  'voicePrint',
  'speakerEmbedding',
]

// 立即清理 frame 引用
export function sanitizeAudioFrame(frame) {
  if (!frame) return null
  if (frame instanceof Float32Array || frame instanceof Uint8Array) {
    return null  // 任何原始音频 buffer 一律不返回
  }
  if (typeof frame === 'object') {
    return {
      length: frame.length || 0,
      sampleRate: frame.sampleRate || 0,
    }
  }
  return null
}

// 立即清理 classification（保留 scores + dominant，不留 landmarks）
export function sanitizeClassification(classification) {
  if (!classification || typeof classification !== 'object') return null
  return {
    dominant: classification.dominant || 'neutral',
    scores: classification.scores ? { ...classification.scores } : null,
    confidence: classification.confidence || 0,
    stable: classification.stable === true,
  }
}

// 清理 aggregated features（保留数值，不留原始音频引用）
export function sanitizeAggregated(aggregated) {
  if (!aggregated || typeof aggregated !== 'object') return null
  const clean = {}
  for (const [k, v] of Object.entries(aggregated)) {
    if (FORBIDDEN_PERSISTENT_FIELDS.includes(k)) continue
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // 递归清理
      const sub = {}
      for (const [sk, sv] of Object.entries(v)) {
        if (FORBIDDEN_PERSISTENT_FIELDS.includes(sk)) continue
        sub[sk] = sv
      }
      clean[k] = sub
    } else {
      clean[k] = v
    }
  }
  return clean
}

// 强制 tracker 状态清空
export function clearTrackerState(state) {
  if (!state) return null
  if (Array.isArray(state.frames)) {
    state.frames = []
  }
  return state
}

// 验证 frame 中不含禁止字段
export function isFrameClean(frame) {
  if (!frame) return true
  for (const f of FORBIDDEN_PERSISTENT_FIELDS) {
    if (f in frame) return false
  }
  return true
}

// 重新 export 视觉 emotion 的通用隐私函数，方便 index 一处汇总
export { isLocalOnly, defaultConsentState, grant, revoke, isGranted, ALLOWED_DETECTORS, NETWORK_BLOCKED_HOSTS, MAX_TRACKER_WINDOW } from '../visual-emotion/privacy-guard.js'

export {
  FORBIDDEN_PERSISTENT_FIELDS,
}
