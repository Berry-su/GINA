// src/api/routes/email.js — 邮件 API 路由（ADR-010 · Phase 2）
//
//   GET  /email/status            — provider 配置 + 缓存
//   GET  /email/messages          — 列出邮件（list）
//   GET  /email/messages/search   — 搜邮件（search）
//   GET  /email/messages/:id      — 取邮件（get）
//   POST /email/send              — 发邮件（send）
//   POST /email/messages/:id/read — 标已读（mark_read）
//
// 跟 translate.js / calendar.js 风格一致

import { jsonResponse, readJsonBody } from '../utils.js'
import {
  listEmails, searchEmails, getEmail, sendEmail, markRead, getEmailStatus,
} from '../../connectors/email.js'
import { ingestEmails } from '../../connectors/memory-bridge.js'

export async function handleEmailRoutes(req, res, url) {
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === '/email/status') {
    try {
      const status = getEmailStatus()
      jsonResponse(res, 200, { ok: true, ...status })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /email/messages/search?q=...
  if (req.method === 'GET' && pathname === '/email/messages/search') {
    try {
      const params = Object.fromEntries(url.searchParams)
      const emails = await searchEmails({
        provider: params.provider,
        query: params.q || '',
        limit: Number(params.limit) || 20,
      })
      await ingestEmails(emails)
      jsonResponse(res, 200, { ok: true, count: emails.length, emails })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /email/messages/:id
  const getMatch = pathname.match(/^\/email\/messages\/([^/]+)$/)
  if (req.method === 'GET' && getMatch) {
    try {
      const id = decodeURIComponent(getMatch[1])
      const provider = url.searchParams.get('provider')
      const email = await getEmail({ provider, id })
      await ingestEmails([email])
      jsonResponse(res, 200, { ok: true, email })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /email/messages/:id/read
  if (req.method === 'POST' && getMatch) {
    try {
      const id = decodeURIComponent(getMatch[1])
      const body = await readJsonBody(req).catch(() => ({}))
      const provider = url.searchParams.get('provider') || body.provider
      const r = await markRead({ provider, id, read: body.read !== false })
      jsonResponse(res, 200, { ok: r.ok, id, unread: r.unread })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /email/messages?folder=INBOX&limit=20&unreadOnly=true
  if (req.method === 'GET' && pathname === '/email/messages') {
    try {
      const params = Object.fromEntries(url.searchParams)
      const emails = await listEmails({
        provider: params.provider,
        folder: params.folder || 'INBOX',
        limit: Number(params.limit) || 20,
        unreadOnly: params.unreadOnly === 'true' || params.unreadOnly === '1',
      })
      await ingestEmails(emails)
      jsonResponse(res, 200, { ok: true, count: emails.length, emails })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /email/send
  if (req.method === 'POST' && pathname === '/email/send') {
    try {
      const body = await readJsonBody(req)
      if (!body.to || !body.subject) {
        jsonResponse(res, 400, { ok: false, error: '缺少 to 或 subject' })
        return true
      }
      const r = await sendEmail({ ...body })
      jsonResponse(res, 200, { ok: r.ok, sent: r })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
