// privacy-guard.js — 融合结果隐私保护
//
// 关键约束（老板 9-07 翻身纪律 + ADR-002 meta-info 隔离）:
//   1. 融合结果不进决策路径（仍按 meta-info 处理）
//   2. 不持久化任何模态的原始数据（sanitize 阶段已完成）
//   3. 不传到对话（仅 injectFor 时输出，meta-info 段）
//   4. ambiguous = true 时 caller 应降权（不主动开口）

import {
  defaultConsentState,
  grant,
  revoke,
  isGranted,
  ALLOWED_DETECTORS,
  NETWORK_BLOCKED_HOSTS,
  MAX_TRACKER_WINDOW,
} from '../visual-emotion/privacy-guard.js'

// 视觉 emotion 的 isLocalOnly 在其 privacy-guard.js 里 export 了（v 之后版本），
// 兼容老版本：直接从 visual-emotion/privacy-guard.js 拿
import { isLocalOnly } from '../visual-emotion/privacy-guard.js'

// ─── 融合专用 ──────────────────────────────────────────────

// 立即清理单模态输入（face-detector / voice-emotion 输出）
export function sanitizeModality(m) {
  if (!m || typeof m !== 'object') return null
  return {
    dominant: m.dominant || 'neutral',
    scores: m.scores ? { ...m.scores } : null,
    confidence: typeof m.confidence === 'number' ? Math.max(0, Math.min(1, m.confidence)) : 0,
  }
}

// 立即清理融合结果
//   保留：dominant / scores / confidence / agreement / ambiguous / timestamp / modalities
//   删除：rawInputs（可能含原始音频/视频引用）
export function sanitizeFusion(fusion) {
  if (!fusion || typeof fusion !== 'object') return null
  return {
    dominant: fusion.dominant || 'neutral',
    scores: fusion.scores ? { ...fusion.scores } : null,
    confidence: typeof fusion.confidence === 'number' ? Math.max(0, Math.min(1, fusion.confidence)) : 0,
    agreement: fusion.agreement || 'insufficient',
    modalities: fusion.modalities ? { ...fusion.modalities } : null,
    modalityConfidences: fusion.modalityConfidences ? { ...fusion.modalityConfidences } : null,
    modalitiesUsed: Array.isArray(fusion.modalitiesUsed) ? [...fusion.modalitiesUsed] : [],
    ambiguous: fusion.ambiguous === true,
    timestamp: fusion.timestamp || Date.now(),
  }
}

// 立即清理 tracker 状态
export function clearFusionState(state) {
  if (!state) return null
  if (Array.isArray(state.frames)) {
    state.frames = []
  }
  return state
}

// 验证 fusion 不含禁止字段（landmark / raw audio / face pixels）
const FORBIDDEN_FUSION_FIELDS = [
  'landmarks', 'faceLandmarks', 'facePixels', 'rawAudio', 'audioBuffer',
  'frame', 'rawFrame', 'videoFrame', 'voicePrint', 'speakerEmbedding',
]
export function isFusionClean(fusion) {
  if (!fusion) return true
  for (const f of FORBIDDEN_FUSION_FIELDS) {
    if (f in fusion) return false
  }
  return true
}

// 重新 export 给 index 用
export { isLocalOnly, defaultConsentState, grant, revoke, isGranted, ALLOWED_DETECTORS, NETWORK_BLOCKED_HOSTS, MAX_TRACKER_WINDOW } from '../visual-emotion/privacy-guard.js'

export {
  FORBIDDEN_FUSION_FIELDS,
}
