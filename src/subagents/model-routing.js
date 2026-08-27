/**
 * subagents/model-routing.js — 模型隐私路由（P4）
 *
 * 配合「本地大模型 + 云端 LLM 自由切换，保护用户隐私」的硬约束：
 *   - 本地模型（Ollama / LM Studio 等 OpenAI 兼容端点）作为一等公民；
 *   - 按数据隐私级别路由：private 数据只走本地模型，public 才允许上云端；
 *   - 支持手动强制（本地优先 / 云端优先 / 自动按隐私）三档。
 *
 * 依赖 config.js 已有的 custom provider 机制（可设任意 baseURL + model + apiKey='none'），
 * 不重造切换逻辑，只在其上叠加「隐私 → 模型」的路由决策层。
 *
 * 本模块是纯决策层：routeFor() 只返回应使用的 provider 选择，不直接改全局 config。
 * 真正切换由调用方通过 config.js 的 switchProviderConfig / switchModel 执行。
 */

import { config } from '../config.js'
import { PRIVACY_LEVELS } from './protocol.js'

/** 路由档位 */
export const ROUTING_MODES = Object.freeze({
  LOCAL_ONLY: 'local_only',   // 强制本地（隐私最严，所有数据走本地）
  CLOUD_ONLY: 'cloud_only',   // 强制云端（用户明确允许）
  AUTO: 'auto',               // 自动：private→本地，public→云端
})

/** 本地模型默认配置（Ollama 常见端点，可覆盖） */
export const DEFAULT_LOCAL_MODEL = Object.freeze({
  baseURL: 'http://localhost:11434/v1',
  model: 'qwen2.5',
  apiKey: 'none', // Ollama 本地无需 key
})

/**
 * 根据数据隐私级别决定应使用的模型路由。
 * @param {string} privacy PRIVACY_LEVELS 之一（public/private）
 * @param {{mode?: string, localAvailable?: boolean}} [options]
 * @returns {{target:'local'|'cloud', reason:string}}
 */
export function routeFor(privacy, { mode = ROUTING_MODES.AUTO, localAvailable = true } = {}) {
  if (mode === ROUTING_MODES.LOCAL_ONLY) {
    return { target: 'local', reason: 'local_only 模式，全部走本地模型' }
  }
  if (mode === ROUTING_MODES.CLOUD_ONLY) {
    return { target: 'cloud', reason: 'cloud_only 模式，用户明确允许上云端' }
  }
  // auto：private 必须走本地；本地不可用时降级并显式标注（宁可不答，也不把敏感数据送上云）
  if (privacy === PRIVACY_LEVELS.PRIVATE) {
    if (localAvailable) return { target: 'local', reason: 'private 数据，走本地模型保护隐私' }
    return { target: 'local', reason: 'private 数据且本地模型不可用 → 拒绝上云，应由调用方决定降级或阻断' }
  }
  return { target: 'cloud', reason: 'public 数据，可走云端 LLM' }
}

/**
 * 判断一段数据是否含敏感（private）标记。
 * 设备事件默认带 `_privacy: private`；无标记视为 public。
 * @param {object} data
 * @returns {string} PRIVACY_LEVELS 之一
 */
export function privacyOf(data = {}) {
  const p = data?._privacy ?? data?.privacy
  return p === PRIVACY_LEVELS.PRIVATE ? PRIVACY_LEVELS.PRIVATE : PRIVACY_LEVELS.PUBLIC
}

/**
 * 扫描一段文本/结构里是否混入 private 数据（保守判定：出现敏感字段名即视为 private）。
 * 用于「一批混合数据喂给 LLM 前」的隐私门：只要混入 private，整批按 private 路由。
 */
const SENSITIVE_KEYS = /(home|location|health|battery|pose|vehicle|family|contact|email_body|account|password|token|secret)/i
export function containsPrivateData(payload) {
  if (payload == null) return false
  if (typeof payload === 'string') return false // 纯文本不靠字段名判敏感，由调用方显式标 privacy
  if (Array.isArray(payload)) return payload.some(containsPrivateData)
  if (typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload)) {
      if (SENSITIVE_KEYS.test(k)) return true
      if (v && typeof v === 'object' && containsPrivateData(v)) return true
    }
  }
  return false
}

/** 当前全局 config 是否已指向本地（custom + localhost 端点）。 */
export function isLocalActive() {
  const base = String(config.baseURL || '').toLowerCase()
  return config.provider === 'custom' && (base.includes('localhost') || base.includes('127.0.0.1') || base.includes(':11434'))
}

/** 取路由快照（供诊断/设置页展示）。 */
export function getRoutingStatus(localAvailable = true) {
  return {
    mode: ROUTING_MODES.AUTO,
    local_configured: isLocalActive(),
    local_available: localAvailable,
    default_local: DEFAULT_LOCAL_MODEL,
  }
}
