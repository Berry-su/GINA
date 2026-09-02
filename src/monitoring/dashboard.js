// src/monitoring/dashboard.js —— GINA 本地监控 dashboard
//
// 设计哲学（ADR-017）：
//   - 绑 127.0.0.1:3000（不绑 0.0.0.0，零外网暴露）
//   - d3.js 实时图（已依赖）
//   - 5 路由：HTML / 3 JSON API / health
//   - 不外发任何数据
//   - emotion-isolation 严守：不 import joy-state
//
// 公开 API：
//   startDashboard({ metrics, port, host })  → 启动 HTTP server
//   stopDashboard()                          → 停止
//   getDashboardStatus()                     → 状态（测试用）
//
// 路由：
//   GET /metrics                       → HTML（d3.js 实时图）
//   GET /metrics/api/startups          → JSON 启动记录
//   GET /metrics/api/modules           → JSON 模块聚合
//   GET /metrics/api/alerts            → JSON 告警历史
//   GET /metrics/api/health            → JSON 健康检查
//
// 运行：被 src/monitoring/index.js 启动
// 测试：node --test tests/test-monitoring.js

import http from 'node:http'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// HTML 模板（d3.js 实时图）
// ---------------------------------------------------------------------------

const HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>GINA Metrics Dashboard</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
body { font-family: ui-monospace, "SF Mono", Menlo, monospace; margin: 24px; background: #0c0c0c; color: #e0e0e0; }
h1 { color: #8ab4f8; font-size: 18px; margin: 0 0 16px; }
h2 { color: #8ab4f8; font-size: 14px; margin: 24px 0 8px; }
.section { background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 12px; margin-bottom: 12px; }
.kpi { display: inline-block; margin: 8px 16px 8px 0; }
.kpi-label { font-size: 11px; color: #888; }
.kpi-value { font-size: 24px; color: #fff; font-weight: bold; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #2a2a2a; }
th { color: #8ab4f8; font-weight: normal; }
.bar { background: #1a73e8; height: 6px; }
.warn { color: #f4b400; }
.danger { color: #ea4335; }
.muted { color: #666; }
</style>
</head>
<body>
<h1>GINA Metrics Dashboard <span class="muted" id="updated"></span></h1>

<div class="section">
  <div class="kpi"><div class="kpi-label">启动次数</div><div class="kpi-value" id="kpi-startups">—</div></div>
  <div class="kpi"><div class="kpi-label">模块数</div><div class="kpi-value" id="kpi-modules">—</div></div>
  <div class="kpi"><div class="kpi-label">总调用数</div><div class="kpi-value" id="kpi-calls">—</div></div>
  <div class="kpi"><div class="kpi-label">告警数</div><div class="kpi-value" id="kpi-alerts">—</div></div>
</div>

<div class="section">
  <h2>模块聚合（按总调用数）</h2>
  <div id="chart-modules"></div>
</div>

<div class="section">
  <h2>最近启动（最近 20 次）</h2>
  <table><thead><tr><th>时间</th><th>版本</th><th>平台</th><th>耗时</th></tr></thead>
  <tbody id="tbody-startups"></tbody></table>
</div>

<div class="section">
  <h2>告警历史（最近 20 条）</h2>
  <table><thead><tr><th>时间</th><th>类型</th><th>模块</th><th>触发值 / 阈值</th><th>消息</th></tr></thead>
  <tbody id="tbody-alerts"></tbody></table>
</div>

<script>
async function load() {
  try {
    const [mods, starts, alerts] = await Promise.all([
      fetch('/metrics/api/modules').then(r => r.json()),
      fetch('/metrics/api/startups').then(r => r.json()),
      fetch('/metrics/api/alerts').then(r => r.json()),
    ])

    // KPI
    document.getElementById('kpi-startups').textContent = starts.length
    document.getElementById('kpi-modules').textContent = mods.length
    document.getElementById('kpi-calls').textContent = mods.reduce((a, m) => a + m.total_calls, 0)
    document.getElementById('kpi-alerts').textContent = alerts.length
    document.getElementById('updated').textContent = '更新于 ' + new Date().toLocaleTimeString()

    // 模块聚合表
    const container = document.getElementById('chart-modules')
    container.innerHTML = ''
    const table = document.createElement('table')
    table.innerHTML = '<thead><tr><th>模块</th><th>调用数</th><th>错误率</th><th>P50</th><th>P95</th><th>P99</th><th>热度</th></tr></thead>'
    const tbody = document.createElement('tbody')
    const maxCalls = Math.max(1, ...mods.map(m => m.total_calls))
    for (const m of mods.slice(0, 30)) {
      const tr = document.createElement('tr')
      const errClass = m.error_rate > 0.05 ? 'danger' : (m.error_rate > 0.01 ? 'warn' : '')
      const p95Class = m.p95_ms > 1000 ? 'danger' : (m.p95_ms > 500 ? 'warn' : '')
      tr.innerHTML = \`<td>\${m.module}</td>
        <td>\${m.total_calls}</td>
        <td class="\${errClass}">\${(m.error_rate * 100).toFixed(1)}%</td>
        <td>\${m.p50_ms.toFixed(0)}ms</td>
        <td class="\${p95Class}">\${m.p95_ms.toFixed(0)}ms</td>
        <td>\${m.p99_ms.toFixed(0)}ms</td>
        <td><div class="bar" style="width: \${(m.total_calls / maxCalls * 100).toFixed(0)}%"></div></td>\`
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    container.appendChild(table)

    // 启动历史
    const tStartups = document.getElementById('tbody-startups')
    tStartups.innerHTML = starts.slice(0, 20).map(s =>
      \`<tr><td class="muted">\${new Date(s.ts).toLocaleString()}</td><td>\${s.version}</td><td>\${s.platform}/\${s.arch}</td><td>\${s.duration_ms}ms</td></tr>\`
    ).join('')

    // 告警
    const tAlerts = document.getElementById('tbody-alerts')
    tAlerts.innerHTML = alerts.slice(0, 20).map(a =>
      \`<tr><td class="muted">\${new Date(a.ts).toLocaleString()}</td><td class="\${a.kind === 'startup_failed' ? 'danger' : 'warn'}">\${a.kind}</td><td>\${a.module || '—'}</td><td>\${a.value.toFixed(2)} / \${a.threshold.toFixed(2)}</td><td>\${a.message}</td></tr>\`
    ).join('')
  } catch (err) {
    document.getElementById('updated').textContent = '加载失败: ' + err.message
  }
}
load()
setInterval(load, 10000)
</script>
</body>
</html>
`

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------

let _server = null
let _state = { running: false, port: null, host: null }

function jsonResponse(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Connection': 'close',
  })
  res.end(body)
}

function htmlResponse(res, code, html) {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'Connection': 'close',
  })
  res.end(html)
}

function handler(req, res, metrics) {
  const url = req.url || '/'
  if (url === '/metrics' || url === '/metrics/') {
    return htmlResponse(res, 200, HTML)
  }
  if (url === '/metrics/api/health') {
    return jsonResponse(res, 200, { ok: true, ts: Date.now() })
  }
  if (url === '/metrics/api/startups') {
    if (!metrics) return jsonResponse(res, 503, { error: 'metrics not available' })
    return jsonResponse(res, 200, metrics.getStartups({ limit: 50 }))
  }
  if (url === '/metrics/api/modules') {
    if (!metrics) return jsonResponse(res, 503, { error: 'metrics not available' })
    return jsonResponse(res, 200, metrics.getAllModuleStats())
  }
  if (url === '/metrics/api/alerts') {
    if (!metrics) return jsonResponse(res, 503, { error: 'metrics not available' })
    return jsonResponse(res, 200, metrics.getAlerts({ limit: 50 }))
  }
  return jsonResponse(res, 404, { error: 'not found', path: url })
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export function startDashboard({ metrics, port = 3000, host = '127.0.0.1' } = {}) {
  if (_server) return Promise.resolve({ ok: false, reason: 'already_running', port: _state.port })
  return new Promise((resolve) => {
    _server = http.createServer((req, res) => handler(req, res, metrics))
    _server.once('error', (err) => {
      _state = { running: false, port, host, error: err.message }
      _server = null
      resolve({ ok: false, reason: 'error', error: err.message })
    })
    _server.listen(port, host, () => {
      const actualPort = _server.address()?.port || port
      _state = { running: true, port: actualPort, host }
      resolve({ ok: true, port: actualPort, host })
    })
  })
}

export function stopDashboard() {
  if (_server) {
    try { _server.close() } catch { /* ignore */ }
    _server = null
  }
  _state = { running: false, port: null, host: null }
}

// 同步版（仅用于测试 / 关闭路径）
export function _stopDashboardSync() {
  if (_server) {
    try { _server.close() } catch { /* ignore */ }
    _server = null
  }
  _state = { running: false, port: null, host: null }
}

export function getDashboardStatus() {
  return { ..._state }
}

export const __test = {
  handler,
  HTML,
}
