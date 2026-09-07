// emotion-tracker.js — 声纹情绪滑动窗口稳定化
//
// 定位：复用视觉情绪的 tracker 模式，对 prosody 推断结果做时间平滑。
//
// 单次 prosody 推断波动大（背景噪声/说话人切换），5 帧窗口 + 指数衰减加权。
//
// 与视觉情绪的差异：
//   - 输入是 aggregateFeatures（不是单帧 expressions）
//   - 内部用 classifyByRules / mock classifier
//   - 默认窗口 5 个聚合（≈ 2-5 秒）

import { defaultTrackerState as defaultBaseTrackerState, addFrame as addBaseFrame, getStableEmotion as getBaseStableEmotion, resetTracker as resetBaseTracker, setWindowSize as setBaseWindowSize, MIN_FRAMES_FOR_OUTPUT as MIN_FRAMES_BASE, MAX_AGE_MS as MAX_AGE_BASE } from '../visual-emotion/emotion-tracker.js'

// ─── 状态 ───────────────────────────────────────────────────

export function defaultTrackerState(options = {}) {
  return defaultBaseTrackerState({
    windowSize: options.windowSize || 5,
    minFrames: options.minFrames || 3,
    maxAgeMs: options.maxAgeMs || 10000,
  })
}

// ─── 主入口 ────────────────────────────────────────────────

// 添加一帧的聚合特征 + 分类结果到滑动窗口
//   options: { state, aggregated, classification, now }
export function addFrame(options = {}) {
  const state = options.state || defaultTrackerState()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  // 复用视觉情绪的 addFrame：expressions = classification.scores
  const classification = options.classification || {}
  const expressions = classification.scores || {}
  return addBaseFrame({
    state,
    expressions,
    faceCount: 1,  // 音频只有"一个声道"
    confidence: classification.confidence || 0,
    now,
  })
}

// 获取当前稳定情绪
//   options: { state, now }
//   返回: { dominant, scores, confidence, frameCount, stable } | null
export function getStableEmotion(options = {}) {
  return getBaseStableEmotion(options)
}

// 重置窗口
export function resetTracker(state) {
  return resetBaseTracker(state)
}

// 设置窗口大小
export function setWindowSize(state, size) {
  return setBaseWindowSize(state, size)
}

export {
  MIN_FRAMES_BASE as MIN_FRAMES_FOR_OUTPUT,
  MAX_AGE_BASE as MAX_AGE_MS,
}
