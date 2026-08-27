/**
 * strategy-optimizer.js — 策略优化引擎
 *
 * 核心功能：基于积累的经验和蒸馏的知识，生成具体的行为策略优化
 * 设计原则：
 *   1. 策略可解释、可验证
 *   2. 渐进式优化，不做激进变更
 *   3. 策略与技能系统无缝对接
 *
 * 优化维度：
 *   1. 工具选择策略：何时用什么工具
 *   2. 回应策略：如何组织语言、选择语气
 *   3. 知识调用策略：何时检索什么知识
 *   4. 错误恢复策略：出错后如何自救
 */

import fs from 'fs'
import path from 'path'
import { queryExperiences } from './experience-collector.js'
import { queryKnowledge, KNOWLEDGE_TYPES } from './knowledge-distiller.js'

const STRATEGY_DIR = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'strategies')
  : path.join(process.env.HOME || '.', '.gina', 'strategies')

const STRATEGY_FILE = path.join(STRATEGY_DIR, 'optimized-strategies.json')
const HISTORY_FILE = path.join(STRATEGY_DIR, 'optimization-history.jsonl')

// 策略类型
const STRATEGY_TYPES = {
  TOOL_SELECTION: 'tool_selection',
  RESPONSE_TONE: 'response_tone',
  KNOWLEDGE_RETRIEVAL: 'knowledge_retrieval',
  ERROR_RECOVERY: 'error_recovery',
  TIMING: 'timing',
  PROACTIVITY: 'proactivity',
}

/**
 * 初始化策略存储
 */
function ensureStorage() {
  try {
    if (!fs.existsSync(STRATEGY_DIR)) {
      fs.mkdirSync(STRATEGY_DIR, { recursive: true })
    }
    if (!fs.existsSync(STRATEGY_FILE)) {
      fs.writeFileSync(STRATEGY_FILE, JSON.stringify({
        version: 1,
        updatedAt: null,
        strategies: [],
        globalSettings: getDefaultGlobalSettings(),
      }, null, 2), 'utf8')
    }
    if (!fs.existsSync(HISTORY_FILE)) {
      fs.writeFileSync(HISTORY_FILE, '', 'utf8')
    }
  } catch (e) {
    console.error('[策略优化] 存储初始化失败:', e?.message)
  }
}

function getDefaultGlobalSettings() {
  return {
    maxToolRetries: 2,
    toolTimeout_ms: 30000,
    knowledgeSearchDepth: 3,
    responseMaxTokens: 2000,
    proactiveSuggestionThreshold: 0.7,
    autoRecoveryEnabled: true,
    toneAdaptationEnabled: true,
  }
}

/**
 * 执行策略优化（主入口）
 */
export function optimizeStrategies({
  context = {},
  force = false,
} = {}) {
  ensureStorage()

  const startTime = Date.now()
  const result = {
    success: true,
    optimizations: [],
    newStrategies: [],
    updatedStrategies: [],
    duration_ms: 0,
  }

  // 1. 加载现有策略
  let state = loadState()

  // 2. 从经验中生成优化建议
  const experienceOptimizations = analyzeExperiencesForOptimization()
  result.optimizations.push(...experienceOptimizations)

  // 3. 从知识中生成优化建议
  const knowledgeOptimizations = analyzeKnowledgeForOptimization()
  result.optimizations.push(...knowledgeOptimizations)

  // 4. 从反思模式中生成优化建议
  const patternOptimizations = analyzePatternsForOptimization()
  result.optimizations.push(...patternOptimizations)

  // 5. 应用优化
  for (const opt of result.optimizations) {
    if (opt.priority >= 0.5 || force) {
      const applied = applyOptimization(opt, state)
      if (applied) {
        if (applied.isNew) {
          result.newStrategies.push(applied)
        } else {
          result.updatedStrategies.push(applied)
        }
      }
    }
  }

  // 6. 保存状态
  state.updatedAt = Date.now()
  saveState(state)

  // 7. 记录历史
  recordHistory(result)

  result.duration_ms = Date.now() - startTime
  result.totalOptimizations = result.optimizations.length

  return result
}

/**
 * 获取当前策略
 */
export function getCurrentStrategies() {
  ensureStorage()
  return loadState()
}

/**
 * 手动更新某个策略
 */
export function updateStrategy(strategyId, updates) {
  ensureStorage()
  const state = loadState()

  const index = state.strategies.findIndex(s => s.id === strategyId)
  if (index === -1) {
    return { success: false, error: '策略未找到' }
  }

  state.strategies[index] = {
    ...state.strategies[index],
    ...updates,
    updatedAt: Date.now(),
  }

  saveState(state)
  return { success: true, strategy: state.strategies[index] }
}

/**
 * 启用/禁用某个策略
 */
export function toggleStrategy(strategyId, enabled) {
  return updateStrategy(strategyId, { enabled })
}

/**
 * 生成系统提示词（包含所有当前策略）
 */
export function generateStrategyPrompt() {
  ensureStorage()
  const state = loadState()

  const activeStrategies = state.strategies.filter(s => s.enabled)
  const promptParts = [
    '## 行为策略指南',
    '',
  ]

  // 全局设置
  promptParts.push('### 全局设置')
  promptParts.push(`- 工具重试次数: ${state.globalSettings.maxToolRetries}`)
  promptParts.push(`- 工具超时: ${state.globalSettings.toolTimeout_ms}ms`)
  promptParts.push(`- 知识检索深度: ${state.globalSettings.knowledgeSearchDepth}`)
  promptParts.push(`- 响应最大token: ${state.globalSettings.responseMaxTokens}`)
  promptParts.push(`- 主动建议阈值: ${state.globalSettings.proactiveSuggestionThreshold}`)
  promptParts.push('')

  // 按类型分组的策略
  const byType = {}
  for (const s of activeStrategies) {
    if (!byType[s.type]) byType[s.type] = []
    byType[s.type].push(s)
  }

  for (const [type, strategies] of Object.entries(byType)) {
    promptParts.push(`### ${getTypeName(type)}`)
    for (const s of strategies) {
      promptParts.push(`- **${s.name}** (优先级: ${s.priority}): ${s.description}`)
      if (s.instructions) {
        promptParts.push(`  执行细节: ${s.instructions}`)
      }
    }
    promptParts.push('')
  }

  return promptParts.join('\n')
}

/**
 * 获取策略统计
 */
export function getStrategyStats() {
  ensureStorage()
  const state = loadState()
  const history = loadHistory()

  return {
    totalStrategies: state.strategies.length,
    activeStrategies: state.strategies.filter(s => s.enabled).length,
    byType: countByType(state.strategies),
    globalSettings: state.globalSettings,
    lastUpdated: state.updatedAt,
    optimizationHistoryCount: history.length,
    storagePath: STRATEGY_FILE,
  }
}

// ========== 优化分析逻辑 ==========

function analyzeExperiencesForOptimization() {
  const optimizations = []

  // 获取最近的失败经验
  const failures = queryExperiences({
    type: 'failure',
    limit: 20,
  })

  // 分析高频失败模式
  if (failures.length >= 3) {
    const toolFailures = groupByTool(failures)
    for (const [tool, fails] of Object.entries(toolFailures)) {
      if (fails.length >= 2) {
        optimizations.push({
          type: STRATEGY_TYPES.TOOL_SELECTION,
          name: `优化_${tool}_错误处理`,
          description: `工具 "${tool}" 在最近${fails.length}次调用中连续失败，需要改进错误处理策略`,
          priority: Math.min(1, fails.length / 5),
          action: 'add_error_handling',
          details: {
            tool,
            failureCount: fails.length,
            suggestedRetryDelay: 1000 * Math.pow(2, fails.length - 1), // 指数退避
          },
          createdAt: Date.now(),
        })
      }
    }
  }

  // 获取用户反馈经验
  const feedbacks = queryExperiences({
    type: 'user_feedback',
    limit: 15,
  })

  // 分析用户偏好
  if (feedbacks.length >= 3) {
    const negativeFeedback = feedbacks.filter(f => f.feedback?.sentiment === 'negative')
    const positiveFeedback = feedbacks.filter(f => f.feedback?.sentiment === 'positive')

    if (negativeFeedback.length >= 2) {
      const topics = new Set()
      for (const f of negativeFeedback) {
        for (const t of f.feedback?.topics || []) {
          topics.add(t)
        }
      }

      optimizations.push({
        type: STRATEGY_TYPES.RESPONSE_TONE,
        name: `调整_负面反馈_回应策略`,
        description: `检测到用户在以下话题有负面反馈：${Array.from(topics).join(', ')}，需要调整回应风格`,
        priority: 0.8,
        action: 'adapt_tone_for_negative_topics',
        details: {
          topics: Array.from(topics),
          suggestion: '对这些话题采用更谨慎、专业的语气',
        },
        createdAt: Date.now(),
      })
    }

    if (positiveFeedback.length >= 2) {
      const topics = new Set()
      for (const f of positiveFeedback) {
        for (const t of f.feedback?.topics || []) {
          topics.add(t)
        }
      }

      optimizations.push({
        type: STRATEGY_TYPES.PROACTIVITY,
        name: `强化_正面反馈_主动引导`,
        description: `用户对以下话题表现出兴趣：${Array.from(topics).join(', ')}，可主动深入`,
        priority: 0.6,
        action: 'proactively_explore_positive_topics',
        details: {
          topics: Array.from(topics),
          suggestion: '在相关对话中主动提及这些话题',
        },
        createdAt: Date.now(),
      })
    }
  }

  // 获取效率经验
  const efficiencyData = queryExperiences({
    type: 'efficiency',
    limit: 20,
  })

  // 分析性能瓶颈
  if (efficiencyData.length >= 3) {
    const avgDurations = calculateAverageDuration(efficiencyData)
    const slowTools = Object.entries(avgDurations)
      .filter(([_, avg]) => avg > 3000)
      .sort((a, b) => b[1] - a[1])

    for (const [tool, avgDuration] of slowTools.slice(0, 3)) {
      optimizations.push({
        type: STRATEGY_TYPES.TIMING,
        name: `优化_${tool}_执行时机`,
        description: `工具 "${tool}" 平均耗时${Math.round(avgDuration)}ms，考虑异步或缓存`,
        priority: Math.min(1, avgDuration / 10000),
        action: 'optimize_tool_execution',
        details: {
          tool,
          avgDuration_ms: avgDuration,
          suggestion: '考虑并行调用或结果缓存',
        },
        createdAt: Date.now(),
      })
    }
  }

  return optimizations
}

function analyzeKnowledgeForOptimization() {
  const optimizations = []

  // 获取策略类知识
  const strategyKnowledge = queryKnowledge({
    type: KNOWLEDGE_TYPES.STRATEGY,
    minConfidence: 0.6,
    limit: 10,
  })

  for (const k of strategyKnowledge) {
    if (k.content?.recommendation) {
      optimizations.push({
        type: STRATEGY_TYPES.KNOWLEDGE_RETRIEVAL,
        name: `应用知识: ${k.id}`,
        description: k.content.recommendation,
        priority: k.confidence,
        action: 'apply_knowledge_strategy',
        details: {
          knowledgeId: k.id,
          recommendation: k.content.recommendation,
        },
        createdAt: Date.now(),
      })
    }
  }

  // 获取规则类知识
  const ruleKnowledge = queryKnowledge({
    type: KNOWLEDGE_TYPES.RULE,
    minConfidence: 0.6,
    limit: 10,
  })

  for (const k of ruleKnowledge) {
    if (k.content?.recommendation) {
      optimizations.push({
        type: STRATEGY_TYPES.ERROR_RECOVERY,
        name: `应用规则: ${k.id}`,
        description: k.content.recommendation,
        priority: k.confidence * 0.9,
        action: 'apply_error_prevention_rule',
        details: {
          knowledgeId: k.id,
          patterns: k.content.pattern || [],
          errors: k.content.errors || [],
        },
        createdAt: Date.now(),
      })
    }
  }

  return optimizations
}

function analyzePatternsForOptimization() {
  const optimizations = []

  // 从经验中分析时间模式
  const recentExperiences = queryExperiences({ limit: 30 })

  if (recentExperiences.length >= 10) {
    // 分析最佳响应时间
    const successfulResponses = recentExperiences.filter(e => e.type === 'success')
    const successfulTools = successfulResponses.map(e => e.context?.toolName).filter(Boolean)

    if (successfulTools.length >= 3) {
      const toolFrequency = countFrequency(successfulTools)
      const topTools = Object.entries(toolFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)

      optimizations.push({
        type: STRATEGY_TYPES.TOOL_SELECTION,
        name: `优先选择_高频成功_工具`,
        description: `基于历史数据，以下工具成功率最高：${topTools.map(([t, c]) => `${t}(${c}次)`).join(', ')}`,
        priority: 0.7,
        action: 'prioritize_successful_tools',
        details: {
          toolPreferences: topTools.map(([tool, count]) => ({
            tool,
            weight: count / topTools.length,
          })),
        },
        createdAt: Date.now(),
      })
    }
  }

  return optimizations
}

// ========== 策略应用 ==========

function applyOptimization(optimization, state) {
  // 检查是否已存在相同策略
  const existing = state.strategies.find(s =>
    s.name === optimization.name ||
    (s.type === optimization.type && s.description === optimization.description)
  )

  if (existing) {
    // 更新现有策略
    existing.priority = Math.max(existing.priority, optimization.priority)
    existing.count = (existing.count || 0) + 1
    existing.lastTriggeredAt = Date.now()
    existing.triggerCount = (existing.triggerCount || 0) + 1
    existing.successRate = calculateSuccessRate(existing)

    return {
      isNew: false,
      strategy: existing,
    }
  }

  // 创建新策略
  const newStrategy = {
    id: `strat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: optimization.type,
    name: optimization.name,
    description: optimization.description,
    priority: optimization.priority,
    enabled: true,
    action: optimization.action,
    details: optimization.details,
    instructions: generateInstructions(optimization),
    count: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastTriggeredAt: Date.now(),
    triggerCount: 1,
    successRate: 0.8,
  }

  state.strategies.push(newStrategy)

  return {
    isNew: true,
    strategy: newStrategy,
  }
}

function generateInstructions(optimization) {
  const type = optimization.type

  switch (type) {
    case STRATEGY_TYPES.TOOL_SELECTION:
      if (optimization.action === 'add_error_handling') {
        return `当使用工具 "${optimization.details?.tool}" 失败时：
1. 检查错误类型：${optimization.details?.suggestedRetryDelay ? '使用指数退避重试' : '记录错误并转向备选方案'}
2. 重试间隔：${optimization.details?.suggestedRetryDelay || 1000}ms
3. 超过${2}次失败后，向用户解释并请求更多信息`
      }
      if (optimization.action === 'prioritize_successful_tools') {
        const prefs = optimization.details?.toolPreferences || []
        return `工具选择优先级：
1. 优先考虑：${prefs.slice(0, 2).map(p => p.tool).join(', ')}
2. 次选：其他可用工具
3. 当首选工具失败时，降级到次选`
      }
      return null

    case STRATEGY_TYPES.RESPONSE_TONE:
      return `回应风格调整：
1. 当话题涉及 ${optimization.details?.topics?.join(', ') || '敏感话题'} 时
2. 使用更加谨慎、专业的语气
3. 避免绝对化表达
4. 提供多角度分析`

    case STRATEGY_TYPES.PROACTIVITY:
      return `主动引导策略：
1. 当用户话题涉及 ${optimization.details?.topics?.join(', ') || '感兴趣的领域'} 时
2. 适时提出相关的延伸话题
3. 推荐相关资源或案例
4. 保持自然，避免过于主动`

    case STRATEGY_TYPES.KNOWLEDGE_RETRIEVAL:
      return `知识应用策略：
1. 当遇到相关问题时，优先检索 ${optimization.details?.knowledgeId ? `知识 ${optimization.details.knowledgeId}` : '相关知识'}
2. 应用以下建议：${optimization.details?.recommendation || ''}
3. 在回答中自然融入知识内容`

    case STRATEGY_TYPES.ERROR_RECOVERY:
      return `错误预防策略：
1. 在执行操作前，检查以下模式：${(optimization.details?.patterns || []).join(', ')}
2. 如果匹配，采取预防措施
3. 如果仍然失败，参考以下错误处理：${(optimization.details?.errors || []).join(', ')}`

    case STRATEGY_TYPES.TIMING:
      return `执行时机优化：
1. 对于耗时操作（${optimization.details?.tool}），考虑：
   - 异步执行
   - 结果缓存
   - 并行处理相关任务
2. 向用户说明处理进度`

    default:
      return null
  }
}

function calculateSuccessRate(strategy) {
  if (!strategy.triggerCount || strategy.triggerCount === 0) return 0.8
  const successes = strategy.successCount || Math.floor(strategy.triggerCount * 0.8)
  return successes / strategy.triggerCount
}

// ========== 存储与工具 ==========

function loadState() {
  try {
    if (fs.existsSync(STRATEGY_FILE)) {
      return JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf8'))
    }
  } catch (e) {
    console.error('[策略优化] 状态加载失败:', e?.message)
  }
  return {
    version: 1,
    updatedAt: null,
    strategies: [],
    globalSettings: getDefaultGlobalSettings(),
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STRATEGY_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (e) {
    console.error('[策略优化] 状态保存失败:', e?.message)
  }
}

function loadHistory() {
  try {
    const content = fs.readFileSync(HISTORY_FILE, 'utf8')
    return content.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

function recordHistory(result) {
  try {
    const record = {
      timestamp: Date.now(),
      totalOptimizations: result.totalOptimizations,
      newStrategies: result.newStrategies.length,
      updatedStrategies: result.updatedStrategies.length,
      duration_ms: result.duration_ms,
    }
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(record) + '\n', 'utf8')

    // 限制历史长度
    const history = loadHistory()
    if (history.length > 1000) {
      const trimmed = history.slice(-500)
      fs.writeFileSync(HISTORY_FILE, trimmed.map(h => JSON.stringify(h)).join('\n'), 'utf8')
    }
  } catch (e) {
    console.error('[策略优化] 历史记录失败:', e?.message)
  }
}

function groupByTool(experiences) {
  const grouped = {}
  for (const exp of experiences) {
    const tool = exp.context?.toolName || 'unknown'
    if (!grouped[tool]) grouped[tool] = []
    grouped[tool].push(exp)
  }
  return grouped
}

function calculateAverageDuration(experiences) {
  const durations = {}
  for (const exp of experiences) {
    const tool = exp.toolName || 'unknown'
    const duration = exp.duration_ms || 0
    if (!durations[tool]) durations[tool] = { total: 0, count: 0 }
    durations[tool].total += duration
    durations[tool].count++
  }

  const averages = {}
  for (const [tool, data] of Object.entries(durations)) {
    averages[tool] = data.total / data.count
  }
  return averages
}

function countFrequency(arr) {
  const freq = {}
  for (const item of arr) {
    freq[item] = (freq[item] || 0) + 1
  }
  return freq
}

function countByType(strategies) {
  const counts = {}
  for (const s of strategies) {
    counts[s.type] = (counts[s.type] || 0) + 1
  }
  return counts
}

function getTypeName(type) {
  const names = {
    [STRATEGY_TYPES.TOOL_SELECTION]: '工具选择策略',
    [STRATEGY_TYPES.RESPONSE_TONE]: '回应风格策略',
    [STRATEGY_TYPES.KNOWLEDGE_RETRIEVAL]: '知识检索策略',
    [STRATEGY_TYPES.ERROR_RECOVERY]: '错误恢复策略',
    [STRATEGY_TYPES.TIMING]: '执行时机策略',
    [STRATEGY_TYPES.PROACTIVITY]: '主动引导策略',
  }
  return names[type] || type
}

export {
  STRATEGY_TYPES,
  STRATEGY_DIR,
  STRATEGY_FILE,
  HISTORY_FILE,
}
