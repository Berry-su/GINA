// ip-locator.js — IP 反查国家/城市/时区（持续监测）
//
// 定位：GINA 知道老板当前在哪个国家/城市（不需 GPS 街道级）。
// 数据源：ip-api.com 免费公开 API（无 API Key），返回字段：
//   { status, query (IP), country, countryCode, region, regionName,
//     city, zip, lat, lon, timezone, isp, org, as }
//
// 默认采样 15 分钟/次（老板 9-07 14:31 拍板默认值）。
// 离线/超时时返回 null（不阻塞主流程）。
//
// 未来扩展：
//   - IP2Location / IPInfo 备选
//   - GPS 接入点（儿童手表）通过 registerProvider

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000  // 15 分钟
const MIN_POLL_INTERVAL_MS = 60 * 1000           // 最少 1 分钟（防热循环）
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_ENDPOINT = 'http://ip-api.com/json/?fields=status,query,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org'

// ─── 状态 ───────────────────────────────────────────────────

export function defaultLocatorState() {
  return {
    enabled: false,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    endpoint: DEFAULT_ENDPOINT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    timer: null,
    lastQuery: null,        // 上次 IP
    lastResult: null,       // 上次定位结果
    lastError: null,
    lastUpdatedAt: null,
    errorCount: 0,
    history: [],            // 最近 10 次定位（按时间倒序）
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function clampInterval(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return DEFAULT_POLL_INTERVAL_MS
  return Math.max(MIN_POLL_INTERVAL_MS, Math.floor(ms))
}

function trimHistory(arr, max = 10) {
  if (arr.length <= max) return arr
  return arr.slice(-max)
}

// 校验 IP API 返回结构
function isValidResult(r) {
  return r && typeof r === 'object' && r.status === 'success' && typeof r.country === 'string'
}

// ─── 公开 API ───────────────────────────────────────────────

// 单次定位（调用 IP API）
//   options: { endpoint, timeoutMs, fetcher }
//   fetcher: 自定义 fetch（生产是全局 fetch，测试是 mock）
//   返回: { result, error }
export async function locateOnce(options = {}) {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const fetcher = options.fetcher || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetcher) {
    return { result: null, error: 'no fetcher available' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetcher(endpoint, { signal: controller.signal })
    if (!res.ok) throw new Error(`IP API HTTP ${res.status}`)
    const data = await res.json()
    if (data.status && data.status !== 'success') {
      throw new Error(`IP API status: ${data.status}`)
    }
    return { result: data, error: null }
  } catch (e) {
    return { result: null, error: e?.message || String(e) }
  } finally {
    clearTimeout(timer)
  }
}

// 处理一次定位结果（更新 state + history）
//   options: { state, result, at }
export function recordLocation(state, result, options = {}) {
  if (!state) return null
  const at = typeof options.at === 'number' ? options.at : Date.now()
  if (result) {
    // 保留 prev（用于 motion detection 比较）
    if (state.lastResult) {
      state.prevResult = state.lastResult
    }
    state.lastResult = result
    state.lastQuery = result.query || state.lastQuery
    state.lastUpdatedAt = at
    state.lastError = null
    state.errorCount = 0
    state.history = trimHistory([
      ...state.history,
      { at, ip: result.query, country: result.country, countryCode: result.countryCode, city: result.city, region: result.regionName, timezone: result.timezone, lat: result.lat, lon: result.lon },
    ])
  } else {
    state.errorCount += 1
    state.lastError = options.error || 'unknown error'
  }
  return state
}

// 启动持续监测
//   options: { state, intervalMs, onUpdate, onError, fetcher }
//   onUpdate: (state) => {} 每次定位成功调用
//   onError:  (error) => {} 每次定位失败调用
export function startMonitoring(options = {}) {
  const state = options.state || defaultLocatorState()
  if (state.enabled) {
    return { state, error: 'monitoring already started' }
  }
  state.pollIntervalMs = clampInterval(options.intervalMs)
  state.endpoint = options.endpoint || DEFAULT_ENDPOINT
  state.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  state.enabled = true
  const poll = async () => {
    if (!state.enabled) return
    const r = await locateOnce({
      endpoint: state.endpoint,
      timeoutMs: state.timeoutMs,
      fetcher: options.fetcher,
    })
    recordLocation(state, r.result, { at: Date.now(), error: r.error })
    if (r.error) {
      if (typeof options.onError === 'function') {
        try { options.onError(r.error, state) } catch {}
      }
    } else {
      if (typeof options.onUpdate === 'function') {
        try { options.onUpdate(state) } catch {}
      }
    }
  }
  // 立即跑一次
  poll()
  state.timer = setInterval(poll, state.pollIntervalMs)
  return { state, error: null }
}

// 停止监测
export function stopMonitoring(state) {
  if (!state) return null
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.enabled = false
  return state
}

// 当前是否在监测
export function isMonitoring(state) {
  return !!(state && state.enabled && state.timer)
}

// 概览
export function getLocatorStats(state) {
  return {
    enabled: state.enabled,
    pollIntervalMs: state.pollIntervalMs,
    lastQuery: state.lastQuery,
    lastUpdatedAt: state.lastUpdatedAt,
    errorCount: state.errorCount,
    lastError: state.lastError,
    historySize: state.history.length,
    currentLocation: state.lastResult ? {
      country: state.lastResult.country,
      city: state.lastResult.city,
      timezone: state.lastResult.timezone,
    } : null,
  }
}

export {
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_ENDPOINT,
}
