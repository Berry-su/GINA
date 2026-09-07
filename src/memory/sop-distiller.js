// sop-distiller.js — SOP 蒸馏（经验 → 标准操作流程）
//
// 定位：现有 knowledge-distiller 4 类 (事实/程序/策略/偏好) 中的"程序知识"
// 还没有自动聚类高频经验 → step-by-step SOP。本模块提供：
//   1. 经验聚类：相似 trigger 的经验归一组
//   2. 频率统计：聚类内重复次数
//   3. SOP 生成：高频聚类 → 步骤化操作流程
//   4. 验证 + 触发：SOP 必须人验证（Gate 2 dangerous 也走 evolution-gate）
//
// 硬约束（老板 9-07 翻身唯一机会 + 零妥协）：
//   - SOP 自动生成但必须人工 review 才能进入生产（dryRun 默认）
//   - 高频聚类（>= 3 次相同 trigger）才生成 SOP
//   - SOP 必须过 evolution-gate 第二道门（危险操作强制人确认）
//   - SOP 持久化：JSONL 文件（SOP_FILE）

import fs from 'node:fs'
import path from 'node:path'

// ─── 常时量 ─────────────────────────────────────────────────

const MIN_OCCURRENCES = 3           // 至少 3 次相似经验才生成 SOP
const MIN_CONFIDENCE = 0.6            // 聚类平均 confidence 下限
const MAX_STEPS_PER_SOP = 20          // 单个 SOP 步骤数上限
const MAX_SOPS_RETURN = 10            // 一次返回 SOP 数上限
const DEFAULT_SOP_DIR = process.env.GINA_HOME
  ? `${process.env.GINA_HOME}/sops`
  : `${process.env.HOME || '.'}/.gina/sops`
const DEFAULT_SOP_FILE = `${DEFAULT_SOP_DIR}/sops.jsonl`

// 步骤类型（用于分类）
const STEP_TYPES = {
  TOOL_CALL: 'tool_call',             // 调用工具
  READ: 'read',                       // 读数据
  WRITE: 'write',                     // 写数据
  VALIDATE: 'validate',               // 验证
  NOTIFY: 'notify',                   // 通知老板
  WAIT: 'wait',                       // 等待
}

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

// 从经验里提取 trigger keyword（用于聚类）
function extractTriggerKey(exp) {
  if (!exp || typeof exp !== 'object') return null
  if (typeof exp.trigger === 'string' && exp.trigger.trim().length > 0) {
    return exp.trigger.trim().toLowerCase()
  }
  if (typeof exp.situation === 'string') return exp.situation.trim().toLowerCase()
  if (typeof exp.context === 'string') return exp.context.trim().toLowerCase()
  if (Array.isArray(exp.tags) && exp.tags.length > 0) {
    return exp.tags.join('+').toLowerCase()
  }
  return null
}

// 提取 step 描述
function extractStep(exp) {
  if (!exp || typeof exp !== 'object') return null
  if (typeof exp.action === 'string') return exp.action
  if (typeof exp.learned === 'string') return exp.learned
  if (typeof exp.description === 'string') return exp.description
  if (typeof exp.result === 'string') return exp.result
  return null
}

// 简单相似度（Jaccard 词集合）
function jaccardSimilarity(a, b) {
  if (!a || !b) return 0
  const wa = new Set(String(a).toLowerCase().split(/\s+/).filter(w => w.length >= 2))
  const wb = new Set(String(b).toLowerCase().split(/\s+/).filter(w => w.length >= 2))
  if (wa.size === 0 || wb.size === 0) return 0
  const inter = [...wa].filter(w => wb.has(w)).length
  return inter / Math.sqrt(wa.size * wb.size)
}

// ─── 1. 经验聚类 ──────────────────────────────────────────

// 把经验按 trigger 相似度聚类
//   options: { similarityThreshold } (default 0.5)
//   返回: [{ trigger, experiences: [...], avgConfidence, occurrences }]
export function clusterExperiences(experiences, options = {}) {
  const list = Array.isArray(experiences) ? experiences : []
  const threshold = options.similarityThreshold != null ? options.similarityThreshold : 0.5
  const clusters = []
  for (const exp of list) {
    const key = extractTriggerKey(exp)
    if (!key) continue
    // 找已有 cluster
    let placed = false
    for (const c of clusters) {
      if (jaccardSimilarity(c.trigger, key) >= threshold) {
        c.experiences.push(exp)
        placed = true
        break
      }
    }
    if (!placed) {
      clusters.push({ trigger: key, experiences: [exp] })
    }
  }
  // 计算每 cluster 统计
  for (const c of clusters) {
    c.occurrences = c.experiences.length
    const confs = c.experiences.map(e => e.confidence || 0).filter(n => typeof n === 'number')
    c.avgConfidence = confs.length > 0 ? confs.reduce((s, x) => s + x, 0) / confs.length : 0
    c.avgImportance = c.experiences
      .map(e => e.importance || e.metadata?.importance || 0.5)
      .filter(n => typeof n === 'number')
      .reduce((s, x, _, arr) => s + x / arr.length, 0) || 0.5
  }
  return clusters
}

// ─── 2. SOP 生成 ──────────────────────────────────────────

// 从 cluster 生成 SOP
//   options: { maxSteps, maxSops }
//   返回: [{ id, trigger, steps: [{order, action, type, evidenceCount}], successRate, confidence, status: 'pending_review' }]
export function generateSOPs(clusters, options = {}) {
  const list = Array.isArray(clusters) ? clusters : []
  const maxSteps = options.maxSteps || MAX_STEPS_PER_SOP
  const maxSops = options.maxSops || MAX_SOPS_RETURN
  const minOcc = options.minOccurrences || MIN_OCCURRENCES
  const minConf = options.minConfidence || MIN_CONFIDENCE
  const sops = []
  for (const c of list) {
    if (c.occurrences < minOcc) continue
    if (c.avgConfidence < minConf) continue
    // 提取步骤（按时间顺序：先发生先做）
    const sorted = [...c.experiences].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    const steps = []
    for (let i = 0; i < Math.min(sorted.length, maxSteps); i++) {
      const exp = sorted[i]
      const action = extractStep(exp)
      if (!action) continue
      steps.push({
        order: i + 1,
        action,
        type: inferStepType(action),
        evidenceCount: 1,
        outcome: exp.outcome || exp.result || null,
      })
    }
    if (steps.length === 0) continue
    // 计算 successRate
    const outcomes = c.experiences.map(e => e.outcome || e.result)
    const successes = outcomes.filter(o => o === 'success' || o === 'completed').length
    const successRate = outcomes.length > 0 ? successes / outcomes.length : 0
    const sop = {
      id: `sop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      trigger: c.trigger,
      steps,
      occurrences: c.occurrences,
      avgConfidence: c.avgConfidence,
      avgImportance: c.avgImportance,
      successRate,
      status: 'pending_review',  // 必须人 review
      createdAt: Date.now(),
      source: 'sop-distiller',
    }
    sops.push(sop)
    if (sops.length >= maxSops) break
  }
  return sops
}

function inferStepType(action) {
  if (typeof action !== 'string') return STEP_TYPES.TOOL_CALL
  const a = action.toLowerCase()
  if (a.includes('read') || a.includes('load') || a.includes('fetch') || a.includes('查询')) return STEP_TYPES.READ
  if (a.includes('write') || a.includes('save') || a.includes('update') || a.includes('记录') || a.includes('写入')) return STEP_TYPES.WRITE
  if (a.includes('validate') || a.includes('verify') || a.includes('check') || a.includes('验证') || a.includes('检查')) return STEP_TYPES.VALIDATE
  if (a.includes('notify') || a.includes('tell') || a.includes('alert') || a.includes('通知') || a.includes('告诉')) return STEP_TYPES.NOTIFY
  if (a.includes('wait') || a.includes('pause') || a.includes('等待') || a.includes('等')) return STEP_TYPES.WAIT
  return STEP_TYPES.TOOL_CALL
}

// ─── 3. SOP 持久化 ────────────────────────────────────────

// 保存 SOP 到文件（JSONL）
//   options: { sopFile }
//   返回: { saved, count, file }
export function saveSOPs(sops, options = {}) {
  const list = Array.isArray(sops) ? sops : []
  const file = options.sopFile || DEFAULT_SOP_FILE
  if (list.length === 0) return { saved: 0, count: 0, file }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const lines = list.map(sop => JSON.stringify(sop)).join('\n') + '\n'
    fs.appendFileSync(file, lines, 'utf8')
    return { saved: list.length, count: list.length, file }
  } catch (e) {
    return { saved: 0, count: 0, file, error: e.message }
  }
}

// 读取 SOP 文件
export function loadSOPs(options = {}) {
  const file = options.sopFile || DEFAULT_SOP_FILE
  try {
    if (!fs.existsSync(file)) return []
    const content = fs.readFileSync(file, 'utf8')
    const lines = content.split('\n').filter(l => l.trim().length > 0)
    return lines.map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch (e) {
    return []
  }
}

// ─── 4. 主导出：端到端 ────────────────────────────────────

// 一站式：从经验生成 SOP
//   options: { experiences, similarityThreshold, minOccurrences, minConfidence, maxSteps, maxSops, sopFile, dryRun }
//   返回: { sops, clusters, saved, dryRun }
export async function distillSOPs(options = {}) {
  const experiences = Array.isArray(options.experiences) ? options.experiences : []
  const dryRun = options.dryRun !== false  // 默认 true（必须人 review 才入池）
  // 1. 聚类
  const clusters = clusterExperiences(experiences, {
    similarityThreshold: options.similarityThreshold,
  })
  // 2. 生成 SOP
  const sops = generateSOPs(clusters, {
    minOccurrences: options.minOccurrences,
    minConfidence: options.minConfidence,
    maxSteps: options.maxSteps,
    maxSops: options.maxSops,
  })
  // 3. 持久化（默认 dryRun，不真存）
  let saved = null
  if (!dryRun) {
    saved = saveSOPs(sops, { sopFile: options.sopFile })
  }
  return {
    sops,
    clusters,
    saved,
    dryRun,
    stats: {
      experiencesProcessed: experiences.length,
      clustersFormed: clusters.length,
      sopsGenerated: sops.length,
      sopsSaved: saved ? saved.saved : 0,
    },
  }
}

// ─── 5. SOP 状态管理 ───────────────────────────────────────

// 老板 review 后标记 SOP 状态
export function approveSOP(sop, options = {}) {
  return {
    ...sop,
    status: 'approved',
    approvedAt: Date.now(),
    approvedBy: options.approvedBy || 'boss',
  }
}

export function rejectSOP(sop, options = {}) {
  return {
    ...sop,
    status: 'rejected',
    rejectedAt: Date.now(),
    rejectedBy: options.rejectedBy || 'boss',
    reason: options.reason || null,
  }
}

export function listSOPs(sops, options = {}) {
  const list = Array.isArray(sops) ? sops : []
  const filter = options.status || null
  const rows = list.filter(s => !filter || s.status === filter)
  return rows.sort((a, b) => (b.avgConfidence || 0) - (a.avgConfidence || 0))
}

export {
  MIN_OCCURRENCES,
  MIN_CONFIDENCE,
  MAX_STEPS_PER_SOP,
  MAX_SOPS_RETURN,
  STEP_TYPES,
  DEFAULT_SOP_DIR,
  DEFAULT_SOP_FILE,
}
