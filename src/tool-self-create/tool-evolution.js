// tool-evolution.js — 元学习驱动的工具进化决策
//
// 定位：决定"什么时候该创建新工具 / 升级现有工具 / 回滚"。
// 接入 meta-learning：
//   - 失败的 arm（lesson）→ 触发 gap 检测
//   - 高频失败的现有工具 → 触发升级
//   - 长时间不用的工具 → 触发弃用评估
//
// 决策不直接执行工具改动（仍是"建议"），由 meta-controller 串到
// tool-generator / tool-registry 形成闭环。

import { assessRisk } from './tool-spec.js'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_FAILURE_THRESHOLD = 5     // 连续失败次数
const DEFAULT_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_USAGE_FLOOR = 10          // 弃用评估最少调用次数

// ─── 状态 ───────────────────────────────────────────────────

export function defaultState() {
  return {
    version: 1,
    failureLog: [],   // [{ at, toolName, error, signals }]
    proposals: [],    // [{ at, type, toolName, reason, ... }]
  }
}

export function loadState(statePath) {
  // 简单实现（不持久化文件，留接口）
  if (!statePath) return defaultState()
  return defaultState()
}

export function saveState() {
  // 留接口
}

// ─── 失败追踪 ──────────────────────────────────────────────

// 记录一次工具调用失败（meta-controller 失败时调用）
export function recordFailure(state, toolName, error, options = {}) {
  if (!state.failureLog) state.failureLog = []
  state.failureLog.push({
    at: typeof options.now === 'number' ? options.now : Date.now(),
    toolName,
    error: error?.message || String(error),
    signals: options.signals || {},
  })
  // 修剪
  if (state.failureLog.length > 1024) state.failureLog = state.failureLog.slice(-1024)
  return state
}

// 某工具的最近失败次数
export function failureCount(state, toolName, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const windowMs = options.windowMs || DEFAULT_RECENT_WINDOW_MS
  const cutoff = now - windowMs
  return state.failureLog.filter(f => f.toolName === toolName && f.at >= cutoff).length
}

// ─── 决策 1: 探测 gap（缺工具） ───────────────────────────

// 当用户意图没有匹配工具时调用，决定要不要提议创建。
//   options: { intent, existingTools, failureCount, signals }
//   返回: { shouldPropose, reason, suggestedSpec? }
export function detectGap(options = {}) {
  const intent = options.intent || {}
  const existing = options.existingTools || []
  // 已有工具能覆盖 → 不提议
  const covered = existing.some(t => t.name === intent.toolHint || t.tags?.includes(intent.category))
  if (covered) {
    return { shouldPropose: false, reason: 'existing tool can handle' }
  }
  // 缺工具
  const failures = options.failureCount || 0
  // 失败超过阈值 + 类别明确 → 提议
  if (failures >= DEFAULT_FAILURE_THRESHOLD && intent.category) {
    const suggestedSpec = proposeSpecFromIntent(intent)
    return {
      shouldPropose: true,
      reason: `failures ${failures} >= ${DEFAULT_FAILURE_THRESHOLD} for category ${intent.category}`,
      suggestedSpec,
    }
  }
  return { shouldPropose: false, reason: `insufficient failures (${failures})` }
}

function proposeSpecFromIntent(intent) {
  return {
    name: intent.toolHint || `gina_auto_${intent.category || 'custom'}_${Date.now()}`,
    version: '1.0.0',
    description: intent.description || `Auto-generated tool for ${intent.category}`,
    category: intent.category || 'custom',
    inputs: Array.isArray(intent.inputs) ? intent.inputs : [],
    outputs: intent.outputs || { name: 'result', type: 'object', description: 'output' },
    sideEffects: intent.sideEffects || ['none'],
    testCases: Array.isArray(intent.testCases) ? intent.testCases : [{
      name: 'smoke',
      args: [],
      expect: null,
    }],
    tags: intent.tags || [intent.category].filter(Boolean),
    estimatedComplexity: intent.complexity || 3,
  }
}

// ─── 决策 2: 升级现有工具 ─────────────────────────────────

// 当现有工具失败率过高时提议升级。
//   options: { toolName, currentStats, version, lastUpgradeAt }
//   返回: { shouldUpgrade, reason, suggestedBump }
export function shouldUpgrade(options = {}) {
  const stats = options.currentStats || { calls: 0, errors: 0 }
  if (stats.calls < DEFAULT_USAGE_FLOOR) {
    return { shouldUpgrade: false, reason: `not enough usage (${stats.calls} < ${DEFAULT_USAGE_FLOOR})` }
  }
  const errorRate = stats.errors / Math.max(1, stats.calls)
  if (errorRate < 0.05) {
    return { shouldUpgrade: false, reason: `error rate low (${errorRate.toFixed(3)})` }
  }
  if (errorRate > 0.3) {
    return { shouldUpgrade: true, reason: `error rate very high (${errorRate.toFixed(3)})`, suggestedBump: 'major' }
  }
  return { shouldUpgrade: true, reason: `error rate elevated (${errorRate.toFixed(3)})`, suggestedBump: 'minor' }
}

// ─── 决策 3: 弃用评估 ─────────────────────────────────────

// 当工具长时间不用时提议弃用。
//   options: { toolName, lastCallAt, calls }
//   返回: { shouldDeprecate, reason }
export function shouldDeprecate(options = {}) {
  const lastCallAt = options.lastCallAt
  if (!lastCallAt) {
    return { shouldDeprecate: false, reason: 'never called' }
  }
  const calls = options.calls || 0
  if (calls < DEFAULT_USAGE_FLOOR) {
    return { shouldDeprecate: false, reason: `low usage (${calls})` }
  }
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const daysSinceLastCall = (now - new Date(lastCallAt).getTime()) / (1000 * 60 * 60 * 24)
  if (daysSinceLastCall > 90) {
    return { shouldDeprecate: true, reason: `${daysSinceLastCall.toFixed(0)} days since last call` }
  }
  return { shouldDeprecate: false, reason: `recently used (${daysSinceLastCall.toFixed(1)} days ago)` }
}

// ─── 评估总入口 ────────────────────────────────────────────

// 给定工具状态 + 失败日志，给出所有可能动作的列表（按优先级）
//   options: { registry, state, now, intent, existingTools }
//   返回: [{ action, toolName?, reason, priority, ... }]
export function evaluate(options = {}) {
  const proposals = []
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const state = options.state || defaultState()
  const registry = options.registry
  // 1) gap detection
  if (options.intent) {
    const gap = detectGap({
      intent: options.intent,
      existingTools: options.existingTools || (registry ? listToolsFromRegistry(registry) : []),
      failureCount: failureCount(state, options.intent.toolHint, { now }),
    })
    if (gap.shouldPropose) {
      proposals.push({
        action: 'create',
        reason: gap.reason,
        suggestedSpec: gap.suggestedSpec,
        priority: 3,
      })
    }
  }
  // 2) upgrade checks
  if (registry) {
    for (const tool of listToolsFromRegistry(registry)) {
      const up = shouldUpgrade({
        toolName: tool.name,
        currentStats: { calls: tool.calls, errors: tool.errors },
      })
      if (up.shouldUpgrade) {
        proposals.push({
          action: 'upgrade',
          toolName: tool.name,
          reason: up.reason,
          suggestedBump: up.suggestedBump,
          priority: up.suggestedBump === 'major' ? 4 : 2,
        })
      }
      // 3) deprecate checks
      const dep = shouldDeprecate({
        toolName: tool.name,
        lastCallAt: tool.lastCallAt,
        calls: tool.calls,
        now,
      })
      if (dep.shouldDeprecate) {
        proposals.push({
          action: 'deprecate',
          toolName: tool.name,
          reason: dep.reason,
          priority: 1,
        })
      }
    }
  }
  // 按优先级排序
  proposals.sort((a, b) => b.priority - a.priority)
  // 记录
  if (state.proposals) {
    for (const p of proposals) {
      state.proposals.push({ at: now, ...p })
    }
    if (state.proposals.length > 256) state.proposals = state.proposals.slice(-256)
  }
  return proposals
}

function listToolsFromRegistry(registry) {
  const rows = []
  for (const [name, tool] of Object.entries(registry.tools || {})) {
    if (!tool.currentVersion) continue
    const v = tool.versions[tool.currentVersion]
    rows.push({
      name,
      status: v.status,
      calls: v.stats.calls,
      errors: v.stats.errors,
      lastCallAt: v.stats.lastCallAt,
    })
  }
  return rows
}

// ─── 风险评估（导出供外部使用） ────────────────────────────

export { assessRisk }

export function resetForTest() {
  return defaultState()
}

export {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RECENT_WINDOW_MS,
  DEFAULT_USAGE_FLOOR,
}
