// src/monitoring/logger.js —— GINA 结构化日志（JSON Lines + 30 天轮转）
//
// 设计哲学（ADR-017）：
//   - JSON Lines 格式（每行 1 条 JSON），机器可读 + 简单 grep/jq 友好
//   - 每天 1 个文件：data/logs/gina-YYYY-MM-DD.jsonl
//   - 30 天自动清理；单文件 > 50MB 时 split
//   - 字段白名单 + 黑名单（不写敏感数据：password/token/api_key/credential 等）
//   - 不外发任何网络请求
//   - emotion-isolation 严守：不 import joy-state
//
// 公开 API：
//   getLogger(opts?)              → Logger 单例
//   logger.info(module, event, data?)
//   logger.warn(module, event, data?)
//   logger.error(module, event, data?)
//   logger.debug(module, event, data?) — 默认关
//   logger.setLevel(level)         → debug | info | warn | error
//   logger.flush()                 → 立即 flush 缓冲
//   logger.readLogs(date?)         → 读某天日志（测试用）
//
// 运行：被 src/monitoring/index.js 在启动时调用
// 测试：node --test tests/test-monitoring.js

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync, renameSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const LOG_RETENTION_DAYS = 30
const MAX_FILE_SIZE = 50 * 1024 * 1024  // 50MB
const LOG_DIRNAME = 'logs'
const LOG_PREFIX = 'gina-'
const LOG_SUFFIX = '.jsonl'
const FLUSH_INTERVAL_MS = 5_000

// ---------------------------------------------------------------------------
// 字段白名单 / 黑名单
// ---------------------------------------------------------------------------

const ALLOWED_FIELDS = new Set([
  'ts', 'level', 'module', 'event', 'capability', 'duration_ms',
  'success', 'error_code', 'error_message_safe', 'user_id', 'session_id',
  'version', 'pid', 'platform', 'arch', 'node_version', 'count', 'value',
  'threshold', 'kind', 'message_safe', 'request_id', 'route', 'method',
  'status_code', 'reason', 'task_id', 'scenario_id', 'device_id',
])

const FORBIDDEN_KEYS = [
  'password', 'passwd', 'token', 'api_key', 'apikey', 'secret',
  'credential', 'private_key', 'authorization', 'auth', 'bearer',
  'access_token', 'refresh_token', 'session_secret', 'cookie',
]

const FORBIDDEN_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,  // OpenAI / DeepSeek 等 key 前缀（含 sk-proj- / sk-or- 变体）
  /\bghp_[A-Za-z0-9]{20,}/,   // GitHub PAT
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,  // Slack token
]

// ---------------------------------------------------------------------------
// 脱敏
// ---------------------------------------------------------------------------

export function sanitize(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      let s = obj
      for (const pat of FORBIDDEN_VALUE_PATTERNS) {
        if (pat.test(s)) s = s.replace(pat, '***REDACTED_PATTERN***')
      }
      return s
    }
    return obj
  }
  if (Array.isArray(obj)) return obj.map(sanitize)
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const kLower = k.toLowerCase()
    if (FORBIDDEN_KEYS.some(f => kLower.includes(f))) {
      out[k] = '***REDACTED***'
      continue
    }
    if (!ALLOWED_FIELDS.has(kLower)) {
      // 不在白名单的字段直接丢弃
      continue
    }
    out[k] = sanitize(v)
  }
  return out
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function nowMs() { return Date.now() }
function dateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function safeStringify(obj) {
  try { return JSON.stringify(obj) } catch { return JSON.stringify({ _error: 'stringify_failed' }) }
}

// ---------------------------------------------------------------------------
// Logger 类
// ---------------------------------------------------------------------------

let _instance = null
let _flushTimer = null
let _pendingBuffer = []
let _currentFileDate = null

export class Logger {
  constructor({ logDir, level = 'info', clock = () => new Date() } = {}) {
    this.logDir = logDir || this._defaultLogDir()
    this.level = LEVELS[level] || LEVELS.info
    this._clock = clock
    this._ensureDir()
    this._cleanupOldLogs()
  }

  _defaultLogDir() {
    const userDir = process.env.GINA_USER_DIR || join(process.env.HOME || '/tmp', 'Documents/BaiLongma-refactor-codebase')
    return join(userDir, 'data', LOG_DIRNAME)
  }

  _ensureDir() {
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true })
  }

  setLevel(level) {
    this.level = LEVELS[level] || LEVELS.info
  }

  // -------------------------------------------------------------------------
  // 写入入口
  // -------------------------------------------------------------------------

  _write(level, module, event, data) {
    if (LEVELS[level] < this.level) return
    const sanitized = sanitize(data || {})
    const record = {
      ts: nowMs(),
      level,
      module: module || 'unknown',
      event: event || 'log',
      ...sanitized,
    }
    _pendingBuffer.push(safeStringify(record))
    if (_pendingBuffer.length >= 20) this.flush()
  }

  info(module, event, data) { this._write('info', module, event, data) }
  warn(module, event, data) { this._write('warn', module, event, data) }
  error(module, event, data) { this._write('error', module, event, data) }
  debug(module, event, data) { this._write('debug', module, event, data) }

  // -------------------------------------------------------------------------
  // 文件轮转 / flush
  // -------------------------------------------------------------------------

  _currentLogFile(today) {
    const dateKey = today || dateStr(this._clock())
    return join(this.logDir, `${LOG_PREFIX}${dateKey}${LOG_SUFFIX}`)
  }

  flush() {
    if (_pendingBuffer.length === 0) return
    const today = dateStr(this._clock())
    if (_currentFileDate !== today) {
      _currentFileDate = today
    }
    const filePath = this._currentLogFile(today)
    const toWrite = _pendingBuffer.join('\n') + '\n'
    _pendingBuffer = []
    try {
      // 检查大小，超过 MAX_FILE_SIZE 触发 split
      if (existsSync(filePath)) {
        const st = statSync(filePath)
        if (st.size + toWrite.length > MAX_FILE_SIZE) {
          const ts = nowMs()
          const splitPath = filePath.replace(LOG_SUFFIX, `.${ts}${LOG_SUFFIX}`)
          renameSync(filePath, splitPath)
        }
      }
      appendFileSync(filePath, toWrite, 'utf8')
    } catch (err) {
      // 写日志失败不能影响主流程；只 stderr
      try { process.stderr.write(`[gina-logger] write failed: ${err.message}\n`) } catch { /* ignore */ }
    }
  }

  _flushSync() {
    // 同步版本（用于进程退出 / 日期切换）
    if (_pendingBuffer.length === 0) return
    const today = dateStr(this._clock())
    _currentFileDate = today
    const filePath = this._currentLogFile(today)
    const toWrite = _pendingBuffer.join('\n') + '\n'
    _pendingBuffer = []
    try {
      appendFileSync(filePath, toWrite, 'utf8')
    } catch { /* ignore */ }
  }

  _cleanupOldLogs() {
    try {
      const files = readdirSync(this.logDir)
      const cutoff = nowMs() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
      for (const f of files) {
        if (!f.startsWith(LOG_PREFIX) || !f.endsWith(LOG_SUFFIX)) continue
        const fullPath = join(this.logDir, f)
        try {
          const st = statSync(fullPath)
          if (st.mtimeMs < cutoff) {
            unlinkSync(fullPath)
          }
        } catch { /* ignore single file failure */ }
      }
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // 读取（测试用）
  // -------------------------------------------------------------------------

  readLogs(date) {
    const dateKey = date || dateStr(this._clock())
    const filePath = join(this.logDir, `${LOG_PREFIX}${dateKey}${LOG_SUFFIX}`)
    if (!existsSync(filePath)) return []
    const content = readFileSync(filePath, 'utf8')
    return content.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return { _parseError: true, raw: line } }
    })
  }

  startAutoFlush() {
    if (_flushTimer) return
    _flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    if (_flushTimer.unref) _flushTimer.unref()
    // 进程退出时 flush
    if (typeof process !== 'undefined') {
      process.once('exit', () => this._flushSync())
      process.once('SIGINT', () => { this._flushSync(); process.exit(0) })
      process.once('SIGTERM', () => { this._flushSync(); process.exit(0) })
    }
  }

  stopAutoFlush() {
    if (_flushTimer) {
      clearInterval(_flushTimer)
      _flushTimer = null
    }
  }

  close() {
    this.flush()
    this.stopAutoFlush()
  }
}

// ---------------------------------------------------------------------------
// 单例
// ---------------------------------------------------------------------------

export function getLogger(opts = {}) {
  if (!_instance) {
    _instance = new Logger(opts)
    _instance.startAutoFlush()
  }
  return _instance
}

export function resetLoggerForTest() {
  if (_instance) {
    _instance.close()
    _instance = null
  }
  _pendingBuffer = []
  _currentFileDate = null
  if (_flushTimer) {
    clearInterval(_flushTimer)
    _flushTimer = null
  }
}

// ---------------------------------------------------------------------------
// 测试用 hooks
// ---------------------------------------------------------------------------

export const __test = {
  sanitize,
  ALLOWED_FIELDS,
  FORBIDDEN_KEYS,
  FORBIDDEN_VALUE_PATTERNS,
}
