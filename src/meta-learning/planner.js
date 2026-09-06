// planner.js — 单步 / 多步决策器（70/30）
//
// 定位：决定"为了达成学习目标需要几步"。
//   'single' 一步到位（成本低，70%）— 大多数情况
//   'multi'  拆 N 步（成本高，30%）— 长期关联 / 高不确定
//
// 决策输入：arm 维度（type/uncertainty/history）+ 上下文（time/cost/difficulty）
//   - type='experiment' 或 'reflection' → 倾向 single（聚焦）
//   - type='curriculum' 或 'architecture' → 倾向 multi（多阶段）
//   - uncertainty > 0.6 → 倾向 multi（探索）
//   - 上次 multi 失败 → 降级到 single
//   - 单步滑动窗口比例 < 70% → 优先补 single

import fs from 'node:fs'
import path from 'node:path'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_SINGLE_RATIO = 0.70
const DEFAULT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_UNCERTAINTY_MULTI = 0.6
const DEFAULT_MAX_MULTI_STEPS = 5
const DEFAULT_MIN_MULTI_STEPS = 2
const SINGLE_TYPES = new Set(['experiment', 'reflection', 'observation', 'metric'])
const MULTI_TYPES = new Set(['curriculum', 'architecture', 'restructure', 'integration'])
const MAX_HISTORY = 1024

// ─── 状态管理 ───────────────────────────────────────────────

export function defaultState(options = {}) {
  return {
    version: 1,
    singleRatio: options.singleRatio ?? DEFAULT_SINGLE_RATIO,
    quotaWindowMs: options.quotaWindowMs ?? DEFAULT_QUOTA_WINDOW_MS,
    maxMultiSteps: options.maxMultiSteps ?? DEFAULT_MAX_MULTI_STEPS,
    minMultiSteps: options.minMultiSteps ?? DEFAULT_MIN_MULTI_STEPS,
    history: [],   // [{ at, mode, steps, armId, outcome }]
  }
}

export function loadState(statePath) {
  if (!statePath) return defaultState()
  try {
    if (!fs.existsSync(statePath)) return defaultState()
    const raw = fs.readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.history)) {
      throw new Error('planner state malformed')
    }
    return { ...defaultState(), ...parsed }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[planner] state load failed, rebuilding:', e.message)
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

function pruneHistory(history, windowMs, now) {
  const cutoff = now - windowMs
  return history.filter(h => typeof h.at === 'number' && h.at >= cutoff)
}

function trimHistory(history, max = MAX_HISTORY) {
  if (history.length <= max) return history
  return history.slice(-max)
}

// ─── 公开 API ───────────────────────────────────────────────

// 决定本次 plan 模式。
//   options: {
//     arm: { id, type, uncertainty },     // type hint
//     context: { lastMultiFailed, costBudget, timeBudgetMs },
//     state, now, forceMode: 'single'|'multi'
//   }
//   返回: { mode: 'single'|'multi', steps, reason, currentSingleRatio }
export function decide(options = {}) {
  const state = options.state || defaultState()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const arm = options.arm || {}
  const ctx = options.context || {}

  // 1) 强制模式优先
  if (options.forceMode === 'single' || options.forceMode === 'multi') {
    const steps = options.forceMode === 'single' ? 1 : clampInt(arm.steps || state.minMultiSteps, state.minMultiSteps, state.maxMultiSteps)
    return {
      mode: options.forceMode,
      steps,
      reason: `forced ${options.forceMode}`,
      currentSingleRatio: singleRatioInWindow(state, now),
    }
  }

  // 2) 上次 multi 失败 → 降级 single（优先检查 state，ctx 覆盖）
  const lastMultiFailedSelf = wasLastMultiFailed(state, now)
  if (ctx.lastMultiFailed === true || (ctx.lastMultiFailed !== false && lastMultiFailedSelf)) {
    return {
      mode: 'single',
      steps: 1,
      reason: 'last multi-step failed → downgraded to single',
      currentSingleRatio: singleRatioInWindow(state, now),
    }
  }

  // 3) 预算不足 → single
  if (typeof ctx.costBudget === 'number' && ctx.costBudget < 0.3) {
    return {
      mode: 'single',
      steps: 1,
      reason: `cost budget low (${ctx.costBudget.toFixed(2)} < 0.3) → single`,
      currentSingleRatio: singleRatioInWindow(state, now),
    }
  }

  // 4) arm type 倾向
  const type = (arm.type || '').toLowerCase()
  let typePref = null
  if (SINGLE_TYPES.has(type)) typePref = 'single'
  else if (MULTI_TYPES.has(type)) typePref = 'multi'

  // 5) 高 uncertainty 倾向 multi
  const uncertainty = clamp01(arm.uncertainty)
  let uncPref = null
  if (uncertainty >= DEFAULT_UNCERTAINTY_MULTI) uncPref = 'multi'
  else if (uncertainty > 0 && uncertainty < 0.3) uncPref = 'single'

  // 6) 当前窗口比例控制
  const currentRatio = singleRatioInWindow(state, now)
  const ratioBelowTarget = currentRatio < state.singleRatio

  // 决策：先看比例（最硬约束），再 type/uncertainty
  let mode = 'single'  // 默认
  let reason = ''

  if (ratioBelowTarget) {
    // 比例不够 → 优先 single
    mode = 'single'
    reason = `single ratio below target (${currentRatio.toFixed(3)} < ${state.singleRatio})`
  } else if (typePref === 'multi' || uncPref === 'multi') {
    mode = 'multi'
    reason = `multi preferred: type=${typePref || 'n/a'}, uncertainty=${uncPref || 'n/a'}`
  } else if (typePref === 'single' || uncPref === 'single') {
    mode = 'single'
    reason = `single preferred: type=${typePref || 'n/a'}, uncertainty=${uncPref || 'n/a'}`
  } else {
    // 默认：看比例
    mode = currentRatio < state.singleRatio ? 'single' : (Math.random() < state.singleRatio ? 'single' : 'multi')
    reason = `default by ratio (${currentRatio.toFixed(3)} vs ${state.singleRatio})`
  }

  // 7) steps
  let steps
  if (mode === 'single') {
    steps = 1
  } else {
    // multi: 2-max
    const requested = typeof arm.steps === 'number' ? arm.steps : state.minMultiSteps
    steps = clampInt(requested, state.minMultiSteps, state.maxMultiSteps)
  }

  return {
    mode,
    steps,
    reason,
    currentSingleRatio: currentRatio,
  }
}

// 记录一次 plan 执行结果
export function recordOutcome(mode, outcome, options = {}) {
  const state = options.state || defaultState()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const steps = clampInt(options.steps || (mode === 'single' ? 1 : 2), 1, state.maxMultiSteps)
  state.history.push({
    at: now,
    mode,
    steps,
    armId: options.armId || null,
    outcome,   // 'success' | 'failure' | 'partial' | 'skipped'
  })
  state.history = trimHistory(pruneHistory(state.history, state.quotaWindowMs, now))
  return state
}

// 当前窗口单步比例
export function singleRatioInWindow(state, now = Date.now()) {
  const recent = pruneHistory(state.history, state.quotaWindowMs, now)
  if (recent.length === 0) return 0
  const singleN = recent.filter(h => h.mode === 'single').length
  return singleN / recent.length
}

// 上次 multi 是否失败
export function wasLastMultiFailed(state, now = Date.now()) {
  const recent = pruneHistory(state.history, state.quotaWindowMs, now)
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].mode === 'multi') {
      return recent[i].outcome === 'failure'
    }
  }
  return false
}

export function resetForTest() {
  return defaultState()
}

export {
  DEFAULT_SINGLE_RATIO,
  DEFAULT_UNCERTAINTY_MULTI,
  SINGLE_TYPES,
  MULTI_TYPES,
  clamp01,
  clampInt,
}
