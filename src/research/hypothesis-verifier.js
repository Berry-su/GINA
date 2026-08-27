import { emitEvent } from '../events.js'

const MAX_HYPOTHESES = 200
const MAX_EVIDENCE_PER_HYPOTHESIS = 50
const MAX_HISTORY = 100

const state = {
  initialized: false,
  hypotheses: new Map(),
  verifications: new Map(),
  history: [],
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function nowIso() {
  return new Date().toISOString()
}

function clampEvidence(list) {
  if (list.length <= MAX_EVIDENCE_PER_HYPOTHESIS) return list
  return list.slice(list.length - MAX_EVIDENCE_PER_HYPOTHESIS)
}

function pushHistory(entry) {
  state.history.push(entry)
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(state.history.length - MAX_HISTORY)
  }
}

// 根据知识缺口与矛盾条目生成假设
function buildHypothesisText(gap) {
  const topic = gap.topic || '未知主题'
  const domain = gap.domain || '通用'
  const contradiction = gap.contradiction || gap.description || ''
  if (contradiction) {
    return `在${domain}领域中，关于「${topic}」存在以下矛盾或缺口：${contradiction}。需要通过实证来澄清。`
  }
  return `在${domain}领域中，「${topic}」尚未得到充分解释，有待进一步验证。`
}

// 计算假设的置信度分数
function computeConfidence(evidenceList) {
  if (!evidenceList || evidenceList.length === 0) return 0
  let support = 0
  let contradict = 0
  for (const e of evidenceList) {
    const weight = Number(e.weight) || 1
    if (e.type === 'support') support += weight
    else if (e.type === 'contradict') contradict += weight
    else support += weight * 0.3
  }
  const total = support + contradict
  if (total === 0) return 0
  return Math.round((support - contradict) / total * 100)
}

// 根据置信度分数得出结论
function deriveConclusion(score, evidenceCount) {
  if (evidenceCount === 0) return 'unverified'
  if (score >= 60) return 'confirmed'
  if (score >= 20) return 'partially_confirmed'
  if (score <= -30) return 'rejected'
  return 'inconclusive'
}

export function initHypothesisVerifier() {
  if (state.initialized) {
    return { initialized: true, hypotheses: state.hypotheses.size }
  }
  state.initialized = true
  emitEvent('hypothesis_verifier_initialized', {
    timestamp: nowIso(),
  })
  return { initialized: true, hypotheses: 0 }
}

// 根据知识缺口列表生成假设
export function generateHypothesis(knowledgeGaps) {
  if (!state.initialized) {
    initHypothesisVerifier()
  }
  const gaps = Array.isArray(knowledgeGaps) ? knowledgeGaps : [knowledgeGaps]
  const results = []
  for (const gap of gaps) {
    const id = genId('hyp')
    const hypothesis = {
      id,
      text: buildHypothesisText(gap),
      domain: gap.domain || '通用',
      topic: gap.topic || '未知',
      source: gap.source || 'auto',
      confidence: 0,
      evidence: [],
      conclusion: 'unverified',
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    state.hypotheses.set(id, hypothesis)
    pushHistory({
      type: 'hypothesis_created',
      id,
      text: hypothesis.text,
      timestamp: nowIso(),
    })
    emitEvent('hypothesis_created', {
      id,
      text: hypothesis.text,
      domain: hypothesis.domain,
      topic: hypothesis.topic,
    })
    results.push(hypothesis)
  }
  // 清理超出上限的假设
  if (state.hypotheses.size > MAX_HYPOTHESES) {
    const keys = [...state.hypotheses.keys()]
    const excess = state.hypotheses.size - MAX_HYPOTHESES
    for (let i = 0; i < excess; i++) {
      state.hypotheses.delete(keys[i])
    }
  }
  return results.length === 1 ? results[0] : results
}

// 收集证据并验证假设
export function verifyHypothesis(hypothesisId, evidence) {
  if (!state.initialized) {
    initHypothesisVerifier()
  }
  const hyp = state.hypotheses.get(hypothesisId)
  if (!hyp) {
    throw new Error(`假设不存在: ${hypothesisId}`)
  }
  const evList = Array.isArray(evidence) ? evidence : [evidence]
  const normalized = evList.map(e => ({
    type: e.type === 'contradict' ? 'contradict' : 'support',
    source: e.source || 'unknown',
    description: e.description || String(e || ''),
    weight: Number(e.weight) || 1,
    collected_at: nowIso(),
  }))
  hyp.evidence = clampEvidence([...hyp.evidence, ...normalized])
  hyp.confidence = computeConfidence(hyp.evidence)
  hyp.conclusion = deriveConclusion(hyp.confidence, hyp.evidence.length)
  hyp.updated_at = nowIso()

  const verification = {
    id: genId('ver'),
    hypothesis_id: hypothesisId,
    confidence: hyp.confidence,
    conclusion: hyp.conclusion,
    evidence_count: hyp.evidence.length,
    supporting: hyp.evidence.filter(e => e.type === 'support').length,
    contradicting: hyp.evidence.filter(e => e.type === 'contradict').length,
    timestamp: nowIso(),
  }
  state.verifications.set(verification.id, verification)
  pushHistory({
    type: 'hypothesis_verified',
    hypothesis_id: hypothesisId,
    conclusion: hyp.conclusion,
    confidence: hyp.confidence,
    timestamp: nowIso(),
  })
  emitEvent('hypothesis_verified', {
    hypothesis_id: hypothesisId,
    conclusion: hyp.conclusion,
    confidence: hyp.confidence,
    new_evidence: normalized.length,
  })
  return { hypothesis: hyp, verification }
}

// 获取单个假设的验证状态
export function getVerificationStatus(hypothesisId) {
  if (!state.initialized) {
    initHypothesisVerifier()
  }
  const hyp = state.hypotheses.get(hypothesisId)
  if (!hyp) return null
  const related = [...state.verifications.values()]
    .filter(v => v.hypothesis_id === hypothesisId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return {
    id: hyp.id,
    text: hyp.text,
    domain: hyp.domain,
    topic: hyp.topic,
    confidence: hyp.confidence,
    conclusion: hyp.conclusion,
    evidence_count: hyp.evidence.length,
    supporting: hyp.evidence.filter(e => e.type === 'support').length,
    contradicting: hyp.evidence.filter(e => e.type === 'contradict').length,
    verifications: related,
    created_at: hyp.created_at,
    updated_at: hyp.updated_at,
  }
}

// 列出所有验证记录
export function listVerifications() {
  if (!state.initialized) {
    initHypothesisVerifier()
  }
  const allHypotheses = [...state.hypotheses.values()]
  return allHypotheses.map(h => ({
    id: h.id,
    text: h.text,
    domain: h.domain,
    confidence: h.confidence,
    conclusion: h.conclusion,
    evidence_count: h.evidence.length,
    updated_at: h.updated_at,
  })).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
}