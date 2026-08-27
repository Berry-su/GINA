/**
 * growth-engine.js — 成长引擎（主控制器）
 *
 * 核心职责：协调经验积累、知识蒸馏、策略优化、主动思考四个子系统
 * 形成完整的"记录→学习→优化→思考"闭环
 *
 * 成长闭环：
 *   1. 经验积累：记录每一次交互的成功/失败/反馈
 *   2. 知识蒸馏：从经验中提炼结构化知识
 *   3. 策略优化：基于知识和经验优化行为策略
 *   4. 主动思考：自发产生学习任务，拓展知识边界
 */

import fs from 'fs'
import path from 'path'

import {
  recordSuccessExperience,
  recordFailureExperience,
  recordEfficiencyExperience,
  recordUserFeedbackExperience,
  recordDialogueExperiences,
  queryExperiences,
  getExperienceStats,
  extractLearningPoints,
} from './experience-collector.js'

import {
  distillKnowledge,
  addKnowledge,
  queryKnowledge,
  retrieveRelevantKnowledge,
  verifyKnowledge,
  getKnowledgeStats,
  getKnowledgeGraph,
} from './knowledge-distiller.js'

import {
  optimizeStrategies,
  getCurrentStrategies,
  updateStrategy,
  toggleStrategy,
  generateStrategyPrompt,
  getStrategyStats,
} from './strategy-optimizer.js'

import {
  startThinkingLoop,
  runThinkingCycle,
  getThinkingState,
  getRecentInsights,
  getThinkingStats,
  generateThinkingTasksForAPI,
  THINKING_TYPES,
} from './active-thinker.js'

// 数据库依赖（可选，用于生产环境；测试环境可降级为文件存储）
// 注意：better-sqlite3 可能因 Node.js 版本不兼容而加载失败
let _dbGetConfig = null
let _dbSetConfig = null
let dbAvailable = false

// 尝试加载数据库模块，如果失败则降级为文件存储
try {
  const dbModule = await import('../capabilities/db.js')
  _dbGetConfig = dbModule.getConfig
  _dbSetConfig = dbModule.setConfig
  dbAvailable = true
  console.log('[成长引擎] 数据库模块已加载')
} catch {
  console.warn('[成长引擎] 数据库模块不可用，使用文件系统作为备选存储')
}

// 文件系统备选存储
const GROWTH_DATA_DIR = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'growth-engine')
  : path.join(process.env.HOME || '.', '.gina', 'growth-engine')

function fsGetConfig(key) {
  try {
    const p = path.join(GROWTH_DATA_DIR, `${key}.json`)
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  } catch {}
  return null
}

function fsSetConfig(key, value) {
  try {
    fs.mkdirSync(GROWTH_DATA_DIR, { recursive: true })
    const p = path.join(GROWTH_DATA_DIR, `${key}.json`)
    fs.writeFileSync(p, value, 'utf8')
  } catch (e) {
    console.error('[成长引擎] 文件存储失败:', e?.message)
  }
}

// 统一的配置存储接口（带降级策略）
function getConfigSafe(key) {
  // 优先使用数据库
  if (dbAvailable && _dbGetConfig) {
    try {
      const result = _dbGetConfig(key)
      if (result) return result
    } catch {
      // 数据库调用失败，降级到文件系统
      dbAvailable = false
      console.warn('[成长引擎] 数据库调用失败，降级到文件系统存储')
    }
  }
  // 使用文件系统
  return fsGetConfig(key)
}

function setConfigSafe(key, value) {
  // 优先使用数据库
  if (dbAvailable && _dbSetConfig) {
    try {
      _dbSetConfig(key, value)
      return // 成功则不写入文件系统
    } catch {
      // 数据库调用失败，降级到文件系统
      dbAvailable = false
      console.warn('[成长引擎] 数据库写入失败，降级到文件系统存储')
    }
  }
  // 使用文件系统
  fsSetConfig(key, value)
}

const GROWTH_CONFIG_KEY = 'growth_engine_config_v1'
const GROWTH_STATE_KEY = 'growth_engine_state_v1'

// 成长阶段
const GROWTH_STAGES = {
  SEEDLING: {
    name: '萌芽期',
    minExperience: 10,
    description: '积累基础经验，建立初始知识库',
  },
  GROWING: {
    name: '成长期',
    minExperience: 50,
    description: '开始生成知识和策略，形成初步的自我改进能力',
  },
  MATURE: {
    name: '成熟期',
    minExperience: 100,
    description: '建立完整的成长闭环，具备主动学习和持续进化能力',
  },
  EVOLVING: {
    name: '进化期',
    minExperience: 200,
    description: '深度整合各子系统，实现自主决策和创造性思考',
  },
}

let initialized = false
let thinkingLoopStarted = false
let autoGrowthTimer = null

/**
 * 初始化成长引擎
 */
export function initGrowthEngine({
  autoStartThinking = true,
  thinkingIntervalMs = 5 * 60 * 1000,
  autoGrowthIntervalMs = 30 * 60 * 1000,
  onGrowthEvent = null,
} = {}) {
  if (initialized) {
    console.log('[成长引擎] 已初始化')
    return getState()
  }

  console.log('[成长引擎] 初始化中...')

  const config = loadConfig()

  // 保存配置
  setConfigSafe(GROWTH_CONFIG_KEY, JSON.stringify({
    ...config,
    autoStartThinking,
    thinkingIntervalMs,
    autoGrowthIntervalMs,
  }))

  // 启动思考循环
  if (autoStartThinking && !thinkingLoopStarted) {
    startThinkingLoop({
      intervalMs: thinkingIntervalMs,
      maxConcurrentTasks: 2,
      onInsightGenerated: (insights, task) => {
        handleInsights(insights, task)
        if (onGrowthEvent) {
          onGrowthEvent({
            type: 'insight_generated',
            insights,
            taskType: task?.type,
            timestamp: Date.now(),
          })
        }
      },
    })
    thinkingLoopStarted = true
    console.log(`[成长引擎] 思考循环已启动，间隔 ${thinkingIntervalMs / 60000} 分钟`)
  }

  // 启动自动成长循环
  if (autoGrowthIntervalMs > 0) {
    autoGrowthTimer = setInterval(async () => {
      try {
        await runGrowthCycle({ auto: true })
      } catch (e) {
        console.error('[成长引擎] 自动成长循环错误:', e?.message)
      }
    }, autoGrowthIntervalMs)
    console.log(`[成长引擎] 自动成长循环已启动，间隔 ${autoGrowthIntervalMs / 60000} 分钟`)
  }

  initialized = true
  console.log('[成长引擎] 初始化完成')

  return getState()
}

/**
 * 执行一次完整的成长周期
 */
export async function runGrowthCycle({ auto = false } = {}) {
  const startTime = Date.now()
  const results = {
    success: true,
    auto,
    phases: {},
    totalDuration_ms: 0,
  }

  try {
    // Phase 1: 知识蒸馏
    console.log('[成长引擎] Phase 1: 知识蒸馏...')
    const distillResult = distillKnowledge({
      batchSize: 50,
      minConfidence: 0.5,
    })
    results.phases.distillation = distillResult

    // Phase 2: 策略优化
    console.log('[成长引擎] Phase 2: 策略优化...')
    const optimizeResult = optimizeStrategies({})
    results.phases.optimization = optimizeResult

    // Phase 3: 主动思考
    console.log('[成长引擎] Phase 3: 主动思考...')
    const thinkingResult = await runThinkingCycle({ maxConcurrentTasks: 2 })
    results.phases.thinking = thinkingResult

    // Phase 4: 生成新的学习任务（好奇心驱动）
    if (!auto || Math.random() > 0.5) {
      const curiosityTasks = generateThinkingTasksForAPI({
        type: 'curiosity',
        count: 1,
      })
      results.phases.curiosity = { tasks: curiosityTasks }
    }

  } catch (e) {
    results.success = false
    results.error = e?.message
    console.error('[成长引擎] 成长周期失败:', e?.message)
  }

  results.totalDuration_ms = Date.now() - startTime

  // 更新状态
  updateGrowthState(results)

  return results
}

/**
 * 记录一次交互经验
 */
export function recordInteraction({
  success,
  action,
  result,
  error = null,
  userResponse = null,
  toolName = null,
  duration_ms = 0,
  metadata = {},
} = {}) {
  // 记录成功/失败
  if (success) {
    recordSuccessExperience({
      action,
      result,
      context: { toolName, duration_ms },
      userResponse,
      metadata,
    })
  } else {
    recordFailureExperience({
      action,
      error,
      context: { toolName, duration_ms },
      recovery: null,
      metadata,
    })
  }

  // 记录效率
  if (toolName) {
    recordEfficiencyExperience({
      toolName,
      duration_ms,
      success,
      context: { conversationStage: 'interaction' },
    })
  }

  // 记录用户反馈
  if (userResponse) {
    recordUserFeedbackExperience({
      feedback: userResponse,
      context: { relatedAction: action },
    })
  }

  // 更新成长状态
  const state = loadGrowthState()
  state.totalInteractions = (state.totalInteractions || 0) + 1
  state.successfulInteractions = (state.successfulInteractions || 0) + (success ? 1 : 0)
  state.failedInteractions = (state.failedInteractions || 0) + (success ? 0 : 1)
  state.lastInteractionAt = Date.now()
  saveGrowthState(state)

  return { success: true, recorded: true }
}

/**
 * 记录一次完整对话的经验
 */
export function recordDialogue({
  dialogueId,
  turns = [],
  outcome = {},
  context = {},
} = {}) {
  const result = recordDialogueExperiences({
    dialogueId,
    turns,
    outcome,
    context,
  })

  // 更新成长状态
  const state = loadGrowthState()
  state.totalDialogues = (state.totalDialogues || 0) + 1
  state.lastDialogueAt = Date.now()
  saveGrowthState(state)

  return result
}

/**
 * 获取成长状态（综合所有子系统状态）
 */
export function getGrowthStatus() {
  const experienceStats = getExperienceStats()
  const knowledgeStats = getKnowledgeStats()
  const strategyStats = getStrategyStats()
  const thinkingStats = getThinkingStats()
  const growthState = loadGrowthState()

  // 计算成长阶段
  const stage = determineGrowthStage(experienceStats.total)

  return {
    initialized,
    thinkingLoopStarted,
    autoGrowthActive: !!autoGrowthTimer,
    stage: stage.name,
    stageDescription: stage.description,
    progress: calculateProgressToNextStage(experienceStats.total),
    experience: experienceStats,
    knowledge: knowledgeStats,
    strategy: strategyStats,
    thinking: thinkingStats,
    growth: {
      totalInteractions: growthState.totalInteractions || 0,
      successfulRate: growthState.totalInteractions > 0
        ? (growthState.successfulInteractions || 0) / growthState.totalInteractions
        : 0,
      lastGrowthAt: growthState.lastGrowthAt,
      totalGrowthCycles: growthState.totalGrowthCycles || 0,
    },
  }
}

/**
 * 获取当前状态（简版）
 */
export function getState() {
  return getGrowthStatus()
}

/**
 * 获取系统提示词（包含当前策略）
 */
export function getSystemPrompt() {
  return generateStrategyPrompt()
}

/**
 * 重置成长引擎
 */
export function resetGrowthEngine({ confirm = false } = {}) {
  if (!confirm) {
    return { success: false, message: '请确认后再重置' }
  }

  // 清除状态
  setConfigSafe(GROWTH_STATE_KEY, JSON.stringify({
    totalInteractions: 0,
    totalDialogues: 0,
    lastInteractionAt: null,
    lastDialogueAt: null,
    lastGrowthAt: null,
    totalGrowthCycles: 0,
  }))

  return { success: true, message: '成长引擎已重置（历史经验和知识保留）' }
}

// ========== 洞察处理 ==========

function handleInsights(insights, task) {
  for (const insight of insights) {
    // 如果是学习建议，自动生成学习任务
    if (insight.action === 'start_learning' && insight.topic) {
      generateThinkingTasksForAPI({
        type: THINKING_TYPES.CURIOSITY,
        count: 1,
      })
    }

    // 如果是知识优化建议，自动执行优化
    if (insight.action === 'improve_knowledge_discovery' && insight.knowledgeIds) {
      // 这里可以添加自动优化逻辑
      console.log(`[成长引擎] 洞察: 建议优化${insight.knowledgeIds.length}条知识的可发现性`)
    }

    // 如果是策略审查建议
    if (insight.action === 'review_strategies' && insight.strategyIds) {
      console.log(`[成长引擎] 洞察: 建议审查${insight.strategyIds.length}个低效策略`)
    }
  }
}

// ========== 状态管理 ==========

function loadConfig() {
  try {
    const raw = getConfigSafe(GROWTH_CONFIG_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {
    autoStartThinking: true,
    thinkingIntervalMs: 5 * 60 * 1000,
    autoGrowthIntervalMs: 30 * 60 * 1000,
  }
}

function loadGrowthState() {
  try {
    const raw = getConfigSafe(GROWTH_STATE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {
    totalInteractions: 0,
    totalDialogues: 0,
    successfulInteractions: 0,
    failedInteractions: 0,
    lastInteractionAt: null,
    lastDialogueAt: null,
    lastGrowthAt: null,
    totalGrowthCycles: 0,
  }
}

function saveGrowthState(state) {
  try {
    setConfigSafe(GROWTH_STATE_KEY, JSON.stringify(state))
  } catch (e) {
    console.error('[成长引擎] 状态保存失败:', e?.message)
  }
}

function updateGrowthState(results) {
  const state = loadGrowthState()
  state.lastGrowthAt = Date.now()
  state.totalGrowthCycles = (state.totalGrowthCycles || 0) + 1
  saveGrowthState(state)
}

function determineGrowthStage(totalExperiences) {
  if (totalExperiences >= GROWTH_STAGES.EVOLVING.minExperience) {
    return GROWTH_STAGES.EVOLVING
  }
  if (totalExperiences >= GROWTH_STAGES.MATURE.minExperience) {
    return GROWTH_STAGES.MATURE
  }
  if (totalExperiences >= GROWTH_STAGES.GROWING.minExperience) {
    return GROWTH_STAGES.GROWING
  }
  return GROWTH_STAGES.SEEDLING
}

function calculateProgressToNextStage(totalExperiences) {
  const stages = Object.values(GROWTH_STAGES)
  for (let i = 0; i < stages.length - 1; i++) {
    if (totalExperiences < stages[i + 1].minExperience) {
      const current = stages[i].minExperience
      const next = stages[i + 1].minExperience
      return Math.min(1, (totalExperiences - current) / (next - current))
    }
  }
  return 1
}

// ========== 兼容导出（供现有代码使用） ==========

export {
  // 经验积累
  recordSuccessExperience,
  recordFailureExperience,
  recordEfficiencyExperience,
  recordUserFeedbackExperience,
  recordDialogueExperiences,
  queryExperiences,
  getExperienceStats,
  extractLearningPoints,

  // 知识蒸馏
  distillKnowledge,
  addKnowledge,
  queryKnowledge,
  retrieveRelevantKnowledge,
  verifyKnowledge,
  getKnowledgeStats,
  getKnowledgeGraph,

  // 策略优化
  optimizeStrategies,
  getCurrentStrategies,
  updateStrategy,
  toggleStrategy,
  generateStrategyPrompt,
  getStrategyStats,

  // 主动思考
  startThinkingLoop,
  runThinkingCycle,
  getThinkingState,
  getRecentInsights,
  getThinkingStats,
  generateThinkingTasksForAPI,
  THINKING_TYPES,

  // 常量
  GROWTH_STAGES,
}
