// camera.js — 摄像头管理（navigator.mediaDevices 抽象）
//
// 定位：GINA 通过 navigator.mediaDevices.getUserMedia 访问摄像头。
// 这里是抽象层 — 由调用方注入 navigator.mediaDevices（生产是真实浏览器/Electron，测试是 mock）。
//
// 硬约束（老板 9-07 纪律 + 隐私）:
//   - 默认**关闭**摄像头（老板说"开"才开）
//   - 立即停止：老板说"关" → 立即停（不停就是 bug）
//   - 权限降级：拒绝 → 返回 null（不抛）
//   - 设备选择：默认前置摄像头
//   - 帧不持久化：调用方读完即丢（由 privacy-guard 保证）

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_VIDEO_CONSTRAINTS = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 15, max: 30 },  // 节流，省 CPU
  facingMode: 'user',                  // 默认前置
}

const MAX_CAMERAS = 4
const MAX_RESTART_ATTEMPTS = 3
const RESTART_DELAY_MS = 1000

// ─── 状态 ───────────────────────────────────────────────────

export function defaultCameraState() {
  return {
    enabled: false,             // 是否启用
    stream: null,               // MediaStream
    videoTrack: null,           // 第一条 video track
    cameras: [],                // 可用摄像头列表
    currentCameraId: null,
    errorCount: 0,
    lastError: null,
    startedAt: null,
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

async function listCameras(mediaDevices) {
  if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') return []
  try {
    const devices = await mediaDevices.enumerateDevices()
    return devices
      .filter(d => d && d.kind === 'videoinput')
      .slice(0, MAX_CAMERAS)
      .map((d, idx) => ({
        deviceId: d.deviceId || `camera-${idx}`,
        label: d.label || `Camera ${idx + 1}`,
      }))
  } catch (e) {
    return []
  }
}

function attachStreamLifecycle(stream, onEnded) {
  if (!stream || typeof onEnded !== 'function') return
  const tracks = stream.getTracks ? stream.getTracks() : []
  for (const track of tracks) {
    if (track && typeof track.addEventListener === 'function') {
      track.addEventListener('ended', onEnded)
    }
  }
}

// ─── 公开 API ───────────────────────────────────────────────

// 列出可用摄像头
//   options: { mediaDevices }  注入 navigator.mediaDevices
export async function listAvailableCameras(options = {}) {
  return listCameras(options.mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : null))
}

// 打开摄像头
//   options: {
//     mediaDevices,            // 注入 navigator.mediaDevices
//     constraints,             // 视频约束（覆盖默认）
//     deviceId,                // 指定摄像头（默认前置）
//   }
//   返回: { state, error }
export async function openCamera(options = {}) {
  const state = options.state || defaultCameraState()
  const mediaDevices = options.mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : null)
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    return { state, error: 'getUserMedia not available' }
  }
  // 已有 stream → 先关
  if (state.stream) closeCamera({ state })
  const constraints = {
    video: {
      ...DEFAULT_VIDEO_CONSTRAINTS,
      ...(options.constraints?.video || {}),
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    },
    audio: false,  // 视觉情绪只取视频
  }
  try {
    const stream = await mediaDevices.getUserMedia(constraints)
    const videoTracks = stream.getVideoTracks ? stream.getVideoTracks() : []
    state.stream = stream
    state.videoTrack = videoTracks[0] || null
    state.enabled = true
    state.errorCount = 0
    state.lastError = null
    state.startedAt = new Date().toISOString()
    state.currentCameraId = state.videoTrack?.getSettings?.()?.deviceId || null
    // 监听 stream ended
    attachStreamLifecycle(stream, () => {
      state.enabled = false
      state.stream = null
      state.videoTrack = null
    })
    // 列出可用摄像头（首次需要权限后才能列出 label）
    if (!state.cameras || state.cameras.length === 0) {
      state.cameras = await listCameras(mediaDevices)
    }
    return { state, error: null }
  } catch (e) {
    state.errorCount += 1
    state.lastError = e?.message || String(e)
    return { state, error: state.lastError }
  }
}

// 关闭摄像头（立即停所有 track）
export function closeCamera(options = {}) {
  const state = options.state || defaultCameraState()
  if (state.stream && typeof state.stream.getTracks === 'function') {
    const tracks = state.stream.getTracks()
    for (const track of tracks) {
      try {
        if (typeof track.stop === 'function') track.stop()
      } catch (e) { /* swallow */ }
    }
  }
  state.stream = null
  state.videoTrack = null
  state.enabled = false
  state.startedAt = null
  return state
}

// 当前是否在用
export function isOpen(state) {
  return !!(state && state.enabled && state.stream)
}

// 切换摄像头
//   options: { state, mediaDevices, deviceId }
export async function switchCamera(options = {}) {
  const state = options.state || defaultCameraState()
  if (!isOpen(state)) {
    return { state, error: 'camera not open' }
  }
  const newDeviceId = options.deviceId
  if (!newDeviceId) {
    return { state, error: 'deviceId required' }
  }
  // 关 + 重开
  closeCamera({ state })
  return openCamera({
    state,
    mediaDevices: options.mediaDevices,
    deviceId: newDeviceId,
  })
}

// 抓帧（从 video element 抓 bitmap）— 调用方需要传入 video element
//   options: { videoElement, width, height }
//   返回: { frame, error }
export async function captureFrame(options = {}) {
  if (!options.videoElement) {
    return { frame: null, error: 'videoElement required' }
  }
  const ve = options.videoElement
  if (typeof ve.readyState !== 'undefined' && ve.readyState < 2) {
    return { frame: null, error: 'video not ready' }
  }
  const w = options.width || ve.videoWidth || 640
  const h = options.height || ve.videoHeight || 480
  try {
    if (typeof ve.captureStream === 'function' && typeof OffscreenCanvas !== 'undefined') {
      // 现代路径：OffscreenCanvas
      const off = new OffscreenCanvas(w, h)
      const ctx = off.getContext('2d')
      ctx.drawImage(ve, 0, 0, w, h)
      return { frame: off, width: w, height: h, error: null }
    } else if (typeof document !== 'undefined') {
      // 降级路径：HTMLCanvasElement
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return { frame: null, error: 'no 2d context' }
      ctx.drawImage(ve, 0, 0, w, h)
      return { frame: canvas, width: w, height: h, error: null }
    } else {
      return { frame: null, error: 'no canvas support' }
    }
  } catch (e) {
    return { frame: null, error: e?.message || String(e) }
  }
}

export {
  DEFAULT_VIDEO_CONSTRAINTS,
  MAX_CAMERAS,
  MAX_RESTART_ATTEMPTS,
  RESTART_DELAY_MS,
}
