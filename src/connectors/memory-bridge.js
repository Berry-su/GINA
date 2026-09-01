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
  }
}

export const __test = {
  buildConceptText,
  safeExtractKeywords,
  safeUpsertMemory,
}
