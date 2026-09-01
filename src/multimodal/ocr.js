// src/multimodal/ocr.js — OCR 引擎抽象（ADR-009 · PLAN-P6 §Phase 1）
//
// Provider 路由：
//   1. Tesseract.js（本地默认，0 成本，5 语种 + 英文）
//   2. 云 OCR stub（Google Vision / 百度 OCR 备选）
//
// 关键约束（C-4.3 红线）：
//   - emotion-isolation: OCR 输出只进文本流，不触发 joy 情绪
//   - 不 import joy-state
//   - 缓存：content hash → LRU 50
//   - 失败 fallback：Tesseract 抛 → 云 OCR stub
//   - 不动 vision-perceptor.js
//
// 注意：Tesseract.js 当前未装（避免 60MB+ 模型 + 训练数据）
// 本次 ADR 阶段**只写接口 + mock**，跟 VLM 一致策略

import '../network-proxy.js'
import { createHash } from 'crypto'
import { readFileSync, existsSync, statSync } from 'fs'

export const OCR_PROVIDERS = [
  { id: 'tesseract', label: 'Tesseract.js (本地)', default: true,  requiresKey: null  },
  { id: 'cloud',     label: '云 OCR (Google Vision)', default: false, requiresKey: 'googleVisionKey' },
]

// OCR 6 语种（首期）—— 跟翻译对齐
export const OCR_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'fr', 'es']

// Tesseract 语言代码：chi_sim / eng / jpn / kor / fra / spa
const TESSERACT_LANG_MAP = {
  zh: 'chi_sim', en: 'eng', ja: 'jpn', ko: 'kor', fr: 'fra', es: 'spa',
}

const CACHE_MAX = 50
const cache = new Map()
let cacheHits = 0
let cacheMisses = 0

function _hashImage(imagePath) {
  if (!existsSync(imagePath)) throw new Error(`图片不存在: ${imagePath}`)
  const buf = readFileSync(imagePath)
  return createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

function _cacheGet(key) {
  if (!cache.has(key)) { cacheMisses++; return null }
  const v = cache.get(key)
  cache.delete(key); cache.set(key, v)
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
  cache.clear(); cacheHits = 0; cacheMisses = 0
}
export function getCacheStats() {
  const total = cacheHits + cacheMisses
  return {
    size: cache.size, max: CACHE_MAX,
    hits: cacheHits, misses: cacheMisses,
    hitRate: total === 0 ? 0 : (cacheHits / total).toFixed(3),
  }
}

// ── Provider 预检 ─────────────────────────────────────────────────────────
export function validateOCRConfig(creds = {}) {
  const provider = creds.provider || 'tesseract'
  const req = OCR_PROVIDERS.find(p => p.id === provider)
  if (!req) return { ok: false, provider, guide: `OCR provider "${provider}" 未知。` }
  if (req.requiresKey && !String(creds[req.requiresKey] || '').trim()) {
    return { ok: false, provider, missing: [req.requiresKey], guide: `${req.label} 缺 API Key（${req.requiresKey}）` }
  }
  return { ok: true, provider }
}

// ── Tesseract.js 实现（stub，本期不实装 60MB 模型） ────────────────────────
async function _ocrWithTesseract(imagePath, language) {
  if (process.env.GINA_TESSERACT_FORCE_FAIL === '1') {
    throw new Error('Tesseract stub: 强制失败（测试用）')
  }
  if (!existsSync(imagePath)) throw new Error(`OCR: 图片不存在 ${imagePath}`)
  const sz = statSync(imagePath).size
  // stub 返回 - 真实环境会接 tesseract.js worker
  return `[Tesseract stub] language=${language} (${TESSERACT_LANG_MAP[language] || language}), image=${sz} bytes`
}

// ── 云 OCR stub（Google Vision / 百度 OCR 备选） ───────────────────────────
async function _ocrWithCloud(imagePath, language, apiKey) {
  if (!apiKey) throw new Error('Google Vision API key missing')
  if (!existsSync(imagePath)) throw new Error(`Cloud OCR: 图片不存在 ${imagePath}`)
  const sz = statSync(imagePath).size
  // stub - 未来接 Google Vision REST API
  // POST https://vision.googleapis.com/v1/images:annotate?key=API_KEY
  return `[Cloud OCR stub] language=${language}, image=${sz} bytes`
}

// ── Provider 路由 ─────────────────────────────────────────────────────────
// 关键：route 函数从 __test 拿 provider（让测试能 mock 替换）
async function _routeOCR(imagePath, language, provider, creds) {
  if (provider === 'tesseract' || provider == null) {
    try {
      return { text: await __test._ocrWithTesseract(imagePath, language), provider: 'tesseract' }
    } catch (err) {
      console.warn('[ocr] Tesseract 失败，fallback 云 OCR:', err?.message || err)
    }
  }
  if (provider === 'cloud' || provider == null) {
    try {
      return { text: await __test._ocrWithCloud(imagePath, language, creds.googleVisionKey), provider: 'cloud' }
    } catch (err) {
      console.error('[ocr] 云 OCR 失败:', err?.message || err)
      throw err
    }
  }
  throw new Error(`OCR provider "${provider}" 未路由到任何实现`)
}

// ── 统一 API：单语种 OCR ──────────────────────────────────────────────────
export async function extractText(imagePath, { language = 'en', provider = null, creds = {} } = {}) {
  if (!imagePath || typeof imagePath !== 'string') {
    throw new TypeError('extractText: imagePath 必须是非空字符串')
  }
  if (!OCR_LANGUAGES.includes(language)) {
    throw new TypeError(`OCR: 不支持语种 "${language}"（支持：${OCR_LANGUAGES.join(', ')}）`)
  }
  const hash = _hashImage(imagePath)
  const cacheKey = `${provider || 'auto'}::${hash}::${language}`
  const cached = _cacheGet(cacheKey)
  if (cached) return { ...cached, cached: true }

  const result = await _routeOCR(imagePath, language, provider, creds)
  _cacheSet(cacheKey, result)
  return { ...result, cached: false }
}

// ── 多语种 OCR ────────────────────────────────────────────────────────────
export async function extractTextMultiLang(imagePath, languages = OCR_LANGUAGES, opts = {}) {
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new TypeError('extractTextMultiLang: languages 必须是非空数组')
  }
  const out = []
  for (const lang of languages) {
    const r = await extractText(imagePath, { ...opts, language: lang })
    out.push({ language: lang, ...r })
  }
  return out
}

// ── 测试钩子 ─────────────────────────────────────────────────────────────
export const __test = {
  _ocrWithTesseract,
  _ocrWithCloud,
  _hashImage,
  _cacheGet,
  _cacheSet,
  CACHE_MAX,
  TESSERACT_LANG_MAP,
}

export default {
  OCR_PROVIDERS,
  OCR_LANGUAGES,
  extractText,
  extractTextMultiLang,
  validateOCRConfig,
  clearCache,
  getCacheStats,
  __test,
}
