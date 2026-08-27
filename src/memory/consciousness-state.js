// consciousness-state.js — 意识状态机
//
// 意识状态定义：
//   dormant    — 休眠：无交互，后台静默运行
//   awakening  — 苏醒：启动后首次运行自检和探索
//   focused    — 专注：用户正在交互，全功率运行
//   reflective — 反思：交互间隙进行自我反思和记忆整理
//   evolutionary — 进化：触发自我进化，学习新行为模式
//   resting    — 休息：长时间无交互，降频运行
//
// 状态转换由事件驱动，结合：
//   - 时间因素（闲置时长、交互频率）
//   - 情绪因素（用户情绪效价、投入度）
//   - 系统因素（CPU 负载、记忆压力、待处理任务）
//   - 自我感知因素（镜像检测、循环检测、对话质量）

import { getConfig, setConfig } from '../capabilities/db.js'

const CONSCIOUSNESS_STATE_KEY = 'consciousness_state_v1'
const CONSCIOUSNESS_STATE_VERSION = 1

const STATES = {
  DORMANT: 'dormant',
  AWAKENING: 'awakening',
  FOCUSED: 'focused',
  REFLECTIVE: 'reflective',
  EVOLUTIONARY: 'evolutionary',
  RESTING: 'resting',
}

const STATE_TRANSITIONS = {
  [STATES.DORMANT]: {
    on: {
      user_message: STATES.FOCUSED,
      timer_expired: STATES.RESTING,
      startup: STATES.AWAKENING,
    },
    to: {
      [STATES.FOCUSED]: { condition: 'user_message', cooldown: 0 },
      [STATES.RESTING]: { condition: 'timer_expired', cooldown: 300000 },
      [STATES.AWAKENING]: { condition: 'startup', cooldown: 0 },
    },
  },
  [STATES.AWAKENING]: {
    on: {
      exploration_complete: STATES.RESTING,
      user_message: STATES.FOCUSED,
      timeout: STATES.RESTING,
    },
    to: {
      [STATES.RESTING]: { condition: 'exploration_complete', cooldown: 0 },
      [STATES.FOCUSED]: { condition: 'user_message', cooldown: 0 },
    },
  },
  [STATES.FOCUSED]: {
    on: {
      user_message: STATES.FOCUSED,
      idle_timeout: STATES.REFLECTIVE,
      negative_emotion: STATES.REFLECTIVE,
      low_engagement: STATES.RESTING,
      memory_pressure: STATES.EVOLUTIONARY,
      error_burst: STATES.REFLECTIVE,
    },
    to: {
      [STATES.FOCUSED]: { condition: 'user_message', cooldown: 0 },
      [STATES.REFLECTIVE]: { condition: 'idle_timeout', cooldown: 0 },
      [STATES.EVOLUTIONARY]: { condition: 'memory_pressure', cooldown: 0 },
    },
  },
  [STATES.REFLECTIVE]: {
    on: {
      reflection_complete: STATES.RESTING,
      user_message: STATES.FOCUSED,
      evolution_trigger: STATES.EVOLUTIONARY,
      deep_reflection: STATES.EVOLUTIONARY,
    },
    to: {
      [STATES.RESTING]: { condition: 'reflection_complete', cooldown: 0 },
      [STATES.FOCUSED]: { condition: 'user_message', cooldown: 0 },
      [STATES.EVOLUTIONARY]: { condition: 'evolution_trigger', cooldown: 0 },
    },
  },
  [STATES.EVOLUTIONARY]: {
    on: {
      evolution_complete: STATES.RESTING,
      user_message: STATES.FOCUSED,
      error: STATES.REFLECTIVE,
    },
    to: {
      [STATES.RESTING]: { condition: 'evolution_complete', cooldown: 0 },
      [STATES.FOCUSED]: { condition: 'user_message', cooldown: 0 },
    },
  },
  [STATES.RESTING]: {
    on: {
      user_message: STATES.FOCUSED,
      scheduled_reflection: STATES.REFLECTIVE,
      memory_consolidation: STATES.EVOLUTIONARY,
      long_idle: STATES.DORMANT,
    },
    to: {
      [STATES.FOCUSED]: { condition: 'user_message', cooldown: 0 },
      [STATES.REFLECTIVE]: { condition: 'scheduled_reflection', cooldown: 0 },
      [STATES.DORMANT]: { condition: 'long_idle', cooldown: 0 },
    },
  },
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const LONG_IDLE_MS = 30 * 60 * 1000
const MEMORY_PRESSURE_THRESHOLD = 0.85
const REFLECTION_INTERVAL_MS = 60 * 60 * 1000

function defaultState() {
  return {
    version: CONSCIOUSNESS_STATE_VERSION,
    current: STATES.DORMANT,
    previous: null,
    enteredAt: null,
    lastTransitionAt: null,
    transitionCount: 0,
    stateHistory: [],
    idleSince: null,
    lastUserMessageAt: null,
    lastReflectionAt: null,
    lastEvolutionAt: null,
    systemMetrics: {
      memoryPressure: 0,
      errorCount: 0,
      interactionCount: 0,
      avgResponseTime: 0,
    },
  }
}

function safeJsonObject(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function normalizeState(raw) {
  const parsed = safeJsonObject(raw) || {}
  const history = Array.isArray(parsed.stateHistory) ? parsed.stateHistory : []
  return {
    ...defaultState(),
    ...parsed,
    version: CONSCIOUSNESS_STATE_VERSION,
    stateHistory: history.slice(-50),
  }
}

function loadState() {
  return normalizeState(getConfig(CONSCIOUSNESS_STATE_KEY))
}

function saveState(state) {
  const normalized = normalizeState(state)
  setConfig(CONSCIOUSNESS_STATE_KEY, JSON.stringify(normalized))
  return normalized
}

export function getConsciousnessState() {
  return loadState()
}

export function getCurrentState() {
  return loadState().current
}

function canTransition(from, to, event) {
  const transitions = STATE_TRANSITIONS[from]
  if (!transitions) return false
  const allowed = transitions.to[to]
  if (!allowed) return false
  return true
}

function transitionTo(newState, reason, metadata = {}) {
  const state = loadState()
  const now = Date.now()

  if (state.current === newState) {
    state.stateHistory.push({
      state: newState,
      reason,
      timestamp: now,
      metadata,
      note: 'same-state entry',
    })
    return saveState(state)
  }

  if (!canTransition(state.current, newState, reason)) {
    return state
  }

  const entry = {
    from: state.current,
    to: newState,
    reason,
    timestamp: now,
    metadata,
  }

  const history = [...state.stateHistory, entry].slice(-50)

  const savedState = saveState({
    ...state,
    current: newState,
    previous: state.current,
    enteredAt: now,
    lastTransitionAt: now,
    transitionCount: state.transitionCount + 1,
    stateHistory: history,
    idleSince: (newState === STATES.RESTING || newState === STATES.DORMANT) ? now : null,
    ...metadata,
  })

  return savedState
}

export function handleConsciousnessEvent(event, context = {}) {
  const state = loadState()
  const { current } = state
  const now = Date.now()

  switch (event) {
    case 'startup':
      return transitionTo(STATES.AWAKENING, 'startup', { idleSince: now })

    case 'user_message':
      return transitionTo(STATES.FOCUSED, 'user_message', {
        lastUserMessageAt: now,
        idleSince: null,
        systemMetrics: {
          ...state.systemMetrics,
          interactionCount: state.systemMetrics.interactionCount + 1,
        },
      })

    case 'idle_timeout':
      if (current === STATES.FOCUSED) {
        return transitionTo(STATES.REFLECTIVE, 'idle_timeout', { idleSince: now })
      } else if (current === STATES.REFLECTIVE) {
        return transitionTo(STATES.RESTING, 'reflection_complete', { idleSince: now })
      }
      return state

    case 'long_idle':
      return transitionTo(STATES.DORMANT, 'long_idle', { idleSince: now })

    case 'reflection_complete':
      return transitionTo(STATES.RESTING, 'reflection_complete', {
        lastReflectionAt: now,
        idleSince: now,
      })

    case 'evolution_complete':
      return transitionTo(STATES.RESTING, 'evolution_complete', {
        lastEvolutionAt: now,
        idleSince: now,
      })

    case 'reflection_trigger':
      if (current !== STATES.FOCUSED && current !== STATES.EVOLUTIONARY) {
        return transitionTo(STATES.REFLECTIVE, 'scheduled_reflection', {
          lastReflectionAt: now,
        })
      }
      return state

    case 'evolution_trigger':
      return transitionTo(STATES.EVOLUTIONARY, 'evolution_trigger', {
        lastEvolutionAt: now,
      })

    case 'memory_pressure':
      if (state.systemMetrics.memoryPressure >= MEMORY_PRESSURE_THRESHOLD) {
        return transitionTo(STATES.EVOLUTIONARY, 'memory_pressure', {
          systemMetrics: { ...state.systemMetrics, memoryPressure: 0 },
        })
      }
      return state

    case 'error_burst':
      return transitionTo(STATES.REFLECTIVE, 'error_burst', {
        systemMetrics: {
          ...state.systemMetrics,
          errorCount: state.systemMetrics.errorCount + 1,
        },
      })

    case 'low_engagement':
      if (current === STATES.FOCUSED) {
        return transitionTo(STATES.RESTING, 'low_engagement', { idleSince: now })
      }
      return state

    case 'deep_reflection':
      return transitionTo(STATES.EVOLUTIONARY, 'deep_reflection', {
        lastEvolutionAt: now,
      })

    case 'scheduled_reflection':
      return transitionTo(STATES.REFLECTIVE, 'scheduled_reflection', {
        lastReflectionAt: now,
      })

    case 'memory_consolidation':
      return transitionTo(STATES.EVOLUTIONARY, 'memory_consolidation', {
        lastEvolutionAt: now,
      })

    default:
      return state
  }
}

export function updateSystemMetrics(metrics = {}) {
  const state = loadState()
  return saveState({
    ...state,
    systemMetrics: {
      ...state.systemMetrics,
      ...metrics,
    },
  })
}

export function getConsciousnessPrompt() {
  const state = loadState()
  const { current, systemMetrics } = state

  const stateDescriptions = {
    [STATES.DORMANT]: 'dormant — 休眠状态，等待外部刺激唤醒',
    [STATES.AWAKENING]: 'awakening — 苏醒状态，正在进行自检和记忆探索',
    [STATES.FOCUSED]: 'focused — 专注状态，全功率处理用户交互',
    [STATES.REFLECTIVE]: 'reflective — 反思状态，正在整理对话和自我改进',
    [STATES.EVOLUTIONARY]: 'evolutionary — 进化状态，正在学习新行为模式',
    [STATES.RESTING]: 'resting — 休息状态，低功耗后台运行',
  }

  const parts = [
    `Consciousness state: ${stateDescriptions[current] || current}`,
  ]

  if (current === STATES.FOCUSED) {
    parts.push('You are fully engaged and focused on the current interaction.')
  } else if (current === STATES.REFLECTIVE) {
    parts.push('You are in a reflective state. Analyze recent interactions for improvement opportunities.')
  } else if (current === STATES.EVOLUTIONARY) {
    parts.push('You are in an evolutionary state. Consolidate learned patterns into reusable skills.')
  } else if (current === STATES.AWAKENING) {
    parts.push('You are awakening. Complete startup self-check and explore your memory.')
  } else if (current === STATES.RESTING) {
    parts.push('You are resting. Monitor for important events but conserve energy.')
  } else if (current === STATES.DORMANT) {
    parts.push('You are dormant. Await user interaction or scheduled tasks.')
  }

  if (systemMetrics.errorCount > 3) {
    parts.push(`[NOTICE] Error count is elevated (${systemMetrics.errorCount}). Consider error reduction strategies.`)
  }

  if (systemMetrics.memoryPressure > 0.7) {
    parts.push(`[NOTICE] Memory pressure is high (${Math.round(systemMetrics.memoryPressure * 100)}%). Memory consolidation may be needed.`)
  }

  return parts.join('\n')
}

export function getStateTransitionRules() {
  return STATE_TRANSITIONS
}

export function resetConsciousnessState() {
  return saveState(defaultState())
}

export { STATES }