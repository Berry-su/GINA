// src/multimodal/video.js — 视频理解核心抽象（ADR-013 · Phase 6 · PLAN-P6 完工阶段）
//
// 核心职责：3 数据源 + 3 provider 的视频理解统一 API。
//   - summarizeVideo(source, options) → { transcript, keyframes, chapters, summary, duration }
//   - extractFrames(source, interval, count) → 帧数组
//   - transcribeVideo(source, language) → 字幕 + 时间戳
//
// 关键约束（C-4.3 红线）：
//   - emotion-isolation: 视频理解输出只进文本流，不触发 joy 情绪
//   - 不 import joy-state
//   - 缓存：frame content hash → LRU 50（避免同帧重抽）
//   - 失败 fallback：ffmpeg 不可用 → mock stub
//   - 复用 Phase 1（VLM/OCR/Whisper）+ Phase 2（capabilities） + Phase 3（cron）
//
// 跟 src/multimodal/vlm.js / ocr.js / translate.js 风格一致

import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { loadSource, detectSource, VIDEO_SOURCES, listLocalVideos } from './video-sources.js'
import { extractFrames, probeVideo, extractAudio, cleanupTempFrames } from './video-frame-extractor.js'
import { summarizeVideo as _summarizeVideo, detectKeyEvents, clusterIntoChapters, transcribeAudio, generateSummary, SUMMARIZER_PROVIDERS } from './video-summarizer.js'

// Re-exports
export { loadSource, detectSource, listLocalVideos, VIDEO_SOURCES } from './video-sources.js'
export { probeVideo, extractFrames, extractAudio, cleanupTempFrames } from './video-frame-extractor.js'

// ── Provider 配置 ────────────────────────────────────────────────
export const VIDEO_PROVIDERS = [
  ...SUMMARIZER_PROVIDERS,
  { id: 'ffmpeg',     label: 'FFmpeg 系统二进制 (Phase 6)', default: false, requiresKey: null },
]

// ── 帧缓存（content hash → 元数据） ──────────────────────────────
const CACHE_MAX = 50
const frameCache = new Map()
let cacheHits = 0
let cacheMisses = 0

function _hashKey(input) {
  return createHash('sha256').update(String(input)).digest('hex').slice(0, 16)
}

function _cacheGet(key) {
  if (!frameCache.has(key)) { cacheMisses++; return null }
  const v = frameCache.get(key)
  frameCache.delete(key)
  frameCache.set(key, v)
  cacheHits++
  return v
}
function _cacheSet(key, val) {
  if (frameCache.has(key)) frameCache.delete(key)
  frameCache.set(key, val)
  while (frameCache.size > CACHE_MAX) {
    const first = frameCache.keys().next().value
    frameCache.delete(first)
  }
}
export function clearCache() {
  frameCache.clear()
  cacheHits = 0
  cacheMisses = 0
}
export function getCacheStats() {
  const total = cacheHits + cacheMisses
  return {
    size: frameCache.size,
    max: CACHE_MAX,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total === 0 ? 0 : (cacheHits / total).toFixed(3),
  }
}

// ── Provider 预检 ────────────────────────────────────────────────
export function validateVideoConfig(creds = {}) {
  const provider = creds.provider || 'mock'
  const req = VIDEO_PROVIDERS.find(p => p.id === provider)
  if (!req) return { ok: false, provider, guide: `video provider "${provider}" 未知。` }
  if (req.requiresKey && !String(creds[req.requiresKey] || '').trim()) {
    return { ok: false, provider, missing: [req.requiresKey], guide: `${req.label} 缺 API Key（${req.requiresKey}）` }
  }
  return { ok: true, provider }
}

// ── 进度管理（async 任务跟踪） ──────────────────────────────────
const activeJobs = new Map()
let jobCounter = 0

function _newJobId() {
  return `video-${Date.now()}-${++jobCounter}`
}

// ── 统一 API: summarizeVideo ─────────────────────────────────────
//
// 完整流程：
//   1. detectSource 识别 local/url-public/streaming/mock
//   2. probeVideo 查时长/分辨率（ffprobe）
//   3. extractFrames 抽帧（ffmpeg 1fps 采样）
//   4. VLM seeImages 多帧理解 → 关键事件
//   5. extractAudio 抽音频 → Whisper 转写
//   6. clusterIntoChapters 章节聚类
//   7. generateSummary LLM 融合摘要
//
// 进度回调：onProgress(0-1, stage)
// 异步执行：返回 jobId，可通过 getStatus(jobId) 查进度
export async function summarizeVideo(sourceInput, options = {}) {
  const opts = {
    frameIntervalSec: 30,
    maxFrames: 30,
    language: 'auto',
    includeAudio: true,
    provider: 'mock',
    creds: {},
    onProgress: null,
    ...options,
  }

  // source 预检
  const detected = detectSource(sourceInput)
  if (!detected.valid) {
    throw new Error(detected.error || `无效 source: ${sourceInput}`)
  }

  // mock:// 协议：测试用，无 IO（不检查 existsSync）
  const isMock = detected.kind === 'mock' || /^mock:\/\//i.test(sourceInput)

  // local 必存在（mock 除外）
  if (!isMock && detected.kind === 'local' && !detected.exists) {
    throw new Error(`本地视频不存在: ${detected.path}`)
  }

  // 限制时长（仅 local）
  const maxDurationSec = opts.maxDurationSec || 60 * 60  // 60 min
  if (!isMock && detected.kind === 'local') {
    try {
      const probe = await probeVideo(detected.path)
      if (probe.ok && probe.durationSec && probe.durationSec > maxDurationSec) {
        throw new Error(`视频时长 ${probe.durationSec}s 超过 ${maxDurationSec}s 上限`)
      }
    } catch (err) {
      if (err.message.includes('上限')) throw err
      console.warn('[video] probeVideo 警告:', err?.message || err)
    }
  }

  // 缓存 key
  const cacheKey = _hashKey(`${detected.kind}::${sourceInput}::${opts.frameIntervalSec}::${opts.maxFrames}::${opts.provider}::${opts.includeAudio}`)
  const cached = _cacheGet(cacheKey)
  if (cached && opts.provider !== 'mock') {
    return { ...cached, cached: true }
  }

  // 注册 job
  const jobId = _newJobId()
  const job = {
    jobId,
    source: sourceInput,
    status: 'running',
    progress: 0,
    stage: 'init',
    startedAt: Date.now(),
    error: null,
  }
  activeJobs.set(jobId, job)

  // 进度回调包装
  const onProgress = (p, stage) => {
    job.progress = p
    job.stage = stage
    if (typeof opts.onProgress === 'function') {
      try { opts.onProgress(p, stage) } catch {}
    }
  }

  try {
    const result = await _summarizeVideo(sourceInput, { ...opts, onProgress })
    job.status = 'done'
    job.progress = 1
    job.stage = 'done'
    job.result = result
    _cacheSet(cacheKey, result)
    return { ...result, jobId, cached: false }
  } catch (err) {
    job.status = 'error'
    job.error = err?.message || String(err)
    throw err
  } finally {
    // job 留 5 分钟给前端查 status（unref 不阻止 node process 退出）
    const t = setTimeout(() => activeJobs.delete(jobId), 5 * 60 * 1000)
    if (typeof t.unref === 'function') t.unref()
  }
}

// ── 统一 API: extractFrames（直接抽帧，无 VLM/Whisper） ─────────
export async function extractVideoFrames(sourceInput, { intervalSec = 1, maxFrames = 10, strategy = 'interval' } = {}) {
  const source = await loadSource(sourceInput)
  if (!source.path) {
    throw new Error(`source "${sourceInput}" 无可用本地路径（url-public / streaming 默认不下载）`)
  }
  if (source.size && source.size > 2 * 1024 * 1024 * 1024) {
    throw new Error(`视频过大（${(source.size / 1024 / 1024).toFixed(0)}MB > 2GB 上限）`)
  }
  const r = await extractFrames(source.path, { strategy, intervalSec, maxFrames })
  return {
    ok: true,
    source: { kind: source.kind, title: source.title },
    count: r.count,
    frames: r.frames,
    strategy: r.strategy,
  }
}

// ── 统一 API: transcribeVideo（仅音频转写） ─────────────────────
export async function transcribeVideo(sourceInput, { language = 'auto', provider = 'mock' } = {}) {
  const source = await loadSource(sourceInput)
  if (!source.path) {
    throw new Error(`source "${sourceInput}" 无可用本地路径`)
  }
  return await transcribeAudio(source.path, { language, provider })
}

// ── Job 状态查询 ────────────────────────────────────────────────
export function getJobStatus(jobId) {
  return activeJobs.get(jobId) || null
}
export function listActiveJobs() {
  return [...activeJobs.values()]
}

// ── 测试钩子 ────────────────────────────────────────────────────
export const __test = {
  _hashKey,
  _cacheGet,
  _cacheSet,
  _newJobId,
  CACHE_MAX,
  activeJobs,
}

export default {
  VIDEO_PROVIDERS,
  SUMMARIZER_PROVIDERS,
  summarizeVideo,
  extractVideoFrames,
  transcribeVideo,
  detectSource,
  loadSource,
  listLocalVideos,
  probeVideo,
  validateVideoConfig,
  getJobStatus,
  listActiveJobs,
  clearCache,
  getCacheStats,
  __test,
}
