// weather-monitor framework barrel.
//
// Public surface:
//   - weather-fetcher:   fetchOnce, fetchWttr, fetchNMCAlerts,
//                        normalizeWttr, normalizeNMCAlerts
//   - extreme-detector:  detectAll + 7 个单类检测器
//                        (detectHighTemp, detectLowTemp, detectColdWave,
//                         detectRainstorm, detectThunderstorm, detectHail, detectWind)
//                        filterSevereNMC, EXTREME_TYPES, EXTREME_LABELS_ZH
//   - weather-monitor:   startMonitoring, stopMonitoring, isMonitoring,
//                        detectOnce, getMonitorOverview, injectForWeather,
//                        defaultMonitorState
//   - privacy-guard:     isAllowedWeatherEndpoint, sanitizeAlert, sanitizeWttr,
//                        sanitizeNMCAlerts, isAlertClean, clearAlertHistory
//
// 硬约束（老板 9-07 17:08 拍板）：
//   - 7 大类极端检测（高温/低温/寒潮/暴雨/雷电/冰雹/大风）
//   - NMC 中央台 + wttr.in 双源
//   - 30 分钟/次轮询（老板默认）
//   - 复用 typhoon-alert-monitor emit 机制
//   - emotion-isolation 类比：不进决策路径

export {
  fetchOnce,
  fetchWttr,
  fetchNMCAlerts,
  normalizeWttr,
  normalizeNMCAlerts,
} from './weather-fetcher.js'

export {
  detectAll,
  detectHighTemp,
  detectLowTemp,
  detectColdWave,
  detectRainstorm,
  detectThunderstorm,
  detectHail,
  detectWind,
  filterSevereNMC,
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
} from './extreme-detector.js'

export {
  startMonitoring,
  stopMonitoring,
  isMonitoring,
  detectOnce,
  getMonitorOverview,
  injectForWeather,
  defaultMonitorState,
  MAX_ALERT_HISTORY,
  DEFAULT_DEDUP_MS,
} from './weather-monitor.js'

export {
  isAllowedWeatherEndpoint,
  sanitizeAlert,
  sanitizeWttr,
  sanitizeNMCAlerts,
  isAlertClean,
  clearAlertHistory,
  FORBIDDEN_PERSISTENT_FIELDS,
  ALLOWED_PERSISTENT_FIELDS,
  ALLOWED_WEATHER_ENDPOINTS,
} from './privacy-guard.js'
