// src/api/routes/tasks.js — 任务 API 路由（ADR-010 · Phase 2）
//
//   GET  /tasks/status            — provider 配置 + 缓存
//   GET  /tasks/lists             — 列任务清单
//   GET  /tasks                   — 列任务（list）
//   POST /tasks                   — 创建任务（create）
//   PATCH /tasks/:id              — 更新任务（update）
//   POST /tasks/:id/complete      — 完成任务
//   DELETE /tasks/:id             — 删除任务

import { jsonResponse, readJsonBody } from '../utils.js'
import {
  listTasks, listTaskLists, createTask, updateTask, completeTask, deleteTask, getTasksStatus,
} from '../../connectors/tasks.js'
import { ingestTasks } from '../../connectors/memory-bridge.js'

export async function handleTasksRoutes(req, res, url) {
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === '/tasks/status') {
    try {
      const status = getTasksStatus()
      jsonResponse(res, 200, { ok: true, ...status })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /tasks/lists
  if (req.method === 'GET' && pathname === '/tasks/lists') {
    try {
      const provider = url.searchParams.get('provider')
      const lists = await listTaskLists({ provider })
      jsonResponse(res, 200, { ok: true, count: lists.length, lists })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /tasks?listId=...&includeCompleted=true
  if (req.method === 'GET' && pathname === '/tasks') {
    try {
      const params = Object.fromEntries(url.searchParams)
      const tasks = await listTasks({
        provider: params.provider,
        listId: params.listId,
        includeCompleted: params.includeCompleted === 'true' || params.includeCompleted === '1',
      })
      await ingestTasks(tasks)
      jsonResponse(res, 200, { ok: true, count: tasks.length, tasks })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /tasks
  if (req.method === 'POST' && pathname === '/tasks') {
    try {
      const body = await readJsonBody(req)
      if (!body.title) {
        jsonResponse(res, 400, { ok: false, error: '缺少 title' })
        return true
      }
      const task = await createTask({ ...body })
      await ingestTasks([task])
      jsonResponse(res, 200, { ok: true, task })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /tasks/:id/complete
  const completeMatch = pathname.match(/^\/tasks\/([^/]+)\/complete$/)
  if (req.method === 'POST' && completeMatch) {
    try {
      const id = decodeURIComponent(completeMatch[1])
      const body = await readJsonBody(req).catch(() => ({}))
      const task = await completeTask({
        provider: body.provider,
        id,
        completed: body.completed !== false,
      })
      jsonResponse(res, 200, { ok: true, task })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // PATCH /tasks/:id
  const patchMatch = pathname.match(/^\/tasks\/([^/]+)$/)
  if (req.method === 'PATCH' && patchMatch) {
    try {
      const id = decodeURIComponent(patchMatch[1])
      const body = await readJsonBody(req)
      const task = await updateTask({ ...body, id })
      jsonResponse(res, 200, { ok: true, task })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // DELETE /tasks/:id
  if (req.method === 'DELETE' && patchMatch) {
    try {
      const id = decodeURIComponent(patchMatch[1])
      const r = await deleteTask({ id })
      jsonResponse(res, 200, { ok: r.ok, id })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
