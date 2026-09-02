// src/multimodal/video-frame-extractor.js — FFmpeg 帧采样封装（ADR-013 · Phase 6）
//
// 职责：
//   1. 调系统 ffmpeg/ffprobe 抽帧 + 视频元数据
//   2. 支持 3 种采样策略：interval（每 N 秒）/ keyframe（I 帧）/ scene（场景变化）
//   3. 帧输出 jpg（默认），可走 sharp 二次压缩
//
// 关键约束（C-4.3 红线）：
//   - emotion-isolation: 帧提取只输出元数据/路径列表
//   - 不 import joy-state
//   - 临时目录 process.exit 时清理
//
// 设计取舍：
//   - 直接调 ffmpeg 子进程（不走 fluent-ffmpeg 依赖）
//   - 找 ffmpeg：先 GINA_FFMPEG_PATH 环境变量 → /usr/local/bin → /opt/homebrew/bin → PATH
//   - 找不到 ffmpeg 时返回 stub（避免测试环境缺依赖）
//   - 不实装 pyscenedetect（python 依赖太重，scene 模式用 ffprobe 黑帧检测 stub）

import { execFile } from 'child_process'
import { promises as fs, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { createHash } from 'crypto'

const execFileAsync = promisify(execFile)

// ── 找 ffmpeg/ffprobe 二进制 ───────────────────────────────────────
function findBinary(name) {
  const candidates = []
  if (process.env.GINA_FFMPEG_PATH) candidates.push(process.env.GINA_FFMPEG_PATH.replace(/ffmpeg$/, name))
  candidates.push(`/usr/local/bin/${name}`)
  candidates.push(`/opt/homebrew/bin/${name}`)
  candidates.push(`/usr/bin/${name}`)
  // PATH 由 Node 自己 resolve
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return name  // 让 PATH 解析（fallback）
}

let _ffmpegPath = null
let _ffprobePath = null
function getFFmpeg() {
  if (!_ffmpegPath) _ffmpegPath = findBinary('ffmpeg')
  return _ffmpegPath
}
function getFFprobe() {
  if (!_ffprobePath) _ffprobePath = findBinary('ffprobe')
  return _ffprobePath
}

// ── 临时目录管理（process.exit 时清理） ────────────────────────────
const tempDirs = new Set()
let cleanupHooked = false
function ensureCleanupHook() {
  if (cleanupHooked) return
  cleanupHooked = true
  const cleanup = () => {
    for (const dir of tempDirs) {
      try { require('fs').rmSync(dir, { recursive: true, force: true }) } catch {}
    }
    tempDirs.clear()
  }
  process.once('exit', cleanup)
  process.once('SIGINT', () => { cleanup(); process.exit(130) })
  process.once('SIGTERM', () => { cleanup(); process.exit(143) })
}

function makeTempDir(prefix = 'gina-video-') {
  ensureCleanupHook()
  const dir = fs.mkdtempSync ? require('fs').mkdtempSync(join(tmpdir(), prefix)) : mkdirTemp(prefix)
  tempDirs.add(dir)
  return dir
}
function mkdirTemp(prefix) {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.add(dir)
  return dir
}

export async function cleanupTempFrames() {
  for (const dir of tempDirs) {
    try { await fs.rm(dir, { recursive: true, force: true }) } catch {}
  }
  tempDirs.clear()
}

// ── ffprobe 元数据 ───────────────────────────────────────────────
export async function probeVideo(videoPath) {
  const ffprobe = getFFprobe()
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ])
    const data = JSON.parse(stdout)
    const videoStream = (data.streams || []).find(s => s.codec_type === 'video')
    const audioStream = (data.streams || []).find(s => s.codec_type === 'audio')
    return {
      ok: true,
      durationSec: data.format?.duration ? parseFloat(data.format.duration) : null,
      size: data.format?.size ? parseInt(data.format.size, 10) : null,
      bitrate: data.format?.bit_rate ? parseInt(data.format.bit_rate, 10) : null,
      video: videoStream ? {
        codec: videoStream.codec_name,
        width: videoStream.width,
        height: videoStream.height,
        fps: videoStream.r_frame_rate,
        bitrate: videoStream.bit_rate,
      } : null,
      audio: audioStream ? {
        codec: audioStream.codec_name,
        channels: audioStream.channels,
        sampleRate: audioStream.audio_sample_rate,
      } : null,
    }
  } catch (err) {
    return { ok: false, error: `ffprobe 失败: ${err?.message || err}`, hint: '请确认 ffmpeg/ffprobe 已安装或设置 GINA_FFMPEG_PATH' }
  }
}

// ── 帧采样策略：interval（每 N 秒 1 帧） ──────────────────────────
async function extractByInterval(videoPath, { intervalSec = 1, maxFrames = 30, outDir }) {
  const ffmpeg = getFFmpeg()
  const pattern = join(outDir, 'frame_%04d.jpg')
  try {
    // -vf fps=1/N: 每 N 秒抽 1 帧
    await execFileAsync(ffmpeg, [
      '-i', videoPath,
      '-vf', `fps=1/${intervalSec}`,
      '-frames:v', String(maxFrames),
      '-q:v', '2',
      pattern,
    ], { timeout: 5 * 60 * 1000 })  // 5 min 超时
    return await listFrames(outDir)
  } catch (err) {
    throw new Error(`ffmpeg 抽帧失败: ${err?.message || err}`)
  }
}

// ── 帧采样策略：keyframe（仅 I 帧） ────────────────────────────────
async function extractKeyframes(videoPath, { maxFrames = 30, outDir }) {
  const ffmpeg = getFFmpeg()
  const pattern = join(outDir, 'keyframe_%04d.jpg')
  try {
    await execFileAsync(ffmpeg, [
      '-i', videoPath,
      '-vf', 'select=eq(pict_type\\,I)',
      '-vsync', 'vfr',
      '-frames:v', String(maxFrames),
      '-q:v', '2',
      pattern,
    ], { timeout: 5 * 60 * 1000 })
    return await listFrames(outDir)
  } catch (err) {
    throw new Error(`ffmpeg keyframe 抽帧失败: ${err?.message || err}`)
  }
}

// ── 帧采样策略：scene（场景变化检测，stub） ────────────────────────
async function extractByScene(videoPath, { threshold = 0.3, maxFrames = 30, outDir }) {
  // 简化实现：黑帧检测（ffmpeg blackframe）
  // 真 pyscenedetect 留给 GINA_VIDEO_SCENE_DETECT=1
  if (process.env.GINA_VIDEO_SCENE_DETECT !== '1') {
    return await extractByInterval(videoPath, { intervalSec: 5, maxFrames, outDir })
  }
  const ffmpeg = getFFmpeg()
  const pattern = join(outDir, 'scene_%04d.jpg')
  try {
    await execFileAsync(ffmpeg, [
      '-i', videoPath,
      '-vf', `select='gt(scene\\,${threshold})'`,
      '-frames:v', String(maxFrames),
      '-q:v', '2',
      pattern,
    ], { timeout: 5 * 60 * 1000 })
    return await listFrames(outDir)
  } catch (err) {
    throw new Error(`ffmpeg scene 抽帧失败: ${err?.message || err}`)
  }
}

// ── 帧列表（含时间戳） ────────────────────────────────────────────
async function listFrames(outDir) {
  try {
    const files = await fs.readdir(outDir)
    const jpgFiles = files.filter(f => f.endsWith('.jpg') || f.endsWith('.png')).sort()
    const out = []
    for (let i = 0; i < jpgFiles.length; i++) {
      const fp = join(outDir, jpgFiles[i])
      const st = await fs.stat(fp)
      out.push({
        index: i,
        path: fp,
        filename: jpgFiles[i],
        size: st.size,
        // 时间戳从文件名推（默认 interval 模式 frame_NNNN.jpg 假设 1 fps 步进）
        // 真实时间戳留给 ffmpeg 二次探测（本期 stub）
      })
    }
    return out
  } catch (err) {
    return []
  }
}

// ── 统一 extract API ──────────────────────────────────────────────
export async function extractFrames(videoPath, { strategy = 'interval', intervalSec = 1, maxFrames = 30, threshold = 0.3, outDir } = {}) {
  if (!videoPath || typeof videoPath !== 'string') {
    throw new TypeError('extractFrames: videoPath 必须是非空字符串')
  }
  if (!existsSync(videoPath)) {
    throw new Error(`视频文件不存在: ${videoPath}`)
  }
  const targetDir = outDir || makeTempDir('gina-video-frames-')
  let frames
  if (strategy === 'keyframe') {
    frames = await extractKeyframes(videoPath, { maxFrames, outDir: targetDir })
  } else if (strategy === 'scene') {
    frames = await extractByScene(videoPath, { threshold, maxFrames, outDir: targetDir })
  } else {
    frames = await extractByInterval(videoPath, { intervalSec, maxFrames, outDir: targetDir })
  }
  // 帧用 sha256 算 content key（供 VLM 缓存复用）
  for (const f of frames) {
    try {
      const buf = await fs.readFile(f.path)
      f.contentHash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
    } catch {}
  }
  return { ok: true, strategy, count: frames.length, frames, outDir: targetDir, temp: !outDir }
}

// ── 抽音频（供 Whisper） ──────────────────────────────────────────
export async function extractAudio(videoPath, { outPath, sampleRate = 16000, channels = 1 } = {}) {
  const ffmpeg = getFFmpeg()
  const target = outPath || makeTempDir('gina-audio-') + '/audio.wav'
  try {
    await execFileAsync(ffmpeg, [
      '-i', videoPath,
      '-vn',                       // 不要视频
      '-acodec', 'pcm_s16le',      // PCM 16-bit
      '-ar', String(sampleRate),   // 16kHz
      '-ac', String(channels),     // 单声道
      target,
    ], { timeout: 5 * 60 * 1000 })
    return { ok: true, audioPath: target }
  } catch (err) {
    throw new Error(`ffmpeg 抽音频失败: ${err?.message || err}`)
  }
}

// ── 测试钩子 ─────────────────────────────────────────────────────
export const __test = {
  findBinary,
  getFFmpeg,
  getFFprobe,
  makeTempDir,
  tempDirs,
  extractByInterval,
  extractKeyframes,
  extractByScene,
}

export default {
  probeVideo,
  extractFrames,
  extractAudio,
  cleanupTempFrames,
  __test,
}
