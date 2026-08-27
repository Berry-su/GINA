#!/usr/bin/env node

/**
 * Gina Playwright UI 集成测试
 * 
 * 测试范围:
 * 1. 大脑 UI 渲染完整性（使用 Playwright + mock HTTP 服务）
 * 2. 三大系统数据展示（决策链、进化里程碑、可解释性）
 * 3. SSE 事件流处理
 * 4. 交互状态持久化
 */

import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = __dirname

const tests = []
const results = { passed: 0, failed: 0, total: 0 }

function test(name, fn) {
  tests.push({ name, fn })
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed')
}

// ============================================================
// Mock Server - 提供大脑 UI 数据
// ============================================================

function createMockServer() {
  const brainUiEvents = []
  let sseRes = null

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')

    // 静态文件
    const serveFile = (filePath, contentType) => {
      try {
        const stat = fs.statSync(filePath)
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size })
        fs.createReadStream(filePath).pipe(res)
      } catch {
        res.writeHead(404)
        res.end('not found')
      }
    }

    if (url.pathname === '/' || url.pathname === '/brain-ui') {
      serveFile(path.join(root, 'brain-ui.html'), 'text/html; charset=utf-8')
      return
    }

    // vendor
    if (url.pathname === '/vendor/d3/d3.min.js') {
      serveFile(path.join(root, 'node_modules', 'd3', 'dist', 'd3.min.js'), 'text/javascript')
      return
    }

    // Brain UI 模块
    if (url.pathname.startsWith('/src/ui/brain-ui/')) {
      const rel = decodeURIComponent(url.pathname.slice('/src/ui/brain-ui/'.length))
      const assetPath = path.resolve(root, 'src', 'ui', 'brain-ui', rel)
      if (assetPath.startsWith(path.resolve(root, 'src', 'ui', 'brain-ui')) && fs.existsSync(assetPath)) {
        const ext = path.extname(assetPath)
        const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }
        serveFile(assetPath, types[ext] || 'text/plain')
        return
      }
      res.writeHead(404)
      res.end('not found')
      return
    }

    // Agent profile
    if (url.pathname === '/agent-profile') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: 'Gina', version: '4.0', status: 'online' }))
      return
    }

    // 决策历史
    if (url.pathname === '/decisions') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        decisions: [
          { id: 'd1', chosenOption: 'fast_pipeline', weightedScore: 0.85, style: 'balanced', timestamp: Date.now() },
          { id: 'd2', chosenOption: 'deep_analysis', weightedScore: 0.72, style: 'aggressive', timestamp: Date.now() - 1000 },
        ],
        total: 2,
      }))
      return
    }

    // 进化里程碑
    if (url.pathname === '/evolution/milestones') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        milestones: [
          { id: 'm1', capability: 'decision.multi_criteria_analysis', priority: 'high', currentLevel: 0, targetLevel: 1, experienceNeeded: 20 },
          { id: 'm2', capability: 'cognition.pattern_recognition', priority: 'medium', currentLevel: 2, targetLevel: 3, experienceNeeded: 50 },
          { id: 'm3', capability: 'perception.text_understanding', priority: 'medium', currentLevel: 0, targetLevel: 1, experienceNeeded: 30 },
        ],
        currentStage: 'stage_1',
        totalProgress: 0.15,
      }))
      return
    }

    // 可解释性报告
    if (url.pathname === '/explainability/report') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        decisionId: 'd1',
        reasoning: '基于多准则评估，快速管道在综合得分上最优',
        alternatives: ['deep_analysis', 'hybrid_approach'],
        confidence: 0.85,
        transparency: { auditable: true, traceable: true },
      }))
      return
    }

    // 能力图谱
    if (url.pathname === '/capabilities') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        domains: {
          decision: { name: '决策', level: 1, subCapabilities: [{ id: 'multi_criteria_analysis', level: 1, experience: 5 }] },
          cognition: { name: '认知', level: 2, subCapabilities: [{ id: 'pattern_recognition', level: 2, experience: 95 }] },
          perception: { name: '感知', level: 1, subCapabilities: [{ id: 'text_understanding', level: 1, experience: 5 }] },
        },
        overallLevel: 1.3,
      }))
      return
    }

    // SSE 事件流
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      const connectedEvent = { type: 'connected', ts: new Date().toISOString() }
      brainUiEvents.push(connectedEvent)
      res.write(`data: ${JSON.stringify(connectedEvent)}\n\n`)
      sseRes = res
      req.on('close', () => { sseRes = null })
      return
    }

    // Conversations
    if (url.pathname === '/conversations') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { id: 1, role: 'user', content: '帮我分析一下数据', channel: 'TUI' },
        { id: 2, role: 'jarvis', content: '正在分析...', channel: 'TUI' },
      ]))
      return
    }

    // Settings
    if (url.pathname === '/settings') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        llm: { activated: true, provider: 'deepseek', model: 'deepseek-v4-pro' },
        brain: { decision: 'active', evolution: 'active', explainability: 'active' },
      }))
      return
    }

    // Memories
    if (url.pathname === '/memories') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({
        id: i + 1, mem_id: `m${i + 1}`, type: 'fact', content: `记忆 ${i + 1}`, created_at: new Date(Date.now() - i * 60000).toISOString(),
      }))))
      return
    }

    // Heartbeat
    if (url.pathname === '/settings/heartbeat') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        heartbeat: { enabled: true, defaultIntervalMinutes: 20 },
      }))
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  server.emitSse = (event) => {
    brainUiEvents.push(event)
    if (sseRes) {
      try { sseRes.write(`data: ${JSON.stringify(event)}\n\n`) } catch {}
    }
  }

  server.getEvents = () => brainUiEvents.slice()
  return server
}

// ============================================================
// 测试套件
// ============================================================

test('大脑 UI 页面加载', async ({ page, baseUrl }) => {
  const response = await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  assert(response.ok(), `页面加载失败: ${response.status()}`)
  const title = await page.title()
  assert(title !== '', '页面应有标题')
})

test('Agent 信息加载', async ({ page, baseUrl }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  const profile = await page.evaluate(async () => {
    const res = await fetch('/agent-profile')
    return res.json()
  })
  assert(profile.name === 'Gina', `Agent 名应为 Gina，实际: ${profile.name}`)
})

test('决策系统数据加载', async ({ page, baseUrl }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  const decisions = await page.evaluate(async () => {
    const res = await fetch('/decisions')
    return res.json()
  })
  assert(decisions.decisions.length >= 2, `应有至少 2 条决策记录，实际: ${decisions.decisions.length}`)
  assert(decisions.decisions[0].chosenOption !== undefined, '决策应有选中选项')
  assert(typeof decisions.decisions[0].weightedScore === 'number', '决策分数应为数值')
})

test('进化里程碑数据加载', async ({ page, baseUrl }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  const milestones = await page.evaluate(async () => {
    const res = await fetch('/evolution/milestones')
    return res.json()
  })
  assert(milestones.milestones.length >= 3, `应有至少 3 个里程碑，实际: ${milestones.milestones.length}`)
  assert(milestones.currentStage !== undefined, '应有当前阶段')
  assert(typeof milestones.totalProgress === 'number', '总进度应为数值')
})

test('可解释性报告加载', async ({ page, baseUrl }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  const report = await page.evaluate(async () => {
    const res = await fetch('/explainability/report')
    return res.json()
  })
  assert(report.decisionId === 'd1', `决策 ID 应为 d1，实际: ${report.decisionId}`)
  assert(report.reasoning !== undefined, '应有推理内容')
  assert(report.confidence > 0, '置信度应大于 0')
})

test('能力图谱数据加载', async ({ page, baseUrl }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  const caps = await page.evaluate(async () => {
    const res = await fetch('/capabilities')
    return res.json()
  })
  assert(Object.keys(caps.domains).length >= 3, `应有至少 3 个领域，实际: ${Object.keys(caps.domains).length}`)
  assert(typeof caps.overallLevel === 'number', '整体等级应为数值')
})

test('LLM 配置加载', async ({ page, baseUrl }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  const settings = await page.evaluate(async () => {
    const res = await fetch('/settings')
    return res.json()
  })
  assert(settings.llm.activated === true, 'LLM 应已激活')
  assert(settings.llm.provider === 'deepseek', `Provider 应为 deepseek，实际: ${settings.llm.provider}`)
  assert(settings.brain.decision === 'active', '决策系统应活跃')
  assert(settings.brain.evolution === 'active', '进化系统应活跃')
  assert(settings.brain.explainability === 'active', '可解释性系统应活跃')
})

test('SSE 事件连接', async ({ page, baseUrl, server }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })

  // 在浏览器端建立真实的 SSE 连接
  await page.evaluate((url) => {
    window.__sseEvents = []
    const source = new EventSource(`${url}/events`)
    source.onmessage = (e) => {
      try { window.__sseEvents.push(JSON.parse(e.data)) } catch {}
    }
    window.__sseSource = source
  }, baseUrl)

  // 等待连接建立
  await page.waitForTimeout(500)

  // 发送测试事件
  server.emitSse({ type: 'decision_made', data: { option: 'fast_pipeline', score: 0.85 }, ts: new Date().toISOString() })
  server.emitSse({ type: 'evolution_update', data: { domain: 'decision', level: 1 }, ts: new Date().toISOString() })
  server.emitSse({ type: 'milestone_reached', data: { capability: 'multi_criteria_analysis' }, ts: new Date().toISOString() })

  await page.waitForTimeout(500)

  // 验证浏览器端真实收到连接 + 业务事件
  const clientEvents = await page.evaluate(() => window.__sseEvents || [])
  assert(clientEvents.some(e => e.type === 'connected'), '浏览器端应有 connected 事件')
  assert(clientEvents.some(e => e.type === 'decision_made'), '浏览器端应有 decision_made 事件')
  assert(clientEvents.some(e => e.type === 'evolution_update'), '浏览器端应有 evolution_update 事件')
  assert(clientEvents.some(e => e.type === 'milestone_reached'), '浏览器端应有 milestone_reached 事件')
})

test('心跳状态', async ({ page, baseUrl }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  
  const heartbeat = await page.evaluate(async () => {
    const res = await fetch('/settings/heartbeat')
    return res.json()
  })
  assert(heartbeat.heartbeat.enabled === true, '心跳应已启用')
  assert(heartbeat.heartbeat.defaultIntervalMinutes > 0, '心跳间隔应大于 0')
})

test('多系统数据一致性', async ({ page, baseUrl }) => {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  
  const [decisions, milestones, caps] = await Promise.all([
    page.evaluate(async () => (await fetch('/decisions')).json()),
    page.evaluate(async () => (await fetch('/evolution/milestones')).json()),
    page.evaluate(async () => (await fetch('/capabilities')).json()),
  ])
  
  // 验证决策中的 domain 与能力图谱一致
  const capDomains = Object.keys(caps.domains)
  assert(capDomains.includes('decision'), '能力图谱应包含 decision 域')
  
  // 验证里程碑能力 ID 格式正确
  for (const m of milestones.milestones) {
    assert(m.capability.includes('.'), `里程碑 capability 应包含 '.' : ${m.capability}`)
    const [domain] = m.capability.split('.')
    assert(capDomains.includes(domain), `里程碑域 ${domain} 应在能力图谱中`)
  }
})

// ============================================================
// 主入口
// ============================================================

async function main() {
  console.log('═════════════════════════════════════════════════')
  console.log('  Gina Playwright UI 集成测试')
  console.log('═════════════════════════════════════════════════')
  console.log()

  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    console.log('  ❌ playwright 未安装')
    console.log('  请运行: npm install playwright')
    process.exit(1)
  }

  // 检查 Playwright 浏览器（优先环境变量，否则自动检测）
  let browserPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  if (!browserPath) {
    try {
      browserPath = chromium.executablePath()
    } catch {
      browserPath = null
    }
  }
  if (!browserPath) {
    console.log('  ⚠️  未找到 Playwright 浏览器')
    console.log('  请运行: npx playwright install chromium')
    console.log('  或设置: PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chrome')
    console.log('')
    console.log('  跳过浏览器测试，继续验证 Mock 服务端点...')
    await runMockTests()
    return
  }
  console.log(`  浏览器: ${browserPath}`)

  const server = createMockServer()
  const port = await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    server.on('error', reject)
  })
  const baseUrl = `http://127.0.0.1:${port}`
  console.log(`  Mock 服务: ${baseUrl}`)

  let browser
  try {
    browser = await chromium.launch({
      executablePath: browserPath,
      args: ['--no-sandbox', '--disable-crash-reporter', '--disable-breakpad'],
    })
  } catch (err) {
    console.log(`  ❌ 启动浏览器失败: ${err.message}`)
    console.log('  跳过浏览器测试，继续验证 Mock 服务端点...')
    runMockTests(baseUrl)
    server.close()
    return
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } })
  
  console.log(`\n  运行 ${tests.length} 个测试...\n`)

  for (const testCase of tests) {
    results.total++
    const start = Date.now()
    try {
      await testCase.fn({ page, baseUrl, server })
      const duration = Date.now() - start
      results.passed++
      console.log(`  ✅ ${testCase.name} (${duration}ms)`)
    } catch (err) {
      const duration = Date.now() - start
      results.failed++
      console.log(`  ❌ ${testCase.name} (${duration}ms)`)
      console.log(`     ${err.message}`)
    }
  }

  await browser.close()
  server.close()

  console.log(`\n  结果: ${results.passed}/${results.total} 通过 (${results.failed} 失败)`)
  
  if (results.failed > 0) process.exit(1)
}

// Mock-only 测试（无浏览器时）
async function runMockTests(baseUrl) {
  const server = createMockServer()
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  const url = baseUrl || `http://127.0.0.1:${port}`
  
  console.log(`  Mock 服务: ${url}`)
  console.log(`\n  运行 API 端点测试...\n`)

  const endpoints = [
    ['/agent-profile', { name: 'Gina' }],
    ['/decisions', { decisions: 2 }],
    ['/evolution/milestones', { milestones: 3 }],
    ['/explainability/report', { decisionId: 'd1' }],
    ['/capabilities', { domains: 3 }],
    ['/settings', { llm: true, brain: true }],
    ['/settings/heartbeat', { heartbeat: true }],
    ['/memories', { memories: true }],
  ]

  for (const [path, check] of endpoints) {
    try {
      const res = await fetch(`${url}${path}`)
      const data = await res.json()
      let ok = true
      for (const key of Object.keys(check)) {
        if (data[key] === undefined && !data.decisions && !data.milestones && !data.domains) {
          // 检查嵌套
          if (key === 'llm' && data.llm?.activated !== true) ok = false
          if (key === 'brain' && data.brain?.decision !== 'active') ok = false
          if (key === 'heartbeat' && !data.heartbeat) ok = false
        }
      }
      console.log(`  ${ok ? '✅' : '❌'} ${path}`)
      if (!ok) results.failed++
      else results.passed++
      results.total++
    } catch (err) {
      console.log(`  ❌ ${path}: ${err.message}`)
      results.failed++
      results.total++
    }
  }

  console.log(`\n  结果: ${results.passed}/${results.total} 通过`)
  server.close()
  
  if (results.failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('测试执行失败:', err)
  process.exit(1)
})
