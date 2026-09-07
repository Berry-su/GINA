// privacy-guard.js — 台风监测隐私保护
//
// 老板 9-07 翻身纪律 + 类比 geo-tracker / weather-monitor：
//   1. 不持久化精确坐标（台风中心 / 老板位置都只缓存城市级）
//   2. 仅 NMC 中央台公开数据
//   3. 离线降级
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

// 台风 API 白名单
const ALLOWED_TYPHOON_ENDPOINTS = [
  /^https?:\/\/typhoon\.nmc\.cn\//,
  /^https?:\/\/www\.typhoon\.gov\.cn\//,
  /^https?:\/\/data\.cma\.cn\//,
  /^https?:\/\/weather\.imd\.gov\.in\//,  // 印度气象局
  /^https?:\/\/www\.jma\.go\.jp\//,           // 日本气象厅
]

// 禁止持久化
const FORBIDDEN_PERSISTENT_FIELDS = [
  'isp', 'as', 'org',
]

// 允许持久化（公开台风信息）
const ALLOWED_PERSISTENT_FIELDS = [
  'id', 'name', 'level', 'levelLabel', 'status',
  'lat', 'lon', 'maxWind', 'centerPressure',
  'forecastPath', 'windCircle7', 'windCircle10', 'windCircle12',
  'fetchedAt', 'issuedAt',
]

// 验证 endpoint
export function isAllowedTyphoonEndpoint(url) {
  if (typeof url !== 'string') return false
  for (const re of ALLOWED_TYPHOON_ENDPOINTS) {
    if (re.test(url)) return true
  }
  return false
}

// 清理台风数据
export function sanitizeTyphoon(typhoon) {
  if (!typhoon || typeof typhoon !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(typhoon)) {
    if (FORBIDDEN_PERSISTENT_FIELDS.includes(k)) continue
    out[k] = v
  }
  return out
}

// 清理影响评估
export function sanitizeImpact(impact) {
  if (!impact || typeof impact !== 'object') return null
  return {
    impacted: impact.impacted,
    level: impact.level,
    distanceKm: impact.distanceKm,
    impactType: impact.impactType,
    severity: impact.severity,
    message: impact.message,
    typhoonName: impact.typhoonName,
    typhoonLevel: impact.typhoonLevel,
  }
}

// 验证 typhoon 数据不含禁止字段
export function isTyphoonClean(typhoon) {
  if (!typhoon) return true
  for (const f of FORBIDDEN_PERSISTENT_FIELDS) {
    if (f in typhoon) return false
  }
  return true
}

// 清理 impact history
export function clearImpactHistory(state) {
  if (state && Array.isArray(state.impactHistory)) {
    state.impactHistory = []
  }
  return state
}

export {
  FORBIDDEN_PERSISTENT_FIELDS,
  ALLOWED_PERSISTENT_FIELDS,
  ALLOWED_TYPHOON_ENDPOINTS,
}
