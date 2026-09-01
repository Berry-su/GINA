/**
 * C-3 集成层初始化（懒加载单例）
 *
 * 风险控制：
 *   - 单例懒加载，首次调用 getIntegration() 时才创建
 *   - 创建失败不抛错（返回 null，让主流程继续）
 *   - 各层 helper 内部都 try/catch 包裹，单层失败不影响其他层
 *
 * 接入模式（最小侵入）：
 *   1) L0: 在 SelfModel.tick() 末尾追加 1 行（已通过 _integrationL0 hook 接入）
 *   2) L1: 在 runtime-injector 末尾追加 1 行
 *   3) L2: 在 memory 写入处追加 1 行
 *   4) L4: 在 ingestion 通路验收（已实现 verifyIngestionPipeline）
 *   5) L5: 在 state-machine._applyTransition 末尾追加 1 行
 *   6) L6: 在 capability-registry register 末尾追加 1 行
 *   7) L7: 在 analyst/integrator score 末尾追加 1 行
 *
 * 主仓内主仓调用方（最小化）：
 *   - src/index.js 启动时调 initIntegration() 一次
 *   - 各层 helper 用 try/catch 调，失败静默
 */

import { createIntegrations } from './index.js'

let _instance = null
let _initError = null

/**
 * 初始化 C-3 集成（懒加载单例）
 * @param {object} options 同 createIntegrations()
 * @returns {object|null} 集成编排器；失败返回 null
 */
export function initIntegration(options = {}) {
  if (_instance) return _instance
  if (_initError) return null  // 已失败过，不再重试
  try {
    _instance = createIntegrations(options)
    return _instance
  } catch (err) {
    _initError = err
    // eslint-disable-next-line no-console
    console.warn('[C-3] initIntegration failed:', err?.message || String(err))
    return null
  }
}

/**
 * 获取已初始化的集成（不自动初始化，需要先调 initIntegration）
 * @returns {object|null}
 */
export function getIntegration() {
  return _instance
}

/**
 * 重置（仅测试用）
 */
export function _resetIntegrationForTest() {
  _instance = null
  _initError = null
}

export default initIntegration
