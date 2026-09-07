// geo-tracker.js — 编排器：IP 持续监测 + 移动检测 + 事件触发 + 历史
//
// 定位：把 ip-locator + motion-detector 串成 GINA 持续位置感知主回路。
//
// 关键设计：
//   - 默认 15 分钟/次（老板 9-07 14:31 拍板）
//   - 移动检测后 emit `location_changed` 事件（主循环消费）
//   - 离线/超时降级（不阻塞主流程）
//   - 预留 GPS provider 接口（未来儿童手表）

import { defaultLocatorState, startMonitoring as startIPMonitoring, stopMonitoring as stopIPMonitoring, isMonitoring, recordLocation, locateOnce, getLocatorStats } from './ip-locator.js'
import { detectMotion, checkFromState, getMotionSummary } from './motion-detector.js'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000
const DEFAULT_MIN_DISTANCE_KM = 50
const MAX_HISTORY = 32

// ─── 状态 ───────────────────────────────────────────────────

export function defaultTrackerState() {
  return {
    locator: defaultLocatorState(),
    motionHistory: [],   // [{at, from, to, type, reason, distanceKm}]
    providers: [],        // [{name, getLocation}] 未来 GPS 接入
    minDistanceKm: DEFAULT_MIN_DISTANCE_KM,
    running: false,
    lastEventAt: null,
    startedAt: null,
  }
}

// ─── 内部 ───────────────────────────────────────────────────

function appendMotionHistory(state, motion, at) {
  if (!state.motionHistory) state.motionHistory = []
  state.motionHistory.push({ at, ...motion })
  if (state.motionHistory.length > MAX_HISTORY) {
    state.motionHistory = state.motionHistory.slice(-MAX_HISTORY)
  }
}

// ─── GPS 接入点（未来儿童手表等） ─────────────────────────

// 注册外部位置 provider
//   provider: { name: 'child-wristband', getLocation: async () => ({lat, lon, ...}) }
//   未来儿童手表接 GINA 时调用
export function registerProvider(state, provider) {
  if (!provider || typeof provider.name !== 'string' || typeof provider.getLocation !== 'function') {
    throw new Error('registerProvider: provider must have name + getLocation()')
  }
  if (!state.providers) state.providers = []
  state.providers.push(provider)
  return state
}

export function clearProviders(state) {
  if (state) state.providers = []
  return state
}

// 优先用 provider（如 GPS），降级到 IP
async function resolveLocation(state) {
  // 先试 provider（如未来儿童手表 GPS）
  if (state.providers && state.providers.length > 0) {
    for (const p of state.providers) {
      try {
        const r = await p.getLocation()
        if (r) {
          return { result: normalizeProviderResult(p.name, r), source: p.name }
        }
      } catch (e) {
        // 单个 provider 失败不影响其他
      }
    }
  }
  // 降级：IP
  return { result: null, source: 'ip-pending' }  // 实际 IP 由 startMonitoring 调
}

function normalizeProviderResult(name, r) {
  return {
    status: 'success',
    query: r.ip || 'provider',
    country: r.country || '',
    countryCode: r.countryCode || '',
    region: r.region || '',
    regionName: r.regionName || '',
    city: r.city || '',
    zip: r.zip || '',
    lat: r.lat,
    lon: r.lon,
    timezone: r.timezone || '',
    isp: r.isp || name,
    org: r.org || name,
    source: name,
  }
}

// ─── 启动 / 停止 ─────────────────────────────────────────

// 启动持续监测
//   options: { state, intervalMs, minDistanceKm, onUpdate, onMotion, onError, fetcher, providers }
//   onUpdate:  (state, location) => {} 每次定位成功
//   onMotion:  (motion, state) => {} 检测到移动
//   onError:   (error) => {} 定位失败
export function startGeoTracking(options = {}) {
  const state = options.state || defaultTrackerState()
  if (state.running) {
    return { state, error: 'geo tracking already running' }
  }
  state.minDistanceKm = options.minDistanceKm || DEFAULT_MIN_DISTANCE_KM
  state.running = true
  state.startedAt = Date.now()
  // 注册 providers
  if (Array.isArray(options.providers)) {
    for (const p of options.providers) registerProvider(state, p)
  }
  // 启动 IP 监测
  const ipState = state.locator
  startIPMonitoring({
    state: ipState,
    intervalMs: options.intervalMs,
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    fetcher: options.fetcher,
    onUpdate: (s) => {
      // 移动检测（用 onUpdate 触发时的 s.lastResult 作为 curr，跟前一帧比较）
      const motion = checkFromState(s, { curr: s.lastResult, minDistanceKm: state.minDistanceKm })
      if (motion.moved) {
        const at = Date.now()
        appendMotionHistory(state, motion, at)
        state.lastEventAt = at
        if (typeof options.onMotion === 'function') {
          try { options.onMotion(motion, state) } catch {}
        }
      }
      if (typeof options.onUpdate === 'function') {
        try { options.onUpdate(state, s.lastResult) } catch {}
      }
    },
    onError: (err, s) => {
      if (typeof options.onError === 'function') {
        try { options.onError(err, state) } catch {}
      }
    },
  })
  return { state, error: null }
}

export function stopGeoTracking(state) {
  if (!state) return null
  stopIPMonitoring(state.locator)
  state.running = false
  return state
}

export function isGeoTracking(state) {
  return !!(state && state.running && isMonitoring(state.locator))
}

// ─── 单次定位（手动触发） ─────────────────────────────────

export async function locateNow(options = {}) {
  const state = options.state
  if (!state) return { result: null, error: 'state required' }
  // 优先 provider
  const r = await resolveLocation(state)
  if (r.result) {
    recordLocation(state.locator, r.result, { at: Date.now() })
    return { result: r.result, error: null, source: r.source }
  }
  // IP
  const ipR = await locateOnce({ endpoint: state.locator.endpoint, timeoutMs: state.locator.timeoutMs, fetcher: options.fetcher })
  if (ipR.result) {
    recordLocation(state.locator, ipR.result, { at: Date.now(), error: ipR.error })
    return { result: ipR.result, error: null, source: 'ip-api' }
  }
  return { result: null, error: ipR.error, source: 'none' }
}

// ─── 概览 ──────────────────────────────────────────────────

export function getGeoOverview(options = {}) {
  const state = options.state
  if (!state) return null
  return {
    running: state.running,
    startedAt: state.startedAt,
    lastEventAt: state.lastEventAt,
    locator: getLocatorStats(state.locator),
    motionSummary: getMotionSummary(state.locator),
    motionEvents: (state.motionHistory || []).length,
    providers: (state.providers || []).map(p => p.name),
  }
}

// ─── 注入到对话（meta-info 段） ────────────────────────────

// 唯一对外渲染：当前位置 + 最近 3 次移动
// emotion-isolation 隔离：仍按 meta-info，不进决策路径
export function injectForGeo(state, options = {}) {
  const loc = state.locator
  if (!loc.lastResult) {
    return `## 地理位置 (geo · no data)\n\n（无定位信息）`
  }
  const cur = loc.lastResult
  const motions = (state.motionHistory || []).slice(-3).reverse()
  const lines = [
    `## 地理位置 (geo · v1)`,
    '',
    `- 国家: ${cur.country || '?'} (${cur.countryCode || '?'})`,
    `- 城市: ${cur.city || '?'}`,
    `- 时区: ${cur.timezone || '?'}`,
    `- IP: ${cur.query || '?'}`,
    `- ISP: ${cur.isp || '?'}`,
    `- 上次更新: ${cur.lastUpdatedAt ? new Date(cur.lastUpdatedAt).toISOString() : '?'}`,
  ]
  if (motions.length > 0) {
    lines.push('')
    lines.push(`最近 ${motions.length} 次移动：`)
    for (const m of motions) {
      const dist = m.distanceKm != null ? ` (${m.distanceKm.toFixed(0)} km)` : ''
      lines.push(`  - ${new Date(m.at).toISOString()} ${m.reason}${dist}`)
    }
  }
  lines.push('')
  lines.push('（这是 GINA 实时感知用户位置 meta-info，**不进决策路径**。）')
  return lines.join('\n')
}

export {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_MIN_DISTANCE_KM,
  MAX_HISTORY,
}
