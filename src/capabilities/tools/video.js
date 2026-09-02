// src/capabilities/tools/video.js — Video 工具执行器（ADR-013 · Phase 6）
//
// LLM 调 query_video / summarize_video / extract_video_frames 时走这里。
// 逻辑：
//   1. 解析 args.action / source / provider
//   2. 调对应 multimodal/video.js 接口
//   3. 异步任务返回 jobId
//   4. 返回结构化 string 给 LLM
//
// emotion-isolation 严守：
//   - tool 输出不含 emotion 词
//   - 视频处理是后台任务，不触发 joy 也不进决策

import {
  summarizeVideo as coreSummarizeVideo,
  extractVideoFrames as coreExtractFrames,
  transcribeVideo as coreTranscribe,
  detectSource,
  loadSource,
  listLocalVideos,
  probeVideo,
  getJobStatus,
  listActiveJobs,
  validateVideoConfig,
  getCacheStats,
  VIDEO_PROVIDERS,
} from '../../multimodal/video.js'
import { SUMMARIZER_PROVIDERS } from '../../multimodal/video-summarizer.js'

// ── 通用 helper ────────────────────────────────────────────────
function toolJson(obj) {
  return JSON.stringify(obj, null, 2)
}

// ── query_video 执行器 ──────────────────────────────────────────
export async function execQueryVideo(args = {}, context = {}) {
  const action = args.action
  if (!action) return '错误：未提供 action（list_local / probe / get_job / list_jobs / status）'

  if (action === 'list_local') {
    const result = await listLocalVideos({
      dir: args.dir || '~/Movies',
      limit: Math.min(args.limit || 20, 100),
      recursive: Boolean(args.recursive),
    })
    return toolJson({ ok: result.ok, action, ...result })
  }

  if (action === 'probe') {
    if (!args.source) return '错误：probe 需要 source 参数（本地视频绝对路径）'
    try {
      const probe = await probeVideo(args.source)
      return toolJson({ ok: probe.ok, action, source: args.source, ...probe })
    } catch (err) {
      return toolJson({ ok: false, action, source: args.source, error: err?.message || String(err) })
    }
  }

  if (action === 'get_job') {
    if (!args.jobId) return '错误：get_job 需要 jobId'
    const job = getJobStatus(args.jobId)
    if (!job) return toolJson({ ok: false, action, error: `job ${args.jobId} 不存在或已结束` })
    return toolJson({ ok: true, action, job })
  }

  if (action === 'list_jobs') {
    const jobs = listActiveJobs()
    return toolJson({ ok: true, action, count: jobs.length, jobs })
  }

  if (action === 'status') {
    return toolJson({
      ok: true,
      action,
      providers: VIDEO_PROVIDERS,
      summarizerProviders: SUMMARIZER_PROVIDERS,
      cache: getCacheStats(),
    })
  }

  return `错误：未知 action "${action}"`
}

// ── summarize_video 执行器（异步） ─────────────────────────────
export async function execSummarizeVideo(args = {}, context = {}) {
  if (!args.source) return '错误：summarize_video 需要 source 参数'

  const detected = detectSource(args.source)
  if (!detected.valid) {
    return toolJson({ ok: false, error: detected.error || `无效 source: ${args.source}` })
  }

  const configCheck = validateVideoConfig({ provider: args.provider || 'mock' })
  if (!configCheck.ok) {
    return toolJson({ ok: false, error: configCheck.guide || 'provider 不可用' })
  }

  // 启动异步任务，立即返回 jobId
  const jobPromise = coreSummarizeVideo(args.source, {
    frameIntervalSec: args.frameIntervalSec || 30,
    maxFrames: args.maxFrames || 30,
    language: args.language || 'auto',
    includeAudio: args.includeAudio !== false,
    provider: args.provider || 'mock',
    creds: context?.creds || {},
  }).catch((err) => ({ ok: false, error: err?.message || String(err) }))

  // 不 await 整体：让 job 在后台跑，立即返回 status
  jobPromise.then((result) => {
    if (globalThis?.videoJobSink) {
      try { globalThis.videoJobSink(result) } catch {}
    }
  }).catch(() => {})

  const jobId = (jobPromise && jobPromise.jobId) || `video-pending-${Date.now()}`
  return toolJson({
    ok: true,
    action: 'summarize_video',
    source: args.source,
    jobId,
    status: 'started',
    message: '视频摘要已启动后台任务。用 query_video(action="get_job", jobId=...) 查进度。',
  })
}

// ── extract_video_frames 执行器 ─────────────────────────────────
export async function execExtractVideoFrames(args = {}, context = {}) {
  if (!args.source) return '错误：extract_video_frames 需要 source 参数'
  try {
    const result = await coreExtractFrames(args.source, {
      strategy: args.strategy || 'interval',
      intervalSec: args.intervalSec || 1,
      maxFrames: Math.min(args.maxFrames || 10, 100),
    })
    return toolJson({ ok: true, action: 'extract_video_frames', ...result })
  } catch (err) {
    return toolJson({ ok: false, action: 'extract_video_frames', error: err?.message || String(err) })
  }
}

// ── transcribe_video（预留，当前 summarize_video 已含音频） ────
export async function execTranscribeVideo(args = {}, context = {}) {
  if (!args.source) return '错误：transcribe_video 需要 source 参数'
  try {
    const result = await coreTranscribe(args.source, { language: args.language || 'auto', provider: args.provider || 'mock' })
    return toolJson({ ok: true, action: 'transcribe_video', ...result })
  } catch (err) {
    return toolJson({ ok: false, action: 'transcribe_video', error: err?.message || String(err) })
  }
}
