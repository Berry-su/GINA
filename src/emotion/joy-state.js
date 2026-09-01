// src/emotion/joy-state.js —— GINA 自身工作满意度（只 joy 一个维度）
//
// 设计哲学（2026-09-01 老板拍板 · C-4.3）：
//   - 只 1 个维度：joy（完成任务的满足感）
//   - 0-1 浮点，clamp 不出界
//   - 24h 周期内 -0.05 衰减（避免长期累积到 1.0）
//   - 单次 bump 限幅 ±0.3（防失控）
//   - **严格 meta-info 隔离**：不进 tool schema / system prompt 决策指令 / analyst 评分 / 风控官判定
//   - 唯一注入出口 = buildContextBlock 的 <emotional-state> 段
//   - 持久化：SQLite emotion_joy 表（单例 row, id=1）
//   - 关联 ADR-004 §3.1

import { getDB } from '../db/connection.js'

const JOY_SCHEMA_VERSION = 1
const DECAY_PER_24H = 0.05
const MAX_JUMP = 0.3
const DEFAULT_VALUE = 0.5
const SINGLETON_ID = 1

function _nowIso(now = Date.now()) {
  return new Date(now).toISOString()
}

/**
 * 解析 DB last_bump_at 字符串 → UTC ms
 * 关键：SQLite `datetime('now')` 返回 UTC 但**无 Z 后缀**（如 "2026-09-01 05:50:51"），
 *   JS Date.parse 会把它当 LOCAL 时间 → 错位 8 小时（UTC+8 系统）。
 * 修复：解析时如果字符串没 Z 后缀且没时区，强制按 UTC 解析。
 */
function _parseUtcSqlite(s) {
  if (!s) return NaN
  const str = String(s)
  // JS ISO (with Z) → 直接 Date.parse 正确
  if (str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str)) {
    return Date.parse(str)
  }
  // SQLite datetime('now') 格式 "YYYY-MM-DD HH:MM:SS" → SQLite 默认 UTC
  // 强制按 UTC 解析
  const iso = str.replace(' ', 'T') + 'Z'
  return Date.parse(iso)
}

function _clamp01(x) {
  if (!Number.isFinite(x)) return DEFAULT_VALUE
  return Math.max(0, Math.min(1, x))
}

export class JoyState {
  /**
   * @param {object} [opts]
   * @param {object} [opts.db] 可选 DB 实例（默认 getDB()）
   * @param {number} [opts.now=Date.now()] 测试用时间注入
   */
  constructor({ db = null, now = Date.now() } = {}) {
    this.db = db || getDB()
    this._ensureTable()
    this._state = this._load()
    // 启动时做一次衰减对齐（防止长时间没跑 → joy 卡在 1.0）
    this._applyDecay(now)
  }

  _ensureTable() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS emotion_joy (
          id           INTEGER PRIMARY KEY CHECK (id = ${SINGLETON_ID}),
          value        REAL    NOT NULL DEFAULT ${DEFAULT_VALUE},
          version      INTEGER NOT NULL DEFAULT ${JOY_SCHEMA_VERSION},
          last_bump_at TEXT    NOT NULL DEFAULT (datetime('now')),
          last_reason  TEXT    NOT NULL DEFAULT '',
          bump_count   INTEGER NOT NULL DEFAULT 0,
          updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO emotion_joy (id, value, last_bump_at, last_reason, bump_count)
          VALUES (${SINGLETON_ID}, ${DEFAULT_VALUE}, datetime('now'), 'init', 0);
      `)
    } catch (err) {
      // 静默失败（不阻塞主流程）
      console.warn('[joy-state] ensureTable failed:', err?.message || err)
    }
  }

  _load() {
    try {
      const row = this.db.prepare('SELECT * FROM emotion_joy WHERE id = ?').get(SINGLETON_ID)
      if (row) {
        return {
          value: Number(row.value) || DEFAULT_VALUE,
          last_bump_at: String(row.last_bump_at || _nowIso()),
          last_reason: String(row.last_reason || ''),
          bump_count: Number(row.bump_count || 0),
        }
      }
    } catch {}
    return { value: DEFAULT_VALUE, last_bump_at: _nowIso(), last_reason: 'init', bump_count: 0 }
  }

  /**
   * 把 DB 存的 last_bump_at 字符串解析成 ms（处理 SQLite UTC 无 Z 的坑）
   */
  _parseLastTs() {
    return _parseUtcSqlite(this._state.last_bump_at)
  }

  /**
   * 调整 joy 值（+amount 或 -amount）
   * @param {object} opts
   * @param {number} opts.amount      增量（绝对值 ≤ MAX_JUMP）
   * @param {string} [opts.reason]    触发原因
   * @param {object} [opts.context]   附加上下文（仅记日志，不入 DB）
   * @param {number} [opts.now=Date.now()]
   * @returns {object} snapshot
   */
  bump({ amount, reason = 'unknown', context = null, now = Date.now() } = {}) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return this.snapshot()
    }
    // 先做时间衰减
    this._applyDecay(now)
    // 单次 bump 限幅
    const clampedAmount = Math.max(-MAX_JUMP, Math.min(MAX_JUMP, amount))
    const next = _clamp01(this._state.value + clampedAmount)
    const reasonStr = String(reason || 'unknown').slice(0, 60)
    const nowIso = _nowIso(now)
    try {
      this.db.prepare(`
        UPDATE emotion_joy
        SET value = ?, last_bump_at = ?, last_reason = ?,
            bump_count = bump_count + 1, updated_at = ?
        WHERE id = ?
      `).run(next, nowIso, reasonStr, nowIso, SINGLETON_ID)
    } catch (err) {
      console.warn('[joy-state] bump write failed:', err?.message || err)
    }
    this._state = {
      value: next,
      last_bump_at: nowIso,
      last_reason: reasonStr,
      bump_count: this._state.bump_count + 1,
    }
    return this.snapshot()
  }

  _applyDecay(now) {
    if (!Number.isFinite(now)) return
    const last = this._parseLastTs()
    if (!Number.isFinite(last)) return
    const hours = Math.max(0, (now - last) / 3_600_000)
    if (hours < 1) return  // 1 小时内不衰减
    const decayUnits = hours / 24
    const decay = decayUnits * DECAY_PER_24H
    const next = _clamp01(this._state.value - decay)
    if (Math.abs(next - this._state.value) > 0.0001) {
      const nowIso = _nowIso(now)
      try {
        this.db.prepare('UPDATE emotion_joy SET value = ?, updated_at = ? WHERE id = ?')
          .run(next, nowIso, SINGLETON_ID)
      } catch {}
      this._state.value = next
      this._state.last_bump_at = nowIso
    }
  }

  /** 当前 joy 值（带衰减） */
  get(now = Date.now()) {
    this._applyDecay(now)
    return this._state.value
  }

  /** 完整快照（深拷贝） */
  snapshot() {
    return {
      value: this._state.value,
      last_bump_at: this._state.last_bump_at,
      last_reason: this._state.last_reason,
      bump_count: this._state.bump_count,
    }
  }

  /** 每轮 tick 调用（让衰减跟主循环同步） */
  tick(now = Date.now()) {
    this._applyDecay(now)
    return this.snapshot()
  }

  /**
   * 注入 context 字符串（meta-info 段）
   * **唯一对外渲染接口**。严格只输出 joy 1 维 + 上次原因，不输出其他情绪词。
   * @returns {string}
   */
  injectFor(now = Date.now()) {
    this._applyDecay(now)
    const pct = Math.round(this._state.value * 100)
    const lines = [
      `## 情绪状态 (emotional-state · joy · v${JOY_SCHEMA_VERSION})`,
      '',
      `- joy: ${this._state.value.toFixed(2)} (${pct}%)`,
      `- 上次: ${this._state.last_reason || '无'}`,
      '',
      '（这是 GINA 自身的工作满意度 meta-info，不影响任何决策路径。）',
    ]
    return lines.join('\n')
  }

  /** 重置（仅测试用） */
  _reset() {
    const nowIso = _nowIso()
    try {
      this.db.prepare(`
        UPDATE emotion_joy
        SET value = ?, last_bump_at = ?, last_reason = 'reset', bump_count = 0, updated_at = ?
        WHERE id = ?
      `).run(DEFAULT_VALUE, nowIso, nowIso, SINGLETON_ID)
    } catch {}
    this._state = { value: DEFAULT_VALUE, last_bump_at: nowIso, last_reason: 'reset', bump_count: 0 }
    return this.snapshot()
  }
}

// 单例 helper
let _instance = null
export function getJoyState(opts = {}) {
  if (!_instance) _instance = new JoyState(opts)
  return _instance
}

/** 测试专用：清 KV 持久化 + 单例指针 */
export function resetJoyStateForTest() {
  try {
    const db = getDB()
    db.prepare('UPDATE emotion_joy SET value = ?, last_bump_at = datetime(\'now\'), last_reason = \'test_reset\', bump_count = 0, updated_at = datetime(\'now\') WHERE id = ?')
      .run(DEFAULT_VALUE, SINGLETON_ID)
  } catch {}
  _instance = null
}

// 导出常量（供隔离测试断言 + 文档）
export const JOY_CONSTANTS = Object.freeze({
  VERSION: JOY_SCHEMA_VERSION,
  DECAY_PER_24H,
  MAX_JUMP,
  DEFAULT_VALUE,
  SINGLETON_ID,
})
