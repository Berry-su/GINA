// typhoon-tracker framework barrel.
//
// Public surface:
//   - typhoon-fetcher:  fetchOnce, fetchAllActiveTyphoons, fetchTyphoonDetail,
//                      fetchNmcAlerts, normalizeNmcTyphoon,
//                      NMC_TYPHOON_BASE, TYPHOON_LEVELS, TYPHOON_LEVEL_LABELS
//   - impact-detector: detectImpact, detectAllImpacts, extractBossLocation,
//                      IMPACT_LEVELS, IMPACT_LABELS_ZH, haversineKm
//   - typhoon-tracker: startTracking, stopTracking, isTracking,
//                      onLocationChanged, evaluateOnce,
//                      getTrackerOverview, injectForTyphoon,
//                      defaultTrackerState
//   - privacy-guard:   isAllowedTyphoonEndpoint, sanitizeTyphoon, sanitizeImpact,
//                      isTyphoonClean, clearImpactHistory
//
// 硬约束（老板 9-07 17:22 拍板）：
//   - 通用台风检测（不限定老板城市）
//   - 拉所有活跃台风（NMC 中央台 + 公共 API）
//   - 跟老板位置匹配（IP 定位，geo-tracker 提供）
//   - 老板移动时自动重新评估（onLocationChanged）
//   - 5 分钟轮询（与原 typhoon-alert-monitor 一致）
//   - dedup 1 小时（同台风不重复 emit）
//   - 复用 typhoon-alert UI 弹窗（不破坏现有）
//   - emotion-isolation 类比：不进决策路径

export {
  fetchOnce,
  fetchAllActiveTyphoons,
  fetchTyphoonDetail,
  fetchNmcAlerts,
  normalizeNmcTyphoon,
  NMC_TYPHOON_BASE,
  NMC_ALERT_DEFAULT,
  FETCH_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  TYPHOON_LEVELS,
  TYPHOON_LEVEL_LABELS,
} from './typhoon-fetcher.js'

export {
  detectImpact,
  detectAllImpacts,
  extractBossLocation,
  WIND_CIRCLE_BUFFER_KM,
  IMPACT_LEVELS,
  IMPACT_LABELS_ZH,
  SEVERITY_MAP,
  haversineKm,
} from './impact-detector.js'

export {
  startTracking,
  stopTracking,
  isTracking,
  onLocationChanged,
  evaluateOnce,
  getTrackerOverview,
  injectForTyphoon,
  defaultTrackerState,
  MAX_IMPACT_HISTORY,
  DEFAULT_DEDUP_MS,
} from './typhoon-tracker.js'

export {
  isAllowedTyphoonEndpoint,
  sanitizeTyphoon,
  sanitizeImpact,
  isTyphoonClean,
  clearImpactHistory,
  FORBIDDEN_PERSISTENT_FIELDS,
  ALLOWED_PERSISTENT_FIELDS,
  ALLOWED_TYPHOON_ENDPOINTS,
} from './privacy-guard.js'
