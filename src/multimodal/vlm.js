// src/multimodal/vlm.js — VLM（视觉语言模型）抽象（ADR-009 · PLAN-P6 §Phase 1）
//
// Provider 路由：
//   1. GPT-4o-vision（云端默认，质量最高，$0.01/图）
//   2. Qwen-VL 本地 stub（CPU ~10s/图，仅离线备选）
//
// 关键约束（C-4.3 红线）：
//   - emotion-isolation: VLM 输出只进文本流，不触发 joy 情绪
//   - 不 import joy-state
//   - 缓存：content hash → LRU 100（同图重复 0 API call）
//   - 失败 fallback：GPT-4V 抛 → Qwen-VL stub
//   - 不动 vision-perceptor.js（文件系统级视觉独立）

import '../network-proxy.js'
import { createHash } from 'crypto'
import { readFileSync, existsSync, statSync } from 'fs'
import { extname } from 'path'

// ── Provider 配置 ─────────────────────────────────────────────────────────
export const VLM_PROVIDERS = [
  { id: 'gpt4v',  label: 'GPT-4o-vision (云端)', default: true,  requiresKey: 'openaiKey'  },
  { id: 'qwen',   label: 'Qwen-VL 本地 (离线)',   default: false, requiresKey: null         },
]

export const VLM_DEFAULT_MODEL = 'gpt-4o-vision'
export const VLM_DEFAULT_PROMPT = '这张图是什么？'

const CACHE_MAX = 100
const cache = new Map()  // LRU
let cacheHits = 0
let cacheMisses = 0

// ── MIME 推断 ─────────────────────────────────────────────────────────────
const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}
function inferMime(filePath) {
  return MIME_MAP[extname(filePath).toLowerCase()] || 'image/png'
}

// ── 图片 → base64 data URL ────────────────────────────────────────────────
function _imageToBase64DataUrl(imagePath) {
  if (!existsSync(imagePath)) throw new Error(`图片不存在: ${imagePath}`)
  const st = statSync(imagePath)
  if (st.size > 20 * 1024 * 1024) {
    throw new Error(`图片过大（${(st.size / 1024 / 1024).toFixed(1)}MB > 20MB）`)
  }
  const buf = readFileSync(imagePath)
  return `data:${inferMime(imagePath)};base64,${buf.toString('base64')}`
}

// ── 图片内容 hash（缓存 key） ─────────────────────────────────────────────
function _hashImage(imagePath) {
  if (!existsSync(imagePath)) throw new Error(`图片不存在: ${imagePath}`)
  const buf = readFileSync(imagePath)
  return createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

function _cacheGet(key) {
  if (!cache.has(key)) {
    cacheMisses++
    return null
  }
  const v = cache.get(key)
  cache.delete(key)
  cache.set(key, v)
  cacheHits++
  return v
}
function _cacheSet(key, val) {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, val)
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value
    cache.delete(first)
  }
}
export function clearCache() {
  cache.clear()
  cacheHits = 0
  cacheMisses = 0
}
export function getCacheStats() {
  const total = cacheHits + cacheMisses
  return {
    size: cache.size,
    max: CACHE_MAX,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total === 0 ? 0 : (cacheHits / total).toFixed(3),
  }
}

// ── Provider 预检 ─────────────────────────────────────────────────────────
export function validateVLMConfig(creds = {}) {
  const provider = creds.provider || 'gpt4v'
  const req = VLM_PROVIDERS.find(p => p.id === provider)
  if (!req) {
    return { ok: false, provider, guide: `VLM provider "${provider}" 未知。` }
  }
  if (req.requiresKey && !String(creds[req.requiresKey] || '').trim()) {
    return { ok: false, provider, missing: [req.requiresKey], guide: `${req.label} 缺 API Key（${req.requiresKey}）` }
  }
  return { ok: true, provider }
}

// ── GPT-4o-vision 实现 ────────────────────────────────────────────────────
async function _seeWithGPT4V(imagePath, prompt, apiKey, model) {
  if (!apiKey) throw new Error('OpenAI API key missing')
  const dataUrl = _imageToBase64DataUrl(imagePath)
  const body = {
    model: model || VLM_DEFAULT_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt || VLM_DEFAULT_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
    max_tokens: 1024,
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const err = await resp.text().catch(() => '')
    throw new Error(`GPT-4V ${resp.status}: ${err.slice(0, 200)}`)
  }
  const data = await resp.json()
  if (!data?.choices?.[0]?.message?.content) throw new Error('GPT-4V response invalid')
  return data.choices[0].message.content
}

// ── Qwen-VL 本地 stub ─────────────────────────────────────────────────────
async function _seeWithQwenVL(imagePath, prompt) {
  // 当前 stub: 返回 "Qwen-VL 本地推理 [stub]: 看到了 XxX bytes"
  // 未来接 dashscope inference endpoint 或本地 ONNX
  if (process.env.GINA_QWEN_FORCE_FAIL === '1') {
    throw new Error('Qwen-VL stub: 强制失败（测试用）')
  }
  if (!existsSync(imagePath)) throw new Error(`Qwen-VL: 图片不存在 ${imagePath}`)
  const sz = statSync(imagePath).size
  return `[Qwen-VL 本地 stub] 看到了 ${sz} bytes 图像，prompt="${prompt}"`
}

// ── Provider 路由（带 fallback） ──────────────────────────────────────────
// 关键：route 函数从 __test 拿 provider（让测试能 mock 替换）
async function _routeSee(imagePath, prompt, provider, creds) {
  if (provider === 'gpt4v' || provider == null) {
    try {
      return { text: await __test._seeWithGPT4V(imagePath, prompt, creds.openaiKey, creds.vlmModel), provider: 'gpt4v' }
    } catch (err) {
      console.warn('[vlm] GPT-4V 失败，fallback Qwen-VL:', err?.message || err)
    }
  }
  if (provider === 'qwen' || provider == null) {
    try {
      return { text: await __test._seeWithQwenVL(imagePath, prompt), provider: 'qwen' }
    } catch (err) {
      console.error('[vlm] Qwen-VL 失败:', err?.message || err)
      throw err  // VLM 全失败：抛错（不像翻译可以返回原文）
    }
  }
  throw new Error(`VLM provider "${provider}" 未路由到任何实现`)
}

// ── 统一 API：看图 ────────────────────────────────────────────────────────
export async function seeImage(imagePath, prompt = VLM_DEFAULT_PROMPT, { provider = null, creds = {} } = {}) {
  if (!imagePath || typeof imagePath !== 'string') {
    throw new TypeError('seeImage: imagePath 必须是非空字符串')
  }
  // 缓存 key = hash + prompt + provider
  const hash = _hashImage(imagePath)
  const cacheKey = `${provider || 'auto'}::${hash}::${prompt}`
  const cached = _cacheGet(cacheKey)
  if (cached) return { ...cached, cached: true }

  const result = await _routeSee(imagePath, prompt, provider, creds)
  _cacheSet(cacheKey, result)
  return { ...result, cached: false }
}

// ── 多图版本 ──────────────────────────────────────────────────────────────
export async function seeImages(imagePaths, prompt = VLM_DEFAULT_PROMPT, opts = {}) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new TypeError('seeImages: imagePaths 必须是非空数组')
  }
  const out = []
  for (let i = 0; i < imagePaths.length; i++) {
    const p = imagePaths[i]
    const r = await seeImage(p, prompt, opts)
    out.push({ imagePath: p, ...r, index: i })
  }
  return out
}

// ── 测试钩子 ─────────────────────────────────────────────────────────────
export const __test = {
  _seeWithGPT4V,
  _seeWithQwenVL,
  _hashImage,
  _imageToBase64DataUrl,
  _cacheGet,
  _cacheSet,
  CACHE_MAX,
}

export default {
  VLM_PROVIDERS,
  VLM_DEFAULT_MODEL,
  VLM_DEFAULT_PROMPT,
  seeImage,
  seeImages,
  validateVLMConfig,
  clearCache,
  getCacheStats,
  __test,
}
