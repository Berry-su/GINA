// src/api/routes/iot.js — IoT API 路由（ADR-012 · Phase 4）
//
//   GET    /iot/status                  - 整体状态（3 provider + scenarios）
//   GET    /iot/rooms                   - 列出所有房间
//   GET    /iot/devices                 - 列出所有设备（filter: room/type/provider）
//   GET    /iot/devices/:id             - 查单设备
//   POST   /iot/devices/:id/control     - 控制设备（dryRun 支持）
//   GET    /iot/scenarios               - 列出所有场景
//   GET    /iot/scenarios/:id           - 查单场景
//   POST   /iot/scenarios/:id/run       - 跑场景（dryRun 支持）
//   POST   /iot/scenarios/:id/enable    - 启用
//   POST   /iot/scenarios/:id/disable   - 禁用
//   POST   /iot/scenarios/enable-all    - 全部启用
//   POST   /iot/scenarios/disable-all   - 全部禁用
//   GET    /iot/scenarios/:id/runs      - 跑次历史
//   POST   /iot/triggers/gps            - GPS 喂入（Phase 5 用）
//   POST   /iot/triggers/wifi           - Wi-Fi 喂入
//   POST   /iot/triggers/voice          - 语音命令喂入
//
// 跟 src/api/routes/calendar.js + tasks.js + cron.js + notes.js 风格一致

import { jsonResponse, readJsonBody } from '../utils.js'
import {
  listHomekitRooms, listHomekitDevices, getHomekitDevice, controlHomekitDevice, getHomekitStatusAll, getHomekitStatus,
} from '../../connectors/homekit.js'
import {
  listMijiaRooms, listMijiaDevices, getMijiaDevice, controlMijiaDevice, getMijiaStatusAll, getMijiaStatus,
} from '../../connectors/mijia.js'
import {
  listMqttRooms, listMqttDevices, getMqttDevice, controlMqttDevice, getMqttStatusAll, getMqttStatus,
} from '../../connectors/mqtt.js'
import {
  listScenarios, getScenario, runScenario, enableScenario, disableScenario,
  enableAllScenarios, disableAllScenarios, getScenarioStatus, getScenarioRuns,
  feedGpsEvent, feedWifiEvent, feedVoiceCommand, setScenarioDryRun,
} from '../../agentic/iot-scenarios.js'
import { ingestIoTDevices } from '../../connectors/memory-bridge.js'
import { readRecentAudit } from '../../connectors/iot-audit.js'

async function listAllDevices({ provider, room, type } = {}) {
  if (provider === 'homekit') return listHomekitDevices({ provider: 'mock', room, type })
  if (provider === 'mijia') return listMijiaDevices({ provider: 'mock', room, type })
  if (provider === 'mqtt') return listMqttDevices({ provider: 'mock', room, type })
  const [hk, mj, qt] = await Promise.all([
    listHomekitDevices({ provider: 'mock', room, type }),
    listMijiaDevices({ provider: 'mock', room, type }),
    listMqttDevices({ provider: 'mock', room, type }),
  ])
  return [...hk, ...mj, ...qt]
}

async function listAllRooms({ provider } = {}) {
  if (provider === 'homekit') return listHomekitRooms({ provider: 'mock' })
  if (provider === 'mijia') return listMijiaRooms({ provider: 'mock' })
  if (provider === 'mqtt') return listMqttRooms({ provider: 'mock' })
  const [hk, mj, qt] = await Promise.all([
    listHomekitRooms({ provider: 'mock' }),
    listMijiaRooms({ provider: 'mock' }),
    listMqttRooms({ provider: 'mock' }),
  ])
  return [...hk, ...mj, ...qt]
}

async function getAnyDevice(id) {
  if (id.startsWith('homekit.')) return getHomekitDevice({ provider: 'mock', id })
  if (id.startsWith('mijia.')) return getMijiaDevice({ provider: 'mock', id })
  if (id.startsWith('mqtt.')) return getMqttDevice({ provider: 'mock', id })
  return null
}

async function controlAnyDevice(id, action, params) {
  if (id.startsWith('homekit.')) return controlHomekitDevice({ provider: 'mock', id, action, params })
  if (id.startsWith('mijia.')) return controlMijiaDevice({ provider: 'mock', id, action, params })
  if (id.startsWith('mqtt.')) return controlMqttDevice({ provider: 'mock', id, action, params })
  return { ok: false, error: `unknown provider for device ${id}` }
}

export async function handleIotRoutes(req, res, url) {
  const pathname = url.pathname

  // GET /iot/status
  if (req.method === 'GET' && pathname === '/iot/status') {
    try {
      const status = {
        homekit: getHomekitStatusAll(),
        mijia: getMijiaStatusAll(),
        mqtt: getMqttStatusAll(),
        scenarios: getScenarioStatus(),
        audit: { recentCount: readRecentAudit({ limit: 1 }).length },
      }
      jsonResponse(res, 200, { ok: true, ...status })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /iot/rooms
  if (req.method === 'GET' && pathname === '/iot/rooms') {
    try {
      const provider = url.searchParams.get('provider')
      const rooms = await listAllRooms({ provider })
      jsonResponse(res, 200, { ok: true, count: rooms.length, rooms })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /iot/devices
  if (req.method === 'GET' && pathname === '/iot/devices') {
    try {
      const provider = url.searchParams.get('provider')
      const room = url.searchParams.get('room')
      const type = url.searchParams.get('type')
      const devices = await listAllDevices({ provider, room, type })
      // 自动 ingest L2 memory（按需；控制在 25 条以内）
      const ingest = await ingestIoTDevices(devices.slice(0, 25))
      jsonResponse(res, 200, { ok: true, count: devices.length, devices, memoryIngest: ingest })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /iot/devices/:id
  const deviceMatch = pathname.match(/^\/iot\/devices\/([^/]+)$/)
  if (req.method === 'GET' && deviceMatch) {
    try {
      const id = decodeURIComponent(deviceMatch[1])
      const d = await getAnyDevice(id)
      if (!d) {
        jsonResponse(res, 404, { ok: false, error: `device ${id} not found` })
        return true
      }
      await ingestIoTDevices([d])
      jsonResponse(res, 200, { ok: true, device: d })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/devices/:id/control
  const controlMatch = pathname.match(/^\/iot\/devices\/([^/]+)\/control$/)
  if (req.method === 'POST' && controlMatch) {
    try {
      const id = decodeURIComponent(controlMatch[1])
      const body = await readJsonBody(req)
      if (!body.action) {
        jsonResponse(res, 400, { ok: false, error: '缺少 action' })
        return true
      }
      // dry-run 模式不真发命令
      if (body.dryRun === true) {
        jsonResponse(res, 200, {
          ok: true,
          dryRun: true,
          deviceId: id,
          action: body.action,
          params: body.params || {},
          message: `[dry-run] 即将对 ${id} 执行 ${body.action}(${JSON.stringify(body.params || {})})`,
        })
        return true
      }
      const r = await controlAnyDevice(id, body.action, body.params || {})
      jsonResponse(res, r.ok ? 200 : 500, {
        ok: r.ok,
        deviceId: id,
        action: body.action,
        state: r.state,
        error: r.error,
        provider: r.provider,
      })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /iot/scenarios
  if (req.method === 'GET' && pathname === '/iot/scenarios') {
    try {
      const scenarios = listScenarios()
      jsonResponse(res, 200, { ok: true, count: scenarios.length, scenarios })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/scenarios/enable-all
  if (req.method === 'POST' && pathname === '/iot/scenarios/enable-all') {
    try {
      const r = enableAllScenarios()
      jsonResponse(res, 200, { ok: r.ok, ...r })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/scenarios/disable-all
  if (req.method === 'POST' && pathname === '/iot/scenarios/disable-all') {
    try {
      const r = disableAllScenarios()
      jsonResponse(res, 200, { ok: r.ok, ...r })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /iot/scenarios/:id
  const scenarioMatch = pathname.match(/^\/iot\/scenarios\/([^/]+)$/)
  if (req.method === 'GET' && scenarioMatch) {
    try {
      const id = decodeURIComponent(scenarioMatch[1])
      const s = getScenario(id)
      if (!s) {
        jsonResponse(res, 404, { ok: false, error: `scenario ${id} not found` })
        return true
      }
      const runs = getScenarioRuns(id, { limit: 20 })
      jsonResponse(res, 200, { ok: true, scenario: s, recentRuns: runs })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/scenarios/:id/run
  const scenarioRunMatch = pathname.match(/^\/iot\/scenarios\/([^/]+)\/run$/)
  if (req.method === 'POST' && scenarioRunMatch) {
    try {
      const id = decodeURIComponent(scenarioRunMatch[1])
      const body = await readJsonBody(req).catch(() => ({}))
      const r = await runScenario(id, {
        triggeredBy: body.triggeredBy || 'api',
        approved: Boolean(body.approved),
        dryRun: typeof body.dryRun === 'boolean' ? body.dryRun : undefined,
      })
      jsonResponse(res, r.ok ? 200 : (r.conditionNotMet ? 200 : 500), { ok: r.ok, ...r })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/scenarios/:id/enable
  const enableMatch = pathname.match(/^\/iot\/scenarios\/([^/]+)\/enable$/)
  if (req.method === 'POST' && enableMatch) {
    try {
      const id = decodeURIComponent(enableMatch[1])
      const r = enableScenario(id)
      jsonResponse(res, r.ok ? 200 : 404, { ok: r.ok, ...r })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/scenarios/:id/disable
  const disableMatch = pathname.match(/^\/iot\/scenarios\/([^/]+)\/disable$/)
  if (req.method === 'POST' && disableMatch) {
    try {
      const id = decodeURIComponent(disableMatch[1])
      const r = disableScenario(id)
      jsonResponse(res, r.ok ? 200 : 404, { ok: r.ok, ...r })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // GET /iot/scenarios/:id/runs
  const runsMatch = pathname.match(/^\/iot\/scenarios\/([^/]+)\/runs$/)
  if (req.method === 'GET' && runsMatch) {
    try {
      const id = decodeURIComponent(runsMatch[1])
      const limit = Number(url.searchParams.get('limit')) || 20
      const runs = getScenarioRuns(id, { limit })
      jsonResponse(res, 200, { ok: true, count: runs.length, runs })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/triggers/gps
  if (req.method === 'POST' && pathname === '/iot/triggers/gps') {
    try {
      const body = await readJsonBody(req)
      await feedGpsEvent(body)
      jsonResponse(res, 200, { ok: true, event: 'gps_fed', payload: body })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/triggers/wifi
  if (req.method === 'POST' && pathname === '/iot/triggers/wifi') {
    try {
      const body = await readJsonBody(req)
      await feedWifiEvent(body)
      jsonResponse(res, 200, { ok: true, event: 'wifi_fed', payload: body })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  // POST /iot/triggers/voice
  if (req.method === 'POST' && pathname === '/iot/triggers/voice') {
    try {
      const body = await readJsonBody(req)
      await feedVoiceCommand(body)
      jsonResponse(res, 200, { ok: true, event: 'voice_fed', payload: body })
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err?.message || err) })
    }
    return true
  }

  return false
}
