// geo-tracker framework barrel.
//
// Public surface:
//   - ip-locator:        locateOnce, recordLocation,
//                        startMonitoring, stopMonitoring, isMonitoring,
//                        getLocatorStats, defaultLocatorState
//   - motion-detector:   detectMotion, checkFromState, getMotionSummary,
//                        haversineKm
//   - geo-tracker:       startGeoTracking, stopGeoTracking, isGeoTracking,
//                        locateNow, getGeoOverview, injectForGeo,
//                        registerProvider, clearProviders, defaultTrackerState
//   - privacy-guard:     sanitizeLocation, sanitizeMotion, isLocationClean,
//                        isAllowedEndpoint, clearMotionHistory, clearLocatorHistory
//
// 硬约束（老板 9-07 14:31 拍板 + 翻身纪律）：
//   - IP 持续定位（默认 15 分钟/次）
//   - 国家/城市级精度（不要 GPS 街道级）
//   - 移动检测 4 类（IP / 时区 / 国家 / 城市）
//   - 事件触发（location_changed）
//   - 离线/超时降级（不阻塞）
//   - 不持久化精确坐标（lat/lon/zip/isp/org）
//   - 仅 IP 定位公开 API（ip-api.com / IP2Location / IPInfo）
//   - GPS 接入点预留（未来儿童手表）
//   - 不进决策路径（meta-info 隔离）

export {
  locateOnce,
  recordLocation,
  startMonitoring,
  stopMonitoring,
  isMonitoring,
  getLocatorStats,
  defaultLocatorState,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_ENDPOINT,
} from './ip-locator.js'

export {
  detectMotion,
  checkFromState,
  getMotionSummary,
  haversineKm,
  MIN_DISTANCE_KM,
  SAME_CITY_THRESHOLD_KM,
} from './motion-detector.js'

export {
  startGeoTracking,
  stopGeoTracking,
  isGeoTracking,
  locateNow,
  getGeoOverview,
  injectForGeo,
  registerProvider,
  clearProviders,
  defaultTrackerState,
  DEFAULT_POLL_INTERVAL_MS as DEFAULT_TRACKER_INTERVAL_MS,
  DEFAULT_MIN_DISTANCE_KM,
  MAX_HISTORY,
} from './geo-tracker.js'

export {
  sanitizeLocation,
  sanitizeMotion,
  isLocationClean,
  isAllowedEndpoint,
  clearMotionHistory,
  clearLocatorHistory,
  FORBIDDEN_PERSISTENT_FIELDS,
  ALLOWED_PERSISTENT_FIELDS,
  ALLOWED_IP_ENDPOINTS,
} from './privacy-guard.js'
