// src/connectors/memory-bridge.js — 连接器 ↔ L2 memory 集成层（ADR-010 · Phase 2）
//
// 职责：
//   - 拉到的日历 / 邮件 / 任务写入 L2 memory（episodic 层；自动衰减）
//   - 触发 CATS-Net concept 化："X 是关于 Y 的"（subject 短语 → concept node）
//   - emotion-isolation 严守：数据写入只走事实通道，**不触发 joy 情绪**，
//     不进决策链路；调用方拿到 plain text 摘要回主对话
//
// 接入点：
//   - API 路由（src/api/routes/calendar.js 等）拉数据后 → memoryBridge.ingest*()
//   - LLM 调 tool（query_calendar / query_email / query_tasks）→ executor.js
//     自动 ingest；UI 也能直接调 API 看 memory 累计
//
// 失败容忍：
//   - memory 写入失败 → 警告日志 + 继续返回数据（不阻断主路径）
//   - concept 化失败 → 跳过（不阻断）
//   - 不抛错到调用方

import { upsertMemoryByMemId } from '../capabilities/db.js'
import { extractKeywords } from '../memory/keywords.js'

// ── Episodic memory 写入工具（统一封装） ───────────────────────────────────
async function safeUpsertMemory({ memId, content, type = 'episodic', source = 'connector', tags = [], detail = null }) {
  try {
    const result = upsertMemoryByMemId({
      mem_id: memId,
      event_type: type,
      content,
      detail: detail ? JSON.stringify(detail).slice(0, 4000) : null,
      source_ref: source,
      title: content.slice(0, 80),
      timestamp: new Date().toISOString(),
      tags,
      salience: 2,
    })
    return { ok: true, result }
  } catch (err) {
    console.warn('[memory-bridge] upsert failed:', err?.message || err)
    return { ok: false, error: err?.message || String(err) }
  }
}

// ── Concept 化（"X 是关于 Y 的"）────────────────────────────────────────
function buildConceptText(kind, item) {
  if (kind === 'calendar') {
    const dateStr = item.start ? new Date(item.start).toLocaleString('zh-CN', { hour12: false }) : '未排期'
    return `${item.title}（${dateStr}）是关于${item.calendarName || item.calendarId || '日历'}的事件`
  }
  if (kind === 'email') {
    const from = item.from || '未知发件人'
    const dateStr = item.date ? new Date(item.date).toLocaleString('zh-CN', { hour12: false }) : '未注明时间'
    return `${item.subject || '(无主题)'} 是关于 ${from} 在 ${dateStr} 的邮件`
  }
  if (kind === 'task') {
    const list = item.listName || item.listId || '默认清单'
    const due = item.dueDate ? `截止 ${new Date(item.dueDate).toLocaleString('zh-CN', { hour12: false })}` : '无截止'
    return `${item.title || '(无标题)'} 是关于 ${list} 的任务（${due}）`
  }
  return null
}

function safeExtractKeywords(text, maxKeywords = 6) {
  try {
    return extractKeywords(text, maxKeywords) || []
  } catch {
    return []
  }
}

// ── 公开 API：ingest 各 connector 拉到的数据 ──────────────────────────────
export async function ingestCalendarEvents(events = [], { maxItems = 25 } = {}) {
  if (!Array.isArray(events) || events.length === 0) return { ok: true, ingested: 0 }
  const top = events.slice(0, maxItems)
  let ingested = 0
  for (const ev of top) {
    const concept = buildConceptText('calendar', ev)
    if (!concept) continue
    const keywords = safeExtractKeywords(`${ev.title || ''} ${ev.location || ''} ${ev.description || ''}`)
    const memId = `cal-${ev.provider || 'x'}-${ev.id}`
    const r = await safeUpsertMemory({
      memId,
      content: concept,
      type: 'episodic',
      source: `connector:calendar:${ev.provider || 'unknown'}`,
      tags: ['calendar', ev.provider, ...keywords].filter(Boolean),
      detail: {
        kind: 'calendar_event',
        provider: ev.provider,
        eventId: ev.id,
        calendarId: ev.calendarId,
        start: ev.start,
        end: ev.end,
        location: ev.location,
        title: ev.title,
      },
    })
    if (r.ok) ingested++
  }
  return { ok: true, ingested, total: events.length }
}

export async function ingestEmails(emails = [], { maxItems = 25 } = {}) {
  if (!Array.isArray(emails) || emails.length === 0) return { ok: true, ingested: 0 }
  const top = emails.slice(0, maxItems)
  let ingested = 0
  for (const em of top) {
    const concept = buildConceptText('email', em)
    if (!concept) continue
    const keywords = safeExtractKeywords(`${em.subject || ''} ${em.from || ''}`)
    const memId = `em-${em.provider || 'x'}-${em.id}`
    const r = await safeUpsertMemory({
      memId,
      content: concept,
      type: 'episodic',
      source: `connector:email:${em.provider || 'unknown'}`,
      tags: ['email', em.provider, em.unread ? 'unread' : 'read', ...keywords].filter(Boolean),
      detail: {
        kind: 'email',
        provider: em.provider,
        emailId: em.id,
        subject: em.subject,
        from: em.from,
        date: em.date,
        unread: em.unread,
      },
    })
    if (r.ok) ingested++
  }
  return { ok: true, ingested, total: emails.length }
}

export async function ingestTasks(tasks = [], { maxItems = 25 } = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) return { ok: true, ingested: 0 }
  const top = tasks.slice(0, maxItems)
  let ingested = 0
  for (const t of top) {
    const concept = buildConceptText('task', t)
    if (!concept) continue
    const keywords = safeExtractKeywords(`${t.title || ''} ${t.notes || ''}`)
    const memId = `task-${t.provider || 'x'}-${t.id}`
    const r = await safeUpsertMemory({
      memId,
      content: concept,
      type: 'episodic',
      source: `connector:tasks:${t.provider || 'unknown'}`,
      tags: ['task', t.provider, ...(t.tags || []), ...keywords].filter(Boolean),
      detail: {
        kind: 'task',
        provider: t.provider,
        taskId: t.id,
        listId: t.listId,
        listName: t.listName,
        dueDate: t.dueDate,
        completed: t.completed,
        title: t.title,
      },
    })
    if (r.ok) ingested++
  }
  return { ok: true, ingested, total: tasks.length }
}

// ── Concept 化："X 是关于 Y 的"（Phase 3 · notes + cron）────────────
function buildNoteConceptText(note) {
  if (!note || !note.title) return null
  const tagStr = Array.isArray(note.tags) && note.tags.length > 0 ? note.tags.join('/') : '无标签'
  const provider = note.provider || 'note'
  return `《${note.title}》是关于 ${tagStr} 的笔记（${provider}）`
}

function buildCronConceptText(run) {
  if (!run || !run.id) return null
  const time = run.runAt ? new Date(run.runAt).toLocaleString('zh-CN', { hour12: false }) : '未注明时间'
  const summary = run.summary || (run.ok ? '成功' : '失败')
  return `${run.id} cron 在 ${time} 跑过，${summary}`
}

// ── 公开 API：ingest 笔记（Phase 3） ────────────────────────────────────
export async function ingestNotes(notes = [], { maxItems = 25 } = {}) {
  if (!Array.isArray(notes) || notes.length === 0) return { ok: true, ingested: 0 }
  const top = notes.slice(0, maxItems)
  let ingested = 0
  for (const n of top) {
    const concept = buildNoteConceptText(n)
    if (!concept) continue
    const keywords = safeExtractKeywords(`${n.title || ''} ${Array.isArray(n.tags) ? n.tags.join(' ') : ''}`)
    const memId = `note-${n.provider || 'x'}-${n.id}`
    const r = await safeUpsertMemory({
      memId,
      content: concept,
      type: 'episodic',
      source: `connector:notes:${n.provider || 'unknown'}`,
      tags: ['note', n.provider, ...(n.tags || []), ...keywords].filter(Boolean),
      detail: {
        kind: 'note',
        provider: n.provider,
        pageId: n.id,
        parentId: n.parentId,
        title: n.title,
        url: n.url,
        tags: n.tags,
        contentLength: typeof n.content === 'string' ? n.content.length : 0,
      },
    })
    if (r.ok) ingested++
  }
  return { ok: true, ingested, total: notes.length }
}

// ── 公开 API：ingest cron 跑次（Phase 3） ──────────────────────────────
export async function ingestCronRuns(runs = [], { maxItems = 50 } = {}) {
  if (!Array.isArray(runs) || runs.length === 0) return { ok: true, ingested: 0 }
  const top = runs.slice(0, maxItems)
  let ingested = 0
  for (const run of top) {
    const concept = buildCronConceptText(run)
    if (!concept) continue
    const memId = `cron-${run.id}-${(run.runAt || new Date().toISOString()).replace(/[^0-9]/g, '').slice(0, 14)}`
    const r = await safeUpsertMemory({
      memId,
      content: concept,
      type: 'episodic',
      source: `agentic:cron:${run.id}`,
      tags: ['cron', run.id, run.category || 'unknown', run.ok ? 'success' : 'failure'],
      detail: {
        kind: 'cron_run',
        cronId: run.id,
        runAt: run.runAt,
        ok: Boolean(run.ok),
        summary: run.summary,
        category: run.category,
        durationMs: run.durationMs,
        triggeredBy: run.triggeredBy || 'schedule',
      },
    })
    if (r.ok) ingested++
  }
  return { ok: true, ingested, total: runs.length }
}

// ── Concept 化："X 是关于 Y 的"（Phase 4 · IoT + 场景）─────────────────
function buildIoTDeviceConceptText(device) {
  if (!device) return null
  const stateStr = []
  if (typeof device.state?.on === 'boolean') stateStr.push(device.state.on ? '开' : '关')
  if (typeof device.state?.brightness === 'number') stateStr.push(`亮度${device.state.brightness}%`)
  if (typeof device.state?.temperature === 'number') stateStr.push(`${device.state.temperature}°`)
  if (typeof device.state?.locked === 'boolean') stateStr.push(device.state.locked ? '已锁' : '未锁')
  const stateDesc = stateStr.length > 0 ? `（${stateStr.join('，')}）` : ''
  return `${device.name}（${device.type}，${device.room}）${stateDesc} 是 ${device.provider} 的 IoT 设备`
}

function buildScenarioRunConceptText(run) {
  if (!run) return null
  const time = run.runAt ? new Date(run.runAt).toLocaleString('zh-CN', { hour12: false }) : '未注明时间'
  const flag = run.dryRun ? '[干跑]' : ''
  return `IoT 场景 ${run.scenarioId || ''} 在 ${time} 跑过${flag}：${run.summary || (run.ok ? '成功' : '失败')}`
}

// ── 公开 API：ingest IoT 设备（Phase 4）──────────────────────────────────
export async function ingestIoTDevices(devices = [], { maxItems = 25 } = {}) {
  if (!Array.isArray(devices) || devices.length === 0) return { ok: true, ingested: 0 }
  const top = devices.slice(0, maxItems)
  let ingested = 0
  for (const d of top) {
    const concept = buildIoTDeviceConceptText(d)
    if (!concept) continue
    const keywords = safeExtractKeywords(`${d.name || ''} ${d.type || ''} ${d.room || ''}`)
    const memId = `iot-${d.provider || 'x'}-${d.id}`
    const r = await safeUpsertMemory({
      memId,
      content: concept,
      type: 'episodic',
      source: `connector:iot:${d.provider || 'unknown'}`,
      tags: ['iot', d.provider, d.type, d.room, ...keywords].filter(Boolean),
      detail: {
        kind: 'iot_device',
        provider: d.provider,
        deviceId: d.id,
        name: d.name,
        type: d.type,
        room: d.room,
        state: d.state,
        controllable: d.controllable,
        lastUpdated: d.lastUpdated,
      },
    })
    if (r.ok) ingested++
  }
  return { ok: true, ingested, total: devices.length }
}

// ── 公开 API：ingest IoT 场景跑次（Phase 4）──────────────────────────────
export async function ingestScenarioRuns(runs = [], { maxItems = 50 } = {}) {
  if (!Array.isArray(runs) || runs.length === 0) return { ok: true, ingested: 0 }
  const top = runs.slice(0, maxItems)
  let ingested = 0
  for (const run of top) {
    const concept = buildScenarioRunConceptText(run)
    if (!concept) continue
    const memId = `iot-scenario-${run.scenarioId || 'x'}-${(run.runAt || new Date().toISOString()).replace(/[^0-9]/g, '').slice(0, 14)}`
    const r = await safeUpsertMemory({
      memId,
      content: concept,
      type: 'episodic',
      source: `agentic:iot-scenario:${run.scenarioId || 'unknown'}`,
      tags: ['iot', 'scenario', run.scenarioId, run.dryRun ? 'dry-run' : 'live', run.ok ? 'success' : 'failure', run.triggeredBy || 'unknown'].filter(Boolean),
      detail: {
        kind: 'iot_scenario_run',
        scenarioId: run.scenarioId,
        runId: run.runId,
        runAt: run.runAt,
        ok: Boolean(run.ok),
        summary: run.summary,
        actionsCount: run.actionsCount,
        successCount: run.successCount,
        dryRun: Boolean(run.dryRun),
        approved: Boolean(run.approved),
        triggeredBy: run.triggeredBy,
      },
    })
    if (r.ok) ingested++
  }
  return { ok: true, ingested, total: runs.length }
}

// ── Memory-bridge 状态（健康检查用） ─────────────────────────────────────
export function getMemoryBridgeStatus() {
  return {
    ok: true,
    bridge: 'connectors → L2 episodic memory',
    policy: {
      emotionIsolation: 'strict',
      autoDecay: true,
      maxItemsPerIngest: 25,
    },
    sources: ['calendar', 'email', 'tasks', 'notes', 'cron', 'iot', 'iot_scenario'],
  }
}

export const __test = {
  buildConceptText,
  buildNoteConceptText,
  buildCronConceptText,
  buildIoTDeviceConceptText,
  buildScenarioRunConceptText,
  safeExtractKeywords,
  safeUpsertMemory,
}
