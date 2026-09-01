// src/api/routes/calendar.js — 日历 API 路由（ADR-010 · Phase 2）
//
//   GET  /calendar/status          — provider 配置 + 缓存状态
//   GET  /calendar/calendars       — 列出日历（list_calendars）
//   GET  /calendar/events          — 查询事件（query）
//   POST /calendar/events          — 创建事件（create）
//   PATCH /calendar/events/:id     — 更新事件（update）
//   DELETE /calendar/events/:id    — 删除事件（delete）
//
// 跟 src/api/routes/translate.js + vision.js 风格一致

import { jsonResponse, readJsonBody } from '../utils.js'
import {
  listCalendars, queryEvents, createEvent, updateEvent, deleteEvent, getCalendarStatus,
} from '../../connectors/calendar.js'
import { ingestCalendarEvents } from '../../connectors/memory-bridge.js'

export async function handleCalendarRoutes(req, res, url) {
  const pathname = url.pathname

  // GET /calendar/status
  if (req.method === 'GET' && pathname === '/calendar/status') {
    try {
      const status = getCalendarStatus()
      jsonResponse(res, 200, { ok: true, ...status })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /calendar/calendars
  if (req.method === 'GET' && pathname === '/calendar/calendars') {
    try {
      const provider = url.searchParams.get('provider')
      const calendars = await listCalendars({ provider })
      jsonResponse(res, 200, { ok: true, count: calendars.length, calendars })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /calendar/events
  if (req.method === 'GET' && pathname === '/calendar/events') {
    try {
      const params = Object.fromEntries(url.searchParams)
      const events = await queryEvents({
        provider: params.provider,
        calendarId: params.calendarId,
        rangeStart: params.rangeStart,
        rangeEnd: params.rangeEnd,
        maxResults: Number(params.limit) || 50,
      })
      const ingest = await ingestCalendarEvents(events)
      jsonResponse(res, 200, { ok: true, count: events.length, events, memoryIngest: ingest })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /calendar/events
  if (req.method === 'POST' && pathname === '/calendar/events') {
    try {
      const body = await readJsonBody(req)
      if (!body.title || !body.start) {
        jsonResponse(res, 400, { ok: false, error: '缺少 title 或 start' })
        return true
      }
      const event = await createEvent({ ...body })
      await ingestCalendarEvents([event])
      jsonResponse(res, 200, { ok: true, event })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // PATCH /calendar/events/:id
  const patchMatch = pathname.match(/^\/calendar\/events\/([^/]+)$/)
  if (req.method === 'PATCH' && patchMatch) {
    try {
      const id = decodeURIComponent(patchMatch[1])
      const body = await readJsonBody(req)
      const event = await updateEvent({ id, patch: body, calendarId: body.calendarId })
      jsonResponse(res, 200, { ok: true, event })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // DELETE /calendar/events/:id
  if (req.method === 'DELETE' && patchMatch) {
    try {
      const id = decodeURIComponent(patchMatch[1])
      const calendarId = url.searchParams.get('calendarId')
      const r = await deleteEvent({ id, calendarId })
      jsonResponse(res, 200, { ok: r.ok, id: r.id })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
