// src/capabilities/tools/connectors.js — 连接器工具执行器（ADR-010 · Phase 2）
//
// LLM 调 query_calendar / query_email / query_tasks 时走这里。
// 逻辑：
//   1. 解析 args.action
//   2. 调对应 connector 模块
//   3. 读操作自动 ingest L2 memory（memory-bridge）
//   4. 返回结构化 string 给 LLM
//
// emotion-isolation 严守：
//   - tool 输出不含 emotion 词
//   - ingest 是后台事务，**不触发 joy 也不进决策**

import {
  listCalendars, queryEvents, createEvent, updateEvent, deleteEvent,
} from '../../connectors/calendar.js'
import {
  listEmails, searchEmails, getEmail, sendEmail, markRead,
} from '../../connectors/email.js'
import {
  listTasks, listTaskLists, createTask, updateTask, completeTask, deleteTask,
} from '../../connectors/tasks.js'
import {
  ingestCalendarEvents, ingestEmails, ingestTasks,
} from '../../connectors/memory-bridge.js'

// ── 通用 helper ───────────────────────────────────────────────────────────
function toolJson(obj) {
  return JSON.stringify(obj, null, 2)
}

function defaultRange({ days = 7 } = {}) {
  const start = new Date()
  const end = new Date(Date.now() + days * 86400000)
  return { rangeStart: start.toISOString(), rangeEnd: end.toISOString() }
}

// ── query_calendar 执行器 ─────────────────────────────────────────────────
export async function execQueryCalendar(args = {}, context = {}) {
  const action = args.action
  const provider = args.provider || null
  if (!action) return '错误：未提供 action（list_calendars/query/create/update/delete）'

  if (action === 'list_calendars') {
    const cals = await listCalendars({ provider })
    return toolJson({ ok: true, action, count: cals.length, calendars: cals })
  }

  if (action === 'query') {
    const range = defaultRange({ days: Number(args.limit) ? 7 : 7 })
    const events = await queryEvents({
      provider,
      calendarId: args.calendarId,
      rangeStart: args.rangeStart || range.rangeStart,
      rangeEnd: args.rangeEnd || range.rangeEnd,
      maxResults: Number(args.limit) || 50,
    })
    // 自动 ingest L2 memory
    const ingestResult = await ingestCalendarEvents(events)
    return toolJson({ ok: true, action, count: events.length, events, memoryIngest: ingestResult })
  }

  if (action === 'create') {
    if (!args.title || !args.start) return '错误：create 需要 title + start'
    const ev = await createEvent({
      provider,
      calendarId: args.calendarId,
      title: args.title,
      description: args.description,
      location: args.location,
      start: args.start,
      end: args.end,
      allDay: Boolean(args.allDay),
      attendees: args.attendees,
    })
    await ingestCalendarEvents([ev])
    return toolJson({ ok: true, action, event: ev })
  }

  if (action === 'update') {
    if (!args.eventId) return '错误：update 需要 eventId'
    const patch = {}
    if (args.title) patch.title = args.title
    if (args.description) patch.description = args.description
    if (args.location) patch.location = args.location
    if (args.start) patch.start = args.start
    if (args.end) patch.end = args.end
    const ev = await updateEvent({ provider, id: args.eventId, patch, calendarId: args.calendarId })
    return toolJson({ ok: true, action, event: ev })
  }

  if (action === 'delete') {
    if (!args.eventId) return '错误：delete 需要 eventId'
    const r = await deleteEvent({ provider, id: args.eventId, calendarId: args.calendarId })
    return toolJson({ ok: r.ok, action, id: args.eventId })
  }

  return `错误：未知 action "${action}"`
}

// ── query_email 执行器 ────────────────────────────────────────────────────
export async function execQueryEmail(args = {}, context = {}) {
  const action = args.action
  const provider = args.provider || null
  if (!action) return '错误：未提供 action（list/search/get/send/mark_read）'

  if (action === 'list') {
    const emails = await listEmails({
      provider,
      folder: args.folder || 'INBOX',
      limit: Number(args.limit) || 20,
      unreadOnly: Boolean(args.unreadOnly),
    })
    await ingestEmails(emails)
    return toolJson({ ok: true, action, count: emails.length, emails })
  }

  if (action === 'search') {
    if (!args.query) return '错误：search 需要 query'
    const emails = await searchEmails({ provider, query: args.query, limit: Number(args.limit) || 20 })
    await ingestEmails(emails)
    return toolJson({ ok: true, action, count: emails.length, emails })
  }

  if (action === 'get') {
    if (!args.emailId) return '错误：get 需要 emailId'
    const em = await getEmail({ provider, id: args.emailId })
    await ingestEmails([em])
    return toolJson({ ok: true, action, email: em })
  }

  if (action === 'send') {
    if (!args.to || !args.subject) return '错误：send 需要 to + subject'
    const r = await sendEmail({
      provider,
      to: args.to,
      subject: args.subject,
      body: args.body || '',
      cc: args.cc ? args.cc.split(',').map((s) => s.trim()) : [],
      bcc: args.bcc ? args.bcc.split(',').map((s) => s.trim()) : [],
    })
    return toolJson({ ok: r.ok, action, sent: r })
  }

  if (action === 'mark_read') {
    if (!args.emailId) return '错误：mark_read 需要 emailId'
    const r = await markRead({ provider, id: args.emailId, read: args.read !== false })
    return toolJson({ ok: r.ok, action, id: args.emailId })
  }

  return `错误：未知 action "${action}"`
}

// ── query_tasks 执行器 ────────────────────────────────────────────────────
export async function execQueryTasks(args = {}, context = {}) {
  const action = args.action
  const provider = args.provider || null
  if (!action) return '错误：未提供 action（list_lists/list/create/update/complete/delete）'

  if (action === 'list_lists') {
    const lists = await listTaskLists({ provider })
    return toolJson({ ok: true, action, count: lists.length, lists })
  }

  if (action === 'list') {
    const tasks = await listTasks({
      provider,
      listId: args.listId,
      includeCompleted: Boolean(args.includeCompleted),
    })
    await ingestTasks(tasks)
    return toolJson({ ok: true, action, count: tasks.length, tasks })
  }

  if (action === 'create') {
    if (!args.title) return '错误：create 需要 title'
    const t = await createTask({
      provider,
      listId: args.listId,
      title: args.title,
      notes: args.notes,
      dueDate: args.dueDate,
      priority: args.priority,
      tags: args.tags,
    })
    await ingestTasks([t])
    return toolJson({ ok: true, action, task: t })
  }

  if (action === 'update') {
    if (!args.taskId) return '错误：update 需要 taskId'
    const patch = {}
    if (args.title) patch.title = args.title
    if (args.notes) patch.notes = args.notes
    if (args.dueDate) patch.dueDate = args.dueDate
    if (typeof args.completed === 'boolean') patch.completed = args.completed
    if (args.priority) patch.priority = args.priority
    const t = await updateTask({ provider, id: args.taskId, patch })
    return toolJson({ ok: true, action, task: t })
  }

  if (action === 'complete') {
    if (!args.taskId) return '错误：complete 需要 taskId'
    const t = await completeTask({ provider, id: args.taskId, completed: args.completed !== false })
    return toolJson({ ok: true, action, task: t })
  }

  if (action === 'delete') {
    if (!args.taskId) return '错误：delete 需要 taskId'
    const r = await deleteTask({ provider, id: args.taskId })
    return toolJson({ ok: r.ok, action, id: args.taskId })
  }

  return `错误：未知 action "${action}"`
}
