// src/connectors/iot-audit.js — IoT 操作审计日志（ADR-012 · Phase 4）
//
// 轻量 JSON Lines 写文件：
//   - 每次 controlDevice 写 1 行
//   - 每次 scenario run 写 1 行
//   - 文件位置：~/Library/Application Support/Gina/iot-audit.log（macOS）
//             %APPDATA%/Gina/iot-audit.log（Windows）
//   - 走 os.homedir() + 平台分支
//   - 失败不抛错（审计失败不阻断设备操作）
//
// emotion-isolation 严守：日志内容只走事实通道，不含 emotion 词

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'

// ── 路径解析 ──────────────────────────────────────────────────────────
function getAuditDir() {
  const plat = platform()
  if (plat === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Gina')
  if (plat === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Gina')
  // linux / 其他
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'Gina')
}

let _initialized = false
function ensureInit() {
  if (_initialized) return
  try {
    const dir = getAuditDir()
    mkdirSync(dir, { recursive: true })
    _initialized = true
  } catch (err) {
    // 失败不抛错（审计路径不可用时仅内存运行）
    console.warn('[iot-audit] ensureInit failed:', err?.message || err)
  }
}

// ── 公开 API ──────────────────────────────────────────────────────────
/**
 * 写一条 device control 审计
 * @param {Object} entry - { deviceId, provider, action, params, ok, error?, scenarioId?, triggeredBy?, dryRun?, approved? }
 */
export function auditControl(entry = {}) {
  ensureInit()
  const record = {
    kind: 'control',
    at: new Date().toISOString(),
    ...entry,
  }
  return safeWrite(record)
}

/**
 * 写一条 scenario run 审计
 * @param {Object} entry - { scenarioId, ok, summary, actionsCount, dryRun, approved, triggeredBy, durationMs? }
 */
export function auditScenario(entry = {}) {
  ensureInit()
  const record = {
    kind: 'scenario_run',
    at: new Date().toISOString(),
    ...entry,
  }
  return safeWrite(record)
}

function safeWrite(record) {
  try {
    const dir = getAuditDir()
    const path = join(dir, 'iot-audit.log')
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf8')
    return { ok: true, path }
  } catch (err) {
    // 审计失败不抛错
    console.warn('[iot-audit] write failed:', err?.message || err)
    return { ok: false, error: err?.message || String(err) }
  }
}

// ── 读 audit（供 UI 展示） ────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs'

export function readRecentAudit({ limit = 50, kind = null } = {}) {
  try {
    const dir = getAuditDir()
    const path = join(dir, 'iot-audit.log')
    if (!existsSync(path)) return []
    const content = readFileSync(path, 'utf8')
    const lines = content.trim().split('\n').reverse()
    const out = []
    for (const line of lines) {
      if (out.length >= limit) break
      try {
        const obj = JSON.parse(line)
        if (kind && obj.kind !== kind) continue
        out.push(obj)
      } catch { /* 跳过格式错误行 */ }
    }
    return out
  } catch (err) {
    console.warn('[iot-audit] readRecentAudit failed:', err?.message || err)
    return []
  }
}

// ── Test hook ──────────────────────────────────────────────────────────
export const __test = {
  getAuditDir,
}
