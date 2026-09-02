// src/monitoring/index.js —— GINA 监控模块 init 入口
//
// 设计哲学（ADR-017）：
//   - 启动时调用 initMonitoring() 一次性初始化
//   - 返回 { metrics, logger, alerter, dashboard, shutdown }
//   - 启动时间、版本自动记录到 metrics
//   - dashboard 默认启动（老板可关）
//   - emotion-isolation 严守：不 import joy-state
//
// 公开 API：
//   initMonitoring(opts?)           → 初始化，返回监控对象
//   shutdownMonitoring()            → 关闭
//   getMonitoring()                 → 已初始化的监控对象（被其他模块引用）
//
// 运行：被 src/index.js 在启动时调用
// 测试：node --test tests/test-monitoring.js

import { getMetrics } from './metrics.js'
import { getLogger } from './logger.js'
import { getAlerter } from './alert.js'
import { startDashboard, stopDashboard, getDashboardStatus } from './dashboard.js'

let _instance = null

const DEFAULT_OPTS = {
  dashboard: {
    enabled: true,
    port: 3000,
    host: '127.0.0.1',
  },
  logger: {
    level: 'info',
  },
  alerter: {
    thresholds: null,  // 用默认
    osascriptEnabled: undefined,  // 自动检测 macOS
  },
  startup: {
    version: null,
    duration_ms: 0,
  },
}

export function initMonitoring(opts = {}) {
  if (_instance) return _instance
  const merged = {
    dashboard: { ...DEFAULT_OPTS.dashboard, ...(opts.dashboard || {}) },
    logger: { ...DEFAULT_OPTS.logger, ...(opts.logger || {}) },
    alerter: { ...DEFAULT_OPTS.alerter, ...(opts.alerter || {}) },
    startup: { ...DEFAULT_OPTS.startup, ...(opts.startup || {}) },
  }
  const startTs = Date.now()

  // 1. logger（最优先，其他模块可写日志）
  const logger = getLogger({ level: merged.logger.level })

  // 2. metrics
  const metrics = getMetrics({ logger })

  // 3. alerter（依赖 metrics + logger）
  const alerter = getAlerter({
    metrics,
    logger,
    thresholds: merged.alerter.thresholds || undefined,
    osascriptEnabled: merged.alerter.osascriptEnabled,
  })

  // 4. dashboard（依赖 metrics）—— 异步 startDashboard 返回 Promise
  if (merged.dashboard.enabled) {
    startDashboard({
      metrics,
      port: merged.dashboard.port,
      host: merged.dashboard.host,
    }).then((r) => {
      const status = getDashboardStatus()
      if (r.ok) {
        logger.info('monitoring', 'dashboard_started', {
          port: r.port,
          host: r.host,
        })
      } else {
        logger.warn('monitoring', 'dashboard_start_failed', { reason: r.reason, error: r.error })
      }
    }).catch((err) => {
      logger.error('monitoring', 'dashboard_start_error', { error_message_safe: String(err).substring(0, 200) })
    })
  }

  // 5. 记录启动
  const duration_ms = merged.startup.duration_ms || (Date.now() - startTs)
  try {
    metrics.recordStartup({
      version: merged.startup.version || (process.env.GINA_VERSION || 'unknown'),
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      duration_ms,
    })
  } catch (err) {
    logger.error('monitoring', 'startup_record_failed', { error_message_safe: String(err).substring(0, 200) })
  }

  // 6. 启动成功 → logger
  logger.info('monitoring', 'startup', {
    version: merged.startup.version || process.env.GINA_VERSION || 'unknown',
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    duration_ms,
  })

  _instance = {
    metrics,
    logger,
    alerter,
    dashboard: {
      status: () => getDashboardStatus(),
      stop: stopDashboard,
    },
    shutdown: shutdownMonitoring,
  }
  return _instance
}

export function getMonitoring() {
  return _instance
}

export function shutdownMonitoring() {
  if (!_instance) return
  try { _instance.logger.info('monitoring', 'shutdown') } catch { /* ignore */ }
  try { _instance.alerter.checkAfterStartup({ success: true }) } catch { /* ignore */ }
  try { stopDashboard() } catch { /* ignore */ }
  try { _instance.metrics.close() } catch { /* ignore */ }
  try { _instance.logger.close() } catch { /* ignore */ }
  _instance = null
}

export { getMetrics, getLogger, getAlerter, startDashboard, stopDashboard, getDashboardStatus }
