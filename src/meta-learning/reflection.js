// reflection.js — 自适应反思深度控制器（1-3 层）
//
// 定位：失败信号越强 → 反思越深，但 token 预算可控。
//   depth=1: 单事件反思（why did this fail?）
//   depth=2: 关联反思（什么模式触发了这个失败？）
//   depth=3: 根因反思（决策链路哪里断了？）
//
// 决策规则（基于失败强度 signal ∈ [0, 1]）：
//   signal >= 0.7 → depth=3（高严重度 / 重复失败 / 关键路径）
//   signal >= 0.3 → depth=2（中等 / 偶发）
//   signal  < 0.3 → depth=1（低 / 噪声）
//
// 成本控制：每 24h 累计 token 预算（默认 50K），超出则强制 depth=1。
//
// 与 reflection-executor 关系：本模块只决定"反思多深 + 写到哪里"，
// 具体反思文本生成由调用方注入（generateReflectionText），避免硬编码 LLM 逻辑。

import fs from 'node:fs'
import path from 'node:path'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_BUDGET_TOKENS = 50000            // 24h 反思 token 预算
const DEFAULT_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000
const SIGNAL_DEPTH_THRESHOLDS = [0.3, 0.7]    // 阈值表：>=0.3 → 2 层, >=0.7 → 3 层
const DEPTHS = [1, 2, 3]
const MAX_REFLECTION_LEN = 8000
const DEFAULT_TOKEN_ESTIMATE = { 1: 200, 2: 600, 3: 1500 }  // 每层 token 估算

// 失败强度信号：调用方传 0-1 数值；可叠加多个
//   repetitionRate: 同类失败最近 N 次的比例
//   severity: 单次失败严重度（用户显式不满/任务中断）
//   criticality: 失败路径关键度（核心流程 vs 边缘）

// ─── 状态管理 ───────────────────────────────────────────────

export function defaultState({ budgetTokens = DEFAULT_BUDGET_TOKENS, budgetWindowMs = DEFAULT_BUDGET_WINDOW_MS } = {}) {
  return {
    version: 1,
    budgetTokens,
    budgetWindowMs,
    usage: [],   // [{ at, depth, tokens }]
    lastResetAt: null,
  }
}

export function loadState(statePath) {
  if (!statePath) return defaultState()
  try {
    if (!fs.existsSync(statePath)) return defaultState()
    const raw = fs.readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.usage)) {
      throw new Error('reflection state malformed')
    }
    return {
      ...defaultState(),
      ...parsed,
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[reflection] state load failed, rebuilding:', e.message)
    }
    return defaultState()
  }
}

export function saveState(state, statePath) {
  if (!statePath) return
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const tmp = statePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, statePath)
}

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function clampInt(x, lo, hi) {
  if (typeof x !== 'number' || !isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, Math.floor(x)))
}

// 把绝对时间戳转换为"过去 N 毫秒"的形式
function pruneUsage(usage, windowMs, now) {
  const cutoff = now - windowMs
  return usage.filter(u => typeof u.at === 'number' && u.at >= cutoff)
}

// 计算最近窗口累计 token 使用
function windowedUsage(state, now = Date.now()) {
  const usage = pruneUsage(state.usage, state.budgetWindowMs, now)
  return usage.reduce((sum, u) => sum + (u.tokens || 0), 0)
}

// 估计单次反思 token 成本
function estimateTokens(depth) {
  return DEFAULT_TOKEN_ESTIMATE[depth] || 500
}

// ─── 公开 API ───────────────────────────────────────────────

// 决定反思深度。
//   options: { signal, repetitionRate, severity, criticality, state, now }
//   返回: { depth, reason, budgetRemaining, forced }
export function decideDepth(options = {}) {
  const state = options.state || defaultState()
  const now = typeof options.now === 'number' ? options.now : Date.now()

  // 1) 聚合失败信号（取 max）
  const signal = clamp01(
    Math.max(
      clamp01(options.signal),
      clamp01(options.repetitionRate),
      clamp01(options.severity),
      clamp01(options.criticality),
    ),
  )

  // 2) 按阈值选目标 depth
  let target = 1
  let reason = 'low signal'
  if (signal >= SIGNAL_DEPTH_THRESHOLDS[1]) {
    target = 3
    reason = `high signal (${signal.toFixed(2)} >= ${SIGNAL_DEPTH_THRESHOLDS[1]})`
  } else if (signal >= SIGNAL_DEPTH_THRESHOLDS[0]) {
    target = 2
    reason = `medium signal (${signal.toFixed(2)} >= ${SIGNAL_DEPTH_THRESHOLDS[0]})`
  }

  // 3) 预算检查：超额则强制降级到 depth=1
  const used = windowedUsage(state, now)
  const budgetRemaining = Math.max(0, state.budgetTokens - used)
  let forced = false
  let finalDepth = target
  if (used >= state.budgetTokens) {
    finalDepth = 1
    forced = true
    reason += '; budget exhausted → forced depth=1'
  } else if (estimateTokens(target) > budgetRemaining) {
    // 单次成本超出剩余预算：降级到能负担的最大 depth
    for (let d = target - 1; d >= 1; d--) {
      if (estimateTokens(d) <= budgetRemaining) {
        finalDepth = d
        forced = true
        reason += `; budget tight (${budgetRemaining} < ${estimateTokens(target)}) → depth=${d}`
        break
      }
    }
  }

  return {
    depth: finalDepth,
    target,
    signal,
    reason,
    budgetRemaining,
    budgetUsed: used,
    forced,
  }
}

// 记录一次反思的 token 使用（成功执行后调用）。
//   options: { depth, tokens, state, now }
//   返回: 新 state
export function recordUsage(depth, tokens, options = {}) {
  if (!DEPTHS.includes(depth)) {
    throw new Error(`recordUsage depth must be one of ${DEPTHS}, got ${depth}`)
  }
  const t = typeof tokens === 'number' && tokens > 0 ? Math.floor(tokens) : estimateTokens(depth)
  const state = options.state || defaultState()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  state.usage.push({ at: now, depth, tokens: t })
  // 清理过期 usage 避免文件膨胀
  state.usage = pruneUsage(state.usage, state.budgetWindowMs, now)
  state.lastResetAt = now
  return state
}

// 生成反思 prompt 模板（按 depth 分层）。不调 LLM；调用方拿到 prompt 自行调。
//   options: { depth, event, context, recentReflections }
//   返回: { depth, prompts: [...], combinedPrompt }
export function buildPrompt(options = {}) {
  const depth = clampInt(options.depth, 1, 3)
  const event = options.event || {}
  const ctx = options.context || {}
  const recent = Array.isArray(options.recentReflections) ? options.recentReflections : []

  const prompts = []
  // depth 1 永远包含
  prompts.push({
    layer: 1,
    role: 'event',
    prompt: `对以下事件做单点反思：\n${JSON.stringify(event, null, 2).slice(0, 2000)}`,
  })
  if (depth >= 2) {
    prompts.push({
      layer: 2,
      role: 'pattern',
      prompt: `结合最近的反思记录，识别共性模式：\n最近反思: ${JSON.stringify(recent.slice(-3), null, 2).slice(0, 1500)}\n上下文: ${JSON.stringify(ctx, null, 2).slice(0, 1000)}`,
    })
  }
  if (depth >= 3) {
    prompts.push({
      layer: 3,
      role: 'root_cause',
      prompt: `深挖决策链路：哪一步假设错了？哪一步可被前置检测到？给出可执行改进（不超 200 字）。`,
    })
  }

  const combinedPrompt = prompts.map(p => `[Layer ${p.layer}: ${p.role}]\n${p.prompt}`).join('\n\n')
  const truncated = combinedPrompt.length > MAX_REFLECTION_LEN
    ? combinedPrompt.slice(0, MAX_REFLECTION_LEN) + '\n... [truncated]'
    : combinedPrompt

  return { depth, prompts, combinedPrompt: truncated, estTokens: estimateTokens(depth) }
}

// 测预算快照
export function getBudgetSnapshot(options = {}) {
  const state = options.state || defaultState()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const used = windowedUsage(state, now)
  return {
    budgetTokens: state.budgetTokens,
    budgetUsed: used,
    budgetRemaining: Math.max(0, state.budgetTokens - used),
    windowMs: state.budgetWindowMs,
    entries: pruneUsage(state.usage, state.budgetWindowMs, now).length,
  }
}

export function resetForTest() {
  return defaultState()
}

export {
  DEFAULT_TOKEN_ESTIMATE,
  SIGNAL_DEPTH_THRESHOLDS,
  DEPTHS,
}
