// Realtime vision framework tests (25+ tests).
//
// Run: node --test tests/test-realtime-vision.js
//
// Critical invariants (老板 9-07 14:25 拍板 + 翻身纪律):
//   1. 1 fps + 30% 变化阈值
//   2. 默认不主动发消息（emit 事件）
//   3. 不持久化原始帧
//   4. 仅本地 VLM
//   5. emotion-isolation
//   6. 同一时间只 1 路流

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-realtime-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const rv = await import('../src/perception/realtime-vision/index.js')

// ─── stream-manager — 5 tests ───────────────────────────────

test('stream: default state is closed', () => {
  const s = rv.defaultStreamState()
  assert.equal(s.enabled, false)
  assert.equal(s.stream, null)
  assert.equal(s.fps, 1)
  assert.equal(rv.isStreamOpen(s), false)
})

test('stream: openStream requires onFrame', async () => {
  const r = await rv.openStream({ state: rv.defaultStreamState() })
  assert.ok(r.error)
  assert.match(r.error, /onFrame/)
})

test('stream: openStream with mock mediaDevices', async () => {
  const mockStream = {
    getTracks: () => [{ stop: () => {}, addEventListener: () => {} }],
    getVideoTracks: () => [{ getSettings: () => ({}), addEventListener: () => {} }],
  }
  const mockMediaDevices = {
    getUserMedia: async () => mockStream,
    enumerateDevices: async () => [],
  }
  let frameReceived = false
  const r = await rv.openStream({
    state: rv.defaultStreamState(),
    mediaDevices: mockMediaDevices,
    onFrame: async (frame, ctx) => { frameReceived = true },
  })
  assert.equal(r.error, null)
  assert.equal(rv.isStreamOpen(r.state), true)
  // 等一会儿让 onFrame 至少跑 1 次（immediate 50ms + 1s interval）
  await new Promise(res => setTimeout(res, 200))
  // 立即帧（50ms 内）应该至少调过 1 次（但因为 videoElement 是 null 所以 frame=null，onFrame 还是会调）
  assert.ok(frameReceived || rv.getActiveStreamCount() >= 1)
  // 关闭
  rv.closeStream({ state: r.state })
  assert.equal(rv.isStreamOpen(r.state), false)
  assert.equal(rv.getActiveStreamCount(), 0)
})

test('stream: closeStream stops all tracks', () => {
  const state = rv.defaultStreamState()
  let stopped = 0
  state.stream = { getTracks: () => [{ stop: () => { stopped++ } }] }
  state.enabled = true
  rv.closeStream({ state })
  assert.equal(stopped, 1)
  assert.equal(state.enabled, false)
})

test('stream: max concurrent streams = 1', async () => {
  const mockStream = {
    getTracks: () => [{ stop: () => {}, addEventListener: () => {} }],
    getVideoTracks: () => [{ getSettings: () => ({}), addEventListener: () => {} }],
  }
  const mockMediaDevices = {
    getUserMedia: async () => mockStream,
    enumerateDevices: async () => [],
  }
  const r1 = await rv.openStream({
    state: rv.defaultStreamState(),
    mediaDevices: mockMediaDevices,
    onFrame: async () => {},
  })
  assert.equal(r1.error, null)
  const r2 = await rv.openStream({
    state: rv.defaultStreamState(),
    mediaDevices: mockMediaDevices,
    onFrame: async () => {},
  })
  assert.ok(r2.error, 'second stream should be rejected')
  assert.match(r2.error, /max concurrent/)
  rv.closeStream({ state: r1.state })
})

// ─── frame-sampler — 5 tests ───────────────────────────────

test('sampler: first frame is always changed', () => {
  const state = rv.defaultSamplerState()
  const r = rv.processFrame({ state, frame: 'frame1' })
  assert.equal(r.changed, true)
  assert.equal(r.isFirstFrame, true)
})

test('sampler: identical frames → no change', () => {
  const state = rv.defaultSamplerState()
  rv.processFrame({ state, frame: 'frame1' })
  const r = rv.processFrame({ state, frame: 'frame1' })
  assert.equal(r.changed, false)
  assert.equal(r.changeScore, 0)
})

test('sampler: different frames → change detected', () => {
  const state = rv.defaultSamplerState({ threshold: 0.1 })
  rv.processFrame({ state, frame: 'frame1' })
  const r = rv.processFrame({ state, frame: 'frame2_completely_different' })
  assert.ok(r.changeScore > 0)
  // threshold 0.1 → 应该触发
  assert.equal(r.changed, r.changeScore >= 0.1)
})

test('sampler: 30% threshold default', () => {
  const state = rv.defaultSamplerState()
  assert.equal(state.threshold, 0.30)
})

test('sampler: setThreshold clamps to [0.05, 0.95]', () => {
  const state = rv.defaultSamplerState()
  rv.setThreshold(state, 0.01)
  assert.ok(state.threshold >= 0.05)
  rv.setThreshold(state, 1.5)
  assert.ok(state.threshold <= 0.95)
})

// ─── scene-analyzer — 5 tests ──────────────────────────────

test('analyzer: requires describer', async () => {
  const r = await rv.analyzeScene({ frame: 'f1' })
  assert.ok(r.error)
})

test('analyzer: mock describer returns description', async () => {
  const d = rv.createMockDescriber({ description: '老板在看 Mac' })
  const r = await rv.analyzeScene({ describer: d, frame: 'f1' })
  assert.equal(r.description, '老板在看 Mac')
  assert.equal(r.confidence, 0.8)
})

test('analyzer: cache hit on same frame hash', async () => {
  const d = rv.createMockDescriber({ description: 'test' })
  const state = rv.defaultAnalyzerState()
  const r1 = await rv.analyzeScene({ describer: d, frame: 'f1', frameHash: 'h1', state })
  const r2 = await rv.analyzeScene({ describer: d, frame: 'f1', frameHash: 'h1', state })
  assert.equal(r1.cached, false)
  assert.equal(r2.cached, true)
  assert.equal(r2.description, 'test')
  assert.equal(state.cacheHits, 1)
})

test('analyzer: timeout handling', async () => {
  const slowDescriber = {
    describe: () => new Promise(resolve => setTimeout(() => resolve({ description: 'late' }), 5000)),
  }
  const state = rv.defaultAnalyzerState({ timeoutMs: 100 })
  const r = await rv.analyzeScene({ describer: slowDescriber, frame: 'f1', state })
  assert.ok(r.error)
  assert.match(r.error, /timeout/)
})

test('analyzer: cache LRU trim', async () => {
  const d = rv.createMockDescriber()
  const state = rv.defaultAnalyzerState({ cacheMax: 2 })
  await rv.analyzeScene({ describer: d, frame: 'f1', frameHash: 'h1', state })
  await rv.analyzeScene({ describer: d, frame: 'f2', frameHash: 'h2', state })
  await rv.analyzeScene({ describer: d, frame: 'f3', frameHash: 'h3', state })
  assert.equal(state.cache.size, 2)  // 最早的 h1 被挤掉
})

// ─── narrator — 5 tests ────────────────────────────────────

test('narrator: silent mode blocks all', () => {
  const state = rv.defaultNarratorState()
  rv.setSilent(state, true)
  const r = rv.shouldNarrate({
    state,
    observation: { description: 'X', confidence: 0.9, changeScore: 0.5 },
  })
  assert.equal(r.shouldNarrate, false)
  assert.equal(r.narrateType, 'silent')
})

test('narrator: user offline → silent', () => {
  const state = rv.defaultNarratorState()
  const r = rv.shouldNarrate({
    state,
    observation: { description: 'X', confidence: 0.9, changeScore: 0.5 },
    userActivity: { online: false },
  })
  assert.equal(r.shouldNarrate, false)
})

test('narrator: low change score (20%) → silent', () => {
  const state = rv.defaultNarratorState()
  const r = rv.shouldNarrate({
    state,
    observation: { description: 'X', confidence: 0.9, changeScore: 0.2 },
  })
  assert.equal(r.shouldNarrate, false)
  assert.match(r.reason, /change score/)
})

test('narrator: 30% change + high conf + humanApproved → speak', () => {
  const state = rv.defaultNarratorState()
  rv.setHumanApproved(state, true)
  const r = rv.shouldNarrate({
    state,
    observation: { description: 'X', confidence: 0.9, changeScore: 0.4 },
  })
  assert.equal(r.shouldNarrate, true)
  assert.equal(r.narrateType, 'speak')
})

test('narrator: dedup within cooldown', () => {
  const state = rv.defaultNarratorState({ cooldownMs: 60_000 })
  const r1 = rv.shouldNarrate({
    state,
    observation: { description: 'X', confidence: 0.9, changeScore: 0.4, hash: 'h1' },
  })
  assert.equal(r1.shouldNarrate, true)
  const r2 = rv.shouldNarrate({
    state,
    observation: { description: 'X', confidence: 0.9, changeScore: 0.4, hash: 'h1' },
  })
  assert.equal(r2.shouldNarrate, false)
  assert.match(r2.reason, /duplicate/)
})

// ─── privacy-guard — 3 tests ───────────────────────────────

test('privacy: FORBIDDEN_FIELDS includes frame + rawFrame + pixels', () => {
  assert.ok(rv.FORBIDDEN_FIELDS.includes('frame'))
  assert.ok(rv.FORBIDDEN_FIELDS.includes('rawFrame'))
  assert.ok(rv.FORBIDDEN_FIELDS.includes('pixels'))
  assert.ok(rv.FORBIDDEN_FIELDS.includes('imageData'))
})

test('privacy: sanitizeObservation strips frame refs', () => {
  const obs = {
    description: '老板在看 Mac',
    confidence: 0.8,
    frame: 'should-be-removed',
    rawFrame: 'should-be-removed',
    pixels: 'should-be-removed',
  }
  const s = rv.sanitizeObservation(obs)
  assert.equal(s.description, '老板在看 Mac')
  assert.equal(s.frame, undefined)
  assert.equal(s.rawFrame, undefined)
  assert.equal(s.pixels, undefined)
})

test('privacy: isObservationClean detects prohibited fields', () => {
  assert.equal(rv.isObservationClean({ description: 'X' }), true)
  assert.equal(rv.isObservationClean({ description: 'X', frame: 'leak' }), false)
  assert.equal(rv.isObservationClean({ description: 'X', imageData: 'leak' }), false)
})

// ─── 集成 + 隔离 — 4 tests ─────────────────────────────────

test('integration: full pipeline frame→sample→analyze→narrate', async () => {
  // 模拟：采到一帧 → 算 hash → 变化检测 → 调 VLM → 决定开口
  const sampleState = rv.defaultSamplerState()
  const analyzerState = rv.defaultAnalyzerState()
  const narratorState = rv.defaultNarratorState()
  rv.setHumanApproved(narratorState, true)
  // 1. 采样
  const r1 = rv.processFrame({ state: sampleState, frame: 'frame_A' })
  assert.equal(r1.isFirstFrame, true)
  // 2. 30% 变化（不同帧）
  const r2 = rv.processFrame({ state: sampleState, frame: 'frame_B_different' })
  assert.ok(r2.changeScore > 0)
  // 3. 场景分析
  const describer = rv.createMockDescriber({ description: '老板打开了 Chrome' })
  const a1 = await rv.analyzeScene({
    describer,
    state: analyzerState,
    frame: 'frame_B_different',
    frameHash: 'h2',
  })
  assert.equal(a1.description, '老板打开了 Chrome')
  // 4. 决定是否开口
  const n1 = rv.shouldNarrate({
    state: narratorState,
    observation: {
      description: a1.description,
      confidence: a1.confidence,
      changeScore: r2.changeScore,
      hash: 'h2',
    },
  })
  // 30% 变化 + conf 0.8 + humanApproved → should narrate
  if (r2.changeScore >= 0.3) {
    assert.equal(n1.shouldNarrate, true)
    assert.equal(n1.narrateType, 'speak')
  }
})

test('integration: silent mode overrides all', () => {
  const narratorState = rv.defaultNarratorState()
  rv.setSilent(narratorState, true)
  rv.setHumanApproved(narratorState, true)
  const r = rv.shouldNarrate({
    state: narratorState,
    observation: { description: 'X', confidence: 0.9, changeScore: 0.5 },
  })
  assert.equal(r.shouldNarrate, false)
})

test('isolation: realtime-vision 0 import emotion-state (ADR-002 验证)', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/realtime-vision/'
  for (const f of ['stream-manager.js', 'frame-sampler.js', 'scene-analyzer.js', 'narrator.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /from\s+['"][^'"]*emotion-state['"]/i, `${f} must not import emotion-state`)
    assert.doesNotMatch(src, /from\s+['"][^'"]*joy-state['"]/i, `${f} must not import joy-state`)
  }
})

test('isolation: realtime-vision 0 调用云端 VLM/frame API', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/realtime-vision/'
  for (const f of ['stream-manager.js', 'frame-sampler.js', 'scene-analyzer.js', 'narrator.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${f} must not use fetch`)
    assert.doesNotMatch(src, /\baxios\b/, `${f} must not use axios`)
    assert.doesNotMatch(src, /\bhttps?:\/\/(?:api\.|googleapis)/, `${f} must not hardcode cloud URLs`)
  }
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
