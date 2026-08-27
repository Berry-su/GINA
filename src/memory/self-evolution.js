import { getConfig, setConfig, getMemoryByMemId } from '../capabilities/db.js'
import { emitEvent } from '../events.js'

const STATE_KEY = 'self_evolution_state_v1'
const STATE_VERSION = 1
const MAX_RECENT = 24
const PROMPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// 阶段推进：按累计事件数触发升级（对应 self.json 的 code_evolution.phases）
// index = 阶段号 - 1；total_events 达到阈值即推进到该阶段
const STAGE_EVENT_THRESHOLDS = [0, 10, 30, 60, 100]

const ACTIONABLE_TAGS = new Set([
  'kind:procedure',
  'kind:constraint',
  'kind:failure_lesson',
  'kind:policy',
])

const ACTIONABLE_EVENT_TYPES = new Set([
  'self_constraint',
])

const ACTIONABLE_MEM_ID_RE = /^(procedure|constraint|policy|lesson|rule)_/i

function defaultState() {
  return {
    version: STATE_VERSION,
    enabled: true,
    total_events: 0,
    learned_count: 0,
    current_stage: 1,
    last_at: null,
    recent: [],
  }
}

function computeStage(totalEvents) {
  let stage = 1
  for (let i = 0; i < STAGE_EVENT_THRESHOLDS.length; i++) {
    if (totalEvents >= STAGE_EVENT_THRESHOLDS[i]) stage = i + 1
  }
  return Math.min(stage, STAGE_EVENT_THRESHOLDS.length)
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
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
  const recent = Array.isArray(parsed.recent) ? parsed.recent : []
  const totalEvents = Math.max(0, Number(parsed.total_events) || 0)
  return {
    ...defaultState(),
    ...parsed,
    version: STATE_VERSION,
    enabled: parsed.enabled !== false,
    total_events: totalEvents,
    learned_count: Math.max(0, Number(parsed.learned_count) || 0),
    current_stage: computeStage(totalEvents),
    recent: recent
      .filter(entry => entry && entry.mem_id)
      .slice(0, MAX_RECENT),
  }
}

function saveState(state) {
  const normalized = normalizeState(state)
  normalized.recent = normalized.recent.slice(0, MAX_RECENT)
  normalized.current_stage = computeStage(normalized.total_events)
  setConfig(STATE_KEY, JSON.stringify(normalized))
  return normalized
}

function truncate(text, max = 220) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max - 1)}...` : value
}

function tagKind(tags = []) {
  const kindTag = tags.find(tag => String(tag).startsWith('kind:'))
  if (!kindTag) return ''
  return String(kindTag).slice('kind:'.length)
}

function memoryToEntry(memory, source = {}) {
  const tags = safeJsonArray(memory.tags).map(String)
  const kind = tagKind(tags)
    || (memory.event_type === 'self_constraint' ? 'constraint' : '')
    || ((memory.mem_id || '').match(ACTIONABLE_MEM_ID_RE)?.[1] || 'policy').toLowerCase()
  return {
    mem_id: memory.mem_id || source.mem_id || `row:${memory.id}`,
    kind,
    action: source.action || 'observed',
    title: truncate(memory.title || memory.content || source.title || 'Self-evolution update', 96),
    content: truncate(memory.content || source.content || '', 240),
    salience: Number(memory.salience || source.salience || 3),
    tags,
    learned_at: new Date().toISOString(),
  }
}

export function getSelfEvolutionState() {
  return normalizeState(getConfig(STATE_KEY))
}

export function getSelfEvolutionSnapshot({ maxRecent = MAX_RECENT } = {}) {
  const state = getSelfEvolutionState()
  return {
    enabled: state.enabled,
    version: state.version,
    total_events: state.total_events,
    learned_count: state.learned_count,
    current_stage: state.current_stage,
    last_at: state.last_at,
    recent: state.recent.slice(0, Math.max(0, Math.min(Number(maxRecent) || MAX_RECENT, MAX_RECENT))),
  }
}

export function resetSelfEvolutionState() {
  return saveState(defaultState())
}

export function isSelfEvolutionMemory(memory = {}) {
  if (!memory || typeof memory !== 'object') return false
  const tags = safeJsonArray(memory.tags).map(String)
  if (tags.some(tag => ACTIONABLE_TAGS.has(tag))) return true
  if (ACTIONABLE_EVENT_TYPES.has(memory.event_type || memory.type)) return true
  return ACTIONABLE_MEM_ID_RE.test(memory.mem_id || '')
}

export function recordSelfEvolutionFromMemories(memories = [], { emitEvent = null } = {}) {
  if (!Array.isArray(memories) || memories.length === 0) return []

  const state = getSelfEvolutionState()
  if (state.enabled === false) return []

  const learned = []
  const seen = new Set()

  for (const item of memories) {
    const memId = item?.mem_id || item?.id
    if (!memId || seen.has(memId)) continue
    seen.add(memId)

    let full = null
    try {
      full = getMemoryByMemId(memId)
    } catch {}
    const memory = full || item
    if (!isSelfEvolutionMemory(memory)) continue
    learned.push(memoryToEntry(memory, item))
  }

  if (learned.length === 0) return []

  const now = new Date().toISOString()
  const byId = new Map()
  for (const entry of learned) byId.set(entry.mem_id, entry)
  for (const entry of state.recent) {
    if (!byId.has(entry.mem_id)) byId.set(entry.mem_id, entry)
  }

  const nextRecent = [...byId.values()]
    .sort((a, b) => String(b.learned_at || '').localeCompare(String(a.learned_at || '')))
    .slice(0, MAX_RECENT)

  const nextState = saveState({
    ...state,
    total_events: state.total_events + learned.length,
    learned_count: nextRecent.length,
    last_at: now,
    recent: nextRecent,
  })

  if (typeof emitEvent === 'function') {
    emitEvent('self_evolution', {
      count: learned.length,
      entries: learned,
      summary: getSelfEvolutionSnapshot({ maxRecent: 5 }),
    })
  }

  return learned.map(entry => ({ ...entry, total_events: nextState.total_events }))
}

export function formatSelfEvolutionForPrompt({
  maxRecent = 3,
  maxAgeMs = PROMPT_MAX_AGE_MS,
} = {}) {
  const state = getSelfEvolutionState()
  if (state.enabled === false || state.recent.length === 0) return ''

  const cutoff = Date.now() - maxAgeMs
  const recent = state.recent
    .filter(entry => {
      if (!entry?.learned_at) return true
      const t = Date.parse(entry.learned_at)
      return Number.isNaN(t) || t >= cutoff
    })
    .slice(0, Math.max(1, Math.min(Number(maxRecent) || 3, 8)))

  if (recent.length === 0) return ''

  const lines = recent.map(entry => {
    const title = entry.title ? `${entry.title}: ` : ''
    return `- [${entry.kind || 'policy'}] ${entry.mem_id}: ${title}${entry.content || ''}`
  })

  return [
    'Self-evolution loop is active. It stores reusable procedures, constraints, and failure lessons as long-term policy memories. It does not rewrite source code or change permissions by itself.',
    'Recent behavior updates:',
    ...lines,
    'Use this as provenance. Turn-specific guidance still comes from <active-policies> when a learned policy matches the current situation.',
  ].join('\n')
}

// ============================================================
// 能力图谱系统 (Capability Graph)
// ============================================================

const CAPABILITY_KEY = 'capability_graph_v1'
const EVOLUTION_PATH_KEY = 'evolution_path_v1'
const LEARNING_GOALS_KEY = 'learning_goals_v1'

const CAPABILITY_DOMAINS = {
  perception: {
    name: '感知能力',
    description: '从环境中获取信息的能力',
    subCapabilities: ['visual_perception', 'auditory_perception', 'text_understanding', 'environment_awareness'],
  },
  cognition: {
    name: '认知能力',
    description: '处理和整合信息的能力',
    subCapabilities: ['memory_retention', 'pattern_recognition', 'abstract_reasoning', 'knowledge_integration'],
  },
  decision: {
    name: '决策能力',
    description: '做出选择和判断的能力',
    subCapabilities: ['multi_criteria_analysis', 'risk_assessment', 'ethical_reasoning', 'tradeoff_analysis'],
  },
  execution: {
    name: '执行能力',
    description: '将决策付诸行动的能力',
    subCapabilities: ['task_decomposition', 'parallel_execution', 'error_recovery', 'result_verification'],
  },
  evolution: {
    name: '进化能力',
    description: '自我改进和学习的能力',
    subCapabilities: ['self_reflection', 'skill_acquisition', 'knowledge_distillation', 'strategy_optimization'],
  },
  emotion: {
    name: '情感能力',
    description: '理解和表达情感的能力',
    subCapabilities: ['emotion_recognition', 'empathy_response', 'emotional_regulation', 'social_awareness'],
  },
}

const CAPABILITY_LEVELS = [
  { level: 0, name: '未开发', threshold: 0 },
  { level: 1, name: '入门', threshold: 10 },
  { level: 2, name: '基础', threshold: 30 },
  { level: 3, name: '熟练', threshold: 50 },
  { level: 4, name: '精通', threshold: 75 },
  { level: 5, name: '专家', threshold: 100 },
]

function defaultCapabilityGraph() {
  const capabilities = {}
  for (const [domainId, domain] of Object.entries(CAPABILITY_DOMAINS)) {
    capabilities[domainId] = {
      id: domainId,
      name: domain.name,
      description: domain.description,
      level: 1,
      experience: 0,
      progress: 0,
      subCapabilities: domain.subCapabilities.map(sub => ({
        id: sub,
        name: sub.replace(/_/g, ' '),
        level: 1,
        experience: 0,
        lastImproved: null,
      })),
      milestones: [],
    }
  }
  return {
    version: 1,
    updatedAt: Date.now(),
    capabilities,
    totalExperience: 0,
    overallLevel: 1,
  }
}

export function getCapabilityGraph() {
  const raw = getConfig(CAPABILITY_KEY)
  if (!raw) {
    const graph = defaultCapabilityGraph()
    setConfig(CAPABILITY_KEY, JSON.stringify(graph))
    return graph
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.capabilities) return parsed
  } catch {}
  const graph = defaultCapabilityGraph()
  setConfig(CAPABILITY_KEY, JSON.stringify(graph))
  return graph
}

export function updateCapability(domainId, subCapabilityId, experience) {
  const graph = getCapabilityGraph()
  const domain = graph.capabilities[domainId]
  if (!domain) {
    return { success: false, error: `未知能力域: ${domainId}` }
  }

  const subCap = domain.subCapabilities.find(s => s.id === subCapabilityId)
  if (!subCap) {
    return { success: false, error: `未知子能力: ${subCapabilityId}` }
  }

  subCap.experience += experience
  subCap.lastImproved = Date.now()

  const newLevel = calculateLevel(subCap.experience)
  if (newLevel > subCap.level) {
    subCap.level = newLevel
    domain.milestones.push({
      capability: subCapabilityId,
      newLevel,
      achievedAt: Date.now(),
      experience: subCap.experience,
    })
  }

  domain.experience = domain.subCapabilities.reduce((sum, s) => sum + s.experience, 0)
  const domainAvgLevel = domain.subCapabilities.reduce((sum, s) => sum + s.level, 0) / domain.subCapabilities.length
  domain.level = Math.round(domainAvgLevel)
  domain.progress = Math.min(100, Math.round(domain.experience / 5))

  graph.totalExperience += experience
  const allLevels = Object.values(graph.capabilities).flatMap(d => [d.level, ...d.subCapabilities.map(s => s.level)])
  graph.overallLevel = Math.round(allLevels.reduce((a, b) => a + b, 0) / allLevels.length)
  graph.updatedAt = Date.now()

  setConfig(CAPABILITY_KEY, JSON.stringify(graph))

  emitEvent('capability_updated', {
    domain: domainId,
    subCapability: subCapabilityId,
    experienceGained: experience,
    newLevel: subCap.level,
    totalExperience: subCap.experience,
  })

  return {
    success: true,
    domain: domainId,
    subCapability: subCapabilityId,
    newLevel: subCap.level,
    totalExperience: subCap.experience,
    domainProgress: domain.progress,
  }
}

function calculateLevel(experience) {
  let level = 0
  for (const { level: lvl, threshold } of CAPABILITY_LEVELS) {
    if (experience >= threshold) level = lvl
  }
  return level
}

export function getCapabilitySnapshot() {
  const graph = getCapabilityGraph()
  const domainSummaries = Object.values(graph.capabilities).map(d => ({
    id: d.id,
    name: d.name,
    level: d.level,
    progress: d.progress,
    subCapabilities: d.subCapabilities.map(s => ({
      id: s.id,
      name: s.name,
      level: s.level,
      experience: s.experience,
    })),
  }))

  return {
    overallLevel: graph.overallLevel,
    totalExperience: graph.totalExperience,
    domains: domainSummaries,
    strengths: identifyStrengths(graph),
    weaknesses: identifyWeaknesses(graph),
    nextMilestones: getNextMilestones(graph),
  }
}

function identifyStrengths(graph) {
  const strengths = []
  for (const domain of Object.values(graph.capabilities)) {
    for (const sub of domain.subCapabilities) {
      if (sub.level >= 4) {
        strengths.push({
          domain: domain.name,
          capability: sub.name,
          level: sub.level,
          experience: sub.experience,
        })
      }
    }
  }
  return strengths.sort((a, b) => b.level - a.level).slice(0, 5)
}

function identifyWeaknesses(graph) {
  const weaknesses = []
  for (const domain of Object.values(graph.capabilities)) {
    for (const sub of domain.subCapabilities) {
      if (sub.level <= 2) {
        weaknesses.push({
          domain: domain.name,
          capability: sub.name,
          level: sub.level,
          currentExperience: sub.experience,
          experienceNeeded: CAPABILITY_LEVELS[sub.level + 1]?.threshold - sub.experience || 50,
        })
      }
    }
  }
  return weaknesses.sort((a, b) => a.level - b.level).slice(0, 5)
}

function getNextMilestones(graph) {
  const milestones = []
  for (const domain of Object.values(graph.capabilities)) {
    for (const sub of domain.subCapabilities) {
      const nextLevel = CAPABILITY_LEVELS[sub.level + 1]
      if (nextLevel) {
        const experienceNeeded = nextLevel.threshold - sub.experience
        milestones.push({
          domain: domain.name,
          capability: sub.name,
          currentLevel: sub.level,
          targetLevel: nextLevel.level,
          targetName: nextLevel.name,
          experienceNeeded: Math.max(0, experienceNeeded),
          estimatedTime: estimateTimeToLevel(experienceNeeded),
        })
      }
    }
  }
  return milestones.sort((a, b) => a.experienceNeeded - b.experienceNeeded).slice(0, 5)
}

function estimateTimeToLevel(experienceNeeded) {
  const avgDailyExperience = 5
  const days = Math.ceil(experienceNeeded / avgDailyExperience)
  if (days <= 1) return '1天'
  if (days <= 7) return `${days}天`
  if (days <= 30) return `${Math.round(days / 7)}周`
  return `${Math.round(days / 30)}个月`
}

// ============================================================
// 进化路径规划 (Evolution Path Planning)
// ============================================================

const EVOLUTION_STAGES = [
  {
    id: 'stage_1',
    name: '基础认知构建',
    description: '建立基本的感知和记忆能力',
    requiredCapabilities: {
      perception: ['text_understanding', 'environment_awareness'],
      cognition: ['memory_retention', 'pattern_recognition'],
    },
    recommendedDuration: '1-2周',
  },
  {
    id: 'stage_2',
    name: '决策能力发展',
    description: '发展多准则决策和风险评估能力',
    requiredCapabilities: {
      decision: ['multi_criteria_analysis', 'risk_assessment'],
      cognition: ['abstract_reasoning'],
    },
    recommendedDuration: '2-3周',
  },
  {
    id: 'stage_3',
    name: '执行与协作',
    description: '掌握任务分解和执行恢复能力',
    requiredCapabilities: {
      execution: ['task_decomposition', 'error_recovery'],
      decision: ['tradeoff_analysis'],
    },
    recommendedDuration: '2-3周',
  },
  {
    id: 'stage_4',
    name: '情感与社交',
    description: '发展情感识别和共情能力',
    requiredCapabilities: {
      emotion: ['emotion_recognition', 'empathy_response'],
      perception: ['visual_perception'],
    },
    recommendedDuration: '2-4周',
  },
  {
    id: 'stage_5',
    name: '自我进化',
    description: '实现自主学习和技能生成',
    requiredCapabilities: {
      evolution: ['self_reflection', 'skill_acquisition', 'knowledge_distillation'],
    },
    recommendedDuration: '持续进行',
  },
  {
    id: 'stage_6',
    name: '专家级能力',
    description: '在特定领域达到专家水平',
    requiredCapabilities: {
      evolution: ['strategy_optimization'],
      execution: ['parallel_execution', 'result_verification'],
    },
    recommendedDuration: '持续精进',
  },
]

function defaultEvolutionPath() {
  return {
    version: 1,
    currentStage: 'stage_1',
    startedAt: Date.now(),
    lastProgressUpdate: Date.now(),
    stages: EVOLUTION_STAGES.map(stage => ({
      ...stage,
      status: stage.id === 'stage_1' ? 'current' : 'pending',
      progress: 0,
      completedAt: null,
      skipped: false,
    })),
    completedStages: [],
    totalProgress: 0,
  }
}

export function getEvolutionPath() {
  const raw = getConfig(EVOLUTION_PATH_KEY)
  if (!raw) {
    const path = defaultEvolutionPath()
    setConfig(EVOLUTION_PATH_KEY, JSON.stringify(path))
    return path
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.stages) return parsed
  } catch {}
  const path = defaultEvolutionPath()
  setConfig(EVOLUTION_PATH_KEY, JSON.stringify(path))
  return path
}

export function planEvolutionPath(targetStages = []) {
  const path = getEvolutionPath()
  const graph = getCapabilityGraph()

  const plan = []
  const currentStageIndex = EVOLUTION_STAGES.findIndex(s => s.id === path.currentStage)

  for (let i = currentStageIndex; i < EVOLUTION_STAGES.length; i++) {
    const stage = EVOLUTION_STAGES[i]
    const currentStage = path.stages.find(s => s.id === stage.id)

    const gaps = []
    for (const [domainId, requiredCapabilities] of Object.entries(stage.requiredCapabilities)) {
      const domain = graph.capabilities[domainId]
      if (!domain) continue

      for (const capId of requiredCapabilities) {
        const subCap = domain.subCapabilities.find(s => s.id === capId)
        if (!subCap) {
          gaps.push({
            capability: `${domainId}.${capId}`,
            currentLevel: 0,
            targetLevel: 2,
            priority: 'high',
          })
        } else if (subCap.level < 2) {
          gaps.push({
            capability: `${domainId}.${capId}`,
            currentLevel: subCap.level,
            targetLevel: 2,
            currentExperience: subCap.experience,
            experienceNeeded: CAPABILITY_LEVELS[2].threshold - subCap.experience,
            priority: subCap.level === 0 ? 'high' : 'medium',
          })
        }
      }
    }

    plan.push({
      stageId: stage.id,
      stageName: stage.name,
      status: currentStage?.status || 'pending',
      progress: currentStage?.progress || 0,
      gaps,
      estimatedEffort: gaps.reduce((sum, g) => sum + (g.experienceNeeded || 20), 0),
      prerequisitesMet: gaps.length === 0 || gaps.every(g => g.priority === 'low'),
    })
  }

  // 从所有阶段的 gaps 中生成可执行的里程碑
  const milestones = generateMilestones(plan, graph)

  emitEvent('evolution_planned', {
    stagesToComplete: plan.length,
    totalGaps: plan.reduce((sum, p) => sum + p.gaps.length, 0),
    highPriorityGaps: plan.reduce((sum, p) => sum + p.gaps.filter(g => g.priority === 'high').length, 0),
    milestoneCount: milestones.length,
  })

  return {
    success: true,
    currentStage: path.currentStage,
    plan,
    milestones,
    totalProgress: path.totalProgress,
    recommendedActions: generateRecommendedActions(plan[0]?.gaps || []),
  }
}

function generateMilestones(plan, graph) {
  const milestones = []
  const seen = new Set()

  for (const stage of plan) {
    for (const gap of stage.gaps) {
      const key = gap.capability
      if (seen.has(key)) continue
      seen.add(key)

      const [domainId, capId] = key.split('.')
      const domain = graph.capabilities[domainId]
      const subCap = domain?.subCapabilities?.find(s => s.id === capId)

      const currentLevel = gap.currentLevel ?? subCap?.level ?? 0
      const targetLevel = gap.targetLevel ?? 2
      const experienceNeeded = gap.experienceNeeded ?? (CAPABILITY_LEVELS[targetLevel]?.threshold ?? 30) - (subCap?.experience ?? 0)

      milestones.push({
        id: `ms_${key}_l${currentLevel}to${targetLevel}`,
        capability: key,
        domain: domain?.name || domainId,
        subCapability: subCap?.name || capId.replace(/_/g, ' '),
        currentLevel,
        targetLevel,
        currentLevelName: CAPABILITY_LEVELS[currentLevel]?.name || '未知',
        targetLevelName: CAPABILITY_LEVELS[targetLevel]?.name || '基础',
        currentExperience: subCap?.experience ?? 0,
        experienceNeeded: Math.max(0, experienceNeeded),
        priority: gap.priority || (currentLevel === 0 ? 'high' : 'medium'),
        stageId: stage.stageId,
        stageName: stage.stageName,
        suggestedActivities: getSuggestedActivities(key),
        description: `将 ${key} 从「${CAPABILITY_LEVELS[currentLevel]?.name}」提升到「${CAPABILITY_LEVELS[targetLevel]?.name}」，需要 ${Math.max(0, experienceNeeded)} 经验值`,
      })
    }
  }

  milestones.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    }
    return a.experienceNeeded - b.experienceNeeded
  })

  return milestones
}

function generateRecommendedActions(gaps) {
  if (gaps.length === 0) {
    return [{
      type: 'maintain',
      description: '当前阶段所有必要能力已达到要求，继续保持和精进',
      priority: 'medium',
    }]
  }

  const actions = []
  const highPriority = gaps.filter(g => g.priority === 'high')
  const mediumPriority = gaps.filter(g => g.priority === 'medium')

  for (const gap of highPriority) {
    actions.push({
      type: 'develop',
      capability: gap.capability,
      description: `重点发展 ${gap.capability}，从等级 ${gap.currentLevel} 提升到 ${gap.targetLevel}`,
      experienceNeeded: gap.experienceNeeded || 30,
      priority: 'high',
      suggestedActivities: getSuggestedActivities(gap.capability),
    })
  }

  for (const gap of mediumPriority.slice(0, 2)) {
    actions.push({
      type: 'improve',
      capability: gap.capability,
      description: `逐步提升 ${gap.capability}，当前等级 ${gap.currentLevel}`,
      experienceNeeded: gap.experienceNeeded || 15,
      priority: 'medium',
      suggestedActivities: getSuggestedActivities(gap.capability),
    })
  }

  return actions
}

function getSuggestedActivities(capabilityPath) {
  const [domain, cap] = capabilityPath.split('.')
  const activityMap = {
    'perception.text_understanding': ['阅读长文本并总结要点', '分析文档结构和语义', '处理多种格式的文本信息'],
    'perception.environment_awareness': ['监控环境变化并生成报告', '分析系统状态并预警', '识别新出现的实体或事件'],
    'perception.visual_perception': ['分析图像内容和特征', '识别视觉模式和异常', '提取图像中的信息'],
    'cognition.memory_retention': ['长期记忆管理和索引', '信息压缩和遗忘曲线优化', '关联记忆激活'],
    'cognition.pattern_recognition': ['在数据中发现隐藏模式', '识别重复出现的行为模式', '从示例中提取规则'],
    'cognition.abstract_reasoning': ['进行假设演绎推理', '建立因果模型', '进行类比推理'],
    'cognition.knowledge_integration': ['融合多源知识', '构建知识图谱', '进行跨领域知识关联'],
    'decision.multi_criteria_analysis': ['对多个选项进行加权评分', '进行Pareto最优分析', '敏感性分析'],
    'decision.risk_assessment': ['识别和量化风险', '评估风险影响范围', '生成风险缓解策略'],
    'decision.tradeoff_analysis': ['分析多目标间的权衡', '识别冲突目标并协调', '进行成本效益分析'],
    'decision.ethical_reasoning': ['评估决策的伦理影响', '进行利益相关者分析', '确保决策符合伦理准则'],
    'execution.task_decomposition': ['将复杂任务分解为子任务', '识别任务间依赖关系', '生成执行计划'],
    'execution.error_recovery': ['检测和诊断错误', '生成恢复策略', '执行自动修复'],
    'execution.parallel_execution': ['识别可并行的任务', '分配资源进行并行处理', '同步并行执行结果'],
    'execution.result_verification': ['验证执行结果的正确性', '进行结果质量评估', '生成执行报告'],
    'evolution.self_reflection': ['定期进行自我审查', '识别自身优点和不足', '生成改进计划'],
    'evolution.skill_acquisition': ['从经验中学习新技能', '通过演示获取技能', '进行技能组合创新'],
    'evolution.knowledge_distillation': ['从大量数据中提取核心知识', '压缩知识为简洁形式', '生成知识摘要'],
    'evolution.strategy_optimization': ['优化决策策略', '调整策略参数', '进行策略组合创新'],
    'emotion.emotion_recognition': ['识别用户情绪状态', '分析对话中的情感信号', '理解隐含情感'],
    'emotion.empathy_response': ['生成共情的回应', '根据情绪调整沟通方式', '表达理解和关切'],
    'emotion.emotional_regulation': ['管理自身情感状态', '在压力下保持稳定', '进行情感自我调节'],
    'emotion.social_awareness': ['理解社交语境', '遵循社交规范', '进行适当的社交互动'],
  }
  return activityMap[capabilityPath] || ['在实践中学习和练习', '寻求反馈和改进', '进行相关领域的探索']
}

// ============================================================
// 学习目标追踪 (Learning Goals Tracking)
// ============================================================

function defaultLearningGoals() {
  return {
    version: 1,
    goals: [],
    activeGoals: [],
    completedGoals: [],
    abandonedGoals: [],
    totalGoalsCreated: 0,
    totalGoalsCompleted: 0,
  }
}

export function getLearningGoals() {
  const raw = getConfig(LEARNING_GOALS_KEY)
  if (!raw) {
    const goals = defaultLearningGoals()
    setConfig(LEARNING_GOALS_KEY, JSON.stringify(goals))
    return goals
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.goals)) return parsed
  } catch {}
  const goals = defaultLearningGoals()
  setConfig(LEARNING_GOALS_KEY, JSON.stringify(goals))
  return goals
}

export function setLearningGoal(goal) {
  const goalsData = getLearningGoals()
  const newGoal = {
    id: `goal_${Date.now()}`,
    title: goal.title,
    description: goal.description || '',
    targetCapability: goal.targetCapability || null,
    targetLevel: goal.targetLevel || 3,
    currentLevel: goal.currentLevel || 0,
    deadline: goal.deadline || null,
    priority: goal.priority || 'medium',
    status: 'active',
    progress: 0,
    milestones: goal.milestones || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  goalsData.goals.push(newGoal)
  goalsData.activeGoals.push(newGoal.id)
  goalsData.totalGoalsCreated += 1

  setConfig(LEARNING_GOALS_KEY, JSON.stringify(goalsData))

  emitEvent('learning_goal_set', {
    goalId: newGoal.id,
    title: newGoal.title,
    targetCapability: newGoal.targetCapability,
    priority: newGoal.priority,
  })

  return { success: true, goal: newGoal }
}

export function updateLearningGoalProgress(goalId, progress, experience = 0) {
  const goalsData = getLearningGoals()
  const goalIndex = goalsData.goals.findIndex(g => g.id === goalId)

  if (goalIndex === -1) {
    return { success: false, error: `未找到学习目标: ${goalId}` }
  }

  const goal = goalsData.goals[goalIndex]
  goal.progress = Math.min(100, progress)
  goal.updatedAt = Date.now()

  if (experience > 0 && goal.targetCapability) {
    const [domain, sub] = goal.targetCapability.split('.')
    updateCapability(domain, sub, experience)
  }

  if (goal.progress >= 100) {
    goal.status = 'completed'
    goal.completedAt = Date.now()
    goalsData.activeGoals = goalsData.activeGoals.filter(id => id !== goalId)
    goalsData.completedGoals.push(goalId)
    goalsData.totalGoalsCompleted += 1

    emitEvent('learning_goal_completed', {
      goalId,
      title: goal.title,
      timeToComplete: goal.completedAt - goal.createdAt,
    })
  }

  setConfig(LEARNING_GOALS_KEY, JSON.stringify(goalsData))
  return { success: true, goal }
}

export function getActiveLearningGoals() {
  const goalsData = getLearningGoals()
  return goalsData.goals.filter(g => g.status === 'active')
}

export function getLearningProgressReport() {
  const goalsData = getLearningGoals()
  const graph = getCapabilityGraph()
  const path = getEvolutionPath()

  const activeGoals = goalsData.goals.filter(g => g.status === 'active')
  const completedGoals = goalsData.goals.filter(g => g.status === 'completed')

  const overallProgress = calculateLearningProgress(goalsData, graph, path)

  return {
    summary: {
      activeGoals: activeGoals.length,
      completedGoals: completedGoals.length,
      totalGoals: goalsData.totalGoalsCreated,
      completionRate: goalsData.totalGoalsCreated > 0
        ? Math.round((goalsData.totalGoalsCompleted / goalsData.totalGoalsCreated) * 100)
        : 0,
    },
    activeGoals: activeGoals.map(g => ({
      id: g.id,
      title: g.title,
      progress: g.progress,
      priority: g.priority,
      targetCapability: g.targetCapability,
      deadline: g.deadline,
    })),
    completedGoals: completedGoals.slice(-5).map(g => ({
      id: g.id,
      title: g.title,
      completedAt: g.completedAt,
    })),
    capabilitySnapshot: getCapabilitySnapshot(),
    evolutionPath: {
      currentStage: path.currentStage,
      totalProgress: path.totalProgress,
      completedStages: path.completedStages.length,
    },
    overallProgress,
  }
}

function calculateLearningProgress(goalsData, graph, path) {
  const goalProgress = goalsData.goals.reduce((sum, g) => sum + g.progress, 0) / Math.max(1, goalsData.goals.length)
  const capabilityProgress = Object.values(graph.capabilities).reduce((sum, d) => sum + d.progress, 0) / Object.keys(graph.capabilities).length
  const evolutionProgress = path.totalProgress

  const weights = { goals: 0.3, capability: 0.4, evolution: 0.3 }
  const overall = goalProgress * weights.goals + capabilityProgress * weights.capability + evolutionProgress * weights.evolution

  return {
    overall: Math.round(overall),
    byGoals: Math.round(goalProgress),
    byCapability: Math.round(capabilityProgress),
    byEvolution: Math.round(evolutionProgress),
    interpretation: overall >= 80
      ? '学习进展顺利，保持当前节奏'
      : overall >= 50
      ? '学习稳步进行，继续推进'
      : overall >= 30
      ? '学习处于起步阶段，需要持续投入'
      : '学习刚刚开始，建立学习习惯',
  }
}
