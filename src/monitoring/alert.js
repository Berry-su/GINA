// src/monitoring/alert.js —— GINA 阈值告警（macOS 系统通知 + Electron Notification）
//
// 设计哲学（ADR-017）：
//   - 错误率 > 5% / P95 > 1s / 启动失败 → 触发告警
//   - macOS osascript 弹系统通知
//   - Electron Notification 弹桌面通知
//   - 不外发任何 HTTP/Slack/邮件/webhook
//   - 同类告警 5 分钟内不重复（cooldown）
//   - emotion-isolation 严守：不 import joy-state
//
// 公开 API：
//   getAlerter(opts?)              → Alerter 单例
//   alerter.checkAfterCall({ module, duration_ms, success })
//   alerter.checkAfterStartup({ success, error })
//   alerter.getAlerts({ limit })   → 告警历史
//   alerter.setThresholds({ ... })
//
// 运行：被 src/monitoring/index.js 在启动时调用
// 测试：node --test tests/test-monitoring.js

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS = {
  error_rate: 0.05,           // 错误率 > 5%
  p95_ms: 1000,               // P95 > 1s
  startup_failures: 3,        // 连续 3 次启动失败
  cooldown_ms: 5 * 60_000,    // 同类告警 5 分钟内不重复
  min_calls_for_eval: 20,     // 至少 20 次调用才评估错误率（新模块不误报）
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function nowMs() { return Date.now() }
function safeShellEscape(s) {
  if (typeof s !== 'string') return ''
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
}

// ---------------------------------------------------------------------------
// Alerter 类
// ---------------------------------------------------------------------------

let _instance = null

export class Alerter {
  constructor({ metrics, logger, thresholds, osascriptEnabled, notifier } = {}) {
    this.metrics = metrics || null
    this.logger = logger || null
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) }
    this._lastNotify = new Map()  // kind+module → ts
    // 检测是否在 macOS（osascript 默认只在 macOS 可用）
    this._osascriptEnabled = osascriptEnabled !== undefined ? osascriptEnabled : (process.platform === 'darwin')
    this._notifier = notifier || null  // 测试用注入的 Notification 替代品
  }

  setThresholds(t) {
    this.thresholds = { ...this.thresholds, ...t }
  }

  setMetrics(metrics) { this.metrics = metrics }
  setLogger(logger) { this.logger = logger }

  // -------------------------------------------------------------------------
  // cooldown 检查
  // -------------------------------------------------------------------------

  _shouldNotify(kind, module) {
    const key = `${kind}:${module || 'global'}`
    const last = this._lastNotify.get(key)
    if (!last) return true
    return (nowMs() - last) > this.thresholds.cooldown_ms
  }

  _markNotified(kind, module) {
    const key = `${kind}:${module || 'global'}`
    this._lastNotify.set(key, nowMs())
  }

  // -------------------------------------------------------------------------
  // 通知方式
  // -------------------------------------------------------------------------

  notify({ kind, module, value, threshold, message }) {
    if (!this._shouldNotify(kind, module)) return false
    this._markNotified(kind, module)
    // 1. 写 metrics 告警记录
    if (this.metrics) {
      this.metrics.recordAlert({ kind, module, value, threshold, message, notified: true })
    }
    // 2. 写 logger
    if (this.logger) {
      this.logger.warn('monitoring', 'alert', {
        kind, module, value, threshold,
        message_safe: message.substring(0, 200),
      })
    }
    // 3. macOS 系统通知
    if (this._osascriptEnabled) {
      this._notifyMacOS({ title: `GINA Alert: ${kind}`, body: message })
    }
    // 4. Electron 桌面通知（如果注入）
    if (this._notifier && typeof this._notifier === 'function') {
      try { this._notifier({ title: `GINA Alert: ${kind}`, body: message }) } catch { /* ignore */ }
    }
    return true
  }

  _notifyMacOS({ title, body }) {
    if (process.platform !== 'darwin') return
    const script = `display notification "${safeShellEscape(body)}" with title "${safeShellEscape(title)}" sound name "Ping"`
    try {
      const child = spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true })
      child.unref()
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // 调用后检查
  // -------------------------------------------------------------------------

  checkAfterCall({ module, duration_ms, success } = {}) {
    if (!module) return []
    const fired = []
    if (!this.metrics) return fired

    // 1. P95 检查（基于滑动窗口）
    const stats = this.metrics.getModuleStats(module)
    if (stats && stats.total_calls >= this.thresholds.min_calls_for_eval) {
      if (stats.p95_ms > this.thresholds.p95_ms) {
        const ok = this.notify({
          kind: 'slow_response',
          module,
          value: stats.p95_ms,
          threshold: this.thresholds.p95_ms,
          message: `${module} P95 = ${stats.p95_ms.toFixed(0)}ms（阈值 ${this.thresholds.p95_ms}ms）`,
        })
        if (ok) fired.push('slow_response')
      }
      // 2. 错误率检查
      if (stats.error_rate > this.thresholds.error_rate) {
        const ok = this.notify({
          kind: 'high_error_rate',
          module,
          value: stats.error_rate,
          threshold: this.thresholds.error_rate,
          message: `${module} 错误率 = ${(stats.error_rate * 100).toFixed(1)}%（阈值 ${(this.thresholds.error_rate * 100).toFixed(1)}%）`,
        })
        if (ok) fired.push('high_error_rate')
      }
    }
    return fired
  }

  // -------------------------------------------------------------------------
  // 启动后检查
  // -------------------------------------------------------------------------

  checkAfterStartup({ success = true, error = null, version } = {}) {
    if (success) return []
    const fired = []
    const ok = this.notify({
      kind: 'startup_failed',
      module: 'startup',
      value: 0,
      threshold: 1,
      message: `GINA 启动失败${version ? `（v${version}）` : ''}: ${error ? String(error).substring(0, 100) : 'unknown error'}`,
    })
    if (ok) fired.push('startup_failed')
    return fired
  }

  // -------------------------------------------------------------------------
  // 告警历史
  // -------------------------------------------------------------------------

  getAlerts({ limit = 50 } = {}) {
    if (!this.metrics) return []
    return this.metrics.getAlerts({ limit })
  }

  // -------------------------------------------------------------------------
  // 测试
  // -------------------------------------------------------------------------

  reset() {
    this._lastNotify.clear()
  }
}

// ---------------------------------------------------------------------------
// 单例
// ---------------------------------------------------------------------------

export function getAlerter(opts = {}) {
  if (!_instance) _instance = new Alerter(opts)
  return _instance
}

export function resetAlerterForTest() {
  if (_instance) {
    _instance.reset()
    _instance = null
  }
}

export { DEFAULT_THRESHOLDS }
