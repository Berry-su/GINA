// src/agentic/iot-scenarios.js — IoT 场景触发引擎（ADR-012 · Phase 4）
//
// 设计目标：
//   老板到家/离家/睡眠/早起/语音 → 自动控制 IoT 设备（开灯/关灯/锁门/调温）
//   沿用 Phase 3 cron-orchestrator 的 registerCron / registerTrigger 模式
//   5 个内置场景默认 enabled=false（老板手动 enable 才跑）
//   dry-run 模式：首次跑发"即将 X" 通知，等老板确认
//   每次控制写 L2 episodic memory + iot-audit
//
// 设计原则（沿用 + 强化）：
//   - 单例 ScenarioRegistry（Map<id, ScenarioSpec>）
//   - 场景 DSL（JSON）含 trigger / condition / actions / dryRun / notify
//   - 触发器订阅：GPS / Wi-Fi / 日历 / cron / 语音 / 时间
//   - 失败可降级：单 action 失败不阻断后续（best-effort）
//   - emotion-isolation 严守：场景执行只走事实通道，不触发 joy 不进决策链路
//
// 5 个内置场景：
//   come_home         GPS < 100m (Phase 5 接入)         开灯 + 开空调 + 音乐
//   leave_home        GPS > 1km 持续 5min               关灯 + 锁门 + 空调 standby
//   sleep             cron 22:30 工作日                 渐关灯 + 空调睡眠模式
//   morning_routine   cron 07:00 工作日                 开灯 + 播 morning_briefing
//   voice_scene       voice "开灯" 等                   即时控制目标设备

import { controlHomekitDevice } from '../connectors/homekit.js'
import { controlMijiaDevice } from '../connectors/mijia.js'
import { controlMqttDevice } from '../connectors/mqtt.js'
import { ingestIoTDevices, ingestScenarioRuns } from '../connectors/memory-bridge.js'
import { auditControl, auditScenario } from '../connectors/iot-audit.js'
import { emitEvent } from '../events.js'

// ── Time helper（可注入 for testing） ──────────────────────────────────
let _now = () => new Date()
export function setMockTime(date) { _now = () => (date instanceof Date ? new Date(date) : new Date(date)) }
export function resetMockTime() { _now = () => new Date() }
export function now() { return _now() }

// ── ScenarioSpec 数据结构 ─────────────────────────────────────────────
/**
 * @typedef {Object} ScenarioAction
 * @property {string} deviceId
 * @property {string} action       - on_off / set_brightness / set_color_temp / set_color / set_temperature / set_fan_speed / set_volume / lock / pause / resume
 * @property {Object} params
 * @property {number} [delay=0]    - ms
 *
 * @typedef {Object} ScenarioSpec
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} triggerType  - gps | network | calendar | cron | voice | time | manual
 * @property {Object} triggerConfig
 * @property {Object} [condition]
 * @property {ScenarioAction[]} actions
 * @property {boolean} [enabled=false]
 * @property {boolean} [dryRun=true]
 * @property {{channels: string[], priority?: string}} [notify]
 * @property {string|null} [lastRun]
 * @property {{ok: boolean, summary: string} | null} [lastResult]
 * @property {number} [runCount=0]
 */

// ── 单例 ScenarioRegistry ────────────────────────────────────────────
const _registry = new Map()
const _triggers = new Map()         // triggerName → handler[]
const _triggeredLog = new Map()     // scenarioId + triggerKey → lastTriggeredAt（去重）
const _runHistory = new Map()       // scenarioId → Array<ScenarioRun>

const DEFAULT_DEDUPE_MS = 30_000   // 30s 同一触发不重跑
const DEFAULT_ACTION_TIMEOUT_MS = 8000  // 单 action 8s 超时

// ── 工具函数 ────────────────────────────────────────────────────────
function makeRunId(scenarioId) {
  return `${scenarioId}-${now().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`
}

function getProviderForDevice(deviceId) {
  if (!deviceId) return null
  if (deviceId.startsWith('homekit.')) return 'homekit'
  if (deviceId.startsWith('mijia.')) return 'mijia'
  if (deviceId.startsWith('mqtt.')) return 'mqtt'
  return null
}

async function controlByDeviceId(deviceId, action, params) {
  const provider = getProviderForDevice(deviceId)
  if (provider === 'homekit') return controlHomekitDevice({ id: deviceId, action, params })
  if (provider === 'mijia') return controlMijiaDevice({ id: deviceId, action, params })
  if (provider === 'mqtt') return controlMqttDevice({ id: deviceId, action, params })
  return { ok: false, error: `unknown provider for device ${deviceId}`, provider: 'unknown' }
}

// ── 5 个内置场景 ────────────────────────────────────────────────────
function buildDefaultScenarios() {
  return [
    {
      id: 'come_home',
      name: '回家',
      description: 'GPS 距离 < 100m → 开客厅主灯 + 开卧室空调 24 度 + 卧室灯 70%',
      triggerType: 'gps',
      triggerConfig: { event: 'home_arrived', geofenceId: 'home', maxDistance: 100 },
      condition: { timeRange: { from: '17:00', to: '23:59' } },
      actions: [
        { deviceId: 'homekit.light.living-room-01', action: 'on_off', params: { on: true }, delay: 0 },
        { deviceId: 'homekit.ac.bedroom-01', action: 'on_off', params: { on: true }, delay: 100 },
        { deviceId: 'homekit.ac.bedroom-01', action: 'set_temperature', params: { temperature: 24 }, delay: 200 },
        { deviceId: 'homekit.light.bedroom-01', action: 'set_brightness', params: { brightness: 70 }, delay: 300 },
      ],
      enabled: false,
      dryRun: true,
      notify: { channels: ['main_chat'], priority: 'normal' },
    },
    {
      id: 'leave_home',
      name: '离家',
      description: 'GPS 距离 > 1km 持续 5min → 关客厅主灯 + 关卧室灯 + 锁前门 + 空调 standby',
      triggerType: 'gps',
      triggerConfig: { event: 'home_left', geofenceId: 'home', minDistance: 1000, sustainMs: 300000 },
      condition: {},
      actions: [
        { deviceId: 'homekit.light.living-room-01', action: 'on_off', params: { on: false }, delay: 0 },
        { deviceId: 'homekit.light.bedroom-01', action: 'on_off', params: { on: false }, delay: 50 },
        { deviceId: 'homekit.lock.front-door-01', action: 'lock', params: { locked: true }, delay: 100 },
        { deviceId: 'homekit.ac.bedroom-01', action: 'on_off', params: { on: false }, delay: 150 },
      ],
      enabled: false,
      dryRun: true,
      notify: { channels: ['main_chat'], priority: 'normal' },
    },
    {
      id: 'sleep',
      name: '睡眠',
      description: 'cron 22:30 工作日 + 在家 → 卧室灯渐关 5min + 空调睡眠模式 26 度',
      triggerType: 'cron',
      triggerConfig: { schedule: '30 22 * * 1-5', event: 'iot:trigger:sleep' },
      condition: { isAtHome: true },
      actions: [
        { deviceId: 'homekit.light.bedroom-01', action: 'set_brightness', params: { brightness: 30 }, delay: 0 },
        { deviceId: 'homekit.light.bedroom-01', action: 'set_brightness', params: { brightness: 0 }, delay: 100 },
        { deviceId: 'homekit.ac.bedroom-01', action: 'set_temperature', params: { temperature: 26 }, delay: 200 },
      ],
      enabled: false,
      dryRun: false,
      notify: { channels: ['main_chat'], priority: 'low' },
    },
    {
      id: 'morning_routine',
      name: '早起',
      description: 'cron 07:00 工作日 + 在家 → 开卧室灯 + 触发 Phase 3 morning_briefing',
      triggerType: 'cron',
      triggerConfig: { schedule: '0 7 * * 1-5', event: 'iot:trigger:morning' },
      condition: { isAtHome: true },
      actions: [
        { deviceId: 'homekit.light.bedroom-01', action: 'on_off', params: { on: true }, delay: 0 },
        { deviceId: 'homekit.light.bedroom-01', action: 'set_brightness', params: { brightness: 70 }, delay: 50 },
        { deviceId: 'homekit.ac.bedroom-01', action: 'on_off', params: { on: true }, delay: 100 },
      ],
      enabled: false,
      dryRun: false,
      notify: { channels: ['main_chat'], priority: 'normal' },
    },
    {
      id: 'voice_scene',
      name: '语音场景',
      description: '语音 "开灯"/"关灯"/"锁门"/"空调 24 度" → 即时控制目标设备',
      triggerType: 'voice',
      triggerConfig: { phrases: ['开灯', '关灯', '锁门', '空调', '扫地', '暂停', '继续', '亮一点', '暗一点', 'turn on', 'turn off', 'lock'] },
      condition: {},
      actions: [], // 语音由 LLM 通过 control_iot 直接调；本场景仅占位 + 触发统计
      enabled: true, // 语音场景总是启用（仅跟踪）
      dryRun: false,
      notify: { channels: [] },
    },
  ]
}

function initDefaultScenarios() {
  for (const s of buildDefaultScenarios()) {
    if (!_registry.has(s.id)) {
      _registry.set(s.id, {
        ...s,
        lastRun: null,
        lastResult: null,
        runCount: 0,
      })
    }
  }
}

initDefaultScenarios()

// ── 公开 API：场景 CRUD ─────────────────────────────────────────────
export function listScenarios() {
  return [..._registry.values()].map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    triggerType: s.triggerType,
    enabled: Boolean(s.enabled),
    dryRun: Boolean(s.dryRun),
    actionsCount: s.actions.length,
    lastRun: s.lastRun,
    lastResult: s.lastResult,
    runCount: s.runCount || 0,
  }))
}

export function getScenario(id) {
  const s = _registry.get(id)
  if (!s) return null
  return { ...s, actions: s.actions.map((a) => ({ ...a })) }
}

export function enableScenario(id) {
  const s = _registry.get(id)
  if (!s) return { ok: false, error: `scenario "${id}" not found` }
  s.enabled = true
  return { ok: true, id, enabled: true }
}

export function disableScenario(id) {
  const s = _registry.get(id)
  if (!s) return { ok: false, error: `scenario "${id}" not found` }
  s.enabled = false
  return { ok: true, id, enabled: false }
}

export function enableAllScenarios() {
  let count = 0
  for (const s of _registry.values()) {
    if (s.triggerType === 'voice') continue // voice 永远启用
    s.enabled = true
    count++
  }
  return { ok: true, count }
}

export function disableAllScenarios() {
  let count = 0
  for (const s of _registry.values()) {
    // voice_scene 永远 enabled（仅跟踪）
    if (s.triggerType === 'voice') {
      s.enabled = true
      continue
    }
    s.enabled = false
    count++
  }
  return { ok: true, count }
}

export function setScenarioDryRun(id, dryRun) {
  const s = _registry.get(id)
  if (!s) return { ok: false, error: `scenario "${id}" not found` }
  s.dryRun = Boolean(dryRun)
  return { ok: true, id, dryRun: s.dryRun }
}

// ── 公开 API：场景运行历史 ──────────────────────────────────────────
export function getScenarioRuns(id, { limit = 20 } = {}) {
  const runs = _runHistory.get(id) || []
  return runs.slice(-limit).reverse()
}

// ── 公开 API：触发器注册（沿用 Phase 3 registerTrigger 模式）─────────
export function registerTrigger(name, handler) {
  if (!name) throw new Error('registerTrigger: name 必填')
  if (typeof handler !== 'function') throw new Error('registerTrigger: handler 必填（function）')
  if (!_triggers.has(name)) _triggers.set(name, [])
  _triggers.get(name).push(handler)
  return () => {
    const list = _triggers.get(name) || []
    const idx = list.indexOf(handler)
    if (idx >= 0) list.splice(idx, 1)
  }
}

export async function fireTrigger(name, payload = {}) {
  const handlers = _triggers.get(name) || []
  for (const h of handlers) {
    try {
      await h(payload)
    } catch (err) {
      console.warn(`[iot-scenarios] trigger handler failed for ${name}: ${err?.message || err}`)
    }
  }
}

// ── 场景运行：核心引擎 ──────────────────────────────────────────────
/**
 * Run a scenario by id.
 * @param {string} id
 * @param {Object} [opts]
 * @param {string} [opts.triggeredBy='manual'] - gps/network/cron/voice/manual
 * @param {boolean} [opts.approved=false] - dry-run 批准标志；true = 真发命令
 * @param {boolean} [opts.dryRun] - override scenario.dryRun
 * @returns {Promise<{ok: boolean, runId: string, summary: string, results: Array}>}
 */
export async function runScenario(id, opts = {}) {
  const s = _registry.get(id)
  if (!s) return { ok: false, error: `scenario "${id}" not found` }

  const triggeredBy = opts.triggeredBy || 'manual'
  const dryRun = typeof opts.dryRun === 'boolean' ? opts.dryRun : Boolean(s.dryRun)
  const approved = Boolean(opts.approved) || !dryRun
  const runId = makeRunId(id)
  const startedAt = now().getTime()

  // 去重（同 scenarioId + triggerKey 在 DEFAULT_DEDUPE_MS 内不重跑）
  const dedupeKey = `${id}:${triggeredBy}`
  const lastTriggered = _triggeredLog.get(dedupeKey) || 0
  if (now().getTime() - lastTriggered < DEFAULT_DEDUPE_MS) {
    return { ok: false, runId, error: 'duplicate trigger (deduped)', deduped: true }
  }
  _triggeredLog.set(dedupeKey, now().getTime())

  // condition 检查
  if (s.condition && Object.keys(s.condition).length > 0) {
    const condOk = await checkCondition(s.condition)
    if (!condOk) {
      const result = { ok: false, summary: 'condition not met', dryRun, approved, actionsCount: 0 }
      s.lastRun = new Date().toISOString()
      s.lastResult = result
      return { ok: false, runId, ...result, conditionNotMet: true }
    }
  }

  // dry-run 通知
  if (dryRun && !approved) {
    const actionSummary = s.actions.map((a) => `${a.action}(${a.deviceId.split('.').pop()})`).join(' → ')
    emitEvent('iot_scenario_dryrun', {
      scenarioId: id,
      runId,
      summary: `[dry-run] 即将执行 ${s.name}: ${actionSummary}`,
      actions: s.actions,
      at: new Date().toISOString(),
    })
    const result = { ok: true, summary: `[dry-run] ${s.name} 等待老板确认`, dryRun: true, approved: false, actionsCount: s.actions.length }
    recordRun(id, { scenarioId: id, runId, startedAt, ok: true, summary: result.summary, dryRun, approved, triggeredBy, actionsCount: 0, results: [] })
    return { ok: true, runId, dryRun: true, approved: false, requiresApproval: true, summary: result.summary, actions: s.actions }
  }

  // 真发命令
  const results = []
  for (const a of s.actions) {
    if (a.delay && a.delay > 0) {
      await sleep(a.delay)
    }
    const result = await withTimeout(controlByDeviceId(a.deviceId, a.action, a.params || {}), DEFAULT_ACTION_TIMEOUT_MS, { ok: false, error: 'timeout', provider: 'unknown' })
    const audited = auditControl({
      deviceId: a.deviceId,
      provider: getProviderForDevice(a.deviceId),
      action: a.action,
      params: a.params,
      ok: result.ok,
      error: result.error,
      scenarioId: id,
      runId,
      triggeredBy,
      dryRun,
      approved,
    })
    results.push({ ...result, audited, deviceId: a.deviceId, action: a.action })
  }

  const allOk = results.every((r) => r.ok)
  const successCount = results.filter((r) => r.ok).length
  const summary = allOk
    ? `${s.name} 完成：${successCount}/${results.length} 设备已控制`
    : `${s.name} 部分失败：${successCount}/${results.length} 设备成功`
  s.lastRun = new Date().toISOString()
  s.lastResult = { ok: allOk, summary }
  s.runCount = (s.runCount || 0) + 1

  recordRun(id, {
    scenarioId: id,
    runId,
    startedAt,
    ok: allOk,
    summary,
    dryRun,
    approved,
    triggeredBy,
    actionsCount: results.length,
    successCount,
    results: results.map((r) => ({ deviceId: r.deviceId, action: r.action, ok: r.ok, error: r.error })),
  })

  // 写 L2 memory（emotion-isolation 严守）
  await ingestScenarioRuns([{
    id: runId,
    scenarioId: id,
    name: s.name,
    ok: allOk,
    summary,
    actionsCount: results.length,
    successCount,
    dryRun,
    approved,
    triggeredBy,
    runAt: s.lastRun,
  }])

  // 通知
  if (s.notify && s.notify.channels && s.notify.channels.length > 0) {
    emitEvent('iot_scenario_completed', {
      scenarioId: id,
      runId,
      ok: allOk,
      summary,
      channels: s.notify.channels,
      priority: s.notify.priority || 'normal',
      at: s.lastRun,
    })
  }

  auditScenario({
    scenarioId: id,
    ok: allOk,
    summary,
    actionsCount: results.length,
    successCount,
    dryRun,
    approved,
    triggeredBy,
    durationMs: now().getTime() - startedAt,
  })

  return { ok: allOk, runId, summary, results, dryRun, approved, triggeredBy }
}

function recordRun(id, entry) {
  if (!_runHistory.has(id)) _runHistory.set(id, [])
  const arr = _runHistory.get(id)
  arr.push({ ...entry, runAt: new Date().toISOString() })
  if (arr.length > 200) arr.shift()  // 限制内存
}

async function checkCondition(cond = {}) {
  // timeRange 检查
  if (cond.timeRange) {
    const cur = now()
    const hh = String(cur.getHours()).padStart(2, '0')
    const mm = String(cur.getMinutes()).padStart(2, '0')
    const curMin = hh + mm
    const from = (cond.timeRange.from || '00:00').replace(':', '')
    const to = (cond.timeRange.to || '23:59').replace(':', '')
    if (curMin < from || curMin > to) return false
  }
  // isAtHome: Phase 4 占位永远 true（GPS 实接在 Phase 5）
  if (cond.isAtHome === true) return true
  // dayOfWeek: 0=Sun
  if (Array.isArray(cond.dayOfWeek) && cond.dayOfWeek.length > 0) {
    const dow = now().getDay()
    if (!cond.dayOfWeek.includes(dow)) return false
  }
  return true
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((r) => setTimeout(() => r(fallback), ms)),
  ])
}

// ── 喂入触发（供 API/Phase 5 移动端）─────────────────────────────
/**
 * Feed a GPS event (Phase 5 移动端调用).
 * @param {Object} payload - { distance, geofenceId, lat?, lng?, arrived?, left? }
 */
export async function feedGpsEvent(payload = {}) {
  if (payload.arrived || (typeof payload.distance === 'number' && payload.distance < 100)) {
    await fireTrigger('iot:gps:home_arrived', payload)
  }
  if (payload.left || (typeof payload.distance === 'number' && payload.distance > 1000)) {
    await fireTrigger('iot:gps:home_left', payload)
  }
}

/**
 * Feed a Wi-Fi event (Phase 5 + macOS Network Location 接入).
 * @param {Object} payload - { ssid, joined?, left? }
 */
export async function feedWifiEvent(payload = {}) {
  if (payload.joined) await fireTrigger('iot:wifi:home_joined', payload)
  if (payload.left) await fireTrigger('iot:wifi:home_left', payload)
}

/**
 * Feed a voice command.
 * @param {Object} payload - { phrase, intent, deviceId?, action?, params? }
 */
export async function feedVoiceCommand(payload = {}) {
  await fireTrigger('iot:voice:command', payload)
}

// ── 注册内置触发器（场景 → 触发器 wiring）───────────────────────────
function wireBuiltinTriggers() {
  // come_home / leave_home 走 GPS 触发器
  registerTrigger('iot:gps:home_arrived', async (event) => {
    const s = _registry.get('come_home')
    if (!s || !s.enabled) return
    await runScenario('come_home', { triggeredBy: 'gps:home_arrived', event })
  })
  registerTrigger('iot:gps:home_left', async (event) => {
    const s = _registry.get('leave_home')
    if (!s || !s.enabled) return
    await runScenario('leave_home', { triggeredBy: 'gps:home_left', event })
  })

  // sleep / morning 走 cron 触发器（外部 cron 模块 emit 'iot:trigger:sleep' / 'iot:trigger:morning'）
  registerTrigger('iot:trigger:sleep', async (event) => {
    const s = _registry.get('sleep')
    if (!s || !s.enabled) return
    await runScenario('sleep', { triggeredBy: 'cron:22:30', event })
  })
  registerTrigger('iot:trigger:morning', async (event) => {
    const s = _registry.get('morning_routine')
    if (!s || !s.enabled) return
    await runScenario('morning_routine', { triggeredBy: 'cron:07:00', event })
  })

  // voice 场景：仅统计 + 记录
  registerTrigger('iot:voice:command', async (event) => {
    const s = _registry.get('voice_scene')
    if (!s) return
    s.runCount = (s.runCount || 0) + 1
    s.lastRun = new Date().toISOString()
    s.lastResult = { ok: true, summary: `voice command: ${event.phrase || 'unknown'}` }
  })
}
wireBuiltinTriggers()

// ── orchestrator 状态（健康检查用）─────────────────────────────────
export function getScenarioStatus() {
  const all = listScenarios()
  return {
    ok: true,
    bridge: 'scenarios → IoT connectors → L2 memory',
    policy: {
      emotionIsolation: 'strict',
      defaultEnabled: false,
      dedupeMs: DEFAULT_DEDUPE_MS,
      actionTimeoutMs: DEFAULT_ACTION_TIMEOUT_MS,
    },
    counts: {
      total: all.length,
      enabled: all.filter((s) => s.enabled).length,
      dryRun: all.filter((s) => s.dryRun).length,
    },
    scenarios: all,
  }
}

// ── Test hook ───────────────────────────────────────────────────────
export const __test = {
  _registry,
  _triggers,
  _runHistory,
  _triggeredLog,
  buildDefaultScenarios,
  initDefaultScenarios,
  checkCondition,
  controlByDeviceId,
  getProviderForDevice,
  DEFAULT_DEDUPE_MS,
  DEFAULT_ACTION_TIMEOUT_MS,
}
