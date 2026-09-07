// realtime-vision framework barrel.
//
// Public surface:
//   - stream-manager:  openStream, closeStream, restartStream,
//                      isStreamOpen, getActiveStreamCount,
//                      defaultStreamState
//   - frame-sampler:   processFrame, resetSampler, setThreshold,
//                      getSamplerStats, defaultSamplerState
//   - scene-analyzer:  analyzeScene, clearCache, getAnalyzerStats,
//                      createMockDescriber, defaultAnalyzerState
//   - narrator:        shouldNarrate, setSilent, setEnabled,
//                      setHumanApproved, clearHistory, getHistory,
//                      defaultNarratorState
//   - privacy-guard:   trimFrameCache, clearFrameCache, clampCacheMax,
//                      clearRealtimeState, isObservationClean,
//                      sanitizeObservation,
//                      isLocalOnly, defaultConsentState, grant, revoke,
//                      isGranted
//
// 硬约束（老板 9-07 14:25 拍板 + 翻身纪律）：
//   - 1 fps 采样
//   - 30% 场景变化才触发
//   - 默认不主动发消息（emit 'realtime:observation' 事件）
//   - 必须 humanApproved=true 才直接说
//   - silent / 离线 / 锁屏 → 完全关闭
//   - 30 分钟内同描述不重复
//   - 不持久化原始帧（仅 hash + 描述）
//   - 仅本地 VLM（不传云）
//   - emotion-isolation（输出只进文本流）
//   - 同一时间只 1 路流（防资源爆）

export {
  openStream,
  closeStream,
  restartStream,
  isStreamOpen,
  getActiveStreamCount,
  defaultStreamState,
  DEFAULT_FPS,
  MIN_FPS,
  MAX_FPS,
  MAX_RESTART_ATTEMPTS,
  RESTART_DELAY_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_CONCURRENT_STREAMS,
} from './stream-manager.js'

export {
  processFrame,
  resetSampler,
  setThreshold,
  getSamplerStats,
  defaultSamplerState,
  DEFAULT_CHANGE_THRESHOLD,
  MIN_CHANGE_THRESHOLD,
  MAX_CHANGE_THRESHOLD,
  SAMPLE_RESOLUTION,
} from './frame-sampler.js'

export {
  analyzeScene,
  clearCache,
  getAnalyzerStats,
  createMockDescriber,
  defaultAnalyzerState,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CACHE_MAX,
} from './scene-analyzer.js'

export {
  shouldNarrate,
  setSilent,
  setEnabled,
  setHumanApproved,
  clearHistory,
  getHistory,
  defaultNarratorState,
  DEFAULT_COOLDOWN_MS,
  MIN_CONFIDENCE,
  DEFAULT_MIN_CHANGE_SCORE,
  MAX_HISTORY,
} from './narrator.js'

export {
  trimFrameCache,
  clearFrameCache,
  clampCacheMax,
  clearRealtimeState,
  isObservationClean,
  sanitizeObservation,
  isLocalOnly,
  defaultConsentState,
  grant,
  revoke,
  isGranted,
  ALLOWED_DETECTORS,
  NETWORK_BLOCKED_HOSTS,
  MAX_TRACKER_WINDOW,
  DEFAULT_FRAME_CACHE_MAX,
  MAX_FRAME_CACHE_MAX,
  FORBIDDEN_FIELDS,
} from './privacy-guard.js'
