// weather-monitor.js — 极端天气监测编排器
//
// 定位：把 weather-fetcher + extreme-detector 串成 GINA 持续极端天气感知。
// 30 分钟/次（折中：太频繁浪费 API，太慢错过预警）
// 复用 typhoon-alert-monitor 的 emit 机制（typhoon_alert 事件）
// 新增 weather_alert 事件（7 类极端）
// 闭环：proactive-perception / emotion-fusion / UI 弹窗 都消费这些事件

import {
  fetchOnce,
  fetchWttr,
  fetchNMCAlerts,
  normalizeWttr,
  normalizeNMCAlerts,
} from './weather-fetcher.js'
import { detectAll, filterSevereNMC } from './extreme-detector.js'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 30 * 60 * 1000
const MIN_POLL_INTERVAL_MS = 5 * 60 * 1000
const MAX_ALERT_HISTORY = 64
const DEFAULT_DEDUP_MS = 30 * 60 * 1000  // 30 分钟内同类型不重复 emit

// ─── 状态 ───────────────────────────────────────────────────

export function defaultMonitorState() {
  return {
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    enabled: false,
    timer: null,
    location: null,
    lastFetch: null,         // { wttr, nmc, combinedAt, error }
    lastDetection: null,     // { alerts, safe, checkedAt }
    prevTemp: null,          // 上次温度（用于寒潮检测）
    alertHistory: [],        // [{ at, type, severity, message }]
    nmcUrl: null,
    nmcToken: null,
    dedupMs: DEFAULT_DEDUP_MS,
    startedAt: null,
  }
}

// ─── 内部工具 ───────────────────────────────────────────────

function clampInterval(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return DEFAULT_POLL_INTERVAL_MS
  return Math.max(MIN_POLL_INTERVAL_MS, Math.floor(ms))
}

function trimHistory(arr, max) {
  if (arr.length <= max) return arr
  return arr.slice(-max)
}

function pruneCooldown(arr, cooldownMs, now) {
  return arr.filter(a => typeof a.at === 'number' && (now - a.at) < cooldownMs)
}

// ─── 监测事件触发 ────────────────────────────────────────

// 内部 emit：调用 options.onAlert 回调
// 调用方负责把 onAlert 接到 events.js 的 emit
function emitAlerts(state, alerts, options = {}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return 0
  const now = Date.now()
  const recent = pruneCooldown(state.alertHistory, state.dedupMs, now)
  const emitted = []
  for (const a of alerts) {
    // dedup: 30 分钟内同 type 不重复
    const dup = recent.find(r => r.type === a.type)
    if (dup) continue
    const record = { at: now, type: a.type, severity: a.severity, message: a.message }
    state.alertHistory = trimHistory([...recent, record], MAX_ALERT_HISTORY)
    emitted.push(a)
    if (typeof options.onAlert === 'function') {
      try { options.onAlert(a, state) } catch (e) { /* swallow */ }
    }
  }
  return emitted.length
}

// ─── 监测启动 / 停止 ───────────────────────────────────────

// 启动持续监测
//   options: { state, intervalMs, location, nmcUrl, nmcToken, fetcher, onAlert, onUpdate, onError }
export function startMonitoring(options = {}) {
  const state = options.state || defaultMonitorState()
  if (state.enabled) {
    return { state, error: 'monitoring already started' }
  }
  state.pollIntervalMs = clampInterval(options.intervalMs)
  state.location = options.location || state.location
  state.nmcUrl = options.nmcUrl || state.nmcUrl
  state.nmcToken = options.nmcToken || state.nmcToken
  state.enabled = true
  state.startedAt = Date.now()
  const poll = async () => {
    if (!state.enabled) return
    try {
      const r = await fetchOnce({
        location: state.location,
        nmcUrl: state.nmcUrl,
        nmcToken: state.nmcToken,
        fetcher: options.fetcher,
      })
      state.lastFetch = r
      // 检测
      const prevTemp = state.prevTemp
      const detection = detectAll({
        wttr: r.wttr,
        nmcAlerts: r.nmc,
        prevTemp,
        location: state.location,
      })
      // 保存 prevTemp 给下次
      if (r.wttr && r.wttr.current && typeof r.wttr.current.temp === 'number') {
        state.prevTemp = r.wttr.current.temp
      }
      state.lastDetection = detection
      // emit
      emitAlerts(state, detection.alerts, { onAlert: options.onAlert })
      if (typeof options.onUpdate === 'function') {
        try { options.onUpdate(state, detection) } catch {}
      }
    } catch (e) {
      if (typeof options.onError === 'function') {
        try { options.onError(e, state) } catch {}
      }
    }
  }
  // 立即跑一次
  poll()
  state.timer = setInterval(poll, state.pollIntervalMs)
  return { state, error: null }
}

export function stopMonitoring(state) {
  if (!state) return null
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.enabled = false
  return state
}

export function isMonitoring(state) {
  return !!(state && state.enabled && state.timer)
}

// ─── 单次检测（手动触发） ────────────────────────────────

export async function detectOnce(options = {}) {
  const state = options.state || defaultMonitorState()
  const r = await fetchOnce({
    location: options.location || state.location,
    nmcUrl: options.nmcUrl || state.nmcUrl,
    nmcToken: options.nmcToken || state.nmcToken,
    fetcher: options.fetcher,
  })
  state.lastFetch = r
  const detection = detectAll({
    wttr: r.wttr,
    nmcAlerts: r.nmc,
    prevTemp: state.prevTemp,
    location: options.location || state.location,
  })
  if (r.wttr && r.wttr.current && typeof r.wttr.current.temp === 'number') {
    state.prevTemp = r.wttr.current.temp
  }
  state.lastDetection = detection
  // emit
  if (options.onAlert) {
    emitAlerts(state, detection.alerts, { onAlert: options.onAlert })
  }
  return detection
}

// ─── 概览 ──────────────────────────────────────────────────

export function getMonitorOverview(state) {
  if (!state) return null
  return {
    running: state.enabled,
    location: state.location,
    pollIntervalMs: state.pollIntervalMs,
    startedAt: state.startedAt,
    lastDetection: state.lastDetection,
    alertHistoryCount: state.alertHistory.length,
    currentTemp: state.lastFetch?.wttr?.current?.temp ?? null,
    currentWeather: state.lastFetch?.wttr?.current?.weather ?? null,
    safe: state.lastDetection?.safe ?? true,
  }
}

// ─── 注入到对话（meta-info 段） ────────────────────────────

export function injectForWeather(state, options = {}) {
  const d = state.lastDetection
  if (!d) {
    return `## 极端天气 (extreme-weather · no data)\n\n（无检测结果）`
  }
  const lines = [
    `## 极端天气 (extreme-weather · v1)`,
    '',
    `- 位置: ${d.location || '?'}`,
    `- 当前温度: ${state.lastFetch?.wttr?.current?.temp ?? '?'}°C`,
    `- 当前天气: ${state.lastFetch?.wttr?.current?.weather || '?'}`,
    `- 检测时间: ${new Date(d.checkedAt).toISOString()}`,
    `- 状态: ${d.safe ? '✅ 安全' : '⚠️ ' + d.alerts.length + ' 项预警'}`,
  ]
  if (!d.safe && d.alerts.length > 0) {
    lines.push('')
    lines.push('当前预警：')
    for (const a of d.alerts) {
      lines.push(`  - [${a.severity}] ${a.label}: ${a.message}`)
    }
  }
  lines.push('')
  lines.push('（这是 GINA 极端天气 meta-info，**不进决策路径**。）')
  return lines.join('\n')
}

// 导出内部常量（不重名）
export { MAX_ALERT_HISTORY, DEFAULT_DEDUP_MS }
