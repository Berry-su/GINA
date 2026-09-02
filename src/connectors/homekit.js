// src/connectors/homekit.js — Apple HomeKit 连接器（ADR-012 · Phase 4）
//
// 设计目标：
//   老板说"开灯"/"锁门"/"空调 24 度"或"到家自动开灯" → GINA 跨 HomeKit 协议
//   统一 listDevices / getDevice / controlDevice / subscribe。
//
// 设计原则（9-02 老板纠错纪律）：
//   - 抽象层 = 单文件多 provider，每个 provider dynamic import 第三方 SDK
//   - 缺 SDK / 缺 creds 时降级 mock provider（测试默认走 mock）
//   - 真实 credential 走 .env（GINA_HOMEKIT_USERNAME / GINA_HOMEKIT_PASSWORD）
//   - emotion-isolation 严守：设备控制只走"事实/状态"路径，不触发 joy，不进决策链路
//   - 跟 src/subagents/device-adapter.js 现有 DeviceSubAgent 框架兼容
//     （http/light 适配器是另一条线，本模块是 iot/scenarios 的底层数据通道）
//
// Provider 矩阵：
//   - official : hap-nodejs 官方协议（dynamic import；缺包不破）
//   - mock      : 内置 fake 智能家居（测试 + 缺 creds 时默认）
//
// 统一接口（每个 provider 暴露 6 函数）：
//   listDevices({ room?, type? })           → Device[]
//   getDevice(id)                            → Device | null
//   controlDevice(id, action, params = {})   → {ok, state, provider}
//   subscribe(eventHandler)                  → unsubscribe
//   listRooms()                              → Room[]
//   getStatus()                              → ProviderStatus
//
// Device 统一结构（见 ADR-012 §3.4）：
//   { id, provider, name, type, room, capabilities, state, controllable,
//     roomId, homeId, lastUpdated, raw }

import { config as appConfig } from '../config.js'

// ── Provider registry（动态 require 第三方 SDK，缺包不破） ─────────────────
const PROVIDER_LOADERS = {
  official: () => import('hap-nodejs').then((m) => m).catch(() => null),
  mock: async () => (await import('./_mock-iot.js')).homekitMockProvider,
}

// ── 统一 Device 形状归一化 ────────────────────────────────────────────────
function normalizeDevice(provider, raw) {
  if (!raw) return null
  const caps = Array.isArray(raw.capabilities) ? raw.capabilities : []
  return {
    id: String(raw.id),
    provider,
    name: String(raw.name || raw.id),
    type: String(raw.type || 'other'),
    room: raw.room || '未分配',
    roomId: raw.roomId || null,
    homeId: raw.homeId || null,
    capabilities: caps,
    state: {
      on: typeof raw.state?.on === 'boolean' ? raw.state.on : false,
      brightness: typeof raw.state?.brightness === 'number' ? raw.state.brightness : null,
      colorTemp: typeof raw.state?.colorTemp === 'number' ? raw.state.colorTemp : null,
      color: raw.state?.color || null,
      temperature: typeof raw.state?.temperature === 'number' ? raw.state.temperature : null,
      humidity: typeof raw.state?.humidity === 'number' ? raw.state.humidity : null,
      battery: typeof raw.state?.battery === 'number' ? raw.state.battery : null,
      locked: typeof raw.state?.locked === 'boolean' ? raw.state.locked : null,
      online: raw.state?.online !== false,
      raw: raw.state?.raw || null,
    },
    controllable: raw.controllable !== false,
    lastUpdated: raw.lastUpdated || new Date().toISOString(),
    raw: raw.raw || null,
  }
}

// ── Provider 实现：mock（默认 / 测试 / 降级） ──────────────────────────────
function makeHomekitMockProvider({ initialDevices = [] } = {}) {
  const rooms = [
    { id: 'room-living', name: '客厅' },
    { id: 'room-bedroom', name: '卧室' },
    { id: 'room-kitchen', name: '厨房' },
  ]
  const homes = [{ id: 'home-default', name: '我的家' }]

  const defaultDevices = [
    {
      id: 'homekit.light.living-room-01',
      name: '客厅主灯',
      type: 'light',
      room: '客厅',
      roomId: 'room-living',
      homeId: 'home-default',
      capabilities: ['on_off', 'brightness', 'color_temp'],
      state: { on: false, brightness: 80, colorTemp: 4000, online: true },
    },
    {
      id: 'homekit.light.bedroom-01',
      name: '卧室灯',
      type: 'light',
      room: '卧室',
      roomId: 'room-bedroom',
      homeId: 'home-default',
      capabilities: ['on_off', 'brightness'],
      state: { on: false, brightness: 60, online: true },
    },
    {
      id: 'homekit.ac.bedroom-01',
      name: '卧室空调',
      type: 'ac',
      room: '卧室',
      roomId: 'room-bedroom',
      homeId: 'home-default',
      capabilities: ['on_off', 'set_temperature', 'set_fan_speed'],
      state: { on: false, temperature: 24, raw: { mode: 'cool' }, online: true },
    },
    {
      id: 'homekit.lock.front-door-01',
      name: '前门门锁',
      type: 'lock',
      room: '客厅',
      roomId: 'room-living',
      homeId: 'home-default',
      capabilities: ['lock'],
      state: { locked: true, battery: 87, online: true },
    },
    {
      id: 'homekit.sensor.living-room-01',
      name: '客厅温湿度',
      type: 'sensor',
      room: '客厅',
      roomId: 'room-living',
      homeId: 'home-default',
      capabilities: [],
      state: { temperature: 22, humidity: 55, battery: 92, online: true },
    },
  ]
  const devices = new Map()
  let counter = 1
  for (const d of [...defaultDevices, ...initialDevices]) {
    const id = d.id || `homekit.dev-${counter++}`
    devices.set(id, { ...d, id, lastUpdated: d.lastUpdated || new Date().toISOString() })
  }
  const eventHandlers = new Set()

  function emit(event) {
    for (const h of eventHandlers) {
      try { h(event) } catch { /* 单 handler 失败不阻断 */ }
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  return {
    kind: 'mock',
    label: 'homekit-mock',
    listRooms: async () => rooms.map((r) => ({ ...r })),
    listDevices: async ({ room, type } = {}) => {
      const out = []
      for (const d of devices.values()) {
        if (room && d.room !== room) continue
        if (type && d.type !== type) continue
        out.push(normalizeDevice('homekit', d))
      }
      return out
    },
    getDevice: async (id) => {
      const d = devices.get(id)
      if (!d) return null
      return normalizeDevice('homekit', d)
    },
    controlDevice: async (id, action, params = {}) => {
      const d = devices.get(id)
      if (!d) return { ok: false, error: `device ${id} not found`, provider: 'homekit' }
      if (d.controllable === false) return { ok: false, error: `device ${id} not controllable`, provider: 'homekit' }
      // action → state 变更
      if (action === 'on_off') {
        d.state.on = Boolean(params.on)
      } else if (action === 'set_brightness') {
        const b = Number(params.brightness)
        if (!Number.isFinite(b)) return { ok: false, error: 'brightness 必须是数字', provider: 'homekit' }
        d.state.brightness = clamp(b, 0, 100)
        if (b > 0) d.state.on = true
      } else if (action === 'set_color_temp') {
        const k = Number(params.kelvin)
        if (!Number.isFinite(k)) return { ok: false, error: 'kelvin 必须是数字', provider: 'homekit' }
        d.state.colorTemp = clamp(k, 2000, 6500)
      } else if (action === 'set_color') {
        d.state.color = String(params.hex || '#FFFFFF')
      } else if (action === 'set_temperature') {
        const t = Number(params.temperature)
        if (!Number.isFinite(t)) return { ok: false, error: 'temperature 必须是数字', provider: 'homekit' }
        d.state.temperature = clamp(t, 16, 30)
        d.state.on = true
      } else if (action === 'set_fan_speed') {
        d.state.raw = { ...(d.state.raw || {}), fanSpeed: clamp(Number(params.speed) || 0, 0, 5) }
      } else if (action === 'lock') {
        d.state.locked = Boolean(params.locked)
      } else {
        return { ok: false, error: `unknown action ${action}`, provider: 'homekit' }
      }
      d.lastUpdated = new Date().toISOString()
      emit({ type: 'device_state_changed', deviceId: id, state: { ...d.state }, at: d.lastUpdated })
      return { ok: true, state: { ...d.state }, provider: 'homekit' }
    },
    subscribe: async (eventHandler) => {
      eventHandlers.add(eventHandler)
      return () => eventHandlers.delete(eventHandler)
    },
    getStatus: async () => ({
      ok: true,
      provider: 'homekit-mock',
      deviceCount: devices.size,
      homeCount: homes.length,
      lastUpdate: new Date().toISOString(),
    }),
    __test: { devices, eventHandlers, emit },
  }
}

// ── Provider 实现：official（hap-nodejs dynamic import） ───────────────────
// 注意：本实现为骨架 + 接口预留。真实 hap-nodejs 接入需要：
//   1. 用户运行 `pnpm add hap-nodejs`
//   2. macOS 上 HomeKit Accessory Protocol 通过 mDNS + IP
//   3. 配对（setup code + SRP6）→ 长期密钥
//   4. 用 hap-nodejs 的 Accessory / Service / Characteristic 模型映射 device
// Phase 4 提交：缺包 → 自动 fallback mock；老板手动 install 后可启用
function makeHomekitOfficialProvider({ credentials }) {
  let _Accessory = null
  let _HapStatusError = null
  async function ensureSDK() {
    if (_Accessory) return _Accessory
    const mod = await PROVIDER_LOADERS.official()
    if (!mod) throw new Error('hap-nodejs package not installed; run `pnpm add hap-nodejs`')
    _Accessory = mod.Accessory || mod.default?.Accessory || mod
    return _Accessory
  }

  return {
    kind: 'official',
    label: 'homekit-official',
    listRooms: async function () {
      await ensureSDK()
      // 真实实现：调 this._bridge.getRooms()；占位返回空
      return []
    },
    listDevices: async function ({ room, type } = {}) {
      await ensureSDK()
      // 真实实现：遍历 this._bridge.accessories → 归一化为 Device
      // 占位：返回空 + warn（提醒需要先配对）
      console.warn('[homekit.official] listDevices: skeleton only; real HomeKit bridge connection requires paired accessory store')
      return []
    },
    getDevice: async function (id) {
      await ensureSDK()
      console.warn('[homekit.official] getDevice: skeleton only')
      return null
    },
    controlDevice: async function (id, action, params = {}) {
      await ensureSDK()
      console.warn('[homekit.official] controlDevice: skeleton only; would dispatch to', id, action, params)
      return { ok: false, error: 'homekit official provider: skeleton only; use mock or implement bridge dispatch', provider: 'homekit' }
    },
    subscribe: async function (eventHandler) {
      await ensureSDK()
      console.warn('[homekit.official] subscribe: skeleton only')
      return () => {}
    },
    getStatus: async function () {
      await ensureSDK()
      return {
        ok: true,
        provider: 'homekit-official',
        note: 'skeleton implementation; install hap-nodejs + pair bridge to enable',
        credentials: Boolean(credentials?.username && credentials?.password),
      }
    },
  }
}

// ── 凭据读取 ─────────────────────────────────────────────────────────────
function readEnvCredentials() {
  return {
    username: process.env.GINA_HOMEKIT_USERNAME,
    password: process.env.GINA_HOMEKIT_PASSWORD,
  }
}

function credentialsLookComplete(creds) {
  return Boolean(creds?.username && creds?.password)
}

const _providerCache = new Map() // 'homekit' → { provider, createdAt }

export async function getHomekitProvider(provider = null) {
  const requested = provider || process.env.GINA_IOT_PROVIDER_HOMEKIT || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    instance = makeHomekitMockProvider()
  } else if (requested === 'official') {
    const creds = readEnvCredentials()
    if (!credentialsLookComplete(creds)) {
      console.warn('[homekit] official creds incomplete; falling back to mock')
      instance = makeHomekitMockProvider()
    } else {
      instance = makeHomekitOfficialProvider({ credentials: creds })
    }
  } else {
    throw new Error(`Unknown homekit provider: ${requested}`)
  }

  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 统一对外 API（老板唯一入口） ──────────────────────────────────────────
export async function listHomekitRooms({ provider = null } = {}) {
  const p = await getHomekitProvider(provider)
  return p.listRooms()
}

export async function listHomekitDevices({ provider = null, room, type } = {}) {
  const p = await getHomekitProvider(provider)
  return p.listDevices({ room, type })
}

export async function getHomekitDevice({ provider = null, id } = {}) {
  if (!id) throw new Error('getHomekitDevice: id 必填')
  const p = await getHomekitProvider(provider)
  return p.getDevice(id)
}

export async function controlHomekitDevice({ provider = null, id, action, params = {} } = {}) {
  if (!id) throw new Error('controlHomekitDevice: id 必填')
  if (!action) throw new Error('controlHomekitDevice: action 必填')
  const p = await getHomekitProvider(provider)
  return p.controlDevice(id, action, params)
}

export async function subscribeHomekit({ provider = null, eventHandler } = {}) {
  if (typeof eventHandler !== 'function') throw new Error('subscribeHomekit: eventHandler 必填（function）')
  const p = await getHomekitProvider(provider)
  return p.subscribe(eventHandler)
}

export async function getHomekitStatus({ provider = null } = {}) {
  const p = await getHomekitProvider(provider)
  return p.getStatus()
}

// ── Provider 元数据（暴露给 UI / 状态路由） ──────────────────────────────
export const HOMEKIT_PROVIDERS = [
  { id: 'mock', label: 'Mock（测试 / 降级）', default: true },
  { id: 'official', label: 'HomeKit (hap-nodejs)', env: 'GINA_HOMEKIT_*', pkg: 'hap-nodejs' },
]

export function getHomekitStatusAll() {
  return {
    providers: HOMEKIT_PROVIDERS,
    active: process.env.GINA_IOT_PROVIDER_HOMEKIT || 'mock',
    cached: [..._providerCache.keys()],
  }
}

// ── Test hook（跟 calendar.js __test 对齐，测试用注入） ─────────────────
export const __test = {
  _providerCache,
  makeHomekitMockProvider,
  readEnvCredentials,
  credentialsLookComplete,
  normalizeDevice,
}

// 显式 export 给 _mock-iot.js 复用
export { makeHomekitMockProvider }

// 显式 ignore unused appConfig 导入保留（后续按 config.security 走审批用）
void appConfig
