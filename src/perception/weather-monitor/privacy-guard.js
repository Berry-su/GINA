// privacy-guard.js — 极端天气隐私保护
//
// 老板 9-07 翻身纪律 + 类比 geo-tracker / emotion 隔离：
//   1. 不持久化精确坐标（仅城市级 + 区域名）
//   2. API Key 走 macOS keychain / OAuth（不写明文到 .env）
//   3. 不传老板个人位置信息到任何云端（除非用户显式同意）
//   4. 不进决策路径（meta-info 隔离）

import {
  isLocalOnly,
  defaultConsentState,
  grant,
  revoke,
  isGranted,
  ALLOWED_DETECTORS,
  NETWORK_BLOCKED_HOSTS,
  MAX_TRACKER_WINDOW,
} from '../visual-emotion/privacy-guard.js'

// 天气 API 白名单（仅免费公开 API）
const ALLOWED_WEATHER_ENDPOINTS = [
  /^https?:\/\/wttr\.in\//,
  /^https?:\/\/api\.caiyunapp\.com\//,
  /^https?:\/\/restapi\.amap\.com\//,  // 高德天气
  /^https?:\/\/data\.cma\.cn\//,        // NMC 中央台
  /^https?:\/\/api\.qweather\.com\//,    // 和风天气
  /^https?:\/\/dev\.api\.qweather\.com\//,
]

// 禁止持久化的字段
const FORBIDDEN_PERSISTENT_FIELDS = [
  'lat', 'lon',  // 坐标
  'isp',         // ISP
  'user_id',     // 用户标识
]

// 允许持久化的字段（城市级 + 预警）
const ALLOWED_PERSISTENT_FIELDS = [
  'type', 'severity', 'message', 'location', 'region',
  'temp', 'weather', 'feelsLike', 'humidity', 'windSpeed',
  'precip', 'issuedAt', 'detectedAt', 'at', 'source',
]

// 验证 endpoint 合法
export function isAllowedWeatherEndpoint(url) {
  if (typeof url !== 'string') return false
  for (const re of ALLOWED_WEATHER_ENDPOINTS) {
    if (re.test(url)) return true
  }
  return false
}

// 清理单条极端预警
export function sanitizeAlert(alert) {
  if (!alert || typeof alert !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(alert)) {
    if (FORBIDDEN_PERSISTENT_FIELDS.includes(k)) continue
    out[k] = v
  }
  return out
}

// 清理 wttr 拉取结果
export function sanitizeWttr(wttr) {
  if (!wttr || typeof wttr !== 'object') return null
  return {
    source: wttr.source,
    fetchedAt: wttr.fetchedAt,
    location: wttr.location,
    current: wttr.current ? {
      temp: wttr.current.temp,
      feelsLike: wttr.current.feelsLike,
      humidity: wttr.current.humidity,
      windSpeed: wttr.current.windSpeed,
      windDir: wttr.current.windDir,
      weather: wttr.current.weather,
      precip: wttr.current.precip,
    } : null,
  }
}

// 清理 NMC 预警数组
export function sanitizeNMCAlerts(alerts) {
  if (!Array.isArray(alerts)) return []
  return alerts.map(sanitizeAlert).filter(Boolean)
}

// 验证 alert 不含禁止字段
export function isAlertClean(alert) {
  if (!alert) return true
  for (const f of FORBIDDEN_PERSISTENT_FIELDS) {
    if (f in alert) return false
  }
  return true
}

// 清理 alert history
export function clearAlertHistory(state) {
  if (state && Array.isArray(state.alertHistory)) {
    state.alertHistory = []
  }
  return state
}

export {
  FORBIDDEN_PERSISTENT_FIELDS,
  ALLOWED_PERSISTENT_FIELDS,
  ALLOWED_WEATHER_ENDPOINTS,
}
