// src/monitoring/metrics.js —— GINA 本地 metrics 监控
//
// 设计哲学（ADR-017）：
//   - 数据全本地：写 data/metrics.db（SQLite），不外发任何 HTTP/HTTPS
//   - 启动次数 / 模块调用 / 错误率 / 性能 P95 全在本地
//   - 异步批量写（30s flush 一次），hot path 额外开销 < 0.1ms
//   - emotion-isolation 严守：不 import joy-state
//
// 公开 API（其他模块调用）：
//   getMetrics()                       → Metrics 单例
//   metrics.recordStartup(meta)        → 启动时调用 1 次
//   metrics.recordCall(meta)           → 模块调用结束时
//   metrics.getModuleStats(module?)    → 聚合
//   metrics.getAllModuleStats()        → 全部聚合
//   metrics.getStartupCount()          → 启动次数
//   metrics.getErrorRate(module)       → 错误率 0-1
//   metrics.reset()                    → 测试用
//
// 运行：被 src/index.js 在启动时调用 getMetrics() 自动初始化
// 测试：node --test tests/test-monitoring.js

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 30_000          // 30s flush 一次
const P95_WINDOW_SIZE = 200              // 滑动窗口（最近 200 次调用）
const DB_FILENAME = 'metrics.db'

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function nowMs() { return Date.now() }
function safeJsonParse(s, fallback) { try { return JSON.parse(s) } catch { return fallback } }
function quantile(sortedArr, q) {
  if (sortedArr.length === 0) return 0
  const pos = (sortedArr.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sortedArr[base + 1] !== undefined) {
    return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base])
  }
  return sortedArr[base]
}

// ---------------------------------------------------------------------------
// 内部状态
// ---------------------------------------------------------------------------

let _instance = null
let _pendingCallFlush = []
let _flushTimer = null

// ---------------------------------------------------------------------------
// 公开类
// ---------------------------------------------------------------------------

export class Metrics {
  constructor({ dbPath, logger } = {}) {
    this.dbPath = dbPath || this._defaultDbPath()
    this.logger = logger || null
    this._ensureDir(this.dbPath)
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this._initSchema()
    // 滑动窗口（最近 P95_WINDOW_SIZE 次调用，按 module 分组）
    this._windows = new Map()  // module → number[]（duration_ms）
    this._startFlushTimer()
  }

  _defaultDbPath() {
    // 与主业务 DB 分离：避免污染 jarvis.db
    const userDir = process.env.GINA_USER_DIR || join(process.env.HOME || '/tmp', 'Documents/BaiLongma-refactor-codebase')
    return join(userDir, 'data', DB_FILENAME)
  }

  _ensureDir(filePath) {
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS startups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        version TEXT NOT NULL,
        pid INTEGER NOT NULL,
        platform TEXT NOT NULL,
        arch TEXT NOT NULL,
        node_version TEXT NOT NULL,
        duration_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS module_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        module TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error_code TEXT,
        user_id TEXT,
        session_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_module_calls_module ON module_calls(module);
      CREATE INDEX IF NOT EXISTS idx_module_calls_ts ON module_calls(ts);

      CREATE TABLE IF NOT EXISTS module_stats (
        module TEXT PRIMARY KEY,
        total_calls INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        p50_ms REAL,
        p95_ms REAL,
        p99_ms REAL,
        last_called_ts INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        module TEXT,
        value REAL NOT NULL,
        threshold REAL NOT NULL,
        message TEXT NOT NULL,
        notified INTEGER NOT NULL DEFAULT 0
      );
    `)
  }

  _startFlushTimer() {
    if (_flushTimer) return
    _flushTimer = setInterval(() => this._flushPending(), FLUSH_INTERVAL_MS)
    if (_flushTimer.unref) _flushTimer.unref()  // 不阻塞进程退出
  }

  _stopFlushTimer() {
    if (_flushTimer) {
      clearInterval(_flushTimer)
      _flushTimer = null
    }
  }

  _flushPending() {
    if (_pendingCallFlush.length === 0) return
    const batch = _pendingCallFlush.splice(0, _pendingCallFlush.length)
    const insert = this.db.prepare(`
      INSERT INTO module_calls (ts, module, duration_ms, success, error_code, user_id, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const tx = this.db.transaction((rows) => {
      for (const r of rows) {
        insert.run(r.ts, r.module, r.duration_ms, r.success ? 1 : 0, r.error_code || null, r.user_id || null, r.session_id || null)
      }
    })
    try {
      tx(batch)
      this._refreshStats()
    } catch (err) {
      if (this.logger) this.logger.error('metrics flush failed', { error: String(err) })
    }
  }

  // -------------------------------------------------------------------------
  // 启动记录
  // -------------------------------------------------------------------------

  recordStartup({ version, pid, platform, arch, node_version, duration_ms } = {}) {
    const meta = {
      ts: nowMs(),
      version: version || 'unknown',
      pid: pid || process.pid,
      platform: platform || process.platform,
      arch: process.arch,
      node_version: node_version || process.version,
      duration_ms: duration_ms || 0,
    }
    try {
      this.db.prepare(`
        INSERT INTO startups (ts, version, pid, platform, arch, node_version, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(meta.ts, meta.version, meta.pid, meta.platform, meta.arch, meta.node_version, meta.duration_ms)
    } catch (err) {
      if (this.logger) this.logger.error('metrics recordStartup failed', { error: String(err) })
    }
    return meta
  }

  // -------------------------------------------------------------------------
  // 模块调用记录（hot path，异步批量）
  // -------------------------------------------------------------------------

  recordCall({ module, duration_ms, success = true, error_code, user_id, session_id } = {}) {
    if (!module) return
    const dur = Math.max(0, Number(duration_ms) || 0)
    // 1. 滑动窗口（用于实时 P95 计算）
    if (!this._windows.has(module)) this._windows.set(module, [])
    const win = this._windows.get(module)
    win.push(dur)
    if (win.length > P95_WINDOW_SIZE) win.shift()
    // 2. 批量入队
    _pendingCallFlush.push({
      ts: nowMs(),
      module,
      duration_ms: dur,
      success: !!success,
      error_code: error_code || null,
      user_id: user_id || null,
      session_id: session_id || null,
    })
    // 3. 超过阈值立即 flush
    if (_pendingCallFlush.length >= 100) this._flushPending()
  }

  // -------------------------------------------------------------------------
  // 聚合统计
  // -------------------------------------------------------------------------

  _refreshStats() {
    // 重新计算所有模块的 p50/p95/p99
    const modules = this.db.prepare(`SELECT DISTINCT module FROM module_calls`).all()
    const update = this.db.prepare(`
      INSERT INTO module_stats (module, total_calls, error_count, p50_ms, p95_ms, p99_ms, last_called_ts, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(module) DO UPDATE SET
        total_calls = excluded.total_calls,
        error_count = excluded.error_count,
        p50_ms = excluded.p50_ms,
        p95_ms = excluded.p95_ms,
        p99_ms = excluded.p99_ms,
        last_called_ts = excluded.last_called_ts,
        updated_at = excluded.updated_at
    `)
    const tx = this.db.transaction((mods) => {
      for (const { module } of mods) {
        const rows = this.db.prepare(`
          SELECT duration_ms, success FROM module_calls WHERE module = ? ORDER BY ts DESC LIMIT ?
        `).all(module, P95_WINDOW_SIZE)
        const durations = rows.map(r => r.duration_ms).sort((a, b) => a - b)
        const errorCount = rows.filter(r => !r.success).length
        const lastTs = rows.length > 0 ? this.db.prepare(`
          SELECT MAX(ts) as m FROM module_calls WHERE module = ?
        `).get(module).m : null
        update.run(
          module,
          rows.length,
          errorCount,
          quantile(durations, 0.5),
          quantile(durations, 0.95),
          quantile(durations, 0.99),
          lastTs,
          nowMs()
        )
      }
    })
    try {
      tx(modules)
    } catch (err) {
      if (this.logger) this.logger.error('metrics _refreshStats failed', { error: String(err) })
    }
  }

  getModuleStats(module) {
    const row = this.db.prepare(`SELECT * FROM module_stats WHERE module = ?`).get(module)
    if (!row) return null
    return {
      module: row.module,
      total_calls: row.total_calls,
      error_count: row.error_count,
      error_rate: row.total_calls > 0 ? row.error_count / row.total_calls : 0,
      p50_ms: row.p50_ms,
      p95_ms: row.p95_ms,
      p99_ms: row.p99_ms,
      last_called_ts: row.last_called_ts,
    }
  }

  getAllModuleStats() {
    return this.db.prepare(`SELECT * FROM module_stats ORDER BY total_calls DESC`).all().map(r => ({
      module: r.module,
      total_calls: r.total_calls,
      error_count: r.error_count,
      error_rate: r.total_calls > 0 ? r.error_count / r.total_calls : 0,
      p50_ms: r.p50_ms,
      p95_ms: r.p95_ms,
      p99_ms: r.p99_ms,
      last_called_ts: r.last_called_ts,
    }))
  }

  getStartupCount() {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM startups`).get()
    return row.c
  }

  getStartups({ limit = 50 } = {}) {
    return this.db.prepare(`SELECT * FROM startups ORDER BY ts DESC LIMIT ?`).all(limit)
  }

  getErrorRate(module) {
    const stats = this.getModuleStats(module)
    return stats ? stats.error_rate : 0
  }

  // -------------------------------------------------------------------------
  // 告警记录
  // -------------------------------------------------------------------------

  recordAlert({ kind, module, value, threshold, message, notified = false }) {
    try {
      this.db.prepare(`
        INSERT INTO alerts (ts, kind, module, value, threshold, message, notified)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(nowMs(), kind, module || null, value, threshold, message, notified ? 1 : 0)
    } catch (err) {
      if (this.logger) this.logger.error('metrics recordAlert failed', { error: String(err) })
    }
  }

  getAlerts({ limit = 50 } = {}) {
    return this.db.prepare(`SELECT * FROM alerts ORDER BY ts DESC LIMIT ?`).all(limit)
  }

  // -------------------------------------------------------------------------
  // 测试 / 关闭
  // -------------------------------------------------------------------------

  reset() {
    this.db.exec(`
      DELETE FROM startups;
      DELETE FROM module_calls;
      DELETE FROM module_stats;
      DELETE FROM alerts;
    `)
    this._windows.clear()
    _pendingCallFlush = []
  }

  close() {
    this._flushPending()
    this._stopFlushTimer()
    if (this.db) {
      try { this.db.close() } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// 单例
// ---------------------------------------------------------------------------

export function getMetrics(opts = {}) {
  if (!_instance) _instance = new Metrics(opts)
  return _instance
}

export function resetMetricsForTest() {
  if (_instance) {
    _instance.close()
    _instance = null
  }
  _pendingCallFlush = []
}

// ---------------------------------------------------------------------------
// 测试用 hooks（暴露内部状态）
// ---------------------------------------------------------------------------

export const __test = {
  flushNow: (m) => m._flushPending(),
  getPending: () => _pendingCallFlush.slice(),
  clearPending: () => { _pendingCallFlush = [] },
}
