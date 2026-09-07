// anticipation framework barrel.
//
// Public surface:
//   - predictor:    predict, INTENT_TYPES, scoring helpers
//   - suggester:    suggest, defaultSuggesterState,
//                   setSilent, setEnabled, clearHistory, getSuggestionHistory
//   - controller:   runAnticipation, getAnticipationOverview,
//                   defaultControllerState, resetForTest
//
// 默认行为（老板 9-07 纪律）:
//   - 默认不主动发消息（suggestType 默认 'log'）
//   - 只有 confidence >= 0.65 才 emit 事件（仍由主循环决定怎么处理）
//   - 30 分钟内同内容不重复
//   - silent 模式 / 离线 / 锁屏 → 完全关闭

export {
  predict,
  INTENT_TYPES,
  scoreRecentMessage,
  scoreRecentQuestion,
  scoreFocusStack,
  scoreTimePattern,
  scoreEmotionContext,
  scoreKnowledgeGap,
  scoreHistoryPattern,
  SIGNAL_WEIGHTS,
  MAX_HISTORY,
  RECENT_WINDOW_MS,
  DEFAULT_TOP_K,
} from './predictor.js'

export {
  suggest,
  defaultSuggesterState,
  setSilent,
  setEnabled,
  clearHistory,
  getSuggestionHistory,
  hashSuggestion,
  DEFAULT_COOLDOWN_MS,
  MIN_CONFIDENCE_TO_SUGGEST,
  MIN_CONFIDENCE_TO_EMIT,
  MAX_HISTORY as MAX_SUGGESTION_HISTORY,
} from './suggester.js'

export {
  runAnticipation,
  getAnticipationOverview,
  defaultControllerState,
  resetForTest,
  DEFAULT_EVENT_NAME,
} from './controller.js'

export {
  extractKeywords,
} from './keywords.js'
