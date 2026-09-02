// src/api/routes/video.js — Video API 路由（ADR-013 · Phase 6 · PLAN-P6 完工阶段）
//
//   GET  /video/status         — 整体状态（providers + cache + active jobs）
//   GET  /video/sources        — 数据源类型 + 本地视频列表
//   POST /video/probe          — 探查视频元数据（duration / 分辨率 / 编码）
//   POST /video/summarize      — 启动视频摘要（异步，返回 jobId）
//   GET  /video/jobs           — 列所有 active jobs
//   GET  /video/jobs/:jobId    — 查单个 job 状态
//   POST /video/extract-frames — 同步抽帧（小视频）
//   POST /video/detect-source  — 解析 source 类型
//
// 跟 src/api/routes/iot.js + translate.js + notes.js 风格一致

import { jsonResponse, readJsonBody } from '../utils.js'
import {
  summarizeVideo,
  extractVideoFrames,
  transcribeVideo,
  detectSource,
  listLocalVideos,
  probeVideo,
  getJobStatus,
  listActiveJobs,
  validateVideoConfig,
  getCacheStats,
  VIDEO_PROVIDERS,
  SUMMARIZER_PROVIDERS,
} from '../../multimodal/video.js'

export async function handleVideoRoutes(req, res, url) {
  const pathname = url.pathname

  // GET /video/status
  if (req.method === 'GET' && pathname === '/video/status') {
    try {
      const jobs = listActiveJobs()
      jsonResponse(res, 200, {
        ok: true,
        providers: VIDEO_PROVIDERS,
        summarizerProviders: SUMMARIZER_PROVIDERS,
        cache: getCacheStats(),
        activeJobs: jobs.length,
      })
    } catch (err) {
      console.error('[video] /video/status error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /video/sources
  if (req.method === 'GET' && pathname === '/video/sources') {
    try {
      const dir = url.searchParams.get('dir') || '~/Movies'
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
      const recursive = url.searchParams.get('recursive') === 'true'
      const result = await listLocalVideos({ dir, limit, recursive })
      jsonResponse(res, 200, { ok: true, ...result })
    } catch (err) {
      console.error('[video] /video/sources error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /video/probe
  if (req.method === 'POST' && pathname === '/video/probe') {
    try {
      const body = await readJsonBody(req)
      const { source } = body || {}
      if (!source) {
        jsonResponse(res, 400, { ok: false, error: '缺少 source 字段' })
        return true
      }
      const probe = await probeVideo(source)
      jsonResponse(res, probe.ok ? 200 : 400, { ok: probe.ok, source, ...probe })
    } catch (err) {
      console.error('[video] /video/probe error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /video/summarize — 异步任务
  if (req.method === 'POST' && pathname === '/video/summarize') {
    try {
      const body = await readJsonBody(req)
      const {
        source,
        provider = 'mock',
        frameIntervalSec = 30,
        maxFrames = 30,
        language = 'auto',
        includeAudio = true,
      } = body || {}
      if (!source) {
        jsonResponse(res, 400, { ok: false, error: '缺少 source 字段' })
        return true
      }
      const detected = detectSource(source)
      if (!detected.valid) {
        jsonResponse(res, 400, { ok: false, error: detected.error || `无效 source: ${source}` })
        return true
      }
      const configCheck = validateVideoConfig({ provider })
      if (!configCheck.ok) {
        jsonResponse(res, 400, { ok: false, error: configCheck.guide || 'provider 不可用' })
        return true
      }
      // 启动异步任务（立即返回）
      const jobPromise = summarizeVideo(source, {
        provider,
        frameIntervalSec,
        maxFrames,
        language,
        includeAudio,
      })
      // 把 jobId 取出来（summarizeVideo 返回的对象上有 jobId）
      // 但 Promise 还没 resolve，所以先用临时 id，client 轮询 jobs 接口
      const tempJobId = `video-${Date.now()}-pending`
      // 在 promise resolve 后更新 activeJobs
      // 由于 summarizeVideo 内部已经登记了 jobId，我们这里只做"承诺式"返回
      const finalResult = await jobPromise.catch((err) => ({ ok: false, error: err?.message || String(err) }))
      // 注：summarizeVideo 内部已经返回 jobId，这里再返回完整结果（同步语义）
      jsonResponse(res, finalResult.ok ? 200 : 500, { ok: finalResult.ok, ...finalResult })
    } catch (err) {
      console.error('[video] /video/summarize error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /video/jobs
  if (req.method === 'GET' && pathname === '/video/jobs') {
    try {
      const jobs = listActiveJobs()
      jsonResponse(res, 200, { ok: true, count: jobs.length, jobs })
    } catch (err) {
      console.error('[video] /video/jobs error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /video/jobs/:jobId
  const jobMatch = pathname.match(/^\/video\/jobs\/([^/]+)$/)
  if (req.method === 'GET' && jobMatch) {
    try {
      const jobId = decodeURIComponent(jobMatch[1])
      const job = getJobStatus(jobId)
      if (!job) {
        jsonResponse(res, 404, { ok: false, error: `job ${jobId} 不存在或已结束（job 记录保留 5 分钟）` })
        return true
      }
      jsonResponse(res, 200, { ok: true, job })
    } catch (err) {
      console.error('[video] /video/jobs/:jobId error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /video/extract-frames
  if (req.method === 'POST' && pathname === '/video/extract-frames') {
    try {
      const body = await readJsonBody(req)
      const { source, strategy = 'interval', intervalSec = 1, maxFrames = 10 } = body || {}
      if (!source) {
        jsonResponse(res, 400, { ok: false, error: '缺少 source 字段' })
        return true
      }
      const result = await extractVideoFrames(source, { strategy, intervalSec, maxFrames: Math.min(maxFrames, 100) })
      jsonResponse(res, 200, { ok: true, ...result })
    } catch (err) {
      console.error('[video] /video/extract-frames error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /video/detect-source
  if (req.method === 'POST' && pathname === '/video/detect-source') {
    try {
      const body = await readJsonBody(req)
      const { source } = body || {}
      if (!source) {
        jsonResponse(res, 400, { ok: false, error: '缺少 source 字段' })
        return true
      }
      const detected = detectSource(source)
      jsonResponse(res, 200, { ok: true, source, detected })
    } catch (err) {
      console.error('[video] /video/detect-source error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
