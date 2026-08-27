/**
 * plan-feedback-loop.js — 计划执行反馈闭环
 *
 * 核心理念：从"计划生成"到"执行反馈"到"动态重规划"的完整闭环。
 *
 * 流程：
 *   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 *   │  计划生成   │ ──→ │  执行监控   │ ──→ │  结果反馈   │
 *   └─────────────┘     └─────────────┘     └─────────────┘
 *        ↑                                          │
 *        │                                          ↓
 *   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 *   │  知识更新   │ ←── │  经验反思   │ ←── │  差异分析   │
 *   └─────────────┘     └─────────────┘     └─────────────┘
 *
 * 关键能力：
 *   1. 执行状态实时追踪
 *   2. 失败自动重试（指数退避）
 *   3. 结果与预期对比分析
 *   4. 动态调整后续步骤
 *   5. 经验沉淀到知识库
 */

import { emitEvent } from '../events.js'
import { getActivePlans, cancelPlan, generatePlanFromTrigger } from './auto-planner.js'
import { executePlanTool } from './plan-tool-executor.js'

const DEFAULT_CONFIG = {
  maxRetries: 3,
  retryDelayMs: 1000,
  maxConcurrentExecutions: 3,
  autoRetry: true,
  autoReschedule: true,
  progressReportIntervalMs: 5000,
}

let config = { ...DEFAULT_CONFIG }
let activeExecutions = new Map()
let executionHistory = []
let feedbackSubscribers = new Set()
let isRunning = false

/**
 * 初始化反馈闭环
 */
export function initPlanFeedbackLoop(userConfig = {}) {
  config = { ...DEFAULT_CONFIG, ...userConfig }
  console.log('[计划反馈闭环] 已启动')
  return { config }
}

/**
 * 执行计划并监控反馈
 */
export async function executePlanWithFeedback(planId, options = {}) {
  const { 
    onProgress = null, 
    onStepComplete = null,
    onStepFail = null,
    autoRetry = config.autoRetry,
  } = options
  
  const plan = getActivePlans().find(p => p.id === planId)
  if (!plan) {
    return { success: false, error: '计划不存在' }
  }
  
  const execution = createExecutionContext(plan)
  activeExecutions.set(planId, execution)
  
  emitEvent('plan_execution_started', {
    planId,
    planType: plan.type,
    totalSteps: plan.steps.length,
    timestamp: Date.now(),
  })
  
  try {
    const results = []
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      const stepResult = await executeStepWithRetry(step, execution, { autoRetry })
      
      if (stepResult.success) {
        results.push(stepResult)
        execution.completedSteps.push({ step, result: stepResult, timestamp: Date.now() })
        
        if (onStepComplete) onStepComplete(step, stepResult)
        emitEvent('plan_step_completed', { planId, stepId: step.id, index: i })
      } else {
        execution.failedSteps.push({ step, error: stepResult.error, timestamp: Date.now() })
        
        if (onStepFail) onStepFail(step, stepResult.error)
        emitEvent('plan_step_failed', { planId, stepId: step.id, error: stepResult.error })
        
        // 失败处理：尝试重规划
        if (config.autoReschedule) {
          const rescheduled = attemptReschedule(execution, step, stepResult.error)
          if (rescheduled) {
            execution.reschedules.push(rescheduled)
            i-- // 重试当前步骤
            continue
          }
        }
        
        if (!step.optional) {
          break // 非可选步骤失败，终止计划
        }
      }
      
      // 进度报告
      const progress = (results.length / plan.steps.length) * 100
      if (onProgress) onProgress(progress, i + 1, plan.steps.length)
      
      execution.progress = progress
      emitEvent('plan_progress_update', {
        planId,
        progress,
        completed: results.length,
        total: plan.steps.length,
      })
    }
    
    // 执行完成，生成反馈
    const feedback = generateFeedback(execution, results, plan)
    
    // 保存执行历史
    executionHistory.push({
      planId,
      planType: plan.type,
      success: results.length === plan.steps.length,
      results,
      feedback,
      durationMs: Date.now() - execution.startTime,
      timestamp: Date.now(),
    })
    
    activeExecutions.delete(planId)
    
    // 通知订阅者
    for (const subscriber of feedbackSubscribers) {
      try { subscriber(feedback) } catch {}
    }
    
    emitEvent('plan_execution_completed', {
      planId,
      success: results.length === plan.steps.length,
      stepsCompleted: results.length,
      totalSteps: plan.steps.length,
      durationMs: execution.durationMs,
      feedback,
    })
    
    return {
      success: true,
      planId,
      results,
      feedback,
      durationMs: execution.durationMs,
    }
    
  } catch (e) {
    activeExecutions.delete(planId)
    
    emitEvent('plan_execution_error', {
      planId,
      error: e.message,
      timestamp: Date.now(),
    })
    
    return { success: false, error: e.message, planId }
  }
}

/**
 * 执行单个步骤（带重试）
 */
async function executeStepWithRetry(step, execution, options = {}) {
  const { autoRetry = true } = options
  let lastError = null
  
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await executeStepTool(step, execution)
      
      if (attempt > 1) {
        execution.retryLog.push({
          stepId: step.id,
          attempt,
          success: true,
          timestamp: Date.now(),
        })
      }
      
      return { success: true, result, stepId: step.id, attempts: attempt }
    } catch (e) {
      lastError = e
      
      execution.retryLog.push({
        stepId: step.id,
        attempt,
        success: false,
        error: e.message,
        timestamp: Date.now(),
      })
      
      if (autoRetry && attempt < config.maxRetries) {
        const delay = config.retryDelayMs * Math.pow(2, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  return { success: false, error: lastError?.message || '执行失败', stepId: step.id }
}

/**
 * 执行步骤对应的工具（真实执行：接入能力层 executeTool）
 */
async function executeStepTool(step, execution) {
  const res = await executePlanTool(step.tool, step.input)
  if (res.ok === false) {
    throw new Error(res.result || `[${step.tool}] 执行失败`)
  }
  return res
}

/**
 * 尝试动态重规划
 */
function attemptReschedule(execution, failedStep, error) {
  const { plan, completedSteps } = execution
  
  // 根据失败类型生成替代方案
  const failureType = classifyFailure(error, failedStep)
  
  const alternatives = generateAlternativeSteps(failedStep, failureType)
  
  if (alternatives && alternatives.length > 0) {
    return {
      failedStepId: failedStep.id,
      failureType,
      alternatives,
      reason: error.message,
      timestamp: Date.now(),
    }
  }
  
  return null
}

/**
 * 分类失败类型
 */
function classifyFailure(error, step) {
  const errorMsg = error?.message || String(error)
  
  if (errorMsg.includes('timeout') || errorMsg.includes('超时')) {
    return 'timeout'
  }
  if (errorMsg.includes('network') || errorMsg.includes('连接')) {
    return 'network'
  }
  if (errorMsg.includes('permission') || errorMsg.includes('权限')) {
    return 'permission'
  }
  if (errorMsg.includes('not found') || errorMsg.includes('不存在')) {
    return 'not_found'
  }
  if (errorMsg.includes('rate limit') || errorMsg.includes('频率')) {
    return 'rate_limit'
  }
  
  return 'unknown'
}

/**
 * 生成替代步骤
 */
function generateAlternativeSteps(failedStep, failureType) {
  const alternatives = {
    timeout: [
      { ...failedStep, tool: 'retry_with_backoff', description: '延迟重试' },
      { ...failedStep, tool: 'skip_and_continue', optional: true, description: '跳过继续' },
    ],
    network: [
      { ...failedStep, tool: 'network_retry', description: '网络恢复后重试' },
      { ...failedStep, tool: 'offline_cache', description: '使用离线缓存' },
    ],
    permission: [
      { ...failedStep, tool: 'request_permission', description: '请求权限' },
      { ...failedStep, tool: 'alternative_tool', description: '使用替代方案' },
    ],
    not_found: [
      { ...failedStep, tool: 'search_alternative', description: '搜索替代资源' },
    ],
    rate_limit: [
      { ...failedStep, tool: 'rate_limit_retry', description: '稍后重试' },
      { ...failedStep, tool: 'queue_for_later', optional: true, description: '加入延迟队列' },
    ],
    unknown: [
      { ...failedStep, tool: 'diagnose_and_retry', description: '诊断并重试' },
    ],
  }
  
  return alternatives[failureType] || null
}

/**
 * 创建执行上下文
 */
function createExecutionContext(plan) {
  return {
    plan,
    startTime: Date.now(),
    completedSteps: [],
    failedSteps: [],
    retries: 0,
    retryLog: [],
    reschedules: [],
    progress: 0,
  }
}

/**
 * 生成执行反馈
 */
function generateFeedback(execution, results, plan) {
  const { completedSteps, failedSteps, retryLog, reschedules, durationMs } = execution
  
  const feedback = {
    planId: plan.id,
    planType: plan.type,
    timestamp: Date.now(),
    
    // 执行统计
    statistics: {
      totalSteps: plan.steps.length,
      completedSteps: completedSteps.length,
      failedSteps: failedSteps.length,
      totalRetries: retryLog.length,
      successfulRetries: retryLog.filter(r => r.success).length,
      reschedules: reschedules.length,
      durationMs,
      successRate: (completedSteps.length / plan.steps.length) * 100,
    },
    
    // 步骤详情
    steps: {
      completed: completedSteps.map(s => ({
        id: s.step.id,
        tool: s.step.tool,
        durationMs: s.timestamp - (execution.startTime || s.timestamp),
        retries: retryLog.filter(r => r.stepId === s.step.id).length,
      })),
      failed: failedSteps.map(s => ({
        id: s.step.id,
        tool: s.step.tool,
        error: s.error,
        timestamp: s.timestamp,
      })),
    },
    
    // 经验教训
    lessons: extractLessons(execution, plan),
    
    // 改进建议
    suggestions: generateSuggestions(execution, plan),
  }
  
  return feedback
}

/**
 * 提取经验教训
 */
function extractLessons(execution, plan) {
  const lessons = []
  
  if (execution.retryLog.length > 0) {
    lessons.push({
      type: 'reliability',
      content: `${execution.retryLog.length}次重试，说明某些步骤稳定性较差`,
      severity: execution.retryLog.length > 5 ? 'high' : 'medium',
    })
  }
  
  if (execution.failedSteps.length > 0) {
    const failureTypes = new Set(execution.failedSteps.map(s => classifyFailure(s.error, s.step)))
    lessons.push({
      type: 'failure_pattern',
      content: `失败类型: ${Array.from(failureTypes).join(', ')}`,
      severity: 'high',
    })
  }
  
  if (execution.reschedules.length > 0) {
    lessons.push({
      type: 'adaptability',
      content: `成功重规划 ${execution.reschedules.length} 次`,
      severity: 'info',
    })
  }
  
  return lessons
}

/**
 * 生成改进建议
 */
function generateSuggestions(execution, plan) {
  const suggestions = []
  
  // 基于失败类型的建议
  const failureTypes = execution.failedSteps.map(s => classifyFailure(s.error, s.step))
  
  if (failureTypes.includes('timeout')) {
    suggestions.push({
      area: 'timeout_handling',
      recommendation: '考虑增加超时时间或实现更积极的重试策略',
      priority: 'high',
    })
  }
  
  if (failureTypes.includes('network')) {
    suggestions.push({
      area: 'network_resilience',
      recommendation: '添加网络恢复检测和自动重连机制',
      priority: 'high',
    })
  }
  
  // 基于重试次数的建议
  const stepsWithRetries = new Set(execution.retryLog.filter(r => r.success).map(r => r.stepId))
  if (stepsWithRetries.size > 0) {
    suggestions.push({
      area: 'step_reliability',
      recommendation: `步骤 ${Array.from(stepsWithRetries).join(', ')} 需要多次重试才能成功，考虑优化`,
      priority: 'medium',
    })
  }
  
  return suggestions
}

/**
 * 订阅反馈事件
 */
export function subscribeFeedback(callback) {
  feedbackSubscribers.add(callback)
  return () => feedbackSubscribers.delete(callback)
}

/**
 * 获取当前执行状态
 */
export function getExecutionStatus() {
  return {
    activeExecutions: activeExecutions.size,
    executionHistoryCount: executionHistory.length,
    config: { ...config },
    plansInProgress: Array.from(activeExecutions.keys()),
  }
}

/**
 * 获取执行历史
 */
export function getExecutionHistory(limit = 20) {
  return executionHistory.slice(-limit)
}

/**
 * 获取特定计划的执行状态
 */
export function getPlanExecutionStatus(planId) {
  const execution = activeExecutions.get(planId)
  if (!execution) {
    const history = executionHistory.find(h => h.planId === planId)
    return history ? { status: 'completed', ...history } : null
  }
  
  return {
    status: 'in_progress',
    progress: execution.progress,
    completedSteps: execution.completedSteps.length,
    totalSteps: execution.plan.steps.length,
    retries: execution.retryLog.length,
    elapsedMs: Date.now() - execution.startTime,
  }
}

/**
 * 更新配置
 */
export function updateFeedbackConfig(partialConfig) {
  config = { ...config, ...partialConfig }
  return config
}