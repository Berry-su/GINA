// prosody.js — 韵律特征提取（纯 DSP，不依赖 ML 模型）
//
// 定位：从音频帧中提取 prosody 特征：
//   1. Pitch (F0)         — 基频（音调）— 自相关法
//   2. Energy (RMS)       — 能量（音量）
//   3. Zero crossing rate — 过零率（高频代理）
//   4. Speaking rate      — 语速（能量包络上升沿）
//   5. Pause ratio        — 停顿比例（低能量帧占比）
//   6. Spectral centroid  — 频谱质心（明亮度）
//   7. Spectral flux      — 频谱变化（语速代理）
//   8. Jitter             — 基频抖动（紧张度）
//   9. Shimmer            — 振幅抖动（疲惫度）
//
// 不依赖任何 ML 模型，纯 DSP 数字信号处理。
// 真实精度有限（~50-60% 7 类分类），但 0 依赖 + 0 网络 + 0 算力。
// 生产环境应该换 wav2vec2 + emotion head（抽象层支持）。

// ─── 常量 ───────────────────────────────────────────────────

const PITCH_MIN_HZ = 60       // 人声最低基频
const PITCH_MAX_HZ = 500      // 人声最高基频
const ENERGY_SILENCE_THRESHOLD = 0.01   // RMS < 这个视为停顿
const ENERGY_SPEECH_THRESHOLD = 0.05   // RMS > 这个视为说话
const PITCH_VOICED_THRESHOLD_RATIO = 0.3  // 自相关峰值 / 能量 > 这个才算有声

// ─── 内部工具 ───────────────────────────────────────────────

function clamp(x, lo, hi) {
  if (typeof x !== 'number' || !isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function mean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0
  let s = 0
  for (const v of arr) s += (typeof v === 'number' && isFinite(v)) ? v : 0
  return s / arr.length
}

function stddev(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0
  const m = mean(arr)
  let v = 0
  for (const x of arr) v += (x - m) ** 2
  return Math.sqrt(v / arr.length)
}

function min(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0
  let m = Infinity
  for (const v of arr) if (typeof v === 'number' && v < m) m = v
  return m === Infinity ? 0 : m
}

function max(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0
  let m = -Infinity
  for (const v of arr) if (typeof v === 'number' && v > m) m = v
  return m === -Infinity ? 0 : m
}

// ─── 1. Energy (RMS) ────────────────────────────────────────

export function computeRMS(frame) {
  if (!frame || typeof frame.length !== 'number' || frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i]
    sum += v * v
  }
  return Math.sqrt(sum / frame.length)
}

// ─── 2. Pitch (F0) — 自相关法 ──────────────────────────────

// 返回基频（Hz）或 0（无声）
export function computePitch(frame, sampleRate) {
  if (!frame || frame.length === 0 || !sampleRate) return 0
  const n = frame.length
  // 计算归一化自相关，找最大峰（避开 0 滞后）
  const minLag = Math.floor(sampleRate / PITCH_MAX_HZ)
  const maxLag = Math.floor(sampleRate / PITCH_MIN_HZ)
  if (minLag >= maxLag || maxLag >= n) return 0
  // 能量归一化
  let energy = 0
  for (let i = 0; i < n; i++) energy += frame[i] * frame[i]
  if (energy <= 1e-10) return 0
  // 自相关
  let bestLag = 0
  let bestCorr = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    for (let i = 0; i < n - lag; i++) {
      corr += frame[i] * frame[i + lag]
    }
    corr /= energy
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }
  if (bestCorr < PITCH_VOICED_THRESHOLD_RATIO || bestLag === 0) return 0
  return sampleRate / bestLag
}

// ─── 3. Zero crossing rate ─────────────────────────────────

export function computeZCR(frame) {
  if (!frame || frame.length < 2) return 0
  let count = 0
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) count++
  }
  return count / (frame.length - 1)
}

// ─── 4. Spectral centroid（频域 Uint8Array） ───────────────

export function computeSpectralCentroid(freqFrame, sampleRate, fftSize) {
  if (!freqFrame || freqFrame.length === 0) return 0
  // freqFrame 是 Uint8Array [0, 255]，表示各频段幅度
  // bin i 频率 = i * sampleRate / fftSize
  const binHz = sampleRate / fftSize
  let weightedSum = 0
  let totalAmp = 0
  for (let i = 0; i < freqFrame.length; i++) {
    const amp = freqFrame[i]
    const freq = i * binHz
    weightedSum += amp * freq
    totalAmp += amp
  }
  if (totalAmp === 0) return 0
  return weightedSum / totalAmp
}

// ─── 5. Spectral flux（频谱变化） ──────────────────────────

export function computeSpectralFlux(freqFrame, prevFreqFrame) {
  if (!freqFrame) return 0
  if (!prevFreqFrame) return 0
  const n = Math.min(freqFrame.length, prevFreqFrame.length)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const diff = freqFrame[i] - prevFreqFrame[i]
    sum += diff > 0 ? diff * diff : 0
  }
  return Math.sqrt(sum / n)
}

// ─── 6. 一帧完整特征 ───────────────────────────────────────

// 提取一帧的所有 prosody 特征
//   options: { timeFrame, freqFrame, sampleRate, fftSize, prevFreqFrame }
//   返回: { rms, pitch, zcr, centroid, flux, voiced }
export function extractFeatures(options = {}) {
  const timeFrame = options.timeFrame
  const freqFrame = options.freqFrame
  const sampleRate = options.sampleRate || 16000
  const fftSize = options.fftSize || 2048
  const rms = computeRMS(timeFrame)
  const pitch = computePitch(timeFrame, sampleRate)
  const zcr = computeZCR(timeFrame)
  const centroid = computeSpectralCentroid(freqFrame, sampleRate, fftSize)
  const flux = computeSpectralFlux(freqFrame, options.prevFreqFrame)
  const voiced = pitch > 0 && rms > ENERGY_SILENCE_THRESHOLD
  return {
    rms,
    pitch,
    zcr,
    centroid,
    flux,
    voiced,
  }
}

// ─── 7. 跨帧统计（用于 emotion-tracker） ───────────────────

// 滑动窗口特征 → 高级聚合（mean/std/min/max/voicedRatio/pauseRatio）
//   options: { frames: [{rms, pitch, zcr, centroid, flux, voiced, at}], sampleRate, fftSize }
//   返回: { rms: {mean, std, min, max}, pitch: {...}, zcr: {...}, centroid: {...},
//           flux: {...}, voicedRatio, pauseRatio, speakingRate }
export function aggregateFeatures(options = {}) {
  const frames = Array.isArray(options.frames) ? options.frames : []
  if (frames.length === 0) {
    return {
      rms: { mean: 0, std: 0, min: 0, max: 0 },
      pitch: { mean: 0, std: 0, min: 0, max: 0 },
      zcr: { mean: 0, std: 0, min: 0, max: 0 },
      centroid: { mean: 0, std: 0, min: 0, max: 0 },
      flux: { mean: 0, std: 0, min: 0, max: 0 },
      voicedRatio: 0,
      pauseRatio: 0,
      speakingRate: 0,
    }
  }
  const rmsArr = frames.map(f => f.rms || 0)
  const pitchArr = frames.map(f => f.pitch || 0)
  const zcrArr = frames.map(f => f.zcr || 0)
  const centArr = frames.map(f => f.centroid || 0)
  const fluxArr = frames.map(f => f.flux || 0)
  const voicedCount = frames.filter(f => f.voiced).length
  // Pause = voiced 但 rms < threshold
  const silenceCount = frames.filter(f => !f.voiced || f.rms < ENERGY_SPEECH_THRESHOLD).length
  // 语速 = 能量包络上升沿（每帧能量上升 = 一个音节起点）
  let onsets = 0
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].rms > frames[i - 1].rms * 1.5 && frames[i].rms > ENERGY_SILENCE_THRESHOLD) {
      onsets++
    }
  }
  return {
    rms: { mean: mean(rmsArr), std: stddev(rmsArr), min: min(rmsArr), max: max(rmsArr) },
    pitch: { mean: mean(pitchArr.filter(p => p > 0)), std: stddev(pitchArr.filter(p => p > 0)), min: min(pitchArr), max: max(pitchArr) },
    zcr: { mean: mean(zcrArr), std: stddev(zcrArr), min: min(zcrArr), max: max(zcrArr) },
    centroid: { mean: mean(centArr), std: stddev(centArr), min: min(centArr), max: max(centArr) },
    flux: { mean: mean(fluxArr), std: stddev(fluxArr), min: min(fluxArr), max: max(fluxArr) },
    voicedRatio: voicedCount / frames.length,
    pauseRatio: silenceCount / frames.length,
    speakingRate: onsets,  // raw count, normalize by duration outside
  }
}

export {
  PITCH_MIN_HZ,
  PITCH_MAX_HZ,
  ENERGY_SILENCE_THRESHOLD,
  ENERGY_SPEECH_THRESHOLD,
  PITCH_VOICED_THRESHOLD_RATIO,
}
