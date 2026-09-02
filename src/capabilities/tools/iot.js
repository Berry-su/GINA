// src/capabilities/tools/iot.js — IoT 工具执行器（ADR-012 · Phase 4）
//
// LLM 调 query_iot / control_iot 时走这里。
// 逻辑：
//   1. 解析 args.action
//   2. 调对应 connector / scenario 引擎
//   3. 读操作自动 ingest L2 memory（memory-bridge）
//   4. 写操作走 iot-audit + memory-bridge
//   5. 返回结构化 string 给 LLM
//
// emotion-isolation 严守：
//   - tool 输出不含 emotion 词
//   - ingest 是后台事务，**不触发 joy 也不进决策**

import {
  listHomekitDevices, getHomekitDevice, controlHomekitDevice, listHomekitRooms, getHomekitStatusAll, getHomekitStatus,
} from '../../connectors/homekit.js'
import {
  listMijiaDevices, getMijiaDevice, controlMijiaDevice, listMijiaRooms, getMijiaStatusAll, getMijiaStatus,
} from '../../connectors/mijia.js'
import {
  listMqttDevices, getMqttDevice, controlMqttDevice, listMqttRooms, getMqttStatusAll, getMqttStatus,
} from '../../connectors/mqtt.js'
import {
  listScenarios, getScenario, runScenario, enableScenario, disableScenario,
  enableAllScenarios, disableAllScenarios, getScenarioStatus, getScenarioRuns, feedGpsEvent, feedVoiceCommand,
} from '../../agentic/iot-scenarios.js'
import { ingestIoTDevices, ingestScenarioRuns } from '../../connectors/memory-bridge.js'

// ── 通用 helper ─────────────────────────────────────────────────────
function toolJson(obj) {
  return JSON.stringify(obj, null, 2)
}

async function listDevicesForProvider(provider) {
  if (provider === 'homekit') return listHomekitDevices({ provider: 'mock' })
  if (provider === 'mijia') return listMijiaDevices({ provider: 'mock' })
  if (provider === 'mqtt') return listMqttDevices({ provider: 'mock' })
  // 默认：合并 3 个 mock provider
  const [hk, mj, qt] = await Promise.all([
    listHomekitDevices({ provider: 'mock' }),
    listMijiaDevices({ provider: 'mock' }),
    listMqttDevices({ provider: 'mock' }),
  ])
  return [...hk, ...mj, ...qt]
}

async function getDeviceForProvider(provider, deviceId) {
  if (provider === 'homekit') return getHomekitDevice({ provider: 'mock', id: deviceId })
  if (provider === 'mijia') return getMijiaDevice({ provider: 'mock', id: deviceId })
  if (provider === 'mqtt') return getMqttDevice({ provider: 'mock', id: deviceId })
  // provider 未指定时按 ID 前缀分发
  if (deviceId.startsWith('homekit.')) return getHomekitDevice({ provider: 'mock', id: deviceId })
  if (deviceId.startsWith('mijia.')) return getMijiaDevice({ provider: 'mock', id: deviceId })
  if (deviceId.startsWith('mqtt.')) return getMqttDevice({ provider: 'mock', id: deviceId })
  return null
}

async function controlDeviceForProvider(provider, deviceId, action, params) {
  // provider 优先按传入；否则按 ID 前缀分发
  let targetProvider = provider
  if (!targetProvider || targetProvider === 'mock') {
    if (deviceId.startsWith('homekit.')) targetProvider = 'homekit'
    else if (deviceId.startsWith('mijia.')) targetProvider = 'mijia'
    else if (deviceId.startsWith('mqtt.')) targetProvider = 'mqtt'
  }
  if (targetProvider === 'homekit') return controlHomekitDevice({ provider: 'mock', id: deviceId, action, params })
  if (targetProvider === 'mijia') return controlMijiaDevice({ provider: 'mock', id: deviceId, action, params })
  if (targetProvider === 'mqtt') return controlMqttDevice({ provider: 'mock', id: deviceId, action, params })
  return { ok: false, error: `unknown provider for device ${deviceId}` }
}

// ── query_iot 执行器 ────────────────────────────────────────────────
export async function execQueryIot(args = {}, context = {}) {
  const action = args.action
  const provider = args.provider || null
  if (!action) return '错误：未提供 action（list_devices/get_device/list_rooms/list_scenarios/get_scenario/status）'

  if (action === 'list_devices') {
    const devices = await listDevicesForProvider(provider)
    const filtered = devices.filter((d) => {
      if (args.room && d.room !== args.room) return false
      if (args.type && d.type !== args.type) return false
      return true
    })
    await ingestIoTDevices(filtered)
    return toolJson({ ok: true, action, count: filtered.length, devices: filtered })
  }

  if (action === 'get_device') {
    if (!args.deviceId) return '错误：get_device 需要 deviceId'
    const d = await getDeviceForProvider(provider, args.deviceId)
    if (!d) return toolJson({ ok: false, action, error: `device ${args.deviceId} not found` })
    await ingestIoTDevices([d])
    return toolJson({ ok: true, action, device: d })
  }

  if (action === 'list_rooms') {
    let rooms = []
    if (provider === 'homekit') rooms = await listHomekitRooms({ provider: 'mock' })
    else if (provider === 'mijia') rooms = await listMijiaRooms({ provider: 'mock' })
    else if (provider === 'mqtt') rooms = await listMqttRooms({ provider: 'mock' })
    else {
      const [hk, mj, qt] = await Promise.all([
        listHomekitRooms({ provider: 'mock' }),
        listMijiaRooms({ provider: 'mock' }),
        listMqttRooms({ provider: 'mock' }),
      ])
      rooms = [...hk, ...mj, ...qt]
    }
    return toolJson({ ok: true, action, count: rooms.length, rooms })
  }

  if (action === 'list_scenarios') {
    const scenarios = listScenarios()
    return toolJson({ ok: true, action, count: scenarios.length, scenarios })
  }

  if (action === 'get_scenario') {
    if (!args.scenarioId) return '错误：get_scenario 需要 scenarioId'
    const s = getScenario(args.scenarioId)
    if (!s) return toolJson({ ok: false, action, error: `scenario ${args.scenarioId} not found` })
    const runs = getScenarioRuns(args.scenarioId, { limit: 5 })
    return toolJson({ ok: true, action, scenario: s, recentRuns: runs })
  }

  if (action === 'status') {
    const status = {
      homekit: getHomekitStatusAll(),
      mijia: getMijiaStatusAll(),
      mqtt: getMqttStatusAll(),
      scenarios: getScenarioStatus(),
    }
    return toolJson({ ok: true, action, ...status })
  }

  return `错误：未知 action "${action}"`
}

// ── control_iot 执行器 ─────────────────────────────────────────────
export async function execControlIot(args = {}, context = {}) {
  const action = args.action
  if (!action) return '错误：未提供 action（control/run_scenario/enable_scenario/disable_scenario/enable_all/disable_all）'

  if (action === 'control') {
    if (!args.deviceId) return '错误：control 需要 deviceId'
    if (!args.controlAction) return '错误：control 需要 controlAction'

    const dryRun = Boolean(args.dryRun)
    const confirmed = Boolean(args.confirmed)

    // dry-run 模式不真发命令；只汇报"即将 X"
    if (dryRun) {
      return toolJson({
        ok: true,
        action,
        dryRun: true,
        deviceId: args.deviceId,
        controlAction: args.controlAction,
        params: args.params || {},
        message: `[dry-run] 即将对 ${args.deviceId} 执行 ${args.controlAction}(${JSON.stringify(args.params || {})})`,
      })
    }

    // confirmed=false 时仍可发命令（设备控制粒度小），但 audit 标 [unconfirmed]
    const r = await controlDeviceForProvider(null, args.deviceId, args.controlAction, args.params || {})
    return toolJson({
      ok: r.ok,
      action,
      deviceId: args.deviceId,
      controlAction: args.controlAction,
      confirmed,
      state: r.state,
      error: r.error,
      provider: r.provider,
    })
  }

  if (action === 'run_scenario') {
    if (!args.scenarioId) return '错误：run_scenario 需要 scenarioId'
    const r = await runScenario(args.scenarioId, {
      triggeredBy: 'llm_control_iot',
      approved: Boolean(args.confirmed),
      dryRun: typeof args.dryRun === 'boolean' ? args.dryRun : undefined,
    })
    return toolJson({ ok: r.ok, action, ...r })
  }

  if (action === 'enable_scenario') {
    if (!args.scenarioId) return '错误：enable_scenario 需要 scenarioId'
    const r = enableScenario(args.scenarioId)
    return toolJson({ ok: r.ok, action, ...r })
  }

  if (action === 'disable_scenario') {
    if (!args.scenarioId) return '错误：disable_scenario 需要 scenarioId'
    const r = disableScenario(args.scenarioId)
    return toolJson({ ok: r.ok, action, ...r })
  }

  if (action === 'enable_all') {
    const r = enableAllScenarios()
    return toolJson({ ok: r.ok, action, ...r })
  }

  if (action === 'disable_all') {
    const r = disableAllScenarios()
    return toolJson({ ok: r.ok, action, ...r })
  }

  return `错误：未知 action "${action}"`
}
