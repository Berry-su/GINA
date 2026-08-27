import { emitEvent } from '../events.js'

const MAX_THEORIES = 150
const MAX_PATTERNS = 500
const MAX_HISTORY = 100
const MAX_REFINEMENTS_PER_THEORY = 30

const state = {
  initialized: false,
  patterns: new Map(),
  theories: new Map(),
  history: [],
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function nowIso() {
  return new Date().toISOString()
}

function pushHistory(entry) {
  state.history.push(entry)
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(state.history.length - MAX_HISTORY)
  }
}

// 跨域关键词匹配器 —— 用于发现跨领域模式
const CROSS_DOMAIN_KEYWORDS = [
  { pattern: /数据.*(?:驱动|流|管道)/, tags: ['data_flow', 'automation'] },
  { pattern: /(?:用户|用户行为|交互).*(?:模式|路径|旅程)/, tags: ['user_behavior', 'ux'] },
  { pattern: /(?:性能|响应|延迟|吞吐).*(?:瓶颈|优化|下降)/, tags: ['performance', 'bottleneck'] },
  { pattern: /(?:错误|异常|失败|崩溃).*(?:频率|趋势|聚类)/, tags: ['error_pattern', 'reliability'] },
  { pattern: /(?:增长|留存|转化).*(?:趋势|变化|波动)/, tags: ['growth_metric', 'retention'] },
  { pattern: /(?:成本|费用|预算).*(?:超支|节约|效率)/, tags: ['cost', 'efficiency'] },
  { pattern: /(?:安全|漏洞|风险|威胁).*(?:趋势|分布|模式)/, tags: ['security', 'risk'] },
]

// 从领域数据中提取模式
function extractPattern(domainItem) {
  const text = [
    domainItem.title || '',
    domainItem.description || '',
    domainItem.content || '',
    (domainItem.tags || []).join(' '),
  ].join(' ')

  const matchedTags = new Set()
  for (const { pattern, tags } of CROSS_DOMAIN_KEYWORDS) {
    if (pattern.test(text)) {
      tags.forEach(t => matchedTags.add(t))
    }
  }

  const keywords = (domainItem.keywords || []).map(k => String(k).toLowerCase())
  const entities = (domainItem.entities || []).map(e => String(e).toLowerCase())

  return {
    id: genId('pat'),
    source_domain: domainItem.domain || 'unknown',
    topic: domainItem.topic || domainItem.title || '未命名模式',
    description: domainItem.description || domainItem.content || '',
    tags: [...matchedTags],
    keywords,
    entities,
    confidence: Number(domainItem.confidence) || 1,
    supporting_evidence: 1,
    contradicting_evidence: 0,
    related_theories: [],
    discovered_at: nowIso(),
    updated_at: nowIso(),
  }
}

// 根据多个模式聚合生成理论文本
function composeTheoryText(patterns, domains) {
  const topicSet = new Set()
  const tagSet = new Set()
  for (const p of patterns) {
    topicSet.add(p.topic)
    p.tags.forEach(t => tagSet.add(t))
  }
  const topicList = [...topicSet].slice(0, 6)
  const tagList = [...tagSet].slice(0, 5)
  const domainStr = (domains && domains.length > 0)
    ? `跨${domains.length}个领域（${domains.slice(0, 3).join('、')}${domains.length > 3 ? '等' : ''}）`
    : '跨领域'
  const topicStr = topicList.length > 0 ? `围绕「${topicList.join('」、「')}」` : ''
  const tagStr = tagList.length > 0 ? `涉及 [${tagList.join(', ')}]` : ''
  return `${domainStr}${topicStr}的综合理论 ${tagStr}。该理论整合了多源模式，旨在解释相关现象并预测未来趋势。`
}

// 计算理论的解释力分数
function computeExplanatoryPower(theory) {
  if (!theory || !theory.pattern_ids || theory.pattern_ids.length === 0) return 0
  const patternCount = theory.pattern_ids.length
  let supportScore = 0
  let contradictScore = 0
  for (const patId of theory.pattern_ids) {
    const pat = state.patterns.get(patId)
    if (!pat) continue
    supportScore += pat.supporting_evidence
    contradictScore += pat.contradicting_evidence
  }
  const raw = (supportScore * 2 + patternCount * 3 - contradictScore * 1.5)
  return Math.round(raw)
}

// 简化理论：去除冗余模式、合并重叠标签
function simplifyTheory(theory) {
  const allPatterns = theory.pattern_ids
    .map(id => state.patterns.get(id))
    .filter(Boolean)

  const tagFrequency = new Map()
  for (const p of allPatterns) {
    for (const t of p.tags) {
      tagFrequency.set(t, (tagFrequency.get(t) || 0) + 1)
    }
  }
  const sortedTags = [...tagFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)

  const dedupedPatterns = []
  const seenTopics = new Set()
  for (const p of allPatterns) {
    if (seenTopics.has(p.topic) && dedupedPatterns.length >= 3) continue
    seenTopics.add(p.topic)
    dedupedPatterns.push(p)
  }

  const simplified = {
    ...theory,
    pattern_ids: dedupedPatterns.map(p => p.id),
    tags: sortedTags.slice(0, 8),
    simplified: true,
    refinement_count: (theory.refinement_count || 0) + 1,
    updated_at: nowIso(),
  }
  return simplified
}

export function initTheoryFormer() {
  if (state.initialized) {
    return { initialized: true, patterns: state.patterns.size, theories: state.theories.size }
  }
  state.initialized = true
  emitEvent('theory_former_initialized', {
    timestamp: nowIso(),
  })
  return { initialized: true, patterns: 0, theories: 0 }
}

// 从领域数据集中发现模式
export function discoverPatterns(domains) {
  if (!state.initialized) {
    initTheoryFormer()
  }
  const domainList = Array.isArray(domains) ? domains : [domains]
  const discovered = []
  for (const domainItem of domainList) {
    const pattern = extractPattern(domainItem)
    state.patterns.set(pattern.id, pattern)
    discovered.push(pattern)
    pushHistory({
      type: 'pattern_discovered',
      id: pattern.id,
      source_domain: pattern.source_domain,
      topic: pattern.topic,
      timestamp: nowIso(),
    })
  }
  // 清理超出上限的模式
  if (state.patterns.size > MAX_PATTERNS) {
    const keys = [...state.patterns.keys()]
    const excess = state.patterns.size - MAX_PATTERNS
    for (let i = 0; i < excess; i++) {
      state.patterns.delete(keys[i])
    }
  }
  emitEvent('patterns_discovered', {
    count: discovered.length,
    domains: [...new Set(discovered.map(d => d.source_domain))],
    timestamp: nowIso(),
  })
  return discovered.length === 1 ? discovered[0] : discovered
}

// 根据模式列表构建理论
export function buildTheory(patterns) {
  if (!state.initialized) {
    initTheoryFormer()
  }
  const patList = Array.isArray(patterns) ? patterns : [patterns]
  const resolvedPatterns = []
  for (const p of patList) {
    if (typeof p === 'string') {
      const existing = state.patterns.get(p)
      if (existing) resolvedPatterns.push(existing)
    } else if (p && p.id && state.patterns.has(p.id)) {
      resolvedPatterns.push(state.patterns.get(p.id))
    } else if (p && p.id) {
      state.patterns.set(p.id, {
        ...extractPattern(p),
        id: p.id,
      })
      resolvedPatterns.push(state.patterns.get(p.id))
    } else if (p) {
      const newPat = extractPattern(p)
      state.patterns.set(newPat.id, newPat)
      resolvedPatterns.push(newPat)
    }
  }
  if (resolvedPatterns.length === 0) {
    throw new Error('无法从给定模式构建理论：模式列表为空或无效')
  }
  const domains = [...new Set(resolvedPatterns.map(p => p.source_domain))]
  const theoryId = genId('thy')
  const theory = {
    id: theoryId,
    text: composeTheoryText(resolvedPatterns, domains),
    pattern_ids: resolvedPatterns.map(p => p.id),
    domains,
    tags: [...new Set(resolvedPatterns.flatMap(p => p.tags))].slice(0, 8),
    explanatory_power: 0,
    validated: false,
    validation_score: 0,
    supporting_evidence: 0,
    contradicting_evidence: 0,
    refinement_count: 0,
    simplified: false,
    status: 'draft',
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  theory.explanatory_power = computeExplanatoryPower(theory)
  state.theories.set(theoryId, theory)
  for (const patId of theory.pattern_ids) {
    const pat = state.patterns.get(patId)
    if (pat) {
      pat.related_theories.push(theoryId)
      pat.updated_at = nowIso()
    }
  }
  pushHistory({
    type: 'theory_built',
    id: theoryId,
    text: theory.text,
    pattern_count: resolvedPatterns.length,
    domains,
    timestamp: nowIso(),
  })
  emitEvent('theory_built', {
    id: theoryId,
    text: theory.text,
    domains,
    pattern_count: resolvedPatterns.length,
  })
  // 清理超出上限的理论
  if (state.theories.size > MAX_THEORIES) {
    const keys = [...state.theories.keys()]
    const excess = state.theories.size - MAX_THEORIES
    for (let i = 0; i < excess; i++) {
      state.theories.delete(keys[i])
    }
  }
  return theory
}

// 使用证据验证理论
export function validateTheory(theoryId, evidence) {
  if (!state.initialized) {
    initTheoryFormer()
  }
  const theory = state.theories.get(theoryId)
  if (!theory) {
    throw new Error(`理论不存在: ${theoryId}`)
  }
  const evList = Array.isArray(evidence) ? evidence : [evidence]
  let supportAdd = 0
  let contradictAdd = 0
  const findings = []

  for (const e of evList) {
    const weight = Number(e.weight) || 1
    if (e.type === 'contradict') {
      contradictAdd += weight
      findings.push({ type: 'contradict', description: e.description || '', weight })
    } else {
      supportAdd += weight
      findings.push({ type: 'support', description: e.description || '', weight })
    }
  }

  theory.supporting_evidence += supportAdd
  theory.contradicting_evidence += contradictAdd
  theory.validated = true
  theory.validation_score = Math.round(
    (theory.supporting_evidence - theory.contradicting_evidence) /
    Math.max(1, theory.supporting_evidence + theory.contradicting_evidence) * 100
  )

  // 验证后自动尝试精炼理论
  theory.refinement_count = (theory.refinement_count || 0) + 1
  if (theory.refinement_count <= MAX_REFINEMENTS_PER_THEORY) {
    const simplified = simplifyTheory(theory)
    theory.pattern_ids = simplified.pattern_ids
    theory.tags = simplified.tags
    theory.simplified = simplified.simplified
  }

  // 根据验证分数确定状态
  if (theory.validation_score >= 40) {
    theory.status = 'confirmed'
  } else if (theory.validation_score >= 10) {
    theory.status = 'provisional'
  } else if (theory.validation_score >= -20) {
    theory.status = 'inconclusive'
  } else {
    theory.status = 'refuted'
  }

  theory.explanatory_power = computeExplanatoryPower(theory)
  theory.updated_at = nowIso()

  pushHistory({
    type: 'theory_validated',
    id: theoryId,
    validation_score: theory.validation_score,
    status: theory.status,
    timestamp: nowIso(),
  })
  emitEvent('theory_validated', {
    id: theoryId,
    validation_score: theory.validation_score,
    status: theory.status,
    findings,
  })
  return {
    theory,
    findings,
    support_added: supportAdd,
    contradict_added: contradictAdd,
  }
}

// 按解释力排序输出理论列表
export function rankTheories() {
  if (!state.initialized) {
    initTheoryFormer()
  }
  const all = [...state.theories.values()]
  const ranked = all.sort((a, b) => {
    const scoreA = a.explanatory_power + (a.validation_score || 0) * 0.5
    const scoreB = b.explanatory_power + (b.validation_score || 0) * 0.5
    return scoreB - scoreA
  })
  const result = ranked.map((t, index) => ({
    rank: index + 1,
    id: t.id,
    text: t.text,
    explanatory_power: t.explanatory_power,
    validation_score: t.validation_score,
    status: t.status,
    pattern_count: t.pattern_ids.length,
    domains: t.domains,
    tags: t.tags,
    updated_at: t.updated_at,
  }))
  emitEvent('theories_ranked', {
    total: result.length,
    top: result.slice(0, 5),
    timestamp: nowIso(),
  })
  return result
}

// 获取单个理论的状态详情
export function getTheoryStatus(theoryId) {
  if (!state.initialized) {
    initTheoryFormer()
  }
  const theory = state.theories.get(theoryId)
  if (!theory) return null
  const patterns = theory.pattern_ids
    .map(id => state.patterns.get(id))
    .filter(Boolean)
    .map(p => ({
      id: p.id,
      topic: p.topic,
      domain: p.source_domain,
      tags: p.tags,
      confidence: p.confidence,
    }))
  return {
    id: theory.id,
    text: theory.text,
    status: theory.status,
    explanatory_power: theory.explanatory_power,
    validation_score: theory.validation_score,
    validated: theory.validated,
    domains: theory.domains,
    tags: theory.tags,
    pattern_count: theory.pattern_ids.length,
    patterns,
    supporting_evidence: theory.supporting_evidence,
    contradicting_evidence: theory.contradicting_evidence,
    refinement_count: theory.refinement_count,
    simplified: theory.simplified,
    created_at: theory.created_at,
    updated_at: theory.updated_at,
  }
}