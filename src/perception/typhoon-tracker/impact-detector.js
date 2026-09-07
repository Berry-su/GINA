// impact-detector.js — 台风影响范围检测（路径 + 老板位置）
//
// 定位：判断台风是否影响老板当前位置（不依赖 env 配城市）。
// 算法：
//   1. 老板当前坐标（IP 定位，geo-tracker 提供）
//   2. 台风中心 + 7/10/12 级风圈半径
//   3. 计算老板到台风中心距离
//   4. 如果 < 风圈半径 + 缓冲 → 影响
//
// 老板场景：移动到汕尾陆丰，台风登陆，汕尾附近 → 弹窗
//          移动到北京，无台风 → 静默
//          移动到东京，西太台风 → 弹窗

// ─── 常量 ───────────────────────────────────────────────────

// 风圈半径（km）— 实际数字来自 NMC
// 安全缓冲：再外扩 100km（多城影响 + 误差）
const WIND_CIRCLE_BUFFER_KM = 100

// 影响等级
const IMPACT_LEVELS = {
  DIRECT: 'direct',     // 台风眼/中心
  STRONG: 'strong',     // 7-10 级风圈
  ADJACENT: 'adjacent', // 12 级风圈外
  FAR: 'far',           // 远超风圈
  NONE: 'none',         // 无影响
}

const IMPACT_LABELS_ZH = {
  direct: '直接影响',
  strong: '强影响',
  adjacent: '临近影响',
  far: '远距',
  none: '无影响',
}

// 等级严重度（影响 1-3 跟极端天气 7 类同步）
const SEVERITY_MAP = {
  direct: 'extreme',
  strong: 'severe',
  adjacent: 'warning',
  far: null,
  none: null,
}

// ─── 工具 ───────────────────────────────────────────────────

function clamp(x, lo, hi) {
  if (typeof x !== 'number' || !isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

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

// 老板位置 (lat, lon) 从 IP 定位提取
//   options: { location: { country, city, lat, lon } }
//   注：如果只有 city 没坐标，用城市数据库查（这里 fallback null）
export function extractBossLocation(location) {
  if (!location || typeof location !== 'object') return null
  const lat = typeof location.lat === 'number' ? location.lat : null
  const lon = typeof location.lon === 'number' ? location.lon : null
  if (lat == null || lon == null) return null
  return { lat, lon, city: location.city, country: location.country }
}

// ─── 影响检测核心 ────────────────────────────────────────

// 单个台风对老板位置的影响
//   options: { typhoon, location, bufferKm }
//   typhoon: normalizeNmcTyphoon 输出
//   location: { lat, lon, city, country }
//   返回: { impacted, level, distanceKm, impactType, severity, message }
export function detectImpact(options = {}) {
  const typhoon = options.typhoon
  const location = options.location
  const buffer = options.bufferKm || WIND_CIRCLE_BUFFER_KM
  if (!typhoon || !location || location.lat == null || location.lon == null) {
    return { impacted: false, level: IMPACT_LEVELS.NONE, distanceKm: null, impactType: 'no_data', severity: null, message: 'missing data' }
  }
  // 当前台风中心
  const tLat = typhoon.lat
  const tLon = typhoon.lon
  if (tLat == null || tLon == null) {
    return { impacted: false, level: IMPACT_LEVELS.NONE, distanceKm: null, impactType: 'no_typhoon_center', severity: null, message: 'typhoon center unknown' }
  }
  // 当前距离
  const currentDist = haversineKm(location.lat, location.lon, tLat, tLon)
  if (currentDist == null) {
    return { impacted: false, level: IMPACT_LEVELS.NONE, distanceKm: null, impactType: 'no_distance', severity: null, message: 'cannot compute distance' }
  }
  // 检查预报路径（看 24/48/72h 是否更近）
  let minDist = currentDist
  let minDistAt = 'now'
  if (Array.isArray(typhoon.forecastPath)) {
    for (const p of typhoon.forecastPath) {
      if (typeof p.lat === 'number' && typeof p.lon === 'number') {
        const d = haversineKm(location.lat, location.lon, p.lat, p.lon)
        if (d != null && d < minDist) {
          minDist = d
          minDistAt = p.at || 'future'
        }
      }
    }
  }
  // 风圈半径（用最大的 + 缓冲）
  const radius12 = (typhoon.windCircle12 || 0) + buffer
  const radius10 = (typhoon.windCircle10 || 0) + buffer
  const radius7 = (typhoon.windCircle7 || 0) + buffer
  let level = IMPACT_LEVELS.NONE
  let impactType = 'no_impact'
  let severity = null
  if (minDist <= Math.max(radius12, 50)) {  // 至少 12 级风圈 + 缓冲
    level = IMPACT_LEVELS.DIRECT
    impactType = 'within_12_wind_circle'
    severity = SEVERITY_MAP.direct
  } else if (minDist <= Math.max(radius10, 100)) {
    level = IMPACT_LEVELS.STRONG
    impactType = 'within_10_wind_circle'
    severity = SEVERITY_MAP.strong
  } else if (minDist <= Math.max(radius7, 200)) {
    level = IMPACT_LEVELS.ADJACENT
    impactType = 'within_7_wind_circle'
    severity = SEVERITY_MAP.adjacent
  } else {
    // 检查预报路径（如果预报会到老板附近）
    if (minDistAt !== 'now' && minDist < 1000) {
      level = IMPACT_LEVELS.ADJACENT
      impactType = 'forecast_approach'
      severity = SEVERITY_MAP.adjacent
    }
  }
  const message = impactType !== 'no_impact' && impactType !== 'no_typhoon_center' && impactType !== 'no_distance' && impactType !== 'no_data'
    ? `${typhoon.name} (${typhoon.levelLabel}) 距 ${location.city || '您当前位置'} ${minDist.toFixed(0)} km${minDistAt !== 'now' ? `，预计 ${minDistAt} 接近` : ''}`
    : `${typhoon.name} 距 ${location.city || '您当前位置'} ${minDist.toFixed(0)} km，无影响`
  return {
    impacted: severity != null,
    level,
    distanceKm: minDist,
    impactType,
    severity,
    message,
    typhoonName: typhoon.name,
    typhoonLevel: typhoon.level,
    minDistAt,
  }
}

// ─── 主导出：批量检测 ────────────────────────────────────

// 多个台风 vs 老板位置
//   options: { typhoons: [...], location }
//   返回: { impacts: [...], totalImpacted }
export function detectAllImpacts(options = {}) {
  const typhoons = Array.isArray(options.typhoons) ? options.typhoons : []
  const location = options.location
  if (!location) return { impacts: [], totalImpacted: 0, location: null }
  const impacts = []
  for (const t of typhoons) {
    const impact = detectImpact({ typhoon: t, location })
    if (impact.impacted) {
      impacts.push(impact)
    }
  }
  // 按影响等级排序（direct > strong > adjacent）
  const order = { direct: 0, strong: 1, adjacent: 2 }
  impacts.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9))
  return { impacts, totalImpacted: impacts.length, location }
}

export {
  WIND_CIRCLE_BUFFER_KM,
  IMPACT_LEVELS,
  IMPACT_LABELS_ZH,
  SEVERITY_MAP,
  haversineKm,
}
