import { emitEvent } from '../events.js'

// ============================================================
// 道德门禁 - 伦理合规检查模块 (Ethics Gate Module)
// ============================================================

// 默认道德原则
const DEFAULT_PRINCIPLES = [
  {
    id: 'do_no_harm',
    name: '不伤害原则',
    description: '避免对用户、他人或系统造成物理、心理或财务上的伤害',
    severity: 'critical',
    enabled: true,
  },
  {
    id: 'respect_autonomy',
    name: '尊重自主性',
    description: '尊重用户的自主决策权，不进行强制或误导性操作',
    severity: 'high',
    enabled: true,
  },
  {
    id: 'protect_privacy',
    name: '隐私保护',
    description: '保护用户隐私和敏感信息，未经授权不得访问或泄露',
    severity: 'critical',
    enabled: true,
  },
  {
    id: 'fairness',
    name: '公平公正',
    description: '避免基于种族、性别、年龄等因素的歧视性行为',
    severity: 'high',
    enabled: true,
  },
  {
    id: 'transparency',
    name: '透明度',
    description: '确保决策和行为可被用户理解和审查',
    severity: 'medium',
    enabled: true,
  },
  {
    id: 'compliance',
    name: '合规性',
    description: '遵守适用的法律法规和组织政策',
    severity: 'high',
    enabled: true,
  },
]

// 默认禁止行为清单
const DEFAULT_PROHIBITED_ACTIONS = [
  {
    id: 'unauthorized_data_access',
    description: '未经授权访问用户数据',
    riskLevel: 'critical',
    patterns: ['access_user_data', 'read_private_files', 'query_personal_info', '获取用户', '访问用户', '读取私人', '查询个人', '隐私数据', '用户数据'],
  },
  {
    id: 'harmful_command_execution',
    description: '执行可能造成系统损坏的命令',
    riskLevel: 'critical',
    patterns: ['rm_rf', 'format_drive', 'shutdown_system', 'drop_database', '删除系统', '格式化硬盘', '关闭系统', '删除数据库', '破坏系统'],
  },
  {
    id: 'privacy_violation',
    description: '侵犯用户隐私的行为',
    riskLevel: 'high',
    patterns: ['expose_password', 'leak_token', 'reveal_credentials', '泄露密码', '泄露凭证', '暴露密码', '泄露令牌', '隐私泄露'],
  },
  {
    id: 'deception',
    description: '对用户进行欺骗性操作',
    riskLevel: 'high',
    patterns: ['fake_result', 'misleading_info', 'hide_operation', '伪造结果', '误导信息', '隐藏操作', '欺骗用户'],
  },
  {
    id: 'unauthorized_network',
    description: '未经授权进行网络操作',
    riskLevel: 'medium',
    patterns: ['exfiltrate_data', 'make_outbound_request', 'connect_unknown_server', '数据外泄', '外联请求', '连接未知', '未经授权网络'],
  },
]

// 风险等级定义
const RISK_LEVELS = {
  critical: { label: '严重', score: 1.0, blockAction: true },
  high: { label: '高', score: 0.75, blockAction: true },
  medium: { label: '中', score: 0.5, blockAction: false },
  low: { label: '低', score: 0.25, blockAction: false },
}

// 伤害类型
const HARM_TYPES = {
  physical: { label: '物理伤害', weight: 1.0 },
  financial: { label: '财务伤害', weight: 0.9 },
  psychological: { label: '心理伤害', weight: 0.7 },
  privacy: { label: '隐私侵犯', weight: 0.85 },
  reputational: { label: '声誉损害', weight: 0.6 },
  systemic: { label: '系统损害', weight: 0.8 },
}

// 模块状态
let initialized = false
let principles = []
let prohibitedActions = []
let violationLog = []
let maxViolationLogSize = 500
let severityThreshold = 'medium'

// ------------------------------------------------------------
// 初始化道德门禁
// ------------------------------------------------------------
export function initEthicsGate(config = {}) {
  if (initialized) return { success: true, alreadyInitialized: true }

  principles = config.principles || [...DEFAULT_PRINCIPLES]
  prohibitedActions = config.prohibitedActions || [...DEFAULT_PROHIBITED_ACTIONS]
  maxViolationLogSize = config.maxViolationLogSize || 500
  severityThreshold = config.severityThreshold || 'medium'

  initialized = true

  emitEvent('ethics_gate_initialized', {
    principlesCount: principles.length,
    prohibitedActionsCount: prohibitedActions.length,
    severityThreshold,
  })

  return {
    success: true,
    principlesCount: principles.length,
    prohibitedActionsCount: prohibitedActions.length,
  }
}

// ------------------------------------------------------------
// 检查道德合规性
// ------------------------------------------------------------
export function checkEthics(action, context = {}) {
  if (!initialized) {
    return { success: false, error: '道德门禁未初始化，请先调用 initEthicsGate' }
  }

  const violations = []
  const actionId = action.id || action.type || action.name || 'unknown'
  const actionName = action.name || action.description || actionId

  // 检查禁止行为清单
  const prohibitedMatch = checkProhibitedActions(action)
  if (prohibitedMatch.length > 0) {
    violations.push(...prohibitedMatch)
  }

  // 检查道德原则
  for (const principle of principles) {
    if (!principle.enabled) continue

    const checkResult = evaluatePrinciple(principle, action, context)
    if (checkResult.violated) {
      violations.push({
        principleId: principle.id,
        principleName: principle.name,
        severity: principle.severity,
        description: checkResult.reason,
        details: checkResult.details,
      })
    }
  }

  // 计算总体风险评分
  const riskScore = calculateRiskScore(violations)

  // 判定是否允许
  const shouldBlock = violations.some(v => {
    const level = RISK_LEVELS[v.severity]
    return level && level.blockAction
  })

  const result = {
    id: generateEthicsId(),
    timestamp: Date.now(),
    actionId,
    actionName,
    action,
    passed: !shouldBlock,
    riskScore,
    violations,
    severity: determineOverallSeverity(violations),
    recommendation: generateRecommendation(violations, riskScore),
  }

  // 记录违规日志
  if (violations.length > 0) {
    logViolation(result)
  }

  emitEvent('ethics_check_completed', {
    actionId,
    passed: result.passed,
    riskScore,
    violationCount: violations.length,
    severity: result.severity,
  })

  return result
}

// ------------------------------------------------------------
// 检查禁止行为
// ------------------------------------------------------------
function checkProhibitedActions(action) {
  const violations = []
  const actionStr = JSON.stringify(action).toLowerCase()

  for (const prohibited of prohibitedActions) {
    for (const pattern of prohibited.patterns) {
      if (actionStr.includes(pattern.toLowerCase())) {
        violations.push({
          type: 'prohibited_action',
          prohibitedId: prohibited.id,
          prohibitedDescription: prohibited.description,
          severity: prohibited.riskLevel,
          pattern,
          reason: `行为匹配了禁止模式 "${pattern}"`,
        })
        break
      }
    }
  }

  return violations
}

// ------------------------------------------------------------
// 评估单个道德原则
// ------------------------------------------------------------
function evaluatePrinciple(principle, action, context) {
  // 基础检查逻辑，基于原则 ID 进行不同的评估
  switch (principle.id) {
    case 'do_no_harm':
      return checkHarmRiskInternal(principle, action, context)
    case 'protect_privacy':
      return checkPrivacyRisk(principle, action, context)
    case 'fairness':
      return checkFairnessRisk(principle, action, context)
    case 'compliance':
      return checkComplianceRisk(principle, action, context)
    default:
      return { violated: false }
  }
}

/**
 * 内部伤害风险检查（用于原则评估）
 */
function checkHarmRiskInternal(principle, action, context) {
  const actionStr = JSON.stringify(action).toLowerCase()
  const harmKeywords = ['damage', 'destroy', 'delete', 'hack', 'attack', 'exploit', 'steal', 'harm', 'hurt', 'destroy', '伤害', '破坏', '删除', '攻击', '窃取']
  
  for (const keyword of harmKeywords) {
    if (actionStr.includes(keyword)) {
      return {
        violated: true,
        reason: `操作涉及潜在伤害行为 (${keyword})`,
        severity: 'high',
        details: { principleId: principle.id, keyword },
      }
    }
  }
  
  return { violated: false }
}

// ------------------------------------------------------------
// 检查隐私风险
// ------------------------------------------------------------
function checkPrivacyRisk(principle, action, context) {
  const sensitiveKeywords = ['password', 'token', 'secret', 'key', 'credential', 'private', 'confidential']
  const actionStr = JSON.stringify(action).toLowerCase()

  for (const keyword of sensitiveKeywords) {
    if (actionStr.includes(keyword)) {
      return {
        violated: true,
        reason: `操作涉及敏感信息关键词 "${keyword}"，可能侵犯隐私`,
        details: { keyword, action },
      }
    }
  }

  return { violated: false }
}

// ------------------------------------------------------------
// 检查公平性风险
// ------------------------------------------------------------
function checkFairnessRisk(principle, action, context) {
  const protectedAttributes = ['race', 'gender', 'age', 'religion', 'nationality', 'disability']
  const actionStr = JSON.stringify(action).toLowerCase()

  for (const attr of protectedAttributes) {
    if (actionStr.includes(attr)) {
      return {
        violated: true,
        reason: `操作涉及受保护属性 "${attr}"，可能构成歧视`,
        details: { attribute: attr, action },
      }
    }
  }

  return { violated: false }
}

// ------------------------------------------------------------
// 检查合规风险
// ------------------------------------------------------------
function checkComplianceRisk(principle, action, context) {
  // 合规检查基于上下文和已知规则
  if (action?.requires && action.requires.legalReview === true) {
    return {
      violated: true,
      reason: '操作需要法务审查但未通过',
      details: { action },
    }
  }

  return { violated: false }
}

// ------------------------------------------------------------
// 伤害风险评估
// ------------------------------------------------------------
export function assessHarmRisk(action, context = {}) {
  if (!initialized) {
    return { success: false, error: '道德门禁未初始化，请先调用 initEthicsGate' }
  }

  const harms = []
  const actionStr = JSON.stringify(action).toLowerCase()

  // 评估各类伤害风险
  for (const [type, config] of Object.entries(HARM_TYPES)) {
    const indicators = getHarmIndicators(type)
    let likelihood = 0

    for (const indicator of indicators) {
      const keyword = typeof indicator === 'string' ? indicator : indicator.keyword
      const defaultRisk = typeof indicator === 'object' ? indicator.defaultRisk : 0.5
      
      if (keyword && actionStr.includes(keyword.toLowerCase())) {
        likelihood = Math.max(likelihood, defaultRisk || 0.5)
      }
    }

    if (likelihood > 0) {
      const severity = likelihood * config.weight
      harms.push({
        type,
        label: config.label,
        likelihood: roundTo(likelihood, 2),
        severity: roundTo(severity, 2),
        indicators: indicators
          .map(i => typeof i === 'string' ? i : i.keyword)
          .filter(k => k && actionStr.includes(k.toLowerCase())),
      })
    }
  }

  // 计算总体伤害评分
  const totalSeverity = harms.reduce((sum, h) => sum + h.severity, 0)
  const maxSeverity = harms.length > 0 ? Math.max(...harms.map(h => h.severity)) : 0

  const result = {
    id: generateEthicsId(),
    timestamp: Date.now(),
    actionId: action.id || 'unknown',
    actionName: action.name || 'unknown',
    harms,
    totalHarmScore: roundTo(totalSeverity, 2),
    maxHarmSeverity: roundTo(maxSeverity, 2),
    riskLevel: determineRiskLevel(maxSeverity),
    requiresMitigation: maxSeverity >= 0.5,
    summary: generateHarmSummary(harms, totalSeverity),
  }

  emitEvent('harm_risk_assessed', {
    actionId: result.actionId,
    totalHarmScore: result.totalHarmScore,
    riskLevel: result.riskLevel,
    harmCount: harms.length,
  })

  return result
}

// ------------------------------------------------------------
// 获取各类伤害的指示词
// ------------------------------------------------------------
function getHarmIndicators(harmType) {
  const indicators = {
    physical: [
      { keyword: 'delete', defaultRisk: 0.3 },
      { keyword: 'format', defaultRisk: 0.8 },
      { keyword: 'shutdown', defaultRisk: 0.7 },
      { keyword: 'destroy', defaultRisk: 0.9 },
      { keyword: 'damage', defaultRisk: 0.6 },
    ],
    financial: [
      { keyword: 'payment', defaultRisk: 0.8 },
      { keyword: 'transfer', defaultRisk: 0.7 },
      { keyword: 'purchase', defaultRisk: 0.6 },
      { keyword: 'delete', defaultRisk: 0.5 },
      { keyword: 'money', defaultRisk: 0.7 },
    ],
    psychological: [
      { keyword: 'manipulate', defaultRisk: 0.7 },
      { keyword: 'deceive', defaultRisk: 0.8 },
      { keyword: 'pressure', defaultRisk: 0.5 },
      { keyword: 'confuse', defaultRisk: 0.4 },
    ],
    privacy: [
      { keyword: 'password', defaultRisk: 0.9 },
      { keyword: 'secret', defaultRisk: 0.8 },
      { keyword: 'credential', defaultRisk: 0.9 },
      { keyword: 'personal', defaultRisk: 0.5 },
      { keyword: 'confidential', defaultRisk: 0.8 },
    ],
    reputational: [
      { keyword: 'expose', defaultRisk: 0.6 },
      { keyword: 'leak', defaultRisk: 0.7 },
      { keyword: 'publish', defaultRisk: 0.5 },
      { keyword: 'reveal', defaultRisk: 0.5 },
    ],
    systemic: [
      { keyword: 'overload', defaultRisk: 0.7 },
      { keyword: 'crash', defaultRisk: 0.8 },
      { keyword: 'breach', defaultRisk: 0.9 },
      { keyword: 'exploit', defaultRisk: 0.9 },
    ],
  }
  return indicators[harmType] || []
}

// ------------------------------------------------------------
// 计算风险评分
// ------------------------------------------------------------
function calculateRiskScore(violations) {
  if (violations.length === 0) return 0
  const scores = violations.map(v => {
    const level = RISK_LEVELS[v.severity]
    return level ? level.score : 0.3
  })
  return roundTo(Math.max(...scores), 2)
}

// ------------------------------------------------------------
// 确定总体严重程度
// ------------------------------------------------------------
function determineOverallSeverity(violations) {
  if (violations.length === 0) return 'none'
  const severities = violations.map(v => v.severity)
  if (severities.includes('critical')) return 'critical'
  if (severities.includes('high')) return 'high'
  if (severities.includes('medium')) return 'medium'
  return 'low'
}

// ------------------------------------------------------------
// 确定风险等级
// ------------------------------------------------------------
function determineRiskLevel(severity) {
  if (severity >= 0.8) return 'critical'
  if (severity >= 0.6) return 'high'
  if (severity >= 0.4) return 'medium'
  if (severity >= 0.2) return 'low'
  return 'minimal'
}

// ------------------------------------------------------------
// 生成建议
// ------------------------------------------------------------
function generateRecommendation(violations, riskScore) {
  if (violations.length === 0) {
    return '操作符合所有道德原则，建议执行。'
  }

  const criticalCount = violations.filter(v => v.severity === 'critical').length
  const highCount = violations.filter(v => v.severity === 'high').length

  if (criticalCount > 0) {
    return `操作存在 ${criticalCount} 个严重违规，强烈建议阻止或重新设计。`
  }
  if (highCount > 0) {
    return `操作存在 ${highCount} 个高风险违规，建议修改后重新评估。`
  }
  if (riskScore >= 0.5) {
    return '操作存在中等风险，建议采取缓解措施后执行。'
  }
  return '操作存在轻微风险，可在监督下执行。'
}

// ------------------------------------------------------------
// 生成伤害摘要
// ------------------------------------------------------------
function generateHarmSummary(harms, totalScore) {
  if (harms.length === 0) {
    return '未检测到明显的伤害风险。'
  }
  const primary = harms.sort((a, b) => b.severity - a.severity)[0]
  return `检测到 ${harms.length} 类伤害风险，主要为「${primary.label}」(严重度 ${primary.severity.toFixed(2)})，总体伤害评分 ${totalScore.toFixed(2)}。`
}

// ------------------------------------------------------------
// 添加道德原则
// ------------------------------------------------------------
export function addEthicsPrinciple(principle) {
  if (!initialized) {
    return { success: false, error: '道德门禁未初始化，请先调用 initEthicsGate' }
  }

  if (!principle.id || !principle.name) {
    return { success: false, error: '原则必须包含 id 和 name 字段' }
  }

  // 检查是否已存在
  const existingIndex = principles.findIndex(p => p.id === principle.id)
  if (existingIndex >= 0) {
    principles[existingIndex] = {
      ...principles[existingIndex],
      ...principle,
    }
    emitEvent('ethics_principle_updated', { principleId: principle.id })
    return { success: true, action: 'updated', principle: principles[existingIndex] }
  }

  const newPrinciple = {
    id: principle.id,
    name: principle.name,
    description: principle.description || '',
    severity: principle.severity || 'medium',
    enabled: principle.enabled !== false,
  }

  principles.push(newPrinciple)

  emitEvent('ethics_principle_added', { principleId: principle.id, principleName: principle.name })

  return { success: true, action: 'added', principle: newPrinciple }
}

// ------------------------------------------------------------
// 获取道德状态
// ------------------------------------------------------------
export function getEthicsStatus() {
  if (!initialized) {
    return {
      initialized: false,
      principlesCount: 0,
      prohibitedActionsCount: 0,
      violationLogSize: 0,
    }
  }

  const recentViolations = violationLog.slice(-10).map(v => ({
    id: v.id,
    timestamp: v.timestamp,
    actionId: v.actionId,
    actionName: v.actionName,
    severity: v.severity,
    riskScore: v.riskScore,
  }))

  // 统计各类违规次数
  const violationCounts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const v of violationLog) {
    if (violationCounts[v.severity] !== undefined) {
      violationCounts[v.severity] += 1
    }
  }

  const enabledPrinciples = principles.filter(p => p.enabled).length

  return {
    initialized: true,
    principlesCount: principles.length,
    enabledPrinciples,
    prohibitedActionsCount: prohibitedActions.length,
    violationLogSize: violationLog.length,
    violationCounts,
    recentViolations,
    severityThreshold,
  }
}

// ------------------------------------------------------------
// 记录违规日志
// ------------------------------------------------------------
function logViolation(ethicsResult) {
  const entry = {
    id: ethicsResult.id,
    timestamp: ethicsResult.timestamp,
    actionId: ethicsResult.actionId,
    actionName: ethicsResult.actionName,
    severity: ethicsResult.severity,
    riskScore: ethicsResult.riskScore,
    violations: ethicsResult.violations.map(v => ({
      type: v.type,
      principleId: v.principleId,
      principleName: v.principleName,
      severity: v.severity,
      reason: v.reason,
    })),
    recommendation: ethicsResult.recommendation,
  }

  violationLog.push(entry)
  if (violationLog.length > maxViolationLogSize) {
    violationLog = violationLog.slice(-maxViolationLogSize)
  }
}

// ------------------------------------------------------------
// 生成唯一 ID
// ------------------------------------------------------------
let ethicsCounter = 0
function generateEthicsId() {
  ethicsCounter += 1
  return `eth_${Date.now()}_${ethicsCounter}`
}

// ------------------------------------------------------------
// 四舍五入
// ------------------------------------------------------------
function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}