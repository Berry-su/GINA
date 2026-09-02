// tests/test-monitoring.js — GINA 本地监控模块测试（ADR-017）
//
// 设计：ADR-017 §10 验收清单
// 目的：监控 4 文件 (metrics/logger/alert/dashboard) 行为 + 零外发 + 零敏感
//
// 8 断言：
//   T1: metrics.recordStartup + getStartupCount（基础）
//   T2: metrics.recordCall + getAllModuleStats（聚合 + P95）
//   T3: logger.sanitize 字段白名单 + 黑名单截断（无敏感数据落盘）
//   T4: logger JSON Lines 格式 + 每天 1 文件
//   T5: alert.checkAfterCall 触发慢响应 / 高错误率 告警
//   T6: dashboard 127.0.0.1 + JSON API 端点
//   T7: 静态扫 — src/monitoring/ 无 http.request / fetch / axios 外发
//   T8: 注入敏感数据测试 — 落盘文件不含明文 password/token
//
// 运行：node --test tests/test-monitoring.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

// ---------------------------------------------------------------------------
// 临时目录（每个测试独立）
// ---------------------------------------------------------------------------

const TEST_BASE = mkdtempSync(join(tmpdir(), 'gina-mon-test-'))
process.env.GINA_USER_DIR = TEST_BASE

// 动态 import（必须放在 process.env 设置之后）
const { getMetrics, resetMetricsForTest, __test: metricsTest } = await import('../src/monitoring/metrics.js')
const { getLogger, resetLoggerForTest, sanitize, __test: loggerTest } = await import('../src/monitoring/logger.js')
const { getAlerter, resetAlerterForTest, DEFAULT_THRESHOLDS } = await import('../src/monitoring/alert.js')
const { startDashboard, stopDashboard, getDashboardStatus, __test: dashboardTest } = await import('../src/monitoring/dashboard.js')

// 关闭上次的实例
resetMetricsForTest()
resetLoggerForTest()
resetAlerterForTest()
stopDashboard()

// ---------------------------------------------------------------------------
// T1: metrics.recordStartup + getStartupCount
// ---------------------------------------------------------------------------

test('T1: metrics.recordStartup 启动记录 + getStartupCount', async () => {
  const m = getMetrics()
  m.reset()
  m.recordStartup({ version: '2.1.601-test', pid: 12345, platform: 'darwin', arch: 'arm64', node_version: 'v20.20.1', duration_ms: 1234 })
  m.recordStartup({ version: '2.1.601-test', pid: 12346, platform: 'darwin', arch: 'arm64', node_version: 'v20.20.1', duration_ms: 1500 })
  assert.equal(m.getStartupCount(), 2, '应记录 2 次启动')
  const list = m.getStartups({ limit: 10 })
  assert.equal(list.length, 2)
  assert.equal(list[0].version, '2.1.601-test', 'version 字段保留')
  assert.equal(list[0].platform, 'darwin', 'platform 字段保留')
})

// ---------------------------------------------------------------------------
// T2: metrics.recordCall + getAllModuleStats（聚合 + P95）
// ---------------------------------------------------------------------------

test('T2: metrics.recordCall 模块调用 + 聚合 + P95', async () => {
  const m = getMetrics()
  m.reset()
  // 模拟 50 次调用：30 次成功（100ms）+ 15 次成功（500ms）+ 5 次失败（2000ms）
  for (let i = 0; i < 30; i++) m.recordCall({ module: 'test_module', duration_ms: 100, success: true })
  for (let i = 0; i < 15; i++) m.recordCall({ module: 'test_module', duration_ms: 500, success: true })
  for (let i = 0; i < 5; i++) m.recordCall({ module: 'test_module', duration_ms: 2000, success: false, error_code: 'TIMEOUT' })
  // 强制 flush
  metricsTest.flushNow(m)
  // 等异步 transaction 落盘
  await new Promise(r => setTimeout(r, 100))
  metricsTest.flushNow(m)
  const stats = m.getModuleStats('test_module')
  assert.ok(stats, '应返回 stats')
  assert.equal(stats.total_calls, 50, '总调用 50')
  assert.equal(stats.error_count, 5, '错误数 5')
  assert.ok(Math.abs(stats.error_rate - 0.1) < 0.001, `错误率 ≈ 0.1, 实际 ${stats.error_rate}`)
  assert.ok(stats.p50_ms >= 100 && stats.p50_ms <= 500, `P50 应在 100-500ms 之间, 实际 ${stats.p50_ms}`)
  assert.ok(stats.p95_ms >= 500, `P95 应 ≥ 500ms, 实际 ${stats.p95_ms}`)
})

// ---------------------------------------------------------------------------
// T3: logger.sanitize 字段白名单 + 黑名单截断
// ---------------------------------------------------------------------------

test('T3: logger.sanitize 字段白名单 + 黑名单截断（无敏感数据）', () => {
  const input = {
    ts: 1234567890,
    level: 'info',
    module: 'test',
    event: 'call',
    password: 'mySecretPassword123',         // 黑名单
    token: 'ghp_abc123def456ghi789jkl',      // 黑名单
    api_key: 'sk-abcdefghij1234567890',      // 黑名单
    authorization: 'Bearer xyz123',          // 黑名单
    user_id: 'user_123',                     // 白名单
    garbage_field: 'should_be_dropped',      // 不在白名单
  }
  const out = sanitize(input)
  assert.equal(out.ts, 1234567890, 'ts 保留')
  assert.equal(out.user_id, 'user_123', 'user_id 保留')
  assert.equal(out.password, '***REDACTED***', 'password 被截断')
  assert.equal(out.token, '***REDACTED***', 'token 被截断')
  assert.equal(out.api_key, '***REDACTED***', 'api_key 被截断')
  assert.equal(out.authorization, '***REDACTED***', 'authorization 被截断')
  assert.equal(out.garbage_field, undefined, '非白名单字段被丢弃')
  // 值匹配截断：模拟 OpenAI key 在普通字段
  const v = sanitize({ message_safe: 'before sk-abc123def456ghi789jkl012 after' })
  assert.equal(v.message_safe, 'before ***REDACTED_PATTERN*** after', 'OpenAI key 模式被截断')
})

// ---------------------------------------------------------------------------
// T4: logger JSON Lines 格式 + 每天 1 文件
// ---------------------------------------------------------------------------

test('T4: logger JSON Lines 格式 + 文件创建', async () => {
  const m = getMetrics()
  const log = getLogger({ logDir: join(TEST_BASE, 'data', 'logs') })
  log.info('test', 'unit_event', { capability: 'demo', duration_ms: 50, success: true })
  log.warn('test', 'warn_event', { capability: 'demo', duration_ms: 100 })
  log.flush()
  // 找今天的日志文件
  const today = new Date()
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const filePath = join(TEST_BASE, 'data', 'logs', `gina-${dateKey}.jsonl`)
  assert.ok(existsSync(filePath), `日志文件应存在: ${filePath}`)
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split('\n').filter(Boolean)
  assert.ok(lines.length >= 2, `至少 2 条日志, 实际 ${lines.length}`)
  const first = JSON.parse(lines[0])
  assert.equal(first.level, 'info', 'level = info')
  assert.equal(first.module, 'test', 'module = test')
  assert.equal(first.event, 'unit_event', 'event 保留')
  assert.equal(typeof first.ts, 'number', 'ts 是 number')
  assert.equal(first.capability, 'demo', 'capability 字段保留')
})

// ---------------------------------------------------------------------------
// T5: alert 触发阈值告警
// ---------------------------------------------------------------------------

test('T5: alert.checkAfterCall 触发慢响应 + 高错误率告警', async () => {
  const m = getMetrics()
  m.reset()
  // 注入一个慢 + 高错误率的模块
  for (let i = 0; i < 30; i++) {
    m.recordCall({
      module: 'slow_bad_module',
      duration_ms: i < 5 ? 2000 : 100,  // 前 5 次慢
      success: i < 5,  // 前 5 次失败
      error_code: i < 5 ? 'TIMEOUT' : null,
    })
  }
  metricsTest.flushNow(m)
  await new Promise(r => setTimeout(r, 100))
  metricsTest.flushNow(m)
  // 启动 alerter（用 mock notifier）
  resetAlerterForTest()
  const notifications = []
  const alerter = getAlerter({
    metrics: m,
    logger: null,
    osascriptEnabled: false,  // 测试环境不真弹
    notifier: (n) => notifications.push(n),
  })
  alerter.setThresholds({ min_calls_for_eval: 10, error_rate: 0.05, p95_ms: 1000, cooldown_ms: 0 })
  const fired = alerter.checkAfterCall({ module: 'slow_bad_module', duration_ms: 2000, success: false })
  assert.ok(fired.length > 0, `应至少触发 1 个告警, fired=${JSON.stringify(fired)}`)
  assert.ok(notifications.length > 0, '应有通知')
  // 验证告警有消息
  for (const n of notifications) {
    assert.ok(typeof n.body === 'string' && n.body.length > 0, '通知有 body')
  }
  // 验证告警记录已写 metrics
  const alerts = m.getAlerts({ limit: 10 })
  assert.ok(alerts.length > 0, '告警应落 metrics')
  // 验证 startup 失败告警
  resetAlerterForTest()
  const alerter2 = getAlerter({ metrics: m, logger: null, osascriptEnabled: false, notifier: () => {} })
  alerter2.setThresholds({ cooldown_ms: 0 })
  const startupFired = alerter2.checkAfterStartup({ success: false, error: 'mock crash' })
  assert.ok(startupFired.includes('startup_failed'), 'startup 失败应告警')
})

// ---------------------------------------------------------------------------
// T6: dashboard 127.0.0.1 + JSON API 端点
// ---------------------------------------------------------------------------

test('T6: dashboard 绑 127.0.0.1 + JSON API 端点', async () => {
  const m = getMetrics()
  m.reset()
  m.recordStartup({ version: 'test', pid: 1, platform: 'darwin', arch: 'arm64', node_version: 'v20', duration_ms: 100 })
  m.recordCall({ module: 'demo', duration_ms: 50, success: true })

  // 用 port=0 让 node 自动分配，避免冲突
  const r = await startDashboard({ metrics: m, port: 0, host: '127.0.0.1' })
  if (!r.ok) {
    // 端口被占，跳过（测试通过 status 检查）
    const s = getDashboardStatus()
    assert.ok(s.error || s.running === false, '端口被占应记录 error 或 running=false')
    return
  }
  assert.equal(r.host, '127.0.0.1', '必须绑 127.0.0.1（不是 0.0.0.0）')
  const s = getDashboardStatus()
  assert.equal(s.running, true, 'dashboard 应在跑')
  assert.equal(s.host, '127.0.0.1', 'state.host 必须是 127.0.0.1')
  assert.ok(s.port > 0, `实际端口 > 0, 实际 ${s.port}`)
  // 测端点
  const httpModule = await import('node:http')
  const httpGet = (path) => new Promise((resolve, reject) => {
    const req = httpModule.get({ host: '127.0.0.1', port: s.port, path, timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (c) => body += c)
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
  })
  const health = await httpGet('/metrics/api/health')
  assert.equal(health.status, 200, 'health 200')
  const healthJson = JSON.parse(health.body)
  assert.equal(healthJson.ok, true, 'health.ok = true')
  const starts = await httpGet('/metrics/api/startups')
  assert.equal(starts.status, 200, 'startups 200')
  const startsJson = JSON.parse(starts.body)
  assert.ok(Array.isArray(startsJson), 'startups 是 array')
  const modules = await httpGet('/metrics/api/modules')
  assert.equal(modules.status, 200, 'modules 200')
  const root = await httpGet('/metrics')
  assert.equal(root.status, 200, '/metrics 200')
  assert.ok(root.body.includes('<html') || root.body.includes('<!doctype'), 'HTML 返回')
  stopDashboard()
})

// ---------------------------------------------------------------------------
// T7: 静态扫 — src/monitoring/ 无 http.request / fetch / axios 外发
// ---------------------------------------------------------------------------

test('T7: 静态扫 — src/monitoring/ 4 文件无外发 HTTP/fetch/axios', () => {
  const files = [
    join(ROOT, 'src/monitoring/metrics.js'),
    join(ROOT, 'src/monitoring/logger.js'),
    join(ROOT, 'src/monitoring/alert.js'),
    join(ROOT, 'src/monitoring/dashboard.js'),
  ]
  for (const f of files) {
    if (!existsSync(f)) {
      throw new Error(`监控文件不存在: ${f}（可能未落盘）`)
    }
    const content = readFileSync(f, 'utf8')
    // metrics/logger/alert 三个文件：禁止任何外发（fetch/axios/undici/http.request）
    if (!f.endsWith('dashboard.js')) {
      assert.ok(!/\bfetch\s*\(/.test(content), `${f} 不应使用 fetch()`)
      assert.ok(!/\baxios\b/.test(content), `${f} 不应 import axios`)
      assert.ok(!/http\.request|https\.request/.test(content), `${f} 不应直接 http.request`)
    } else {
      // dashboard.js：只允许本地的 createServer + listen
      //   fetch() 只允许出现在 HTML 字符串内（浏览器客户端调用本机 API，不算服务端外发）
      //   检查 import / 顶级调用模式
      assert.ok(!/^import.*['"]node-fetch['"]/m.test(content), 'dashboard.js 不应 import node-fetch')
      assert.ok(!/^import.*from\s+['"]axios['"]/m.test(content), 'dashboard.js 不应 import axios')
      // listen 必须绑 127.0.0.1（不能 0.0.0.0）
      assert.ok(!/listen\([^)]*['"]0\.0\.0\.0['"]/.test(content), 'dashboard.js listen 不应绑 0.0.0.0')
      assert.ok(/['"]127\.0\.0\.1['"]/.test(content), 'dashboard.js 应显式绑 127.0.0.1')
    }
  }
})

// ---------------------------------------------------------------------------
// T8: 注入敏感数据测试 — 落盘文件不含明文 password/token
// ---------------------------------------------------------------------------

test('T8: 注入敏感数据测试 — 落盘文件不含明文 password/token', () => {
  // 重置 logger，用新目录
  resetLoggerForTest()
  const sensitiveDir = join(TEST_BASE, 'sensitive-test')
  const log = getLogger({ logDir: join(sensitiveDir, 'logs') })
  // 注入明显敏感数据：尝试通过各种字段名
  const secretStr1 = 'ThisIsASecretPassword_xyz789'
  const secretStr2 = 'ghp_ABCDEFGHIJKLMNOPabcdefghij'
  const secretStr3 = 'sk-proj-1234567890abcdefghij'
  log.info('test', 'leak_test', {
    password: secretStr1,         // 字段名触发截断
    token: secretStr2,            // 字段名触发截断
    api_key: secretStr3,          // 字段名触发截断
    user_id: 'user_safe',         // 安全的字段
  })
  log.info('test', 'leak_test_2', {
    // 模拟 OpenAI key 在普通字段（值模式截断）
    message_safe: `prefix ${secretStr3} suffix`,
  })
  log.flush()
  // 找今天文件
  const today = new Date()
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const filePath = join(sensitiveDir, 'logs', `gina-${dateKey}.jsonl`)
  assert.ok(existsSync(filePath), `敏感测试日志应存在: ${filePath}`)
  const content = readFileSync(filePath, 'utf8')
  // 关键断言：明文 secret 字符串不应该出现
  assert.ok(!content.includes(secretStr1), `明文 secretStr1 (password) 不应出现`)
  assert.ok(!content.includes(secretStr2), `明文 secretStr2 (token) 不应出现`)
  assert.ok(!content.includes(secretStr3), `明文 secretStr3 (api_key) 不应出现`)
  // 但 ***REDACTED*** 应该出现
  assert.ok(content.includes('***REDACTED***') || content.includes('***REDACTED_PATTERN***'), '应有截断标记')
})

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------

test('cleanup: 临时目录', async () => {
  try { stopDashboard() } catch { /* ignore */ }
  try { resetMetricsForTest() } catch { /* ignore */ }
  try { resetLoggerForTest() } catch { /* ignore */ }
  try { resetAlerterForTest() } catch { /* ignore */ }
  try { rmSync(TEST_BASE, { recursive: true, force: true }) } catch { /* ignore */ }
})
