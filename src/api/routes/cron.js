// src/api/routes/cron.js — 主动 agentic cron API 路由（ADR-011 · Phase 3）
//
//   GET    /cron/list      — 列出所有 cron（list）
//   GET    /cron/status    — orchestrator 状态（status）
//   GET    /cron/cron/:id  — 查单个 cron（get）
//   POST   /cron/run       — 立即跑（run）
//   POST   /cron/enable    — 启用（enable / enable_all）
//   POST   /cron/disable   — 禁用（disable / disable_all）
//
// 跟 src/api/routes/calendar.js + tasks.js 风格一致

import { jsonResponse, readJsonBody } from '../utils.js'
import {
  listCrons, getCron, enableCron, disableCron, enableAllCrons, disableAllCrons,
  runCron, getOrchestratorStatus,
} from '../../agentic/cron-orchestrator.js'

export async function handleCronRoutes(req, res, url) {
  const pathname = url.pathname

  // GET /cron/list
  if (req.method === 'GET' && pathname === '/cron/list') {
    try {
      const crons = listCrons()
      jsonResponse(res, 200, { ok: true, count: crons.length, crons })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /cron/status
  if (req.method === 'GET' && pathname === '/cron/status') {
    try {
      const status = getOrchestratorStatus()
      jsonResponse(res, 200, { ok: true, ...status })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /cron/cron/:id
  if (req.method === 'GET' && pathname.startsWith('/cron/cron/')) {
    try {
      const id = decodeURIComponent(pathname.slice('/cron/cron/'.length))
      const c = getCron(id)
      if (!c) {
        jsonResponse(res, 404, { ok: false, error: `cron "${id}" not found` })
        return true
      }
      jsonResponse(res, 200, { ok: true, cron: c })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /cron/run
  if (req.method === 'POST' && pathname === '/cron/run') {
    try {
      const body = await readJsonBody(req)
      if (!body.id) {
        jsonResponse(res, 400, { ok: false, error: '缺少 id' })
        return true
      }
      const r = await runCron(body.id, { triggeredBy: 'api', force: Boolean(body.force) })
      jsonResponse(res, r.ok ? 200 : 400, { ok: r.ok, ...r })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /cron/enable
  if (req.method === 'POST' && pathname === '/cron/enable') {
    try {
      const body = await readJsonBody(req)
      if (body.all === true || !body.id) {
        const r = enableAllCrons()
        jsonResponse(res, 200, { ok: true, ...r })
      } else {
        const r = enableCron(body.id)
        if (!r.ok) {
          jsonResponse(res, 404, { ok: false, error: r.error })
          return true
        }
        jsonResponse(res, 200, { ok: true, ...r })
      }
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /cron/disable
  if (req.method === 'POST' && pathname === '/cron/disable') {
    try {
      const body = await readJsonBody(req)
      if (body.all === true || !body.id) {
        const r = disableAllCrons()
        jsonResponse(res, 200, { ok: true, ...r })
      } else {
        const r = disableCron(body.id)
        if (!r.ok) {
          jsonResponse(res, 404, { ok: false, error: r.error })
          return true
        }
        jsonResponse(res, 200, { ok: true, ...r })
      }
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
