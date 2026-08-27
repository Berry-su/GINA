/**
 * active-thinker.js — 主动思考引擎
 *
 * 核心功能：让 AI 能够主动发起思考和学习，不只是被动响应
 * 设计原则：
 *   1. 思考是持续的后台过程，不阻塞主对话
 *   2. 思考任务有优先级和调度
 *   3. 思考结果可以反哺到知识和策略系统
 *
 * 思考类型：
 *   1. 好奇心驱动：对新事物的探索
 *   2. 问题驱动：解决现有知识中的矛盾
 *   3. 优化驱动：改进现有策略的效率
 *   4. 创造驱动：生成新的想法和假设
 */

import fs from 'fs'
import path from 'path'
import { queryExperiences, extractLearningPoints } from './experience-collector.js'
import { queryKnowledge, KNOWLEDGE_TYPES } from './knowledge-distiller.js'
import { getCurrentStrategies } from './strategy-optimizer.js'

const THINKING_DIR = process.env.GINA_HOME
  ? path.join(process.env.GINA_HOME, 'thinking')
  : path.join(process.env.HOME || '.', '.gina', 'thinking')

const TASKS_FILE = path.join(THINKING_DIR, 'thinking-tasks.jsonl')
const STATE_FILE = path.join(THINKING_DIR, 'thinking-state.json')
const INSIGHTS_FILE = path.join(THINKING_DIR, 'insights.jsonl')

// 思考任务类型
const THINKING_TYPES = {
  CURIOSITY: 'curiosity',
  PROBLEM_SOLVING: 'problem_solving',
  OPTIMIZATION: 'optimization',
  CREATIVITY: 'creativity',
  CONSOLIDATION: 'consolidation',
}

// 任务状态
const TASK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}

/**
 * 初始化思考存储
 */
function ensureStorage() {
  try {
    if (!fs.existsSync(THINKING_DIR)) {
      fs.mkdirSync(THINKING_DIR, { recursive: true })
    }
    if (!fs.existsSync(TASKS_FILE)) {
      fs.writeFileSync(TASKS_FILE, '', 'utf8')
    }
    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageDuration_ms: 0,
        lastThinkingAt: null,
        mode: 'idle',
      }, null, 2), 'utf8')
    }
    if (!fs.existsSync(INSIGHTS_FILE)) {
      fs.writeFileSync(INSIGHTS_FILE, '', 'utf8')
    }
  } catch (e) {
    console.error('[主动思考] 存储初始化失败:', e?.message)
  }
}

/**
 * 主循环：定期生成和执行思考任务
 */
export function startThinkingLoop({
  intervalMs = 5 * 60 * 1000, // 5分钟检查一次
  maxConcurrentTasks = 2,
  onInsightGenerated = null,
} = {}) {
  ensureStorage()

  setInterval(async () => {
    try {
      await runThinkingCycle({ maxConcurrentTasks, onInsightGenerated })
    } catch (e) {
      console.error('[主动思考] 循环错误:', e?.message)
    }
  }, intervalMs)

  console.log(`[主动思考] 思考循环已启动，每${intervalMs / 60000}分钟执行一次`)
}

/**
 * 执行一次思考循环
 */
export async function runThinkingCycle({
  maxConcurrentTasks = 2,
  onInsightGenerated = null,
} = {}) {
  ensureStorage()

  updateState({ mode: 'thinking', lastThinkingAt: Date.now() })

  // 1. 生成新的思考任务
  const newTasks = generateThinkingTasks(maxConcurrentTasks)

  // 2. 执行待处理的任务
  const pendingTasks = loadPendingTasks().slice(0, maxConcurrentTasks - newTasks.length)
  const tasksToExecute = [...newTasks, ...pendingTasks].slice(0, maxConcurrentTasks)

  const results = []
  for (const task of tasksToExecute) {
    try {
      const result = await executeThinkingTask(task)
      results.push(result)

      if (result.insights && result.insights.length > 0 && onInsightGenerated) {
        onInsightGenerated(result.insights, task)
      }
    } catch (e) {
      console.error(`[主动思考] 任务执行失败 (${task.id}):`, e?.message)
      markTaskAs(task.id, TASK_STATUS.FAILED)
    }
  }

  // 3. 更新状态
  updateState({
    mode: 'idle',
    completedTasks: (getThinkingState().completedTasks || 0) + results.filter(r => r.success).length,
    failedTasks: (getThinkingState().failedTasks || 0) + results.filter(r => !r.success).length,
  })

  return {
    success: true,
    tasksExecuted: tasksToExecute.length,
    insightsGenerated: results.reduce((sum, r) => sum + (r.insights?.length || 0), 0),
    results,
  }
}

/**
 * 生成思考任务
 */
function generateThinkingTasks(maxCount) {
  const tasks = []

  // 1. 好奇心驱动：从经验中发现新事物
  const curiosityTasks = generateCuriosityTasks(maxCount)
  tasks.push(...curiosityTasks)

  // 2. 问题驱动：解决现有知识中的矛盾
  const problemTasks = generateProblemSolvingTasks(maxCount)
  tasks.push(...problemTasks)

  // 3. 优化驱动：改进现有策略
  const optimizationTasks = generateOptimizationTasks(maxCount)
  tasks.push(...optimizationTasks)

  // 4. 整合驱动：整理碎片化知识
  const consolidationTasks = generateConsolidationTasks(maxCount)
  tasks.push(...consolidationTasks)

  // 按优先级排序并限制数量
  tasks.sort((a, b) => b.priority - a.priority)
  return tasks.slice(0, maxCount)
}

/**
 * 好奇心驱动任务
 */
function generateCuriosityTasks(maxCount) {
  const tasks = []

  // 从经验中找出"有趣但未完全理解"的模式
  const learningPoints = extractLearningPoints({ limit: 30 })

  if (learningPoints.length >= 5) {
    const interestingPoints = learningPoints
      .filter(p => p.importance > 0.6)
      .slice(0, 3)

    for (const point of interestingPoints) {
      tasks.push({
        id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: THINKING_TYPES.CURIOSITY,
        title: `探索: ${point.insight.slice(0, 50)}`,
        description: `基于观察的"${point.insight}"，深入研究相关领域`,
        priority: point.importance,
        status: TASK_STATUS.PENDING,
        createdAt: Date.now(),
        context: {
          sourcePoint: point,
          domain: point.context,
        },
        steps: [
          '收集相关信息',
          '分析现有知识',
          '形成假设',
          '验证假设',
          '记录结论',
        ],
      })
    }
  }

  // 探索知识空白区
  const knowledgeStats = getKnowledgeStats()
  if (knowledgeStats.total < 10) {
    tasks.push({
      id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: THINKING_TYPES.CURIOSITY,
      title: '探索知识空白',
      description: '当前知识库较小，主动学习基础概念',
      priority: 0.7,
      status: TASK_STATUS.PENDING,
      createdAt: Date.now(),
      context: {
        reason: 'knowledge_base_small',
      },
      steps: [
        '识别知识空白领域',
        '学习基础概念',
        '建立知识框架',
      ],
    })
  }

  return tasks.slice(0, maxCount)
}

/**
 * 问题驱动任务
 */
function generateProblemSolvingTasks(maxCount) {
  const tasks = []

  // 查找知识中的矛盾
  const allKnowledge = queryKnowledge({ minConfidence: 0.5, limit: 30 })

  // 简单检查：同一类型下是否有冲突的知识
  const knowledgeByType = {}
  for (const k of allKnowledge) {
    if (!knowledgeByType[k.type]) knowledgeByType[k.type] = []
    knowledgeByType[k.type].push(k)
  }

  for (const [type, knowledgeList] of Object.entries(knowledgeByType)) {
    if (knowledgeList.length >= 3) {
      // 检查是否有低置信度的知识（可能存在矛盾）
      const lowConfidence = knowledgeList.filter(k => k.confidence < 0.5)
      if (lowConfidence.length > 0 && lowConfidence.length < knowledgeList.length) {
        tasks.push({
          id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: THINKING_TYPES.PROBLEM_SOLVING,
          title: `解决${type}类知识的矛盾`,
          description: `检测到${lowConfidence.length}条低置信度知识，可能存在矛盾`,
          priority: 0.8,
          status: TASK_STATUS.PENDING,
          createdAt: Date.now(),
          context: {
            knowledgeType: type,
            lowConfidenceIds: lowConfidence.map(k => k.id),
            totalKnowledge: knowledgeList.length,
          },
          steps: [
            '对比低置信度知识与高置信度知识',
            '识别矛盾点',
            '确定更可信的版本',
            '更新或淘汰错误知识',
          ],
        })
      }
    }
  }

  // 从失败经验中发现问题
  const failures = queryExperiences({ type: 'failure', limit: 10 })
  if (failures.length >= 2) {
    const uniqueErrors = new Set(failures.map(f => f.error?.category).filter(Boolean))
    if (uniqueErrors.size >= 2) {
      tasks.push({
        id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: THINKING_TYPES.PROBLEM_SOLVING,
        title: '分析多种失败原因',
        description: `最近遇到${failures.length}次失败，涉及${uniqueErrors.size}种错误类型`,
        priority: 0.75,
        status: TASK_STATUS.PENDING,
        createdAt: Date.now(),
        context: {
          errorTypes: Array.from(uniqueErrors),
          failureCount: failures.length,
        },
        steps: [
          '分类整理失败案例',
          '分析根本原因',
          '寻找共性规律',
          '制定预防策略',
        ],
      })
    }
  }

  return tasks.slice(0, maxCount)
}

/**
 * 优化驱动任务
 */
function generateOptimizationTasks(maxCount) {
  const tasks = []

  // 从策略系统中发现可优化点
  const strategies = getCurrentStrategies()
  const lowPriorityStrategies = strategies.strategies?.filter(s => s.priority < 0.5) || []

  if (lowPriorityStrategies.length > 0) {
    tasks.push({
      id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: THINKING_TYPES.OPTIMIZATION,
      title: `优化${lowPriorityStrategies.length}个低效策略`,
      description: `发现${lowPriorityStrategies.length}个低优先级策略，评估是否需要改进或淘汰`,
      priority: 0.6,
      status: TASK_STATUS.PENDING,
      createdAt: Date.now(),
      context: {
        strategyIds: lowPriorityStrategies.map(s => s.id),
        averagePriority: lowPriorityStrategies.reduce((s, x) => s + x.priority, 0) / lowPriorityStrategies.length,
      },
      steps: [
        '评估策略效果',
        '分析低效原因',
        '尝试改进',
        '验证改进效果',
      ],
    })
  }

  // 检查知识使用率
  const allKnowledge = queryKnowledge({ limit: 50 })
  const rarelyUsed = allKnowledge.filter(k => (k.usageCount || 0) < 3)
  if (rarelyUsed.length > 10) {
    tasks.push({
      id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: THINKING_TYPES.OPTIMIZATION,
      title: `提升${rarelyUsed.length}条知识的使用率`,
      description: `有${rarelyUsed.length}条知识很少被使用，评估其价值`,
      priority: 0.5,
      status: TASK_STATUS.PENDING,
      createdAt: Date.now(),
      context: {
        knowledgeIds: rarelyUsed.map(k => k.id),
        avgUsageCount: rarelyUsed.reduce((s, k) => s + (k.usageCount || 0), 0) / rarelyUsed.length,
      },
      steps: [
        '分析低使用知识的相关性',
        '检查检索算法',
        '优化知识标签和分类',
        '增加相关知识的曝光',
      ],
    })
  }

  return tasks.slice(0, maxCount)
}

/**
 * 整合驱动任务
 */
function generateConsolidationTasks(maxCount) {
  const tasks = []

  // 从碎片经验中提取新的知识连接
  const recentExperiences = queryExperiences({ limit: 50 })

  // 检查是否有可关联的经验
  const toolGroups = {}
  for (const exp of recentExperiences) {
    const tool = exp.toolName || exp.context?.toolName || 'general'
    if (!toolGroups[tool]) toolGroups[tool] = []
    toolGroups[tool].push(exp)
  }

  for (const [tool, experiences] of Object.entries(toolGroups)) {
    if (experiences.length >= 5) {
      const successes = experiences.filter(e => e.type === 'success').length
      const failures = experiences.filter(e => e.type === 'failure').length

      tasks.push({
        id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: THINKING_TYPES.CONSOLIDATION,
        title: `整合"${tool}"相关的${experiences.length}条经验`,
        description: `工具"${tool}"累计${experiences.length}次调用，成功${successes}次，失败${failures}次`,
        priority: 0.65,
        status: TASK_STATUS.PENDING,
        createdAt: Date.now(),
        context: {
          tool,
          totalCount: experiences.length,
          successRate: successes / experiences.length,
        },
        steps: [
          '汇总工具使用经验',
          '提炼最佳实践',
          '生成操作规范',
          '更新相关知识',
        ],
      })
      break // 只选一个进行深度整合
    }
  }

  // 知识图谱整合
  const knowledgeStats = getKnowledgeStats()
  if (knowledgeStats.total > 50 && knowledgeStats.graphNodeCount < knowledgeStats.total * 0.5) {
    tasks.push({
      id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: THINKING_TYPES.CONSOLIDATION,
      title: '整合知识图谱连接',
      description: `知识节点${knowledgeStats.graphNodeCount}个，少于总知识量的50%，需要建立更多连接`,
      priority: 0.55,
      status: TASK_STATUS.PENDING,
      createdAt: Date.now(),
      context: {
        nodeCount: knowledgeStats.graphNodeCount,
        totalKnowledge: knowledgeStats.total,
      },
      steps: [
        '分析现有知识的语义关系',
        '建立新的知识连接',
        '优化知识图谱结构',
      ],
    })
  }

  return tasks.slice(0, maxCount)
}

/**
 * 执行思考任务
 */
async function executeThinkingTask(task) {
  markTaskAs(task.id, TASK_STATUS.IN_PROGRESS)

  const startTime = Date.now()
  const insights = []

  try {
    // 根据任务类型执行不同的思考逻辑
    const executionHandler = getHandlerForTask(task)
    const result = await executionHandler(task)

    // 生成洞察
    if (result.insights) {
      insights.push(...result.insights)
      for (const insight of result.insights) {
        saveInsight({
          taskId: task.id,
          taskType: task.type,
          insight,
          timestamp: Date.now(),
        })
      }
    }

    // 记录洞察
    if (insights.length > 0) {
      task.insightsCount = insights.length
    }

    markTaskAs(task.id, TASK_STATUS.COMPLETED)
    return {
      success: true,
      taskId: task.id,
      insights,
      duration_ms: Date.now() - startTime,
    }
  } catch (e) {
    markTaskAs(task.id, TASK_STATUS.FAILED, e?.message)
    return {
      success: false,
      taskId: task.id,
      error: e?.message,
      duration_ms: Date.now() - startTime,
    }
  }
}

function getHandlerForTask(task) {
  const handlers = {
    [THINKING_TYPES.CURIOSITY]: handleCuriosityTask,
    [THINKING_TYPES.PROBLEM_SOLVING]: handleProblemSolvingTask,
    [THINKING_TYPES.OPTIMIZATION]: handleOptimizationTask,
    [THINKING_TYPES.CONSOLIDATION]: handleConsolidationTask,
    [THINKING_TYPES.CREATIVITY]: handleCreativityTask,
  }
  return handlers[task.type] || handleDefaultTask
}

async function handleCuriosityTask(task) {
  const insights = []
  const context = task.context || {}

  // 基于学习点生成新的假设
  if (context.sourcePoint) {
    const point = context.sourcePoint
    insights.push({
      type: 'hypothesis',
      title: `基于"${point.insight.slice(0, 50)}"的假设`,
      description: `观察到的模式可能表明：${point.insight}。需要进一步验证这是否在其他情境下也成立。`,
      confidence: point.importance,
      action: 'collect_more_evidence',
    })

    // 生成相关的学习建议
    insights.push({
      type: 'learning_suggestion',
      title: `深入学习: ${point.context || '相关领域'}`,
      description: `建议收集更多关于"${point.context}"的案例，以验证当前观察的普遍性。`,
      confidence: 0.7,
      action: 'expand_knowledge',
    })
  }

  // 如果是探索空白领域
  if (context.reason === 'knowledge_base_small') {
    const topics = [
      'Agent记忆机制',
      '工具使用模式',
      '用户偏好学习',
      '错误恢复策略',
      '知识图谱构建',
    ]
    const topic = topics[Math.floor(Math.random() * topics.length)]

    insights.push({
      type: 'learning_plan',
      title: `启动学习: ${topic}`,
      description: `当前知识库较小，建议优先学习"${topic}"相关知识，以建立更扎实的基础。`,
      confidence: 0.8,
      action: 'start_learning',
      topic,
    })
  }

  return { insights }
}

async function handleProblemSolvingTask(task) {
  const insights = []
  const context = task.context || {}

  // 分析知识矛盾
  if (context.knowledgeType && context.lowConfidenceIds) {
    insights.push({
      type: 'conflict_resolution',
      title: `解决${context.knowledgeType}类知识的不确定性`,
      description: `检测到${context.lowConfidenceIds.length}条低置信度知识。建议：1) 对比高置信度知识；2) 基于最近经验验证；3) 必要时淘汰。`,
      confidence: 0.75,
      action: 'resolve_conflicts',
      affectedIds: context.lowConfidenceIds,
    })
  }

  // 分析失败模式
  if (context.errorTypes && context.failureCount) {
    insights.push({
      type: 'root_cause_analysis',
      title: `分析${context.failureCount}次失败的根本原因`,
      description: `涉及${context.errorTypes.length}种错误类型：${context.errorTypes.join(', ')}。建议建立错误分类系统，针对高频错误建立预防机制。`,
      confidence: 0.8,
      action: 'create_error_prevention_system',
    })
  }

  return { insights }
}

async function handleOptimizationTask(task) {
  const insights = []
  const context = task.context || {}

  // 策略优化建议
  if (context.strategyIds) {
    insights.push({
      type: 'strategy_review',
      title: `审查${context.strategyIds.length}个低效策略`,
      description: `这些策略的平均优先级为${(context.averagePriority || 0).toFixed(2)}。建议逐一审查：保留有效策略、改进低效策略、淘汰无效策略。`,
      confidence: 0.65,
      action: 'review_strategies',
      strategyIds: context.strategyIds,
    })
  }

  // 知识使用率优化
  if (context.knowledgeIds) {
    insights.push({
      type: 'knowledge_optimization',
      title: `优化${context.knowledgeIds.length}条知识的可发现性`,
      description: `这些知识平均使用次数仅${Math.round(context.avgUsageCount || 0)}次。建议：1) 增加相关标签；2) 改进检索算法；3) 在适当场景主动推荐。`,
      confidence: 0.6,
      action: 'improve_knowledge_discovery',
      knowledgeIds: context.knowledgeIds,
    })
  }

  return { insights }
}

async function handleConsolidationTask(task) {
  const insights = []
  const context = task.context || {}

  // 经验整合
  if (context.tool && context.totalCount) {
    insights.push({
      type: 'experience_consolidation',
      title: `整合"${context.tool}"的${context.totalCount}次使用经验`,
      description: `成功率为${Math.round((context.successRate || 0) * 100)}%。建议：1) 提炼成功模式为最佳实践；2) 总结失败经验为避坑指南；3) 生成工具使用规范。`,
      confidence: 0.7,
      action: 'consolidate_tool_experience',
      tool: context.tool,
    })
  }

  // 图谱连接优化
  if (context.nodeCount !== undefined) {
    insights.push({
      type: 'graph_optimization',
      title: `优化知识图谱连接 (${context.nodeCount}/${context.totalKnowledge}节点)`,
      description: `知识图谱连接率较低。建议分析知识间的语义关系，建立更多跨领域连接，提升知识检索的关联性。`,
      confidence: 0.6,
      action: 'improve_knowledge_graph',
    })
  }

  return { insights }
}

async function handleCreativityTask(task) {
  return { insights: [] }
}

async function handleDefaultTask(task) {
  return { insights: [] }
}

// ========== 任务管理 ==========

function generateThinkingTasksForAPI({ type = null, count = 1 } = {}) {
  const tasks = []

  for (let i = 0; i < count; i++) {
    const task = {
      id: `think_api_${Date.now()}_${i}`,
      type: type || THINKING_TYPES.CURIOSITY,
      title: `主动思考任务 #${Date.now()}`,
      description: 'API触发的主动思考任务',
      priority: 0.7,
      status: TASK_STATUS.PENDING,
      createdAt: Date.now(),
      context: { trigger: 'api' },
      steps: ['执行思考', '生成洞察'],
    }
    tasks.push(task)
    saveTask(task)
  }

  return tasks
}

function saveTask(task) {
  ensureStorage()
  try {
    fs.appendFileSync(TASKS_FILE, JSON.stringify(task) + '\n', 'utf8')
  } catch (e) {
    console.error('[主动思考] 任务保存失败:', e?.message)
  }
}

function loadPendingTasks() {
  ensureStorage()
  const tasks = []
  try {
    const content = fs.readFileSync(TASKS_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const task = JSON.parse(line)
        if (task.status === TASK_STATUS.PENDING) {
          tasks.push(task)
        }
      } catch {}
    }
  } catch {}
  return tasks.sort((a, b) => b.priority - a.priority)
}

function markTaskAs(taskId, status, errorMessage = null) {
  ensureStorage()
  const tasks = []
  try {
    const content = fs.readFileSync(TASKS_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const task = JSON.parse(line)
        if (task.id === taskId) {
          task.status = status
          task.updatedAt = Date.now()
          if (errorMessage) task.error = errorMessage
        }
        tasks.push(task)
      } catch {}
    }
    fs.writeFileSync(TASKS_FILE, tasks.map(t => JSON.stringify(t)).join('\n'), 'utf8')
  } catch (e) {
    console.error('[主动思考] 任务状态更新失败:', e?.message)
  }
}

function saveInsight(insightData) {
  ensureStorage()
  try {
    fs.appendFileSync(INSIGHTS_FILE, JSON.stringify(insightData) + '\n', 'utf8')
  } catch (e) {
    console.error('[主动思考] 洞察保存失败:', e?.message)
  }
}

// ========== API ==========

/**
 * 获取思考状态
 */
export function getThinkingState() {
  ensureStorage()
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { mode: 'idle', totalTasks: 0 }
  }
}

/**
 * 获取最近的洞察
 */
export function getRecentInsights({ limit = 20, type = null } = {}) {
  ensureStorage()
  const insights = []
  try {
    const content = fs.readFileSync(INSIGHTS_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const insight = JSON.parse(line)
        if (type && insight.insight?.type !== type) continue
        insights.push(insight)
      } catch {}
    }
  } catch {}
  return insights.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)
}

/**
 * 获取思考统计
 */
export function getThinkingStats() {
  const state = getThinkingState()
  const tasks = loadAllTasks()
  const insights = loadAllInsights()

  return {
    state,
    totalTasks: tasks.length,
    pendingTasks: tasks.filter(t => t.status === TASK_STATUS.PENDING).length,
    completedTasks: tasks.filter(t => t.status === TASK_STATUS.COMPLETED).length,
    failedTasks: tasks.filter(t => t.status === TASK_STATUS.FAILED).length,
    totalInsights: insights.length,
    insightsByType: countInsightsByType(insights),
    storagePath: THINKING_DIR,
  }
}

function loadAllTasks() {
  ensureStorage()
  const tasks = []
  try {
    const content = fs.readFileSync(TASKS_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try { tasks.push(JSON.parse(line)) } catch {}
    }
  } catch {}
  return tasks
}

function loadAllInsights() {
  ensureStorage()
  const insights = []
  try {
    const content = fs.readFileSync(INSIGHTS_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try { insights.push(JSON.parse(line)) } catch {}
    }
  } catch {}
  return insights
}

function countInsightsByType(insights) {
  const counts = {}
  for (const i of insights) {
    const type = i.insight?.type || 'unknown'
    counts[type] = (counts[type] || 0) + 1
  }
  return counts
}

function getKnowledgeStats() {
  try {
    // 避免循环依赖，直接读取
    const knowledgeFile = path.join(process.env.HOME || '.', '.gina', 'knowledge', 'knowledge-base.jsonl')
    if (fs.existsSync(knowledgeFile)) {
      const content = fs.readFileSync(knowledgeFile, 'utf8')
      const lines = content.trim().split('\n').filter(Boolean)
      return {
        total: lines.length,
        graphNodeCount: 0,
      }
    }
  } catch {}
  return { total: 0, graphNodeCount: 0 }
}

function updateState(updates) {
  ensureStorage()
  const current = getThinkingState()
  const newState = {
    ...current,
    ...updates,
  }
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), 'utf8')
  } catch (e) {
    console.error('[主动思考] 状态更新失败:', e?.message)
  }
}

export {
  THINKING_TYPES,
  TASK_STATUS,
  THINKING_DIR,
  TASKS_FILE,
  STATE_FILE,
  INSIGHTS_FILE,
  generateThinkingTasksForAPI,
}
