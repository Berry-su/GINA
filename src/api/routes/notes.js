// src/api/routes/notes.js — 第三方笔记 API 路由（ADR-011 · Phase 3）
//
//   GET    /notes/status         — 3 provider 状态
//   GET    /notes/list           — 列出 page（list）
//   GET    /notes/page           — 查 page（get, ?id=...）
//   POST   /notes/page           — 创建 page（create）
//   PATCH  /notes/page           — 更新 page（update, ?id=...）
//   DELETE /notes/page           — 删除 page（delete, ?id=...）
//
// 跟 src/api/routes/calendar.js 风格一致

import { jsonResponse, readJsonBody } from '../utils.js'
import {
  listPages as listNotionPages, getPage as getNotionPage,
  createPage as createNotionPage, updatePage as updateNotionPage, deletePage as deleteNotionPage,
  getNotionStatus,
} from '../../connectors/notion.js'
import {
  listPages as listObsidianPages, getPage as getObsidianPage,
  createPage as createObsidianPage, updatePage as updateObsidianPage, deletePage as deleteObsidianPage,
  getObsidianStatus,
} from '../../connectors/obsidian.js'
import {
  listPages as listRoamPages, getPage as getRoamPage,
  createPage as createRoamPage, updatePage as updateRoamPage, deletePage as deleteRoamPage,
  getRoamStatus,
} from '../../connectors/roam.js'
import { ingestNotes } from '../../connectors/memory-bridge.js'

function pickConnector(provider) {
  if (provider === 'notion') return {
    list: listNotionPages, get: getNotionPage, create: createNotionPage, update: updateNotionPage, delete: deleteNotionPage, name: 'notion',
  }
  if (provider === 'obsidian') return {
    list: listObsidianPages, get: getObsidianPage, create: createObsidianPage, update: updateObsidianPage, delete: deleteObsidianPage, name: 'obsidian',
  }
  if (provider === 'roam') return {
    list: listRoamPages, get: getRoamPage, create: createRoamPage, update: updateRoamPage, delete: deleteRoamPage, name: 'roam',
  }
  return null
}

export async function handleNotesRoutes(req, res, url) {
  const pathname = url.pathname

  // GET /notes/status
  if (req.method === 'GET' && pathname === '/notes/status') {
    try {
      jsonResponse(res, 200, {
        ok: true,
        providers: {
          notion: getNotionStatus(),
          obsidian: getObsidianStatus(),
          roam: getRoamStatus(),
        },
      })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /notes/list
  if (req.method === 'GET' && pathname === '/notes/list') {
    try {
      const provider = url.searchParams.get('provider')
      const conn = pickConnector(provider)
      if (!conn) {
        jsonResponse(res, 400, { ok: false, error: `unknown provider "${provider}"` })
        return true
      }
      const pages = await conn.list({
        provider,
        parentId: url.searchParams.get('parentId') || undefined,
        limit: Number(url.searchParams.get('limit')) || 50,
      })
      // 自动 ingest L2 memory
      const ingest = await ingestNotes(pages)
      jsonResponse(res, 200, { ok: true, provider: provider || 'mock', count: pages.length, pages, memoryIngest: ingest })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /notes/page?id=...
  if (req.method === 'GET' && pathname === '/notes/page') {
    try {
      const id = url.searchParams.get('id')
      if (!id) {
        jsonResponse(res, 400, { ok: false, error: '缺少 id' })
        return true
      }
      const provider = url.searchParams.get('provider')
      const conn = pickConnector(provider)
      if (!conn) {
        jsonResponse(res, 400, { ok: false, error: `unknown provider "${provider}"` })
        return true
      }
      const page = await conn.get(id, { provider })
      if (!page) {
        jsonResponse(res, 404, { ok: false, error: `page "${id}" not found` })
        return true
      }
      jsonResponse(res, 200, { ok: true, provider: provider || 'mock', page })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /notes/page (create)
  if (req.method === 'POST' && pathname === '/notes/page') {
    try {
      const body = await readJsonBody(req)
      const provider = body.provider
      const conn = pickConnector(provider)
      if (!conn) {
        jsonResponse(res, 400, { ok: false, error: `unknown provider "${provider}"` })
        return true
      }
      if (!body.title) {
        jsonResponse(res, 400, { ok: false, error: '缺少 title' })
        return true
      }
      const page = await conn.create({
        provider,
        parentId: body.parentId,
        title: body.title,
        content: body.content || '',
        tags: Array.isArray(body.tags) ? body.tags : [],
      })
      const ingest = await ingestNotes([page])
      jsonResponse(res, 200, { ok: true, provider: provider || 'mock', page, memoryIngest: ingest })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // PATCH /notes/page?id=... (update)
  if (req.method === 'PATCH' && pathname === '/notes/page') {
    try {
      const id = url.searchParams.get('id')
      if (!id) {
        jsonResponse(res, 400, { ok: false, error: '缺少 id' })
        return true
      }
      const body = await readJsonBody(req)
      const provider = body.provider || url.searchParams.get('provider')
      const conn = pickConnector(provider)
      if (!conn) {
        jsonResponse(res, 400, { ok: false, error: `unknown provider "${provider}"` })
        return true
      }
      const patch = {}
      if (body.title !== undefined) patch.title = body.title
      if (body.content !== undefined) patch.content = body.content
      if (Array.isArray(body.tags)) patch.tags = body.tags
      const page = await conn.update({ provider, id, patch })
      if (!page) {
        jsonResponse(res, 404, { ok: false, error: `page "${id}" not found` })
        return true
      }
      jsonResponse(res, 200, { ok: true, provider: provider || 'mock', page })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // DELETE /notes/page?id=...
  if (req.method === 'DELETE' && pathname === '/notes/page') {
    try {
      const id = url.searchParams.get('id')
      if (!id) {
        jsonResponse(res, 400, { ok: false, error: '缺少 id' })
        return true
      }
      const provider = url.searchParams.get('provider')
      const conn = pickConnector(provider)
      if (!conn) {
        jsonResponse(res, 400, { ok: false, error: `unknown provider "${provider}"` })
        return true
      }
      const r = await conn.delete({ provider, id })
      jsonResponse(res, r.ok ? 200 : 400, { ok: r.ok, provider: provider || 'mock', id, error: r.error })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
