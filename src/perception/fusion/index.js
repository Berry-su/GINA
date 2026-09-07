// fusion framework barrel.
//
// Public surface:
//   - fuser:           fuse, textTo7Class, checkAgreement,
//                      DEFAULT_MODALITY_WEIGHTS, TEXT_TO_7
//   - state:           addFusion, getStableFusion, resetFusion,
//                      setWindowSize, defaultFusionState
//   - privacy-guard:   sanitizeModality, sanitizeFusion, clearFusionState,
//                      isFusionClean, isLocalOnly, defaultConsentState,
//                      grant, revoke, isGranted
//
// 硬约束（老板 9-07 翻身纪律 + 9-07 13:31 拍板 a+c 组合）:
//   - 策略：投票（vote）+ confidence 动态加权
//   - 3/3 一致 → confidence +15% boost
//   - 2/3 一致 → confidence +5% boost
//   - 全不一 → ambiguous=true，confidence -30%
//   - 模态权重：visual=voice=1.0, text=0.6（直接信号 > 间接信号）
//   - 文本 12 维 → 7 类映射（joy→happy, anger→angry, ...）
//   - emotion 仍走 ADR-002 meta-info 隔离（不接决策路径）

export {
  fuse,
  textTo7Class,
  checkAgreement,
  DEFAULT_MODALITY_WEIGHTS,
  TEXT_TO_7,
  MIN_MODALITY_CONFIDENCE,
  HIGH_AGREEMENT,
  VERY_HIGH_AGREEMENT,
  EXPRESSIONS,
} from './fuser.js'

export {
  addFusion,
  getStableFusion,
  resetFusion,
  setWindowSize,
  defaultFusionState,
  defaultTrackerState,
} from './state.js'

export {
  sanitizeModality,
  sanitizeFusion,
  clearFusionState,
  isFusionClean,
  isLocalOnly,
  defaultConsentState,
  grant,
  revoke,
  isGranted,
  ALLOWED_DETECTORS,
  NETWORK_BLOCKED_HOSTS,
  MAX_TRACKER_WINDOW,
  FORBIDDEN_FUSION_FIELDS,
} from './privacy-guard.js'
