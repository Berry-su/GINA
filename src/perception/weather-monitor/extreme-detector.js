// extreme-detector.js — 7 大类极端天气检测
//
// 定位：从 weather-fetcher 拉到的实时数据 + NMC 预警 → 检测极端。
// 7 大类：
//   1. 高温（temp >= 35°C）
//   2. 低温（temp <= 0°C）
//   3. 寒潮（24h 降温 >= 10°C）
//   4. 暴雨（24h 降水 >= 50mm OR 1h >= 16mm）
//   5. 雷电（NMC 雷电预警）
//   6. 冰雹（NMC 冰雹预警）
//   7. 大风（windSpeed >= 17 m/s = 8 级）
//
// 输出：extremeAlerts 数组 + 当前 safe 状态

// ─── 常量 ───────────────────────────────────────────────────

const HIGH_TEMP_C = 35          // 高温阈值
const LOW_TEMP_C = 0           // 低温阈值
const COLD_WAVE_DROP_C = 10    // 寒潮 24h 降温阈值
const RAINSTORM_24H_MM = 50    // 暴雨 24h 降水阈值
const RAINSTORM_1H_MM = 16     // 暴雨 1h 降水阈值
const WIND_STRONG_MS = 17      // 大风 8 级
const WIND_GALE_MS = 24        // 大风 9 级
const WIND_TORNADO_MS = 32     // 大风 10 级

const EXTREME_TYPES = [
  'high_temp',
  'low_temp',
  'cold_wave',
  'rainstorm',
  'thunderstorm',
  'hail',
  'wind',
]

const EXTREME_LABELS_ZH = {
  high_temp: '高温',
  low_temp: '低温',
  cold_wave: '寒潮',
  rainstorm: '暴雨',
  thunderstorm: '雷电',
  hail: '冰雹',
  wind: '大风',
}

// ─── 内部工具 ───────────────────────────────────────────────

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

function kmhToMs(kmh) {
  if (typeof kmh !== 'number' || !isFinite(kmh)) return null
  return kmh / 3.6
}

function makeAlert(type, severity, message, options = {}) {
  return {
    type,
    label: EXTREME_LABELS_ZH[type] || type,
    severity,    // 'warning' | 'severe' | 'extreme'
    message,
    source: options.source || 'detector',
    location: options.location || null,
    detectedAt: Date.now(),
  }
}

// ─── 1. 高温 ──────────────────────────────────────────────

export function detectHighTemp(current, options = {}) {
  if (!current || typeof current.temp !== 'number') return null
  const threshold = options.threshold || HIGH_TEMP_C
  if (current.temp < threshold) return null
  const severity = current.temp >= 40 ? 'extreme' : current.temp >= 37 ? 'severe' : 'warning'
  return makeAlert('high_temp', severity,
    `${current.temp.toFixed(1)}°C 超过高温阈值 ${threshold}°C`,
    { location: current.location, source: 'wttr.in' },
  )
}

// ─── 2. 低温 ──────────────────────────────────────────────

export function detectLowTemp(current, options = {}) {
  if (!current || typeof current.temp !== 'number') return null
  const threshold = options.threshold || LOW_TEMP_C
  if (current.temp > threshold) return null
  const severity = current.temp <= -10 ? 'extreme' : current.temp <= -5 ? 'severe' : 'warning'
  return makeAlert('low_temp', severity,
    `${current.temp.toFixed(1)}°C 低于低温阈值 ${threshold}°C`,
    { location: current.location, source: 'wttr.in' },
  )
}

// ─── 3. 寒潮（需要 24h 前后对比） ──────────────────────────

export function detectColdWave(prevTemp, currentTemp, options = {}) {
  if (typeof prevTemp !== 'number' || typeof currentTemp !== 'number') return null
  const drop = prevTemp - currentTemp
  const threshold = options.threshold || COLD_WAVE_DROP_C
  if (drop < threshold) return null
  const severity = drop >= 15 ? 'extreme' : drop >= 12 ? 'severe' : 'warning'
  return makeAlert('cold_wave', severity,
    `24h 降温 ${drop.toFixed(1)}°C，超过寒潮阈值 ${threshold}°C`,
    { source: 'wttr.in' },
  )
}

// ─── 4. 暴雨（24h 降水 OR 1h 降水） ───────────────────────

export function detectRainstorm(current, forecast, options = {}) {
  if (!current && !forecast) return null
  const thresh24h = options.threshold24h || RAINSTORM_24H_MM
  const thresh1h = options.threshold1h || RAINSTORM_1H_MM
  // 24h 降水
  let precip24h = 0
  if (Array.isArray(forecast) && forecast[0]) {
    precip24h = safeNum(forecast[0].precip) || 0
  }
  if (precip24h >= thresh24h) {
    const severity = precip24h >= 100 ? 'extreme' : precip24h >= 75 ? 'severe' : 'warning'
    return makeAlert('rainstorm', severity,
      `24h 降水 ${precip24h.toFixed(1)}mm，超过暴雨阈值 ${thresh24h}mm`,
      { location: current?.location, source: 'wttr.in' },
    )
  }
  // 1h 降水（如果有 hourly 数据，wttr 不直接给，但 current.precip 可作参考）
  if (current && current.precip != null && current.precip >= thresh1h) {
    const severity = current.precip >= 50 ? 'extreme' : current.precip >= 30 ? 'severe' : 'warning'
    return makeAlert('rainstorm', severity,
      `1h 降水 ${current.precip.toFixed(1)}mm，超过暴雨阈值 ${thresh1h}mm`,
      { location: current.location, source: 'wttr.in' },
    )
  }
  return null
}

// ─── 5. 雷电（从 NMC 预警） ───────────────────────────────

export function detectThunderstorm(nmcAlerts, options = {}) {
  if (!Array.isArray(nmcAlerts) || nmcAlerts.length === 0) return null
  const found = nmcAlerts.find(a => a.type === 'thunderstorm')
  if (!found) return null
  return makeAlert('thunderstorm', found.level === 'red' || found.level === 'severe' ? 'severe' : 'warning',
    `${found.region || '本地'} ${found.title}：${found.content || '雷电预警'}`,
    { location: options.location, source: 'NMC' },
  )
}

// ─── 6. 冰雹 ──────────────────────────────────────────────

export function detectHail(nmcAlerts, options = {}) {
  if (!Array.isArray(nmcAlerts) || nmcAlerts.length === 0) return null
  const found = nmcAlerts.find(a => a.type === 'hail')
  if (!found) return null
  return makeAlert('hail', found.level === 'red' || found.level === 'severe' ? 'severe' : 'warning',
    `${found.region || '本地'} ${found.title}：${found.content || '冰雹预警'}`,
    { location: options.location, source: 'NMC' },
  )
}

// ─── 7. 大风（风速阈值） ─────────────────────────────────

export function detectWind(current, options = {}) {
  if (!current || typeof current.windSpeed !== 'number') return null
  const ms = kmhToMs(current.windSpeed)
  if (ms === null) return null
  const threshold = options.threshold || WIND_STRONG_MS
  if (ms < threshold) return null
  let severity = 'warning'
  if (ms >= WIND_TORNADO_MS) severity = 'extreme'
  else if (ms >= WIND_GALE_MS) severity = 'severe'
  return makeAlert('wind', severity,
    `风速 ${ms.toFixed(1)} m/s（${current.windSpeed.toFixed(1)} km/h），超过大风阈值 ${threshold} m/s`,
    { location: current.location, source: 'wttr.in' },
  )
}

// ─── 主导出：一次完整检测 ─────────────────────────────────

//   options: { wttr, nmcAlerts, prevTemp, location }
//   返回: { alerts, safe }
export function detectAll(options = {}) {
  const wttr = options.wttr
  const current = wttr?.current
  const forecast = wttr?.forecast
  const nmcAlerts = options.nmcAlerts || []
  const location = options.location || wttr?.location
  const alerts = []
  // 1. 高温
  const a1 = detectHighTemp(current, { location })
  if (a1) alerts.push(a1)
  // 2. 低温
  const a2 = detectLowTemp(current, { location })
  if (a2) alerts.push(a2)
  // 3. 寒潮
  if (typeof options.prevTemp === 'number') {
    const a3 = detectColdWave(options.prevTemp, current?.temp, {})
    if (a3) alerts.push(a3)
  }
  // 4. 暴雨
  const a4 = detectRainstorm(current, forecast, { location })
  if (a4) alerts.push(a4)
  // 5. 雷电
  const a5 = detectThunderstorm(nmcAlerts, { location })
  if (a5) alerts.push(a5)
  // 6. 冰雹
  const a6 = detectHail(nmcAlerts, { location })
  if (a6) alerts.push(a6)
  // 7. 大风
  const a7 = detectWind(current, { location })
  if (a7) alerts.push(a7)
  return {
    alerts,
    safe: alerts.length === 0,
    checkedAt: Date.now(),
    location,
  }
}

// ─── NMC 预警辅助 ─────────────────────────────────────────

// 从 NMC 预警里提取所有"严重"项
export function filterSevereNMC(nmcAlerts) {
  if (!Array.isArray(nmcAlerts)) return []
  return nmcAlerts.filter(a => a.level === 'red' || a.level === 'severe' || a.level === 'orange')
}

export {
  HIGH_TEMP_C,
  LOW_TEMP_C,
  COLD_WAVE_DROP_C,
  RAINSTORM_24H_MM,
  RAINSTORM_1H_MM,
  WIND_STRONG_MS,
  WIND_GALE_MS,
  WIND_TORNADO_MS,
  EXTREME_TYPES,
  EXTREME_LABELS_ZH,
}
