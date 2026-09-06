// meta-controller.js — 元学习编排器
//
// 定位：把 trigger / bandit / planner / reflection 串成一条 GINA 自进化主回路。
//
// 流程（每个 cycle）：
//   1. trigger.decide()    — 决定是否跑 + 主动/被动
//   2. candidates         — 提供候选 arm 列表（lesson 单元）
//   3. bandit.select()    — UCB1 选最优 arm
//   4. planner.decide()   — 单步/多步
//   5. runStep()          — 实际执行 arm（由调用方注入 executeArm）
//   6. reflection.run()   — 失败时反思（按 depth）
//   7. bandit.update()    — 反馈 reward
//   8. ab.recordMetric()  — A/B 框架记录（可选）
//
// 闭环：失败 → reflection → bandit 更新 → 下次 UCB1 倾向其他 arm。
//
// 与 self-learning.js 关系：本模块是 v2，保留旧 v1 接口（不破坏），
// 通过 runMetaLearningCycle() 暴露新能力，runLearningCycle() 仍可单独用。

import fs from 'node:fs'
import path from 'node:path'
import { runLearningCycle as v1RunLearningCycle, markLessonDone as v1MarkLessonDone, DIRECTIONS, pickNextLesson, findGaps } from '../memory/self-learning.js'
import { decideDepth, recordUsage, buildPrompt, getBudgetSnapshot, defaultState as reflectionDefault, loadState as reflectionLoad, saveState as reflectionSave } from './reflection.js'
import { decide as triggerDecide, defaultState as triggerDefault, loadState as triggerLoad, saveState as triggerSave, activeRatioInWindow } from './trigger.js'
import { decide as plannerDecide, recordOutcome, singleRatioInWindow, defaultState as plannerDefault, loadState as plannerLoad, saveState as plannerSave } from './planner.js'
import { select as banditSelect, update as banditUpdate, getOverview as banditOverview, defaultState as banditDefault, loadState as banditLoad, saveState as banditSave } from './bandit.js'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_REWARD = { success: 1, partial: 0.3, failure: -1, skipped: 0 }
const DEFAULT_EXECUTE_TIMEOUT_MS = 30_000
const CYCLE_LOG_RETENTION = 256

// ─── 状态（orchestrator 自己的状态：cycle log + 启动时间） ───

export function defaultControllerState() {
  return {
    version: 1,
    cycles: [],     // 最近 N 个 cycle 摘要
    startedAt: new Date().toISOString(),
  }
}

export function loadControllerState(statePath) {
  if (!statePath) return defaultControllerState()
  try {
    if (!fs.existsSync(statePath)) return defaultControllerState()
    const raw = fs.readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cycles)) {
      throw new Error('meta-controller state malformed')
    }
    return { ...defaultControllerState(), ...parsed }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[meta-controller] state load failed, rebuilding:', e.message)
    }
    return defaultControllerState()
  }
}

export function saveControllerState(state, statePath) {
  if (!statePath) return
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const tmp = statePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, statePath)
}

// ─── 内部工具 ───────────────────────────────────────────────

function trimCycles(cycles, max = CYCLE_LOG_RETENTION) {
  if (cycles.length <= max) return cycles
  return cycles.slice(-max)
}

function outcomeFromExecute(result) {
  if (!result) return 'failure'
  if (result.skipped) return 'skipped'
  if (result.success === true) return 'success'
  if (result.success === false) return 'failure'
  if (result.partial === true) return 'partial'
  return 'failure'
}

function rewardFromOutcome(outcome) {
  return DEFAULT_REWARD[outcome] ?? 0
}

// ─── 公开 API ───────────────────────────────────────────────

// 主入口：跑一次元学习 cycle。
//   options: {
//     // 数据
//     signals: { failure, feedback, emotion, satisfaction, taskFailed, userFrustrated },
//     candidates: [armId, ...] | { getCandidates: () => [...] },
//     // 注入
//     executeArm: async (armId, plan) => { success, partial, skipped, signal, output, ... },
//     // 状态路径（不传则纯函数）
//     paths: { bandit, trigger, planner, reflection, controller },
//     // 框架集成
//     ab: { recordMetric, assignVariant } | null,
//     abExpName: string,
//     // 控制
//     now, forceActive, forcePassive, forceMode,
//   }
//   返回: { mode, armId, plan, reflection, outcome, reward, cycleLog, skipped }
export async function runMetaLearningCycle(options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const paths = options.paths || {}

  // 加载各模块 state
  const triggerState = triggerLoad(paths.trigger)
  const plannerState = plannerLoad(paths.planner)
  const reflectionState = reflectionLoad(paths.reflection)
  const banditState = banditLoad(paths.bandit)
  const ctrlState = loadControllerState(paths.controller)

  // 1) 触发决策
  const triggerResult = triggerDecide({
    signals: options.signals || {},
    state: triggerState,
    now,
    forceActive: options.forceActive,
    forcePassive: options.forcePassive,
  })

  if (triggerResult.mode === 'skip') {
    const cycleLog = {
      at: now,
      mode: 'skip',
      reason: triggerResult.reason,
      signal: triggerResult.signal,
    }
    ctrlState.cycles = trimCycles([...ctrlState.cycles, cycleLog])
    saveControllerState(ctrlState, paths.controller)
    saveState(paths, { trigger: triggerState, planner: plannerState, reflection: reflectionState, bandit: banditState })
    return { skipped: true, reason: triggerResult.reason, mode: 'skip', cycleLog }
  }

  // 2) 候选 arm
  const candidates = Array.isArray(options.candidates)
    ? options.candidates
    : (typeof options.candidates?.getCandidates === 'function' ? options.candidates.getCandidates() : [])
  if (candidates.length === 0) {
    const cycleLog = {
      at: now,
      mode: triggerResult.mode,
      reason: `${triggerResult.reason}; no candidates → skip`,
    }
    ctrlState.cycles = trimCycles([...ctrlState.cycles, cycleLog])
    saveControllerState(ctrlState, paths.controller)
    saveState(paths, { trigger: triggerState, planner: plannerState, reflection: reflectionState, bandit: banditState })
    return { skipped: true, reason: 'no candidates', mode: triggerResult.mode, cycleLog }
  }

  // 3) UCB1 选 arm
  const banditPick = banditSelect(candidates, { state: banditState })

  // 4) 计划决策
  const arm = { id: banditPick.armId, type: options.armTypes?.[banditPick.armId] || null, uncertainty: options.armUncertainty?.[banditPick.armId] || 0, steps: options.armSteps?.[banditPick.armId] || null }
  const lastMultiFailed = wasLastMultiFailed(plannerState, now)
  const plan = plannerDecide({
    arm,
    context: { lastMultiFailed, costBudget: options.costBudget, timeBudgetMs: options.timeBudgetMs },
    state: plannerState,
    now,
    forceMode: options.forceMode,
  })

  // 5) 执行（异步 + 异常兜底）
  let executeResult = null
  let executeError = null
  try {
    if (typeof options.executeArm === 'function') {
      executeResult = await options.executeArm(banditPick.armId, plan)
    } else {
      executeResult = { skipped: true, reason: 'no executeArm injected (dry-run)' }
    }
  } catch (e) {
    executeError = e
    executeResult = { success: false, error: e.message || String(e) }
  }

  // 6) 反思（按 depth）
  const failureSignal = computeFailureSignal(executeResult, options.signals)
  const depthDecision = decideDepth({
    signal: failureSignal,
    state: reflectionState,
    now,
  })
  let reflectionResult = null
  if (depthDecision.depth >= 1 && (depthDecision.signal > 0 || plan.mode === 'multi')) {
    const prompt = buildPrompt({
      depth: depthDecision.depth,
      event: { armId: banditPick.armId, plan, executeResult, executeError: executeError?.message },
      context: { signals: options.signals, plan },
      recentReflections: extractRecentReflections(ctrlState, 3),
    })
    reflectionResult = {
      depth: depthDecision.depth,
      reason: depthDecision.reason,
      prompt: prompt.combinedPrompt,
      estTokens: prompt.estTokens,
      budgetRemaining: depthDecision.budgetRemaining,
    }
    recordUsage(depthDecision.depth, prompt.estTokens, { state: reflectionState, now })
  }

  // 7) outcome + reward
  const outcome = executeError ? 'failure' : outcomeFromExecute(executeResult)
  const reward = rewardFromOutcome(outcome)
  banditUpdate(banditPick.armId, reward, { state: banditState })
  recordOutcome(plan.mode, outcome, { state: plannerState, now, steps: plan.steps, armId: banditPick.armId })

  // 8) A/B 框架记录（可选）
  if (options.ab && typeof options.ab.recordMetric === 'function' && options.abExpName) {
    try {
      options.ab.recordMetric({
        expName: options.abExpName,
        userId: banditPick.armId,
        metricName: 'meta_learning_reward',
        value: reward,
      })
    } catch (e) {
      // A/B 失败不阻塞主流程
      console.warn('[meta-controller] ab.recordMetric failed:', e.message)
    }
  }

  // 9) cycle log
  const cycleLog = {
    at: now,
    mode: triggerResult.mode,
    armId: banditPick.armId,
    plan,
    outcome,
    reward,
    depth: depthDecision.depth,
    reflectionRan: reflectionResult !== null,
    error: executeError?.message || null,
  }
  ctrlState.cycles = trimCycles([...ctrlState.cycles, cycleLog])

  // 持久化
  saveControllerState(ctrlState, paths.controller)
  saveState(paths, { trigger: triggerState, planner: plannerState, reflection: reflectionState, bandit: banditState })

  return {
    skipped: false,
    mode: triggerResult.mode,
    armId: banditPick.armId,
    plan,
    executeResult,
    executeError: executeError?.message || null,
    outcome,
    reward,
    reflection: reflectionResult,
    cycleLog,
  }
}

// ─── 概览（dashboard） ──────────────────────────────────────

// 一次性取所有模块概览
export function getMetaOverview(options = {}) {
  const paths = options.paths || {}
  return {
    bandit: banditOverview({ state: banditLoad(paths.bandit) }),
    trigger: {
      activeRatio: activeRatioInWindow(triggerLoad(paths.trigger), options.now),
    },
    planner: {
      singleRatio: singleRatioInWindow(plannerLoad(paths.planner), options.now),
    },
    reflection: getBudgetSnapshot({ state: reflectionLoad(paths.reflection), now: options.now }),
    controller: {
      cycleCount: loadControllerState(paths.controller).cycles.length,
      lastCycle: loadControllerState(paths.controller).cycles.slice(-1)[0] || null,
    },
  }
}

// 兼容旧 v1 接口（不破坏 self-learning.js 旧调用方）
export function runLearningCycle(options = {}) {
  return v1RunLearningCycle(options)
}

export function markLessonDone(learnDir, lineId, lessonName) {
  return v1MarkLessonDone(learnDir, lineId, lessonName)
}

export function resetForTest() {
  return defaultControllerState()
}

// ─── 内部辅助 ───────────────────────────────────────────────

function saveState(paths, states) {
  if (states.trigger) triggerSave(states.trigger, paths.trigger)
  if (states.planner) plannerSave(states.planner, paths.planner)
  if (states.reflection) reflectionSave(states.reflection, paths.reflection)
  if (states.bandit) banditSave(states.bandit, paths.bandit)
}

function wasLastMultiFailed(plannerState, now) {
  const recent = (plannerState.history || []).filter(h => typeof h.at === 'number' && h.at > now - plannerState.quotaWindowMs)
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].mode === 'multi') return recent[i].outcome === 'failure'
  }
  return false
}

function computeFailureSignal(executeResult, signals) {
  // 综合：executeResult 失败 + signals 中的负面信号
  if (!executeResult) return 0
  if (executeResult.skipped) return 0
  if (executeResult.success === true) return 0
  if (executeResult.partial === true) {
    const s = signals || {}
    return Math.max(0.3, s.failure || 0, s.feedback || 0)
  }
  // 失败
  const s = signals || {}
  return Math.max(0.7, s.failure || 0, s.feedback || 0, s.userFrustrated || 0)
}

function extractRecentReflections(ctrlState, n = 3) {
  const recent = (ctrlState.cycles || []).slice(-n)
  return recent.map(c => ({
    at: c.at,
    armId: c.armId,
    outcome: c.outcome,
    reward: c.reward,
    depth: c.depth,
  }))
}

export {
  banditDefault,
  banditLoad,
  banditSave,
  banditSelect,
  banditUpdate,
  banditOverview,
  triggerDefault,
  triggerLoad,
  triggerSave,
  triggerDecide,
  plannerDefault,
  plannerLoad,
  plannerSave,
  plannerDecide,
  reflectionDefault,
  reflectionLoad,
  reflectionSave,
  decideDepth,
  recordUsage,
  buildPrompt,
  getBudgetSnapshot,
  DIRECTIONS,
  pickNextLesson,
  findGaps,
}
