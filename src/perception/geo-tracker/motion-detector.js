// motion-detector.js — 移动检测（IP / 时区 / 国家 / 城市 4 类）
//
// 定位：GINA 检测老板"换地方了"（出差 / 移动 / 出国）。
// 4 类变化检测（任一触发 = 移动事件）：
//   1. IP 变化
//   2. 时区变化
//   3. 国家变化
//   4. 城市变化
//
// 老板场景：深圳 → 北京（IP / 时区 / 国家 / 城市都变）
// 老板场景：深圳 → 汕尾（IP 变，城市变，但国家 + 时区不变）

// ─── 常量 ───────────────────────────────────────────────────

const MIN_DISTANCE_KM = 50  // < 50km 视为未移动（防 IP 跳变）
const SAME_CITY_THRESHOLD_KM = 25  // 城市半径

// ─── 工具 ───────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  if (typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
      typeof lat2 !== 'number' || typeof lon2 !== 'number') return null
  const toRad = (d) => d * Math.PI / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ─── 公开 API ───────────────────────────────────────────────

// 单次检测：从 prev → curr 是否移动
//   options: { prev, curr, minDistanceKm }
//   prev/curr: ip-locator 输出的 result
//   返回: { moved, type, distanceKm, from, to }
//
// 优先级（IP 最直接 → 时区最弱）：
//   1. ip_changed         (IP 不同 = 几乎肯定移动)
//   2. country_changed    (country 不同)
//   3. city_changed       (city 不同 + 距离 > threshold)
//   4. timezone_changed   (timezone 不同)
export function detectMotion(options = {}) {
  const prev = options.prev
  const curr = options.curr
  const minDistance = options.minDistanceKm || MIN_DISTANCE_KM
  if (!prev || !curr) {
    return { moved: false, type: null, distanceKm: null, reason: 'missing prev or curr' }
  }
  const from = { country: prev.country, countryCode: prev.countryCode, city: prev.city, timezone: prev.timezone, lat: prev.lat, lon: prev.lon, ip: prev.query }
  const to = { country: curr.country, countryCode: curr.countryCode, city: curr.city, timezone: curr.timezone, lat: curr.lat, lon: curr.lon, ip: curr.query }
  const distanceKm = haversineKm(prev.lat, prev.lon, curr.lat, curr.lon)
  // 1) IP 变化（最直接）
  if (prev.query && curr.query && prev.query !== curr.query) {
    return {
      moved: true,
      type: 'ip_changed',
      distanceKm,
      from,
      to,
      reason: `IP ${prev.query} → ${curr.query}`,
    }
  }
  // 2) 国家变化
  if (prev.countryCode && curr.countryCode && prev.countryCode !== curr.countryCode) {
    return {
      moved: true,
      type: 'country_changed',
      distanceKm,
      from,
      to,
      reason: `country ${prev.country} → ${curr.country}`,
    }
  }
  // 3) 城市变化 + 距离检查
  if (prev.city && curr.city && prev.city !== curr.city) {
    if (distanceKm == null || distanceKm >= minDistance) {
      return {
        moved: true,
        type: 'city_changed',
        distanceKm,
        from,
        to,
        reason: `city ${prev.city} → ${curr.city}` + (distanceKm != null ? ` (${distanceKm.toFixed(0)} km)` : ''),
      }
    }
  }
  // 4) 时区变化（最弱）
  if (prev.timezone && curr.timezone && prev.timezone !== curr.timezone) {
    return {
      moved: true,
      type: 'timezone_changed',
      distanceKm,
      from,
      to,
      reason: `timezone ${prev.timezone} → ${curr.timezone}`,
    }
  }
  return { moved: false, type: null, distanceKm, from, to, reason: 'no significant change' }
}

// 连续监测：每次新定位结果 + 历史 prev 比较
//   options: { state, curr, minDistanceKm }
//   优先用 state.prevResult（locator 在 recordLocation 时已存）
//   返回: detection result
export function checkFromState(state, options = {}) {
  if (!state) return { moved: false, type: null, reason: 'no state' }
  const prev = state.prevResult
  if (!prev) return { moved: false, type: null, reason: 'no prior result' }
  return detectMotion({
    prev,
    curr: options.curr || state.lastResult,
    minDistanceKm: options.minDistanceKm,
  })
}

// 概览：当前 + 历史
export function getMotionSummary(state) {
  if (!state || state.history.length === 0) {
    return { hasHistory: false, currentLocation: null, previousLocations: [] }
  }
  const sorted = [...state.history].sort((a, b) => b.at - a.at)
  return {
    hasHistory: true,
    currentLocation: sorted[0],
    previousLocations: sorted.slice(1),
  }
}

export {
  MIN_DISTANCE_KM,
  SAME_CITY_THRESHOLD_KM,
  haversineKm,
}
