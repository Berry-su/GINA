// src/agentic/cron-orchestrator.js — 主动 agentic 编排核心（ADR-011 · Phase 3）
//
// 设计目标：
//   GINA 7×24 主动推信息：早报/晚报/监控/摘要/提醒/冲突检测。
//   LLM 能调 query_cron / run_cron；老板能手动 enable/disable；
//   cron 跑完自动 ingest L2 memory + pushMessage 推主对话。
//
// 设计原则（沿用 + 强化）：
//   - 单例 CronRegistry（Map<id, CronSpec>）
//   - 5 内置 cron 默认 enabled=false（老板手动 enable）
//   - 调度器：cron-parser 解析 + Node setInterval 每 60s 扫一次
//   - 时区：默认 Asia/Shanghai（GINA_TIMEZONE 覆盖）
//   - 幂等：同 id 同 minute_key 不重跑
//   - 单 cron isRunning 锁（避免长任务重叠）
//   - emotion-isolation 严守：handler 跑完只走事实通道，不触发 joy
//   - 失败可降级：handler 抛错 → emitEvent('cron_failed') + 继续下一轮
//
// 触发器（EventBus 模式）：
//   - calendar_event_soon (-15min 提醒)
//   - email_keyword (紧急/截止/老板/asap/urgent/deadline/今天/明天)
//   - task_completed (自动 follow-up)
//
// 5 个内置 cron：
//   morning_briefing   0 8 * * *           当日日程 + 未读邮件 + 任务
//   evening_summary    0 22 * * *          明日预览 + 今日完成 + 今日新 concept
//   stock_monitor      */30 9-15 * * 1-5   关注列表价格异动
//   email_summary      0 * * * *           新邮件摘要
//   calendar_conflict  0 6 * * *           当日冲突检测
//
// 安全约束：
//   - 不接真实账号除非 .env 显式配置（mock 优先）
//   - 不硬编码任何凭据
//   - 默认不连真实外部服务

import cronParser from 'cron-parser'
// cron-parser 5.x: parseExpression 已废弃，改用 CronExpressionParser.parse()
const { CronExpressionParser } = cronParser
function parseExpressionSafe(schedule, opts) {
  try { return CronExpressionParser.parse(schedule, opts) }
  catch (err) { throw err }
}
import { emitEvent } from '../events.js'
import { ingestCronRuns } from '../connectors/memory-bridge.js'

// ── Time helper（可注入 for testing） ──────────────────────────────────
let _now = () => new Date()
export function setMockTime(date) { _now = () => (date instanceof Date ? new Date(date) : new Date(date)) }
export function resetMockTime() { _now = () => new Date() }
export function now() { return _now() }

// ── CronSpec 数据结构 ──────────────────────────────────────────────────
/**
 * @typedef {Object} CronSpec
 * @property {string} id            - 唯一 id
 * @property {string} schedule      - 5-field cron 表达式（本地时区）
 * @property {string} description
 * @property {'briefing'|'monitor'|'summary'|'reminder'|'sync'} category
 * @property {(ctx: {triggeredBy: string}) => Promise<CronResult>} handler
 * @property {boolean} enabled       - 默认 false
 * @property {string|null} lastRun   - ISO 8601
 * @property {CronResult|null} lastResult
 * @property {string|null} nextRun   - ISO 8601
 * @property {boolean} isRunning     - 锁
 */

/**
 * @typedef {Object} CronResult
 * @property {boolean} ok
 * @property {string} summary
 * @property {Object} [details]
 * @property {{channels: string[], priority?: string}} [push]
 */

// ── 单例 CronRegistry ──────────────────────────────────────────────────
const _registry = new Map()
const _triggers = new Map()  // eventName → handler[]
const _triggeredLog = new Map()  // key → timestamp（去重）
const _TZ = process.env.GINA_TIMEZONE || 'Asia/Shanghai'

let _intervalHandle = null
const SCAN_INTERVAL_MS = 60_000  // 60s

// ── CronSpec 工具 ──────────────────────────────────────────────────────
export function calculateNextRun(schedule, fromDate = now()) {
  try {
    const interval = parseExpressionSafe(schedule, {
      currentDate: fromDate,
      tz: _TZ,
    })
    return interval.next().toDate().toISOString()
  } catch (err) {
    console.warn(`[cron-orchestrator] invalid schedule "${schedule}": ${err?.message || err}`)
    return null
  }
}

function minuteKey(date = now()) {
  // yyyy-mm-ddTHH:MM
  return _now().toISOString().slice(0, 16)
}

// ── 公开 API：注册 cron ─────────────────────────────────────────────────
export function registerCron(spec) {
  if (!spec || !spec.id) throw new Error('registerCron: id 必填')
  if (!spec.schedule) throw new Error('registerCron: schedule 必填')
  if (typeof spec.handler !== 'function') throw new Error('registerCron: handler 必填（async function）')

  const nextRun = calculateNextRun(spec.schedule)
  _registry.set(spec.id, {
    id: spec.id,
    schedule: spec.schedule,
    description: spec.description || '',
    category: spec.category || 'summary',
    handler: spec.handler,
    enabled: spec.enabled === true,  // 默认 false
    lastRun: null,
    lastResult: null,
    nextRun,
    isRunning: false,
  })
  emitEvent('cron_registered', { id: spec.id, schedule: spec.schedule, enabled: spec.enabled === true })
  return _registry.get(spec.id)
}

export function unregisterCron(id) {
  const existed = _registry.delete(id)
  if (existed) emitEvent('cron_unregistered', { id })
  return existed
}

export function listCrons() {
  return Array.from(_registry.values()).map((c) => ({
    id: c.id,
    schedule: c.schedule,
    description: c.description,
    category: c.category,
    enabled: c.enabled,
    lastRun: c.lastRun,
    lastResult: c.lastResult,
    nextRun: c.nextRun,
    isRunning: c.isRunning,
  }))
}

export function getCron(id) {
  const c = _registry.get(id)
  if (!c) return null
  return { ...c }
}

export function enableCron(id) {
  const c = _registry.get(id)
  if (!c) return { ok: false, error: `cron "${id}" not found` }
  c.enabled = true
  c.nextRun = calculateNextRun(c.schedule)
  emitEvent('cron_enabled', { id })
  return { ok: true, id, enabled: true, nextRun: c.nextRun }
}

export function disableCron(id) {
  const c = _registry.get(id)
  if (!c) return { ok: false, error: `cron "${id}" not found` }
  c.enabled = false
  emitEvent('cron_disabled', { id })
  return { ok: true, id, enabled: false }
}

export function enableAllCrons() {
  const out = []
  for (const c of _registry.values()) {
    c.enabled = true
    c.nextRun = calculateNextRun(c.schedule)
    out.push(c.id)
  }
  emitEvent('cron_all_enabled', { ids: out })
  return { ok: true, enabled: out }
}

export function disableAllCrons() {
  const out = []
  for (const c of _registry.values()) {
    c.enabled = false
    out.push(c.id)
  }
  emitEvent('cron_all_disabled', { ids: out })
  return { ok: true, disabled: out }
}

// ── 公开 API：跑 cron（手动 / 调度） ────────────────────────────────────
export async function runCron(id, { triggeredBy = 'manual', force = false } = {}) {
  const c = _registry.get(id)
  if (!c) return { ok: false, error: `cron "${id}" not found` }
  if (c.isRunning) return { ok: false, error: `cron "${id}" 已在跑（isRunning）` }

  const startAt = now()
  const key = `${id}:${minuteKey()}`
  if (!force && c.lastRun && `${id}:${c.lastRun.slice(0, 16)}` === key) {
    return { ok: false, error: `cron "${id}" 在同分钟内已跑过（幂等）` }
  }

  c.isRunning = true
  emitEvent('cron_started', { id, triggeredBy, runAt: startAt.toISOString() })

  let result = null
  let error = null
  try {
    result = await c.handler({ triggeredBy, runAt: startAt.toISOString() })
    if (!result || typeof result !== 'object') {
      result = { ok: true, summary: 'completed' }
    }
  } catch (err) {
    error = err
    result = { ok: false, summary: 'handler failed', error: err?.message || String(err) }
    console.warn(`[cron-orchestrator] cron "${id}" handler failed:`, err?.message || err)
  } finally {
    c.isRunning = false
    c.lastRun = startAt.toISOString()
    c.lastResult = result
    c.nextRun = calculateNextRun(c.schedule)
  }

  // 跑完后续：ingest + 推 + 事件
  try {
    await ingestCronRuns([{
      id: c.id,
      runAt: c.lastRun,
      ok: result.ok,
      summary: result.summary,
      category: c.category,
      durationMs: now() - startAt,
      triggeredBy,
    }])
  } catch (err) {
    console.warn(`[cron-orchestrator] ingestCronRuns failed for "${id}":`, err?.message || err)
  }

  if (result.push && result.push.channels && result.push.channels.length > 0) {
    await pushToChannels(result, c)
  }

  emitEvent(result.ok ? 'cron_completed' : 'cron_failed', {
    id,
    ok: result.ok,
    summary: result.summary,
    error: error?.message,
    triggeredBy,
    runAt: c.lastRun,
    durationMs: now() - startAt,
  })

  return { ok: result.ok, ...result, id, runAt: c.lastRun }
}

// ── 推送通道（轻量；不依赖 pushMessage 完整实现） ──────────────────────
async function pushToChannels(result, cron) {
  // Phase 3 简化：只 emit event（不直接调 pushMessage，避免破主对话）
  // 真实推送由上层 orchestrator 监听 cron_completed 事件后调 pushMessage
  emitEvent('cron_push', {
    cronId: cron.id,
    category: cron.category,
    summary: result.summary,
    channels: result.push.channels,
    priority: result.push.priority || 'normal',
  })
}

// ── 调度器 ──────────────────────────────────────────────────────────────
export function startScheduler() {
  if (_intervalHandle) return { ok: false, error: 'scheduler already running' }
  _intervalHandle = setInterval(() => {
    _tick().catch((err) => console.warn('[cron-orchestrator] tick error:', err?.message || err))
  }, SCAN_INTERVAL_MS)
  // 立即跑一次 _tick 让 nextRun 正确刷新
  _tick().catch(() => {})
  emitEvent('scheduler_started', { intervalMs: SCAN_INTERVAL_MS, timezone: _TZ })
  return { ok: true, intervalMs: SCAN_INTERVAL_MS, timezone: _TZ }
}

export function stopScheduler() {
  if (!_intervalHandle) return { ok: false, error: 'scheduler not running' }
  clearInterval(_intervalHandle)
  _intervalHandle = null
  emitEvent('scheduler_stopped', {})
  return { ok: true }
}

export function isSchedulerRunning() { return _intervalHandle !== null }

async function _tick() {
  const nowDate = now()
  for (const c of _registry.values()) {
    if (!c.enabled || c.isRunning) continue
    if (!c.nextRun) {
      c.nextRun = calculateNextRun(c.schedule, nowDate)
      continue
    }
    if (new Date(c.nextRun).getTime() <= nowDate.getTime()) {
      // 该跑了（async，不 await，避免一个慢 cron 阻塞 tick）
      runCron(c.id, { triggeredBy: 'schedule' }).catch((err) =>
        console.warn(`[cron-orchestrator] runCron "${c.id}" tick failed:`, err?.message || err),
      )
    }
  }
}

// ── 触发器 EventBus ────────────────────────────────────────────────────
export function registerTrigger(eventName, handler) {
  if (!eventName || typeof handler !== 'function') return { ok: false, error: 'invalid trigger' }
  if (!_triggers.has(eventName)) _triggers.set(eventName, [])
  _triggers.get(eventName).push(handler)
  return { ok: true, eventName, handlerCount: _triggers.get(eventName).length }
}

export function unregisterTrigger(eventName, handler) {
  const list = _triggers.get(eventName)
  if (!list) return { ok: false, error: `no triggers for "${eventName}"` }
  const idx = list.indexOf(handler)
  if (idx < 0) return { ok: false, error: 'handler not found' }
  list.splice(idx, 1)
  return { ok: true }
}

export function listTriggers() {
  const out = {}
  for (const [k, v] of _triggers.entries()) out[k] = v.length
  return out
}

/**
 * Emit a trigger event. Calls all registered handlers (best-effort).
 * 去重：同 triggerKey 24h 内只触发 1 次。
 */
export async function emitTrigger(eventName, payload = {}, { dedupeKey = null, dedupeTtlMs = 24 * 3600_000 } = {}) {
  // 去重检查
  if (dedupeKey) {
    const last = _triggeredLog.get(dedupeKey)
    if (last && (now().getTime() - last) < dedupeTtlMs) {
      return { ok: false, deduped: true, dedupeKey }
    }
    _triggeredLog.set(dedupeKey, now().getTime())
  }

  emitEvent(`trigger.${eventName}`, payload)

  const handlers = _triggers.get(eventName) || []
  const results = []
  for (const h of handlers) {
    try {
      const r = await h(payload)
      results.push({ ok: true, result: r })
    } catch (err) {
      results.push({ ok: false, error: err?.message || String(err) })
      console.warn(`[cron-orchestrator] trigger "${eventName}" handler failed:`, err?.message || err)
    }
  }
  return { ok: true, eventName, handlerCount: handlers.length, results }
}

// 清除 trigger dedupe log（测试用）
export function clearTriggerDedupe() { _triggeredLog.clear() }

// ── 5 个内置 cron handler ──────────────────────────────────────────────
// 设计原则：
//   - handler 跑完只走事实通道
//   - 不调 joy（emotion-isolation 严守）
//   - 不依赖主对话（即使 GINA 在 sleep 也能跑）
//   - 依赖 Phase 2 的 connector（calendar/email/tasks）+ memory-bridge

async function morningBriefingHandler({ triggeredBy }) {
  let calendar = [], email = [], tasks = []
  try {
    const { listEvents } = await import('../connectors/calendar.js')
    const start = now()
    const end = new Date(start.getTime() + 24 * 3600_000)
    calendar = await listEvents({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() }).catch(() => [])
  } catch { /* mock or missing */ }
  try {
    const { listEmails } = await import('../connectors/email.js')
    email = await listEmails({ folder: 'INBOX', limit: 20, unreadOnly: true }).catch(() => [])
  } catch { /* mock or missing */ }
  try {
    const { listTasks } = await import('../connectors/tasks.js')
    tasks = await listTasks({ includeCompleted: false }).catch(() => [])
  } catch { /* mock or missing */ }

  const summary = `今日 ${calendar.length} 个会 + ${email.length} 封未读邮件 + ${tasks.length} 个待办`
  return {
    ok: true,
    summary,
    details: { calendar, email, tasks },
    push: { channels: ['main_chat', 'scene_card'], priority: 'normal' },
  }
}

async function eveningSummaryHandler({ triggeredBy }) {
  let tomorrow = [], completed = []
  try {
    const { listEvents } = await import('../connectors/calendar.js')
    const start = new Date(now().getTime() + 24 * 3600_000)
    const end = new Date(start.getTime() + 24 * 3600_000)
    tomorrow = await listEvents({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() }).catch(() => [])
  } catch {}
  try {
    const { listTasks } = await import('../connectors/tasks.js')
    completed = await listTasks({ includeCompleted: true }).catch(() => [])
  } catch {}

  const summary = `明日 ${tomorrow.length} 个安排 + 今日 ${completed.length} 个任务状态`
  return {
    ok: true,
    summary,
    details: { tomorrow, completed },
    push: { channels: ['main_chat'], priority: 'low' },
  }
}

async function stockMonitorHandler({ triggeredBy }) {
  // Phase 3 简化：尝试接 finance-data-engine 已有 scheduler；缺则返回占位
  let alerts = []
  try {
    const finance = await import('../finance-data-engine/index.js').catch(() => null)
    if (finance?.runPriceMonitor) {
      alerts = await finance.runPriceMonitor({ thresholdPct: 5 })
    }
  } catch { /* finance 模块可能不可用或无 watchlist */ }

  return {
    ok: true,
    summary: alerts.length > 0 ? `${alerts.length} 个关注股票价格异动` : '无异动',
    details: { alerts },
    push: { channels: alerts.length > 0 ? ['main_chat'] : [], priority: 'normal' },
  }
}

async function emailSummaryHandler({ triggeredBy }) {
  let emails = []
  try {
    const { listEmails } = await import('../connectors/email.js')
    emails = await listEmails({ folder: 'INBOX', limit: 10, unreadOnly: true }).catch(() => [])
  } catch {}
  return {
    ok: true,
    summary: `${emails.length} 封新邮件`,
    details: { emails },
    push: { channels: emails.length > 0 ? ['main_chat'] : [], priority: 'low' },
  }
}

async function calendarConflictHandler({ triggeredBy }) {
  let events = []
  try {
    const { listEvents } = await import('../connectors/calendar.js')
    const start = now()
    const end = new Date(start.getTime() + 24 * 3600_000)
    events = await listEvents({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() }).catch(() => [])
  } catch {}
  // 简单冲突检测：同时间段 > 1 个 event
  const conflicts = []
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j]
      if (a.start && b.start && a.end && b.end) {
        const aStart = new Date(a.start).getTime()
        const aEnd = new Date(a.end).getTime()
        const bStart = new Date(b.start).getTime()
        const bEnd = new Date(b.end).getTime()
        if (aStart < bEnd && bStart < aEnd) {
          conflicts.push([a, b])
        }
      }
    }
  }
  return {
    ok: true,
    summary: conflicts.length > 0 ? `检测到 ${conflicts.length} 个时段冲突` : '无冲突',
    details: { events, conflicts },
    push: { channels: conflicts.length > 0 ? ['main_chat', 'scene_card'] : [], priority: 'normal' },
  }
}

// ── 3 个内置 trigger handler ──────────────────────────────────────────
const EMAIL_KEYWORDS = ['紧急', '截止', '老板', 'asap', 'urgent', 'deadline', '今天', '明天', '今晚', '马上']

function makeEmailKeywordTriggerHandler() {
  return async (payload = {}) => {
    const email = payload.email
    if (!email) return { ok: false, error: 'no email payload' }
    const text = `${email.subject || ''} ${email.snippet || ''} ${email.body || ''}`.toLowerCase()
    const matched = EMAIL_KEYWORDS.filter((kw) => text.includes(kw.toLowerCase()))
    if (matched.length === 0) return { ok: true, matched: false }
    return {
      ok: true,
      matched: true,
      keywords: matched,
      summary: `邮件"${email.subject}"命中关键词：${matched.join('、')}`,
    }
  }
}

function makeCalendarSoonTriggerHandler() {
  return async (payload = {}) => {
    const event = payload.event
    if (!event) return { ok: false, error: 'no event payload' }
    const start = new Date(event.start).getTime()
    const diffMin = Math.round((start - now().getTime()) / 60_000)
    if (diffMin < 0 || diffMin > 15) return { ok: true, inRange: false, diffMin }
    return {
      ok: true,
      inRange: true,
      diffMin,
      summary: `会议"${event.title}"还有 ${diffMin} 分钟开始`,
    }
  }
}

function makeTaskCompletedTriggerHandler() {
  return async (payload = {}) => {
    const task = payload.task
    if (!task) return { ok: false, error: 'no task payload' }
    return {
      ok: true,
      summary: `任务"${task.title}"已完成`,
      followUp: task.dueDate ? null : '是否要补设置截止时间？',
    }
  }
}

// ── 内置 cron 注册（默认 enabled=false） ────────────────────────────────
export function registerBuiltinCrons() {
  registerCron({
    id: 'morning_briefing',
    schedule: '0 8 * * *',
    description: '每天 8:00 早报：当日日程 + 未读邮件 + 任务',
    category: 'briefing',
    enabled: false,
    handler: morningBriefingHandler,
  })
  registerCron({
    id: 'evening_summary',
    schedule: '0 22 * * *',
    description: '每天 22:00 晚报：明日预览 + 今日完成',
    category: 'briefing',
    enabled: false,
    handler: eveningSummaryHandler,
  })
  registerCron({
    id: 'stock_monitor',
    schedule: '*/30 9-15 * * 1-5',
    description: '工作日 9-15 点每 30 分钟监控关注股票价格异动',
    category: 'monitor',
    enabled: false,
    handler: stockMonitorHandler,
  })
  registerCron({
    id: 'email_summary',
    schedule: '0 * * * *',
    description: '每小时整点邮件摘要',
    category: 'summary',
    enabled: false,
    handler: emailSummaryHandler,
  })
  registerCron({
    id: 'calendar_conflict',
    schedule: '0 6 * * *',
    description: '每天 6:00 检测当日日历冲突',
    category: 'reminder',
    enabled: false,
    handler: calendarConflictHandler,
  })
}

export function registerBuiltinTriggers() {
  registerTrigger('calendar_event_soon', makeCalendarSoonTriggerHandler())
  registerTrigger('email_keyword', makeEmailKeywordTriggerHandler())
  registerTrigger('task_completed', makeTaskCompletedTriggerHandler())
}

// ── 状态 ───────────────────────────────────────────────────────────────
export function getOrchestratorStatus() {
  return {
    ok: true,
    schedulerRunning: isSchedulerRunning(),
    timezone: _TZ,
    cronCount: _registry.size,
    enabledCount: Array.from(_registry.values()).filter((c) => c.enabled).length,
    triggerCount: Array.from(_triggers.values()).reduce((a, b) => a + b.length, 0),
    scanIntervalMs: SCAN_INTERVAL_MS,
  }
}

// ── 一次性 bootstrap（供 index.js / api.js 在启动时调） ─────────────────
let _bootstrapped = false
export function bootstrapAgentic() {
  if (_bootstrapped) return { ok: true, alreadyBootstrapped: true }
  registerBuiltinCrons()
  registerBuiltinTriggers()
  _bootstrapped = true
  emitEvent('agentic_bootstrapped', { cronCount: _registry.size, triggerCount: _triggers.size })
  return { ok: true, bootstrapped: true, cronCount: _registry.size, triggerCount: _triggers.size }
}

export function resetAgentic() {
  if (isSchedulerRunning()) stopScheduler()
  _registry.clear()
  _triggers.clear()
  _triggeredLog.clear()
  _bootstrapped = false
}

export const __test = {
  _registry,
  _triggers,
  _triggeredLog,
  calculateNextRun,
  minuteKey,
  EMAIL_KEYWORDS,
  morningBriefingHandler,
  eveningSummaryHandler,
  stockMonitorHandler,
  emailSummaryHandler,
  calendarConflictHandler,
}
