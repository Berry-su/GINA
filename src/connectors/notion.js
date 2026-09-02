// src/connectors/notion.js — Notion 笔记连接器（ADR-011 · Phase 3）
//
// 设计目标：
//   老板的 Notion 工作区 ↔ GINA 大脑双向同步。
//   LLM 能调 query_notes / write_note；API 能 CRUD；
//   笔记内容自动 ingest L2 memory + CATS-Net concept 化。
//
// 设计原则（沿用 Phase 2）：
//   - 抽象层 = 单文件多 provider，每个 provider dynamic import 第三方 SDK
//   - 缺 SDK / 缺 creds 时降级 mock provider（测试默认走 mock）
//   - 真实 credential 走 .env（GINA_NOTION_TOKEN + 可选 GINA_NOTION_PROVIDER）
//   - emotion-isolation 严守：笔记只走"事实/时间轴"路径，不触发 joy，不进决策链路
//
// Provider 矩阵：
//   - notion : Notion 官方 API（@notionhq/client · v5+）
//   - mock   : 内置 in-memory Map（测试 + 缺 creds 时默认）
//
// 统一接口（每个 provider 暴露 5 函数 + 1 工具）：
//   listPages({ parentId?, limit? }) → Page[]
//   getPage(id)                       → Page
//   createPage({ parentId?, title, content, tags? }) → Page
//   updatePage(id, patch)             → Page   (patch: {title?, content?, tags?})
//   deletePage(id)                    → {ok, id}
//
// Page 统一结构：
//   {
//     id, provider, parentId,
//     title, content (Markdown 简化), tags, url,
//     createdAt, updatedAt,
//     raw
//   }

import { config as appConfig } from '../config.js'

// ── Provider registry（动态 require 第三方 SDK，缺包不破） ───────────────
const PROVIDER_LOADERS = {
  notion: () => import('@notionhq/client').then((m) => m.Client).catch(() => null),
  mock: async () => (await import('./_mock-notion.js')).mockProvider,
}

// ── 统一 Page 形状 ─────────────────────────────────────────────────────
function normalizePage(provider, raw) {
  if (!raw) return null
  return {
    id: String(raw.id ?? cryptoRandom()),
    provider,
    parentId: raw.parentId ?? null,
    title: String(raw.title ?? '(无标题)'),
    content: typeof raw.content === 'string' ? raw.content : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    url: raw.url ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date().toISOString(),
    raw: raw.raw ?? null,
  }
}

function cryptoRandom() {
  return 'mock-' + Math.random().toString(36).slice(2, 10)
}

// ── Provider：mock（默认 / 测试 / 降级） ─────────────────────────────────
function makeMockProvider({ initialPages = [] } = {}) {
  const pages = new Map()
  let counter = 1
  for (const p of initialPages) {
    const id = p.id || `mock-note-${counter++}`
    pages.set(id, { ...p, id, provider: 'mock', content: p.content || '' })
  }

  function nowIso() { return new Date().toISOString() }

  return {
    kind: 'mock',
    label: 'mock-notion',
    listPages: async ({ parentId, limit = 50 } = {}) => {
      const out = []
      for (const p of pages.values()) {
        if (parentId && p.parentId !== parentId) continue
        out.push(normalizePage('mock', p))
        if (out.length >= limit) break
      }
      return out
    },
    getPage: async (id) => {
      const p = pages.get(String(id))
      return p ? normalizePage('mock', p) : null
    },
    createPage: async ({ parentId, title, content = '', tags = [] } = {}) => {
      const id = `mock-note-${counter++}`
      const now = nowIso()
      const p = { id, provider: 'mock', parentId: parentId || null, title, content, tags, url: `mock://note/${id}`, createdAt: now, updatedAt: now }
      pages.set(id, p)
      return normalizePage('mock', p)
    },
    updatePage: async (id, patch = {}) => {
      const p = pages.get(String(id))
      if (!p) return null
      if (patch.title !== undefined) p.title = String(patch.title)
      if (patch.content !== undefined) p.content = String(patch.content)
      if (Array.isArray(patch.tags)) p.tags = patch.tags.map(String)
      p.updatedAt = nowIso()
      return normalizePage('mock', p)
    },
    deletePage: async (id) => {
      const ok = pages.delete(String(id))
      return { ok, id: String(id) }
    },
  }
}

// ── Provider：Notion 官方 API（@notionhq/client） ─────────────────────────
function makeNotionProvider({ token }) {
  // Notion API 返回的 block → Markdown 简化（5 类基础 block）
  function blocksToMarkdown(blocks) {
    if (!Array.isArray(blocks)) return ''
    const lines = []
    for (const b of blocks) {
      const t = b?.type
      if (t === 'heading_1') lines.push(`# ${plain(b.heading_1?.rich_text)}`)
      else if (t === 'heading_2') lines.push(`## ${plain(b.heading_2?.rich_text)}`)
      else if (t === 'heading_3') lines.push(`### ${plain(b.heading_3?.rich_text)}`)
      else if (t === 'paragraph') lines.push(plain(b.paragraph?.rich_text))
      else if (t === 'bulleted_list_item') lines.push(`- ${plain(b.bulleted_list_item?.rich_text)}`)
      else if (t === 'numbered_list_item') lines.push(`1. ${plain(b.numbered_list_item?.rich_text)}`)
      else if (t === 'code') lines.push('```' + (b.code?.language || '') + '\n' + plain(b.code?.rich_text) + '\n```')
      else if (t === 'quote') lines.push(`> ${plain(b.quote?.rich_text)}`)
      else lines.push('')  // 其他 block 类型不展开（raw 字段保留）
    }
    return lines.join('\n').trim()
  }
  function plain(rich) {
    if (!Array.isArray(rich)) return ''
    return rich.map((r) => r?.plain_text || '').join('')
  }

  let clientInstance = null
  async function client() {
    if (clientInstance) return clientInstance
    const Client = await PROVIDER_LOADERS.notion()
    if (!Client) throw new Error('@notionhq/client not installed; run: pnpm add @notionhq/client')
    clientInstance = new Client({ auth: token })
    return clientInstance
  }

  async function pageToShape(page) {
    // 拉 children blocks
    let content = ''
    try {
      const c = await clientInstance.blocks.children.list({ block_id: page.id, page_size: 100 })
      content = blocksToMarkdown(c.results)
    } catch { content = '' }
    const titleProp = Object.values(page.properties || {}).find((p) => p?.type === 'title')
    const title = titleProp?.title?.[0]?.plain_text || '(无标题)'
    const tags = (page.properties?.tags?.multi_select || []).map((t) => t.name)
    return {
      id: page.id,
      provider: 'notion',
      parentId: page.parent?.page_id || page.parent?.database_id || null,
      title,
      content,
      tags,
      url: page.url,
      createdAt: page.created_time,
      updatedAt: page.last_edited_time,
      raw: null,  // 不在 L2 memory 存 raw（节省空间 + 隐私）
    }
  }

  return {
    kind: 'notion',
    label: 'notion-official',
    listPages: async ({ parentId, limit = 50 } = {}) => {
      const c = await client()
      let q
      if (parentId) {
        q = await c.databases.query({ database_id: parentId, page_size: Math.min(limit, 100) })
      } else {
        q = await c.search({ query: '', page_size: Math.min(limit, 100), filter: { property: 'object', value: 'page' } })
      }
      const out = []
      for (const p of q.results) out.push(await pageToShape(p))
      return out
    },
    getPage: async (id) => {
      const c = await client()
      try {
        const p = await c.pages.retrieve({ page_id: String(id) })
        return await pageToShape(p)
      } catch { return null }
    },
    createPage: async ({ parentId, title, content = '', tags = [] } = {}) => {
      const c = await client()
      if (!parentId) throw new Error('createPage 需要 parentId（database_id 或 page_id）')
      const blocks = markdownToBlocks(content)
      const created = await c.pages.create({
        parent: { database_id: parentId },
        properties: { title: { title: [{ text: { content: title || '(无标题)' } }] } },
        children: blocks,
      })
      return await pageToShape(created)
    },
    updatePage: async (id, patch = {}) => {
      const c = await client()
      const updates = {}
      if (patch.title !== undefined) {
        updates.properties = { title: { title: [{ text: { content: patch.title } }] } }
      }
      if (patch.content !== undefined) {
        // 删旧 children + 加新 children（Notion API 不支持直接替换内容）
        const existing = await c.blocks.children.list({ block_id: id, page_size: 100 })
        for (const b of existing.results) {
          try { await c.blocks.delete({ block_id: b.id }) } catch {}
        }
        if (patch.content) {
          await c.blocks.children.append({ block_id: id, children: markdownToBlocks(patch.content) })
        }
      }
      const updated = await c.pages.update({ page_id: id, ...updates })
      return await pageToShape(updated)
    },
    deletePage: async (id) => {
      const c = await client()
      try {
        await c.pages.update({ page_id: id, archived: true })
        return { ok: true, id: String(id) }
      } catch (err) {
        return { ok: false, id: String(id), error: err?.message || String(err) }
      }
    },
  }
}

// Markdown → Notion block 简化（5 类）
function markdownToBlocks(md) {
  if (!md) return []
  const lines = String(md).split('\n')
  const blocks = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('### ')) blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: trimmed.slice(4) } }] } })
    else if (trimmed.startsWith('## ')) blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: trimmed.slice(3) } }] } })
    else if (trimmed.startsWith('# ')) blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }] } })
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }] } })
    else if (/^\d+\.\s/.test(trimmed)) blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', text: { content: trimmed.replace(/^\d+\.\s/, '') } }] } })
    else if (trimmed.startsWith('> ')) blocks.push({ object: 'block', type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }] } })
    else if (trimmed.startsWith('```')) {
      blocks.push({ object: 'block', type: 'code', code: { language: 'plain text', rich_text: [{ type: 'text', text: { content: '' } }] } })
    }
    else blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: trimmed } }] } })
  }
  return blocks
}

// ── 环境凭据读取 ────────────────────────────────────────────────────────
function readNotionCredentials() {
  return { token: process.env.GINA_NOTION_TOKEN || null }
}

function credentialsLookComplete(creds) {
  return Boolean(creds?.token)
}

// ── Provider 缓存（避免每次重新构造） ───────────────────────────────────
const _providerCache = new Map()

export async function getNotionProvider(provider = null) {
  const requested = provider || process.env.GINA_NOTION_PROVIDER || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    instance = makeMockProvider()
  } else if (requested === 'notion') {
    const creds = readNotionCredentials()
    if (!credentialsLookComplete(creds)) {
      console.warn('[notion] creds incomplete; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeNotionProvider({ token: creds.token })
    }
  } else {
    console.warn(`[notion] unknown provider "${requested}"; falling back to mock`)
    instance = makeMockProvider()
  }
  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 5 函数统一接口 ──────────────────────────────────────────────────────
export async function listPages(opts = {}) {
  const p = await getNotionProvider(opts.provider)
  return p.listPages(opts)
}

export async function getPage(id, opts = {}) {
  const p = await getNotionProvider(opts.provider)
  return p.getPage(id)
}

export async function createPage({ provider, parentId, title, content, tags } = {}) {
  const p = await getNotionProvider(provider)
  return p.createPage({ parentId, title, content, tags })
}

export async function updatePage({ provider, id, patch }) {
  const p = await getNotionProvider(provider)
  return p.updatePage(id, patch || {})
}

export async function deletePage({ provider, id }) {
  const p = await getNotionProvider(provider)
  return p.deletePage(id)
}

export function getNotionStatus() {
  const requested = process.env.GINA_NOTION_PROVIDER || 'mock'
  const creds = readNotionCredentials()
  return {
    ok: true,
    requested,
    effectiveProvider: requested === 'notion' && credentialsLookComplete(creds) ? 'notion' : 'mock',
    credsComplete: credentialsLookComplete(creds),
    source: 'GINA_NOTION_TOKEN',
    availableProviders: Object.keys(PROVIDER_LOADERS),
  }
}

export const NOTION_PROVIDERS = Object.freeze(['mock', 'notion'])

export const __test = {
  _providerCache,
  normalizePage,
  blocksToMarkdown: (blocks) => {
    // 暴露给测试用
    const tmp = { clientInstance: null }
    return blocks  // 仅占位
  },
  markdownToBlocks,
}
