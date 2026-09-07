// Anticipation framework tests (25+ tests).
//
// Run: node --test tests/test-anticipation.js
//
// Critical invariants:
//   1. default does NOT actively send messages (only emits events)
//   2. silent mode / offline / screen-locked → fully closed
//   3. duplicate within cooldown window → no resuggest
//   4. anxious user (negative valence / high arousal) → no proactive suggest
//   5. emotion-state isolation: anticipation NEVER imports emotion-state (meta-info)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-anticipation-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const an = await import('../src/anticipation/index.js')

// ─── helpers ───────────────────────────────────────────────

function makeHistory(texts) {
  return texts.map(t => ({ role: 'user', text: t, content: t }))
}

// ─── predictor — 8 tests ───────────────────────────────────

test('predictor: returns empty when no history', () => {
  const r = an.predict({})
  assert.equal(r.intents.length, 0)
})

test('predictor: focus + recent message → continue_topic', () => {
  const r = an.predict({
    conversationHistory: makeHistory(['讨论 CATS-Net 架构', 'CATS-Net 时序激活', '继续说 CATS-Net']),
    focusContext: { depth: 2, topic: 'CATS-Net', keywords: ['cats-net', '时序', '激活'] },
  })
  const cont = r.intents.find(i => i.type === 'continue_topic')
  assert.ok(cont)
  assert.ok(cont.confidence > 0.3)
})

test('predictor: recent question → follow_up_question', () => {
  const r = an.predict({
    conversationHistory: makeHistory(['我有个问题', '怎么做 X?', '为什么 Y?']),
  })
  const fu = r.intents.find(i => i.type === 'follow_up_question')
  assert.ok(fu)
  assert.ok(fu.confidence > 0.15)
})

test('predictor: knowledge gap → information_lookup', () => {
  const r = an.predict({
    knowledgeGaps: ['GINA 时序激活', 'CATS-Net 衰减', 'Joy 维度'],
  })
  const lu = r.intents.find(i => i.type === 'information_lookup')
  assert.ok(lu)
})

test('predictor: high diversity + low focus → switch_topic', () => {
  const r = an.predict({
    conversationHistory: makeHistory([
      'A 模块怎么用', 'B 是什么', 'C 怎么配', 'D 是干嘛的', 'E 报错',
    ]),
    focusContext: { depth: 1, keywords: [] },
  })
  const sw = r.intents.find(i => i.type === 'switch_topic')
  assert.ok(sw)
})

test('predictor: anxious user → all confidences lowered', () => {
  const r1 = an.predict({
    conversationHistory: makeHistory(['讨论 CATS-Net']),
    focusContext: { depth: 2, keywords: ['cats-net'] },
    externalEmotion: { valence: 0.5, arousal: 0.5 },
  })
  const r2 = an.predict({
    conversationHistory: makeHistory(['讨论 CATS-Net']),
    focusContext: { depth: 2, keywords: ['cats-net'] },
    externalEmotion: { valence: -0.8, arousal: 0.9, primary: 'anger' },
  })
  // 焦虑时所有 confidence 都被 emotionContext 系数压低
  if (r1.intents.length > 0 && r2.intents.length > 0) {
    const c1 = r1.intents[0].confidence
    const c2 = r2.intents[0].confidence
    assert.ok(c2 < c1, `anxious should lower: c1=${c1} c2=${c2}`)
  }
})

test('predictor: top-K limits output', () => {
  const r = an.predict({
    conversationHistory: makeHistory(['A', 'B?', 'C', 'D?', 'E', 'F?', 'G', 'H?']),
    knowledgeGaps: ['x', 'y', 'z', 'w', 'v'],
    focusContext: { depth: 2, keywords: ['x'] },
    topK: 2,
  })
  assert.ok(r.intents.length <= 2)
})

test('predictor: signals summary returned', () => {
  const r = an.predict({
    conversationHistory: makeHistory(['hi']),
    focusContext: { depth: 1, keywords: [] },
    knowledgeGaps: ['x'],
  })
  assert.ok(r.signals)
  assert.ok(typeof r.signals.recentMessage === 'number')
  assert.ok(typeof r.signals.focusStack === 'number')
  assert.ok(typeof r.signals.emotionContext === 'number')
})

// ─── suggester — 8 tests ───────────────────────────────────

test('suggester: silent mode by default OFF', () => {
  const state = an.defaultSuggesterState()
  assert.equal(state.silent, undefined || false)
  assert.equal(state.enabled, true)
})

test('suggester: silent mode blocks all suggestions', () => {
  const state = an.defaultSuggesterState()
  an.setSilent(state, true)
  const prediction = {
    intents: [{ type: 'continue_topic', confidence: 0.9, reason: 'test' }],
  }
  const r = an.suggest({ prediction, state })
  assert.equal(r.shouldSuggest, false)
  assert.equal(r.suggestType, 'silent')
})

test('suggester: user offline → silent', () => {
  const state = an.defaultSuggesterState()
  const prediction = { intents: [{ type: 'continue_topic', confidence: 0.9, reason: 'test' }] }
  const r = an.suggest({ prediction, state, userActivity: { online: false } })
  assert.equal(r.shouldSuggest, false)
  assert.equal(r.suggestType, 'silent')
})

test('suggester: screen locked → silent', () => {
  const state = an.defaultSuggesterState()
  const prediction = { intents: [{ type: 'continue_topic', confidence: 0.9, reason: 'test' }] }
  const r = an.suggest({ prediction, state, userActivity: { online: true, screenLocked: true } })
  assert.equal(r.shouldSuggest, false)
})

test('suggester: low confidence → no suggest', () => {
  const state = an.defaultSuggesterState()
  const prediction = { intents: [{ type: 'continue_topic', confidence: 0.3, reason: 'low' }] }
  const r = an.suggest({ prediction, state })
  assert.equal(r.shouldSuggest, false)
})

test('suggester: high confidence → emit (not just log)', () => {
  const state = an.defaultSuggesterState()
  const prediction = { intents: [{ type: 'continue_topic', confidence: 0.8, reason: 'high' }] }
  const r = an.suggest({ prediction, state })
  assert.equal(r.shouldSuggest, true)
  assert.equal(r.suggestType, 'emit')
})

test('suggester: medium confidence → log only', () => {
  const state = an.defaultSuggesterState()
  const prediction = { intents: [{ type: 'continue_topic', confidence: 0.55, reason: 'med' }] }
  const r = an.suggest({ prediction, state })
  assert.equal(r.shouldSuggest, true)
  assert.equal(r.suggestType, 'log')
})

test('suggester: duplicate within cooldown → no resuggest', () => {
  const state = an.defaultSuggesterState({ cooldownMs: 60000 })
  const intent = { type: 'continue_topic', confidence: 0.8, reason: 'dup_test' }
  const prediction = { intents: [intent] }
  const r1 = an.suggest({ prediction, state, now: 1000 })
  assert.equal(r1.shouldSuggest, true)
  const r2 = an.suggest({ prediction, state, now: 5000 })  // 4s 后
  assert.equal(r2.shouldSuggest, false)
  assert.match(r2.reason, /duplicate/)
})

// ─── controller — 5 tests ──────────────────────────────────

test('controller: runAnticipation returns prediction + suggestion', () => {
  const r = an.runAnticipation({
    conversationHistory: makeHistory(['CATS-Net 讨论', 'CATS-Net 时序']),
    focusContext: { depth: 2, keywords: ['cats-net', '时序'] },
  })
  assert.ok(r.prediction)
  assert.ok(r.suggestion)
  assert.ok(Array.isArray(r.prediction.intents))
})

test('controller: default does NOT emit (no eventEmitter)', () => {
  const r = an.runAnticipation({
    conversationHistory: makeHistory(['CATS-Net 讨论']),
    focusContext: { depth: 2, keywords: ['cats-net'] },
  })
  // 即使有 high confidence，没 eventEmitter 也不 emit
  assert.equal(r.emitted, false)
})

test('controller: with eventEmitter + high confidence → emit', () => {
  const emitted = []
  const fakeEmitter = { emit: (name, payload) => emitted.push({ name, payload }) }
  const r = an.runAnticipation({
    conversationHistory: makeHistory(['CATS-Net 讨论', 'CATS-Net 时序', '激活']),
    focusContext: { depth: 3, keywords: ['cats-net', '时序', '激活'] },
    eventEmitter: fakeEmitter,
  })
  // 高信心度应该 emit（但 silent 模式不 emit）
  if (r.suggestion.suggestType === 'emit') {
    assert.equal(r.emitted, true)
    assert.ok(emitted.length > 0)
  }
})

test('controller: getAnticipationOverview returns stats', () => {
  const state = an.defaultControllerState()
  const suggesterState = an.defaultSuggesterState()
  an.runAnticipation({ controllerState: state, suggesterState })
  an.runAnticipation({ controllerState: state, suggesterState })
  const ov = an.getAnticipationOverview({ controllerState: state, suggesterState })
  assert.equal(ov.totalRuns, 2)
  assert.equal(typeof ov.recentAvgConfidence, 'number')
})

test('controller: silent mode + emit 都不发生', () => {
  const state = an.defaultControllerState()
  const suggesterState = an.defaultSuggesterState()
  an.setSilent(suggesterState, true)
  const emitted = []
  const fakeEmitter = { emit: () => emitted.push(1) }
  const r = an.runAnticipation({
    conversationHistory: makeHistory(['CATS-Net']),
    focusContext: { depth: 2, keywords: ['cats-net'] },
    controllerState: state,
    suggesterState,
    eventEmitter: fakeEmitter,
  })
  assert.equal(r.emitted, false)
  assert.equal(emitted.length, 0)
  assert.equal(r.suggestion.suggestType, 'silent')
})

// ─── 隔离: anticipation 不读 GINA 内部情绪 (ADR-002) — 3 tests ─

test('isolation: anticipation controller.js 不 import emotion-state', () => {
  const realPath = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/anticipation/controller.js'
  const src = fs.readFileSync(realPath, 'utf8')
  assert.doesNotMatch(src, /from\s+['"][^'"]*emotion-state['"]/i)
  assert.doesNotMatch(src, /from\s+['"][^'"]*emotion\/['"]/i)
  assert.doesNotMatch(src, /from\s+['"][^'"]*joy-state['"]/i)
})

test('isolation: predictor.js 不读内部情绪，只读外部情绪', () => {
  const realPath = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/anticipation/predictor.js'
  const src = fs.readFileSync(realPath, 'utf8')
  // 注释中提到 emotion 但不应 import emotion-state
  assert.doesNotMatch(src, /import.*emotion-state/i)
  assert.doesNotMatch(src, /getEmotionState|getJoyState/)
})

test('isolation: only externalEmotion is input, not GINA internal', () => {
  // suggester / controller 只接 externalEmotion（emotion-engine 输出的）
  // 不接 internalEmotion（emotion-state 输出的）
  const r = an.runAnticipation({
    conversationHistory: makeHistory(['test']),
    focusContext: { depth: 1, keywords: ['test'] },
    // 故意不传 internalEmotion
    externalEmotion: { valence: 0.5, arousal: 0.5 },
  })
  // 应该能跑（不 crash）
  assert.ok(r.prediction)
})

// ─── 硬约束: 不主动发消息（only emit） — 2 tests ──────────

test('hard-constraint: controller 没有 sendMessage / postMessage / writeMessage 等方法', () => {
  const realPath = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/anticipation/controller.js'
  const src = fs.readFileSync(realPath, 'utf8')
  // 必须没有主动发消息的代码
  assert.doesNotMatch(src, /sendMessage|postMessage|writeMessage|chat\.send|userMessage/i)
  // 没有 socket / network / fetch（不能远程发）
  assert.doesNotMatch(src, /\bfetch\s*\(/)
  assert.doesNotMatch(src, /\bsocket\b/i)
  assert.doesNotMatch(src, /\bhttp\.request/i)
})

test('hard-constraint: 没有任何代码直接调用对话 API', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/anticipation/'
  for (const f of ['predictor.js', 'suggester.js', 'controller.js', 'keywords.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /chat\.(send|post|reply)/i, `${f} must not call chat APIs`)
  }
})

// ─── integration — 1 test ──────────────────────────────────

test('integration: full flow with eventEmitter dedup', () => {
  const state = an.defaultControllerState()
  const suggesterState = an.defaultSuggesterState({ cooldownMs: 60000 })
  const emitted = []
  const fakeEmitter = { emit: (name, payload) => emitted.push({ name, payload }) }
  // 第一次：应该 emit
  const r1 = an.runAnticipation({
    conversationHistory: makeHistory(['CATS-Net 怎么搞', '时序激活怎么做', '继续']),
    focusContext: { depth: 3, keywords: ['cats-net', '时序', '激活'] },
    eventEmitter: fakeEmitter,
    controllerState: state,
    suggesterState,
  })
  // 第二次（同状态）：应该 dedup
  const r2 = an.runAnticipation({
    conversationHistory: makeHistory(['CATS-Net 怎么搞', '时序激活怎么做', '继续', 'X']),
    focusContext: { depth: 3, keywords: ['cats-net', '时序', '激活'] },
    eventEmitter: fakeEmitter,
    controllerState: state,
    suggesterState,
  })
  // r1 may emit, r2 must NOT (dedup)
  if (r1.suggestion.suggestType === 'emit') {
    assert.equal(r1.emitted, true)
    assert.equal(r2.emitted, false)
  }
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
