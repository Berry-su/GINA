import { emitEvent } from '../events.js'

// ============================================================
// 可解释性层 - 决策透明化与推理追踪 (Explainability Layer)
// ============================================================

// 推理节点类型
const REASONING_NODE_TYPES = {
  PERCEPTION: 'perception',       // 感知节点：信息输入
  EVALUATION: 'evaluation',       // 评估节点：价值判断
  COMPARISON: 'comparison',       // 比较节点：选项对比
  DECISION: 'decision',           // 决策节点：最终选择
  JUSTIFICATION: 'justification', // 辩护节点：理由阐述
  REFLECTION: 'reflection',       // 反思节点：自我审视
}

// 解释类型
const EXPLANATION_TYPES = {
  SIMPLE: 'simple',               // 简单解释
  DETAILED: 'detailed',           // 详细解释
  TECHNICAL: 'technical',         // 技术解释
  USER_FRIENDLY: 'user_friendly', // 用户友好解释
  COMPLIANCE: 'compliance',       // 合规性解释
}

// 模块状态
let initialized = false
let reasoningTrails = new Map()   // decisionId → 推理轨迹
let explanationCache = new Map()  // decisionId → 缓存的解释
let confidenceHistory = []       // 置信度历史
let decisionChains = new Map()   // decisionId → 完整决策链
let replayHistory = []           // 回放历史
let maxTrailSize = 500
let maxCacheSize = 200

// ------------------------------------------------------------
// 初始化可解释性层
// ------------------------------------------------------------
export function initExplainabilityLayer(config = {}) {
  if (initialized) return { success: true, alreadyInitialized: true }

  maxTrailSize = config.maxTrailSize || 500
  maxCacheSize = config.maxCacheSize || 200

  initialized = true

  emitEvent('explainability_layer_initialized', {
    maxTrailSize,
    maxCacheSize,
  })

  return { success: true, maxTrailSize, maxCacheSize }
}

// ------------------------------------------------------------
// 重置可解释性层
// ------------------------------------------------------------
export function resetExplainabilityLayer(config = {}) {
  initialized = false
  reasoningTrails = new Map()
  explanationCache = new Map()
  confidenceHistory = []
  decisionChains = new Map()
  replayHistory = []
  decisionPatterns = new Map()

  maxTrailSize = config.maxTrailSize || 500
  maxCacheSize = config.maxCacheSize || 200
  initialized = true

  emitEvent('explainability_layer_reset', {})

  return { success: true, reset: true }
}

// ------------------------------------------------------------
// 追踪推理路径
// ------------------------------------------------------------
export function traceReasoning(decisionId, steps) {
  if (!initialized) {
    return { success: false, error: '可解释性层未初始化，请先调用 initExplainabilityLayer' }
  }

  if (!decisionId) {
    return { success: false, error: '决策 ID 不能为空' }
  }

  // 获取或创建推理轨迹
  let trail = reasoningTrails.get(decisionId)
  if (!trail) {
    trail = {
      decisionId,
      createdAt: Date.now(),
      nodes: [],
      edges: [],
      context: {},
    }
    reasoningTrails.set(decisionId, trail)
  }

  // 添加推理步骤
  const addedNodes = []
  for (const step of steps) {
    const node = {
      id: step.id || generateNodeId(),
      type: step.type || REASONING_NODE_TYPES.EVALUATION,
      description: step.description || '',
      confidence: step.confidence !== undefined ? step.confidence : 0.8,
      timestamp: Date.now(),
      metadata: step.metadata || {},
    }
    trail.nodes.push(node)
    addedNodes.push(node)

    // 添加连接边
    if (step.fromNodeId && trail.nodes.length > 1) {
      trail.edges.push({
        from: step.fromNodeId,
        to: node.id,
        type: step.edgeType || 'leads_to',
      })
    } else if (trail.nodes.length > 1) {
      // 自动连接到上一个节点
      const prevNode = trail.nodes[trail.nodes.length - 2]
      trail.edges.push({
        from: prevNode.id,
        to: node.id,
        type: 'leads_to',
      })
    }
  }

  // 维护轨迹大小
  if (reasoningTrails.size > maxTrailSize) {
    const oldestKey = reasoningTrails.keys().next().value
    reasoningTrails.delete(oldestKey)
  }

  emitEvent('reasoning_traced', {
    decisionId,
    nodesAdded: addedNodes.length,
    totalNodes: trail.nodes.length,
  })

  return {
    success: true,
    decisionId,
    trail,
    nodesAdded: addedNodes.length,
  }
}

// ------------------------------------------------------------
// 获取推理轨迹
// ------------------------------------------------------------
export function getReasoningTrail(decisionId) {
  const trail = reasoningTrails.get(decisionId)
  if (!trail) {
    return { success: false, error: `未找到决策 ${decisionId} 的推理轨迹` }
  }
  return { success: true, trail }
}

// ------------------------------------------------------------
// 生成解释
// ------------------------------------------------------------
export function generateExplanation(decision, options = {}) {
  if (!initialized) {
    return { success: false, error: '可解释性层未初始化，请先调用 initExplainabilityLayer' }
  }

  // 修复：兼容 traceReasoning 返回值和直接传递决策对象两种方式
  let decisionObj = decision
  if (decision && decision.trail && decision.decisionId) {
    // 从 traceReasoning 返回值中提取 trail 对象
    decisionObj = decision.trail
  }

  // 修复：使用 decisionId 或 id 字段
  const decisionId = decisionObj?.decisionId || decisionObj?.id
  if (!decisionObj || !decisionId) {
    return { success: false, error: '必须提供有效的决策对象' }
  }

  // 修复：兼容字符串类型和对象选项
  let optionsObj = options
  if (typeof options === 'string') {
    optionsObj = { type: options }
  }

  const type = optionsObj.type || EXPLANATION_TYPES.DETAILED
  const includeReasoning = optionsObj.includeReasoning !== false
  const includeCounterfactual = optionsObj.includeCounterfactual || false
  const includeConfidence = optionsObj.includeConfidence !== false

  // 检查缓存
  const cacheKey = `${decisionId}_${type}_${includeReasoning}_${includeCounterfactual}_${includeConfidence}`
  if (explanationCache.has(cacheKey)) {
    const cached = explanationCache.get(cacheKey)
    if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return { ...cached, cached: true }
    }
  }

  const explanation = {
    id: generateExplanationId(),
    decisionId,
    type,
    description: `${type} 类型解释`,  // 修复：添加 description 字段
    timestamp: Date.now(),
    title: generateTitle(decisionObj),
    summary: generateSummary(decisionObj, type),
    details: generateDetails(decisionObj, type),
    rationale: decisionObj.rationale || '',
    confidence: includeConfidence ? calculateConfidence(decisionObj) : null,
    reasoningPath: includeReasoning ? buildReasoningPath(decisionObj) : null,
    counterfactuals: includeCounterfactual ? generateCounterfactuals(decisionObj) : null,
    recommendations: generateRecommendations(decisionObj),
  }

  // 存入缓存
  explanationCache.set(cacheKey, explanation)
  if (explanationCache.size > maxCacheSize) {
    const oldestKey = explanationCache.keys().next().value
    explanationCache.delete(oldestKey)
  }

  emitEvent('explanation_generated', {
    decisionId,
    type,
    confidence: explanation.confidence?.overall || null,
    hasReasoning: !!explanation.reasoningPath,
    hasCounterfactuals: !!explanation.counterfactuals,
  })

  return { ...explanation, cached: false }
}

// ------------------------------------------------------------
// 生成标题
// ------------------------------------------------------------
function generateTitle(decision) {
  const optionName = decision.chosenOptionName || '待定选项'
  const styleMap = { conservative: '保守型', aggressive: '激进型', balanced: '平衡型' }
  const styleName = styleMap[decision.style] || decision.style

  return `决策解释：选择「${optionName}」（${styleMap[styleName] || styleName}风格）`
}

// ------------------------------------------------------------
// 生成摘要
// ------------------------------------------------------------
function generateSummary(decision, type) {
  const parts = []

  if (decision.chosenOption) {
    parts.push(`本次决策选择了「${decision.chosenOptionName}」作为最终方案。`)
    parts.push(`综合加权得分为 ${(decision.weightedScore * 100).toFixed(1)} 分（满分 100）。`)
  } else {
    parts.push('本次决策未选择任何选项，所有选项均未达到最低阈值。')
  }

  if (type === EXPLANATION_TYPES.SIMPLE) {
    return parts.join(' ')
  }

  if (decision.ranking && decision.ranking.length > 1) {
    const runnerUp = decision.ranking[1]
    if (runnerUp) {
      parts.push(`第二名选项为「${runnerUp.optionName}」，得分 ${(runnerUp.weightedScore * 100).toFixed(1)} 分。`)
      const gap = ((decision.weightedScore - runnerUp.weightedScore) * 100).toFixed(1)
      if (parseFloat(gap) > 15) {
        parts.push(`领先幅度为 ${gap} 分，优势明显。`)
      } else if (parseFloat(gap) > 5) {
        parts.push(`领先幅度为 ${gap} 分，优势适中。`)
      } else {
        parts.push(`领先幅度仅 ${gap} 分，结果较为接近。`)
      }
    }
  }

  return parts.join(' ')
}

// ------------------------------------------------------------
// 生成详细内容
// ------------------------------------------------------------
function generateDetails(decision, type) {
  const details = {
    style: decision.style,
    styleDescription: getStyleDescription(decision.style),
    optionCount: decision.ranking?.length || 0,
    ranking: [],
  }

  if (decision.ranking) {
    details.ranking = decision.ranking.map((item, index) => ({
      rank: index + 1,
      optionId: item.optionId,
      optionName: item.optionName,
      weightedScore: item.weightedScore,
      dimensionScores: item.dimensionScores,
    }))
  }

  if (type === EXPLANATION_TYPES.TECHNICAL) {
    details.technicalMetrics = {
      scoreCalculation: '加权平均法',
      threshold: decision.passedThreshold ? '已通过' : '未通过',
      criteriaWeights: extractCriteriaWeights(decision),
    }
  }

  if (type === EXPLANATION_TYPES.COMPLIANCE) {
    details.complianceInfo = {
      decisionId: decision.id,
      timestamp: decision.timestamp,
      context: decision.context,
    }
  }

  return details
}

// ------------------------------------------------------------
// 获取风格描述
// ------------------------------------------------------------
function getStyleDescription(style) {
  const descriptions = {
    conservative: '保守型决策风格：优先考虑风险最低的选项',
    aggressive: '激进型决策风格：优先考虑收益最高的选项',
    balanced: '平衡型决策风格：在风险和收益之间寻求平衡',
  }
  return descriptions[style] || '未知决策风格'
}

// ------------------------------------------------------------
// 提取准则权重
// ------------------------------------------------------------
function extractCriteriaWeights(decision) {
  if (!decision.ranking || decision.ranking.length === 0) return {}
  const first = decision.ranking[0]
  if (!first.dimensionScores) return {}

  const weights = {}
  for (const [key, value] of Object.entries(first.dimensionScores)) {
    weights[key] = {
      name: value.name,
      weight: value.weight,
      type: value.type,
    }
  }
  return weights
}

// ------------------------------------------------------------
// 构建推理路径
// ------------------------------------------------------------
function buildReasoningPath(decision) {
  // 尝试获取已追踪的推理轨迹
  const trail = reasoningTrails.get(decision.id)
  if (trail && trail.nodes.length > 0) {
    return {
      source: 'tracked',
      nodes: trail.nodes.map(n => ({
        id: n.id,
        type: n.type,
        description: n.description,
        confidence: n.confidence,
      })),
      edges: trail.edges,
    }
  }

  // 如果没有追踪的轨迹，基于决策数据生成推断路径
  const inferredPath = inferReasoningPath(decision)
  return {
    source: 'inferred',
    nodes: inferredPath,
    edges: inferredPath.slice(1).map((node, i) => ({
      from: inferredPath[i].id,
      to: node.id,
      type: 'leads_to',
    })),
  }
}

// ------------------------------------------------------------
// 推断推理路径（基于决策数据）
// ------------------------------------------------------------
function inferReasoningPath(decision) {
  const nodes = []

  // 感知节点
  nodes.push({
    id: 'node_perception',
    type: REASONING_NODE_TYPES.PERCEPTION,
    description: `接收到 ${decision.ranking?.length || 0} 个候选选项`,
    confidence: 1.0,
  })

  // 评估节点
  if (decision.ranking && decision.ranking.length > 0) {
    const topDimensions = Object.entries(decision.ranking[0].dimensionScores || {})
      .sort((a, b) => b[1].contribution - a[1].contribution)
      .slice(0, 3)

    for (const [dimId, dimScore] of topDimensions) {
      nodes.push({
        id: `node_eval_${dimId}`,
        type: REASONING_NODE_TYPES.EVALUATION,
        description: `评估「${dimScore.name}」维度：得分 ${dimScore.normalizedScore?.toFixed(2) || 'N/A'}，贡献 ${dimScore.contribution?.toFixed(2) || 'N/A'}`,
        confidence: dimScore.normalizedScore || 0.5,
      })
    }
  }

  // 比较节点
  nodes.push({
    id: 'node_comparison',
    type: REASONING_NODE_TYPES.COMPARISON,
    description: `对 ${decision.ranking?.length || 0} 个选项进行加权比较`,
    confidence: 0.9,
  })

  // 决策节点
  nodes.push({
    id: 'node_decision',
    type: REASONING_NODE_TYPES.DECISION,
    description: `选择「${decision.chosenOptionName || '无'}」作为最终方案，加权得分 ${(decision.weightedScore * 100).toFixed(1)} 分`,
    confidence: decision.weightedScore,
  })

  // 辩护节点
  if (decision.rationale) {
    nodes.push({
      id: 'node_justification',
      type: REASONING_NODE_TYPES.JUSTIFICATION,
      description: decision.rationale,
      confidence: decision.weightedScore * 0.95,
    })
  }

  return nodes
}

// ------------------------------------------------------------
// 反事实分析
// ------------------------------------------------------------
export function counterfactualAnalysis(decision, options = {}) {
  if (!initialized) {
    return { success: false, error: '可解释性层未初始化，请先调用 initExplainabilityLayer' }
  }

  if (!decision || !decision.ranking || decision.ranking.length < 2) {
    return {
      success: true,
      counterfactuals: [],
      message: '需要至少 2 个选项才能进行反事实分析',
    }
  }

  const counterfactuals = []
  const topRanking = decision.ranking.slice(0, Math.min(3, decision.ranking.length))

  // 分析第二名如果被选中的影响
  if (topRanking.length >= 2) {
    const second = topRanking[1]
    const first = topRanking[0]
    const scoreGap = first.weightedScore - second.weightedScore

    counterfactuals.push({
      id: 'cf_second_place',
      description: `如果选择「${second.optionName}」而不是「${first.optionName}」`,
      scoreDifference: roundTo(scoreGap, 4),
      likelihoodOfDifferentOutcome: roundTo(Math.min(1, scoreGap * 2), 2),
      analysis: scoreGap > 0.15
        ? `由于得分差距较大 (${(scoreGap * 100).toFixed(1)} 分)，选择第二名可能会导致明显不同的结果。`
        : `由于得分差距较小 (${(scoreGap * 100).toFixed(1)} 分)，选择第二名可能不会产生显著差异。`,
    })
  }

  // 分析如果关键维度得分变化
  if (firstHasWeakDimension(topRanking[0])) {
    const weakest = getWeakestDimension(topRanking[0])
    counterfactuals.push({
      id: 'cf_weak_dimension',
      description: `如果加强「${weakest.name}」维度`,
      currentContribution: weakest.contribution,
      potentialImprovement: roundTo((1 - weakest.normalizedScore) * weakest.weight, 4),
      analysis: `加强「${weakest.name}」维度可能使总得分提升 ${((1 - weakest.normalizedScore) * weakest.weight * 100).toFixed(1)} 分。`,
    })
  }

  // 分析阈值边界情况
  if (!decision.passedThreshold && decision.weightedScore > 0.2) {
    counterfactuals.push({
      id: 'cf_threshold',
      description: '如果调整最低通过阈值',
      currentScore: decision.weightedScore,
      thresholdGap: roundTo(0.4 - decision.weightedScore, 4),
      analysis: `当前得分 ${(decision.weightedScore * 100).toFixed(1)} 分，若降低阈值 ${((0.4 - decision.weightedScore) * 100).toFixed(1)} 分即可通过。`,
    })
  }

  const result = {
    id: generateExplanationId(),
    decisionId: decision.id,
    timestamp: Date.now(),
    counterfactuals,
    summary: counterfactuals.length > 0
      ? `生成了 ${counterfactuals.length} 条反事实分析，帮助理解决策的边界条件。`
      : '反事实分析未发现显著的边界情况。',
  }

  emitEvent('counterfactual_analysis_completed', {
    decisionId: decision.id,
    counterfactualCount: counterfactuals.length,
  })

  return result
}

// ------------------------------------------------------------
// 检查是否有弱维度
// ------------------------------------------------------------
function firstHasWeakDimension(rankedOption) {
  if (!rankedOption || !rankedOption.dimensionScores) return false
  return Object.values(rankedOption.dimensionScores).some(d => d.normalizedScore < 0.4)
}

// ------------------------------------------------------------
// 获取最弱维度
// ------------------------------------------------------------
function getWeakestDimension(rankedOption) {
  const scores = Object.values(rankedOption.dimensionScores || {})
  return scores.sort((a, b) => a.normalizedScore - b.normalizedScore)[0] || {
    name: '未知维度',
    contribution: 0,
    normalizedScore: 0,
    weight: 0,
  }
}

// ------------------------------------------------------------
// 计算置信度
// ------------------------------------------------------------
function calculateConfidence(decision) {
  const components = {}

  // 数据充分性置信度
  if (decision.ranking && decision.ranking.length > 0) {
    const scoreVariance = calculateScoreVariance(decision.ranking.map(r => r.weightedScore))
    components.dataQuality = roundTo(1 - Math.min(1, scoreVariance * 4), 2)
  } else {
    components.dataQuality = 0.5
  }

  // 准则覆盖度置信度
  if (decision.ranking && decision.ranking.length > 0) {
    const dimensions = Object.keys(decision.ranking[0].dimensionScores || {})
    components.criteriaCoverage = roundTo(Math.min(1, dimensions.length / 5), 2)
  } else {
    components.criteriaCoverage = 0.3
  }

  // 决策边界清晰度假
  if (decision.ranking && decision.ranking.length >= 2) {
    const gap = decision.ranking[0].weightedScore - decision.ranking[1].weightedScore
    components.decisionMargin = roundTo(Math.min(1, gap * 5), 2)
  } else {
    components.decisionMargin = 0.5
  }

  // 计算总体置信度（加权平均）
  const weights = { dataQuality: 0.4, criteriaCoverage: 0.3, decisionMargin: 0.3 }
  const overall = (
    components.dataQuality * weights.dataQuality +
    components.criteriaCoverage * weights.criteriaCoverage +
    components.decisionMargin * weights.decisionMargin
  )

  // 存入历史
  confidenceHistory.push({
    decisionId: decision.id,
    timestamp: Date.now(),
    overall: roundTo(overall, 2),
    components,
  })

  if (confidenceHistory.length > 500) {
    confidenceHistory = confidenceHistory.slice(-500)
  }

  return {
    overall: roundTo(overall, 2),
    level: getConfidenceLevel(overall),
    components,
    interpretation: generateConfidenceInterpretation(overall, components),
  }
}

// ------------------------------------------------------------
// 计算分数方差
// ------------------------------------------------------------
function calculateScoreVariance(scores) {
  if (scores.length === 0) return 0
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length
  return variance
}

// ------------------------------------------------------------
// 获取置信度等级
// ------------------------------------------------------------
function getConfidenceLevel(score) {
  if (score >= 0.85) return { label: '高置信度', description: '决策依据充分，结果可靠' }
  if (score >= 0.7) return { label: '较高置信度', description: '决策较为可靠，存在少量不确定性' }
  if (score >= 0.5) return { label: '中等置信度', description: '决策存在一定不确定性，建议人工复核' }
  if (score >= 0.3) return { label: '较低置信度', description: '决策不确定性较高，建议补充信息' }
  return { label: '低置信度', description: '决策依据不足，不建议直接执行' }
}

// ------------------------------------------------------------
// 生成置信度解读
// ------------------------------------------------------------
function generateConfidenceInterpretation(overall, components) {
  const parts = []
  parts.push(`总体置信度为 ${(overall * 100).toFixed(0)}%。`)

  const lowestComponent = Object.entries(components)
    .sort((a, b) => a[1] - b[1])[0]

  if (lowestComponent) {
    const componentNames = {
      dataQuality: '数据质量',
      criteriaCoverage: '准则覆盖度',
      decisionMargin: '决策边际',
    }
    parts.push(`最低维度为「${componentNames[lowestComponent[0]]}」（${(lowestComponent[1] * 100).toFixed(0)}%），是置信度的主要限制因素。`)
  }

  return parts.join(' ')
}

// ------------------------------------------------------------
// 生成建议
// ------------------------------------------------------------
function generateRecommendations(decision) {
  const recommendations = []

  // 如果得分接近阈值
  if (decision.weightedScore < 0.5) {
    recommendations.push('决策得分较低，建议：')
    recommendations.push('• 收集更多相关数据')
    recommendations.push('• 重新评估决策准则和权重')
    recommendations.push('• 考虑引入专家评审')
  }

  // 如果选项之间差距很小
  if (decision.ranking && decision.ranking.length >= 2) {
    const gap = decision.ranking[0].weightedScore - decision.ranking[1].weightedScore
    if (gap < 0.05) {
      recommendations.push('• 前两名选项得分非常接近，建议进行敏感性分析或补充评估')
    }
  }

  // 如果有未通过的情况
  if (!decision.passedThreshold) {
    recommendations.push('• 所有选项均未达到最低阈值，建议重新生成选项或降低门槛')
  }

  if (recommendations.length === 0) {
    recommendations.push('决策过程健康，无需特别建议。')
  }

  return recommendations
}

// ------------------------------------------------------------
// 生成可解释性报告
// ------------------------------------------------------------
export function generateExplainabilityReport(decisionId, options = {}) {
  if (!initialized) {
    return { success: false, error: '可解释性层未初始化' }
  }

  // 从决策历史中查找决策
  // 此函数需要配合 decision-framework 使用
  const trail = reasoningTrails.get(decisionId)

  const report = {
    reportId: generateExplanationId(),
    decisionId,
    generatedAt: Date.now(),
    sections: [],
  }

  // 章节 1：决策概述
  report.sections.push({
    title: '决策概述',
    content: trail
      ? `决策 ID ${decisionId} 共有 ${trail.nodes.length} 个推理步骤和 ${trail.edges.length} 条因果关系。`
      : `决策 ID ${decisionId} 没有已追踪的推理轨迹。`,
  })

  // 章节 2：推理路径
  if (trail) {
    const nodeTypes = {}
    for (const node of trail.nodes) {
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1
    }
    report.sections.push({
      title: '推理路径统计',
      content: `共 ${trail.nodes.length} 个节点，分布如下：`,
      nodeTypeDistribution: nodeTypes,
    })
  }

  // 章节 3：置信度历史
  if (confidenceHistory.length > 0) {
    const recent = confidenceHistory.filter(c => c.decisionId === decisionId)
    if (recent.length > 0) {
      const avgConfidence = recent.reduce((sum, c) => sum + c.overall, 0) / recent.length
      report.sections.push({
        title: '置信度分析',
        content: `决策相关的置信度记录：平均 ${(avgConfidence * 100).toFixed(0)}%，共 ${recent.length} 条记录。`,
        averageConfidence: roundTo(avgConfidence, 2),
      })
    }
  }

  // 章节 4：缓存状态
  report.sections.push({
    title: '缓存状态',
    content: `当前解释缓存共 ${explanationCache.size} 条记录。`,
    cacheSize: explanationCache.size,
  })

  emitEvent('explainability_report_generated', {
    decisionId,
    reportSections: report.sections.length,
  })

  return report
}

// ============================================================
// 决策链追踪与回放 (Decision Chain Tracking & Replay)
// ============================================================

let decisionPatterns = new Map()    // 决策模式库

// ------------------------------------------------------------
// 记录完整决策链
// ------------------------------------------------------------
export function recordDecisionChain(decisionId, chainData) {
  if (!initialized) {
    return { success: false, error: '可解释性层未初始化' }
  }

  const chain = {
    decisionId,
    recordedAt: Date.now(),
    triggers: chainData.triggers || [],
    alternatives: chainData.alternatives || [],
    evaluations: chainData.evaluations || [],
    constraints: chainData.constraints || [],
    reasoning: chainData.reasoning || [],
    finalDecision: chainData.finalDecision || null,
    postAnalysis: chainData.postAnalysis || null,
    metadata: {
      totalSteps: 0,
      durationMs: chainData.durationMs || 0,
      style: chainData.style || 'balanced',
      context: chainData.context || {},
    },
  }

  chain.metadata.totalSteps = 
    chain.triggers.length + 
    chain.alternatives.length + 
    chain.evaluations.length + 
    chain.constraints.length + 
    chain.reasoning.length

  decisionChains.set(decisionId, chain)

  if (decisionChains.size > 300) {
    const oldestKey = decisionChains.keys().next().value
    decisionChains.delete(oldestKey)
  }

  emitEvent('decision_chain_recorded', {
    decisionId,
    totalSteps: chain.metadata.totalSteps,
    durationMs: chain.metadata.durationMs,
  })

  return {
    success: true,
    decisionId,
    chain,
    summary: {
      totalSteps: chain.metadata.totalSteps,
      phases: {
        triggers: chain.triggers.length,
        alternatives: chain.alternatives.length,
        evaluations: chain.evaluations.length,
        constraints: chain.constraints.length,
        reasoning: chain.reasoning.length,
      },
      durationMs: chain.metadata.durationMs,
    },
  }
}

// ------------------------------------------------------------
// 获取决策链
// ------------------------------------------------------------
export function getDecisionChain(decisionId) {
  const chain = decisionChains.get(decisionId)
  if (!chain) {
    return { success: false, error: `未找到决策 ${decisionId} 的决策链` }
  }
  return { success: true, chain }
}

// ------------------------------------------------------------
// 决策回放
// ------------------------------------------------------------
export function replayDecision(decisionId, options = {}) {
  if (!initialized) {
    return { success: false, error: '可解释性层未初始化' }
  }

  const chain = decisionChains.get(decisionId)
  if (!chain) {
    return { success: false, error: `未找到决策 ${decisionId} 的决策链` }
  }

  const { stepByStep = true, includeThoughts = true, speed = 1 } = options

  const replay = {
    decisionId,
    replayedAt: Date.now(),
    configuration: { stepByStep, includeThoughts, speed },
    phases: [],
    thoughtProcess: [],
    outcome: chain.finalDecision,
  }

  const phases = [
    { name: '触发阶段', data: chain.triggers, color: 'blue' },
    { name: '候选方案', data: chain.alternatives, color: 'green' },
    { name: '评估分析', data: chain.evaluations, color: 'yellow' },
    { name: '约束检查', data: chain.constraints, color: 'red' },
    { name: '推理决策', data: chain.reasoning, color: 'purple' },
  ]

  for (const phase of phases) {
    if (phase.data.length > 0) {
      const phaseReplay = {
        phase: phase.name,
        color: phase.color,
        steps: [],
      }

      for (let i = 0; i < phase.data.length; i++) {
        const item = phase.data[i]
        phaseReplay.steps.push({
          index: i + 1,
          content: typeof item === 'object' ? item : { description: item },
          thought: includeThoughts ? generateReplayThought(phase.name, item, i) : null,
          delay: stepByStep ? calculateDelay(speed, phase.name) : 0,
        })
      }

      replay.phases.push(phaseReplay)
    }
  }

  if (includeThoughts) {
    replay.thoughtProcess = generateThoughtProcess(chain)
  }

  replayHistory.push({
    decisionId,
    replayedAt: replay.replayedAt,
    configuration: options,
  })

  if (replayHistory.length > 100) {
    replayHistory = replayHistory.slice(-100)
  }

  emitEvent('decision_replayed', {
    decisionId,
    phasesCount: replay.phases.length,
    totalSteps: replay.phases.reduce((sum, p) => sum + p.steps.length, 0),
  })

  return {
    success: true,
    replay,
    summary: `决策 ${decisionId} 回放完成，共 ${replay.phases.length} 个阶段，${replay.phases.reduce((sum, p) => sum + p.steps.length, 0)} 个步骤`,
  }
}

function calculateDelay(speed, phase) {
  const baseDelay = {
    '触发阶段': 100,
    '候选方案': 150,
    '评估分析': 200,
    '约束检查': 100,
    '推理决策': 250,
  }
  return Math.round((baseDelay[phase] || 150) / speed)
}

function generateReplayThought(phase, item, index) {
  const thoughts = {
    '触发阶段': [
      '接收到新的输入信号',
      '分析触发事件的性质',
      '评估触发事件的紧急程度',
      '确定需要做出的决策类型',
    ],
    '候选方案': [
      '生成备选方案',
      '评估方案的可行性',
      '筛选明显不可行的方案',
      '考虑方案的多样性',
    ],
    '评估分析': [
      '开始多维度评估',
      '计算各维度得分',
      '加权汇总得分',
      '与历史数据对比',
    ],
    '约束检查': [
      '检查硬约束条件',
      '评估软约束影响',
      '计算约束违反惩罚',
      '确认方案合规性',
    ],
    '推理决策': [
      '综合分析各方面信息',
      '应用决策风格偏好',
      '进行最终方案选择',
      '生成决策理由说明',
    ],
  }
  const phaseThoughts = thoughts[phase] || ['继续分析...']
  return phaseThoughts[index % phaseThoughts.length]
}

function generateThoughtProcess(chain) {
  const process = []
  
  process.push({
    stage: '信息收集',
    description: `收集了 ${chain.triggers.length} 个触发因素`,
    confidence: 0.9,
  })
  
  process.push({
    stage: '方案生成',
    description: `生成了 ${chain.alternatives.length} 个候选方案`,
    confidence: 0.85,
  })
  
  process.push({
    stage: '评估分析',
    description: `进行了 ${chain.evaluations.length} 项评估`,
    confidence: 0.8,
  })
  
  if (chain.constraints.length > 0) {
    process.push({
      stage: '约束验证',
      description: `检查了 ${chain.constraints.length} 个约束条件`,
      confidence: 0.9,
    })
  }
  
  process.push({
    stage: '决策推理',
    description: `完成了 ${chain.reasoning.length} 步推理`,
    confidence: 0.85,
  })
  
  if (chain.finalDecision) {
    process.push({
      stage: '最终决策',
      description: `选择方案: ${chain.finalDecision.option || '待定'}`,
      confidence: chain.finalDecision.confidence || 0.8,
    })
  }
  
  return process
}

// ------------------------------------------------------------
// 决策模式识别
// ------------------------------------------------------------
export function analyzeDecisionPatterns(decisions = []) {
  if (!initialized) {
    return { success: false, error: '可解释性层未初始化' }
  }

  const patterns = []
  const styles = new Map()
  const choices = new Map()
  const scoreRanges = { conservative: [], aggressive: [], balanced: [] }

  for (const decision of decisions) {
    const style = decision.style || 'balanced'
    styles.set(style, (styles.get(style) || 0) + 1)

    if (decision.chosenOption) {
      choices.set(decision.chosenOption, (choices.get(decision.chosenOption) || 0) + 1)
    }

    if (decision.weightedScore !== undefined && scoreRanges[style]) {
      scoreRanges[style].push(decision.weightedScore)
    }
  }

  // 识别决策风格分布
  const styleDistribution = Array.from(styles.entries())
    .map(([style, count]) => ({
      style,
      count,
      percentage: Math.round((count / decisions.length) * 100),
    }))
    .sort((a, b) => b.count - a.count)

  patterns.push({
    type: 'style_distribution',
    description: '决策风格分布',
    data: styleDistribution,
    insight: generateStyleInsight(styleDistribution),
  })

  // 识别选项偏好
  const topChoices = Array.from(choices.entries())
    .map(([option, count]) => ({ option, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  patterns.push({
    type: 'choice_preference',
    description: '选项偏好分析',
    data: topChoices,
    insight: topChoices.length > 0
      ? `最常选择的选项是 "${topChoices[0].option}"，被选择 ${topChoices[0].count} 次`
      : '暂无明显的选项偏好',
  })

  // 识别分数范围
  for (const [style, scores] of Object.entries(scoreRanges)) {
    if (scores.length > 0) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      const min = Math.min(...scores)
      const max = Math.max(...scores)
      patterns.push({
        type: 'score_range',
        description: `${style} 风格分数范围`,
        data: {
          count: scores.length,
          average: roundTo(avg, 3),
          min: roundTo(min, 3),
          max: roundTo(max, 3),
          range: roundTo(max - min, 3),
        },
      })
    }
  }

  // 识别潜在偏见
  const biases = identifyBiases(decisions, styleDistribution, choices)
  if (biases.length > 0) {
    patterns.push({
      type: 'potential_biases',
      description: '潜在决策偏见',
      data: biases,
      insight: `识别出 ${biases.length} 种潜在偏见`,
    })
  }

  // 识别改进建议
  const suggestions = generateImprovementSuggestions(patterns)
  if (suggestions.length > 0) {
    patterns.push({
      type: 'improvement_suggestions',
      description: '改进建议',
      data: suggestions,
    })
  }

  emitEvent('decision_patterns_analyzed', {
    patternsFound: patterns.length,
    decisionsAnalyzed: decisions.length,
    biasesFound: biases.length,
  })

  decisionPatterns.set(Date.now(), {
    analyzedAt: Date.now(),
    patterns,
    decisionCount: decisions.length,
  })

  if (decisionPatterns.size > 50) {
    const oldestKey = decisionPatterns.keys().next().value
    decisionPatterns.delete(oldestKey)
  }

  return {
    success: true,
    patterns,
    summary: {
      decisionsAnalyzed: decisions.length,
      patternsFound: patterns.length,
      biasesFound: biases.length,
    },
    recommendations: patterns
      .filter(p => p.type === 'improvement_suggestions')
      .flatMap(p => p.data),
  }
}

function generateStyleInsight(distribution) {
  if (distribution.length === 0) return '无决策数据'
  const dominant = distribution[0]
  return `主要使用 ${dominant.style} 风格 (${dominant.percentage}%)，` +
    (dominant.percentage > 70 ? '决策风格较为固定，可考虑引入更多样化的决策方式' : '决策风格相对灵活')
}

function identifyBiases(decisions, styleDistribution, choices) {
  const biases = []

  // 检查单一风格偏见
  if (styleDistribution.length > 0 && styleDistribution[0].percentage > 80) {
    biases.push({
      name: '单一决策风格',
      severity: 'medium',
      description: `${styleDistribution[0].style} 风格占比超过 80%，可能导致决策视野狭窄`,
      recommendation: '尝试在适当场景下使用其他决策风格',
    })
  }

  // 检查选项偏见
  const totalChoices = Array.from(choices.values()).reduce((a, b) => a + b, 0)
  if (totalChoices > 0) {
    const maxChoice = Array.from(choices.entries()).sort((a, b) => b[1] - a[1])[0]
    if (maxChoice[1] / totalChoices > 0.7) {
      biases.push({
        name: '选项偏好偏见',
        severity: 'low',
        description: `"${maxChoice[0]}" 被选择比例超过 70%，可能存在过度偏好`,
        recommendation: '评估其他选项的潜力，避免习惯性选择',
      })
    }
  }

  // 检查分数分布偏见
  const scores = decisions.map(d => d.weightedScore).filter(s => s !== undefined)
  if (scores.length > 5) {
    const lowScores = scores.filter(s => s < 0.4).length
    const highScores = scores.filter(s => s > 0.7).length
    if (lowScores / scores.length > 0.5) {
      biases.push({
        name: '分数偏保守',
        severity: 'low',
        description: '超过 50% 的决策得分低于 0.4，可能过于保守',
        recommendation: '考虑适当放宽评分标准或引入更多选项',
      })
    }
    if (highScores / scores.length > 0.8) {
      biases.push({
        name: '分数偏乐观',
        severity: 'low',
        description: '超过 80% 的决策得分高于 0.7，可能过于乐观',
        recommendation: '增加评估的严格度，避免虚高评分',
      })
    }
  }

  return biases
}

function generateImprovementSuggestions(patterns) {
  const suggestions = []

  for (const pattern of patterns) {
    if (pattern.type === 'potential_biases') {
      for (const bias of pattern.data) {
        suggestions.push({
          title: `克服 ${bias.name}`,
          description: bias.recommendation,
          priority: bias.severity === 'high' ? 'high' : bias.severity === 'medium' ? 'medium' : 'low',
        })
      }
    }
  }

  // 通用建议
  if (patterns.find(p => p.type === 'style_distribution')?.data?.[0]?.percentage > 70) {
    suggestions.push({
      title: '多样化决策风格',
      description: '在保证决策质量的前提下，尝试使用不同的决策风格，以获得更全面的视角',
      priority: 'medium',
    })
  }

  if (suggestions.length === 0) {
    suggestions.push({
      title: '保持当前状态',
      description: '决策模式健康，无需特别调整',
      priority: 'low',
    })
  }

  return suggestions
}

// ------------------------------------------------------------
// 生成完整的决策透明度报告
// ------------------------------------------------------------
export function generateTransparencyReport(decisionId, options = {}) {
  if (!initialized) {
    return { success: false, error: '可解释性层未初始化' }
  }

  const { includeChain = true, includeReplay = true, includePatterns = true } = options

  const report = {
    reportId: `transparency_${Date.now()}`,
    decisionId,
    generatedAt: Date.now(),
    sections: [],
    overallScore: 0,
  }

  // 章节1：决策概要
  const chain = decisionChains.get(decisionId)
  report.sections.push({
    title: '决策概要',
    content: chain
      ? `决策共包含 ${chain.metadata.totalSteps} 个步骤，耗时 ${chain.metadata.durationMs}ms，使用 ${chain.metadata.style} 风格。`
      : `决策 ${decisionId} 没有详细的决策链记录。`,
    transparencyScore: chain ? Math.min(100, chain.metadata.totalSteps * 10) : 30,
  })

  // 章节2：决策链详情
  if (includeChain && chain) {
    report.sections.push({
      title: '决策链详情',
      phases: {
        triggers: chain.triggers.length,
        alternatives: chain.alternatives.length,
        evaluations: chain.evaluations.length,
        constraints: chain.constraints.length,
        reasoning: chain.reasoning.length,
      },
      transparencyScore: 20,
    })
  }

  // 章节3：回放能力
  if (includeReplay) {
    const replayAvailable = decisionChains.has(decisionId)
    report.sections.push({
      title: '回放能力',
      replayAvailable,
      replayHistoryCount: replayHistory.filter(h => h.decisionId === decisionId).length,
      transparencyScore: replayAvailable ? 20 : 0,
    })
  }

  // 章节4：模式分析
  if (includePatterns) {
    const patterns = decisionPatterns.get(decisionId)
    report.sections.push({
      title: '模式分析',
      patternsAvailable: !!patterns,
      patternsCount: patterns?.patterns.length || 0,
      transparencyScore: patterns ? 15 : 0,
    })
  }

  // 计算总分
  report.overallScore = Math.round(
    report.sections.reduce((sum, s) => sum + (s.transparencyScore || 0), 0)
  )

  report.interpretation = generateTransparencyInterpretation(report.overallScore)

  emitEvent('transparency_report_generated', {
    decisionId,
    overallScore: report.overallScore,
    sectionsCount: report.sections.length,
  })

  return report
}

function generateTransparencyInterpretation(score) {
  if (score >= 85) return { level: '优秀', description: '决策过程高度透明，所有步骤都有完整记录和可追溯性' }
  if (score >= 70) return { level: '良好', description: '决策过程较为透明，关键步骤有记录可查' }
  if (score >= 50) return { level: '中等', description: '决策过程有一定透明度，部分步骤缺乏详细记录' }
  if (score >= 30) return { level: '较低', description: '决策过程透明度不足，需要加强记录和追踪' }
  return { level: '极低', description: '决策过程几乎不透明，建议立即改进记录机制' }
}

// ------------------------------------------------------------
// 工具函数
// ------------------------------------------------------------

let explanationCounter = 0
function generateExplanationId() {
  explanationCounter += 1
  return `exp_${Date.now()}_${explanationCounter}`
}

let nodeCounter = 0
function generateNodeId() {
  nodeCounter += 1
  return `node_${Date.now()}_${nodeCounter}`
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}