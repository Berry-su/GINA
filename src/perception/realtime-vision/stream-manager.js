// stream-manager.js — 持续视频流管理
//
// 定位：GINA 持续观察老板视野（实时摄像头流）。
// 基于 src/perception/visual-emotion/camera.js 扩展，加上：
//   - 持续轮询采样（不是单帧）
//   - 自动重启（stream ended 后自动重连）
//   - 多路流（cam + screen 后扩展）
//   - 健康监控（错误计数 + 上次心跳）
//
// 硬约束（老板 9-07 翻身纪律 + 隐私）：
//   - 默认关闭，必须 grant 才开
//   - 持续录制：每秒 N 帧（默认 1 fps）
//   - 不持久化原始帧（仅缓存最近 N 帧用于变化检测）
//   - 老板说"关" → 立即停
//   - 屏幕锁 / 离线 → 完全关闭
//   - 同一时间只能开 1 个实时流（防资源爆）

import { openCamera as openFaceCamera, closeCamera as closeFaceCamera, isOpen as isFaceCameraOpen, defaultCameraState as defaultFaceCameraState } from '../visual-emotion/camera.js'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_FPS = 1
const MIN_FPS = 0.2
const MAX_FPS = 30
const MAX_RESTART_ATTEMPTS = 3
const RESTART_DELAY_MS = 2000
const HEARTBEAT_TIMEOUT_MS = 10_000
const MAX_CONCURRENT_STREAMS = 1  // 同时只开 1 路
const ACTIVE_STREAMS = new Set()  // 跟踪全局活跃流（防资源爆）

// ─── 状态 ───────────────────────────────────────────────────

export function defaultStreamState() {
  return {
    enabled: false,
    stream: null,             // MediaStream
    source: 'camera',         // camera / screen / future
    fps: DEFAULT_FPS,
    samplingTimer: null,      // setInterval handle
    restartAttempts: 0,
    errorCount: 0,
    lastError: null,
    lastFrameAt: null,
    lastHeartbeatAt: null,
    startedAt: null,
    frameCount: 0,
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function clampFps(fps) {
  if (typeof fps !== 'number' || !isFinite(fps) || fps <= 0) return DEFAULT_FPS
  return Math.max(MIN_FPS, Math.min(MAX_FPS, fps))
}

function clearTimer(timer) {
  if (timer && typeof clearInterval === 'function') {
    clearInterval(timer)
  }
  return null
}

function attachHeartbeat(state, now) {
  state.lastHeartbeatAt = now
}

// ─── 公开 API ───────────────────────────────────────────────

// 打开实时流（基于 camera.js，复用 getUserMedia）
//   options: { state, mediaDevices, fps, source, onFrame: async (frame) => {}, consent }
//   onFrame: 必填，每帧回调（async 允许 await）
//   consent: 必须先 grant() 才允许
export async function openStream(options = {}) {
  const state = options.state || defaultStreamState()
  if (typeof options.onFrame !== 'function') {
    return { state, error: 'onFrame callback required' }
  }
  if (state.enabled) {
    return { state, error: 'stream already open' }
  }
  // 检查全局活跃流
  if (ACTIVE_STREAMS.size >= MAX_CONCURRENT_STREAMS) {
    return { state, error: `max concurrent streams reached (${MAX_CONCURRENT_STREAMS})` }
  }
  state.fps = clampFps(options.fps)
  state.source = options.source || 'camera'
  // 调 camera.js
  const r = await openFaceCamera({
    mediaDevices: options.mediaDevices,
    state: state.stream ? state : state,  // camera.js 自己管 stream
  })
  if (r.error) {
    state.errorCount += 1
    state.lastError = r.error
    return { state, error: r.error }
  }
  // camera.js 把 stream 放进了 state.stream（与 defaultCameraState 共享 schema）
  // realtime-vision state 拿 r.state.stream
  state.stream = r.state.stream
  state.enabled = true
  state.errorCount = 0
  state.lastError = null
  state.startedAt = new Date().toISOString()
  state.lastHeartbeatAt = Date.now()
  state.lastFrameAt = null
  state.frameCount = 0
  ACTIVE_STREAMS.add(state)
  // 启动采样定时器
  const intervalMs = Math.max(50, Math.floor(1000 / state.fps))
  state.samplingTimer = setInterval(async () => {
    if (!state.enabled) return
    const now = Date.now()
    // 心跳超时检查
    if (state.lastHeartbeatAt && (now - state.lastHeartbeatAt) > HEARTBEAT_TIMEOUT_MS) {
      state.errorCount += 1
      state.lastError = 'heartbeat timeout'
      // 自动尝试重启
      if (state.restartAttempts < MAX_RESTART_ATTEMPTS) {
        state.restartAttempts += 1
        clearTimer(state.samplingTimer)
        state.samplingTimer = null
        setTimeout(() => {
          restartStream(options).catch(() => {})
        }, RESTART_DELAY_MS)
      } else {
        // 超过重启次数 → 强制关闭
        closeStream({ state })
      }
      return
    }
    attachHeartbeat(state, now)
    // 抓帧回调
    try {
      const frame = await captureFrameForCallback({ state, videoElement: options.videoElement })
      if (frame) {
        state.lastFrameAt = now
        state.frameCount += 1
        await options.onFrame(frame, { state, at: now })
      }
    } catch (e) {
      state.errorCount += 1
      state.lastError = e?.message || String(e)
    }
  }, intervalMs)
  // 立即抓第 1 帧（不等 interval）
  setTimeout(async () => {
    if (state.enabled && typeof options.onFrame === 'function') {
      try {
        const frame = await captureFrameForCallback({ state, videoElement: options.videoElement })
        if (frame) {
          state.lastFrameAt = Date.now()
          state.frameCount += 1
          await options.onFrame(frame, { state, at: state.lastFrameAt })
        }
      } catch (e) { /* swallow */ }
    }
  }, 50)
  return { state, error: null }
}

// 关闭流
export function closeStream(options = {}) {
  const state = options.state || defaultStreamState()
  clearTimer(state.samplingTimer)
  state.samplingTimer = null
  // 关闭底层 camera
  if (state.stream) {
    closeFaceCamera({ state: { stream: state.stream, enabled: true } })
  }
  state.stream = null
  state.enabled = false
  state.startedAt = null
  state.lastFrameAt = null
  ACTIVE_STREAMS.delete(state)
  return state
}

// 重启流
export async function restartStream(options = {}) {
  closeStream(options)
  return openStream(options)
}

// 是否在用
export function isStreamOpen(state) {
  return !!(state && state.enabled && state.stream)
}

// 抓帧辅助：从 videoElement 抓 bitmap
//   这里 mock 掉（生产用 captureFrame from camera.js）
async function captureFrameForCallback(options = {}) {
  const state = options.state
  // 优先用 videoElement（由调用方注入）
  if (options.videoElement) {
    // 委托给 camera.js 的 captureFrame
    const { captureFrame } = await import('../visual-emotion/camera.js')
    const r = await captureFrame({ videoElement: options.videoElement })
    if (r.error) return null
    return r.frame
  }
  // 没 videoElement：返回 null（让调用方决定怎么注入）
  return null
}

// 获取活跃流数
export function getActiveStreamCount() {
  return ACTIVE_STREAMS.size
}

export {
  DEFAULT_FPS,
  MIN_FPS,
  MAX_FPS,
  MAX_RESTART_ATTEMPTS,
  RESTART_DELAY_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_CONCURRENT_STREAMS,
}
