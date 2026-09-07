// importance-decay.js — 重要性加权衰减
//
// 定位：当前 knowledge-distiller.checkKnowledgeDecay 只看时间 + usageCount，
// 不看 importance（高价值知识被时间冲走）。
//
// 公式：effectiveDecayMs = baseDecayMs * (1 + importance)
//   importance = 0.0 → effectiveDecayMs = 1.0x base（默认）
//   importance = 0.5 → 1.5x（衰减慢 50%）
//   importance = 1.0 → 2.0x（衰减慢 100%，即翻倍）
//
// 与 knowledge-distiller 集成（不破坏现有 API）：
//   - 暴露 importanceDecayMs(knowledge, baseDecayMs) 替代 baseDecayMs
//   - checkKnowledgeDecay 调用方传入 importance
//
// 边界保护：
//   - importance 必须 ∈ [0, 1]，否则 clamp
//   - effectiveDecayMs 必须 ≥ MIN_DECAY_MS（防 0 / 负数）
//   - 不知道 importance 的知识按 importance=0.5 处理（中性）

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_IMPORTANCE = 0.5
const MIN_IMPORTANCE = 0
const MAX_IMPORTANCE = 1
const MIN_DECAY_MS = 1 * 24 * 60 * 60 * 1000  // 最少 1 天

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function clamp(x, lo, hi) {
  if (typeof x !== 'number' || !isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

// 从 knowledge 提取 importance（兼容多种位置）
export function extractImportance(knowledge) {
  if (!knowledge || typeof knowledge !== 'object') return DEFAULT_IMPORTANCE
  // 优先级：knowledge.importance > knowledge.metadata.importance > knowledge.salience > 0.5
  if (typeof knowledge.importance === 'number') return clamp01(knowledge.importance)
  if (typeof knowledge.metadata?.importance === 'number') return clamp01(knowledge.metadata.importance)
  if (typeof knowledge.salience === 'number') return clamp01(knowledge.salience)
  if (typeof knowledge.confidence === 'number') return clamp01(knowledge.confidence)  // fallback
  return DEFAULT_IMPORTANCE
}

// ─── 核心 API ──────────────────────────────────────────────

// 计算单条知识的有效衰减时间（毫秒）
//   options: { baseDecayMs, importance, customMultiplier }
//   customMultiplier: 自定义乘数函数（替换默认 1+importance）
//   返回: effectiveDecayMs（毫秒）
export function importanceDecayMs(knowledge, options = {}) {
  if (!options.baseDecayMs || typeof options.baseDecayMs !== 'number' || options.baseDecayMs <= 0) {
    throw new Error('importanceDecayMs: baseDecayMs required and must be > 0')
  }
  const importance = clamp01(options.importance != null ? options.importance : extractImportance(knowledge))
  let multiplier
  if (typeof options.customMultiplier === 'function') {
    multiplier = options.customMultiplier(importance)
  } else {
    // 默认：1 + importance（线性）
    multiplier = 1 + importance
  }
  const effective = options.baseDecayMs * multiplier
  return Math.max(MIN_DECAY_MS, effective)
}

// 决策某知识是否应该衰减
//   options: { baseDecayMs, now, importance }
//   返回: { shouldDecay, effectiveDecayMs, ageMs, importance, multiplier }
export function shouldDecay(knowledge, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const baseDecayMs = options.baseDecayMs || (30 * 24 * 60 * 60 * 1000)
  const effectiveDecayMs = importanceDecayMs(knowledge, {
    baseDecayMs,
    importance: options.importance,
  })
  const lastUsed = knowledge.lastUsedAt || knowledge.updatedAt || knowledge.createdAt || now
  const ageMs = Math.max(0, now - lastUsed)
  return {
    shouldDecay: ageMs >= effectiveDecayMs,
    effectiveDecayMs,
    ageMs,
    importance: clamp01(options.importance != null ? options.importance : extractImportance(knowledge)),
    multiplier: effectiveDecayMs / baseDecayMs,
  }
}

// 批量应用：过滤出应该衰减的知识
//   options: { baseDecayMs, now }
//   返回: { toDeprecate: [...], toKeep: [...], stats }
export function applyImportanceDecay(knowledgeList, options = {}) {
  const list = Array.isArray(knowledgeList) ? knowledgeList : []
  const toDeprecate = []
  const toKeep = []
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const baseDecayMs = options.baseDecayMs || (30 * 24 * 60 * 60 * 1000)
  let totalImportance = 0
  for (const k of list) {
    const decision = shouldDecay(k, { baseDecayMs, now })
    totalImportance += decision.importance
    if (decision.shouldDecay) {
      toDeprecate.push({ knowledge: k, decision })
    } else {
      toKeep.push({ knowledge: k, decision })
    }
  }
  return {
    toDeprecate,
    toKeep,
    stats: {
      total: list.length,
      deprecating: toDeprecate.length,
      keeping: toKeep.length,
      avgImportance: list.length > 0 ? totalImportance / list.length : 0,
    },
  }
}

// 人类可读解释（debug + UI 显示）
export function explainDecay(knowledge, options = {}) {
  const decision = shouldDecay(knowledge, options)
  const days = Math.round(decision.ageMs / (24 * 60 * 60 * 1000))
  const effDays = Math.round(decision.effectiveDecayMs / (24 * 60 * 60 * 1000))
  const importance = decision.importance
  const importanceLabel = importance >= 0.7 ? '高' : importance >= 0.3 ? '中' : '低'
  return {
    summary: decision.shouldDecay
      ? `${importanceLabel}重要性(${importance.toFixed(2)}) 知识 ${days} 天未用 → 衰减 (${effDays} 天门槛)`
      : `${importanceLabel}重要性(${importance.toFixed(2)}) 知识 ${days} 天未用 → 保留 (${effDays} 天门槛)`,
    decision,
  }
}

// ─── 集成 helper（给 knowledge-distiller 调用） ──────────────

// 包装 checkKnowledgeDecay：传入 importance 让衰减个性化
//   options: { existingKnowledge, baseDecayMs, now }
//   返回: { deprecated: [...], stats: { total, deprecated, avgImportance } }
export function importanceWeightedDecay(knowledgeList, options = {}) {
  const list = Array.isArray(knowledgeList) ? knowledgeList : []
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const baseDecayMs = options.baseDecayMs || (30 * 24 * 60 * 60 * 1000)
  // 只看 active 状态的知识
  const active = list.filter(k => !k.status || k.status === 'active')
  const result = applyImportanceDecay(active, { baseDecayMs, now })
  // 标记 deprecate
  const deprecated = result.toDeprecate.map(({ knowledge, decision }) => ({
    ...knowledge,
    status: 'deprecated',
    decayedAt: now,
    decayReason: 'importance_weighted',
    effectiveDecayMs: decision.effectiveDecayMs,
  }))
  return {
    deprecated,
    stats: {
      total: active.length,
      deprecated: deprecated.length,
      avgImportance: result.stats.avgImportance,
    },
  }
}

export {
  DEFAULT_IMPORTANCE,
  MIN_IMPORTANCE,
  MAX_IMPORTANCE,
  MIN_DECAY_MS,
}
