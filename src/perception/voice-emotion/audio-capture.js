// audio-capture.js — 麦克风音频流管理
//
// 定位：GINA 通过 navigator.mediaDevices.getUserMedia({audio: true}) 拿麦克风流。
// 用 Web Audio API 的 AnalyserNode 提取频域/时域特征（prosody 用）。
//
// 硬约束（老板 9-07 纪律 + 隐私）:
//   - 默认关闭（必须 grant 才开）
//   - 不持久化原始音频
//   - 立即停止：老板说"关" → 立即停
//   - 仅本地处理（不传云）

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 16000,        // 16kHz 够 prosody
  channelCount: 1,
}

const DEFAULT_ANALYSER_FFT = 2048
const DEFAULT_ANALYSER_SMOOTHING = 0.6
const MAX_MICS = 4

// ─── 状态 ───────────────────────────────────────────────────

export function defaultAudioState() {
  return {
    enabled: false,
    stream: null,
    audioContext: null,
    analyser: null,
    source: null,
    microphones: [],
    currentMicId: null,
    sampleRate: null,
    fftSize: DEFAULT_ANALYSER_FFT,
    smoothingTimeConstant: DEFAULT_ANALYSER_SMOOTHING,
    errorCount: 0,
    lastError: null,
    startedAt: null,
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

async function listMicrophones(mediaDevices) {
  if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') return []
  try {
    const devices = await mediaDevices.enumerateDevices()
    return devices
      .filter(d => d && d.kind === 'audioinput')
      .slice(0, MAX_MICS)
      .map((d, idx) => ({
        deviceId: d.deviceId || `mic-${idx}`,
        label: d.label || `Microphone ${idx + 1}`,
      }))
  } catch (e) {
    return []
  }
}

function attachEndedListener(stream, onEnded) {
  if (!stream || typeof onEnded !== 'function') return
  const tracks = stream.getTracks ? stream.getTracks() : []
  for (const track of tracks) {
    if (track && typeof track.addEventListener === 'function') {
      track.addEventListener('ended', onEnded)
    }
  }
}

// ─── 公开 API ───────────────────────────────────────────────

export async function listAvailableMicrophones(options = {}) {
  return listMicrophones(options.mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : null))
}

// 打开麦克风
//   options: { mediaDevices, audioContext, constraints, deviceId }
//   audioContext 由调用方注入（生产是真实的 AudioContext，测试是 mock）
export async function openMicrophone(options = {}) {
  const state = options.state || defaultAudioState()
  const mediaDevices = options.mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : null)
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    return { state, error: 'getUserMedia not available' }
  }
  // 已有 stream → 先关
  if (state.stream) closeMicrophone({ state })
  const constraints = {
    audio: {
      ...DEFAULT_AUDIO_CONSTRAINTS,
      ...(options.constraints?.audio || {}),
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    },
    video: false,
  }
  try {
    const stream = await mediaDevices.getUserMedia(constraints)
    const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : []
    state.stream = stream
    state.enabled = true
    state.errorCount = 0
    state.lastError = null
    state.startedAt = new Date().toISOString()
    state.currentMicId = audioTracks[0]?.getSettings?.()?.deviceId || null
    // 创建 AudioContext（由调用方注入；测试用 mock）
    const audioContext = options.audioContext || (typeof AudioContext !== 'undefined' ? new AudioContext() : null)
    if (!audioContext) {
      // 没有 AudioContext 也能用（只 stream 不分析）
      return { state, error: 'AudioContext not available' }
    }
    state.audioContext = audioContext
    state.sampleRate = audioContext.sampleRate
    // AnalyserNode
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = state.fftSize
    analyser.smoothingTimeConstant = state.smoothingTimeConstant
    state.analyser = analyser
    // connect stream → analyser
    const source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)
    state.source = source
    // 监听 stream ended
    attachEndedListener(stream, () => {
      state.enabled = false
      state.stream = null
      state.audioContext = null
      state.analyser = null
      state.source = null
    })
    // 列可用麦克风（首次需权限后才有 label）
    if (!state.microphones || state.microphones.length === 0) {
      state.microphones = await listMicrophones(mediaDevices)
    }
    return { state, error: null }
  } catch (e) {
    state.errorCount += 1
    state.lastError = e?.message || String(e)
    return { state, error: state.lastError }
  }
}

// 关闭麦克风
export function closeMicrophone(options = {}) {
  const state = options.state || defaultAudioState()
  if (state.stream && typeof state.stream.getTracks === 'function') {
    const tracks = state.stream.getTracks()
    for (const track of tracks) {
      try {
        if (typeof track.stop === 'function') track.stop()
      } catch (e) { /* swallow */ }
    }
  }
  if (state.source && typeof state.source.disconnect === 'function') {
    try { state.source.disconnect() } catch (e) { /* swallow */ }
  }
  if (state.analyser && typeof state.analyser.disconnect === 'function') {
    try { state.analyser.disconnect() } catch (e) { /* swallow */ }
  }
  if (state.audioContext && typeof state.audioContext.close === 'function') {
    try { state.audioContext.close() } catch (e) { /* swallow */ }
  }
  state.stream = null
  state.audioContext = null
  state.analyser = null
  state.source = null
  state.enabled = false
  state.startedAt = null
  return state
}

// 当前是否在用
export function isOpen(state) {
  return !!(state && state.enabled && state.stream && state.analyser)
}

// 切换麦克风
export async function switchMicrophone(options = {}) {
  const state = options.state || defaultAudioState()
  if (!isOpen(state)) return { state, error: 'microphone not open' }
  const newDeviceId = options.deviceId
  if (!newDeviceId) return { state, error: 'deviceId required' }
  closeMicrophone({ state })
  return openMicrophone({ state, mediaDevices: options.mediaDevices, deviceId: newDeviceId })
}

// 抓取一帧时域数据（Float32Array）— 供 prosody 特征提取
//   options: { state, length }  length 默认 = analyser.fftSize
//   返回: { frame: Float32Array | null, sampleRate, error }
export function captureTimeDomainFrame(options = {}) {
  const state = options.state || defaultAudioState()
  if (!isOpen(state) || !state.analyser) {
    return { frame: null, sampleRate: null, error: 'microphone not open' }
  }
  const length = options.length || state.analyser.fftSize
  const buf = new Float32Array(length)
  try {
    state.analyser.getFloatTimeDomainData(buf)
    return {
      frame: buf,
      sampleRate: state.sampleRate,
      length,
      error: null,
    }
  } catch (e) {
    return { frame: null, sampleRate: state.sampleRate, length, error: e?.message || String(e) }
  }
}

// 抓取一帧频域数据（Uint8Array）— 供频谱质心等
export function captureFrequencyFrame(options = {}) {
  const state = options.state || defaultAudioState()
  if (!isOpen(state) || !state.analyser) {
    return { frame: null, sampleRate: null, error: 'microphone not open' }
  }
  const length = options.length || (state.analyser.frequencyBinCount)
  const buf = new Uint8Array(length)
  try {
    state.analyser.getByteFrequencyData(buf)
    return {
      frame: buf,
      sampleRate: state.sampleRate,
      length,
      error: null,
    }
  } catch (e) {
    return { frame: null, sampleRate: state.sampleRate, length, error: e?.message || String(e) }
  }
}

export {
  DEFAULT_AUDIO_CONSTRAINTS,
  DEFAULT_ANALYSER_FFT,
  DEFAULT_ANALYSER_SMOOTHING,
  MAX_MICS,
}
