// voice-emotion framework barrel.
//
// Public surface:
//   - audio-capture:       openMicrophone, closeMicrophone, captureTimeDomainFrame,
//                          captureFrequencyFrame, listAvailableMicrophones, switchMicrophone,
//                          isOpen, defaultAudioState
//   - prosody:             computeRMS, computePitch, computeZCR,
//                          computeSpectralCentroid, computeSpectralFlux,
//                          extractFeatures, aggregateFeatures
//   - emotion-classifier:  classifyByRules, classifyEmotion,
//                          createMockClassifier, createWav2Vec2Classifier, EXPRESSIONS
//   - emotion-tracker:     addFrame, getStableEmotion, resetTracker, setWindowSize,
//                          defaultTrackerState
//   - privacy-guard:       sanitizeAudioFrame, sanitizeClassification, sanitizeAggregated,
//                          clearTrackerState, isFrameClean,
//                          isLocalOnly, defaultConsentState, grant, revoke, isGranted
//
// 硬约束（老板 9-07 纪律）:
//   - 麦克风默认关闭（grant 才开）
//   - 原始音频不持久化（检测后立即丢）
//   - 仅本地 prosody（不传云 emotion API）
//   - 7 类情绪输出（与 face-detector 一致）
//   - 滑动窗口稳定化（默认 5 帧 ≈ 2.5s）
//   - emotion 走 ADR-002 meta-info 隔离（不接决策路径）

export {
  openMicrophone,
  closeMicrophone,
  captureTimeDomainFrame,
  captureFrequencyFrame,
  listAvailableMicrophones,
  switchMicrophone,
  isOpen,
  defaultAudioState,
  DEFAULT_AUDIO_CONSTRAINTS,
  DEFAULT_ANALYSER_FFT,
  DEFAULT_ANALYSER_SMOOTHING,
  MAX_MICS,
} from './audio-capture.js'

export {
  computeRMS,
  computePitch,
  computeZCR,
  computeSpectralCentroid,
  computeSpectralFlux,
  extractFeatures,
  aggregateFeatures,
  PITCH_MIN_HZ,
  PITCH_MAX_HZ,
  ENERGY_SILENCE_THRESHOLD,
  ENERGY_SPEECH_THRESHOLD,
  PITCH_VOICED_THRESHOLD_RATIO,
} from './prosody.js'

export {
  classifyByRules,
  classifyEmotion,
  createMockClassifier,
  createWav2Vec2Classifier,
  EXPRESSIONS,
  PITCH_HIGH_HZ,
  PITCH_LOW_HZ,
  ENERGY_HIGH,
  ENERGY_LOW,
  CENTROID_HIGH_HZ,
  CENTROID_LOW_HZ,
  PAUSE_HIGH,
  RATE_LOW,
  RATE_HIGH,
} from './emotion-classifier.js'

export {
  addFrame,
  getStableEmotion,
  resetTracker,
  setWindowSize,
  defaultTrackerState,
  MIN_FRAMES_FOR_OUTPUT,
  MAX_AGE_MS,
} from './emotion-tracker.js'

export {
  sanitizeAudioFrame,
  sanitizeClassification,
  sanitizeAggregated,
  clearTrackerState,
  isFrameClean,
  isLocalOnly,
  defaultConsentState,
  grant,
  revoke,
  isGranted,
  ALLOWED_DETECTORS,
  MAX_TRACKER_WINDOW,
  NETWORK_BLOCKED_HOSTS,
  FORBIDDEN_PERSISTENT_FIELDS,
} from './privacy-guard.js'
