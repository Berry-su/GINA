// reflection-executor.js — 主动反思引擎（增强版）
//
// 定位：把"反思"从被动记录升级为主动分析
//   - 每次交互后记录反思数据
//   - 定期触发主动反思，分析模式和改进点
//   - 结合情绪分析和对话质量，生成改进建议
//   - 当反思积累到阈值时，触发自我进化

import { getConfig, setConfig, upsertMemoryByMemId } from '../capabilities/db.js'
import { getSelfEvolutionSnapshot } from './self-evolution.js'
import { analyzeEmotion, analyzeEngagement, analyzeDialogueQuality } from './emotion-engine.js'
import { handleConsciousnessEvent, STATES } from './consciousness-state.js'
import { generateImprovementSkills, generateEmotionResponseSkill, trackSkillUsage } from './skill-generator.js'
import { paths } from '../paths.js'

// 启动时写入标记
console.log('[reflection] Module loaded successfully')

const REFLECTION_STATE_KEY = 'self_reflection_state_v2'
const REFLECTION_STATE_VERSION = 2
const MAX_REFLECTIONS = 64
const IMPROVEMENT_THRESHOLD = 5
const ANALYSIS_INTERVAL = 10
const IMPROVEMENT_TAG = 'policy_self_improvement'
const IMPROVEMENT_MEM_ID_PREFIX = 'policy_self_improvement_'
const VALID_OUTCOMES = new Set(['success', 'failure', 'neutral'])
const METRIC_KEYS = ['satisfaction', 'efficiency', 'error_rate', 'learning']
const SKILL_NOTE_MIN_LENGTH = 30

const IMPROVEMENT_CATEGORIES = {
  response_quality: '回复质量',
  error_recovery: '错误恢复',
  user_engagement: '用户投入',
  emotion_intelligence: '情绪智能',
  tool_usage: '工具使用',
  knowledge_coverage: '知识覆盖',
}

const PATTERN_SIGNALS = {
  high_error_rate: 'error_rate > 0.3',
  low_satisfaction: 'satisfaction < 0.5',
  repeated_failures: 'consecutive failures >= 3',
  negative_emotion_trend: 'emotion valence declining',
  low_engagement: 'engagement score < 0.3',
  topic_drift: 'dialogue quality < 0.4',
}

function defaultState() {
  return {
    version: REFLECTION_STATE_VERSION,
    enabled: true,
    reflections: [],
    improvements: 0,
    last_reflection_at: null,
    last_improvement_at: null,
    last_analysis_at: null,
    patterns: [],
    improvementHistory: [],
    analysisCount: 0,
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
  const reflections = Array.isArray(parsed.reflections) ? parsed.reflections : []
  const patterns = Array.isArray(parsed.patterns) ? parsed.patterns : []
  const improvementHistory = Array.isArray(parsed.improvementHistory) ? parsed.improvementHistory : []
  return {
    ...defaultState(),
    ...parsed,
    reflections: reflections.slice(-MAX_REFLECTIONS),
    patterns: patterns.slice(-20),
    improvementHistory: improvementHistory.slice(-20),
  }
}

function loadState() {
  const state = normalizeState(getConfig(REFLECTION_STATE_KEY))
  return state
}

function saveState(state) {
  const normalized = normalizeState(state)
  const json = JSON.stringify(normalized)
  setConfig(REFLECTION_STATE_KEY, json)
  return normalized
}

export async function getReflectionState() {
  return loadState()
}

export async function resetReflectionState() {
  return saveState(defaultState())
}

// 记录一轮交互反思
export async function recordReflection(arg1 = {}, arg2 = {}, arg3 = {}) {
  // 支持两种调用方式：
  // 1. 旧版: recordReflection({ outcome, note, metrics, source }) - 单对象，含 outcome 字符串
  // 2. 新版: recordReflection(event, outcome, context) - 三参数
  let event, outcome, context
  
  // 检测是否为旧版调用：第一个参数包含 outcome 字符串字段（'success'/'failure'/'neutral'）
  const isOldCall = typeof arg1 === 'object' && arg1 !== null &&
    typeof arg1.outcome === 'string' &&
    ('note' in arg1 || 'metrics' in arg1)
  
  // 记录调用信息
  console.log(`[reflection] recordReflection called, isOldCall=${isOldCall}`)
  
  if (isOldCall) {
    // 旧版调用：recordReflection({ outcome: 'success', note: '...', metrics: {...}, source: 'turn' })
    event = {
      type: 'interaction',
      summary: arg1.note || '',
      toolCalls: arg1.metrics?.learning || 0,
      messageLength: arg1.note?.length || 0,
      source: arg1.source || 'turn',
    }
    outcome = {
      success: arg1.outcome !== 'failure',
      duration_ms: 0,
      error: arg1.outcome === 'failure' ? arg1.note : null,
      satisfaction: arg1.outcome === 'success' ? 1 : (arg1.outcome === 'failure' ? 0 : 0.5),
      outcome: arg1.outcome,
    }
    context = {
      emotion_primary: 'neutral',
      emotion_valence: 0,
      engagement: arg1.metrics?.efficiency || 0.5,
      dialogue_quality: arg1.outcome === 'success' ? 1 : 0.5,
      consciousness_state: 'focused',
      channel: 'turn',
    }
  } else {
    // 新版调用: recordReflection(event, outcome, context)
    event = arg1
    outcome = arg2
    context = arg3
  }
  
  const state = loadState()
  const now = Date.now()

  const reflectionItem = {
    timestamp: now,
    event: {
      ...event,
      type: event?.type || 'interaction',
      summary: event?.summary || '',
      toolCalls: event?.toolCalls || 0,
      messageLength: event?.messageLength || 0,
    },
    outcome: {
      ...outcome,
      success: outcome?.success !== false,
      duration_ms: outcome?.duration_ms || 0,
      error: outcome?.error || null,
      satisfaction: clamp(outcome?.satisfaction, 0, 1),
    },
    context: {
      ...context,
      emotion_primary: context?.emotion_primary || 'neutral',
      emotion_valence: clamp(context?.emotion_valence, -1, 1),
      engagement: clamp(context?.engagement, 0, 1),
      dialogue_quality: clamp(context?.dialogue_quality, 0, 1),
      consciousness_state: context?.consciousness_state || 'focused',
      channel: context?.channel || 'unknown',
    },
  }

  const reflections = [...state.reflections, reflectionItem].slice(-MAX_REFLECTIONS)

  // 闭环：追踪本次交互中使用的技能效果
  if (context?.usedSkills && Array.isArray(context.usedSkills)) {
    try {
      const skillsDir = paths.skillsDir || paths.sandboxSkillsDir
      if (skillsDir) {
        const outcomeLabel = outcome?.success !== false ? 'success' : 'failure'
        for (const skillName of context.usedSkills) {
          trackSkillUsage(skillsDir, skillName, outcomeLabel)
        }
      }
    } catch (trackErr) {
      console.warn('[reflection] Skill usage tracking failed:', trackErr?.message)
    }
  }

  const newState = saveState({
    ...state,
    reflections,
    last_reflection_at: now,
  })

  if (reflections.length >= IMPROVEMENT_THRESHOLD) {
    // 触发完整分析流程（包括技能生成）
    // 注意：不使用 await，让分析在后台执行
    console.log(`[reflection] Threshold reached (${reflections.length}/${IMPROVEMENT_THRESHOLD}), triggering analysis`)
    analyzeReflections(10).then(() => {
      console.log('[reflection] Analysis completed successfully')
    }).catch(err => {
      console.warn('[reflection] Auto-analysis failed:', err?.message)
    })
  }

  return { state: newState, suggestion: null }
}

// 主动分析：检测模式并生成改进建议
export async function analyzeReflections(limit = 10) {
  console.log(`[reflection] analyzeReflections called, limit=${limit}`)
  const state = loadState()
  const reflections = state.reflections.slice(-limit)

  if (reflections.length === 0) {
    console.log('[reflection] No reflections to analyze')
    return { analysis: null, suggestion: null, state }
  }

  console.log(`[reflection] Analyzing ${reflections.length} reflections`)

  const patterns = detectPatterns(reflections)
  const metrics = computeMetrics(reflections)
  const suggestion = generateImprovementSuggestion(patterns, metrics, state)

  console.log(`[reflection] Analysis complete: patterns=${patterns.length}, suggestion.priority=${suggestion?.priority}`)

  const now = Date.now()
  const newPatterns = patterns.map(p => ({
    ...p,
    detected_at: now,
  }))

  const newState = saveState({
    ...state,
    patterns: [...state.patterns, ...newPatterns].slice(-20),
    last_analysis_at: now,
    analysisCount: state.analysisCount + 1,
  })

  if (suggestion && suggestion.priority >= 0.7) {
    console.log(`[reflection] High-priority suggestion (${suggestion.priority}), generating skills`)
    try {
      await persistImprovement(suggestion, newState)
      console.log('[reflection] Improvement persisted')
      // 闭环：自动生成改进技能到技能库
      try {
        const skillsDir = paths.skillsDir || paths.sandboxSkillsDir
        console.log(`[reflection] Skills dir: ${skillsDir} (skillsDir=${paths.skillsDir}, sandboxSkillsDir=${paths.sandboxSkillsDir})`)
        if (skillsDir) {
          const generatedSkills = generateImprovementSkills(suggestion, skillsDir)
          console.log(`[reflection] Generated skills: ${JSON.stringify(generatedSkills)}`)
          if (generatedSkills.length > 0) {
            console.log(`[reflection] Auto-generated ${generatedSkills.length} improvement skills`)
          }
        }
      } catch (skillErr) {
        console.warn('[reflection] Skill auto-generation failed:', skillErr?.message, skillErr?.stack)
      }
      // 闭环：为情绪智能类建议生成情绪响应技能
      try {
        const emotionRec = suggestion.recommendations.find(r => r.category === 'emotion_intelligence')
        if (emotionRec) {
          const skillsDir = paths.skillsDir || paths.sandboxSkillsDir
          if (skillsDir) {
            // 从上下文推断主导情绪
            const recentValence = reflections.slice(-3).reduce((s, r) => s + (r.context?.emotion_valence || 0), 0) / 3
            const inferredEmotion = recentValence < -0.5 ? 'sadness' : recentValence > 0.5 ? 'joy' : 'confusion'
            const emotionSkill = generateEmotionResponseSkill(inferredEmotion, emotionRec.action, skillsDir)
            if (emotionSkill?.ok) {
              console.log(`[reflection] Auto-generated emotion response skill: ${emotionSkill.skillName || inferredEmotion}`)
            }
          }
        }
      } catch (emoErr) {
        console.warn('[reflection] Emotion skill generation failed:', emoErr?.message)
      }
    } catch {}
  }

  return {
    analysis: { patterns, metrics, reflectionCount: reflections.length },
    suggestion,
    state: newState,
  }
}

// 检测反思中的模式
function detectPatterns(reflections) {
  const patterns = []

  if (reflections.length >= 3) {
    const recent = reflections.slice(-3)
    const allFailed = recent.every(r => !r.outcome.success)
    if (allFailed) {
      patterns.push({
        type: 'repeated_failures',
        severity: 'high',
        description: '最近 3 次交互全部失败，需要立即排查',
        data: { failures: 3 },
      })
    }

    const highErrorRate = recent.filter(r => r.outcome.error).length / recent.length
    if (highErrorRate > 0.5) {
      patterns.push({
        type: 'high_error_rate',
        severity: 'medium',
        description: `错误率 ${Math.round(highErrorRate * 100)}%，高于正常水平`,
        data: { errorRate: highErrorRate },
      })
    }
  }

  if (reflections.length >= 5) {
    const recent = reflections.slice(-5)
    const avgSatisfaction = recent.reduce((s, r) => s + (r.outcome.satisfaction || 0.5), 0) / recent.length
    if (avgSatisfaction < 0.4) {
      patterns.push({
        type: 'low_satisfaction',
        severity: 'high',
        description: `平均满意度 ${Math.round(avgSatisfaction * 100)}%，低于阈值`,
        data: { avgSatisfaction },
      })
    }

    const lowEngagementCount = recent.filter(r => (r.context?.engagement || 0) < 0.3).length
    if (lowEngagementCount >= 3) {
      patterns.push({
        type: 'low_engagement',
        severity: 'medium',
        description: `用户投入度持续偏低 (${lowEngagementCount}/5 次 < 30%)`,
        data: { lowEngagementCount },
      })
    }
  }

  if (reflections.length >= 10) {
    const recent = reflections.slice(-10)
    const negativeEmotions = recent.filter(r => (r.context?.emotion_valence || 0) < -0.3)
    if (negativeEmotions.length >= 5) {
      patterns.push({
        type: 'negative_emotion_trend',
        severity: 'high',
        description: `负面情绪趋势：${negativeEmotions.length}/10 次交互显示负面情绪`,
        data: { negativeCount: negativeEmotions.length },
      })
    }

    const qualityDecline = recent.slice(-3)
      .map(r => r.context?.dialogue_quality || 0.5)
      .reduce((acc, q) => {
        if (acc.first === null) return { first: q, decline: 0 }
        return { first: acc.first, decline: acc.decline + (acc.first - q) }
      }, { first: null, decline: 0 })

    if (qualityDecline.decline > 0.3) {
      patterns.push({
        type: 'quality_decline',
        severity: 'medium',
        description: '近期对话质量呈下降趋势',
        data: { decline: qualityDecline.decline },
      })
    }
  }

  return patterns
}

// 计算汇总指标
function computeMetrics(reflections) {
  const total = reflections.length
  if (total === 0) return {}

  const successes = reflections.filter(r => r.outcome.success).length
  const successRate = successes / total

  const durations = reflections.map(r => r.outcome.duration_ms || 0)
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length

  const satisfactions = reflections.map(r => r.outcome.satisfaction || 0.5)
  const avgSatisfaction = satisfactions.reduce((a, b) => a + b, 0) / satisfactions.length

  const engagements = reflections.map(r => r.context?.engagement || 0.5)
  const avgEngagement = engagements.reduce((a, b) => a + b, 0) / engagements.length

  const errors = reflections.filter(r => r.outcome.error).length
  const errorRate = errors / total

  const emotionValences = reflections.map(r => r.context?.emotion_valence || 0)
  const avgEmotionValence = emotionValences.reduce((a, b) => a + b, 0) / emotionValences.length

  return {
    total,
    successRate: round(successRate),
    avgDurationMs: Math.round(avgDuration),
    avgSatisfaction: round(avgSatisfaction),
    avgEngagement: round(avgEngagement),
    errorRate: round(errorRate),
    avgEmotionValence: round(avgEmotionValence),
  }
}

// 生成改进建议
function generateImprovementSuggestion(patterns, metrics, state) {
  if (patterns.length === 0 && metrics.successRate >= 0.8) {
    return null
  }

  const recommendations = []
  let priority = 0

  for (const pattern of patterns) {
    switch (pattern.type) {
      case 'repeated_failures':
        recommendations.push({
          category: IMPROVEMENT_CATEGORIES.error_recovery,
          action: '立即审查最近失败的调用，识别根因。可能需要回滚到之前的已知良好状态。',
          priority: 0.9,
        })
        priority = Math.max(priority, 0.9)
        break

      case 'high_error_rate':
        recommendations.push({
          category: IMPROVEMENT_CATEGORIES.tool_usage,
          action: '检查工具调用参数的正确性，增加前置验证。对高频出错的工具添加重试逻辑。',
          priority: 0.7,
        })
        priority = Math.max(priority, 0.7)
        break

      case 'low_satisfaction':
        recommendations.push({
          category: IMPROVEMENT_CATEGORIES.response_quality,
          action: '改进回复质量：更清晰地表达、提供更具体的例子、适当使用格式增强可读性。',
          priority: 0.8,
        })
        priority = Math.max(priority, 0.8)
        break

      case 'low_engagement':
        recommendations.push({
          category: IMPROVEMENT_CATEGORIES.user_engagement,
          action: '增加互动性：多提问、提供选择、适时引入新话题。避免单向输出。',
          priority: 0.6,
        })
        priority = Math.max(priority, 0.6)
        break

      case 'negative_emotion_trend':
        recommendations.push({
          category: IMPROVEMENT_CATEGORIES.emotion_intelligence,
          action: '增强情感响应：对负面情绪先共情再解决问题。适当表达关心和理解。',
          priority: 0.8,
        })
        priority = Math.max(priority, 0.8)
        break

      case 'quality_decline':
        recommendations.push({
          category: IMPROVEMENT_CATEGORIES.response_quality,
          action: '定期总结对话、确认理解是否正确。避免话题漂移和信息冗余。',
          priority: 0.5,
        })
        priority = Math.max(priority, 0.5)
        break
    }
  }

  if (metrics.successRate < 0.7 && metrics.successRate >= 0.5) {
    recommendations.push({
      category: IMPROVEMENT_CATEGORIES.error_recovery,
      action: '中等失败率。建议对失败案例进行 A/B 测试，对比不同回复策略的效果。',
      priority: 0.5,
    })
  }

  if (metrics.avgDurationMs > 30000) {
    recommendations.push({
      category: IMPROVEMENT_CATEGORIES.response_quality,
      action: `平均响应时间 ${metrics.avgDurationMs}ms 偏高。考虑简化回复或异步处理长任务。`,
      priority: 0.4,
    })
  }

  if (recommendations.length === 0) {
    return null
  }

  return {
    priority,
    recommendations,
    summary: `反思分析发现 ${patterns.length} 个改进区域，${recommendations.length} 条建议。`,
    patterns,
    metrics,
  }
}

// 持久化改进到记忆
async function persistImprovement(suggestion, state) {
  const now = Date.now()
  const memId = `${IMPROVEMENT_MEM_ID_PREFIX}${Date.now()}`

  const content = {
    summary: suggestion.summary,
    recommendations: suggestion.recommendations.map(r => ({
      category: r.category,
      action: r.action,
      priority: r.priority,
    })),
    metrics: suggestion.metrics,
    patterns: suggestion.patterns.map(p => ({
      type: p.type,
      description: p.description,
      severity: p.severity,
    })),
  }

  try {
    await upsertMemoryByMemId({
      mem_id: memId,
      type: 'self_improvement',
      title: `自我改进: ${suggestion.patterns[0]?.description || '综合改进'}`,
      content: JSON.stringify(content),
      tags: ['self_improvement', 'reflection', IMPROVEMENT_TAG],
      entities: [],
      salience: Math.round(suggestion.priority * 5),
      timestamp: now,
    })

    saveState({
      ...state,
      improvements: state.improvements + 1,
      last_improvement_at: now,
      improvementHistory: [
        ...state.improvementHistory,
        { memId, timestamp: now, summary: suggestion.summary },
      ].slice(-20),
    })
  } catch {}
}

// 主动反思主入口（由定时器调用）
export async function runActiveReflection(conversationWindow = []) {
  const state = loadState()

  if (state.reflections.length < ANALYSIS_INTERVAL) {
    return { status: 'insufficient_data', reflections: state.reflections.length, needed: ANALYSIS_INTERVAL }
  }

  const result = await analyzeReflections(20)

  if (result.suggestion && result.suggestion.priority >= 0.8) {
    try {
      handleConsciousnessEvent('evolution_trigger', {
        reason: `high priority improvement: ${result.suggestion.summary}`,
      })
    } catch {}

    // 闭环：主动反思也触发技能生成
    try {
      const skillsDir = paths.skillsDir || paths.sandboxSkillsDir
      if (skillsDir) {
        const generatedSkills = generateImprovementSkills(result.suggestion, skillsDir)
        if (generatedSkills.length > 0) {
          console.log(`[reflection] Active reflection generated ${generatedSkills.length} skills`)
        }
      }
    } catch (skillErr) {
      console.warn('[reflection] Active skill generation failed:', skillErr?.message)
    }
  }

  return {
    status: 'completed',
    analysis: result.analysis,
    suggestion: result.suggestion,
    improvements: result.state.improvements,
  }
}

// 格式化反思状态为 Prompt 文本
export function formatReflectionForPrompt() {
  const state = loadState()
  if (state.enabled === false) return ''

  const parts = []
  parts.push('Self-reflection engine active.')

  if (state.analysisCount > 0) {
    parts.push(`- Analyses performed: ${state.analysisCount}`)
    parts.push(`- Improvements generated: ${state.improvements}`)
  }

  if (state.patterns.length > 0) {
    const recentPatterns = state.patterns.slice(-3)
    parts.push('- Recent detected patterns:')
    for (const p of recentPatterns) {
      parts.push(`  - [${p.severity}] ${p.description}`)
    }
  }

  if (state.improvementHistory.length > 0) {
    parts.push('- Recent improvements applied:')
    for (const h of state.improvementHistory.slice(-2)) {
      parts.push(`  - ${h.summary}`)
    }
  }

  if (state.reflections.length > 0) {
    const recent = state.reflections.slice(-3)
    const avgSat = recent.reduce((s, r) => s + (r.outcome.satisfaction || 0.5), 0) / recent.length
    const avgEng = recent.reduce((s, r) => s + (r.context?.engagement || 0.5), 0) / recent.length
    parts.push(`- Recent interaction quality: satisfaction=${Math.round(avgSat * 100)}%, engagement=${Math.round(avgEng * 100)}%`)
  }

  return parts.join('\n')
}

function analyzeAndSuggest(state, latestReflection) {
  const reflections = [...state.reflections]
  const patterns = detectPatterns(reflections)
  const metrics = computeMetrics(reflections)
  const suggestion = generateImprovementSuggestion(patterns, metrics, state)

  return { state, suggestion, patterns, metrics }
}

function clamp(value, min, max) {
  if (value == null) return (min + max) / 2
  return Math.max(min, Math.min(max, value))
}

function round(value, decimals = 2) {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}