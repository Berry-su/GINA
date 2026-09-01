// src/i18n/translate.js — 实时翻译引擎抽象（ADR-008 · PLAN-P6 §Phase 1）
//
// 接入点：ASR (sherpa-onnx / Whisper) → translate.js → TTS (5 providers)
//
// 支持语种（首期 6）：zh / en / ja / ko / fr / es
// 暂不硬编码更多语种（避免未来 NLLB 集成时的字符串拼写问题）
//
// Provider 路由：
//   1. DeepL API（默认，质量最高，~$30/月 Pro 1M 字符）
//   2. Google Translate v2（兜底，DeepL 挂了自动切换，$20/1M 字符）
//   3. 本地 NLLB-200 stub（离线备选，CPU ~5s/句，仅 fallback fallback）
//
// 关键约束（C-4.3 红线）：
//   - emotion-isolation: 翻译只输出文字，不触发 joy 情绪
//   - 不 import joy-state
//   - 不进 LLM decision 路径
//   - 翻译记忆 LRU 1000 条（demo 句"你好"重复不重算）
//   - 流式 chunk（句子级拆分，partial emit）
//   - 失败 fallback（DeepL 抛 → Google → NLLB stub → 返回原文）

import '../network-proxy.js'

// ── Provider 配置 ─────────────────────────────────────────────────────────
export const TRANSLATE_PROVIDERS = [
  { id: 'deepl',  label: 'DeepL API',         default: true,  requiresKey: 'deeplKey'      },
  { id: 'google', label: 'Google Translate v2', default: false, requiresKey: 'googleKey'    },
  { id: 'local',  label: '本地 NLLB-200 (离线)', default: false, requiresKey: null          },
]

// 6 语种首期（zh / en / ja / ko / fr / es）—— 不硬编码更多
export const SUPPORTED_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'fr', 'es']

export const LANGUAGE_LABELS = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  es: 'Español',
}

// DeepL 语种代码 ≠ ISO 639-1（DEEPL 用 ZH / JA / KO 等大写）
const DEEPL_LANG_MAP = {
  zh: 'ZH', en: 'EN', ja: 'JA', ko: 'KO', fr: 'FR', es: 'ES',
}
const GOOGLE_LANG_MAP = {
  zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', es: 'es',
}

// ── 翻译记忆 LRU 1000 ─────────────────────────────────────────────────────
const MEMORY_MAX = 1000
const memory = new Map()  // Map 保持插入顺序，LRU 用 delete + set 重新插入
let memoryHits = 0
let memoryMisses = 0

function memoryKey(text, from, to, provider) {
  return `${provider}::${from}->${to}::${text}`
}

function memoryGet(key) {
  if (!memory.has(key)) {
    memoryMisses++
    return null
  }
  const val = memory.get(key)
  // LRU bump: 删了重新插，挪到队尾
  memory.delete(key)
  memory.set(key, val)
  memoryHits++
  return val
}

function memorySet(key, val) {
  if (memory.has(key)) memory.delete(key)
  memory.set(key, val)
  // 超 LRU 上限，删队头（最久未用）
  while (memory.size > MEMORY_MAX) {
    const firstKey = memory.keys().next().value
    memory.delete(firstKey)
  }
}

export function clearMemory() {
  memory.clear()
  memoryHits = 0
  memoryMisses = 0
}

export function getMemoryStats() {
  const total = memoryHits + memoryMisses
  return {
    size: memory.size,
    max: MEMORY_MAX,
    hits: memoryHits,
    misses: memoryMisses,
    hitRate: total === 0 ? 0 : (memoryHits / total).toFixed(3),
  }
}

// ── Provider 预检 ─────────────────────────────────────────────────────────
// 跟 TTS validateTTSConfig 对齐：合成前预检，返回 {ok, missing?, guide}
export function validateTranslateConfig(creds = {}) {
  const provider = creds.provider || 'deepl'
  const req = TRANSLATE_PROVIDERS.find(p => p.id === provider)
  if (!req) {
    return {
      ok: false,
      provider,
      guide: `还没选择有效的翻译服务商（当前：${provider || '空'}）。请在「设置 → 翻译」里选择 DeepL / Google / 本地。`,
    }
  }
  if (req.requiresKey && !String(creds[req.requiresKey] || '').trim()) {
    return {
      ok: false,
      provider,
      missing: [req.requiresKey],
      guide: `${req.label} 还没配置 API Key。请在「设置 → 翻译」里填写 ${req.requiresKey}。`,
    }
  }
  return { ok: true, provider }
}

// ── 句子级 chunk 切分（流式用） ───────────────────────────────────────────
// 按句号 / 问号 / 感叹号 / 换行切分；保留分隔符；返回 chunk 数组
export function splitSentences(text) {
  if (!text) return []
  const chunks = []
  let buf = ''
  const seps = /([.!?。！？\n]+)/g
  let m
  let last = 0
  while ((m = seps.exec(text)) !== null) {
    buf += text.slice(last, m.index + m[0].length)
    if (buf.trim()) chunks.push(buf)
    buf = ''
    last = seps.lastIndex
  }
  if (last < text.length) {
    buf += text.slice(last)
    if (buf.trim()) chunks.push(buf)
  }
  return chunks.length ? chunks : [text]
}

// ── DeepL 实现 ────────────────────────────────────────────────────────────
async function _translateWithDeepL(text, from, to, apiKey) {
  if (!apiKey) throw new Error('DeepL API key missing')
  const params = new URLSearchParams()
  params.append('text', text)
  params.append('target_lang', DEEPL_LANG_MAP[to] || to.toUpperCase())
  if (from && from !== 'auto') {
    params.append('source_lang', DEEPL_LANG_MAP[from] || from.toUpperCase())
  }
  // DeepL free tier 用 api-free.deepl.com, Pro 用 api.deepl.com
  // 默认 Pro (api.deepl.com) —— 老板有 key 走 Pro
  const url = 'https://api.deepl.com/v2/translate'
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  if (!resp.ok) {
    const err = await resp.text().catch(() => '')
    throw new Error(`DeepL ${resp.status}: ${err.slice(0, 200)}`)
  }
  const data = await resp.json()
  if (!data?.translations?.[0]?.text) {
    throw new Error('DeepL response invalid')
  }
  return data.translations[0].text
}

// ── Google Translate v2 实现 ──────────────────────────────────────────────
async function _translateWithGoogle(text, from, to, apiKey) {
  if (!apiKey) throw new Error('Google API key missing')
  const params = new URLSearchParams({ q: text, target: GOOGLE_LANG_MAP[to] || to, format: 'text' })
  if (from && from !== 'auto') params.append('source', GOOGLE_LANG_MAP[from] || from)
  params.append('key', apiKey)
  const url = `https://translation.googleapis.com/language/translate/v2?${params.toString()}`
  const resp = await fetch(url, { method: 'POST' })
  if (!resp.ok) {
    const err = await resp.text().catch(() => '')
    throw new Error(`Google ${resp.status}: ${err.slice(0, 200)}`)
  }
  const data = await resp.json()
  if (!data?.data?.translations?.[0]?.translatedText) {
    throw new Error('Google response invalid')
  }
  return data.data.translations[0].translatedText
}

// ── 本地 NLLB-200 stub（离线备选，未来接 ONNX） ───────────────────────────
async function _translateWithLocal(text, from, to) {
  // 当前 stub: 返回原文 + 标记离线模式
  // 未来接 @xenova/transformers (NLLB-200-distilled-600M ONNX, ~600MB)
  // 或 self-host python transformers
  // 本次 ADR 阶段只 stub，不实装（避免 600MB 模型 + 启动慢）
  // 失败 fallback 链的最后一环
  if (process.env.GINA_NLLB_FORCE_FAIL === '1') {
    throw new Error('NLLB stub: 强制失败（测试用）')
  }
  return text  // 兜底：返回原文
}

// ── Provider 路由（带 fallback） ──────────────────────────────────────────
// 关键：route 函数从 __test 拿 provider（让测试能 mock 替换）
async function _routeTranslate(text, from, to, provider, creds) {
  // fallback 链：deepl → google → local → 原文
  if (provider === 'deepl' || provider == null) {
    try {
      return { text: await __test._translateWithDeepL(text, from, to, creds.deeplKey), provider: 'deepl' }
    } catch (err) {
      console.warn('[translate] DeepL 失败，fallback Google:', err?.message || err)
    }
  }
  if (provider === 'google' || provider == null) {
    try {
      return { text: await __test._translateWithGoogle(text, from, to, creds.googleKey), provider: 'google' }
    } catch (err) {
      console.warn('[translate] Google 失败，fallback 本地 NLLB:', err?.message || err)
    }
  }
  // 最后兜底：本地 stub
  try {
    return { text: await __test._translateWithLocal(text, from, to), provider: 'local' }
  } catch (err) {
    console.error('[translate] 所有 provider 都失败，返回原文:', err?.message || err)
    return { text, provider: 'fallback-original' }
  }
}

// ── 统一 API：单次翻译 ────────────────────────────────────────────────────
export async function translate(text, { from = 'auto', to = 'en', provider = null, creds = {} } = {}) {
  if (!text || typeof text !== 'string') {
    throw new TypeError('translate(text): text 必须是非空字符串')
  }
  if (!SUPPORTED_LANGUAGES.includes(to)) {
    throw new TypeError(`translate: 不支持的 target 语种 "${to}"（支持：${SUPPORTED_LANGUAGES.join(', ')}）`)
  }
  if (from !== 'auto' && !SUPPORTED_LANGUAGES.includes(from)) {
    throw new TypeError(`translate: 不支持的 source 语种 "${from}"`)
  }

  // 翻译记忆命中
  const key = memoryKey(text, from, to, provider || 'auto')
  const cached = memoryGet(key)
  if (cached) {
    return { ...cached, cached: true }
  }

  // 真翻译
  const result = await _routeTranslate(text, from, to, provider, creds)

  // 写记忆
  memorySet(key, result)

  return { ...result, cached: false }
}

// ── 流式 API：句子级 chunk emit ───────────────────────────────────────────
export async function translateStream(text, opts = {}) {
  const { onChunk = () => {}, from = 'auto', to = 'en', provider = null, creds = {} } = opts
  if (typeof onChunk !== 'function') {
    throw new TypeError('translateStream: onChunk 必须是函数')
  }
  const sentences = splitSentences(text)
  const chunks = []
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    const r = await translate(sentence, { from, to, provider, creds })
    chunks.push({ text: r.text, provider: r.provider, cached: r.cached, index: i, total: sentences.length })
    onChunk({ text: r.text, provider: r.provider, cached: r.cached, index: i, total: sentences.length })
  }
  return chunks
}

// ── 测试钩子 ─────────────────────────────────────────────────────────────
// 暴露内部 provider 供测试 mock 注入（GINA 9-02 老板纠错纪律:测试用 mock，不真打 API）
export const __test = {
  _translateWithDeepL,
  _translateWithGoogle,
  _translateWithLocal,
  memoryGet,
  memorySet,
  MEMORY_MAX,
  splitSentences,
}

export default {
  TRANSLATE_PROVIDERS,
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  translate,
  translateStream,
  splitSentences,
  validateTranslateConfig,
  clearMemory,
  getMemoryStats,
  __test,
}
