// controller.js — 预判编排器
//
// 定位：把 predict() + suggest() 串成 GINA 周期预判主回路。
//
// 关键：默认不主动发消息，emit 事件由调用方处理。
//   - 调用方（主循环）传入 eventEmitter
//   - emit `anticipation:suggested` 事件
//   - 主循环决定怎么处理（默认只 log，不入对话）

import { predict } from './predictor.js'
import { suggest, defaultSuggesterState } from './suggester.js'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_EVENT_NAME = 'anticipation:suggested'

// ─── 状态 ───────────────────────────────────────────────────

export function defaultControllerState() {
  return {
    version: 1,
    runs: [],  // [{at, intentCount, topIntent, suggestType}]
  }
}

// ─── 主入口 ────────────────────────────────────────────────

// 跑一次预判 + 建议
//   options: {
//     // 输入
//     conversationHistory, focusContext, timePattern,
//     externalEmotion, knowledgeGaps,
//     // 用户活动
//     userActivity: { online, screenLocked },
//     // 状态
//     suggesterState, controllerState,
//     // 事件
//     eventEmitter: { emit(name, payload) } | null,
//     eventName: string (default 'anticipation:suggested'),
//     now: number,
//   }
//   返回: { prediction, suggestion, emitted }
export function runAnticipation(options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const eventName = options.eventName || DEFAULT_EVENT_NAME
  const suggesterState = options.suggesterState || defaultSuggesterState()
  const controllerState = options.controllerState || defaultControllerState()
  const eventEmitter = options.eventEmitter || null
  // 1) 预判
  const prediction = predict({
    conversationHistory: options.conversationHistory,
    focusContext: options.focusContext,
    timePattern: options.timePattern,
    externalEmotion: options.externalEmotion,
    knowledgeGaps: options.knowledgeGaps,
    now,
  })
  // 2) 决定是否建议
  const suggestion = suggest({
    prediction,
    state: suggesterState,
    userActivity: options.userActivity,
    now,
  })
  // 3) emit（默认不真发消息）
  let emitted = false
  if (suggestion.shouldSuggest && suggestion.suggestType === 'emit' && eventEmitter && typeof eventEmitter.emit === 'function') {
    try {
      eventEmitter.emit(eventName, {
        intent: suggestion.intent,
        reason: suggestion.reason,
        hash: suggestion.hash,
        at: now,
      })
      emitted = true
    } catch (e) {
      // 吞掉 emit 异常，不阻塞主流程
    }
  }
  // 4) 记录
  controllerState.runs.push({
    at: now,
    intentCount: prediction.intents.length,
    topIntent: prediction.intents[0]?.type || null,
    topConfidence: prediction.intents[0]?.confidence || 0,
    suggestType: suggestion.suggestType,
    shouldSuggest: suggestion.shouldSuggest,
    emitted,
  })
  if (controllerState.runs.length > 256) controllerState.runs = controllerState.runs.slice(-256)
  return {
    prediction,
    suggestion,
    emitted,
  }
}

// ─── 概览 ──────────────────────────────────────────────────

export function getAnticipationOverview(options = {}) {
  const state = options.controllerState || defaultControllerState()
  const suggesterState = options.suggesterState || defaultSuggesterState()
  const recent = state.runs.slice(-20)
  return {
    totalRuns: state.runs.length,
    recentEmitCount: recent.filter(r => r.emitted).length,
    recentSuggestCount: recent.filter(r => r.shouldSuggest).length,
    recentAvgConfidence: recent.length > 0
      ? recent.reduce((s, r) => s + (r.topConfidence || 0), 0) / recent.length
      : 0,
    enabled: suggesterState.enabled !== false,
    silent: suggesterState.silent === true,
    cooldownsActive: (suggesterState.lastSuggestions || []).length,
  }
}

export function resetForTest() {
  return defaultControllerState()
}

export { DEFAULT_EVENT_NAME }
