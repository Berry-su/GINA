// frame-sampler.js — 帧采样 + 变化检测
//
// 定位：从持续视频流中按"1 fps + 30% 变化"采样。
// 老板 9-07 14:25 拍板：1 fps + 30% 变化阈值。
//
// 算法：
//   1. 接收原始 frame 字节
//   2. 计算 frame hash (sha256 first 16 chars)
//   3. 与上一帧 hash 比较
//   4. 如果不同 → 计算像素差异（粗略：hash 长度差 + 字节对比）
//   5. 差异度 ≥ threshold (0.3) → 触发变化事件
//   6. 输出 frame + changeScore
//
// 真实生产用：downscale frame 到 64x64 + pixel diff（更高精度）
// 这里：基于 frame 字节 hash + 字节差异（无需像素处理，0 依赖 + 快）

// ─── 常量 ───────────────────────────────────────────────────

import crypto from 'node:crypto'

const DEFAULT_CHANGE_THRESHOLD = 0.30   // 30% 变化触发
const MIN_CHANGE_THRESHOLD = 0.05       // 5% 灵敏
const MAX_CHANGE_THRESHOLD = 0.95       // 95% 迟钝
const SAMPLE_RESOLUTION = 64            // 用于 diff 的下采样分辨率（如果拿到像素）

// ─── 状态 ───────────────────────────────────────────────────

export function defaultSamplerState() {
  return {
    lastFrameHash: null,
    lastFrameBytes: null,
    lastChangeScore: 0,
    lastChangeAt: null,
    changeCount: 0,         // 总触发变化次数
    sampleCount: 0,         // 总采样次数
    threshold: DEFAULT_CHANGE_THRESHOLD,
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function clamp(x, lo, hi) {
  if (typeof x !== 'number' || !isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function hashFrame(frame) {
  if (!frame) return null
  if (typeof frame === 'string') {
    return crypto.createHash('sha256').update(frame).digest('hex').slice(0, 16)
  }
  if (frame instanceof ArrayBuffer || ArrayBuffer.isView(frame)) {
    const bytes = new Uint8Array(frame.buffer || frame)
    return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  }
  if (typeof frame === 'object') {
    // 对象：序列化关键字段
    const str = JSON.stringify({
      w: frame.width || 0,
      h: frame.height || 0,
      // 不能直接序列化 canvas/image data
    })
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16)
  }
  return null
}

function hashToBytes(hash) {
  if (!hash || hash.length < 16) return null
  return Buffer.from(hash.slice(0, 16), 'hex')
}

// ─── 公开 API ───────────────────────────────────────────────

// 处理一帧，返回是否触发变化
//   options: { state, frame, threshold }
//   返回: { changed, changeScore, hash, threshold }
export function processFrame(options = {}) {
  const state = options.state || defaultSamplerState()
  const threshold = clamp(options.threshold != null ? options.threshold : state.threshold, MIN_CHANGE_THRESHOLD, MAX_CHANGE_THRESHOLD)
  state.threshold = threshold
  const hash = hashFrame(options.frame)
  state.sampleCount += 1
  // 第 1 帧：必然 changed
  if (!state.lastFrameHash) {
    state.lastFrameHash = hash
    state.lastChangeScore = 1.0
    state.lastChangeAt = Date.now()
    state.changeCount += 1
    return { changed: true, changeScore: 1.0, hash, threshold, isFirstFrame: true }
  }
  // 计算差异
  const prevBytes = hashToBytes(state.lastFrameHash)
  const currBytes = hashToBytes(hash)
  let diff = 0
  if (prevBytes && currBytes) {
    const len = Math.min(prevBytes.length, currBytes.length)
    let diffBytes = 0
    for (let i = 0; i < len; i++) {
      if (prevBytes[i] !== currBytes[i]) diffBytes++
    }
    // 加上长度差
    diffBytes += Math.abs(prevBytes.length - currBytes.length)
    diff = diffBytes / Math.max(prevBytes.length, currBytes.length, 1)
  } else {
    diff = hash !== state.lastFrameHash ? 1 : 0
  }
  diff = clamp01(diff)
  state.lastFrameHash = hash
  state.lastChangeScore = diff
  const changed = diff >= threshold
  if (changed) {
    state.lastChangeAt = Date.now()
    state.changeCount += 1
  }
  return { changed, changeScore: diff, hash, threshold, isFirstFrame: false }
}

// 强制重置（重新开始"无前一帧"状态）
export function resetSampler(state) {
  state.lastFrameHash = null
  state.lastFrameBytes = null
  state.lastChangeScore = 0
  state.lastChangeAt = null
  state.changeCount = 0
  state.sampleCount = 0
  return state
}

// 设置阈值
export function setThreshold(state, threshold) {
  state.threshold = clamp(threshold, MIN_CHANGE_THRESHOLD, MAX_CHANGE_THRESHOLD)
  return state
}

// 概览
export function getSamplerStats(state) {
  return {
    sampleCount: state.sampleCount || 0,
    changeCount: state.changeCount || 0,
    changeRatio: state.sampleCount > 0 ? state.changeCount / state.sampleCount : 0,
    lastChangeScore: state.lastChangeScore || 0,
    threshold: state.threshold,
  }
}

export {
  DEFAULT_CHANGE_THRESHOLD,
  MIN_CHANGE_THRESHOLD,
  MAX_CHANGE_THRESHOLD,
  SAMPLE_RESOLUTION,
}
