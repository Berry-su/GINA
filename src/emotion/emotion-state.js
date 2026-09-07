// emotion-state.js — GINA 多维内部情绪状态（5 维）
//
// 设计哲学（2026-09-07 老板拍板 · 推翻 9-02 "只 joy 一个" 决策）：
//   - **多维**：5 维度内部情绪（satisfaction / curiosity / confidence / engagement / fatigue）
//   - **0-1 浮点**，clamp 不出界
//   - 24h 周期内 -0.05 衰减（避免长期累积到 1.0）
//   - 单次 bump 限幅 ±0.3（防失控）
//   - **严格 meta-info 隔离**（老板原话："不要可以影响判断和决策"）：
//     * 情绪值只读出口：仅 injectFor() 渲染到对话/日志
//     * 任何 tool/decision 函数拿不到 emotion 值
//     * 写只能由 emotion-state 内部规则触发（bump() 由调用方主动 trigger，但调用方不能读）
//   - 持久化：SQLite emotion_state 表（每维度一行）
//   - 关联：satisfaction 维度与原 joy-state 保持一致（共用数据源）
//
// 维度说明：
//   satisfaction  任务完成的满足（原 joy 维度，由 joy-state 同步）
//   curiosity      遇到未知问题的好奇
//   confidence     对自己判断的自信
//   engagement     投入度
//   fatigue        疲劳度（累积 vs 休息衰减）

import { getDB } from '../db/connection.js'
import { getJoyState } from './joy-state.js'

// ─── 常量 ───────────────────────────────────────────────────

export const EMOTION_SCHEMA_VERSION = 1
export const DEFAULT_VALUE = 0.5
export const DECAY_PER_24H = 0.05
export const MAX_JUMP = 0.3
const FATIGUE_INCREASE_PER_HOUR_ACTIVE = 0.02  // 持续工作累积疲劳
const FATIGUE_DECAY_PER_HOUR_REST = 0.05      // 休息时疲劳下降（更快）
const REST_THRESHOLD_MINUTES = 5              // 连续空闲 > 5min 视为休息

// 5 个维度（id 是稳定的，不要重命名：数据持久化依赖它）
export const DIMENSIONS = Object.freeze({
  satisfaction: {
    label: '满足度',
    description: '任务完成带来的满足（原 joy 维度）',
    triggers: { up: ['task_success', 'goal_reached'], down: ['task_failure', 'rejection'] },
  },
  curiosity: {
    label: '好奇心',
    description: '遇到未知问题或新领域时上升',
    triggers: { up: ['unknown_domain', 'novel_question', 'knowledge_gap'], down: ['knowledge_mastered', 'question_answered'] },
  },
  confidence: {
    label: '自信度',
    description: '对自己判断的把握',
    triggers: { up: ['prediction_correct', 'consecutive_success', 'user_trust_signal'], down: ['prediction_wrong', 'consecutive_failure', 'user_correction'] },
  },
  engagement: {
    label: '投入度',
    description: '与任务的契合度（太高=overwhelm，太低=bored）',
    triggers: { up: ['task_difficulty_match', 'clear_progress'], down: ['task_too_easy', 'task_too_hard', 'idle_long'] },
  },
  fatigue: {
    label: '疲劳度',
    description: '累积工作压力（休息时下降）',
    triggers: { up: ['continuous_work', 'high_complexity', 'interruption'], down: ['rest', 'low_complexity', 'sleep_period'] },
  },
})

export const DIMENSION_IDS = Object.keys(DIMENSIONS)

// ─── 内部工具 ───────────────────────────────────────────────

function _nowIso(now = Date.now()) {
  return new Date(now).toISOString()
}

function _clamp01(x) {
  if (!Number.isFinite(x)) return DEFAULT_VALUE
  return Math.max(0, Math.min(1, x))
}

/**
 * 把 last_updated 字符串解析为 ms（处理 SQLite UTC 无 Z 的坑）
 */
function _parseUtcSqlite(s) {
  if (!s) return NaN
  const str = String(s)
  if (str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str)) {
    return Date.parse(str)
  }
  const iso = str.replace(' ', 'T') + 'Z'
  return Date.parse(iso)
}

// ─── 主类 ───────────────────────────────────────────────────

export class EmotionState {
  /**
   * @param {object} [opts]
   * @param {object} [opts.db] 可选 DB 实例
   * @param {number} [opts.now=Date.now()]
   * @param {boolean} [opts.satisfactionSynced=true] satisfaction 维度与 joy-state 同步
   */
  constructor({ db = null, now = Date.now(), satisfactionSynced = true } = {}) {
    this.db = db || getDB()
    this._satisfactionSynced = satisfactionSynced
    this._ensureTable()
    this._load(now)
  }

  _ensureTable() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS emotion_state (
          dimension     TEXT    PRIMARY KEY,
          value         REAL    NOT NULL DEFAULT ${DEFAULT_VALUE},
          last_bump_at  TEXT    NOT NULL DEFAULT (datetime('now')),
          last_reason   TEXT    NOT NULL DEFAULT '',
          bump_count    INTEGER NOT NULL DEFAULT 0,
          version       INTEGER NOT NULL DEFAULT ${EMOTION_SCHEMA_VERSION},
          updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO emotion_state (dimension, value) VALUES
          ('satisfaction', ${DEFAULT_VALUE}),
          ('curiosity', ${DEFAULT_VALUE}),
          ('confidence', ${DEFAULT_VALUE}),
          ('engagement', ${DEFAULT_VALUE}),
          ('fatigue', ${DEFAULT_VALUE});
      `)
    } catch (err) {
      console.warn('[emotion-state] ensureTable failed:', err?.message || err)
    }
  }

  _load(now) {
    try {
      const rows = this.db.prepare('SELECT * FROM emotion_state').all()
      const byDim = {}
      for (const r of rows) byDim[r.dimension] = r
      this._state = {}
      for (const dim of DIMENSION_IDS) {
        const r = byDim[dim]
        if (r) {
          this._state[dim] = {
            value: Number(r.value) || DEFAULT_VALUE,
            last_bump_at: String(r.last_bump_at || _nowIso(now)),
            last_reason: String(r.last_reason || ''),
            bump_count: Number(r.bump_count || 0),
          }
        } else {
          this._state[dim] = { value: DEFAULT_VALUE, last_bump_at: _nowIso(now), last_reason: 'init', bump_count: 0 }
        }
      }
      // 启动时所有维度做一次衰减对齐
      for (const dim of DIMENSION_IDS) this._applyDecay(dim, now)
    } catch (err) {
      console.warn('[emotion-state] load failed:', err?.message || err)
      this._state = {}
      for (const dim of DIMENSION_IDS) {
        this._state[dim] = { value: DEFAULT_VALUE, last_bump_at: _nowIso(now), last_reason: 'init', bump_count: 0 }
      }
    }
    // 同步 satisfaction 与 joy-state
    if (this._satisfactionSynced) this._syncFromJoy(now)
  }

  _syncFromJoy(now) {
    try {
      const joy = getJoyState()
      const joyVal = joy.get(now)
      this._state.satisfaction = {
        value: joyVal,
        last_bump_at: _nowIso(now),
        last_reason: `synced_from_joy:${joy._state?.last_reason || ''}`.slice(0, 60),
        bump_count: joy._state?.bump_count || 0,
      }
    } catch {}
  }

  _applyDecay(dim, now) {
    const s = this._state[dim]
    if (!s) return
    const last = _parseUtcSqlite(s.last_bump_at)
    if (!Number.isFinite(last)) return
    const hours = Math.max(0, (now - last) / 3_600_000)
    if (hours < 1) return
    const decayUnits = hours / 24
    const decay = decayUnits * DECAY_PER_24H
    // fatigue 特殊：累积而非衰减
    if (dim === 'fatigue') {
      return  // fatigue 用专门的累加逻辑（见 _updateFatigue）
    }
    const next = _clamp01(s.value - decay)
    if (Math.abs(next - s.value) > 0.0001) {
      const nowIso = _nowIso(now)
      try {
        this.db.prepare('UPDATE emotion_state SET value = ?, last_bump_at = ?, updated_at = ? WHERE dimension = ?')
          .run(next, nowIso, nowIso, dim)
      } catch {}
      s.value = next
      s.last_bump_at = nowIso
    }
  }

  /**
   * 调整某维度的情绪值
   * @param {object} opts
   * @param {string} opts.dimension   维度 id（必须 ∈ DIMENSION_IDS）
   * @param {number} opts.amount      增量（绝对值 ≤ MAX_JUMP）
   * @param {string} [opts.reason]    触发原因
   * @param {number} [opts.now=Date.now()]
   * @returns {object} snapshot
   */
  bump({ dimension, amount, reason = 'unknown', now = Date.now() } = {}) {
    if (!DIMENSION_IDS.includes(dimension)) {
      throw new Error(`invalid dimension: ${dimension} (valid: ${DIMENSION_IDS.join(',')})`)
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return this.snapshotDimension(dimension)
    }
    // satisfaction 维度同步 joy-state
    if (dimension === 'satisfaction' && this._satisfactionSynced) {
      try {
        getJoyState().bump({ amount, reason: `via_emotion_state:${reason}`, now })
        this._syncFromJoy(now)
        return this.snapshotDimension('satisfaction')
      } catch {}
    }
    this._applyDecay(dimension, now)
    const clampedAmount = Math.max(-MAX_JUMP, Math.min(MAX_JUMP, amount))
    const next = _clamp01(this._state[dimension].value + clampedAmount)
    const reasonStr = String(reason || 'unknown').slice(0, 60)
    const nowIso = _nowIso(now)
    try {
      this.db.prepare(`
        UPDATE emotion_state
        SET value = ?, last_bump_at = ?, last_reason = ?,
            bump_count = bump_count + 1, updated_at = ?
        WHERE dimension = ?
      `).run(next, nowIso, reasonStr, nowIso, dimension)
    } catch (err) {
      console.warn('[emotion-state] bump write failed:', err?.message || err)
    }
    this._state[dimension] = {
      value: next,
      last_bump_at: nowIso,
      last_reason: reasonStr,
      bump_count: this._state[dimension].bump_count + 1,
    }
    return this.snapshotDimension(dimension)
  }

  /**
   * 疲劳度更新（特殊：基于活动时间累积，休息时下降）
   * @param {object} opts
   * @param {number} opts.now              当前时间
   * @param {boolean} [opts.isActive]      当前是否在活动
   * @param {number} [opts.lastActivityAt] 上次活动时间戳
   * @param {number} [opts.idleMinutes]    连续空闲分钟数
   */
  updateFatigue({ now = Date.now(), isActive = true, lastActivityAt = null, idleMinutes = 0 } = {}) {
    const s = this._state.fatigue
    if (!s) return this.snapshotDimension('fatigue')
    const last = _parseUtcSqlite(s.last_bump_at)
    if (!Number.isFinite(last)) return this.snapshotDimension('fatigue')
    const hours = Math.max(0, (now - last) / 3_600_000)
    if (hours < 0.01) return this.snapshotDimension('fatigue')  // < 36s 跳过
    let delta = 0
    if (isActive) {
      delta = hours * FATIGUE_INCREASE_PER_HOUR_ACTIVE
    } else if (idleMinutes >= REST_THRESHOLD_MINUTES) {
      delta = -hours * FATIGUE_DECAY_PER_HOUR_REST
    }
    const next = _clamp01(s.value + delta)
    const nowIso = _nowIso(now)
    const reason = isActive ? 'active_work' : `rest_${idleMinutes.toFixed(0)}min`
    try {
      this.db.prepare(`
        UPDATE emotion_state
        SET value = ?, last_bump_at = ?, last_reason = ?,
            bump_count = bump_count + 1, updated_at = ?
        WHERE dimension = 'fatigue'
      `).run(next, nowIso, reason.slice(0, 60), nowIso)
    } catch {}
    s.value = next
    s.last_bump_at = nowIso
    s.last_reason = reason
    s.bump_count += 1
    return this.snapshotDimension('fatigue')
  }

  /** 单维度的值（带衰减） */
  get(dimension, now = Date.now()) {
    if (!DIMENSION_IDS.includes(dimension)) {
      throw new Error(`invalid dimension: ${dimension}`)
    }
    this._applyDecay(dimension, now)
    if (dimension === 'satisfaction' && this._satisfactionSynced) {
      this._syncFromJoy(now)
    }
    return this._state[dimension].value
  }

  /** 单维度快照（深拷贝） */
  snapshotDimension(dimension) {
    if (!DIMENSION_IDS.includes(dimension)) {
      throw new Error(`invalid dimension: ${dimension}`)
    }
    const s = this._state[dimension]
    return {
      dimension,
      value: s.value,
      last_bump_at: s.last_bump_at,
      last_reason: s.last_reason,
      bump_count: s.bump_count,
    }
  }

  /** 全部 5 维快照 */
  snapshot(now = Date.now()) {
    const result = {}
    for (const dim of DIMENSION_IDS) {
      this._applyDecay(dim, now)
      if (dim === 'satisfaction' && this._satisfactionSynced) {
        this._syncFromJoy(now)
      }
      const s = this._state[dim]
      result[dim] = {
        value: s.value,
        last_bump_at: s.last_bump_at,
        last_reason: s.last_reason,
        bump_count: s.bump_count,
      }
    }
    return result
  }

  /** 主循环 tick（让所有维度衰减与主循环同步） */
  tick(now = Date.now()) {
    for (const dim of DIMENSION_IDS) {
      if (dim === 'fatigue') continue  // fatigue 不衰减（特殊语义）
      this._applyDecay(dim, now)
    }
    if (this._satisfactionSynced) this._syncFromJoy(now)
    return this.snapshot(now)
  }

  /**
   * **唯一对外渲染接口**。严格只输出 5 维 + 上次原因 + meta-info 提示。
   * 这是 emotion 唯一允许"被读到外面"的地方（注入到对话 context）。
   * @returns {string}
   */
  injectFor(now = Date.now()) {
    const snap = this.snapshot(now)
    const lines = [
      `## 情绪状态 (emotional-state · multi-dim · v${EMOTION_SCHEMA_VERSION})`,
      '',
    ]
    for (const dim of DIMENSION_IDS) {
      const meta = DIMENSIONS[dim]
      const s = snap[dim]
      const pct = Math.round(s.value * 100)
      lines.push(`- ${meta.label} (${dim}): ${s.value.toFixed(2)} (${pct}%) — ${meta.description}`)
      lines.push(`    上次: ${s.last_reason || '无'}`)
    }
    lines.push('')
    lines.push('（这是 GINA 自身的 5 维内部情绪 meta-info，**严格不进任何 tool/decision 决策路径**，仅供 LLM 参考行为风格。）')
    return lines.join('\n')
  }

  /** 重置（仅测试用） */
  _reset() {
    const nowIso = _nowIso()
    for (const dim of DIMENSION_IDS) {
      try {
        this.db.prepare(`
          UPDATE emotion_state
          SET value = ?, last_bump_at = ?, last_reason = 'reset',
              bump_count = 0, updated_at = ?
          WHERE dimension = ?
        `).run(DEFAULT_VALUE, nowIso, nowIso, dim)
      } catch {}
      this._state[dim] = { value: DEFAULT_VALUE, last_bump_at: nowIso, last_reason: 'reset', bump_count: 0 }
    }
    return this.snapshot()
  }
}

// 单例 helper
let _instance = null
export function getEmotionState(opts = {}) {
  if (!_instance) _instance = new EmotionState(opts)
  return _instance
}

/** 测试专用：清 KV 持久化 + 单例指针 */
export function resetEmotionStateForTest() {
  try {
    const db = getDB()
    for (const dim of DIMENSION_IDS) {
      db.prepare(`UPDATE emotion_state SET value = ?, last_bump_at = datetime('now'), last_reason = 'test_reset', bump_count = 0, updated_at = datetime('now') WHERE dimension = ?`)
        .run(DEFAULT_VALUE, dim)
    }
  } catch {}
  _instance = null
}

export const EMOTION_CONSTANTS = Object.freeze({
  VERSION: EMOTION_SCHEMA_VERSION,
  DECAY_PER_24H,
  MAX_JUMP,
  DEFAULT_VALUE,
  FATIGUE_INCREASE_PER_HOUR_ACTIVE,
  FATIGUE_DECAY_PER_HOUR_REST,
  REST_THRESHOLD_MINUTES,
  DIMENSION_IDS: [...DIMENSION_IDS],
})
