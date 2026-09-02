// src/connectors/obsidian.js — Obsidian 笔记连接器（ADR-011 · Phase 3）
//
// 设计目标：
//   老板的 Obsidian vault ↔ GINA 大脑双向同步。
//   本地 Markdown 目录；chokidar 监听变化；写入限制在 vaultPath 内不越界。
//
// 设计原则（沿用 Phase 2）：
//   - 抽象层 = 单文件多 provider，每个 provider dynamic import 第三方 SDK
//   - 缺 SDK / 缺 creds / 缺 vaultPath → 降级 mock provider
//   - 真实 credential 走 .env（GINA_OBSIDIAN_VAULT_PATH）
//   - emotion-isolation 严守：笔记只走事实通道
//   - **路径安全**（Phase 3 特有）：所有真实路径必须 path.resolve(vaultPath, x) 起头于 vaultPath
//
// Provider 矩阵：
//   - obsidian : 本地 vault 目录（chokidar 监听 + fs 读写）
//   - mock     : 内置 in-memory Map（测试 + 缺 vaultPath 时默认）
//
// 统一接口（5 函数 + watch）：
//   listPages({ parentId?, limit? }) → Page[]        // parentId = 子目录（相对 vault）
//   getPage(id)                       → Page          // id 可以是 "note:relative/path.md" 或纯 path
//   createPage({ parentId?, title, content, tags? }) → Page
//   updatePage(id, patch)             → Page
//   deletePage(id)                    → {ok, id}
//   watch(callback)                    → unwatch()     // chokidar 监听 vault 变化
//
// Page 统一结构（id 格式 "obsidian:relative/path.md"）：
//   {
//     id: 'obsidian:projects/gina.md',
//     provider: 'obsidian',
//     parentId: 'projects',         // 相对路径的父目录
//     title: 'gina',
//     content (Markdown 原文),
//     tags (从 YAML frontmatter 解析),
//     url: 'file:///...',
//     createdAt, updatedAt,
//     raw: { stats }
//   }

import path from 'path'
import fs from 'fs/promises'
import { config as appConfig } from '../config.js'

// ── Provider registry ───────────────────────────────────────────────────
const PROVIDER_LOADERS = {
  obsidian: () => import('chokidar').then((m) => m.watch).catch(() => null),
  mock: async () => (await import('./_mock-obsidian.js')).mockProvider,
}

// ── 路径安全 helper ──────────────────────────────────────────────────────
function resolveSafePath(vaultPath, relPath) {
  const resolved = path.resolve(vaultPath, relPath)
  const vault = path.resolve(vaultPath)
  if (!resolved.startsWith(vault + path.sep) && resolved !== vault) {
    throw new Error(`path escapes vault: ${relPath}`)
  }
  return resolved
}

// ── 统一 Page 形状 ─────────────────────────────────────────────────────
function normalizePage(provider, vaultPath, relPath, filePath, stat, content) {
  const title = path.basename(relPath, path.extname(relPath))
  // 简单 frontmatter tag 解析（仅支持 `tags: [a, b]` 或 `tags:\n  - a\n  - b`）
  const tags = parseFrontmatterTags(content)
  return {
    id: `${provider}:${relPath}`,
    provider,
    parentId: path.dirname(relPath) === '.' ? null : path.dirname(relPath),
    title,
    content: content || '',
    tags,
    url: `file://${filePath}`,
    createdAt: stat?.birthtime?.toISOString?.() || new Date().toISOString(),
    updatedAt: stat?.mtime?.toISOString?.() || new Date().toISOString(),
    raw: { size: stat?.size ?? (content?.length || 0) },
  }
}

function parseFrontmatterTags(content) {
  if (!content || !content.startsWith('---')) return []
  const end = content.indexOf('---', 3)
  if (end < 0) return []
  const front = content.slice(3, end)
  const inline = front.match(/^tags:\s*\[([^\]]+)\]/m)
  if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  const block = []
  let inTags = false
  for (const line of front.split('\n')) {
    if (/^tags:\s*$/.test(line)) { inTags = true; continue }
    if (inTags && /^\s+-\s+/.test(line)) block.push(line.replace(/^\s+-\s+/, '').trim())
    else if (inTags && line.trim() && !/^\s+-\s+/.test(line)) inTags = false
  }
  return block
}

function buildFrontmatter(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return ''
  return `---\ntags: [${tags.join(', ')}]\n---\n\n`
}

// ── Provider：mock（默认 / 测试 / 降级） ─────────────────────────────────
function makeMockProvider({ initialPages = [] } = {}) {
  const pages = new Map()
  let counter = 1
  for (const p of initialPages) {
    const id = p.id || `obsidian:mock-${counter++}.md`
    pages.set(id, {
      ...p, id, provider: 'mock', content: p.content || '',
      tags: Array.isArray(p.tags) ? p.tags : [],
    })
  }

  function nowIso() { return new Date().toISOString() }

  return {
    kind: 'mock',
    label: 'mock-obsidian',
    listPages: async ({ parentId, limit = 50 } = {}) => {
      const out = []
      for (const p of pages.values()) {
        if (parentId && p.parentId !== parentId) continue
        out.push({
          id: p.id, provider: 'mock',
          parentId: p.parentId, title: p.title, content: p.content,
          tags: p.tags, url: `mock://${p.id}`,
          createdAt: p.createdAt || nowIso(), updatedAt: p.updatedAt || nowIso(),
          raw: { size: (p.content || '').length },
        })
        if (out.length >= limit) break
      }
      return out
    },
    getPage: async (id) => {
      const p = pages.get(String(id))
      return p ? {
        id: p.id, provider: 'mock',
        parentId: p.parentId, title: p.title, content: p.content,
        tags: p.tags, url: `mock://${p.id}`,
        createdAt: p.createdAt || nowIso(), updatedAt: p.updatedAt || nowIso(),
        raw: { size: (p.content || '').length },
      } : null
    },
    createPage: async ({ parentId, title, content = '', tags = [] } = {}) => {
      const rel = `${parentId ? parentId + '/' : ''}${title || 'untitled'}.md`
      const id = `obsidian:${rel}`
      const now = nowIso()
      const p = { id, provider: 'mock', parentId: parentId || null, title: title || 'untitled', content, tags, url: `mock://${id}`, createdAt: now, updatedAt: now }
      pages.set(id, p)
      return p
    },
    updatePage: async (id, patch = {}) => {
      const p = pages.get(String(id))
      if (!p) return null
      if (patch.title !== undefined) p.title = String(patch.title)
      if (patch.content !== undefined) p.content = String(patch.content)
      if (Array.isArray(patch.tags)) p.tags = patch.tags.map(String)
      p.updatedAt = nowIso()
      return p
    },
    deletePage: async (id) => {
      const ok = pages.delete(String(id))
      return { ok, id: String(id) }
    },
    watch: (_cb) => () => {},  // mock no-op
  }
}

// ── Provider：obsidian vault（真实文件） ─────────────────────────────────
function makeObsidianProvider({ vaultPath }) {
  let watcher = null

  async function listMarkdownFiles(dir) {
    let out = []
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '.git') continue
          out = out.concat(await listMarkdownFiles(full))
        } else if (e.isFile() && e.name.endsWith('.md')) {
          out.push(full)
        }
      }
    } catch { /* dir not readable */ }
    return out
  }

  return {
    kind: 'obsidian',
    label: 'obsidian-vault',
    listPages: async ({ parentId, limit = 50 } = {}) => {
      const root = parentId ? resolveSafePath(vaultPath, parentId) : vaultPath
      const files = await listMarkdownFiles(root)
      const out = []
      for (const filePath of files) {
        if (out.length >= limit) break
        const rel = path.relative(vaultPath, filePath).split(path.sep).join('/')
        try {
          const stat = await fs.stat(filePath)
          const content = await fs.readFile(filePath, 'utf8').catch(() => '')
          out.push(normalizePage('obsidian', vaultPath, rel, filePath, stat, content))
        } catch {}
      }
      return out
    },
    getPage: async (id) => {
      const rel = String(id).replace(/^obsidian:/, '')
      const filePath = resolveSafePath(vaultPath, rel)
      try {
        const stat = await fs.stat(filePath)
        const content = await fs.readFile(filePath, 'utf8')
        return normalizePage('obsidian', vaultPath, rel, filePath, stat, content)
      } catch { return null }
    },
    createPage: async ({ parentId, title, content = '', tags = [] } = {}) => {
      const filename = (title || 'untitled').replace(/[\\/:*?"<>|]/g, '_') + '.md'
      const rel = parentId ? `${parentId}/${filename}` : filename
      const filePath = resolveSafePath(vaultPath, rel)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      const body = buildFrontmatter(tags) + (content || '')
      await fs.writeFile(filePath, body, 'utf8')
      const stat = await fs.stat(filePath)
      return normalizePage('obsidian', vaultPath, rel, filePath, stat, body)
    },
    updatePage: async (id, patch = {}) => {
      const rel = String(id).replace(/^obsidian:/, '')
      const filePath = resolveSafePath(vaultPath, rel)
      let existing = ''
      try { existing = await fs.readFile(filePath, 'utf8') } catch {}
      const oldTags = parseFrontmatterTags(existing)
      const newTags = Array.isArray(patch.tags) ? patch.tags : oldTags
      const newContent = patch.content !== undefined ? patch.content : (existing.replace(/^---[\s\S]*?---\n*/, '') || '')
      const newTitle = patch.title !== undefined ? patch.title : path.basename(rel, '.md')
      const newFilename = (newTitle).replace(/[\\/:*?"<>|]/g, '_') + '.md'
      const newRel = path.dirname(rel) === '.' ? newFilename : `${path.dirname(rel)}/${newFilename}`
      const newFilePath = resolveSafePath(vaultPath, newRel)
      const body = buildFrontmatter(newTags) + newContent
      await fs.writeFile(newFilePath, body, 'utf8')
      if (newFilePath !== filePath) {
        try { await fs.unlink(filePath) } catch {}
      }
      const stat = await fs.stat(newFilePath)
      return normalizePage('obsidian', vaultPath, newRel, newFilePath, stat, body)
    },
    deletePage: async (id) => {
      const rel = String(id).replace(/^obsidian:/, '')
      const filePath = resolveSafePath(vaultPath, rel)
      try {
        await fs.unlink(filePath)
        return { ok: true, id: String(id) }
      } catch (err) {
        return { ok: false, id: String(id), error: err?.message || String(err) }
      }
    },
    watch: (callback) => {
      // async load chokidar
      let active = true
      let watcherInstance = null
      ;(async () => {
        const watchFn = await PROVIDER_LOADERS.obsidian()
        if (!watchFn || !active) return
        watcherInstance = watchFn(vaultPath, {
          ignored: (p) => p.includes('node_modules') || p.includes('.git') || (p.split('/').pop() || '').startsWith('.'),
          ignoreInitial: true,
          depth: 3,
        })
        const onChange = async (filePath) => {
          if (!filePath.endsWith('.md')) return
          try {
            const stat = await fs.stat(filePath).catch(() => null)
            if (!stat) return  // deleted
            const content = await fs.readFile(filePath, 'utf8').catch(() => '')
            const rel = path.relative(vaultPath, filePath).split(path.sep).join('/')
            const page = normalizePage('obsidian', vaultPath, rel, filePath, stat, content)
            try { callback({ type: 'change', page }) } catch (err) { console.warn('[obsidian] watch callback error:', err?.message || err) }
          } catch (err) { console.warn('[obsidian] watch handler error:', err?.message || err) }
        }
        const onUnlink = async (filePath) => {
          if (!filePath.endsWith('.md')) return
          const rel = path.relative(vaultPath, filePath).split(path.sep).join('/')
          try { callback({ type: 'delete', id: `obsidian:${rel}` }) } catch {}
        }
        watcherInstance.on('add', onChange)
        watcherInstance.on('change', onChange)
        watcherInstance.on('unlink', onUnlink)
      })()
      return () => {
        active = false
        if (watcherInstance) {
          try { watcherInstance.close() } catch {}
          watcherInstance = null
        }
      }
    },
  }
}

// ── 环境凭据读取 ────────────────────────────────────────────────────────
function readObsidianCredentials() {
  return { vaultPath: process.env.GINA_OBSIDIAN_VAULT_PATH || null }
}

function credentialsLookComplete(creds) {
  return Boolean(creds?.vaultPath)
}

// ── Provider 缓存 ───────────────────────────────────────────────────────
const _providerCache = new Map()

export async function getObsidianProvider(provider = null) {
  const requested = provider || process.env.GINA_OBSIDIAN_PROVIDER || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    instance = makeMockProvider()
  } else if (requested === 'obsidian') {
    const creds = readObsidianCredentials()
    if (!credentialsLookComplete(creds)) {
      console.warn('[obsidian] vaultPath not set; falling back to mock')
      instance = makeMockProvider()
    } else {
      // 验证 vaultPath 存在
      try {
        const stat = await fs.stat(creds.vaultPath)
        if (!stat.isDirectory()) throw new Error('not a directory')
      } catch (err) {
        console.warn(`[obsidian] vaultPath invalid (${err?.message}); falling back to mock`)
        instance = makeMockProvider()
      }
      if (!instance) instance = makeObsidianProvider({ vaultPath: creds.vaultPath })
    }
  } else {
    console.warn(`[obsidian] unknown provider "${requested}"; falling back to mock`)
    instance = makeMockProvider()
  }
  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 5 函数统一接口 ──────────────────────────────────────────────────────
export async function listPages(opts = {}) {
  const p = await getObsidianProvider(opts.provider)
  return p.listPages(opts)
}

export async function getPage(id, opts = {}) {
  const p = await getObsidianProvider(opts.provider)
  return p.getPage(id)
}

export async function createPage({ provider, parentId, title, content, tags } = {}) {
  const p = await getObsidianProvider(provider)
  return p.createPage({ parentId, title, content, tags })
}

export async function updatePage({ provider, id, patch }) {
  const p = await getObsidianProvider(provider)
  return p.updatePage(id, patch || {})
}

export async function deletePage({ provider, id }) {
  const p = await getObsidianProvider(provider)
  return p.deletePage(id)
}

export async function watchVault(callback, opts = {}) {
  const p = await getObsidianProvider(opts.provider)
  return p.watch(callback)
}

export function getObsidianStatus() {
  const requested = process.env.GINA_OBSIDIAN_PROVIDER || 'mock'
  const creds = readObsidianCredentials()
  return {
    ok: true,
    requested,
    effectiveProvider: requested === 'obsidian' && credentialsLookComplete(creds) ? 'obsidian' : 'mock',
    credsComplete: credentialsLookComplete(creds),
    source: 'GINA_OBSIDIAN_VAULT_PATH',
    availableProviders: Object.keys(PROVIDER_LOADERS),
  }
}

export const OBSIDIAN_PROVIDERS = Object.freeze(['mock', 'obsidian'])

export const __test = {
  _providerCache,
  resolveSafePath,
  parseFrontmatterTags,
  buildFrontmatter,
  normalizePage,
}
