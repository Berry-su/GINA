#!/usr/bin/env node
/**
 * scripts/ui-design-server.mjs — UI 设计工具本地服务（轻量，不启动 Gina）
 *
 * 用法：
 *   node scripts/ui-design-server.mjs [--port 3921]
 *
 * 启动后自动打开浏览器 http://localhost:3921，可视化：填需求 → 生成 → 预览 → 下载代码。
 * 只做两件事：① 托管 tool.html；② POST /api/generate 走 ui-design 管线 + DeepSeek。
 */

import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSpec, renderSpecToHtml, generateCode } from '../src/ui-design/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROVIDER_BASE = { deepseek: 'https://api.deepseek.com' }

const DEFAULT_LANGUAGE = {
  styleKeywords: ['单色', '精密仪器', '极简', '高对比', '细线框', '等宽数字'],
  palette: { background: '#050506', surface: '#0a0a0c', text: '#e8e8ec', accent: null },
  typography: { labelStyle: '大写 + 宽字距 + 小字号', numericStyle: '等宽', density: '紧凑' },
  spacing: { unit: 8, feel: '紧凑' },
  componentMorphology: '直角切角 + 1px 细线框 + 无阴影',
  mood: '单色精密仪器风，冷静克制',
}

const HOLOGRAM_LANGUAGE = {
  styleKeywords: ['蓝色全息', '钢铁侠贾维斯', '科幻 HUD', '发光粒子', '电影级光影', '纯黑背景'],
  palette: { background: '#000000', surface: 'rgba(10,30,60,0.35)', text: '#dbe9ff', accent: '#3b9dff' },
  typography: { labelStyle: '大写 + 宽字距 + 小字号', numericStyle: '等宽', density: '紧凑' },
  spacing: { unit: 8, feel: '紧凑' },
  componentMorphology: '半透明蓝色 HUD 面板 + 蓝色发光细线框 + 环形刻度/扫描线',
  mood: '蓝色全息未来感，钢铁侠贾维斯科技风',
}

function parseArgs(argv) {
  const a = { port: 3921, provider: 'deepseek' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k.startsWith('--') && argv[i + 1] !== undefined) {
      a[k.slice(2)] = argv[i + 1]
      i++
    }
  }
  return a
}

function loadLlmConfig(provider) {
  const file = resolve(__dirname, '..', 'llm', `${provider}.json`)
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return null }
}

async function chatCompletion({ baseURL, apiKey, model, messages, maxTokens = 8192 }) {
  const body = { model, messages, stream: false, max_tokens: maxTokens, thinking: { type: 'disabled' } }
  const url = `${String(baseURL).replace(/\/$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

async function handleGenerate({ requirement, name, language, token }) {
  if (!requirement?.trim()) return { ok: false, errors: ['缺少 requirement'] }

  const llmFn = (prompt) => chatCompletion({
    baseURL: PROVIDER_BASE.deepseek,
    apiKey: llmCfg.apiKey,
    model: llmCfg.model,
    messages: [{ role: 'user', content: prompt }],
  })

  const tokenId = token || 'monochrome-hud'
  let lang = tokenId === 'hologram-blue' ? HOLOGRAM_LANGUAGE : DEFAULT_LANGUAGE
  if (language) {
    try { lang = typeof language === 'string' ? JSON.parse(language) : language } catch { /* 用默认 */ }
  }

  const generated = await generateSpec({ language: lang, requirement, tokenSet: tokenId, llmFn })
  if (!generated.ok) return { ok: false, errors: generated.errors }

  const rendered = renderSpecToHtml(generated.spec)
  if (!rendered.ok) return { ok: false, errors: rendered.errors }

  const code = generateCode(generated.spec, { componentName: name || generated.spec.name })
  if (!code.ok) return { ok: false, errors: code.errors }

  return { ok: true, html: rendered.html, files: code.files, componentName: code.componentName, spec: generated.spec }
}

const args = parseArgs(process.argv.slice(2))
const PORT = Number(args.port) || 3921
const llmCfg = loadLlmConfig(args.provider)
if (!llmCfg?.apiKey) {
  console.error(`未找到 LLM 配置：llm/${args.provider}.json（需含 apiKey）`)
  process.exit(1)
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = readFileSync(resolve(__dirname, 'ui-design-tool.html'), 'utf-8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }

  if (req.method === 'POST' && req.url === '/api/generate') {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        const result = await handleGenerate(body)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(result))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, errors: [e?.message || String(e)] }))
      }
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`
  console.log(`UI 设计工具已启动：${url}（模型 ${llmCfg.model}）`)
  console.log('按 Ctrl+C 停止')
  exec(`open ${url}`, (err) => { if (err) console.log(`请手动打开 ${url}`) })
})
