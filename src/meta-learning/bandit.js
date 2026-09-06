// bandit.js — UCB1 多臂赌博机策略选择器
//
// 定位：从"按课表学"升级为"按策略回报选"。
// 每个 arm 代表一个 learning 策略（或 lesson 单元），
// UCB1 公式: score_i = mean_reward_i + c * sqrt(2 * ln(N) / n_i)
//   - c: 探索系数（默认 sqrt(2)）
//   - N: 总选择次数
//   - n_i: arm i 被选次数
//   - 未被选过的 arm 视为"无限大"，保证每臂至少选 1 次
//
// 状态持久化：JSON 文件，结构 { arms: { armId: { n, sumReward, sumSqReward } }, totalN, c }。
// 调用方提供 statePath；不传则纯函数（不持久化）。
//
// 设计取舍：
//   - 用 mean 而非 mean - lambda*variance（保守 UCB1），让早期信号不被方差惩罚
//   - reward 默认 ∈ [-1, 1]（失败=-1，成功=+1，无变化=0），可由调用方扩展
//   - armId 任意字符串，不做白名单（业务层管理）
//   - 并发安全：state 在调用方序列化（meta-controller 单线程）

import fs from 'node:fs'
import path from 'node:path'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_C = Math.SQRT2                    // 探索系数
const DEFAULT_PRIOR_MEAN = 0                    // 无数据先验
const DEFAULT_PRIOR_N = 0                       // 无数据次数
const INFINITY = Number.POSITIVE_INFINITY
const MAX_STATE_SIZE = 1 << 20                  // 1 MB 防护
const MAX_ARMS = 256                            // 防止 state 爆炸

// ─── 状态管理 ───────────────────────────────────────────────

export function defaultState({ c = DEFAULT_C } = {}) {
  return {
    version: 1,
    c,
    totalN: 0,
    arms: {},   // armId -> { n, sumReward, sumSqReward, lastUpdated }
  }
}

export function loadState(statePath) {
  if (!statePath) return defaultState()
  try {
    if (!fs.existsSync(statePath)) return defaultState()
    const raw = fs.readFileSync(statePath, 'utf8')
    if (raw.length > MAX_STATE_SIZE) {
      throw new Error(`bandit state too large: ${raw.length} bytes (max ${MAX_STATE_SIZE})`)
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.arms) {
      throw new Error('bandit state malformed: missing arms')
    }
    if (Object.keys(parsed.arms).length > MAX_ARMS) {
      throw new Error(`bandit state has too many arms: ${Object.keys(parsed.arms).length} > ${MAX_ARMS}`)
    }
    return parsed
  } catch (e) {
    // 读失败重建（不抛，避免元学习被自己状态损坏永久卡死）
    if (e.code !== 'ENOENT') {
      console.warn('[bandit] state load failed, rebuilding:', e.message)
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

function ensureArm(state, armId) {
  if (!state.arms[armId]) {
    state.arms[armId] = {
      n: DEFAULT_PRIOR_N,
      sumReward: 0,
      sumSqReward: 0,
      lastUpdated: null,
    }
  }
  return state.arms[armId]
}

function armMean(arm) {
  if (!arm || arm.n === 0) return DEFAULT_PRIOR_MEAN
  return arm.sumReward / arm.n
}

function armStddev(arm) {
  if (!arm || arm.n === 0) return 0
  const mean = arm.sumReward / arm.n
  const variance = arm.sumSqReward / arm.n - mean * mean
  return Math.sqrt(Math.max(0, variance))
}

// UCB1 分数：未选过的 arm 返回 Infinity 保证至少选 1 次
function ucb1Score(arm, totalN, c) {
  if (!arm || arm.n === 0) return INFINITY
  const mean = arm.sumReward / arm.n
  if (totalN <= 0) return mean
  return mean + c * Math.sqrt((2 * Math.log(totalN)) / arm.n)
}

// ─── 公开 API ───────────────────────────────────────────────

// 输入候选 arm 列表（字符串 ID），返回 UCB1 选中的 arm。
//   options: { state, excludeArms: [], fallbackArm: 'first' | 'random' }
// state 不传则纯函数（每次新 defaultState），不持久化。
export function select(armIds, options = {}) {
  if (!Array.isArray(armIds) || armIds.length === 0) {
    throw new Error('select() requires non-empty armIds array')
  }
  const state = options.state || defaultState()
  const exclude = new Set(options.excludeArms || [])
  const candidates = armIds.filter(id => !exclude.has(id))
  if (candidates.length === 0) {
    throw new Error('all arms excluded; relax excludeArms or add more candidates')
  }

  // UCB1 选最高分
  let best = null
  let bestScore = -INFINITY
  for (const id of candidates) {
    const arm = state.arms[id] || null
    const score = ucb1Score(arm, state.totalN, state.c)
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return { armId: best, score: bestScore, state }
}

// 反馈：更新 arm 的 reward 统计。
//   reward ∈ [-1, 1] 约定，但代码不强制；异常值会被 clamp。
export function update(armId, reward, options = {}) {
  if (typeof armId !== 'string' || armId.length === 0) {
    throw new Error('update() requires non-empty armId string')
  }
  if (typeof reward !== 'number' || !isFinite(reward)) {
    throw new Error(`update() reward must be finite number, got ${reward}`)
  }
  const state = options.state || defaultState()
  const arm = ensureArm(state, armId)
  // clamp 到 [-1, 1] 防止极端值扭曲 mean
  const r = Math.max(-1, Math.min(1, reward))
  arm.n += 1
  arm.sumReward += r
  arm.sumSqReward += r * r
  arm.lastUpdated = new Date().toISOString()
  state.totalN += 1
  return { armId, reward: r, state }
}

// 取单臂统计
export function getArmStats(armId, options = {}) {
  const state = options.state || defaultState()
  const arm = state.arms[armId] || null
  if (!arm) {
    return { armId, n: 0, mean: 0, stddev: 0, lastUpdated: null }
  }
  return {
    armId,
    n: arm.n,
    mean: armMean(arm),
    stddev: armStddev(arm),
    lastUpdated: arm.lastUpdated,
  }
}

// 取所有 arm 概览（用于上层 dashboard）
export function getOverview(options = {}) {
  const state = options.state || defaultState()
  const rows = []
  for (const [armId, arm] of Object.entries(state.arms)) {
    rows.push({
      armId,
      n: arm.n,
      mean: armMean(arm),
      stddev: armStddev(arm),
      ucb1Score: ucb1Score(arm, state.totalN, state.c),
      lastUpdated: arm.lastUpdated,
    })
  }
  rows.sort((a, b) => b.ucb1Score - a.ucb1Score)
  return {
    totalN: state.totalN,
    c: state.c,
    armCount: rows.length,
    arms: rows,
  }
}

// 测试用：清空 state（不删文件，仅返回新 defaultState）
export function resetForTest() {
  return defaultState()
}

// ─── 内部导出（供其他模块复用 + 测试） ───────────────────────

export {
  ucb1Score,
  armMean,
  armStddev,
  ensureArm,
  DEFAULT_C,
  MAX_ARMS,
  INFINITY,
}
