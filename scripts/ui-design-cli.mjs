#!/usr/bin/env node
/**
 * scripts/ui-design-cli.mjs — 脱离 Gina 独立运行的 UI 设计生成 CLI
 *
 * 用法：
 *   node scripts/ui-design-cli.mjs --req "做一个股票交易看盘页"
 *   node scripts/ui-design-cli.mjs --req "..." --ref ./参考图.png --vision-model qwen-vl-plus --vision-key sk-xxx
 *   node scripts/ui-design-cli.mjs --req "..." --language '{"styleKeywords":["单色","精密"]}'
 *
 * 输出（默认 ./ui-design-output）：
 *   preview.html          预览
 *   <Name>.tsx            React 组件
 *   <Name>.module.css     CSS Modules
 *
 * 不启动 Gina、不加载后端/DB/意识循环；LLM 走 OpenAI 兼容接口（默认读 llm/deepseek.json）。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSpec, renderSpecToHtml, generateCode } from '../src/ui-design/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PROVIDER_BASE = {
  deepseek: 'https://api.deepseek.com',
  minimax: 'https://api.minimax.chat/v1',
  openai: 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  mimo: 'https://api.xiaomimimo.com/v1',
}

// 无参考图时的默认设计语言（Monochrome Precision HUD 气质）
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
  const a = { out: './ui-design-output', provider: 'deepseek', token: 'monochrome-hud' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const next = argv[i + 1]
    if (k.startsWith('--')) {
      const key = k.slice(2)
      if (next !== undefined && !next.startsWith('--')) {
        a[key] = next
        i++
      } else {
        a[key] = true
      }
    }
  }
  return a
}

function loadLlmConfig(provider) {
  const file = resolve(__dirname, '..', 'llm', `${provider}.json`)
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function dataUrlFromFile(filePath) {
  const buf = readFileSync(filePath)
  const ext = (filePath.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'jpg' ? 'jpeg' : ext
  return `data:image/${mime};base64,${buf.toString('base64')}`
}

async function chatCompletion({ baseURL, apiKey, model, messages, maxTokens = 8192, thinkingDisabled = true }) {
  const body = { model, messages, stream: false, max_tokens: maxTokens }
  if (thinkingDisabled) body.thinking = { type: 'disabled' }
  const url = `${String(baseURL).replace(/\/$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const requirement = String(args.req || '').trim()
  if (!requirement) {
    console.error('用法：node scripts/ui-design-cli.mjs --req "需求描述" [--ref 参考图] [--name 组件名] [--out 输出目录]')
    process.exit(1)
  }

  const provider = args.provider || 'deepseek'
  const baseURL = args['base-url'] || PROVIDER_BASE[provider] || PROVIDER_BASE.deepseek
  const cfg = loadLlmConfig(provider)
  if (!cfg?.apiKey) {
    console.error(`未找到 LLM 配置：llm/${provider}.json（需含 apiKey）`)
    process.exit(1)
  }
  const model = args.model || cfg.model
  const apiKey = cfg.apiKey

  // llmFn：文本生成（生成 Spec）
  const llmFn = (prompt) => chatCompletion({ baseURL, apiKey, model, messages: [{ role: 'user', content: prompt }] })

  // visionFn：可选，参考图提取（需多模态模型；DeepSeek 文本模型不支持图像）
  let visionFn = null
  if (args['vision-model']) {
    const vModel = args['vision-model']
    const vKey = args['vision-key'] || apiKey
    const vBase = args['vision-base-url'] || baseURL
    visionFn = (imagePath, prompt) => chatCompletion({
      baseURL: vBase,
      apiKey: vKey,
      model: vModel,
      thinkingDisabled: false,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrlFromFile(imagePath) } },
        ],
      }],
    })
  }

  // 1) 确定设计语言
  const tokenId = args.token || 'monochrome-hud'
  let language = tokenId === 'hologram-blue' ? HOLOGRAM_LANGUAGE : DEFAULT_LANGUAGE
  if (args.language) {
    try { language = JSON.parse(args.language) } catch {
      console.error('--language 不是合法 JSON，已忽略')
    }
  } else if (args.ref) {
    if (visionFn) {
      console.log(`[1/4] 从参考图提取设计语言：${args.ref}`)
      const { extractDesignLanguage } = await import('../src/ui-design/index.js')
      const extracted = await extractDesignLanguage({ imagePath: args.ref, visionFn })
      if (extracted.ok) language = extracted.language
      else console.warn(`视觉提取失败（改用默认语言）：${extracted.error}`)
    } else {
      console.warn('--ref 需要多模态模型（--vision-model/--vision-key），当前未配置，跳过视觉提取，用默认语言')
    }
  }

  // 2) 生成 Spec
  console.log(`[2/4] 生成 Design Spec（模型 ${model}）…`)
  const generated = await generateSpec({ language, requirement, tokenSet: tokenId, llmFn })
  if (!generated.ok) {
    console.error('生成 Spec 失败：', generated.errors?.join('; '))
    process.exit(1)
  }

  // 3) 渲染预览
  const rendered = renderSpecToHtml(generated.spec)
  if (!rendered.ok) {
    console.error('渲染预览失败：', rendered.errors?.join('; '))
    process.exit(1)
  }

  // 4) 生成代码
  const name = args.name || (generated.spec.name ? generated.spec.name : 'GeneratedPage')
  const code = generateCode(generated.spec, { componentName: name })
  if (!code.ok) {
    console.error('生成代码失败：', code.errors?.join('; '))
    process.exit(1)
  }

  // 写文件
  const outDir = resolve(args.out)
  mkdirSync(outDir, { recursive: true })
  const write = (fileName, content) => {
    const p = resolve(outDir, fileName)
    writeFileSync(p, content, 'utf-8')
    return p
  }
  const written = [write('preview.html', rendered.html)]
  for (const [fileName, content] of Object.entries(code.files)) {
    written.push(write(fileName, content))
  }

  console.log('\n完成。产物：')
  for (const p of written) console.log('  ' + p)
  console.log(`\n预览：用浏览器打开 ${resolve(outDir, 'preview.html')}`)
}

main().catch((err) => {
  console.error('执行失败：', err?.message || err)
  process.exit(1)
})
