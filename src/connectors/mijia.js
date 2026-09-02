// src/connectors/mijia.js — 米家 / 小米 IoT 连接器（ADR-012 · Phase 4）
//
// 设计目标：
//   老板说"扫地机器人开始"/"开 Yeelight"或"到家自动开 Yeelight" → GINA 跨米家
//   协议统一 listDevices / getDevice / controlDevice / subscribe。
//
// 设计原则（沿用 Phase 2 模式 + 9-02 老板纠错纪律）：
//   - 单文件多 provider，dynamic import 第三方 SDK（缺包不破）
//   - 缺 SDK / 缺 creds 时降级 mock provider（测试默认走 mock）
//   - 真实 credential 走 .env（GINA_MIJIA_USERNAME / GINA_MIJIA_PASSWORD / GINA_MIJIA_SERVER）
//   - emotion-isolation 严守：设备控制只走事实/状态路径，不触发 joy，不进决策链路
//
// Provider 矩阵：
//   - miio  : miio 包（Node.js 小米协议；dynamic import；缺包不破）
//   - mock  : 内置 fake 米家设备（测试 + 缺 creds 时默认）
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
  miio: () => import('miio').then((m) => m).catch(() => null),
  mock: async () => (await import('./_mock-iot.js')).mijiaMockProvider,
}

// ── Provider 实现：mock（默认 / 测试 / 降级） ──────────────────────────────
// mock 实际工厂在 _mock-iot.js；本文件 re-export 走 getMijiaProvider
// 真实 miio provider 是骨架：dynamic import miio，缺包 → 抛错（fallback mock）

function makeMijiaOfficialProvider({ credentials }) {
  let _miio = null
  async function ensureSDK() {
    if (_miio) return _miio
    const mod = await PROVIDER_LOADERS.miio()
    if (!mod) throw new Error('miio package not installed; run `pnpm add miio`')
    _miio = mod
    return _miio
  }
  return {
    kind: 'miio',
    label: 'mijia-miio',
    listRooms: async function () {
      await ensureSDK()
      console.warn('[mijia.miio] listRooms: skeleton only; real miio discovery requires token + server region')
      return []
    },
    listDevices: async function () {
      await ensureSDK()
      console.warn('[mijia.miio] listDevices: skeleton only; would call miio.device() on token + server')
      return []
    },
    getDevice: async function (id) {
      await ensureSDK()
      console.warn('[mijia.miio] getDevice: skeleton only', id)
      return null
    },
    controlDevice: async function (id, action, params = {}) {
      await ensureSDK()
      console.warn('[mijia.miio] controlDevice: skeleton only; would dispatch via miio.call()', { id, action, params })
      return { ok: false, error: 'mijia miio provider: skeleton only; use mock or implement miio.call() bridge', provider: 'mijia' }
    },
    subscribe: async function (eventHandler) {
      await ensureSDK()
      console.warn('[mijia.miio] subscribe: skeleton only')
      return () => {}
    },
    getStatus: async function () {
      await ensureSDK()
      return {
        ok: true,
        provider: 'mijia-miio',
        note: 'skeleton implementation; install miio + configure GINA_MIJIA_* to enable',
        server: credentials?.server || 'cn',
        credentialsComplete: Boolean(credentials?.username && credentials?.password),
      }
    },
  }
}

// ── 凭据读取 ─────────────────────────────────────────────────────────────
function readEnvCredentials() {
  return {
    username: process.env.GINA_MIJIA_USERNAME,
    password: process.env.GINA_MIJIA_PASSWORD,
    server: process.env.GINA_MIJIA_SERVER || 'cn',
  }
}

function credentialsLookComplete(creds) {
  // 真实接入既需 username+password 也可走 token；本骨架要求 username+password
  return Boolean(creds?.username && creds?.password)
}

const _providerCache = new Map()

export async function getMijiaProvider(provider = null) {
  const requested = provider || process.env.GINA_IOT_PROVIDER_MIJIA || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    const { mijiaMockProvider } = await import('./_mock-iot.js')
    instance = mijiaMockProvider()
  } else if (requested === 'miio') {
    const creds = readEnvCredentials()
    if (!credentialsLookComplete(creds)) {
      console.warn('[mijia] miio creds incomplete; falling back to mock')
      const { mijiaMockProvider } = await import('./_mock-iot.js')
      instance = mijiaMockProvider()
    } else {
      instance = makeMijiaOfficialProvider({ credentials: creds })
    }
  } else {
    throw new Error(`Unknown mijia provider: ${requested}`)
  }

  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 统一对外 API（老板唯一入口） ──────────────────────────────────────────
export async function listMijiaRooms({ provider = null } = {}) {
  const p = await getMijiaProvider(provider)
  return p.listRooms()
}

export async function listMijiaDevices({ provider = null, room, type } = {}) {
  const p = await getMijiaProvider(provider)
  return p.listDevices({ room, type })
}

export async function getMijiaDevice({ provider = null, id } = {}) {
  if (!id) throw new Error('getMijiaDevice: id 必填')
  const p = await getMijiaProvider(provider)
  return p.getDevice(id)
}

export async function controlMijiaDevice({ provider = null, id, action, params = {} } = {}) {
  if (!id) throw new Error('controlMijiaDevice: id 必填')
  if (!action) throw new Error('controlMijiaDevice: action 必填')
  const p = await getMijiaProvider(provider)
  return p.controlDevice(id, action, params)
}

export async function subscribeMijia({ provider = null, eventHandler } = {}) {
  if (typeof eventHandler !== 'function') throw new Error('subscribeMijia: eventHandler 必填（function）')
  const p = await getMijiaProvider(provider)
  return p.subscribe(eventHandler)
}

export async function getMijiaStatus({ provider = null } = {}) {
  const p = await getMijiaProvider(provider)
  return p.getStatus()
}

// ── Provider 元数据（暴露给 UI / 状态路由） ──────────────────────────────
export const MIJIA_PROVIDERS = [
  { id: 'mock', label: 'Mock（测试 / 降级）', default: true },
  { id: 'miio', label: '米家 (miio)', env: 'GINA_MIJIA_*', pkg: 'miio' },
]

export function getMijiaStatusAll() {
  return {
    providers: MIJIA_PROVIDERS,
    active: process.env.GINA_IOT_PROVIDER_MIJIA || 'mock',
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
