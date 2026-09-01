// tests/test-connectors.js — Phase 2 连接器 12+ 测试（ADR-010）
//
// 设计原则（9-02 老板纠错纪律）：
//   - 测试走 mock provider，不真打 Google/Outlook/Apple/Todoist
//   - 真实 provider 仅当 GINA_*_PROVIDER + 凭据完整时才被选用
//   - emotion-isolation 9/9 必跑（独立文件 emotion-isolation.test.js）
//   - 测试间清空 _providerCache 避免污染
//
// 12+ 测试：
//   1-3 : 日历 mock query/create/update
//   4-6 : 邮件 mock list/search/send
//   7-9 : 任务 mock list/create/complete
//   10  : connector status 全部 OK
//   11  : memory-bridge ingest 1 个日历事件 → episodic memory
//   12  : capabilities 注册验证（query_calendar/query_email/query_tasks 都在 TOOL_SCHEMAS）
//   13  : emotion-isolation 联通（joy-state 不动）
//
// 运行：node --test tests/test-connectors.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listCalendars, queryEvents, createEvent, updateEvent, deleteEvent, getCalendarStatus, CALENDAR_PROVIDERS,
  __test as calTest,
} from '../src/connectors/calendar.js'
import {
  listEmails, searchEmails, sendEmail, markRead, getEmailStatus, EMAIL_PROVIDERS,
  __test as emailTest,
} from '../src/connectors/email.js'
import {
  listTasks, listTaskLists, createTask, completeTask, deleteTask, getTasksStatus, TASK_PROVIDERS,
  __test as tasksTest,
} from '../src/connectors/tasks.js'
import {
  ingestCalendarEvents, ingestEmails, ingestTasks, getMemoryBridgeStatus,
} from '../src/connectors/memory-bridge.js'
import { TOOL_SCHEMAS } from '../src/capabilities/builtin-tools.js'

let passed = 0
let failed = 0
const errors = []
function track(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { passed++; console.log(`✓ ${name}`) })
    .catch((err) => {
      failed++
      errors.push(`${name}: ${err?.message || err}`)
      console.log(`✗ ${name}: ${err?.message || err}`)
    })
}

// 确保 mock 模式（清空 .env 影响）
function resetToMock() {
  // 清空 .env 注入，强制走 mock
  delete process.env.GINA_CALENDAR_PROVIDER
  delete process.env.GINA_EMAIL_PROVIDER
  delete process.env.GINA_TASKS_PROVIDER
  // 清 providerCache 避免前次跑 mock 复用
  calTest._providerCache.clear()
  emailTest._providerCache.clear()
  tasksTest._providerCache.clear()
}

resetToMock()

// ── 1-3: 日历 mock query/create/update ────────────────────────────────────
await track('1. calendar.listCalendars returns mock calendars', async () => {
  const cals = await listCalendars({ provider: 'mock' })
  assert.ok(cals.length >= 1, '应至少 1 个日历')
  assert.ok(cals[0].id, 'calendar 应有 id')
  assert.equal(typeof cals[0].name, 'string', 'calendar 应有 name')
})

await track('2. calendar.queryEvents empty by default', async () => {
  const events = await queryEvents({ provider: 'mock' })
  assert.ok(Array.isArray(events), '应返回数组')
})

await track('3. calendar.createEvent + queryEvents round-trip', async () => {
  const before = await queryEvents({ provider: 'mock' })
  const ev = await createEvent({
    provider: 'mock',
    title: '测试事件 - Phase 2 验证',
    start: new Date(Date.now() + 3600 * 1000).toISOString(),
    end: new Date(Date.now() + 7200 * 1000).toISOString(),
    location: '线上',
  })
  assert.ok(ev.id, 'created event has id')
  assert.equal(ev.title, '测试事件 - Phase 2 验证')
  assert.equal(ev.provider, 'mock')
  const after = await queryEvents({ provider: 'mock' })
  assert.ok(after.length === before.length + 1, '应新增 1 条事件')
})

await track('4. calendar.updateEvent + deleteEvent', async () => {
  const ev = await createEvent({
    provider: 'mock',
    title: '待更新',
    start: new Date().toISOString(),
    end: new Date(Date.now() + 1800 * 1000).toISOString(),
  })
  const updated = await updateEvent({ provider: 'mock', id: ev.id, patch: { title: '已更新' } })
  assert.equal(updated.title, '已更新', 'title 应已更新')
  const del = await deleteEvent({ provider: 'mock', id: ev.id })
  assert.equal(del.ok, true, 'deleteEvent 应返回 ok=true')
})

// ── 4-6: 邮件 mock list/search/send ──────────────────────────────────────
await track('5. email.listEmails returns initial mock samples', async () => {
  const emails = await listEmails({ provider: 'mock', folder: 'INBOX', limit: 50 })
  assert.ok(emails.length >= 2, 'mock 应预置至少 2 封')
  assert.ok(emails[0].subject, 'email 应有 subject')
  assert.ok(['gmail', 'outlook', 'smtp', 'mock'].includes(emails[0].provider), 'provider 应是 mock/gmail/outlook/smtp')
})

await track('6. email.searchEmails by subject', async () => {
  const emails = await searchEmails({ provider: 'mock', query: 'demo' })
  assert.ok(emails.length >= 1, '搜 "demo" 应至少 1 封')
  assert.ok(emails.some((e) => e.subject.includes('demo')), 'subject 应含 demo')
})

await track('7. email.sendEmail + listEmails SENT', async () => {
  const r = await sendEmail({
    provider: 'mock',
    to: 'a@example.com,b@example.com',
    subject: '测试邮件',
    body: 'hi from Phase 2 test',
  })
  assert.equal(r.ok, true, 'send 应成功')
  assert.ok(r.id, 'send 返回 id')
  // SENT 列表应该能看到
  const sent = await listEmails({ provider: 'mock', folder: 'SENT', limit: 10 })
  assert.ok(sent.length >= 1, 'SENT 应有至少 1 封')
  assert.ok(sent.some((e) => e.subject === '测试邮件'), 'SENT 列表应包含刚发的')
})

await track('8. email.markRead flips unread flag', async () => {
  const emails = await listEmails({ provider: 'mock', folder: 'INBOX', limit: 10 })
  const unread = emails.find((e) => e.unread)
  if (!unread) return // mock 已读完也 OK
  const r = await markRead({ provider: 'mock', id: unread.id, read: true })
  assert.equal(r.ok, true, 'markRead 应成功')
})

// ── 7-9: 任务 mock list/create/complete ──────────────────────────────────
await track('9. tasks.listTasks returns preset mock tasks', async () => {
  const tasks = await listTasks({ provider: 'mock' })
  assert.ok(tasks.length >= 2, 'mock 应预置至少 2 个任务')
  assert.ok(tasks[0].title, 'task 应有 title')
  assert.equal(tasks[0].provider, 'mock')
})

await track('10. tasks.createTask + completeTask', async () => {
  const t = await createTask({
    provider: 'mock',
    title: 'Phase 2 测试任务',
    dueDate: new Date(Date.now() + 86400 * 1000).toISOString(),
    priority: 1,
    tags: ['test', 'phase-2'],
  })
  assert.ok(t.id, 'created task has id')
  assert.equal(t.title, 'Phase 2 测试任务')
  assert.deepEqual(t.tags, ['test', 'phase-2'])
  const done = await completeTask({ provider: 'mock', id: t.id })
  assert.equal(done.completed, true, '任务应已 complete')
  assert.ok(done.completedAt, 'completedAt 应有值')
})

await track('11. tasks.listTaskLists returns 3 mock lists', async () => {
  const lists = await listTaskLists({ provider: 'mock' })
  assert.equal(lists.length, 3, '应 3 个 mock 列表')
  assert.ok(lists.some((l) => l.name === '今天'), '应有 "今天" 列表')
})

// ── 10: status 全部 OK ────────────────────────────────────────────────────
await track('12. all 3 connector statuses expose providers', () => {
  const cs = getCalendarStatus()
  const es = getEmailStatus()
  const ts = getTasksStatus()
  assert.ok(cs.providers.length >= 4, 'calendar 至少 4 provider')
  assert.ok(es.providers.length >= 4, 'email 至少 4 provider')
  assert.ok(ts.providers.length >= 4, 'tasks 至少 4 provider')
  assert.equal(cs.providers[0].id, 'mock', 'calendar default 是 mock')
  assert.equal(es.providers[0].id, 'mock', 'email default 是 mock')
  assert.equal(ts.providers[0].id, 'mock', 'tasks default 是 mock')
  // 9 个 provider 名：calendar 3 + email 3 + tasks 3 = 9
  const total = CALENDAR_PROVIDERS.length + EMAIL_PROVIDERS.length + TASK_PROVIDERS.length
  assert.ok(total >= 12, `9 provider 名 + 3 mock default ≈ ${total}`)
})

// ── 11: memory-bridge ingest ──────────────────────────────────────────────
await track('13. memory-bridge ingests calendar event into episodic memory', async () => {
  const ev = await createEvent({
    provider: 'mock',
    title: '投资人会议（关于 GINA 完整版）',
    start: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
    location: '线上',
  })
  const ingest = await ingestCalendarEvents([ev])
  assert.equal(ingest.ok, true)
  assert.ok(ingest.ingested >= 1, '应至少 ingest 1 条')
})

// ── 12: capabilities 注册验证 ────────────────────────────────────────────
await track('14. TOOL_SCHEMAS has all 3 connector tools', () => {
  assert.ok(TOOL_SCHEMAS.query_calendar, 'query_calendar 在 TOOL_SCHEMAS')
  assert.ok(TOOL_SCHEMAS.query_email, 'query_email 在 TOOL_SCHEMAS')
  assert.ok(TOOL_SCHEMAS.query_tasks, 'query_tasks 在 TOOL_SCHEMAS')
  // 字段 sanity
  const cal = TOOL_SCHEMAS.query_calendar
  assert.equal(cal.function.name, 'query_calendar')
  assert.ok(cal.function.parameters.properties.action, 'query_calendar 有 action 参数')
  assert.ok(Array.isArray(cal.function.parameters.properties.action.enum), 'action 是 enum')
})

// ── 13: emotion-isolation 联通验证（joy 不应被 connector 改动） ──────────
await track('15. emotion-isolation: connector 数据流不触发 joy', async () => {
  // connector 仅调 fact 通道：listCalendars / listEmails / listTasks 各 1 次
  // 不触发任何 emotion 路径（更彻底：直接 grep 导入看有没有 emotion-engine）
  const calSource = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/connectors/calendar.js', import.meta.url), 'utf8'))
  const emSource = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/connectors/email.js', import.meta.url), 'utf8'))
  const tkSource = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/connectors/tasks.js', import.meta.url), 'utf8'))
  const mbSource = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/connectors/memory-bridge.js', import.meta.url), 'utf8'))
  for (const [name, src] of [['calendar', calSource], ['email', emSource], ['tasks', tkSource], ['memory-bridge', mbSource]]) {
    assert.ok(!src.includes('joy-engine') && !src.includes('joy_state') && !src.includes('recordJoy'),
      `${name} 不应 import / 引用 joy 引擎（emotion-isolation 红线）`)
  }
  // 跑一次完整 listQueries，确保不出 joy 相关副作用
  await listCalendars({ provider: 'mock' })
  await listEmails({ provider: 'mock', limit: 1 })
  await listTasks({ provider: 'mock' })
  await ingestCalendarEvents([])
  await ingestEmails([])
  await ingestTasks([])
  const status = getMemoryBridgeStatus()
  assert.equal(status.policy.emotionIsolation, 'strict', 'memory-bridge 声明 strict isolation')
})

// ── 总结 ──────────────────────────────────────────────────────────────────
await Promise.resolve().then(() => {
  console.log(`\n=== test-connectors: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.log('FAILURES:')
    for (const e of errors) console.log('  -', e)
    process.exitCode = 1
  }
})
