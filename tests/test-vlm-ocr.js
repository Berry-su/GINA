// tests/test-vlm-ocr.js — Phase 1 VLM/OCR 5 测试（ADR-009）
//
// 设计原则（同 test-translate.js）：
//   - 测试用 mock provider，不真打 GPT-4V API
//   - 通过 __test._seeWithGPT4V / _seeWithQwenVL / _ocrWithTesseract / _ocrWithCloud 注入
//   - emotion-isolation 9/9 必跑
//   - 用真实 1×1 PNG fixture（53 bytes）测 hash + base64
//
// 5 测试：
//   1. VLM UI 截图理解（mock GPT-4V + 1×1 PNG）
//   2. OCR 中英日韩（mock Tesseract 4 语种）
//   3. OCR 失败重试（Tesseract 抛 → 云 OCR）
//   4. VLM 缓存命中（同图 2 次）
//   5. OCR 多语种（extractTextMultiLang）
//
// 运行：node --test tests/test-vlm-ocr.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  seeImage,
  seeImages,
  validateVLMConfig,
  clearCache as clearVLMCache,
  getCacheStats as getVLMStats,
  __test as vlmTest,
} from '../src/multimodal/vlm.js'
import {
  extractText,
  extractTextMultiLang,
  validateOCRConfig,
  OCR_LANGUAGES,
  clearCache as clearOCRCache,
  getCacheStats as getOCRStats,
  __test as ocrTest,
} from '../src/multimodal/ocr.js'

let passed = 0
let failed = 0
const resultLog = []
function track(name, ok, msg) {
  if (ok) { passed++; console.log(`✓ ${name}`) }
  else    { failed++; resultLog.push(`FAIL ${name}: ${msg}`); console.log(`✗ ${name}: ${msg}`) }
}

// ── fixture: 1×1 红色 PNG（53 bytes，最小有效 PNG） ───────────────────────
const RED_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function makeRedPNG() {
  const dir = mkdtempSync(join(tmpdir(), 'gina-vlm-test-'))
  const fp = join(dir, 'red.png')
  writeFileSync(fp, Buffer.from(RED_PNG_BASE64, 'base64'))
  return fp
}

let mockGPT4V = null
let mockQwen = null
let mockTesseract = null
let mockCloud = null
let gpt4vCalls = 0
let tesseractCalls = 0

function defaultMockGPT4V(imagePath, prompt) {
  gpt4vCalls++
  return Promise.resolve(`[GPT-4V mock] 看到了 1x1 PNG, prompt="${prompt}"`)
}
function defaultMockTesseract(imagePath, language) {
  tesseractCalls++
  // 模拟 Tesseract 对不同语种返回不同 mock 文字
  const mockText = {
    zh: '你好',
    en: 'Hello',
    ja: 'こんにちは',
    ko: '안녕하세요',
    fr: 'Bonjour',
    es: 'Hola',
  }[language] || `text-${language}`
  return Promise.resolve(mockText)
}

function applyMocks() {
  vlmTest._seeWithGPT4V = mockGPT4V || defaultMockGPT4V
  vlmTest._seeWithQwenVL = mockQwen || (() => Promise.resolve('[Qwen mock]'))
  ocrTest._ocrWithTesseract = mockTesseract || defaultMockTesseract
  ocrTest._ocrWithCloud = mockCloud || ((p, l) => Promise.resolve(`[Cloud OCR mock] ${l}`))
}
function resetMocks() {
  mockGPT4V = null; mockQwen = null; mockTesseract = null; mockCloud = null
  gpt4vCalls = 0; tesseractCalls = 0
  clearVLMCache()  // 重要：清缓存避免测试间 cache 命中
  clearOCRCache()
  applyMocks()
}

resetMocks()
clearVLMCache()
clearOCRCache()

// ── 1. VLM UI 截图理解 ───────────────────────────────────────────────────
test('1. VLM UI 截图理解: mock GPT-4V + 1×1 红色 PNG', async () => {
  resetMocks()
  const fp = makeRedPNG()
  const r = await seeImage(fp, '这张图是什么颜色？')
  assert.ok(r.text.includes('GPT-4V') || r.text.includes('看到了'), `text=${r.text.slice(0, 60)}`)
  assert.equal(r.provider, 'gpt4v')
  assert.equal(r.cached, false)
  assert.equal(gpt4vCalls, 1, 'GPT-4V 调 1 次')
  track('1', true)
})

// ── 2. OCR 中英日韩 ──────────────────────────────────────────────────────
test('2. OCR 4 语种: zh/en/ja/ko 都返回非空', async () => {
  resetMocks()
  const fp = makeRedPNG()
  const langs = ['zh', 'en', 'ja', 'ko']
  for (const lang of langs) {
    const r = await extractText(fp, { language: lang })
    assert.ok(r.text.length > 0, `${lang}: text 非空 (${r.text})`)
    assert.equal(r.provider, 'tesseract')
  }
  assert.equal(tesseractCalls, 4, 'Tesseract 调 4 次 (4 语种)')
  track('2', true)
})

// ── 3. OCR 失败重试（Tesseract 抛 → 云 OCR） ─────────────────────────────
test('3. OCR 失败重试: Tesseract 抛错 → fallback 云 OCR', async () => {
  resetMocks()
  const fp = makeRedPNG()
  tesseractCalls = 0
  mockTesseract = () => { tesseractCalls++; throw new Error('mock Tesseract fail') }
  let cloudCalls = 0
  mockCloud = () => { cloudCalls++; return Promise.resolve('[Cloud OCR success]') }
  applyMocks()
  const r = await extractText(fp, { language: 'zh' })
  assert.equal(tesseractCalls, 1, 'Tesseract 调 1 次（失败）')
  assert.equal(cloudCalls, 1, '云 OCR 调 1 次（兜底成功）')
  assert.equal(r.provider, 'cloud')
  assert.ok(r.text.includes('Cloud OCR success'))
  track('3', true)
})

// ── 4. VLM 缓存命中 ─────────────────────────────────────────────────────
test('4. VLM 缓存: 同图 2 次调用，第 2 次 cached=true 且 GPT-4V 0 调用', async () => {
  resetMocks()
  const fp = makeRedPNG()
  clearVLMCache()
  gpt4vCalls = 0
  const r1 = await seeImage(fp, '同 prompt')
  assert.equal(gpt4vCalls, 1, '第 1 次调 GPT-4V 1 次')
  assert.equal(r1.cached, false)
  const r2 = await seeImage(fp, '同 prompt')
  assert.equal(gpt4vCalls, 1, '第 2 次 GPT-4V 0 调用（命中缓存）')
  assert.equal(r2.cached, true)
  assert.equal(r2.text, r1.text)
  // 缓存命中统计
  const stats = getVLMStats()
  assert.ok(stats.hits >= 1, `cache hits >= 1 (实际 ${stats.hits})`)
  track('4', true)
})

// ── 5. OCR 多语种 ────────────────────────────────────────────────────────
test('5. OCR 多语种: extractTextMultiLang 返回数组', async () => {
  resetMocks()
  const fp = makeRedPNG()
  clearOCRCache()
  const results = await extractTextMultiLang(fp, ['zh', 'en', 'ja'])
  assert.equal(results.length, 3)
  assert.equal(results[0].language, 'zh')
  assert.equal(results[0].text, '你好')
  assert.equal(results[1].text, 'Hello')
  assert.equal(results[2].text, 'こんにちは')
  // 不支持语种
  await assert.rejects(
    () => extractTextMultiLang(fp, ['xx']),
    TypeError,
  )
  track('5', true)
})

// ── bonus: 配置预检 + cache 容量 ─────────────────────────────────────────
test('bonus. validateVLMConfig / validateOCRConfig provider 检查', () => {
  const r1 = validateVLMConfig({ provider: 'gpt4v', openaiKey: 'fake' })
  assert.equal(r1.ok, true)
  const r2 = validateVLMConfig({ provider: 'gpt4v' })
  assert.equal(r2.ok, false)
  const r3 = validateOCRConfig({ provider: 'tesseract' })
  assert.equal(r3.ok, true)
  const r4 = validateOCRConfig({ provider: 'cloud' })
  assert.equal(r4.ok, false)
})

test('bonus. OCR_LANGUAGES 6 语种 + VLM CACHE_MAX=100 + OCR CACHE_MAX=50', () => {
  assert.equal(OCR_LANGUAGES.length, 6)
  assert.equal(vlmTest.CACHE_MAX, 100)
  assert.equal(ocrTest.CACHE_MAX, 50)
})

// ── 汇总 ─────────────────────────────────────────────────────────────────
setTimeout(() => {
  console.log(`\n=== test-vlm-ocr: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.log(resultLog.join('\n'))
    process.exit(1)
  }
}, 100)
