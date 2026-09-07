// typhoon-fetcher.js — 拉所有台风数据（不限定老板城市）
//
// 定位：从 NMC 中央气象台拉"所有"台风数据，不限定老板位置。
// 老板位置匹配由 impact-detector 处理（基于台风路径 + 老板当前位置）。
//
// 数据源：NMC typhoon.nmc.cn（已用过的 + 中央台预警流）
//   - typhoon.nmc.cn/weatherservice/typhoon/jsons/* — 实时台风路径
//   - data.cma.cn — 预警发布

// ─── 常量 ───────────────────────────────────────────────────

const NMC_TYPHOON_BASE = 'https://typhoon.nmc.cn/weatherservice/typhoon/jsons'
const NMC_ALERT_DEFAULT = 'https://data.cma.cn/alerts'
const FETCH_TIMEOUT_MS = 12000
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 分钟
const MIN_POLL_INTERVAL_MS = 60 * 1000

// 台风等级（中央台 6 级）
const TYPHOON_LEVELS = {
  TD: 'TD',     // 热带低压
  TS: 'TS',     // 热带风暴
  STS: 'STS',   // 强热带风暴
  TY: 'TY',     // 台风
  STY: 'STY',   // 强台风
  SuperTY: 'SuperTY',  // 超强台风
}

const TYPHOON_LEVEL_LABELS = {
  TD: '热带低压',
  TS: '热带风暴',
  STS: '强热带风暴',
  TY: '台风',
  STY: '强台风',
  SuperTY: '超强台风',
  EXTD: '温带气旋',
}

// ─── 工具 ───────────────────────────────────────────────────

function clampInterval(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return DEFAULT_POLL_INTERVAL_MS
  return Math.max(MIN_POLL_INTERVAL_MS, Math.floor(ms))
}

function safeNum(v) {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return isFinite(n) ? n : null
  }
  return null
}

// 标准化台风数据（来自 NMC typhoon JSONP）
//   options: { data, name, id }
//   返回: { id, name, level, status, lat, lon, maxWind, centerPressure, forecastPath }
export function normalizeNmcTyphoon(data) {
  if (!data || typeof data !== 'object') return null
  const id = String(data.typhoonId || data.id || data.code || 'unknown')
  const name = data.name || data.typhoonName || data.cnname || 'unknown'
  const level = data.typhoonType || data.level || 'TD'
  const status = data.status || 'active'
  // 当前中心位置
  const lat = safeNum(data.lat)
  const lon = safeNum(data.lon)
  // 最大风速（m/s）
  const maxWind = safeNum(data.maxWindSpeed || data.windSpeed || data.wind)
  // 中心气压（hPa）
  const centerPressure = safeNum(data.pressure || data.centerPressure)
  // 预报路径（7 个点）
  const forecastPath = []
  if (Array.isArray(data.forecast)) {
    for (const p of data.forecast) {
      const plat = safeNum(p.lat || p.latitude)
      const plon = safeNum(p.lon || p.longitude)
      if (plat != null && plon != null) {
        forecastPath.push({
          at: p.time || p.forecastTime || null,
          lat: plat,
          lon: plon,
          intensity: p.typhoonType || p.intensity || null,
        })
      }
    }
  }
  // 7 级风圈半径（km）— 影响范围
  const windCircle7 = safeNum(data.windCircle7 || data.windRadius7)  // 大风圈
  const windCircle10 = safeNum(data.windCircle10 || data.windRadius10)  // 暴风圈
  const windCircle12 = safeNum(data.windCircle12 || data.windRadius12)  // 台风圈
  return {
    id,
    name,
    level,
    levelLabel: TYPHOON_LEVEL_LABELS[level] || level,
    status,
    lat,
    lon,
    maxWind,
    centerPressure,
    forecastPath,
    windCircle7,
    windCircle10,
    windCircle12,
    source: 'NMC',
    fetchedAt: Date.now(),
  }
}

// ─── NMC typhoon JSONP 拉取（复用 src/typhoon.js 模式） ─────

async function fetchJsonp(url, options = {}) {
  const fetcher = options.fetcher || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetcher) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetcher(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    // 解析 JSONP: name({...})
    const start = text.indexOf('(')
    const end = text.lastIndexOf(')')
    if (start < 0 || end <= start) throw new Error('JSONP format invalid')
    return JSON.parse(text.slice(start + 1, end))
  } finally {
    clearTimeout(timer)
  }
}

// 拉所有活跃台风列表
//   options: { fetcher }
//   返回: { typhoons: [...normalized], error }
export async function fetchAllActiveTyphoons(options = {}) {
  try {
    const data = await fetchJsonp(`${NMC_TYPHOON_BASE}/list_active`, options)
    if (!data) return { typhoons: [], error: 'no fetcher' }
    // list_active 返回的是数组（每个活跃台风）
    const arr = Array.isArray(data) ? data : (data.typhoons || data.list || [])
    if (!Array.isArray(arr)) return { typhoons: [], error: 'invalid format' }
    const typhoons = arr.map(normalizeNmcTyphoon).filter(Boolean)
    return { typhoons, error: null }
  } catch (e) {
    return { typhoons: [], error: e?.message || String(e) }
  }
}

// 拉单个台风的详细路径
//   options: { typhoonId, fetcher }
//   返回: { typhoon: {...normalized}, error }
export async function fetchTyphoonDetail(typhoonId, options = {}) {
  if (!typhoonId) return { typhoon: null, error: 'typhoonId required' }
  try {
    const data = await fetchJsonp(`${NMC_TYPHOON_BASE}/detail?id=${encodeURIComponent(typhoonId)}`, options)
    if (!data) return { typhoon: null, error: 'no fetcher' }
    const typhoon = normalizeNmcTyphoon(data)
    return { typhoon, error: typhoon ? null : 'invalid format' }
  } catch (e) {
    return { typhoon: null, error: e?.message || String(e) }
  }
}

// 拉所有 typhoon 预警（来自 NMC 中央台预警流，复用 typhoon-alert-monitor 的模式）
//   options: { alertUrl, token, fetcher }
//   返回: { alerts: [...normalized], error }
export async function fetchNmcAlerts(options = {}) {
  const url = options.alertUrl || NMC_ALERT_DEFAULT
  const fetcher = options.fetcher || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetcher) return { alerts: [], error: 'no fetcher' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetcher(url, {
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    // 复用 weather-monitor 的 normalizeNMCAlerts（识别 7 类）
    const { normalizeNMCAlerts } = await import('../weather-monitor/weather-fetcher.js')
    return { alerts: normalizeNMCAlerts(data), error: null }
  } catch (e) {
    return { alerts: [], error: e?.message || String(e) }
  } finally {
    clearTimeout(timer)
  }
}

// ─── 主导出：单次拉取（多源） ─────────────────────────────

export async function fetchOnce(options = {}) {
  const fetcher = options.fetcher
  const result = { typhoons: [], alerts: [], combinedAt: Date.now(), error: null }
  // 拉所有活跃台风
  const t = await fetchAllActiveTyphoons({ fetcher })
  result.typhoons = t.typhoons
  if (t.error && !result.error) result.error = `typhoons: ${t.error}`
  // 拉预警
  if (options.alertUrl || true) {
    const a = await fetchNmcAlerts({ alertUrl: options.alertUrl, token: options.alertToken, fetcher })
    result.alerts = a.alerts
    if (a.error && !result.error) result.error = `alerts: ${a.error}`
  }
  return result
}

export {
  NMC_TYPHOON_BASE,
  NMC_ALERT_DEFAULT,
  FETCH_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  TYPHOON_LEVELS,
  TYPHOON_LEVEL_LABELS,
}
