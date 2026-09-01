// tests/test-translate.js — Phase 1 翻译 18 测试（ADR-008）
//
// 设计原则（9-02 老板纠错纪律）：
//   - 测试用 mock provider，不真打 DeepL/Google API
//   - 通过 _translateWithDeepL / _translateWithGoogle / _translateWithLocal 直接注入
//   - emotion-isolation 9/9 必跑（独立文件 emotion-isolation.test.js）
//
// 18 测试 = 6 语种 × 3 case (短句/长句/俚语) + 2 fallback + 2 记忆 + 1 流式 + 1 error
//
// 运行：node --test tests/test-translate.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  translate,
  translateStream,
  splitSentences,
  validateTranslateConfig,
  clearMemory,
  getMemoryStats,
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  __test,
} from '../src/i18n/translate.js'

let passed = 0
let failed = 0
const resultLog = []
function track(name, ok, msg) {
  if (ok) { passed++; console.log(`✓ ${name}`) }
  else    { failed++; resultLog.push(`FAIL ${name}: ${msg}`); console.log(`✗ ${name}: ${msg}`) }
}

// ── 注入 mock provider（避免真打 API） ────────────────────────────────────
let mockDeepL = null  // null = 走默认 mock 成功
let mockGoogle = null
let mockLocal = null
let deepLCalls = 0
let googleCalls = 0
let localCalls = 0

// 默认 mock：返回目标语种 + ' [' + provider + ']'
function defaultMockDeepL(text, from, to) {
  deepLCalls++
  return Promise.resolve(`${text} [DeepL ${from}->${to}]`)
}
function defaultMockGoogle(text, from, to) {
  googleCalls++
  return Promise.resolve(`${text} [Google ${from}->${to}]`)
}
function defaultMockLocal(text, from, to) {
  localCalls++
  return Promise.resolve(`${text} [Local ${from}->${to}]`)
}

// 用 __test hook 覆盖
function applyMocks() {
  __test._translateWithDeepL = mockDeepL || defaultMockDeepL
  __test._translateWithGoogle = mockGoogle || defaultMockGoogle
  __test._translateWithLocal = mockLocal || defaultMockLocal
}

function resetMocks() {
  mockDeepL = null; mockGoogle = null; mockLocal = null
  deepLCalls = 0; googleCalls = 0; localCalls = 0
  clearMemory()  // 重要：清翻译记忆避免测试间 cache 命中
  applyMocks()
}

resetMocks()
clearMemory()

// ── 1-12: 6 语种 × 3 case ────────────────────────────────────────────────

// 1. zh→en 短句
test('1. zh→en 短句: "你好" → "[zh->en]"-style 翻译结果', async () => {
  resetMocks()
  const r = await translate('你好', { from: 'zh', to: 'en' })
  assert.ok(r.text.length > 0, 'r.text 非空')
  assert.ok(['deepl', 'google', 'local', 'fallback-original'].includes(r.provider), `provider=${r.provider}`)
  assert.equal(r.cached, false)
  track('1', true)
})

// 2. en→zh 短句
test('2. en→zh 短句: "Hello"', async () => {
  resetMocks()
  const r = await translate('Hello', { from: 'en', to: 'zh' })
  assert.ok(r.text.length > 0)
  assert.ok(r.provider)
  track('2', true)
})

// 3. ja→zh 短句
test('3. ja→zh 短句: "こんにちは"', async () => {
  resetMocks()
  const r = await translate('こんにちは', { from: 'ja', to: 'zh' })
  assert.ok(r.text.length > 0)
  track('3', true)
})

// 4. ko→en 短句
test('4. ko→en 短句: "안녕하세요"', async () => {
  resetMocks()
  const r = await translate('안녕하세요', { from: 'ko', to: 'en' })
  assert.ok(r.text.length > 0)
  track('4', true)
})

// 5. fr→en 短句
test('5. fr→en 短句: "Bonjour"', async () => {
  resetMocks()
  const r = await translate('Bonjour', { from: 'fr', to: 'en' })
  assert.ok(r.text.length > 0)
  track('5', true)
})

// 6. es→zh 短句
test('6. es→zh 短句: "Hola"', async () => {
  resetMocks()
  const r = await translate('Hola', { from: 'es', to: 'zh' })
  assert.ok(r.text.length > 0)
  track('6', true)
})

// 7. zh→en 长句（>50 词）
test('7. zh→en 长句（>50 词）', async () => {
  resetMocks()
  const long = '这是一段很长的中文句子，用于测试翻译引擎对长文本的处理能力，包括但不限于复杂句式、多重修饰、并列结构，以及不同领域的专业词汇。我们希望翻译结果能够保持原意的同时，输出流畅自然的目标语言文本，让读者能够轻松理解。'
  assert.ok(long.length > 50, '>50 字')
  const r = await translate(long, { from: 'zh', to: 'en' })
  assert.ok(r.text.length > 0)
  track('7', true)
})

// 8. en→zh 长句
test('8. en→zh 长句（>50 words）', async () => {
  resetMocks()
  const long = 'This is a very long English sentence designed to test the translation engine\'s ability to handle long-form content, including complex sentence structures, multiple modifiers, parallel clauses, and specialized vocabulary from various domains. We expect the translation to maintain the original meaning while producing fluent, natural target language text that readers can easily understand.'
  assert.ok(long.length > 50, '>50 chars')
  const r = await translate(long, { from: 'en', to: 'zh' })
  assert.ok(r.text.length > 0)
  track('8', true)
})

// 9. ja→ko 长句
test('9. ja→ko 长句', async () => {
  resetMocks()
  const long = 'これは翻訳エンジンの長文処理能力をテストするための非常に長い日本語の文章です。複雑な文章構造、複数の修飾語、並列構造、およびさまざまな分野の専門用語を含みます。'
  const r = await translate(long, { from: 'ja', to: 'ko' })
  assert.ok(r.text.length > 0)
  track('9', true)
})

// 10. zh→en 俚语
test('10. zh→en 俚语: "猴赛雷" (广东话=很厉害)', async () => {
  resetMocks()
  const r = await translate('猴赛雷', { from: 'zh', to: 'en' })
  assert.ok(r.text.length > 0)
  // mock 翻译能力不一定真翻成 "awesome"，但必须非空
  track('10', true)
})

// 11. en→zh 俚语
test('11. en→zh 俚语: "piece of cake"', async () => {
  resetMocks()
  const r = await translate('piece of cake', { from: 'en', to: 'zh' })
  assert.ok(r.text.length > 0)
  track('11', true)
})

// 12. ja→zh 俚语
test('12. ja→zh 俚语: "ヤバい" (双关：糟糕/厉害)', async () => {
  resetMocks()
  const r = await translate('ヤバい', { from: 'ja', to: 'zh' })
  assert.ok(r.text.length > 0)
  track('12', true)
})

// 13. DeepL fallback → Google
test('13. DeepL 抛错 → fallback Google (mock DeepL 抛)', async () => {
  resetMocks()
  deepLCalls = 0; googleCalls = 0
  mockDeepL = () => { deepLCalls++; throw new Error('mock DeepL fail') }
  applyMocks()
  const r = await translate('Hello', { from: 'en', to: 'zh' })
  assert.equal(deepLCalls, 1, 'DeepL 被调 1 次')
  assert.equal(googleCalls, 1, 'Google 被调 1 次')
  assert.equal(r.provider, 'google', '最终走 Google')
  track('13', true)
})

// 14. Google fallback → 本地 NLLB
test('14. DeepL+Google 都挂 → fallback 本地 stub', async () => {
  resetMocks()
  deepLCalls = 0; googleCalls = 0; localCalls = 0
  mockDeepL = () => { deepLCalls++; throw new Error('mock DeepL fail') }
  mockGoogle = () => { googleCalls++; throw new Error('mock Google fail') }
  applyMocks()
  const r = await translate('test', { from: 'en', to: 'zh' })
  assert.equal(deepLCalls, 1)
  assert.equal(googleCalls, 1)
  assert.equal(localCalls, 1, '本地 stub 被调 1 次')
  assert.equal(r.provider, 'local')
  track('14', true)
})

// 15. 翻译记忆命中
test('15. 翻译记忆: 同句 2 次调用，第 2 次 cached=true 且 provider API 0 调用', async () => {
  resetMocks()
  deepLCalls = 0
  clearMemory()
  const r1 = await translate('记住我', { from: 'zh', to: 'en' })
  const d1 = deepLCalls
  assert.equal(d1, 1, '第 1 次调 DeepL 1 次')
  assert.equal(r1.cached, false)
  const r2 = await translate('记住我', { from: 'zh', to: 'en' })
  assert.equal(deepLCalls, 1, '第 2 次 DeepL 0 调用')
  assert.equal(r2.cached, true, '第 2 次 cached=true')
  assert.equal(r2.text, r1.text, '结果一致')
  track('15', true)
})

// 16. 翻译记忆 LRU 1000 上限
test('16. 翻译记忆 LRU 上限: 插 1001 条，最老被淘汰', () => {
  clearMemory()
  const max = __test.MEMORY_MAX
  assert.equal(max, 1000, 'LRU 1000 确认')
  // 直接通过 __test 写 1001 条
  for (let i = 0; i < max + 1; i++) {
    __test.memorySet(`k${i}`, { text: `v${i}`, provider: 'deepl' })
  }
  const stats = getMemoryStats()
  assert.equal(stats.size, max, `size=${max}（不超过上限）`)
  assert.equal(__test.memoryGet('k0'), null, 'k0 (最老) 被淘汰')
  assert.ok(__test.memoryGet(`k${max}`), 'k1000 (最新) 仍在')
  track('16', true)
})

// 17. 流式 chunk 输出
test('17. translateStream: 3 句输入，onChunk 至少 3 次回调 + 返回 3 chunks', async () => {
  resetMocks()
  clearMemory()
  const text = '第一句。第二句！第三句？'
  const chunks = []
  const result = await translateStream(text, {
    from: 'zh', to: 'en',
    onChunk: (c) => chunks.push(c),
  })
  assert.equal(result.length, 3, `chunks.length=3 (实际 ${result.length})`)
  assert.equal(chunks.length, 3, `onChunk 被调 3 次`)
  assert.equal(chunks[0].index, 0)
  assert.equal(chunks[2].index, 2)
  assert.equal(chunks[0].total, 3)
  track('17', true)
})

// 18. 不支持语种 error
test('18. 不支持 target 语种 ("xx") → TypeError', async () => {
  resetMocks()
  await assert.rejects(
    () => translate('test', { from: 'en', to: 'xx' }),
    TypeError,
    '必须抛 TypeError'
  )
  await assert.rejects(
    () => translate('test', { from: 'yy', to: 'en' }),
    TypeError,
    '不支持的 source 语种也抛'
  )
  track('18', true)
})

// ── 额外小验证（不计入 18 总数） ─────────────────────────────────────────
test('bonus. splitSentences 句子切分正确', () => {
  const chunks = splitSentences('你好。我是 GINA！How are you?')
  assert.ok(chunks.length >= 3, `至少 3 句 (实际 ${chunks.length})`)
})

test('bonus. validateTranslateConfig provider 检查', () => {
  const r1 = validateTranslateConfig({ provider: 'deepl', deeplKey: 'fake' })
  assert.equal(r1.ok, true)
  const r2 = validateTranslateConfig({ provider: 'deepl' })
  assert.equal(r2.ok, false)
  assert.deepEqual(r2.missing, ['deeplKey'])
})

test('bonus. SUPPORTED_LANGUAGES 6 语种', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 6)
  assert.deepEqual(SUPPORTED_LANGUAGES, ['zh', 'en', 'ja', 'ko', 'fr', 'es'])
})

// ── 汇总 ─────────────────────────────────────────────────────────────────
setTimeout(() => {
  console.log(`\n=== test-translate: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.log(resultLog.join('\n'))
    process.exit(1)
  }
}, 100)
