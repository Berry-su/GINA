// src/api/routes/translate.js — 翻译 API 路由（ADR-008）
//   GET  /translate/status     — 状态 + provider 配置 + 翻译记忆统计
//   GET  /translate/languages  — 6 语种列表
//   POST /translate/text       — 单次翻译 {text, from, to, provider?}
//   POST /translate/stream     — 流式翻译 (SSE) {text, from, to, onChunk}
//   POST /translate/clear-memory — 清翻译记忆
//
// 跟 src/voice/tts-providers.js + src/api/routes/tts.js 风格一致

import { jsonResponse, readJsonBody } from '../utils.js'

export async function handleTranslateRoutes(req, res, url) {
  const pathname = url.pathname

  // GET /translate/status
  if (req.method === 'GET' && pathname === '/translate/status') {
    try {
      const mod = await import('../../i18n/translate.js')
      const stats = mod.getMemoryStats()
      jsonResponse(res, 200, {
        ok: true,
        providers: mod.TRANSLATE_PROVIDERS,
        supportedLanguages: mod.SUPPORTED_LANGUAGES,
        memory: stats,
      })
    } catch (err) {
      console.error('[translate] /translate/status error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /translate/languages
  if (req.method === 'GET' && pathname === '/translate/languages') {
    try {
      const mod = await import('../../i18n/translate.js')
      jsonResponse(res, 200, {
        ok: true,
        languages: mod.SUPPORTED_LANGUAGES,
        labels: mod.LANGUAGE_LABELS,
      })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /translate/text
  if (req.method === 'POST' && pathname === '/translate/text') {
    try {
      const body = await readJsonBody(req)
      const { text, from = 'auto', to = 'en', provider = null, creds = {} } = body || {}
      if (!text) {
        jsonResponse(res, 400, { ok: false, error: '缺少 text 字段' })
        return true
      }
      const mod = await import('../../i18n/translate.js')
      const result = await mod.translate(text, { from, to, provider, creds })
      jsonResponse(res, 200, { ok: true, ...result })
    } catch (err) {
      console.error('[translate] /translate/text error:', err?.message || err)
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /translate/stream — SSE 流式
  if (req.method === 'POST' && pathname === '/translate/stream') {
    try {
      const body = await readJsonBody(req)
      const { text, from = 'auto', to = 'en', provider = null, creds = {} } = body || {}
      if (!text) {
        jsonResponse(res, 400, { ok: false, error: '缺少 text 字段' })
        return true
      }
      const mod = await import('../../i18n/translate.js')
      // SSE 头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      const chunks = await mod.translateStream(text, {
        from, to, provider, creds,
        onChunk: (chunk) => {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        },
      })
      res.write(`event: end\ndata: ${JSON.stringify({ total: chunks.length })}\n\n`)
      res.end()
    } catch (err) {
      console.error('[translate] /translate/stream error:', err?.message || err)
      // SSE 中途错误：发 error event
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: String(err?.message || err) })}\n\n`)
        res.end()
      } catch {}
    }
    return true
  }

  // POST /translate/clear-memory
  if (req.method === 'POST' && pathname === '/translate/clear-memory') {
    try {
      const mod = await import('../../i18n/translate.js')
      mod.clearMemory()
      jsonResponse(res, 200, { ok: true })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false  // 不属于本路由
}
