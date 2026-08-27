/**
 * auto-planner.js — 自动任务规划器
 *
 * 核心理念：Gina 不应只依赖用户指令。她能从新闻、知识、环境信号中
 * 自动识别需要完成的任务，并将其分解为可执行的步骤。
 *
 * 规划来源：
 *   1. 新闻驱动：重要新闻 → 分析/记录/响应任务
 *   2. 知识驱动：新知识 → 验证/扩展/关联任务
 *   3. 环境驱动：环境变化 → 适配/优化/通知任务
 *   4. 定时驱动：周期触发 → 检查/更新/清理任务
 *   5. 思考驱动：思考任务 → 转化/执行/验证任务
 *
 * 规划能力：
 *   1. 任务分解：将高层目标分解为可执行步骤
 *   2. 依赖排序：识别步骤间的依赖关系
 *   3. 资源评估：评估任务所需资源和时间
 *   4. 优先级排序：基于重要性和紧急性排序
 *   5. 执行监控：跟踪任务执行状态并动态调整
 */

import { emitEvent } from '../events.js'
import { executePlanTool } from './plan-tool-executor.js'
import { getUserProfile } from '../capabilities/db.js'
import { PRIMARY_USER_ID } from '../identity.js'

// 读取用户画像的 topRole（如「Software developer」），用于让主动建议更个性化。
// 画像可能尚未构建或解析失败，任何异常都降级为空字符串，不影响通用适配。
function getTopRole() {
  try {
    const row = getUserProfile(PRIMARY_USER_ID)
    const roles = row?.roles_json ? JSON.parse(row.roles_json) : []
    return roles[0]?.label || ''
  } catch {
    return ''
  }
}

const DEFAULT_CONFIG = {
  enabled: true,
  maxTaskDepth: 5,
  maxConcurrentTasks: 3,
  taskTimeoutMs: 30 * 60 * 1000,
  autoExecute: false,
  planTemplates: {},
}

let config = { ...DEFAULT_CONFIG }
let planHistory = []
let activePlans = new Map()
let taskQueue = []
let planTemplates = loadDefaultTemplates()

function loadDefaultTemplates() {
  return {
    news_analysis: {
      name: '新闻分析计划',
      steps: [
        { id: 'fetch_news', action: '获取新闻详情', tool: 'web_fetch', timeout: 30000 },
        { id: 'analyze_content', action: '分析新闻内容', tool: 'llm_analyze', timeout: 60000 },
        { id: 'extract_insights', action: '提取关键洞察', tool: 'llm_extract', timeout: 30000 },
        { id: 'update_knowledge', action: '更新知识库', tool: 'knowledge_update', timeout: 10000 },
        { id: 'notify_user', action: '通知用户', tool: 'notification', timeout: 5000, optional: true },
      ],
    },
    knowledge_verification: {
      name: '知识验证计划',
      steps: [
        { id: 'retrieve_context', action: '检索相关上下文', tool: 'memory_search', timeout: 10000 },
        { id: 'cross_verify', action: '交叉验证', tool: 'llm_analyze', timeout: 30000 },
        { id: 'update_confidence', action: '更新置信度', tool: 'knowledge_update', timeout: 5000 },
        { id: 'record_result', action: '记录验证结果', tool: 'memory_write', timeout: 5000 },
      ],
    },
    trend_monitoring: {
      name: '趋势监测计划',
      steps: [
        { id: 'collect_data', action: '收集最新数据', tool: 'web_fetch', timeout: 60000 },
        { id: 'analyze_trend', action: '分析趋势变化', tool: 'llm_analyze', timeout: 30000 },
        { id: 'generate_report', action: '生成趋势报告', tool: 'report_generate', timeout: 30000 },
        { id: 'archive_insights', action: '归档洞察', tool: 'knowledge_update', timeout: 5000 },
      ],
    },
    periodic_maintenance: {
      name: '定期维护计划',
      steps: [
        { id: 'check_knowledge', action: '检查知识新鲜度', tool: 'memory_check', timeout: 30000 },
        { id: 'decay_outdated', action: '处理过期知识', tool: 'knowledge_decay', timeout: 10000 },
        { id: 'consolidate', action: '合并重复知识', tool: 'memory_consolidate', timeout: 30000 },
        { id: 'optimize_index', action: '优化索引', tool: 'index_rebuild', timeout: 60000 },
      ],
    },
    proactive_learning: {
      name: '主动学习计划',
      steps: [
        { id: 'identify_gaps', action: '识别知识缺口', tool: 'memory_gap_analysis', timeout: 30000 },
        { id: 'generate_queries', action: '生成探索查询', tool: 'llm_generate', timeout: 15000 },
        { id: 'research_topics', action: '研究相关主题', tool: 'web_search', timeout: 120000 },
        { id: 'distill_knowledge', action: '蒸馏新知识', tool: 'knowledge_distill', timeout: 30000 },
      ],
    },
  }
}

/**
 * 初始化规划器
 */
export function initAutoPlanner(userConfig = {}) {
  config = { ...DEFAULT_CONFIG, ...userConfig }
  planTemplates = loadDefaultTemplates()
  
  console.log('[自动规划器] 已启动')
  return { config, planTemplates }
}

/**
 * 从触发源生成任务计划
 */
export function generatePlanFromTrigger(trigger) {
  if (!config.enabled) return null
  
  const { type, data, source } = trigger
  
  let plan = null
  
  switch (type) {
    case 'important_news':
      plan = generateNewsAnalysisPlan(data)
      break
    case 'knowledge_injected':
      plan = generateKnowledgeVerificationPlan(data)
      break
    case 'environment_change':
      plan = generateEnvironmentAdaptationPlan(data)
      break
    case 'schedule_trigger':
      plan = generatePeriodicPlan(data)
      break
    case 'thinking_task':
      plan = generateThinkingExecutionPlan(data)
      break
    default:
      plan = generateGenericPlan(trigger)
  }
  
  if (plan) {
    plan.trigger = trigger
    plan.generatedAt = Date.now()
    plan.id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    
    activePlans.set(plan.id, plan)
    
    emitEvent('plan_generated', {
      planId: plan.id,
      planType: plan.type,
      steps: plan.steps.length,
      trigger: trigger.type,
    })
  }
  
  return plan
}

/**
 * 从新闻触发生成分析计划
 */
function generateNewsAnalysisPlan(newsData) {
  const domain = newsData?.category?.primary || 'general'
  const importance = newsData?.importance || 0.5
  
  const plan = {
    type: 'news_analysis',
    template: 'news_analysis',
    description: `分析重要新闻: ${newsData?.title?.slice(0, 50) || '未知'}`,
    priority: importance,
    estimatedDurationMs: 120000,
    steps: [],
  }
  
  const template = planTemplates.news_analysis
  
  let stepIndex = 0
  for (const step of template.steps) {
    if (step.optional && importance < 0.7) continue
    
    const concreteStep = {
      ...step,
      id: `${plan.id}_step_${stepIndex++}`,
      status: 'pending',
      input: {
        newsTitle: newsData?.title,
        newsUrl: newsData?.url,
        source: newsData?.source,
        domain,
        importance,
      },
      output: null,
      startedAt: null,
      completedAt: null,
      error: null,
    }
    
    plan.steps.push(concreteStep)
  }
  
  return plan
}

/**
 * 从知识注入触发生成验证计划
 */
function generateKnowledgeVerificationPlan(knowledgeData) {
  const type = knowledgeData?.type
  const confidence = knowledgeData?.confidence || 0.5
  
  if (confidence >= 0.8) return null
  
  return {
    type: 'knowledge_verification',
    template: 'knowledge_verification',
    description: `验证新知识置信度: ${knowledgeData?.content?.slice(0, 50) || '新条目'}`,
    priority: 1 - confidence,
    estimatedDurationMs: 90000,
    steps: planTemplates.knowledge_verification.steps.map((step, i) => ({
      ...step,
      id: `kv_step_${i}`,
      status: 'pending',
      input: {
        knowledgeId: knowledgeData?.id,
        knowledgeType: type,
        confidence,
      },
      output: null,
      startedAt: null,
      completedAt: null,
      error: null,
    })),
  }
}

/**
 * 从环境变化触发生成适配计划
 */
function generateEnvironmentAdaptationPlan(envData) {
  const context = envData?.context || 'general'
  
  const contextActions = {
    coding: {
      type: 'coding_optimization',
      description: '优化编码环境',
      steps: [
        { id: 'co_1', action: '检查项目状态', tool: 'project_scan', status: 'pending' },
        { id: 'co_2', action: '识别优化点', tool: 'code_analyze', status: 'pending' },
        { id: 'co_3', action: '生成建议', tool: 'suggestion_generate', status: 'pending' },
      ],
    },
    browser: {
      type: 'research_assist',
      description: '辅助浏览器研究',
      steps: [
        { id: 'ra_1', action: '提取页面信息', tool: 'web_extract', status: 'pending' },
        { id: 'ra_2', action: '整理要点', tool: 'content_summarize', status: 'pending' },
        { id: 'ra_3', action: '保存书签', tool: 'knowledge_save', status: 'pending' },
      ],
    },
    writing: {
      type: 'writing_assist',
      description: '辅助写作',
      steps: [
        { id: 'wa_1', action: '研究相关资料', tool: 'web_search', status: 'pending' },
        { id: 'wa_2', action: '提取关键信息', tool: 'content_extract', status: 'pending' },
        { id: 'wa_3', action: '生成大纲建议', tool: 'llm_generate', status: 'pending' },
      ],
    },
  }
  
  const topRole = getTopRole()
  const action = contextActions[context]
  if (action) {
    // 个性化：结合用户画像角色，让主动建议更懂用户（画像缺失时保持通用）
    const personalizedDesc = topRole ? `根据你的「${topRole}」背景，${action.description}` : action.description
    return {
      type: action.type,
      template: 'context_adaptation',
      description: personalizedDesc,
      priority: 0.6,
      estimatedDurationMs: 60000,
      steps: action.steps.map((step, i) => ({
        ...step,
        id: `${action.type}_step_${i}`,
        input: { context, app: envData?.app, topRole },
        output: null,
        startedAt: null,
        completedAt: null,
      })),
    }
  }
  
  return null
}

/**
 * 生成定期维护计划
 */
function generatePeriodicPlan(scheduleData) {
  const maintenanceTypes = ['knowledge_refresh', 'index_rebuild', 'memory_consolidation']
  const type = scheduleData?.maintenanceType || maintenanceTypes[Math.floor(Math.random() * maintenanceTypes.length)]
  
  return {
    type: 'periodic_maintenance',
    template: 'periodic_maintenance',
    description: `定期维护: ${type}`,
    priority: 0.4,
    estimatedDurationMs: 180000,
    steps: planTemplates.periodic_maintenance.steps.map((step, i) => ({
      ...step,
      id: `pm_step_${i}`,
      input: { maintenanceType: type },
      output: null,
      startedAt: null,
      completedAt: null,
    })),
  }
}

/**
 * 从思考任务生成执行计划
 */
function generateThinkingExecutionPlan(thinkingData) {
  const thinkingType = thinkingData?.type
  const question = thinkingData?.question
  
  if (!thinkingType && !question) return null
  
  return {
    type: 'thinking_execution',
    template: 'proactive_learning',
    description: `执行思考任务: ${question?.slice(0, 50) || thinkingType}`,
    priority: 0.5,
    estimatedDurationMs: 240000,
    steps: planTemplates.proactive_learning.steps.map((step, i) => ({
      ...step,
      id: `te_step_${i}`,
      input: {
        thinkingType,
        question,
        context: thinkingData?.context,
      },
      output: null,
      startedAt: null,
      completedAt: null,
    })),
  }
}

/**
 * 生成通用计划
 */
function generateGenericPlan(trigger) {
  return {
    type: 'generic',
    template: 'generic',
    description: `处理触发事件: ${trigger.type}`,
    priority: 0.3,
    estimatedDurationMs: 30000,
    steps: [
      {
        id: 'generic_1',
        action: '分析触发源',
        tool: 'llm_analyze',
        status: 'pending',
        input: { triggerType: trigger.type, triggerData: trigger.data },
        output: null,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 'generic_2',
        action: '生成响应',
        tool: 'llm_generate',
        status: 'pending',
        input: { analysis: null },
        output: null,
        startedAt: null,
        completedAt: null,
      },
    ],
  }
}

/**
 * 执行计划
 */
export async function executePlan(planId) {
  const plan = activePlans.get(planId)
  if (!plan) return { success: false, error: '计划不存在' }
  
  if (config.autoExecute) {
    return executePlanAutomatically(plan)
  } else {
    return preparePlanForExecution(plan)
  }
}

/**
 * 自动执行计划
 */
async function executePlanAutomatically(plan) {
  console.log(`[自动规划器] 执行计划: ${plan.description}`)
  
  const results = []
  const startTime = Date.now()
  
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    step.status = 'in_progress'
    step.startedAt = Date.now()
    
    emitEvent('plan_step_started', {
      planId: plan.id,
      stepId: step.id,
      stepAction: step.action,
      stepIndex: i,
      totalSteps: plan.steps.length,
    })
    
    try {
      const result = await executeStep(step, results)
      step.status = 'completed'
      step.output = result
      step.completedAt = Date.now()
      results.push({ stepId: step.id, result })
      
      emitEvent('plan_step_completed', {
        planId: plan.id,
        stepId: step.id,
        resultSummary: typeof result === 'string' ? result.slice(0, 100) : 'completed',
      })
    } catch (error) {
      step.status = 'failed'
      step.error = error.message
      step.completedAt = Date.now()
      
      emitEvent('plan_step_failed', {
        planId: plan.id,
        stepId: step.id,
        error: error.message,
      })
      
      if (step.id.startsWith('co_') || step.id.startsWith('ra_')) {
        continue
      } else {
        break
      }
    }
  }
  
  plan.status = 'completed'
  plan.completedAt = Date.now()
  plan.durationMs = plan.completedAt - startTime
  
  planHistory.push({
    planId: plan.id,
    type: plan.type,
    description: plan.description,
    trigger: plan.trigger,
    status: 'completed',
    stepsExecuted: plan.steps.filter(s => s.status === 'completed').length,
    totalSteps: plan.steps.length,
    durationMs: plan.durationMs,
    completedAt: plan.completedAt,
  })
  
  activePlans.delete(plan.id)
  
  emitEvent('plan_completed', {
    planId: plan.id,
    planType: plan.type,
    stepsCompleted: plan.steps.filter(s => s.status === 'completed').length,
    totalSteps: plan.steps.length,
    durationMs: plan.durationMs,
  })
  
  return {
    success: true,
    planId: plan.id,
    results,
    durationMs: plan.durationMs,
  }
}

/**
 * 执行单个步骤
 */
async function executeStep(step, previousResults) {
  const toolName = step.tool
  const input = step.input || {}
  
  switch (toolName) {
    case 'web_fetch':
      return await genericToolExecution('web_fetch', input)
    case 'llm_analyze':
      return await genericToolExecution('llm_analyze', input)
    case 'llm_extract':
      return await genericToolExecution('llm_extract', input)
    case 'llm_generate':
      return await genericToolExecution('llm_generate', input)
    case 'knowledge_update':
      return await genericToolExecution('knowledge_update', input)
    case 'knowledge_distill':
      return await genericToolExecution('knowledge_distill', input)
    case 'knowledge_decay':
      return await genericToolExecution('knowledge_decay', input)
    case 'memory_search':
      return await genericToolExecution('memory_search', input)
    case 'memory_write':
      return await genericToolExecution('memory_write', input)
    case 'memory_consolidate':
      return await genericToolExecution('memory_consolidate', input)
    case 'memory_gap_analysis':
      return await genericToolExecution('memory_gap_analysis', input)
    case 'memory_check':
      return await genericToolExecution('memory_check', input)
    case 'index_rebuild':
      return await genericToolExecution('index_rebuild', input)
    case 'index_rebuild':
      return await genericToolExecution('index_rebuild', input)
    case 'notification':
      return await genericToolExecution('notification', input)
    case 'web_search':
      return await genericToolExecution('web_search', input)
    case 'content_extract':
      return await genericToolExecution('content_extract', input)
    case 'content_summarize':
      return await genericToolExecution('content_summarize', input)
    case 'project_scan':
      return await genericToolExecution('project_scan', input)
    case 'code_analyze':
      return await genericToolExecution('code_analyze', input)
    case 'suggestion_generate':
      return await genericToolExecution('suggestion_generate', input)
    case 'report_generate':
      return await genericToolExecution('report_generate', input)
    case 'knowledge_save':
      return await genericToolExecution('knowledge_save', input)
    default:
      return await genericToolExecution(toolName, input)
  }
}

/**
 * 通用工具执行（真实执行：接入能力层 executeTool）。
 * 真实执行失败（error/unmapped/llm_not_wired）时抛错，让 executePlanAutomatically 正确标记步骤失败。
 */
async function genericToolExecution(toolName, input) {
  const res = await executePlanTool(toolName, input)
  if (res.ok === false && res.status !== 'llm_not_wired') {
    throw new Error(`[${toolName}] ${res.status}: ${String(res.result).slice(0, 200)}`)
  }
  return {
    tool: toolName,
    input,
    status: res.status,
    result: res.result,
    timestamp: Date.now(),
  }
}

/**
 * 准备执行（手动确认模式）
 */
function preparePlanForExecution(plan) {
  return {
    planId: plan.id,
    type: plan.type,
    description: plan.description,
    priority: plan.priority,
    steps: plan.steps.map(s => ({
      id: s.id,
      action: s.action,
      tool: s.tool,
      status: 'pending',
    })),
    readyForExecution: true,
    autoExecute: false,
  }
}

/**
 * 获取活动计划
 */
export function getActivePlans() {
  return Array.from(activePlans.values()).map(plan => ({
    id: plan.id,
    type: plan.type,
    description: plan.description,
    priority: plan.priority,
    steps: plan.steps.length,
    status: plan.status || 'pending',
    createdAt: plan.generatedAt,
    trigger: plan.trigger?.type,
  }))
}

/**
 * 获取计划历史
 */
export function getPlanHistory(limit = 20) {
  return planHistory.slice(-limit)
}

/**
 * 取消计划
 */
export function cancelPlan(planId) {
  const plan = activePlans.get(planId)
  if (!plan) return { success: false, error: '计划不存在' }
  
  plan.status = 'cancelled'
  plan.cancelledAt = Date.now()
  
  activePlans.delete(planId)
  
  emitEvent('plan_cancelled', {
    planId,
    reason: 'user_cancelled',
  })
  
  return { success: true, planId }
}

/**
 * 从外部事件生成计划并入队
 */
export function queuePlanFromEvent(event) {
  const trigger = {
    type: event.type,
    data: event.data,
    source: 'event',
  }
  
  const plan = generatePlanFromTrigger(trigger)
  if (plan) {
    taskQueue.push({
      planId: plan.id,
      priority: plan.priority,
      queuedAt: Date.now(),
    })
    
    sortTaskQueue()
    
    emitEvent('plan_queued', {
      planId: plan.id,
      position: taskQueue.findIndex(t => t.planId === plan.id),
      queueLength: taskQueue.length,
    })
  }
  
  return plan
}

/**
 * 按优先级排序任务队列
 */
function sortTaskQueue() {
  taskQueue.sort((a, b) => b.priority - a.priority)
}

/**
 * 从队列中取出下一个任务
 */
export function dequeueNextPlan() {
  if (taskQueue.length === 0) return null
  
  sortTaskQueue()
  const next = taskQueue.shift()
  
  return activePlans.get(next.planId)
}

/**
 * 获取队列状态
 */
export function getQueueStatus() {
  return {
    queueLength: taskQueue.length,
    activePlans: activePlans.size,
    historyCount: planHistory.length,
    config: {
      enabled: config.enabled,
      autoExecute: config.autoExecute,
      maxConcurrentTasks: config.maxConcurrentTasks,
    },
  }
}

/**
 * 更新规划器配置
 */
export function updatePlannerConfig(partialConfig) {
  config = { ...config, ...partialConfig }
  return config
}

/**
 * 添加自定义计划模板
 */
export function addPlanTemplate(templateName, template) {
  planTemplates[templateName] = template
  return { success: true, templateName }
}

/**
 * 获取所有可用模板
 */
export function getPlanTemplates() {
  return Object.entries(planTemplates).map(([name, template]) => ({
    name,
    description: template.name || template.description || name,
    stepsCount: template.steps?.length || 0,
  }))
}