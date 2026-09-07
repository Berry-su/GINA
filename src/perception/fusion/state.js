// state.js — 融合结果滑动窗口稳定化
//
// 定位：单次融合可能波动（老板快速换情绪），5 次融合结果做时间平滑。
// 复用视觉/声纹 emotion-tracker 的同款 5 帧窗口。

import { defaultTrackerState as baseDefault, addFrame as baseAdd, getStableEmotion as baseGet, resetTracker as baseReset, setWindowSize as baseSetSize } from '../visual-emotion/emotion-tracker.js'

// ─── 状态 ───────────────────────────────────────────────────

export function defaultFusionState(options = {}) {
  return baseDefault({
    windowSize: options.windowSize || 5,
    minFrames: options.minFrames || 3,
    maxAgeMs: options.maxAgeMs || 10000,
  })
}

// ─── 公开 API ───────────────────────────────────────────────

// 添加一次融合结果到滑动窗口
//   options: { state, fusion, now }
//     fusion: fuse() 输出
export function addFusion(options = {}) {
  const state = options.state || defaultFusionState()
  const fusion = options.fusion
  if (!fusion) return state
  const expressions = fusion.scores || {}
  return baseAdd({
    state,
    expressions,
    faceCount: 1,
    confidence: fusion.confidence || 0,
    now: options.now,
  })
}

export function getStableFusion(options = {}) {
  return baseGet(options)
}

export function resetFusion(state) {
  return baseReset(state)
}

export function setWindowSize(state, size) {
  return baseSetSize(state, size)
}

export {
  baseDefault as defaultTrackerState,
}
