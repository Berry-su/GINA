/**
 * environment-sensor.js — 主动环境感知模块
 *
 * 核心理念：Gina 不应只在等消息。她应该能感知用户的环境状态，
 * 在合适的时机主动互动，或者选择沉默。
 *
 * 感知维度（所有平台统一接口，macOS 优先实现）：
 *   1. 用户是否在场（空闲时长、屏幕是否锁定）
 *   2. 用户正在做什么（前台应用、是否有活跃输入）
 *   3. 系统状态（充电/电池、CPU 温度、网络状态）
 *   4. 硬件使用（摄像头、麦克风是否被占用）
 *
 * 对外接口：
 *   createEnvironmentSensor({ ...deps })
 *     → { sense(): Promise<EnvSnapshot>, senseSync(): EnvSnapshot, startPolling(intervalMs), stopPolling(), on(event, handler) }
 *
 * 事件：
 *   'user-returned'   — 用户从离开状态回来
 *   'user-left'       — 用户离开（空闲超过阈值）
 *   'app-switched'    — 前台应用切换
 *   'screen-locked'   — 屏幕锁定
 *   'screen-unlocked' — 屏幕解锁
 */

import { execSync } from 'child_process'
import EventEmitter from 'events'

// ─── 平台判断 ──────────────────────────────────────────────
const IS_MAC   = process.platform === 'darwin'
const IS_WIN   = process.platform === 'win32'
const IS_LINUX = process.platform === 'linux'

// ─── 默认阈值 ──────────────────────────────────────────────
const DEFAULT_IDLE_AWAY_MS  = 5 * 60 * 1000   // 5分钟空闲 = 用户离开
const DEFAULT_IDLE_RETURN_MS = 30 * 1000       // 30秒内有活动 = 用户回来

// ═══════════════════════════════════════════════════════════
// macOS 传感器实现
// ═══════════════════════════════════════════════════════════

function _macExec(cmd, encoding = 'utf8') {
  try {
    return execSync(cmd, { encoding, timeout: 3000 }).trim()
  } catch {
    return null
  }
}

function _macIdleSeconds() {
  const raw = _macExec(
    `ioreg -c IOHIDSystem -w 0 | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'`
  )
  if (raw === null) return -1
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : -1
}

function _macScreenLocked() {
  const fg = _macExec(
    `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`
  )
  if (fg === 'loginwindow') return true

  const locked = _macExec(
    `python3 -c "
import Quartz
d = Quartz.CGSessionCopyCurrentDictionary()
print(d.get('CGSSessionScreenIsLocked', 0) if d else 0)
" 2>/dev/null`
  )
  if (locked === '1') return true
  if (locked === '0') return false

  return fg === 'loginwindow'
}

function _macForegroundApp() {
  const name = _macExec(
    `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`
  ) || 'unknown'

  const bundleId = _macExec(
    `osascript -e 'tell application "System Events" to get bundle identifier of first process whose frontmost is true'`
  )

  const isTerminal = /terminal|iterm|warp|kitty|code|zed|cursor|sublime|vim|neovim|emacs/i.test(name)

  return { name, bundleId, isTerminal }
}

function _macPower() {
  const raw = _macExec(`pmset -g batt`)
  if (!raw) return { powerSource: 'unknown', batteryPercent: null, isCharging: false }

  const fromBattery = raw.includes('Battery Power')
  const fromAC      = raw.includes('AC Power')
  const charging    = raw.includes('charging')

  const pctMatch = raw.match(/(\d+)%/)
  const batteryPercent = pctMatch ? parseInt(pctMatch[1], 10) : null

  let powerSource = 'unknown'
  if (fromAC)      powerSource = 'ac'
  if (fromBattery) powerSource = 'battery'

  return { powerSource, batteryPercent, isCharging: charging || powerSource === 'ac' }
}

function _macCameraInUse() {
  const raw = _macExec(`lsof -n 2>/dev/null | grep -i 'VDC\\|AppleCamera\\|AVCapture' | head -1`)
  return raw !== null && raw.length > 0
}

function _macMicInUse() {
  const raw = _macExec(`lsof -n 2>/dev/null | grep -i 'coreaudiod.*Input' | head -1`)
  if (raw) return true
  const raw2 = _macExec(`ps aux | grep -i 'VoiceMemos\\|QuickTime.*Record\\|zoom.*audio' | grep -v grep | head -1`)
  return raw2 !== null && raw2.length > 0
}

// ═══════════════════════════════════════════════════════════
// 占位：Windows / Linux
// ═══════════════════════════════════════════════════════════

function _stubSnapshot(platform) {
  return {
    timestamp: Date.now(),
    platform,
    user: { idleSeconds: -1, isActive: false, presence: 'unknown', screenLocked: false },
    foregroundApp: { name: 'unknown', bundleId: null, isTerminal: false },
    system: { powerSource: 'unknown', batteryPercent: null, isCharging: false },
    hardware: { cameraInUse: false, microphoneInUse: false },
  }
}

// ═══════════════════════════════════════════════════════════
// 格式化：快照 → 一行中文描述（注入 prompt 用）
// ═══════════════════════════════════════════════════════════

export function formatEnvironmentSample(snapshot) {
  if (!snapshot) return ''
  const parts = []
  if (snapshot.user.idleSeconds >= 0) {
    const s = snapshot.user.idleSeconds
    if (s >= 60) parts.push(`空闲: ${Math.floor(s / 60)}分${s % 60}秒`)
    else parts.push(`空闲: ${s}秒`)
  }
  if (snapshot.user.screenLocked) parts.push('锁屏: 是')
  if (snapshot.foregroundApp?.name && snapshot.foregroundApp.name !== 'loginwindow') {
    parts.push(`前台: ${snapshot.foregroundApp.name}`)
  }
  if (snapshot.system.powerSource !== 'unknown') {
    const bat = snapshot.system.batteryPercent != null ? `${snapshot.system.batteryPercent}%` : ''
    const chg = snapshot.system.isCharging ? ' 充电中' : ''
    parts.push(`电源: ${snapshot.system.powerSource}${bat ? ` (${bat})` : ''}${chg}`)
  }
  if (snapshot.hardware.cameraInUse) parts.push('摄像头: 在用')
  if (snapshot.hardware.microphoneInUse) parts.push('麦克风: 在用')
  return parts.length ? `[环境感知] ${parts.join(' | ')}` : ''
}

// ═══════════════════════════════════════════════════════════
// 主工厂函数
// ═══════════════════════════════════════════════════════════

export function createEnvironmentSensor(options = {}) {
  const {
    idleAwayMs   = DEFAULT_IDLE_AWAY_MS,
    idleReturnMs = DEFAULT_IDLE_RETURN_MS,
    logger       = console,
  } = options

  const emitter = new EventEmitter()
  let _pollTimer = null
  let _prevSnapshot = null

  function _buildSnapshot() {
    if (!IS_MAC) return _stubSnapshot(process.platform)

    const idleSeconds = _macIdleSeconds()
    const screenLocked = _macScreenLocked()
    const foregroundApp = _macForegroundApp()
    const power = _macPower()
    const cameraInUse = _macCameraInUse()
    const micInUse = _macMicInUse()

    const isActive = idleSeconds >= 0 && idleSeconds < idleReturnMs / 1000
    let presence = 'unknown'
    if (screenLocked) {
      presence = 'away'
    } else if (idleSeconds >= 0) {
      presence = idleSeconds * 1000 >= idleAwayMs ? 'away' : 'present'
    }

    return {
      timestamp: Date.now(),
      platform: 'darwin',
      user: { idleSeconds, isActive, presence, screenLocked },
      foregroundApp,
      system: {
        powerSource: power.powerSource,
        batteryPercent: power.batteryPercent,
        isCharging: power.isCharging,
      },
      hardware: { cameraInUse, microphoneInUse: micInUse },
    }
  }

  function _emitEvents(snapshot) {
    if (!_prevSnapshot) return
    const prev = _prevSnapshot

    if (prev.user.presence !== 'away' && snapshot.user.presence === 'away') {
      emitter.emit('user-left', snapshot)
    }
    if (prev.user.presence === 'away' && snapshot.user.presence === 'present') {
      emitter.emit('user-returned', snapshot)
    }
    if (prev.foregroundApp.name !== snapshot.foregroundApp.name) {
      emitter.emit('app-switched', {
        from: prev.foregroundApp.name,
        to: snapshot.foregroundApp.name,
        snapshot,
      })
    }
    if (!prev.user.screenLocked && snapshot.user.screenLocked) {
      emitter.emit('screen-locked', snapshot)
    }
    if (prev.user.screenLocked && !snapshot.user.screenLocked) {
      emitter.emit('screen-unlocked', snapshot)
    }
  }

  // ── 同步采集（供 tick 路径用，不触发 emit） ──────────────

  function senseSync() {
    const snapshot = _buildSnapshot()
    _emitEvents(snapshot)
    _prevSnapshot = snapshot
    emitter.emit('sensed', snapshot)
    return snapshot
  }

  // ── 异步采集 ──────────────────────────────────────────

  async function sense() {
    return senseSync()
  }

  // ── 轮询 ──────────────────────────────────────────────

  function startPolling(intervalMs = 5000) {
    if (_pollTimer) return
    logger.info(`[env-sensor] 开始轮询，间隔 ${intervalMs}ms`)
    _pollTimer = setInterval(() => {
      try { senseSync() } catch (err) { logger.warn('[env-sensor] sense 失败:', err.message) }
    }, intervalMs)
  }

  function stopPolling() {
    if (!_pollTimer) return
    clearInterval(_pollTimer)
    _pollTimer = null
    logger.info('[env-sensor] 停止轮询')
  }

  function on(event, handler) { emitter.on(event, handler) }
  function off(event, handler) { emitter.off(event, handler) }
  function lastSnapshot() { return _prevSnapshot }

  function capabilities() {
    return {
      idleDetection:    IS_MAC,
      screenLocked:     IS_MAC,
      foregroundApp:    IS_MAC,
      powerStatus:      IS_MAC,
      cameraMicUsage:   IS_MAC,
      supportedPlatforms: ['darwin'],
    }
  }

  return {
    sense,
    senseSync,
    startPolling,
    stopPolling,
    on,
    off,
    lastSnapshot,
    capabilities,
  }
}
