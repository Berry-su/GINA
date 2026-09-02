// src/connectors/mqtt.js — MQTT IoT 连接器（ADR-012 · Phase 4）
//
// 设计目标：
//   老板说"开 ESP32 灯"或"检测 DIY 温感" → GINA 跨 MQTT 协议
//   统一 listDevices / getDevice / controlDevice / subscribe。
//   支持设备影子（device shadow）：每个 device 维护本地缓存，controlDevice
//   先更新 shadow 再发 publish；broker push 进来时 sync shadow。
//
// 设计原则（沿用 Phase 2 模式 + 9-02 老板纠错纪律）：
//   - 单文件多 provider，dynamic import 第三方 SDK（缺包不破）
//   - 缺 SDK / 缺 creds 时降级 mock provider（测试默认走 mock）
//   - 真实 credential 走 .env（GINA_MQTT_URL / GINA_MQTT_USERNAME / GINA_MQTT_PASSWORD）
//   - emotion-isolation 严守：设备控制只走事实/状态路径，不触发 joy，不进决策链路
//
// Provider 矩阵：
//   - mqtt  : mqtt npm 包（dynamic import；缺包不破）
//   - mock  : 内置 fake MQTT 设备（测试 + 缺 creds 时默认）
//
// 统一接口（每个 provider 暴露 6 函数）：
//   listDevices({ room?, type? })           → Device[]
//   getDevice(id)                            → Device | null
//   controlDevice(id, action, params = {})   → {ok, state, provider}
//   subscribe(eventHandler)                  → unsubscribe
//   listRooms()                              → Room[]
//   getStatus()                              → ProviderStatus

import { config as appConfig } from '../config.js'

// ── Provider registry（动态 require 第三方 SDK，缺包不破） ─────────────────
const PROVIDER_LOADERS = {
  mqtt: () => import('mqtt').then((m) => m).catch(() => null),
  mock: async () => (await import('./_mock-iot.js')).mqttMockProvider,
}

// ── Provider 实现：mqtt (真实 dynamic import) ─────────────────────────────
// 注意：真实实现是骨架 + 接口预留。真实接入需要：
//   1. 用户运行 `pnpm add mqtt`
//   2. 配置 GINA_MQTT_URL（mqtt://broker:1883）
//   3. 设备发现：订阅 `gina/devices/+/state` 或 zigbee2mqtt `bridge/devices`
//   4. 控制：发布到 `gina/devices/{id}/set`
// Phase 4 提交：缺包 → 自动 fallback mock；老板手动 install 后可启用

function makeMqttOfficialProvider({ credentials }) {
  let _mqtt = null
  let _client = null
  async function ensureSDK() {
    if (_mqtt) return _mqtt
    const mod = await PROVIDER_LOADERS.mqtt()
    if (!mod) throw new Error('mqtt package not installed; run `pnpm add mqtt`')
    _mqtt = mod
    return _mqtt
  }
  return {
    kind: 'mqtt',
    label: 'mqtt-broker',
    listRooms: async function () {
      await ensureSDK()
      console.warn('[mqtt] listRooms: skeleton only; real implementation requires broker discovery')
      return [{ id: 'room-default', name: 'MQTT 设备' }]
    },
    listDevices: async function () {
      await ensureSDK()
      console.warn('[mqtt] listDevices: skeleton only; subscribe to gina/devices/+/state to populate')
      return []
    },
    getDevice: async function (id) {
      await ensureSDK()
      console.warn('[mqtt] getDevice: skeleton only', id)
      return null
    },
    controlDevice: async function (id, action, params = {}) {
      await ensureSDK()
      console.warn('[mqtt] controlDevice: skeleton only; would publish to gina/devices/{id}/set', { id, action, params })
      return { ok: false, error: 'mqtt official provider: skeleton only; use mock or implement mqtt.publish() bridge', provider: 'mqtt' }
    },
    subscribe: async function (eventHandler) {
      await ensureSDK()
      console.warn('[mqtt] subscribe: skeleton only; would subscribe gina/devices/+/state')
      return () => {}
    },
    getStatus: async function () {
      await ensureSDK()
      return {
        ok: true,
        provider: 'mqtt-broker',
        note: 'skeleton implementation; install mqtt + configure GINA_MQTT_URL to enable',
        url: credentials?.url || null,
        credentialsComplete: Boolean(credentials?.url),
      }
    },
  }
}

// ── 凭据读取 ─────────────────────────────────────────────────────────────
function readEnvCredentials() {
  return {
    url: process.env.GINA_MQTT_URL,
    username: process.env.GINA_MQTT_USERNAME,
    password: process.env.GINA_MQTT_PASSWORD,
    clientId: process.env.GINA_MQTT_CLIENT_ID || 'gina-iot',
  }
}

function credentialsLookComplete(creds) {
  return Boolean(creds?.url)
}

const _providerCache = new Map()

export async function getMqttProvider(provider = null) {
  const requested = provider || process.env.GINA_IOT_PROVIDER_MQTT || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    const { mqttMockProvider } = await import('./_mock-iot.js')
    instance = mqttMockProvider()
  } else if (requested === 'broker') {
    const creds = readEnvCredentials()
    if (!credentialsLookComplete(creds)) {
      console.warn('[mqtt] broker creds incomplete; falling back to mock')
      const { mqttMockProvider } = await import('./_mock-iot.js')
      instance = mqttMockProvider()
    } else {
      instance = makeMqttOfficialProvider({ credentials: creds })
    }
  } else {
    throw new Error(`Unknown mqtt provider: ${requested}`)
  }

  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 统一对外 API（老板唯一入口） ──────────────────────────────────────────
export async function listMqttRooms({ provider = null } = {}) {
  const p = await getMqttProvider(provider)
  return p.listRooms()
}

export async function listMqttDevices({ provider = null, room, type } = {}) {
  const p = await getMqttProvider(provider)
  return p.listDevices({ room, type })
}

export async function getMqttDevice({ provider = null, id } = {}) {
  if (!id) throw new Error('getMqttDevice: id 必填')
  const p = await getMqttProvider(provider)
  return p.getDevice(id)
}

export async function controlMqttDevice({ provider = null, id, action, params = {} } = {}) {
  if (!id) throw new Error('controlMqttDevice: id 必填')
  if (!action) throw new Error('controlMqttDevice: action 必填')
  const p = await getMqttProvider(provider)
  return p.controlDevice(id, action, params)
}

export async function subscribeMqtt({ provider = null, eventHandler } = {}) {
  if (typeof eventHandler !== 'function') throw new Error('subscribeMqtt: eventHandler 必填（function）')
  const p = await getMqttProvider(provider)
  return p.subscribe(eventHandler)
}

export async function getMqttStatus({ provider = null } = {}) {
  const p = await getMqttProvider(provider)
  return p.getStatus()
}

// ── Provider 元数据（暴露给 UI / 状态路由） ──────────────────────────────
export const MQTT_PROVIDERS = [
  { id: 'mock', label: 'Mock（测试 / 降级）', default: true },
  { id: 'broker', label: 'MQTT Broker', env: 'GINA_MQTT_*', pkg: 'mqtt' },
]

export function getMqttStatusAll() {
  return {
    providers: MQTT_PROVIDERS,
    active: process.env.GINA_IOT_PROVIDER_MQTT || 'mock',
    cached: [..._providerCache.keys()],
  }
}

// ── Test hook ──────────────────────────────────────────────────────────
export const __test = {
  _providerCache,
  readEnvCredentials,
  credentialsLookComplete,
}

void appConfig
