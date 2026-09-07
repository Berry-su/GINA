// weather-fetcher.js — 多源天气数据拉取
//
// 定位：从多个公开数据源拉取实时天气数据。
// 复用现有 src/weather.js 的 wttr.in 客户端，扩展支持：
//   - wttr.in（免费，30 分钟轮询）— 实时温度/湿度/风/降水
//   - NMC 中央气象台（复用 typhoon-alert-monitor）— 7 类预警信号
//
// 数据格式标准化（统一返回）：
//   { source, fetchedAt, location, current: { temp, feelsLike, humidity, wind, precip, weather },
//     forecast: [{date, max, min, precip, weather}, ...] }

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_FETCH_TIMEOUT_MS = 8000
const DEFAULT_POLL_INTERVAL_MS = 30 * 60 * 1000  // 30 分钟
const MIN_POLL_INTERVAL_MS = 5 * 60 * 1000       // 最少 5 分钟
const WTTR_BASE = 'https://wttr.in'

// ─── 内部工具 ───────────────────────────────────────────────

function clampInterval(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return DEFAULT_POLL_INTERVAL_MS
  return Math.max(MIN_POLL_INTERVAL_MS, Math.floor(ms))
}

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function safeNum(v) {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return isFinite(n) ? n : null
  }
  return null
}

// ─── wttr.in 拉取 ──────────────────────────────────────────

// 单次 wttr.in 拉取（j1 格式 = JSON）
//   options: { location, timeoutMs, fetcher }
//   返回: { normalized, error }
export async function fetchWttr(location, options = {}) {
  if (!location) return { normalized: null, error: 'location required' }
  const timeoutMs = options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS
  const fetcher = options.fetcher || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetcher) return { normalized: null, error: 'no fetcher' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = `${WTTR_BASE}/${encodeURIComponent(String(location))}?format=j1&lang=zh`
    const res = await fetcher(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`wttr.in HTTP ${res.status}`)
    const data = await res.json()
    return { normalized: normalizeWttr(data, location), error: null }
  } catch (e) {
    return { normalized: null, error: e?.message || String(e) }
  } finally {
    clearTimeout(timer)
  }
}

// 解析 wttr.in JSON → 标准化格式
//   options: { data, location }
export function normalizeWttr(data, location) {
  if (!data || !data.current_condition || !data.current_condition[0]) return null
  const cur = data.current_condition[0]
  const weather = (cur.lang_zh && cur.lang_zh[0]?.value) || (cur.weatherDesc && cur.weatherDesc[0]?.value) || ''
  const forecast = (data.weather || []).slice(0, 3).map(day => ({
    date: day.date || null,
    max: safeNum(day.maxtempC),
    min: safeNum(day.mintempC),
    weather: (day.hourly?.[4]?.lang_zh?.[0]?.value) || '',
    precip: safeNum(day.hourly?.[4]?.precipMM) || 0,
    rainChance: safeNum(day.hourly?.[4]?.chanceofrain) || 0,
  }))
  return {
    source: 'wttr.in',
    fetchedAt: Date.now(),
    location: location || null,
    current: {
      temp: safeNum(cur.temp_C),
      feelsLike: safeNum(cur.FeelsLikeC),
      humidity: safeNum(cur.humidity),
      windSpeed: safeNum(cur.windspeedKmph),
      windDir: cur.winddir16Point || null,
      cloudcover: safeNum(cur.cloudcover),
      visibility: safeNum(cur.visibility),
      uvIndex: safeNum(cur.uvIndex),
      precip: safeNum(cur.precipMM),
      weather,
      weatherCode: safeNum(cur.weatherCode),
    },
    forecast,
  }
}

// ─── NMC 中央台预警拉取（复用 typhoon 模式） ─────────────────

// NMC 预警：复用 typhoon-alert-monitor 的 fetchAlertFeed
// 这里只做"拉 + 标准化"（不重复实现 NMC 解码）
//   options: { url, token, timeoutMs, fetcher }
//   返回: { alerts: [{type, level, region, content, issuedAt, source}] }
export async function fetchNMCAlerts(options = {}) {
  const url = options.url
  if (!url) return { alerts: [], error: 'url required' }
  const timeoutMs = options.timeoutMs || 12000
  const fetcher = options.fetcher || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetcher) return { alerts: [], error: 'no fetcher' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetcher(url, {
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`NMC HTTP ${res.status}`)
    const data = await res.json()
    const normalized = normalizeNMCAlerts(data)
    return { alerts: normalized, error: null }
  } catch (e) {
    return { alerts: [], error: e?.message || String(e) }
  } finally {
    clearTimeout(timer)
  }
}

// 标准化 NMC 预警格式
//   检测 7 大类（台风/暴雨/雷电/冰雹/寒潮/高温/大风）
//   4 级预警（蓝/黄/橙/红）
const ALERT_TYPE_PATTERNS = {
  typhoon: /台风|热带气旋|typhoon|tropical cyclone/i,
  rainstorm: /暴雨|强降水|rainstorm|heavy rain/i,
  thunderstorm: /雷电|雷暴|thunderstorm|thunder/i,
  hail: /冰雹|hail/i,
  cold_wave: /寒潮|强降温|cold wave/i,
  high_temp: /高温|酷热|high temperature|heat wave/i,
  wind: /大风|雷雨大风|wind|gale/i,
}

const ALERT_LEVELS = {
  blue: 'blue',
  yellow: 'yellow',
  orange: 'orange',
  red: 'red',
}

export function normalizeNMCAlerts(payload) {
  const rows = Array.isArray(payload) ? payload : (payload?.alerts || payload?.data?.alerts || payload?.data || payload?.records || [])
  if (!Array.isArray(rows)) return []
  const result = []
  for (const alert of rows) {
    const text = [alert.title, alert.headline, alert.description, alert.content, alert.type, alert.event, alert.region, alert.area, alert.level, alert.severity].filter(Boolean).join(' ')
    if (!text) continue
    // 类型识别
    let type = null
    for (const [t, re] of Object.entries(ALERT_TYPE_PATTERNS)) {
      if (re.test(text)) {
        type = t
        break
      }
    }
    if (!type) continue
    // 等级识别
    let level = null
    const lvlText = String(alert.level || alert.severity || '')
    for (const [k, v] of Object.entries(ALERT_LEVELS)) {
      if (lvlText.includes(k) || lvlText.includes(alert[k])) {
        level = v
        break
      }
    }
    // 简化：橙/红 = severe；蓝/黄 = warning
    if (!level) {
      if (/红色|red|橙色|orange/i.test(lvlText)) level = 'severe'
      else if (/黄色|yellow|蓝色|blue/i.test(lvlText)) level = 'warning'
    }
    if (!level) continue
    result.push({
      id: String(alert.id || alert.identifier || alert.warningId || `${type}-${alert.publishedAt || alert.issueTime || Date.now()}`),
      type,
      level,
      region: alert.region || alert.area || '',
      title: alert.title || alert.headline || alert.event || `${type}预警`,
      content: alert.description || alert.content || '',
      issuedAt: alert.publishedAt || alert.issueTime || alert.effective || null,
      source: 'NMC',
      rawText: text,
    })
  }
  return result
}

// ─── 主导出：单次拉取（多源） ─────────────────────────────

// 单次拉取（多源）
//   options: { location, nmcUrl, nmcToken, fetcher, sources }
//   sources: ['wttr', 'nmc'] 默认全开
//   返回: { wttr, nmc, combinedAt }
export async function fetchOnce(options = {}) {
  const location = options.location
  const sources = options.sources || ['wttr', 'nmc']
  const fetcher = options.fetcher
  const result = { wttr: null, nmc: [], combinedAt: Date.now(), error: null }
  if (sources.includes('wttr') && location) {
    const r = await fetchWttr(location, { fetcher })
    result.wttr = r.normalized
    if (r.error && !result.error) result.error = `wttr: ${r.error}`
  }
  if (sources.includes('nmc') && options.nmcUrl) {
    const r = await fetchNMCAlerts({
      url: options.nmcUrl,
      token: options.nmcToken,
      fetcher,
    })
    result.nmc = r.alerts
    if (r.error && !result.error) result.error = `nmc: ${r.error}`
  }
  return result
}

// 内部常量，外部使用 weather-monitor 的 DEFAULT_POLL_INTERVAL_MS
// 不导出避免与 weather-monitor 的同名常量冲突
export { DEFAULT_FETCH_TIMEOUT_MS, WTTR_BASE, ALERT_TYPE_PATTERNS, ALERT_LEVELS }
