// privacy-guard.js — 地理追踪隐私保护
//
// 老板 9-07 14:31 翻身的硬约束：
//   1. 不持久化精确坐标（仅国家/城市级）
//   2. 仅 IP 定位（不调用任何云端高精度 API）
//   3. 离线/超时不阻塞主流程
//   4. 未来 GPS 接入点（儿童手表）由调用方负责精度，老板当前不需要
//   5. 位置信息仅 meta-info（ADR-002 emotion-isolation 类比：geo 也不进决策路径）

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

// 地理专用：禁止持久化的精确字段
const FORBIDDEN_PERSISTENT_FIELDS = [
  'lat',         // 精确纬度（不要持久化）
  'lon',         // 精确经度（不要持久化）
  'street',      // 街道
  'houseNumber', // 门牌
  'zip',         // 邮编（部分地区可定位街区）
  'isp',         // ISP（暴露运营商细节）
  'as',          // AS 号
  'org',         // 组织
]

// 允许持久化的字段（仅国家/城市级）
const ALLOWED_PERSISTENT_FIELDS = [
  'country',
  'countryCode',
  'region',
  'regionName',
  'city',
  'timezone',
  'at',
  'ip',         // 允许 IP（不算精确）
]

// 立即清理单次定位结果
export function sanitizeLocation(result) {
  if (!result || typeof result !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(result)) {
    if (FORBIDDEN_PERSISTENT_FIELDS.includes(k)) continue
    if (k === 'lat' || k === 'lon') continue
    if (!ALLOWED_PERSISTENT_FIELDS.includes(k) && !['status', 'query', 'message'].includes(k)) {
      // 未知字段也去掉（防止 API 返回新字段泄漏精确信息）
      continue
    }
    out[k] = v
  }
  return out
}

// 立即清理 motion 检测结果
export function sanitizeMotion(motion) {
  if (!motion || typeof motion !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(motion)) {
    if (k === 'from' || k === 'to') {
      // from/to 嵌套对象也清理
      out[k] = sanitizeLocation(v)
    } else if (FORBIDDEN_PERSISTENT_FIELDS.includes(k)) {
      continue
    } else {
      out[k] = v
    }
  }
  return out
}

// 验证 location 不含禁止字段
export function isLocationClean(location) {
  if (!location) return true
  for (const f of FORBIDDEN_PERSISTENT_FIELDS) {
    if (f in location) return false
  }
  return true
}

// 验证 IP API endpoint 合法（白名单：ip-api.com / IP2Location / IPInfo）
const ALLOWED_IP_ENDPOINTS = [
  /^https?:\/\/ip-api\.com\//,
  /^https?:\/\/ip2location\.com\//,
  /^https?:\/\/ipinfo\.io\//,
  /^https?:\/\/(?:api|ip)\.ipify\.org\//,
  /^http:\/\/ip-api\.com\//,  // http 仍允许（IP API 公开）
]
export function isAllowedEndpoint(url) {
  if (typeof url !== 'string') return false
  for (const re of ALLOWED_IP_ENDPOINTS) {
    if (re.test(url)) return true
  }
  return false
}

// 清理 motion history
export function clearMotionHistory(state) {
  if (state && Array.isArray(state.motionHistory)) {
    state.motionHistory = []
  }
  return state
}

// 清理 locator history（保留国家/城市级，去掉 lat/lon/isp/org）
export function clearLocatorHistory(state) {
  if (state && state.locator && Array.isArray(state.locator.history)) {
    state.locator.history = state.locator.history.map(h => sanitizeLocation(h)).filter(Boolean)
  }
  return state
}

export {
  FORBIDDEN_PERSISTENT_FIELDS,
  ALLOWED_PERSISTENT_FIELDS,
  ALLOWED_IP_ENDPOINTS,
}
