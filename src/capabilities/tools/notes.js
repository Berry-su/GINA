// src/capabilities/tools/notes.js — 第三方笔记工具执行器（ADR-011 · Phase 3）
//
// LLM 调 query_notes / write_note 时走这里。
// 逻辑：
//   1. 解析 args.action + args.provider
//   2. 调对应 connector 模块（notion / obsidian / roam）
//   3. 写操作 / 读 list 自动 ingest L2 memory（memory-bridge）
//   4. 返回结构化 string 给 LLM
//
// emotion-isolation 严守（沿用 Phase 2）：
//   - tool 输出不含 emotion 词
//   - ingest 是后台事务，**不触发 joy 也不进决策**
//   - 默认走 mock provider，不连真实账号

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

function toolJson(obj) { return JSON.stringify(obj, null, 2) }

function pickConnector(provider) {
  if (provider === 'notion') return {
    list: listNotionPages, get: getNotionPage, create: createNotionPage, update: updateNotionPage, delete: deleteNotionPage, status: getNotionStatus, name: 'notion',
  }
  if (provider === 'obsidian') return {
    list: listObsidianPages, get: getObsidianPage, create: createObsidianPage, update: updateObsidianPage, delete: deleteObsidianPage, status: getObsidianStatus, name: 'obsidian',
  }
  if (provider === 'roam') return {
    list: listRoamPages, get: getRoamPage, create: createRoamPage, update: updateRoamPage, delete: deleteRoamPage, status: getRoamStatus, name: 'roam',
  }
  // 默认 mock：根据哪个 connector 是 mock 模式（避免歧义，优先 notion mock）
  return {
    list: listNotionPages, get: getNotionPage, create: createNotionPage, update: updateNotionPage, delete: deleteNotionPage, status: getNotionStatus, name: 'notion-mock-default',
  }
}

async function getAllStatuses() {
  return {
    notion: getNotionStatus(),
    obsidian: getObsidianStatus(),
    roam: getRoamStatus(),
  }
}

// ── query_notes 执行器 ─────────────────────────────────────────────────
export async function execQueryNotes(args = {}, context = {}) {
  const action = args.action
  if (!action) return '错误：未提供 action（list/get/delete/status）'

  if (action === 'status') {
    const statuses = await getAllStatuses()
    return toolJson({ ok: true, action, providers: statuses })
  }

  const conn = pickConnector(args.provider)
  const opts = { provider: args.provider, parentId: args.parentId, limit: Number(args.limit) || 50 }

  if (action === 'list') {
    const pages = await conn.list(opts)
    // 简单 title 过滤（partial match）
    const filtered = args.title
      ? pages.filter((p) => (p.title || '').toLowerCase().includes(String(args.title).toLowerCase()))
      : pages
    // 自动 ingest L2 memory
    const ingest = await ingestNotes(filtered)
    return toolJson({ ok: true, action, provider: args.provider || 'mock', count: filtered.length, pages: filtered, memoryIngest: ingest })
  }

  if (action === 'get') {
    if (!args.id) return '错误：get 需要 id'
    const page = await conn.get(args.id, { provider: args.provider })
    if (!page) return `错误：未找到 page "${args.id}"`
    return toolJson({ ok: true, action, provider: args.provider || 'mock', page })
  }

  if (action === 'delete') {
    if (!args.id) return '错误：delete 需要 id'
    const r = await conn.delete({ provider: args.provider, id: args.id })
    return toolJson({ ok: r.ok, action, provider: args.provider || 'mock', id: args.id, error: r.error })
  }

  return `错误：未知 action "${action}"`
}

// ── write_note 执行器 ──────────────────────────────────────────────────
export async function execWriteNote(args = {}, context = {}) {
  const action = args.action
  if (!action) return '错误：未提供 action（create/update）'

  const conn = pickConnector(args.provider)

  if (action === 'create') {
    if (!args.title) return '错误：create 需要 title'
    const page = await conn.create({
      provider: args.provider,
      parentId: args.parentId,
      title: args.title,
      content: args.content || '',
      tags: Array.isArray(args.tags) ? args.tags : [],
    })
    // 自动 ingest
    const ingest = await ingestNotes([page])
    return toolJson({ ok: true, action, provider: args.provider || 'mock', page, memoryIngest: ingest })
  }

  if (action === 'update') {
    if (!args.id) return '错误：update 需要 id'
    const patch = {}
    if (args.title !== undefined) patch.title = args.title
    if (args.content !== undefined) patch.content = args.content
    if (Array.isArray(args.tags)) patch.tags = args.tags
    const page = await conn.update({ provider: args.provider, id: args.id, patch })
    if (!page) return `错误：未找到 page "${args.id}"`
    return toolJson({ ok: true, action, provider: args.provider || 'mock', page })
  }

  return `错误：未知 action "${action}"`
}
