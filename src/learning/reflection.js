// src/learning/reflection.js —— 反思模块（C-4.6 · ADR-003 §3.2.6）
//
// 设计哲学（2026-09-01 老板拍板）：
//   - 反思 = 主循环捕获"失败/教训" → 写经验 → CATS-Net 联动 concept salience
//   - direction 领域失败 → 反思深度 ×2（contextWindow=2, 抓更多对话上下文）
//   - affective-state 严格隔离：refl() 接收 affective 输入时忽略（老板 9-01 拍板 affective 不进决策路径）
//   - 失败静默：经验库写失败不抛错，不影响主流程
//
// 触发点：
//   - L6.recordCall 失败 + directionMatched=true → ctx.reflectionHook()
//   - L1.recordInjection 失败（外部捕获 + direction 领域） → refl()
//   - 显式调用：refl({ trigger, action, result, learned, confidence, directionMatch })
//
// 持久化：复用 src/experience/library.js（directionMatch 字段 + direction_stats 列）
// 关联 ADR-003 §3.2.6

import { getExperienceLibrary, resetExperienceLibraryForTest } from '../experience/library.js'
import { getDirectionController, resetDirectionControllerForTest } from './direction.js'

/** direction 领域反思深度（contextWindow 倍数） */
export const REFLECTION_DEPTH_DIRECTION = 2.0

/** 基础反思深度（contextWindow 倍数） */
export const REFLECTION_DEPTH_BASE = 1.0

/** 反思触发最低 confidence 门槛 */
const REFLECTION_MIN_CONFIDENCE = 0.3

/**
 * 反思主入口（fire-and-forget，不阻塞主循环）
 *
 * @param {object} opts
 * @param {string} opts.trigger 触发场景描述（必填，>= 2 字符）
 * @param {string} opts.action 当时做的动作（必填）
 * @param {string} opts.result 当时的结果（必填）
 * @param {string} opts.learned 学到的教训（必填）
 * @param {number} [opts.confidence=0.5] 反思置信度
 * @param {boolean} [opts.directionMatch=false] 是否属于 direction 领域
 * @param {number} [opts.contextWindow=1.0] 上下文窗口倍数（direction 领域失败默认 ×2）
 * @param {string[]} [opts.relatedConcepts=[]] 关联 CATS-Net 概念
 * @param {number} [opts.ts=Date.now()] 反思时间戳
 * @param {object} [opts.library] 可选经验库实例（不传走单例）
 * @returns {number} experience row id（失败 -1）
 */
export function refl({
  trigger,
  action,
  result,
  learned,
  confidence = 0.5,
  directionMatch = false,
  contextWindow = REFLECTION_DEPTH_BASE,
  relatedConcepts = [],
  ts = Date.now(),
  library = null,
} = {}) {
  // 防御：必填字段缺失
  if (!trigger || !action || !result || !learned) {
    return -1
  }
  const trig = String(trigger).slice(0, 500)
  const conf = Math.max(0, Math.min(1, Number(confidence) || 0.5))
  if (conf < REFLECTION_MIN_CONFIDENCE) return -1

  // direction 领域失败时反思深度自动 ×2（覆盖传入值）
  const effectiveWindow = directionMatch === true ? REFLECTION_DEPTH_DIRECTION : contextWindow
  const lib = library || getExperienceLibrary()
  if (!lib || typeof lib.record !== 'function') return -1

  try {
    const id = lib.record({
      trigger: trig,
      action: String(action).slice(0, 500),
      result: String(result).slice(0, 500),
      learned: String(learned).slice(0, 1000),
      confidence: conf,
      source: 'reflection',
      relatedConcepts: Array.isArray(relatedConcepts) ? relatedConcepts : [],
      directionMatch: directionMatch === true,
      contextWindow: effectiveWindow,
    })
    return Number(id) || -1
  } catch {
    return -1
  }
}

/**
 * L6 工具失败反思回调（接 ctx.reflectionHook）
 * 内部调 refl() + 标 directionMatch
 *
 * @param {object} payload
 * @param {string} payload.trigger
 * @param {string} payload.action
 * @param {string} payload.result
 * @param {string} payload.learned
 * @param {number} payload.confidence
 * @param {boolean} payload.directionMatch
 * @param {number} payload.contextWindow
 * @param {string[]} payload.relatedConcepts
 * @param {number} payload.ts
 * @param {object} [payload.library] 可选经验库
 * @returns {number} experience id（-1 表示未写入）
 */
export function reflectOnToolFailure(payload = {}) {
  return refl({
    trigger: payload.trigger,
    action: payload.action,
    result: payload.result,
    learned: payload.learned,
    confidence: payload.confidence,
    directionMatch: payload.directionMatch === true,
    contextWindow: payload.contextWindow,
    relatedConcepts: payload.relatedConcepts,
    ts: payload.ts,
    library: payload.library || null,
  })
}

/**
 * L1 ACI 注入决策反思回调（接 L1 hot path 失败路径）
 * 当前实现：仅在 direction 领域 + 严重错误时触发反思，避免 L1 注入噪声爆经验库
 *
 * @param {object} payload
 * @returns {number} experience id（-1 表示未写入）
 */
export function reflectOnL1Failure(payload = {}) {
  if (!payload || !payload.directionMatch) return -1
  return refl({
    trigger: payload.trigger || `aci_failure:${payload.strategy || 'unknown'}`,
    action: payload.action || `aci_inject(${payload.strategy || 'unknown'})`,
    result: payload.result || 'failed',
    learned: payload.learned || `方向领域 ACI 注入失败（${payload.strategy || 'unknown'}），需复盘策略选择`,
    confidence: payload.confidence || 0.4,
    directionMatch: true,
    contextWindow: REFLECTION_DEPTH_DIRECTION,
    relatedConcepts: payload.relatedConcepts || [],
    ts: payload.ts,
    library: payload.library || null,
  })
}

/**
 * 给 ctx.reflectionHook 装一个 L6 失败反思的默认回调
 * 工厂函数：在主循环初始化时调一次，返回 function(payload) => reflectOnToolFailure(payload)
 *
 * @returns {function}
 */
export function createToolFailureReflectionHook() {
  return function defaultL6ReflectionHook(payload) {
    return reflectOnToolFailure(payload || {})
  }
}

/**
 * 反思模块自身 reset（仅测试用）
 */
export function resetReflectionForTest() {
  resetExperienceLibraryForTest()
  // 同步 reset direction 单例（避免跨测试污染）
  try {
    resetDirectionControllerForTest()
  } catch {
    // 静默
  }
}

export const REFLECTION_CONSTANTS = Object.freeze({
  REFLECTION_DEPTH_DIRECTION,
  REFLECTION_DEPTH_BASE,
  REFLECTION_MIN_CONFIDENCE,
})
