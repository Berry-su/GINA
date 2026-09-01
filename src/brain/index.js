/**
 * src/brain/index.js - Gina 大脑统一入口
 * 
 * 整合三大核心系统的门面文件:
 * 1. 决策系统 (decision-framework.js) - 多准则决策分析
 * 2. 进化系统 (self-evolution.js) - 自我进化与能力图谱
 * 3. 可解释性系统 (explainability-layer.js) - 决策透明度与可追溯
 * 
 * 设计原则:
 * - 单一入口: 所有核心功能从此文件导出
 * - 模块化: 保留原模块独立性，不破坏现有引用
 * - 集成化: 提供跨系统协同的管道函数
 */

// ========== 决策系统 (Decision Framework) ==========
import {
  initDecisionFramework,
  resetDecisionFramework,
  defineCriteria,
  evaluateDecision,
  getDecisionHistory,
  paretoAnalysis,
  constraintSatisfaction,
  sensitivityAnalysis,
  analyzeDecisionPath,
} from '../decision/decision-framework.js'

// ========== 进化系统 (Self Evolution) ==========
import {
  getSelfEvolutionState,
  getSelfEvolutionSnapshot,
  resetSelfEvolutionState,
  isSelfEvolutionMemory,
  recordSelfEvolutionFromMemories,
  formatSelfEvolutionForPrompt,
  getCapabilityGraph,
  updateCapability,
  getCapabilitySnapshot,
  getEvolutionPath,
  planEvolutionPath,
  getLearningGoals,
  setLearningGoal,
  updateLearningGoalProgress,
  getActiveLearningGoals,
  getLearningProgressReport,
} from '../memory/self-evolution.js'

// ========== 可解释性系统 (Explainability Layer) ==========
import {
  initExplainabilityLayer,
  resetExplainabilityLayer,
  traceReasoning,
  getReasoningTrail,
  generateExplanation,
  counterfactualAnalysis,
  generateExplainabilityReport,
  recordDecisionChain,
  getDecisionChain,
  replayDecision,
  analyzeDecisionPatterns,
  generateTransparencyReport,
} from '../decision/explainability-layer.js'

// ========== CATS-Net 认知内核（迁移自新 Gina，纯 ESM 无原生依赖） ==========
// C-2.7 阶段二：改走 @berrysu/gina-core/cats_net 内核真理源（ADR-001）
import { CatsNet } from '@berrysu/gina-core/cats_net'

// ========== 金融大脑（分析师团队 + 数据采集引擎 + 真实数据源，迁移自新 Gina） ==========
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../paths.js'
import { createSharedBrain, createAnalystTeam, Integrator } from '../analysts/index.js'
import { DataEngine, AnalysisPipeline, SnapshotBuilder, createMockNewsSources, MockQuoteSource } from '../finance-data-engine/index.js'

// ========== 重新导出 ==========
export {
  // 决策系统
  initDecisionFramework,
  resetDecisionFramework,
  defineCriteria,
  evaluateDecision,
  getDecisionHistory,
  paretoAnalysis,
  constraintSatisfaction,
  sensitivityAnalysis,
  analyzeDecisionPath,
  // 进化系统
  getSelfEvolutionState,
  getSelfEvolutionSnapshot,
  resetSelfEvolutionState,
  isSelfEvolutionMemory,
  recordSelfEvolutionFromMemories,
  formatSelfEvolutionForPrompt,
  getCapabilityGraph,
  updateCapability,
  getCapabilitySnapshot,
  getEvolutionPath,
  planEvolutionPath,
  getLearningGoals,
  setLearningGoal,
  updateLearningGoalProgress,
  getActiveLearningGoals,
  getLearningProgressReport,
  // 可解释性系统
  initExplainabilityLayer,
  resetExplainabilityLayer,
  traceReasoning,
  getReasoningTrail,
  generateExplanation,
  counterfactualAnalysis,
  generateExplainabilityReport,
  recordDecisionChain,
  getDecisionChain,
  replayDecision,
  analyzeDecisionPatterns,
  generateTransparencyReport,
}

// ========== CATS-Net 认知内核（单例） ==========

let _catsNet = null
let _sharedBrain = null
let _analystTeam = null
let _financeEngine = null

/** 初始化（或复用）CATS-Net 抽象空间内核，并加载知识快照（路径取 paths.dataDir，兼容打包后 GINA_USER_DIR）。 */
export function initCatsNet(config = {}) {
  if (!_catsNet) {
    _catsNet = new CatsNet(config)
    const snapshot = join(paths.dataDir, 'gina-knowledge-brain.json')
    if (existsSync(snapshot)) {
      try { _catsNet.load(snapshot) } catch { /* 忽略损坏快照 */ }
    }
  }
  return _catsNet
}

/** 获取 CATS-Net 内核单例。 */
export function getCatsNet() {
  return _catsNet
}

/** 获取（并惰性构建）共享大脑：CatsNet + MemoryHub + 知识/环境顾问。 */
export function getSharedBrain() {
  if (!_sharedBrain) {
    _sharedBrain = createSharedBrain({ brain: initCatsNet() })
  }
  return _sharedBrain
}

/** 初始化（或复用）分析师团队（5 分析师 + 风控官，共享同一个大脑）。 */
export function initAnalystTeam(config = {}) {
  if (!_analystTeam) {
    _analystTeam = createAnalystTeam(config.brain ?? getSharedBrain())
  }
  return _analystTeam
}

/** 获取分析师团队单例。 */
export function getAnalystTeam() {
  return _analystTeam
}

/**
 * 初始化（或复用）金融数据引擎 + 分析流水线。
 * 默认使用离线 Mock 数据源以保证无密钥也能启动；真实 Tushare/Yahoo/RSS 源待配置密钥后替换。
 */
export function initFinanceEngine(config = {}) {
  if (!_financeEngine) {
    const team = config.team ?? initAnalystTeam()
    const integrator = config.integrator ?? new Integrator({ team })
    const dataEngine = config.dataEngine ?? new DataEngine({
      newsSources: createMockNewsSources({ count: 2 }),
      quoteSources: [new MockQuoteSource()],
    })
    const pipeline = config.pipeline ?? new AnalysisPipeline({
      dataEngine,
      snapshotBuilder: config.snapshotBuilder ?? new SnapshotBuilder({ maxSymbols: config.maxSymbols ?? 20 }),
      integrator,
      onReport: config.onReport ?? null,
      onError: config.onError ?? null,
    })
    _financeEngine = { team, integrator, dataEngine, pipeline }
  }
  return _financeEngine
}

/** 获取金融引擎单例（含 team / integrator / dataEngine / pipeline）。 */
export function getFinanceEngine() {
  return _financeEngine
}

// ========== 统一初始化 ==========

/**
 * 初始化 Gina 大脑三大系统
 * @param {Object} config - 配置对象
 * @param {Object} config.decision - 决策系统配置
 * @param {Object} config.explainability - 可解释性配置
 * @returns {Object} 初始化状态
 */
export function initGinaBrain(config = {}) {
  const results = {
    success: true,
    decision: null,
    explainability: null,
    evolution: null,
    catsNet: null,
    analystTeam: null,
    financeEngine: null,
    initializedAt: Date.now(),
  }

  // 1. 初始化决策系统
  results.decision = initDecisionFramework(config.decision || {})
  if (!results.decision.success) {
    results.success = false
    results.error = '决策系统初始化失败'
    console.error('[brain] 决策引擎初始化失败:', results.decision.error || '')
    return results
  }
  console.log(`[brain] 决策引擎(MCDA)初始化完成: 风格=${results.decision.style ?? '-'} 准则数=${results.decision.criteriaCount ?? 0}`)

  // 2. 初始化可解释性层
  results.explainability = initExplainabilityLayer(config.explainability || {})
  if (!results.explainability.success) {
    results.success = false
    results.error = '可解释性层初始化失败'
    console.error('[brain] 可解释性层初始化失败')
    return results
  }
  console.log(`[brain] 可解释性层初始化完成: 追踪上限=${results.explainability.maxTrailSize ?? '-'} 缓存上限=${results.explainability.maxCacheSize ?? '-'}`)

  // 3. 初始化进化系统（加载能力图谱，容错处理）
  try {
    const capabilityGraph = getCapabilityGraph()
    results.evolution = {
      success: true,
      capabilitiesCount: Object.keys(capabilityGraph.capabilities || {}).length,
      initialized: true,
    }
    console.log(`[brain] 进化系统初始化完成: 能力图谱节点=${results.evolution.capabilitiesCount}`)
  } catch (err) {
    // 即使数据库不可写，进化系统仍可在内存中工作
    results.evolution = {
      success: true,
      capabilitiesCount: 0,
      initialized: true,
      degraded: true,
      error: err.message,
    }
    console.warn(`[brain] 进化系统降级初始化(数据库不可写): ${err.message}`)
  }

  // 4. 初始化认知内核 CATS-Net（加载知识快照，若有）
  try {
    initCatsNet()
    results.catsNet = { success: true, initialized: true }
    console.log('[brain] CATS-Net 认知内核初始化完成（已加载知识快照，若有）')
  } catch (err) {
    results.catsNet = { success: false, degraded: true, error: err.message }
    console.warn(`[brain] CATS-Net 初始化失败(降级): ${err.message}`)
  }

  // 5. 分析师团队 + 6. 金融数据引擎 —— 懒加载（按需构建，不常驻）
  // 交易/金融能力不是常驻：首次交易 API 访问时由 getAnalystTeam()/getFinanceEngine()
  // 惰性构建（两者内部已有单例懒加载），省下常驻内存。
  results.analystTeam = { success: true, lazy: true, size: 0 }
  results.financeEngine = { success: true, lazy: true, initialized: false, newsSources: 0, quoteSources: 0 }
  console.log('[brain] 分析师团队 + 金融数据引擎（懒加载：首次交易请求时构建）')

  console.log('[brain] 大脑初始化流程结束（决策/可解释/进化/认知/分析师/金融引擎）')
  return results
}

// ========== 集成管道函数 ==========

/**
 * 集成决策管道：评估决策 → 记录决策链 → 更新能力 → 生成报告
 * 
 * 这是三大系统协同工作的核心函数:
 * 1. 使用决策系统评估选项
 * 2. 使用可解释性层记录决策过程
 * 3. 使用进化系统更新相关能力
 * 4. 生成包含里程碑的完整报告
 * 
 * @param {Array} options - 候选选项列表
 * @param {Object} context - 决策上下文
 * @param {string} context.domainId - 领域ID
 * @param {string} context.subCapabilityId - 子能力ID
 * @param {Array} context.steps - 决策步骤
 * @param {boolean} context.generateReport - 是否生成完整报告
 * @returns {Object} 集成决策结果
 */
export function makeIntegratedDecision(options, context = {}) {
  const decisionId = `integrated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const result = {
    decisionId,
    decision: null,
    chain: null,
    evolution: null,
    report: null,
    milestones: null,
    timestamp: Date.now(),
  }

  // Step 1: 评估决策
  result.decision = evaluateDecision(options, context)

  // Step 2: 记录决策链
  if (result.decision && result.decision.chosenOption) {
    const chainData = {
      triggers: context.triggers || ['integrated_decision'],
      alternatives: options.map(o => o.id || o.name),
      evaluations: context.evaluations || [],
      constraints: context.constraints || [],
      reasoning: context.reasoning || ['自动评估'],
      finalDecision: {
        option: result.decision.chosenOption,
        optionName: result.decision.chosenOptionName || result.decision.chosenOption,
        confidence: result.decision.weightedScore || 0.5,
      },
      durationMs: Date.now() - (context.startTime || Date.now()),
      style: result.decision.style || 'balanced',
      steps: context.steps || [],
    }

    result.chain = recordDecisionChain(decisionId, chainData)
    if (!result.chain?.success) {
      // 决策链记录失败不阻塞主流程
      result.chain = { success: false, degraded: true }
    }
  }

  // Step 3: 更新能力
  if (context.domainId && context.subCapabilityId) {
    try {
      const experience = Math.round((result.decision?.weightedScore || result.decision?.confidence || 0.5) * 10)
      result.evolution = updateCapability(context.domainId, context.subCapabilityId, experience)
    } catch (err) {
      result.evolution = { success: false, error: err.message, degraded: true }
    }
  }

  // Step 4: 获取当前进化里程碑
  const pathResult = planEvolutionPath()
  result.milestones = {
    currentStage: pathResult.currentStage,
    totalMilestones: pathResult.milestones?.length || 0,
    highPriority: pathResult.milestones?.filter(m => m.priority === 'high').length || 0,
    nextActions: pathResult.recommendedActions?.slice(0, 3) || [],
  }

  // Step 5: 生成完整报告（可选）
  if (context.generateReport) {
    result.report = generateBrainReport(decisionId, result.decision)
    result.report.milestones = pathResult.milestones?.slice(0, 5) || []
    result.report.evolution = {
      currentStage: pathResult.currentStage,
      planProgress: pathResult.totalProgress,
      capabilitySnapshot: getCapabilitySnapshot(),
    }
  }

  return result
}

/**
 * 完整分析管道：多目标分析 + 约束检查 + 敏感性分析 + 决策路径
 * 
 * @param {Array} options - 候选选项
 * @param {Object} config - 分析配置
 * @param {Array} config.constraints - 约束条件列表
 * @param {Array} config.steps - 决策步骤列表
 * @param {number} config.sensitivityIterations - 敏感性分析迭代次数
 * @returns {Object} 完整分析结果
 */
export function fullAnalysisPipeline(options, config = {}) {
  const results = {
    pareto: null,
    constraints: null,
    sensitivity: null,
    path: null,
    timestamp: Date.now(),
  }

  // 1. Pareto 分析
  results.pareto = paretoAnalysis(options, config.context)

  // 2. 约束满足检查
  if (config.constraints && config.constraints.length > 0) {
    results.constraints = constraintSatisfaction(options, config.constraints, config.context)
  }

  // 3. 敏感性分析
  results.sensitivity = sensitivityAnalysis(options, {
    iterations: config.sensitivityIterations || 5,
    ...config.sensitivityConfig,
  })

  // 4. 决策路径分析
  if (config.steps && config.steps.length > 0) {
    results.path = analyzeDecisionPath(config.steps, config.context)
  }

  return results
}

/**
 * 生成完整决策报告（决策结果 + 解释 + 透明度）
 * 
 * @param {string} decisionId - 决策ID
 * @param {Object} decisionResult - 决策结果
 * @returns {Object} 完整报告
 */
export function generateBrainReport(decisionId, decisionResult) {
  const report = {
    decisionId,
    timestamp: Date.now(),
    decision: decisionResult,
    explanation: null,
    transparency: null,
    evolution: null,
  }

  // 1. 获取决策链
  const chain = getDecisionChain(decisionId)
  if (chain) {
    report.chain = chain
  }

  // 2. 生成解释
  report.explanation = generateExplanation(decisionResult || { id: decisionId }, {
    includeReasoning: true,
    includeAlternatives: true,
  })

  // 3. 生成透明度报告
  report.transparency = generateTransparencyReport(decisionId)

  // 4. 获取进化状态
  report.evolution = getCapabilitySnapshot()

  return report
}

// ========== 便捷初始化快捷方式 ==========

/**
 * 快速启动 Gina 大脑（使用默认配置）
 * @returns {Object} 初始化状态
 */
export function quickStartBrain() {
  return initGinaBrain({
    decision: { style: 'balanced' },
    explainability: { enableTracing: true },
  })
}

/**
 * 获取大脑健康状态
 * @returns {Object} 健康状态
 */
export function getBrainHealth() {
  const health = {
    status: 'healthy',
    components: {},
    timestamp: Date.now(),
  }

  // 检查决策系统
  const decisionHistory = getDecisionHistory()
  health.components.decision = {
    status: 'active',
    historyCount: Array.isArray(decisionHistory) ? decisionHistory.length : 0,
  }

  // 检查进化系统
  const snapshot = getCapabilitySnapshot()
  health.components.evolution = {
    status: 'active',
    overallLevel: snapshot?.overallLevel || 1,
    domainsCount: snapshot?.domains ? Object.keys(snapshot.domains).length : 0,
  }

  // 检查可解释性层
  const capabilities = getCapabilityGraph()
  health.components.explainability = {
    status: 'active',
    capabilitiesTracked: Object.keys(capabilities?.capabilities || {}).length,
  }

  // 检查认知内核 CATS-Net
  const catsNet = getCatsNet()
  health.components.catsNet = {
    status: catsNet ? 'active' : 'inactive',
    hasAbstractSpace: !!catsNet,
  }

  // 检查分析师团队
  const team = getAnalystTeam()
  health.components.analystTeam = {
    status: team ? 'active' : 'inactive',
    size: team?.size ?? 0,
  }

  // 检查金融数据引擎
  const financeEngine = getFinanceEngine()
  health.components.financeEngine = {
    status: financeEngine ? 'active' : 'inactive',
    newsSources: financeEngine?.dataEngine?.newsSources?.length ?? 0,
    quoteSources: financeEngine?.dataEngine?.quoteSources?.length ?? 0,
  }

  return health
}

export default {
  initGinaBrain,
  quickStartBrain,
  getBrainHealth,
  makeIntegratedDecision,
  fullAnalysisPipeline,
  generateBrainReport,
  // 认知内核 / 分析师 / 金融引擎
  initCatsNet,
  getCatsNet,
  getSharedBrain,
  initAnalystTeam,
  getAnalystTeam,
  initFinanceEngine,
  getFinanceEngine,
  // 决策系统
  initDecisionFramework,
  resetDecisionFramework,
  defineCriteria,
  evaluateDecision,
  getDecisionHistory,
  paretoAnalysis,
  constraintSatisfaction,
  sensitivityAnalysis,
  analyzeDecisionPath,
  // 进化系统
  getSelfEvolutionState,
  getSelfEvolutionSnapshot,
  resetSelfEvolutionState,
  isSelfEvolutionMemory,
  recordSelfEvolutionFromMemories,
  formatSelfEvolutionForPrompt,
  getCapabilityGraph,
  updateCapability,
  getCapabilitySnapshot,
  getEvolutionPath,
  planEvolutionPath,
  getLearningGoals,
  setLearningGoal,
  updateLearningGoalProgress,
  getActiveLearningGoals,
  getLearningProgressReport,
  // 可解释性系统
  initExplainabilityLayer,
  resetExplainabilityLayer,
  traceReasoning,
  getReasoningTrail,
  generateExplanation,
  counterfactualAnalysis,
  generateExplainabilityReport,
  recordDecisionChain,
  getDecisionChain,
  replayDecision,
  analyzeDecisionPatterns,
  generateTransparencyReport,
}
