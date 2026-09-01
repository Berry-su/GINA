// src/connectors/tasks.js — 任务连接器抽象（ADR-010 · Phase 2）
//
// 设计目标：
//   老板说"我今天要做什么"、"加一个任务"、"做完 X" → 跨 Apple Reminders / Things 3 / Todoist
//   统一 listTasks / createTask / updateTask / completeTask / deleteTask。
//
// Provider 矩阵：
//   - reminders : Apple Reminders（macOS AppleScript；仅 macOS）
//   - things    : Things 3 URL Scheme（things:///show?id=…；macOS 优先）
//   - todoist   : Todoist REST API（axios/fetch；跨平台）
//   - mock      : 内置 fake 任务（测试 + 缺 creds 默认）
//
// 统一 Task 形状：
//   {
//     id, provider, listId?, listName?,
//     title, notes?, dueDate? (ISO 8601), completed (bool), completedAt?,
//     priority? (1-4), tags? (Array<string>), url?
//   }

import { execSync } from 'child_process'
import { config as appConfig } from '../config.js'

const IS_MAC = process.platform === 'darwin'

// ── Provider：mock ─────────────────────────────────────────────────────────
function makeMockProvider() {
  let counter = 1
  const lists = [
    { id: 'mock-inbox', name: '收件箱' },
    { id: 'mock-today', name: '今天' },
    { id: 'mock-work', name: '工作' },
  ]
  const tasks = new Map()
  // 预置 2 条
  tasks.set('mock-t-1', {
    id: 'mock-t-1',
    provider: 'mock',
    listId: 'mock-today',
    listName: '今天',
    title: '复盘 Phase 2 进度',
    notes: 'ADR-010 + 3 个 connector + 9 测试',
    dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    completed: false,
    priority: 2,
    tags: ['gina', 'phase-2'],
  })
  tasks.set('mock-t-2', {
    id: 'mock-t-2',
    provider: 'mock',
    listId: 'mock-work',
    listName: '工作',
    title: '提交投资人 demo 时间窗',
    notes: '老板拍板前先准备 3 个候选时间',
    dueDate: null,
    completed: false,
    priority: 1,
    tags: ['demo'],
  })

  return {
    kind: 'mock',
    label: 'mock-tasks',
    listTasks: async ({ listId = null, includeCompleted = false } = {}) => {
      const out = []
      for (const t of tasks.values()) {
        if (listId && t.listId !== listId) continue
        if (!includeCompleted && t.completed) continue
        out.push({ ...t })
      }
      return out.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
        return ad - bd
      })
    },
    listLists: async () => lists.map((l) => ({ ...l })),
    createTask: async (input) => {
      const id = `mock-t-${counter++}`
      const list = lists.find((l) => l.id === (input.listId || 'mock-inbox')) || lists[0]
      const t = {
        id,
        provider: 'mock',
        listId: list.id,
        listName: list.name,
        title: input.title,
        notes: input.notes ?? null,
        dueDate: input.dueDate ?? null,
        completed: false,
        priority: input.priority ?? 0,
        tags: input.tags ?? [],
        url: null,
      }
      tasks.set(id, t)
      return { ...t }
    },
    updateTask: async (id, patch) => {
      const cur = tasks.get(id)
      if (!cur) throw new Error(`mock task ${id} not found`)
      const next = { ...cur, ...patch, id, provider: 'mock' }
      tasks.set(id, next)
      return { ...next }
    },
    completeTask: async (id, completed = true) => {
      const cur = tasks.get(id)
      if (!cur) throw new Error(`mock task ${id} not found`)
      cur.completed = completed
      cur.completedAt = completed ? new Date().toISOString() : null
      return { ...cur }
    },
    deleteTask: async (id) => {
      const ok = tasks.delete(id)
      return { ok, id, provider: 'mock' }
    },
  }
}

// ── Provider：Apple Reminders（macOS AppleScript） ─────────────────────────
function makeRemindersProvider() {
  function runOSA(script) {
    if (!IS_MAC) return null
    try {
      return execSync(`osascript -e ${JSON.stringify(script)}`, {
        timeout: 8000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      return null
    }
  }

  return {
    kind: 'reminders',
    label: 'apple-reminders',
    listLists: async () => {
      const raw = runOSA('tell application "Reminders" to get name of every list')
      if (raw == null) return []
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ id: name, name }))
    },
    listTasks: async ({ listId = null, includeCompleted = false } = {}) => {
      const listName = listId || 'Inbox'
      const listFilter = listId ? `of list "${listId.replace(/"/g, '\\"')}"` : ''
      const completedFilter = includeCompleted ? '' : 'whose completed is false'
      const script = `
        tell application "Reminders"
          set out to ""
          repeat with t in (every reminder ${listFilter} ${completedFilter})
            set out to out & (id of t) & tab & (name of t) & tab & (name of list of t) & tab & (due date of t as string) & tab & (completed of t) & tab & (body of t) & linefeed
          end repeat
          return out
        end tell
      `
      const raw = runOSA(script)
      if (raw == null) return []
      return raw
        .split('\n')
        .map((line) => line.split('\t'))
        .filter((c) => c.length >= 5)
        .map(([id, title, listName2, dueDate, completed, body]) => ({
          id: String(id),
          provider: 'reminders',
          listId: listName2,
          listName: listName2,
          title: title || '(无标题)',
          notes: body || null,
          dueDate: dueDate && dueDate !== 'missing value' ? new Date(dueDate).toISOString() : null,
          completed: completed === 'true',
          priority: 0,
          tags: [],
        }))
    },
    createTask: async (input) => {
      const listName = input.listId || 'Inbox'
      const dueClause = input.dueDate
        ? `due date date "${new Date(input.dueDate).toString()}"`
        : ''
      const script = `
        tell application "Reminders"
          set newRem to make new reminder at end of list "${listName.replace(/"/g, '\\"')}" with properties {name:"${String(input.title || '').replace(/"/g, '\\"')}", body:"${String(input.notes || '').replace(/"/g, '\\"')}"${dueClause ? ', ' + dueClause : ''}}
          return id of newRem
        end tell
      `
      const id = runOSA(script)
      if (id == null) throw new Error('Reminders createTask failed (no macOS access?)')
      return {
        id: String(id),
        provider: 'reminders',
        listId: listName,
        listName,
        title: input.title,
        notes: input.notes ?? null,
        dueDate: input.dueDate ?? null,
        completed: false,
        priority: 0,
        tags: [],
      }
    },
    updateTask: async (id, patch) => {
      const titleClause = patch.title
        ? `set name of t to "${String(patch.title).replace(/"/g, '\\"')}"`
        : ''
      const completedClause = typeof patch.completed === 'boolean'
        ? `set completed of t to ${patch.completed}`
        : ''
      const script = `
        tell application "Reminders"
          set t to reminder id "${String(id).replace(/"/g, '\\"')}"
          ${titleClause}
          ${completedClause}
          return id of t
        end tell
      `
      const ok = runOSA(script)
      if (ok == null) throw new Error('Reminders updateTask failed')
      return { id: String(id), provider: 'reminders', ...patch }
    },
    completeTask: async (id, completed = true) => {
      return this.updateTask(id, { completed })
    },
    deleteTask: async (id) => {
      const script = `
        tell application "Reminders"
          delete reminder id "${String(id).replace(/"/g, '\\"')}"
        end tell
      `
      runOSA(script)
      return { ok: true, id, provider: 'reminders' }
    },
  }
}

// ── Provider：Things 3（URL Scheme） ───────────────────────────────────────
// Things 3 的官方 API 仅本地 AppleScript，本 phase 走最简方案：
//   - listTasks / listLists 暂不支持（Things 不开放读 API 给 GINA 这层）
//   - createTask 走 things:///add?title=…&list=… URL scheme
//   - completeTask / updateTask 暂未实现（Things URL scheme 限制）
function makeThingsProvider() {
  function openURL(url) {
    if (!IS_MAC) {
      // 非 macOS 平台：仅记录
      return { ok: true, mocked: true, url }
    }
    try {
      execSync(`open "${url}"`, { timeout: 3000, stdio: 'ignore' })
      return { ok: true, url }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  }
  return {
    kind: 'things',
    label: 'things-3',
    listLists: async () => [{ id: 'inbox', name: 'Inbox' }], // Things 仅 1 个主 Inbox
    listTasks: async () => {
      // Things 3 没有公开读 API；返回空（不抛错）
      return []
    },
    createTask: async (input) => {
      const params = new URLSearchParams({ title: input.title || '' })
      if (input.notes) params.set('notes', input.notes)
      if (input.dueDate) params.set('due', input.dueDate)
      if (input.listId && input.listId !== 'inbox') params.set('list', input.listId)
      const url = `things:///add?${params}`
      const res = openURL(url)
      return {
        id: `things-${Date.now()}`,
        provider: 'things',
        listId: input.listId || 'inbox',
        listName: input.listId || 'Inbox',
        title: input.title,
        notes: input.notes ?? null,
        dueDate: input.dueDate ?? null,
        completed: false,
        priority: 0,
        tags: [],
        url,
        openResult: res,
      }
    },
    updateTask: async () => {
      throw new Error('Things 3 updateTask: not supported via URL scheme')
    },
    completeTask: async () => {
      throw new Error('Things 3 completeTask: not supported via URL scheme')
    },
    deleteTask: async () => {
      throw new Error('Things 3 deleteTask: not supported via URL scheme')
    },
  }
}

// ── Provider：Todoist REST API ─────────────────────────────────────────────
function makeTodoistProvider({ credentials }) {
  // credentials: { token } (Personal API token)
  const BASE = 'https://api.todoist.com/rest/v2'
  async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(`Todoist ${path} failed: ${res.status} ${err.slice(0, 200)}`)
    }
    return res.json()
  }

  return {
    kind: 'todoist',
    label: 'todoist',
    listLists: async () => {
      const projects = await api('/projects')
      return projects.map((p) => ({ id: String(p.id), name: p.name }))
    },
    listTasks: async ({ listId = null, includeCompleted = false } = {}) => {
      const params = new URLSearchParams()
      if (listId) params.set('project_id', listId)
      const data = await api(`/tasks?${params}`)
      return data
        .filter((t) => includeCompleted || !t.isCompleted)
        .map((t) => ({
          id: String(t.id),
          provider: 'todoist',
          listId: t.projectId ? String(t.projectId) : null,
          listName: null,
          title: t.content,
          notes: t.description || null,
          dueDate: t.due?.dateTime || t.due?.date || null,
          completed: Boolean(t.isCompleted),
          priority: t.priority || 0,
          tags: t.labels || [],
          url: t.url,
        }))
    },
    createTask: async (input) => {
      const body = {
        content: input.title,
        description: input.notes,
        due_date: input.dueDate ? input.dueDate.slice(0, 10) : undefined,
        due_datetime: input.dueDate && input.dueDate.length > 10 ? input.dueDate : undefined,
        priority: input.priority || 1,
        labels: input.tags || [],
      }
      if (input.listId) body.project_id = input.listId
      const t = await api('/tasks', { method: 'POST', body: JSON.stringify(body) })
      return {
        id: String(t.id),
        provider: 'todoist',
        listId: t.projectId ? String(t.projectId) : null,
        title: t.content,
        notes: t.description || null,
        dueDate: t.due?.dateTime || t.due?.date || null,
        completed: Boolean(t.isCompleted),
        priority: t.priority || 0,
        tags: t.labels || [],
        url: t.url,
      }
    },
    updateTask: async (id, patch) => {
      const body = {}
      if (patch.title) body.content = patch.title
      if (patch.notes != null) body.description = patch.notes
      if (patch.priority) body.priority = patch.priority
      if (patch.dueDate) body.due_date = patch.dueDate.slice(0, 10)
      const t = await api(`/tasks/${id}`, { method: 'POST', body: JSON.stringify(body) })
      return {
        id: String(t.id),
        provider: 'todoist',
        listId: t.projectId ? String(t.projectId) : null,
        title: t.content,
        notes: t.description || null,
        dueDate: t.due?.dateTime || t.due?.date || null,
        completed: Boolean(t.isCompleted),
        priority: t.priority || 0,
        tags: t.labels || [],
        url: t.url,
      }
    },
    completeTask: async (id) => {
      await api(`/tasks/${id}/close`, { method: 'POST' })
      return { id, provider: 'todoist', completed: true, completedAt: new Date().toISOString() }
    },
    deleteTask: async (id) => {
      await api(`/tasks/${id}`, { method: 'DELETE' })
      return { ok: true, id, provider: 'todoist' }
    },
  }
}

// ── 凭证读取 ─────────────────────────────────────────────────────────────
function readEnvCredentials(provider) {
  if (provider === 'todoist') {
    return { token: process.env.GINA_TODOIST_TOKEN }
  }
  return null
}
function credsLookComplete(provider, c) {
  if (!c) return false
  if (provider === 'todoist') return Boolean(c.token)
  return false
}

const _providerCache = new Map()

export async function getTaskProvider(provider = null) {
  const requested = provider || process.env.GINA_TASKS_PROVIDER || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    instance = makeMockProvider()
  } else if (requested === 'reminders') {
    if (!IS_MAC) {
      console.warn('[tasks] Apple Reminders is macOS-only; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeRemindersProvider()
    }
  } else if (requested === 'things') {
    instance = makeThingsProvider()
  } else if (requested === 'todoist') {
    const creds = readEnvCredentials('todoist')
    if (!credsLookComplete('todoist', creds)) {
      console.warn('[tasks] Todoist token missing; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeTodoistProvider({ credentials: creds })
    }
  } else {
    throw new Error(`Unknown tasks provider: ${requested}`)
  }

  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 统一对外 API ─────────────────────────────────────────────────────────
export async function listTasks({ provider = null, listId = null, includeCompleted = false } = {}) {
  const p = await getTaskProvider(provider)
  return p.listTasks({ listId, includeCompleted })
}

export async function listTaskLists({ provider = null } = {}) {
  const p = await getTaskProvider(provider)
  return p.listLists()
}

export async function createTask({ provider = null, ...input } = {}) {
  const p = await getTaskProvider(provider)
  return p.createTask(input)
}

export async function updateTask({ provider = null, id, patch } = {}) {
  const p = await getTaskProvider(provider)
  return p.updateTask(id, patch)
}

export async function completeTask({ provider = null, id, completed = true } = {}) {
  const p = await getTaskProvider(provider)
  return p.completeTask(id, completed)
}

export async function deleteTask({ provider = null, id } = {}) {
  const p = await getTaskProvider(provider)
  return p.deleteTask(id)
}

export const TASK_PROVIDERS = [
  { id: 'mock', label: 'Mock（测试 / 降级）', default: true },
  { id: 'reminders', label: 'Apple Reminders（macOS）' },
  { id: 'things', label: 'Things 3（macOS · URL scheme）' },
  { id: 'todoist', label: 'Todoist REST', env: 'GINA_TODOIST_TOKEN' },
]

export function getTasksStatus() {
  return {
    providers: TASK_PROVIDERS,
    active: process.env.GINA_TASKS_PROVIDER || 'mock',
    cached: [..._providerCache.keys()],
  }
}

export const __test = {
  _providerCache,
  makeMockProvider,
  makeThingsProvider,
  readEnvCredentials,
  credsLookComplete,
  IS_MAC,
}

void appConfig
