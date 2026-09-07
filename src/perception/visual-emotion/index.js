// visual-emotion framework barrel.
//
// Public surface:
//   - camera:          openCamera, closeCamera, captureFrame, listAvailableCameras,
//                      switchCamera, isOpen, defaultCameraState
//   - face-detector:   createMockDetector, createFaceApiDetector, detectFaces,
//                      EXPRESSIONS, EXPRESSION_LABELS_ZH
//   - emotion-tracker: addFrame, getStableEmotion, resetTracker, setWindowSize,
//                      defaultTrackerState
//   - privacy-guard:   isDetectorAllowed, isLocalOnly, sanitizeFrame, sanitizeDetection,
//                      clearTrackerState, clampWindowSize, isFramePersisted,
//                      defaultConsentState, grant, revoke, isGranted
//
// 硬约束（老板 9-07 纪律）:
//   - 摄像头默认关闭（显式 grant 才开）
//   - 帧检测后立即 sanitize（不持久化像素）
//   - 仅本地处理（不调云端 emotion API）
//   - 7 类表情输出（neutral/happy/sad/angry/surprised/disgusted/fearful）
//   - 滑动窗口稳定化（默认 5 帧 ≈ 2.5s）
//   - emotion 仍走 ADR-002 meta-info 隔离（不接决策路径）

export {
  openCamera,
  closeCamera,
  captureFrame,
  listAvailableCameras,
  switchCamera,
  isOpen,
  defaultCameraState,
  DEFAULT_VIDEO_CONSTRAINTS,
  MAX_CAMERAS,
  MAX_RESTART_ATTEMPTS,
  RESTART_DELAY_MS,
} from './camera.js'

export {
  createMockDetector,
  createFaceApiDetector,
  detectFaces,
  EXPRESSIONS,
  EXPRESSION_LABELS_ZH,
  normalizeExpressions,
  clamp01,
  MAX_FACES,
  MIN_CONFIDENCE,
  DEFAULT_TIMEOUT_MS,
} from './face-detector.js'

export {
  addFrame,
  getStableEmotion,
  resetTracker,
  setWindowSize,
  defaultTrackerState,
  DEFAULT_WINDOW_SIZE,
  MIN_FRAMES_FOR_OUTPUT,
  MAX_AGE_MS,
  aggregateExpressions,
  dominantExpression,
} from './emotion-tracker.js'

export {
  isDetectorAllowed,
  isLocalOnly,
  sanitizeFrame,
  sanitizeDetection,
  clearTrackerState,
  clampWindowSize,
  isFramePersisted,
  defaultConsentState,
  grant,
  revoke,
  isGranted,
  ALLOWED_DETECTORS,
  MAX_PERSISTENT_FRAMES,
  MAX_TRACKER_WINDOW,
  NETWORK_BLOCKED_HOSTS,
} from './privacy-guard.js'
