import { emitEvent } from '../events.js'

// ============================================================
// 决策框架 - 多准则决策分析 (Multi-Criteria Decision Analysis)
// ============================================================

// 决策风格配置
const DECISION_STYLES = {
  conservative: {
    name: '保守型',
    description: '倾向于选择风险最低的选项，即使收益可能较低',
    riskWeight: 0.7,
    rewardWeight: 0.3,
    minScoreThreshold: 0.4,
    penalizeUncertainty: true,
  },
  aggressive: {
    name: '激进型',
    description: '倾向于选择收益最高的选项，愿意承担更高风险',
    riskWeight: 0.3,
    rewardWeight: 0.7,
    minScoreThreshold: 0.2,
    penalizeUncertainty: false,
  },
  balanced: {
    name: '平衡型',
    description: '在风险和收益之间寻求平衡',
    riskWeight: 0.5,
    rewardWeight: 0.5,
    minScoreThreshold: 0.3,
    penalizeUncertainty: false,
  },
}

// 模块状态
let initialized = false
let criteria = []
let decisionHistory = []
let currentStyle = 'balanced'
let maxHistorySize = 200

// ------------------------------------------------------------
// 初始化决策框架
// ------------------------------------------------------------
export function initDecisionFramework(config = {}) {
  if (initialized) return { success: true, alreadyInitialized: true }

  currentStyle = config.style || 'balanced'
  maxHistorySize = config.maxHistorySize || 200

  // 设置默认决策准则
  criteria = config.criteria || [
    {
      id: 'feasibility',
      name: '可行性',
      description: '选项在技术和资源上的可行程度',
      weight: 0.25,
      type: 'benefit',
      range: [0, 1],
    },
    {
      id: 'desirability',
      name: '期望度',
      description: '选项满足目标和用户需求的程度',
      weight: 0.25,
      type: 'benefit',
      range: [0, 1],
    },
    {
      id: 'risk_level',
      name: '风险等级',
      description: '选项涉及的风险程度（越低越好）',
      weight: 0.2,
      type: 'cost',
      range: [0, 1],
    },
    {
      id: 'time_efficiency',
      name: '时间效率',
      description: '选项完成任务所需的时间效率',
      weight: 0.15,
      type: 'benefit',
      range: [0, 1],
    },
    {
      id: 'resource_cost',
      name: '资源成本',
      description: '选项所需的资源消耗（越低越好）',
      weight: 0.15,
      type: 'cost',
      range: [0, 1],
    },
  ]

  // 归一化权重
  normalizeWeights()

  initialized = true

  emitEvent('decision_framework_initialized', {
    style: currentStyle,
    criteriaCount: criteria.length,
  })

  return { success: true, style: currentStyle, criteriaCount: criteria.length }
}

// ------------------------------------------------------------
// 归一化准则权重，使总权重为 1
// ------------------------------------------------------------
function normalizeWeights() {
  const total = criteria.reduce((sum, c) => sum + (c.weight || 0), 0)
  if (total <= 0) return
  for (const c of criteria) {
    c.weight = (c.weight || 0) / total
  }
}

// ------------------------------------------------------------
// 定义/更新决策准则
// ------------------------------------------------------------
export function defineCriteria(newCriteria) {
  if (!Array.isArray(newCriteria) || newCriteria.length === 0) {
    return { success: false, error: '准则必须为非空数组' }
  }

  // 验证每个准则
  for (const c of newCriteria) {
    if (!c.id || !c.name) {
      return { success: false, error: '每个准则必须包含 id 和 name 字段' }
    }
    if (c.weight !== undefined && (c.weight < 0 || c.weight > 1)) {
      return { success: false, error: `准则 ${c.id} 的权重必须在 0 到 1 之间` }
    }
  }

  criteria = newCriteria.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description || '',
    weight: c.weight !== undefined ? c.weight : 0.2,
    type: c.type || 'benefit',
    range: c.range || [0, 1],
  }))

  normalizeWeights()

  emitEvent('criteria_defined', {
    count: criteria.length,
    criteria: criteria.map(c => ({ id: c.id, name: c.name, weight: c.weight })),
  })

  return { success: true, criteria }
}

// ------------------------------------------------------------
// 评估决策 - 对多个选项进行多准则评分
// ------------------------------------------------------------
export function evaluateDecision(options, context = {}) {
  if (!initialized) {
    return { success: false, error: '决策框架未初始化，请先调用 initDecisionFramework' }
  }

  // 修复：兼容 { options: [...] } 和直接传递数组两种调用方式
  let optionsArray = options
  let contextObj = context
  if (options && !Array.isArray(options) && Array.isArray(options.options)) {
    optionsArray = options.options
    contextObj = { ...context, ...(options.context || {}) }
  }

  if (!Array.isArray(optionsArray) || optionsArray.length === 0) {
    return { success: false, error: '选项必须为非空数组' }
  }

  const style = DECISION_STYLES[currentStyle] || DECISION_STYLES.balanced
  const scoredOptions = []

  for (const option of optionsArray) {
    const scoreResult = scoreOption(option, style)
    scoredOptions.push(scoreResult)
  }

  // 按加权得分排序
  scoredOptions.sort((a, b) => b.weightedScore - a.weightedScore)

  // 选择最佳选项
  const best = scoredOptions[0]
  const passedThreshold = best.weightedScore >= style.minScoreThreshold

  const decision = {
    id: generateDecisionId(),
    timestamp: Date.now(),
    style: currentStyle,
    chosenOption: passedThreshold ? best.option.id : null,
    chosenOptionName: passedThreshold ? best.option.name : null,
    weightedScore: best.weightedScore,
    passedThreshold,
    ranking: scoredOptions.map((s, i) => ({
      rank: i + 1,
      optionId: s.option.id,
      optionName: s.option.name,
      weightedScore: s.weightedScore,
      dimensionScores: s.dimensionScores,
    })),
    rationale: generateRationale(best, style, contextObj),
    context: {
      taskType: contextObj.taskType || 'unknown',
      userIntent: contextObj.userIntent || '',
      environment: contextObj.environment || {},
    },
  }

  // 存入历史
  decisionHistory.push(decision)
  if (decisionHistory.length > maxHistorySize) {
    decisionHistory = decisionHistory.slice(-maxHistorySize)
  }

  emitEvent('decision_evaluated', {
    decisionId: decision.id,
    chosenOption: decision.chosenOption,
    weightedScore: decision.weightedScore,
    optionCount: optionsArray.length,
    passedThreshold: decision.passedThreshold,
  })

  // 修复：添加 recommendation 字段以兼容不同调用方式
  const recommendation = passedThreshold ? {
    id: best.option.id,
    name: best.option.name,
    weightedScore: best.weightedScore,
    rationale: decision.rationale,
  } : null

  return {
    success: true,
    decision,
    recommendation,  // 新增：直接返回推荐方案
    allScores: scoredOptions.map(s => ({
      optionId: s.option.id,
      optionName: s.option.name,
      weightedScore: s.weightedScore,
    })),
  }
}

// ------------------------------------------------------------
// 对单个选项进行评分
// ------------------------------------------------------------
function scoreOption(option, style) {
  const dimensionScores = {}
  let rawScoreSum = 0
  let riskContribution = 0
  let rewardContribution = 0

  for (const c of criteria) {
    // 获取选项在该准则上的评分，默认为 0.5
    let rawScore = option.scores?.[c.id]
    if (rawScore === undefined || rawScore === null) {
      rawScore = 0.5
    }

    // 评分归一化到 [0, 1]
    const [min, max] = c.range
    let normalized = (rawScore - min) / (max - min)
    normalized = Math.max(0, Math.min(1, normalized))

    // 如果是成本型准则，反转（越低越好 → 分数越高越好）
    if (c.type === 'cost') {
      normalized = 1 - normalized
    }

    dimensionScores[c.id] = {
      name: c.name,
      rawScore,
      normalizedScore: normalized,
      weight: c.weight,
      contribution: normalized * c.weight,
      type: c.type,
    }

    // 风险惩罚：保守型对高不确定性进行惩罚
    if (style.penalizeUncertainty && c.type === 'cost' && normalized > 0.7) {
      riskContribution += (normalized - 0.7) * c.weight * style.riskWeight
    }

    if (c.type === 'benefit') {
      rewardContribution += normalized * c.weight
    }

    rawScoreSum += normalized * c.weight
  }

  // 应用决策风格调整
  let weightedScore = rawScoreSum
  if (style.penalizeUncertainty && riskContribution > 0) {
    weightedScore -= riskContribution * 0.3
  }

  weightedScore = Math.max(0, Math.min(1, weightedScore))

  return {
    option,
    weightedScore: roundTo(weightedScore, 4),
    dimensionScores,
    riskContribution: roundTo(riskContribution, 4),
    rewardContribution: roundTo(rewardContribution, 4),
  }
}

// ------------------------------------------------------------
// 生成决策理由文本
// ------------------------------------------------------------
function generateRationale(best, style, context) {
  const parts = []
  parts.push(`决策风格为「${style.name}」，`)

  if (best.weightedScore >= 0.7) {
    parts.push(`选项「${best.option.name}」的综合得分较高 (${best.weightedScore.toFixed(2)})，质量优秀。`)
  } else if (best.weightedScore >= 0.4) {
    parts.push(`选项「${best.option.name}」的综合得分处于可接受范围 (${best.weightedScore.toFixed(2)})。`)
  } else {
    parts.push(`选项「${best.option.name}」的综合得分偏低 (${best.weightedScore.toFixed(2)})，存在改进空间。`)
  }

  // 找出贡献最大的准则
  const topDimensions = Object.entries(best.dimensionScores)
    .sort((a, b) => b[1].contribution - a[1].contribution)
    .slice(0, 2)

  if (topDimensions.length > 0) {
    parts.push(`主要优势来自「${topDimensions[0][1].name}」维度 (贡献 ${topDimensions[0][1].contribution.toFixed(2)})`)
    if (topDimensions.length > 1) {
      parts.push(`和「${topDimensions[1][1].name}」维度 (贡献 ${topDimensions[1][1].contribution.toFixed(2)})。`)
    } else {
      parts.push('。')
    }
  }

  return parts.join('')
}

// ------------------------------------------------------------
// 重置决策框架（用于切换风格等场景）
// ------------------------------------------------------------
export function resetDecisionFramework(config = {}) {
  initialized = false
  currentStyle = config.style || 'balanced'
  maxHistorySize = config.maxHistorySize || 200
  decisionHistory = []

  criteria = config.criteria || [
    {
      id: 'feasibility',
      name: '可行性',
      description: '选项在技术和资源上的可行程度',
      weight: 0.25,
      type: 'benefit',
      range: [0, 1],
    },
    {
      id: 'desirability',
      name: '期望度',
      description: '选项满足目标和用户需求的程度',
      weight: 0.25,
      type: 'benefit',
      range: [0, 1],
    },
    {
      id: 'risk_level',
      name: '风险等级',
      description: '选项涉及的风险程度（越低越好）',
      weight: 0.2,
      type: 'cost',
      range: [0, 1],
    },
    {
      id: 'time_efficiency',
      name: '时间效率',
      description: '选项完成任务所需的时间效率',
      weight: 0.15,
      type: 'benefit',
      range: [0, 1],
    },
    {
      id: 'resource_cost',
      name: '资源成本',
      description: '选项所需的资源消耗（越低越好）',
      weight: 0.15,
      type: 'cost',
      range: [0, 1],
    },
  ]

  normalizeWeights()
  initialized = true

  emitEvent('decision_framework_reset', { style: currentStyle })

  return { success: true, style: currentStyle, reset: true }
}

// ------------------------------------------------------------
// 获取决策历史
// ------------------------------------------------------------
export function getDecisionHistory(options = {}) {
  const { limit = 50, style, from, to } = options
  let filtered = [...decisionHistory]

  if (style) {
    filtered = filtered.filter(d => d.style === style)
  }
  if (from) {
    filtered = filtered.filter(d => d.timestamp >= from)
  }
  if (to) {
    filtered = filtered.filter(d => d.timestamp <= to)
  }

  filtered.sort((a, b) => b.timestamp - a.timestamp)
  return filtered.slice(0, limit)
}

// ------------------------------------------------------------
// 生成唯一决策 ID
// ------------------------------------------------------------
let decisionCounter = 0
function generateDecisionId() {
  decisionCounter += 1
  return `dec_${Date.now()}_${decisionCounter}`
}

// ------------------------------------------------------------
// 四舍五入到指定小数位
// ------------------------------------------------------------
function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

// ============================================================
// 多目标决策优化模块 (Multi-Objective Optimization)
// ============================================================

// ------------------------------------------------------------
// Pareto 分析 - 识别 Pareto 最优解
// ------------------------------------------------------------
export function paretoAnalysis(options, context = {}) {
  if (!Array.isArray(options) || options.length === 0) {
    return { success: false, error: '选项必须为非空数组' }
  }

  const dimensionScores = []
  const optionMap = new Map()

  for (const option of options) {
    const scores = {}
    for (const c of criteria) {
      let rawScore = option.scores?.[c.id] ?? 0.5
      const [min, max] = c.range
      let normalized = (rawScore - min) / (max - min)
      normalized = Math.max(0, Math.min(1, normalized))
      if (c.type === 'cost') normalized = 1 - normalized
      scores[c.id] = { ...c, normalized, raw: rawScore }
    }
    dimensionScores.push({ id: option.id, name: option.name, scores })
    optionMap.set(option.id, option)
  }

  const paretoFrontier = []
  const dominated = []

  for (let i = 0; i < dimensionScores.length; i++) {
    const isDominated = dimensionScores.some((j, idx) => {
      if (idx === i) return false
      let jDominates = true
      for (const crit of criteria) {
        if (j.scores[crit.id].normalized < dimensionScores[i].scores[crit.id].normalized) {
          jDominates = false
          break
        }
      }
      return jDominates
    })

    if (isDominated) {
      dominated.push(dimensionScores[i])
    } else {
      paretoFrontier.push({
        ...dimensionScores[i],
        option: optionMap.get(dimensionScores[i].id),
      })
    }
  }

  const tradeoffAnalysis = analyzeTradeoffs(paretoFrontier)

  emitEvent('pareto_analysis_completed', {
    totalOptions: options.length,
    paretoOptimalCount: paretoFrontier.length,
    dominatedCount: dominated.length,
  })

  return {
    success: true,
    paretoFrontier,
    dominated,
    tradeoffAnalysis,
    summary: {
      totalOptions: options.length,
      paretoOptimalCount: paretoFrontier.length,
      dominatedCount: dominated.length,
      ratio: roundTo(paretoFrontier.length / options.length, 2),
    },
  }
}

// ------------------------------------------------------------
// 分析 Pareto 前沿上的权衡关系
// ------------------------------------------------------------
function analyzeTradeoffs(paretoFrontier) {
  if (paretoFrontier.length < 2) {
    return { tradeoffs: [], message: 'Pareto 前沿选项不足，无法分析权衡' }
  }

  const tradeoffs = []
  for (let i = 0; i < paretoFrontier.length; i++) {
    for (let j = i + 1; j < paretoFrontier.length; j++) {
      const a = paretoFrontier[i]
      const b = paretoFrontier[j]
      const improvements = []
      const sacrifices = []

      for (const crit of criteria) {
        const diff = b.scores[crit.id].normalized - a.scores[crit.id].normalized
        if (diff > 0.05) {
          improvements.push({ dimension: crit.name, improvement: roundTo(diff, 3) })
        } else if (diff < -0.05) {
          sacrifices.push({ dimension: crit.name, sacrifice: roundTo(Math.abs(diff), 3) })
        }
      }

      if (improvements.length > 0 || sacrifices.length > 0) {
        tradeoffs.push({
          from: a.id,
          to: b.id,
          fromName: a.name,
          toName: b.name,
          improvements,
          sacrifices,
          netTradeoff: improvements.length - sacrifices.length,
        })
      }
    }
  }

  return {
    tradeoffs,
    message: `识别出 ${tradeoffs.length} 个权衡关系`,
  }
}

// ------------------------------------------------------------
// 约束满足 - 处理硬约束和软约束
// ------------------------------------------------------------
export function constraintSatisfaction(options, constraints = [], context = {}) {
  if (!Array.isArray(options) || options.length === 0) {
    return { success: false, error: '选项必须为非空数组' }
  }

  const results = []
  const violated = []
  const satisfied = []

  for (const option of options) {
    const hardViolations = []
    const softViolations = []

    for (const constraint of constraints) {
      const checkResult = checkConstraint(option, constraint, context)
      if (checkResult.type === 'hard' && !checkResult.satisfied) {
        hardViolations.push({
          constraint: constraint.id || constraint.name,
          reason: checkResult.reason,
          severity: 'hard',
        })
      } else if (checkResult.type === 'soft' && !checkResult.satisfied) {
        softViolations.push({
          constraint: constraint.id || constraint.name,
          reason: checkResult.reason,
          severity: 'soft',
          penalty: constraint.penalty || 0.1,
        })
      }
    }

    const isFeasible = hardViolations.length === 0
    const penalty = softViolations.reduce((sum, v) => sum + (v.penalty || 0), 0)

    const result = {
      optionId: option.id,
      optionName: option.name,
      isFeasible,
      hardViolations,
      softViolations,
      penalty: roundTo(penalty, 3),
      adjustedScore: null,
    }

    results.push(result)
    if (isFeasible) satisfied.push(result)
    else violated.push(result)
  }

  emitEvent('constraint_satisfaction_completed', {
    totalOptions: options.length,
    feasibleCount: satisfied.length,
    infeasibleCount: violated.length,
  })

  return {
    success: true,
    results,
    feasibleOptions: satisfied.map(r => r.optionId),
    infeasibleOptions: violated.map(r => r.optionId),
    summary: {
      totalOptions: options.length,
      feasibleCount: satisfied.length,
      infeasibleCount: violated.length,
      constraintsChecked: constraints.length,
    },
  }
}

// ------------------------------------------------------------
// 检查单个约束
// ------------------------------------------------------------
function checkConstraint(option, constraint, context = {}) {
  const { id, type, check, threshold, operator } = constraint
  const constraintType = type === 'hard' ? 'hard' : 'soft'

  if (typeof check === 'function') {
    try {
      const result = check(option, context)
      if (typeof result === 'boolean') {
        return { satisfied: result, type: constraintType, reason: result ? '' : `自定义检查失败: ${id}` }
      }
      return { satisfied: !!result?.satisfied, type: constraintType, reason: result?.reason || '' }
    } catch (e) {
      return { satisfied: false, type: constraintType, reason: `约束检查异常: ${e.message}` }
    }
  }

  if (threshold !== undefined && operator) {
    const scores = option.scores || {}
    const value = scores[constraint.field] ?? scores[constraint.id] ?? 0.5

    let satisfied = false
    switch (operator) {
      case '>': satisfied = value > threshold; break
      case '>=': satisfied = value >= threshold; break
      case '<': satisfied = value < threshold; break
      case '<=': satisfied = value <= threshold; break
      case '==': satisfied = value === threshold; break
      case '!=': satisfied = value !== threshold; break
      default: satisfied = value >= threshold
    }

    return {
      satisfied,
      type: constraintType,
      reason: satisfied
        ? `${constraint.field || id} = ${value} ${operator} ${threshold} 满足`
        : `${constraint.field || id} = ${value} ${operator} ${threshold} 不满足`,
    }
  }

  return { satisfied: true, type: constraintType, reason: '无检查逻辑，默认满足' }
}

// ------------------------------------------------------------
// 敏感性分析 - 评估决策对参数变化的敏感性
// ------------------------------------------------------------
export function sensitivityAnalysis(options, config = {}) {
  if (!Array.isArray(options) || options.length === 0) {
    return { success: false, error: '选项必须为非空数组' }
  }

  const { perturbationAmount = 0.1, iterations = 5 } = config
  const baselineResults = []
  const sensitivityMap = new Map()

  for (const criterion of criteria) {
    const originalWeight = criterion.weight
    const perturbations = []

    for (let iter = 0; iter < iterations; iter++) {
      const factor = 1 + (Math.random() - 0.5) * 2 * perturbationAmount
      const perturbedWeight = originalWeight * factor
      criterion.weight = perturbedWeight

      const evalResult = evaluateDecision(options)
      if (evalResult.success) {
        perturbations.push({
          iteration: iter,
          weightFactor: roundTo(factor, 3),
          topChoice: evalResult.decision.chosenOption,
          topScore: roundTo(evalResult.decision.weightedScore, 4),
        })
      }
    }

    criterion.weight = originalWeight
    sensitivityMap.set(criterion.id, {
      criterion: criterion.name,
      originalWeight: originalWeight,
      perturbations,
      stability: calculateStability(perturbations),
    })
  }

  const keyFindings = []
  for (const [criterionId, data] of sensitivityMap) {
    if (data.stability.changes > 0) {
      keyFindings.push({
        criterion: data.criterion,
        changes: data.stability.changes,
        stabilityScore: data.stability.stabilityScore,
        recommendation: data.stability.stabilityScore < 0.5
          ? `${data.criterion} 的权重变化对决策影响较大，建议谨慎调整`
          : `${data.criterion} 对权重变化不敏感，可适当调整`,
      })
    }
  }

  emitEvent('sensitivity_analysis_completed', {
    criteriaAnalyzed: criteria.length,
    keyFindings: keyFindings.length,
  })

  return {
    success: true,
    sensitivityMap: Object.fromEntries(sensitivityMap),
    keyFindings,
    overallStability: calculateOverallStability(sensitivityMap),
    summary: `分析了 ${criteria.length} 个准则的权重敏感性，发现 ${keyFindings.length} 个需要关注的点`,
  }
}

// ------------------------------------------------------------
// 计算稳定性指标
// ------------------------------------------------------------
function calculateStability(perturbations) {
  if (perturbations.length === 0) return { changes: 0, stabilityScore: 1 }

  const choices = new Set(perturbations.map(p => p.topChoice))
  const scores = perturbations.map(p => p.topScore)

  const scoreRange = Math.max(...scores) - Math.min(...scores)
  const scoreMean = scores.reduce((a, b) => a + b, 0) / scores.length
  const scoreVariance = scores.reduce((sum, s) => sum + Math.pow(s - scoreMean, 2), 0) / scores.length

  return {
    changes: choices.size - 1,
    stabilityScore: roundTo(1 - choices.size / perturbations.length, 2),
    scoreRange: roundTo(scoreRange, 4),
    scoreVariance: roundTo(scoreVariance, 4),
  }
}

// ------------------------------------------------------------
// 计算整体稳定性
// ------------------------------------------------------------
function calculateOverallStability(sensitivityMap) {
  const stabilities = []
  for (const data of sensitivityMap.values()) {
    stabilities.push(data.stability.stabilityScore)
  }
  const avgStability = stabilities.reduce((a, b) => a + b, 0) / stabilities.length
  return {
    average: roundTo(avgStability, 2),
    min: roundTo(Math.min(...stabilities), 2),
    max: roundTo(Math.max(...stabilities), 2),
    interpretation: avgStability >= 0.8
      ? '决策稳定性高，对参数变化不敏感'
      : avgStability >= 0.5
      ? '决策稳定性中等，部分参数变化可能影响结果'
      : '决策稳定性低，参数变化可能显著影响结果',
  }
}

// ------------------------------------------------------------
// 多步骤决策路径分析
// ------------------------------------------------------------
export function analyzeDecisionPath(steps, context = {}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { success: false, error: '决策步骤必须为非空数组' }
  }

  const path = []
  let currentState = { ...context, stepIndex: 0 }
  const branchPoints = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepResult = executeDecisionStep(step, currentState)

    if (stepResult.branches && stepResult.branches.length > 1) {
      branchPoints.push({
        stepIndex: i,
        stepName: step.name || `Step ${i + 1}`,
        branchCount: stepResult.branches.length,
        description: stepResult.description || '分支决策点',
      })
    }

    path.push({
      stepIndex: i,
      stepName: step.name || `Step ${i + 1}`,
      type: step.type || 'action',
      inputs: stepResult.inputs,
      outputs: stepResult.outputs,
      decisionRequired: stepResult.decisionRequired,
      branchOptions: stepResult.branches?.length || 0,
      estimatedImpact: stepResult.estimatedImpact,
    })

    if (stepResult.nextState) {
      currentState = { ...currentState, ...stepResult.nextState, stepIndex: i + 1 }
    }
  }

  const criticalPath = path.filter(p => p.type === 'decision' || p.decisionRequired)
  const riskAssessment = assessPathRisk(path, branchPoints)

  emitEvent('decision_path_analyzed', {
    totalSteps: steps.length,
    branchPoints: branchPoints.length,
    criticalSteps: criticalPath.length,
  })

  return {
    success: true,
    path,
    branchPoints,
    criticalPath,
    riskAssessment,
    summary: {
      totalSteps: steps.length,
      branchPoints: branchPoints.length,
      criticalSteps: criticalPath.length,
      estimatedComplexity: steps.length + branchPoints.length * 2,
    },
  }
}

// ------------------------------------------------------------
// 执行单个决策步骤分析
// ------------------------------------------------------------
function executeDecisionStep(step, state) {
  const { type, inputs = [], options = [], transform, validate } = step

  let decisionRequired = false
  let branches = []
  let estimatedImpact = 'medium'

  if (type === 'decision' || options.length > 0) {
    decisionRequired = true
    branches = options
    estimatedImpact = options.length >= 3 ? 'high' : 'medium'
  }

  let outputs = []
  if (typeof transform === 'function') {
    try {
      outputs = transform(state)
    } catch {
      outputs = []
    }
  }

  let inputsValid = true
  if (typeof validate === 'function') {
    try {
      inputsValid = validate(state)
    } catch {
      inputsValid = true
    }
  }

  return {
    inputs,
    outputs,
    decisionRequired,
    branches,
    estimatedImpact,
    inputsValid,
    nextState: {
      lastOutputs: outputs,
      lastStepType: type,
      ...(inputsValid ? {} : { validationFailed: true }),
    },
  }
}

// ------------------------------------------------------------
// 评估决策路径风险
// ------------------------------------------------------------
function assessPathRisk(path, branchPoints) {
  const riskFactors = []

  if (branchPoints.length > 3) {
    riskFactors.push({
      type: 'complexity',
      level: 'high',
      description: `分支点过多 (${branchPoints.length}个)，决策路径复杂`,
      mitigation: '考虑简化决策逻辑或引入分层决策',
    })
  }

  const decisionSteps = path.filter(p => p.decisionRequired)
  if (decisionSteps.length > 5) {
    riskFactors.push({
      type: 'fatigue',
      level: 'medium',
      description: `需要大量决策 (${decisionSteps.length}个)，可能导致决策疲劳`,
      mitigation: '考虑引入自动化决策或委托机制',
    })
  }

  const highImpactSteps = path.filter(p => p.estimatedImpact === 'high')
  if (highImpactSteps.length > 0) {
    riskFactors.push({
      type: 'impact',
      level: highImpactSteps.length > 2 ? 'high' : 'medium',
      description: `${highImpactSteps.length}个高影响决策点，需要重点关注`,
      mitigation: '为高影响决策点建立额外的审查机制',
    })
  }

  const overallRisk = riskFactors.length === 0
    ? { level: 'low', description: '决策路径风险可控' }
    : riskFactors.reduce((acc, f) => {
        if (f.level === 'high') acc.score += 0.3
        else if (f.level === 'medium') acc.score += 0.15
        return acc
      }, { score: 0, level: 'low', description: '' })

  if (overallRisk.score >= 0.4) overallRisk.level = 'high'
  else if (overallRisk.score >= 0.2) overallRisk.level = 'medium'
  overallRisk.description = `${riskFactors.length} 个风险因素，总体风险等级: ${overallRisk.level}`

  return {
    riskFactors,
    overallRisk: {
      level: overallRisk.level,
      description: overallRisk.description,
      score: roundTo(overallRisk.score, 2),
    },
    recommendations: riskFactors.map(f => ({
      type: f.type,
      severity: f.level,
      action: f.mitigation,
    })),
  }
}