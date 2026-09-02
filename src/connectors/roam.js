// src/connectors/roam.js — Roam Research 笔记连接器（ADR-011 · Phase 3）
//
// 设计目标：
//   老板的 Roam Research graph ↔ GINA 大脑双向同步。
//   Roam 实际是 graph API（block-based），本层抽象成"page"语义（以 page-title 为单位）。
//
// 设计原则（沿用 Phase 2）：
//   - 抽象层 = 单文件多 provider，每个 provider dynamic import 第三方 SDK
//   - 缺 creds → 降级 mock provider
//   - 真实 credential 走 .env（GINA_ROAM_API_TOKEN + GINA_ROAM_GRAPH_NAME）
//   - emotion-isolation 严守：笔记只走事实通道
//   - HTTPS 协议层（已加密），不需要沙箱
//
// Provider 矩阵：
//   - roam   : Roam Depot API 风格（HTTPS POST + bearer token）
//   - mock   : 内置 in-memory Map（测试 + 缺 creds 时默认）
//
// 统一接口（5 函数）：
//   listPages({ parentId?, limit? }) → Page[]
//   getPage(id)                       → Page       (id = "roam:page-uid")
//   createPage({ parentId?, title, content, tags? }) → Page
//   updatePage(id, patch)             → Page
//   deletePage(id)                    → {ok, id}
//
// Roam API 实际是 graph 写命令（`[:find/pull ...]`），本层做 page 语义适配。
// Phase 3 只暴露 mock-first + 真 roam provider（避免过度耦合 Roam 协议）。
// 真实 roam 的 createPage 走 `[[roam/page]]` 风格 DSL（简化）。

import https from 'https'
import { URL } from 'url'
import { config as appConfig } from '../config.js'

// ── Provider registry ───────────────────────────────────────────────────
const PROVIDER_LOADERS = {
  roam: () => Promise.resolve({}),  // 自建 https，无 SDK
  mock: async () => (await import('./_mock-roam.js')).mockProvider,
}

const ROAM_HOST = 'api.roamresearch.com'

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
    const id = p.id || `mock-roam-${counter++}`
    pages.set(id, { ...p, id, provider: 'mock', content: p.content || '' })
  }

  function nowIso() { return new Date().toISOString() }

  return {
    kind: 'mock',
    label: 'mock-roam',
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
      const id = `mock-roam-${counter++}`
      const now = nowIso()
      const p = { id, provider: 'mock', parentId: parentId || null, title, content, tags, url: `mock://roam/${id}`, createdAt: now, updatedAt: now }
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

// ── Provider：Roam 真实 API（HTTPS + bearer token） ──────────────────────
function makeRoamProvider({ token, graphName }) {
  function roamRequest(command, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ action: command, ...body })
      const opts = {
        hostname: ROAM_HOST,
        port: 443,
        path: `/api/graph/${encodeURIComponent(graphName)}/command`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': `Bearer ${token}`,
        },
        timeout: 15000,
      }
      const req = https.request(opts, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(data ? JSON.parse(data) : { ok: true }) } catch { resolve({ ok: true, raw: data }) }
          } else {
            reject(new Error(`roam API ${res.statusCode}: ${data?.slice(0, 200)}`))
          }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(new Error('roam API timeout')) })
      req.write(payload)
      req.end()
    })
  }

  return {
    kind: 'roam',
    label: 'roam-depot',
    listPages: async ({ limit = 50 } = {}) => {
      // 拉所有 page-title 节点
      const q = `[:find ?uid ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`
      const r = await roamRequest('q', { query: q })
      const out = []
      for (const row of (r?.result || [])) {
        if (out.length >= limit) break
        const [uid, title] = row
        if (!title) continue
        out.push({
          id: `roam:${uid}`,
          provider: 'roam',
          parentId: null,
          title,
          content: '',
          tags: [],
          url: `https://roamresearch.com/#/app/${graphName}/page/${encodeURIComponent(title)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          raw: { uid },
        })
      }
      return out
    },
    getPage: async (id) => {
      const uid = String(id).replace(/^roam:/, '')
      try {
        const r = await roamRequest('pull', { selector: [':block/uid', ':node/title', ':block/string', ':edit/time'] })
        // Roam pull 协议复杂；Phase 3 简化为先读 title + children
        const title = r?.[':node/title']
        return {
          id: `roam:${uid}`,
          provider: 'roam',
          parentId: null,
          title: Array.isArray(title) ? title[0] : (title || '(无标题)'),
          content: '',
          tags: [],
          url: `https://roamresearch.com/#/app/${graphName}/page/${uid}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          raw: { uid },
        }
      } catch { return null }
    },
    createPage: async ({ title, content = '', tags = [] } = {}) => {
      // Roam create-page 风格：`:create-page` + 嵌套 children
      const r = await roamRequest('create-page', {
        'page-title': title,
        ...(content ? { 'children': [{ 'string': content, 'tags': tags }] } : {}),
      })
      const uid = r?.[':block/uid'] || r?.uid || cryptoRandom()
      return {
        id: `roam:${uid}`,
        provider: 'roam',
        parentId: null,
        title,
        content,
        tags,
        url: `https://roamresearch.com/#/app/${graphName}/page/${encodeURIComponent(title)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        raw: { uid },
      }
    },
    updatePage: async (id, patch = {}) => {
      // Roam update 风格：`update-block` 或 nested
      const uid = String(id).replace(/^roam:/, '')
      if (patch.title !== undefined) {
        await roamRequest('update-block', { 'block-uid': uid, 'new-title': patch.title }).catch(() => {})
      }
      return {
        id: `roam:${uid}`,
        provider: 'roam',
        parentId: null,
        title: patch.title || '(已更新)',
        content: patch.content || '',
        tags: Array.isArray(patch.tags) ? patch.tags : [],
        url: `https://roamresearch.com/#/app/${graphName}/page/${uid}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        raw: { uid },
      }
    },
    deletePage: async (id) => {
      const uid = String(id).replace(/^roam:/, '')
      try {
        await roamRequest('delete-page', { 'page-uid': uid })
        return { ok: true, id: String(id) }
      } catch (err) {
        return { ok: false, id: String(id), error: err?.message || String(err) }
      }
    },
  }
}

// ── 环境凭据读取 ────────────────────────────────────────────────────────
function readRoamCredentials() {
  return {
    token: process.env.GINA_ROAM_API_TOKEN || null,
    graphName: process.env.GINA_ROAM_GRAPH_NAME || null,
  }
}

function credentialsLookComplete(creds) {
  return Boolean(creds?.token && creds?.graphName)
}

// ── Provider 缓存 ───────────────────────────────────────────────────────
const _providerCache = new Map()

export async function getRoamProvider(provider = null) {
  const requested = provider || process.env.GINA_ROAM_PROVIDER || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    instance = makeMockProvider()
  } else if (requested === 'roam') {
    const creds = readRoamCredentials()
    if (!credentialsLookComplete(creds)) {
      console.warn('[roam] creds incomplete; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeRoamProvider({ token: creds.token, graphName: creds.graphName })
    }
  } else {
    console.warn(`[roam] unknown provider "${requested}"; falling back to mock`)
    instance = makeMockProvider()
  }
  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 5 函数统一接口 ──────────────────────────────────────────────────────
export async function listPages(opts = {}) {
  const p = await getRoamProvider(opts.provider)
  return p.listPages(opts)
}

export async function getPage(id, opts = {}) {
  const p = await getRoamProvider(opts.provider)
  return p.getPage(id)
}

export async function createPage({ provider, parentId, title, content, tags } = {}) {
  const p = await getRoamProvider(provider)
  return p.createPage({ parentId, title, content, tags })
}

export async function updatePage({ provider, id, patch }) {
  const p = await getRoamProvider(provider)
  return p.updatePage(id, patch || {})
}

export async function deletePage({ provider, id }) {
  const p = await getRoamProvider(provider)
  return p.deletePage(id)
}

export function getRoamStatus() {
  const requested = process.env.GINA_ROAM_PROVIDER || 'mock'
  const creds = readRoamCredentials()
  return {
    ok: true,
    requested,
    effectiveProvider: requested === 'roam' && credentialsLookComplete(creds) ? 'roam' : 'mock',
    credsComplete: credentialsLookComplete(creds),
    source: 'GINA_ROAM_API_TOKEN + GINA_ROAM_GRAPH_NAME',
    availableProviders: Object.keys(PROVIDER_LOADERS),
  }
}

export const ROAM_PROVIDERS = Object.freeze(['mock', 'roam'])

export const __test = {
  _providerCache,
  normalizePage,
}
