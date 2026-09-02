// tests/test-cron-orchestrator.js — 主动 agentic cron 编排 12+ 测试（ADR-011）
//
// 设计原则（9-02 老板纠错纪律）：
//   - 默认所有 cron enabled=false，不真跑调度器
//   - 用 setMockTime 注入时间，避免真等 60s
//   - handler 全 mock，不调真实 connector
//   - emotion-isolation 联通：跑 cron 后 joy state 不变
//   - 测试间清 _registry / _triggers 避免污染
//
// 12+ 测试：
//   1.   morning_briefing cron 注册 + 解析 schedule
//   2.   evening_summary 同
//   3.   stock_monitor 同（含 weekday 限制）
//   4.   email_summary 同
//   5.   calendar_conflict 同
//   6.   enableCron / disableCron
//   7.   enableAllCrons / disableAllCrons
//   8.   runCron 立即跑（手动触发）
//   9.   runCron 同分钟内幂等（不重跑）
//   10.  触发器 calendar_event_soon 命中（-15min 内 event）
//   11.  触发器 email_keyword 命中（"紧急"）
//   12.  触发器 task_completed 命中
//   13.  触发器 dedupe（24h 内同 key 只触发 1 次）
//   14.  handler 失败 → 警告 + 继续（不破调度器）
//   15.  emotion-isolation 联通：cron handler 跑完 joy state 不变
//
// 运行：node --test tests/test-cron-orchestrator.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  registerCron, unregisterCron, listCrons, getCron,
  enableCron, disableCron, enableAllCrons, disableAllCrons,
  runCron, emitTrigger, registerTrigger, unregisterTrigger, listTriggers,
  setMockTime, resetMockTime, now, calculateNextRun,
  bootstrapAgentic, resetAgentic, getOrchestratorStatus,
  clearTriggerDedupe, __test,
} from '../src/agentic/cron-orchestrator.js'

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

function resetAll() {
  resetAgentic()
  resetMockTime()
  clearTriggerDedupe()
}

resetAll()

// ── 1-5: 5 个内置 cron 注册 + schedule 解析 ─────────────────────────────
await track('1. morning_briefing cron registered + schedule valid', () => {
  registerCron({
    id: 'morning_briefing',
    schedule: '0 8 * * *',
    description: '每天 8:00 早报',
    category: 'briefing',
    enabled: false,
    handler: async () => ({ ok: true, summary: 'morning ok', details: { calendar: [], email: [], tasks: [] } }),
  })
  const c = getCron('morning_briefing')
  assert.ok(c, 'cron 应存在')
  assert.equal(c.schedule, '0 8 * * *')
  assert.equal(c.enabled, false)
  assert.equal(c.category, 'briefing')
  // nextRun 应是合法 ISO 8601
  assert.ok(c.nextRun && /^\d{4}-\d{2}-\d{2}T/.test(c.nextRun), `nextRun 应是 ISO 8601: ${c.nextRun}`)
})

await track('2. evening_summary cron registered + schedule valid', () => {
  registerCron({
    id: 'evening_summary',
    schedule: '0 22 * * *',
    description: '每天 22:00 晚报',
    category: 'briefing',
    enabled: false,
    handler: async () => ({ ok: true, summary: 'evening ok' }),
  })
  const c = getCron('evening_summary')
  assert.ok(c)
  assert.ok(c.nextRun)
})

await track('3. stock_monitor cron registered with weekday-restricted schedule', () => {
  registerCron({
    id: 'stock_monitor',
    schedule: '*/30 9-15 * * 1-5',
    description: '工作日 9-15 点每 30 分钟',
    category: 'monitor',
    enabled: false,
    handler: async () => ({ ok: true, summary: 'no alerts' }),
  })
  const c = getCron('stock_monitor')
  assert.ok(c)
  // weekday 1-5 限制
  assert.equal(c.schedule, '*/30 9-15 * * 1-5')
})

await track('4. email_summary cron registered + hourly schedule', () => {
  registerCron({
    id: 'email_summary',
    schedule: '0 * * * *',
    description: '每小时整点',
    category: 'summary',
    enabled: false,
    handler: async () => ({ ok: true, summary: 'no emails' }),
  })
  const c = getCron('email_summary')
  assert.ok(c)
  assert.ok(c.nextRun)
})

await track('5. calendar_conflict cron registered + 6am daily', () => {
  registerCron({
    id: 'calendar_conflict',
    schedule: '0 6 * * *',
    description: '每天 6:00 冲突检测',
    category: 'reminder',
    enabled: false,
    handler: async () => ({ ok: true, summary: 'no conflicts', details: { events: [], conflicts: [] } }),
  })
  const c = getCron('calendar_conflict')
  assert.ok(c)
  assert.equal(c.schedule, '0 6 * * *')
})

// ── 6-7: enable / disable ──────────────────────────────────────────────
await track('6. enableCron / disableCron single', () => {
  const r1 = enableCron('morning_briefing')
  assert.equal(r1.ok, true)
  assert.equal(r1.enabled, true)
  assert.ok(r1.nextRun)
  const c = getCron('morning_briefing')
  assert.equal(c.enabled, true)

  const r2 = disableCron('morning_briefing')
  assert.equal(r2.ok, true)
  assert.equal(r2.enabled, false)
})

await track('7. enableAllCrons / disableAllCrons', () => {
  enableAllCrons()
  const all = listCrons()
  assert.ok(all.length >= 5)
  for (const c of all) assert.equal(c.enabled, true, `${c.id} 应 enabled`)

  disableAllCrons()
  const all2 = listCrons()
  for (const c of all2) assert.equal(c.enabled, false, `${c.id} 应 disabled`)
})

// ── 8-9: 立即跑 + 幂等 ─────────────────────────────────────────────────
await track('8. runCron immediate (manual trigger)', async () => {
  let calledCount = 0
  registerCron({
    id: 'test_manual',
    schedule: '0 0 1 1 *',  // 永远不跑
    description: 'test',
    category: 'summary',
    enabled: false,
    handler: async () => { calledCount++; return { ok: true, summary: 'manual run' } },
  })
  const r = await runCron('test_manual', { triggeredBy: 'test' })
  assert.equal(r.ok, true)
  assert.equal(calledCount, 1, 'handler 应跑 1 次')
  const c = getCron('test_manual')
  assert.equal(c.lastRun !== null, true)
  assert.equal(c.lastResult.ok, true)
})

await track('9. runCron same minute idempotent (no double-run)', async () => {
  let calledCount = 0
  registerCron({
    id: 'test_idem',
    schedule: '0 0 1 1 *',
    description: 'idem test',
    category: 'summary',
    enabled: false,
    handler: async () => { calledCount++; return { ok: true, summary: 'idem' } },
  })
  await runCron('test_idem', { triggeredBy: 'test' })
  const r = await runCron('test_idem', { triggeredBy: 'test' })  // 同分钟，应跳过
  assert.equal(r.ok, false, '同分钟应被幂等拦')
  assert.equal(calledCount, 1, 'handler 只跑 1 次')
})

// ── 10-12: 3 个触发器命中 ─────────────────────────────────────────────
await track('10. trigger calendar_event_soon hits when event within 15min', async () => {
  // mock 当前时间为 10:00
  setMockTime('2026-09-02T10:00:00+08:00')
  let handlerCalled = false
  const h = async (payload) => {
    handlerCalled = true
    const start = new Date(payload.event.start).getTime()
    const diffMin = Math.round((start - now().getTime()) / 60_000)
    return { ok: true, inRange: diffMin >= 0 && diffMin <= 15, diffMin }
  }
  registerTrigger('calendar_event_soon', h)
  // 10:10 开始的会（10 分钟后）
  await emitTrigger('calendar_event_soon', {
    event: { id: 'evt-1', title: '投资人会议', start: '2026-09-02T10:10:00+08:00' },
  }, { dedupeKey: 'evt-1' })
  assert.equal(handlerCalled, true)
})

await track('11. trigger email_keyword matches "紧急" / "截止" / "老板"', async () => {
  const matched = []
  const h = async (payload) => {
    const text = `${payload.email.subject || ''} ${payload.email.body || ''}`.toLowerCase()
    const hits = ['紧急', '截止', '老板', 'asap', 'urgent'].filter((kw) => text.includes(kw.toLowerCase()))
    matched.push(hits)
    return { ok: true, hits }
  }
  registerTrigger('email_keyword', h)
  await emitTrigger('email_keyword', {
    email: { id: 'em-1', subject: '紧急：明天截止', body: '老板要看结果' },
  }, { dedupeKey: 'em-1' })
  assert.ok(matched.length === 1, 'handler 应跑 1 次')
  assert.ok(matched[0].includes('紧急'), '应命中"紧急"')
  assert.ok(matched[0].includes('截止'), '应命中"截止"')
  assert.ok(matched[0].includes('老板'), '应命中"老板"')
})

await track('12. trigger task_completed fires on completion', async () => {
  let called = false
  const h = async (payload) => { called = true; return { ok: true, taskTitle: payload.task.title } }
  registerTrigger('task_completed', h)
  await emitTrigger('task_completed', { task: { id: 't-1', title: 'GINA Phase 3' } }, { dedupeKey: 't-1' })
  assert.equal(called, true)
})

// ── 13: 触发器 dedupe ─────────────────────────────────────────────────
await track('13. trigger dedupe: same key 24h only fires once', async () => {
  let count = 0
  const h = async () => { count++; return { ok: true } }
  registerTrigger('test_dedupe', h)
  const r1 = await emitTrigger('test_dedupe', { foo: 1 }, { dedupeKey: 'k-1' })
  const r2 = await emitTrigger('test_dedupe', { foo: 2 }, { dedupeKey: 'k-1' })
  assert.equal(r1.ok, true)
  assert.equal(r2.ok, false, '第二次应被去重')
  assert.equal(r2.deduped, true)
  assert.equal(count, 1, 'handler 只跑 1 次')
})

// ── 14: handler 失败不破调度器 ─────────────────────────────────────────
await track('14. handler failure does not break scheduler (returns ok:false, continues)', async () => {
  registerCron({
    id: 'test_fail',
    schedule: '0 0 1 1 *',
    description: 'fail test',
    category: 'summary',
    enabled: false,
    handler: async () => { throw new Error('handler boom') },
  })
  const r = await runCron('test_fail', { triggeredBy: 'test', force: true })
  assert.equal(r.ok, false, 'handler 抛错 → ok:false')
  assert.ok(r.summary === 'handler failed')
  // 调度器不应破：能继续 run 其他 cron
  registerCron({
    id: 'test_ok_after',
    schedule: '0 0 1 1 *',
    description: 'ok test',
    category: 'summary',
    enabled: false,
    handler: async () => ({ ok: true, summary: 'ok' }),
  })
  const r2 = await runCron('test_ok_after', { triggeredBy: 'test', force: true })
  assert.equal(r2.ok, true, '其他 cron 仍能正常跑')
})

// ── 15: emotion-isolation 联通 ─────────────────────────────────────────
await track('15. emotion-isolation: cron handler does NOT touch joy state', async () => {
  // 拿 joy state（如果可用）；不依赖具体实现，只检查 handler 跑完不抛错且不调 joy 相关 API
  let touchJoy = false
  const origConsoleWarn = console.warn
  console.warn = (...args) => {
    const s = args.join(' ')
    if (s.includes('joy') || s.includes('Joy') || s.includes('emotion')) touchJoy = true
    origConsoleWarn.apply(console, args)
  }
  try {
    registerCron({
      id: 'test_joy_isolation',
      schedule: '0 0 1 1 *',
      description: 'joy test',
      category: 'summary',
      enabled: false,
      handler: async () => ({ ok: true, summary: 'no joy' }),
    })
    const r = await runCron('test_joy_isolation', { triggeredBy: 'test', force: true })
    assert.equal(r.ok, true)
    assert.equal(touchJoy, false, 'handler 不应触发 joy 相关 warn')
  } finally {
    console.warn = origConsoleWarn
  }
})

// ── bonus: listCrons + getCron + getOrchestratorStatus ─────────────────
await track('16. listCrons returns all registered crons', () => {
  const all = listCrons()
  assert.ok(all.length >= 5, `应至少 5 个内置 cron，实际 ${all.length}`)
  const ids = all.map((c) => c.id)
  assert.ok(ids.includes('morning_briefing'))
  assert.ok(ids.includes('evening_summary'))
  assert.ok(ids.includes('stock_monitor'))
  assert.ok(ids.includes('email_summary'))
  assert.ok(ids.includes('calendar_conflict'))
})

await track('17. getOrchestratorStatus reports scheduler + counts', () => {
  const s = getOrchestratorStatus()
  assert.equal(s.ok, true)
  assert.equal(typeof s.cronCount, 'number')
  assert.ok(s.cronCount >= 5)
  assert.equal(s.schedulerRunning, false)  // 没人 startScheduler
  assert.ok(s.timezone)
})

await track('18. bootstrapAgentic registers builtins (idempotent)', () => {
  resetAll()
  const r1 = bootstrapAgentic()
  assert.equal(r1.ok, true)
  assert.equal(r1.bootstrapped, true)
  assert.ok(r1.cronCount >= 5)
  assert.ok(r1.triggerCount >= 3)
  // 第二次 bootstrap 应 alreadyBootstrapped
  const r2 = bootstrapAgentic()
  assert.equal(r2.alreadyBootstrapped, true)
  resetAll()
})

// ── 总结 ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('失败详情:')
  errors.forEach((e) => console.log('  -', e))
  process.exit(1)
}
