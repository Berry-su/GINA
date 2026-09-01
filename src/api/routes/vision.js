/**
 * vision.js — 视觉系统 API 路由
 *
 * 提供视觉感知相关的 API 端点：
 *   GET  /vision/status           — 获取视觉系统状态
 *   GET  /vision/paths            — 获取常用路径
 *   GET  /vision/browse           — 浏览目录
 *   GET  /vision/images           — 浏览图片目录
 *   GET  /vision/videos           — 浏览视频目录
 *   GET  /vision/analyze-image    — 分析图片
 *   GET  /vision/analyze-video    — 分析视频
 *   POST /vision/capture          — 截屏
 *   GET  /vision/read-file        — 读取文件内容
 *   GET  /vision/search           — 搜索文件
 */

import { jsonResponse, readJsonBody } from '../utils.js'

export async function handleVisionRoutes(req, res, url) {
  const pathname = url.pathname

  // GET /vision/status — 获取视觉系统状态
  if (req.method === 'GET' && pathname === '/vision/status') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const status = mod.getVisionStatus()
      jsonResponse(res, 200, { ok: true, status })
    } catch (err) {
      console.error('[vision] /vision/status error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/paths — 获取常用路径
  if (req.method === 'GET' && pathname === '/vision/paths') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const paths = mod.getCommonPaths()
      jsonResponse(res, 200, { ok: true, paths })
    } catch (err) {
      console.error('[vision] /vision/paths error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/browse — 浏览目录
  if (req.method === 'GET' && pathname === '/vision/browse') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const params = {
        path: url.searchParams.get('path') || '~',
        recursive: url.searchParams.get('recursive') === 'true',
        depth: parseInt(url.searchParams.get('depth') || '1', 10),
        filter: url.searchParams.get('filter') || null,
        sortBy: url.searchParams.get('sortBy') || 'name',
        showHidden: url.searchParams.get('showHidden') === 'true',
        fileType: url.searchParams.get('fileType') || 'all',
      }
      const result = await mod.browseDirectory(params)
      jsonResponse(res, 200, result)
    } catch (err) {
      console.error('[vision] /vision/browse error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/images — 浏览图片
  if (req.method === 'GET' && pathname === '/vision/images') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const params = {
        dirPath: url.searchParams.get('path') || '~/Pictures',
        limit: parseInt(url.searchParams.get('limit') || '30', 10),
        recursive: url.searchParams.get('recursive') === 'true',
      }
      const result = await mod.browseImages(params)
      jsonResponse(res, 200, result)
    } catch (err) {
      console.error('[vision] /vision/images error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/videos — 浏览视频
  if (req.method === 'GET' && pathname === '/vision/videos') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const params = {
        dirPath: url.searchParams.get('path') || '~/Movies',
        limit: parseInt(url.searchParams.get('limit') || '20', 10),
        recursive: url.searchParams.get('recursive') === 'true',
      }
      const result = await mod.browseVideos(params)
      jsonResponse(res, 200, result)
    } catch (err) {
      console.error('[vision] /vision/videos error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/analyze-image — 分析图片
  if (req.method === 'GET' && pathname === '/vision/analyze-image') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const filePath = url.searchParams.get('path')
      if (!filePath) {
        jsonResponse(res, 400, { ok: false, error: '缺少 path 参数' })
        return true
      }
      const params = {
        filePath,
        includeOCR: url.searchParams.get('ocr') !== 'false',
        includeExif: url.searchParams.get('exif') !== 'false',
      }
      const result = await mod.analyzeImage(params)
      jsonResponse(res, 200, result)
    } catch (err) {
      console.error('[vision] /vision/analyze-image error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/analyze-video — 分析视频
  if (req.method === 'GET' && pathname === '/vision/analyze-video') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const filePath = url.searchParams.get('path')
      if (!filePath) {
        jsonResponse(res, 400, { ok: false, error: '缺少 path 参数' })
        return true
      }
      const params = {
        filePath,
        frameInterval: parseInt(url.searchParams.get('interval') || '10', 10),
        maxFrames: parseInt(url.searchParams.get('maxFrames') || '10', 10),
      }
      const result = await mod.analyzeVideo(params)
      jsonResponse(res, 200, result)
    } catch (err) {
      console.error('[vision] /vision/analyze-video error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /vision/capture — 截屏
  if (req.method === 'POST' && pathname === '/vision/capture') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const body = await readJsonBody(req)
      const params = {
        outputPath: body?.outputPath || null,
        displayId: body?.displayId || null,
        delay: body?.delay || 0,
      }
      const result = await mod.captureScreen(params)
      jsonResponse(res, 200, result)
    } catch (err) {
      console.error('[vision] /vision/capture error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/read-file — 读取文件内容
  if (req.method === 'GET' && pathname === '/vision/read-file') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const filePath = url.searchParams.get('path')
      if (!filePath) {
        jsonResponse(res, 400, { ok: false, error: '缺少 path 参数' })
        return true
      }
      const params = {
        filePath,
        maxChars: parseInt(url.searchParams.get('maxChars') || '5000', 10),
      }
      const result = await mod.readFileContent(params)
      jsonResponse(res, 200, result)
    } catch (err) {
      console.error('[vision] /vision/read-file error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/search — 搜索文件
  if (req.method === 'GET' && pathname === '/vision/search') {
    try {
      const mod = await import('../../memory/vision-perceptor.js')
      const query = url.searchParams.get('q')
      if (!query) {
        jsonResponse(res, 400, { ok: false, error: '缺少 q 参数' })
        return true
      }
      const params = {
        query,
        basePath: url.searchParams.get('path') || '~',
        fileType: url.searchParams.get('type') || 'all',
        maxResults: parseInt(url.searchParams.get('limit') || '50', 10),
        searchContent: url.searchParams.get('searchContent') === 'true',
        contentKeywords: url.searchParams.get('keywords')?.split(',').filter(Boolean) || [],
      }
      const result = await mod.searchFiles(params)
      jsonResponse(res, 200, result)
    } catch (err) {
      console.error('[vision] /vision/search error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // ── ADR-009 · Phase 1 VLM/OCR 扩展（不动现有 7 路由） ──────────────────
  // POST /vision/see — 看图（VLM，理解图内容）
  if (req.method === 'POST' && pathname === '/vision/see') {
    try {
      const body = await readJsonBody(req)
      const { imagePath, prompt, provider = null, creds = {} } = body || {}
      if (!imagePath) {
        jsonResponse(res, 400, { ok: false, error: '缺少 imagePath 字段' })
        return true
      }
      const mod = await import('../../multimodal/vlm.js')
      const result = await mod.seeImage(imagePath, prompt, { provider, creds })
      jsonResponse(res, 200, { ok: true, ...result })
    } catch (err) {
      console.error('[vision] /vision/see error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /vision/see-multi — 多图 VLM
  if (req.method === 'POST' && pathname === '/vision/see-multi') {
    try {
      const body = await readJsonBody(req)
      const { imagePaths, prompt, provider = null, creds = {} } = body || {}
      if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
        jsonResponse(res, 400, { ok: false, error: '缺少 imagePaths 数组' })
        return true
      }
      const mod = await import('../../multimodal/vlm.js')
      const results = await mod.seeImages(imagePaths, prompt, { provider, creds })
      jsonResponse(res, 200, { ok: true, results })
    } catch (err) {
      console.error('[vision] /vision/see-multi error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /vision/ocr — 识字（OCR，提取图内文字）
  if (req.method === 'POST' && pathname === '/vision/ocr') {
    try {
      const body = await readJsonBody(req)
      const { imagePath, language = 'en', provider = null, creds = {} } = body || {}
      if (!imagePath) {
        jsonResponse(res, 400, { ok: false, error: '缺少 imagePath 字段' })
        return true
      }
      const mod = await import('../../multimodal/ocr.js')
      const result = await mod.extractText(imagePath, { language, provider, creds })
      jsonResponse(res, 200, { ok: true, ...result })
    } catch (err) {
      console.error('[vision] /vision/ocr error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /vision/ocr-multi — 多语种 OCR
  if (req.method === 'POST' && pathname === '/vision/ocr-multi') {
    try {
      const body = await readJsonBody(req)
      const { imagePath, languages, provider = null, creds = {} } = body || {}
      if (!imagePath) {
        jsonResponse(res, 400, { ok: false, error: '缺少 imagePath 字段' })
        return true
      }
      const mod = await import('../../multimodal/ocr.js')
      const results = await mod.extractTextMultiLang(imagePath, languages, { provider, creds })
      jsonResponse(res, 200, { ok: true, results })
    } catch (err) {
      console.error('[vision] /vision/ocr-multi error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /vision/multimodal-status — VLM/OCR 状态 + 缓存统计
  if (req.method === 'GET' && pathname === '/vision/multimodal-status') {
    try {
      const vlm = await import('../../multimodal/vlm.js')
      const ocr = await import('../../multimodal/ocr.js')
      jsonResponse(res, 200, {
        ok: true,
        vlm: {
          providers: vlm.VLM_PROVIDERS,
          cache: vlm.getCacheStats(),
        },
        ocr: {
          providers: ocr.OCR_PROVIDERS,
          languages: ocr.OCR_LANGUAGES,
          cache: ocr.getCacheStats(),
        },
      })
    } catch (err) {
      console.error('[vision] /vision/multimodal-status error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
