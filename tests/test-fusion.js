// Multi-modal emotion fusion tests (25+ tests).
//
// Run: node --test tests/test-fusion.js
//
// Strategy: vote + confidence-weighted (老板 9-07 13:31 拍板 a+c 组合)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-fusion-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const f = await import('../src/perception/fusion/index.js')

// ─── helpers ───────────────────────────────────────────────

function makeModality(dominant, confidence = 0.8) {
  return {
    dominant,
    scores: { neutral: 0, happy: 0, sad: 0, angry: 0, surprised: 0, disgusted: 0, fearful: 0, [dominant]: 1 },
    confidence,
  }
}

// ─── textTo7Class — 5 tests ─────────────────────────────────

test('textTo7Class: joy → happy', () => {
  const r = f.textTo7Class({ textScores: { joy: 0.9, fear: 0.1 }, textConfidence: 0.8 })
  assert.equal(r.dominant, 'happy')
})

test('textTo7Class: anger → angry', () => {
  const r = f.textTo7Class({ textScores: { anger: 0.7 }, textConfidence: 0.8 })
  assert.equal(r.dominant, 'angry')
})

test('textTo7Class: trust + affection → neutral + happy', () => {
  const r = f.textTo7Class({ textScores: { trust: 0.5, affection: 0.5 }, textConfidence: 0.8 })
  // trust → neutral, affection → happy
  const top = Object.entries(r.scores).sort((a, b) => b[1] - a[1])[0]
  assert.ok(['happy', 'neutral'].includes(top[0]))
})

test('textTo7Class: empty scores → neutral', () => {
  const r = f.textTo7Class({ textScores: {}, textConfidence: 0.5 })
  assert.equal(r.dominant, 'neutral')
})

test('textTo7Class: confidence clamps to 0-1', () => {
  const r1 = f.textTo7Class({ textScores: { joy: 1 }, textConfidence: 1.5 })
  assert.equal(r1.confidence, 1)
  const r2 = f.textTo7Class({ textScores: { joy: 1 }, textConfidence: -0.5 })
  assert.equal(r2.confidence, 0)
})

// ─── checkAgreement — 4 tests ──────────────────────────────

test('checkAgreement: 3/3 same → all', () => {
  const r = f.checkAgreement({ visual: 'happy', voice: 'happy', text: 'happy' })
  assert.equal(r.agreement, 'all')
  assert.equal(r.dominant, 'happy')
})

test('checkAgreement: 2/3 same → majority', () => {
  const r = f.checkAgreement({ visual: 'happy', voice: 'happy', text: 'sad' })
  assert.equal(r.agreement, 'majority')
  assert.equal(r.dominant, 'happy')
})

test('checkAgreement: all different → split', () => {
  const r = f.checkAgreement({ visual: 'happy', voice: 'sad', text: 'angry' })
  assert.equal(r.agreement, 'split')
})

test('checkAgreement: empty → insufficient', () => {
  const r = f.checkAgreement({ visual: null, voice: null, text: null })
  assert.equal(r.agreement, 'insufficient')
  assert.equal(r.dominant, null)
})

// ─── fuse — 8 tests ─────────────────────────────────────────

test('fuse: 3/3 all happy → high confidence + boost', () => {
  const r = f.fuse({
    visual: makeModality('happy', 0.8),
    voice: makeModality('happy', 0.7),
    textScores: { joy: 0.9 },
    textConfidence: 0.6,
  })
  assert.equal(r.dominant, 'happy')
  assert.equal(r.agreement, 'all')
  // confidence boost 1.15
  assert.ok(r.confidence > 0.7)
  assert.equal(r.ambiguous, false)
})

test('fuse: 2/3 majority happy → boost +5%', () => {
  const r = f.fuse({
    visual: makeModality('happy', 0.7),
    voice: makeModality('happy', 0.7),
    text: { anger: 0.9 },
    textConfidence: 0.7,
  })
  assert.equal(r.dominant, 'happy')
  assert.equal(r.agreement, 'majority')
})

test('fuse: all different → ambiguous, confidence -30%', () => {
  const r = f.fuse({
    visual: makeModality('happy', 0.5),
    voice: makeModality('sad', 0.5),
    text: { anger: 0.7 },
    textConfidence: 0.5,
  })
  assert.equal(r.ambiguous, true)
  assert.equal(r.agreement, 'split')
  // confidence 应该被压低
  assert.ok(r.confidence < 0.5)
})

test('fuse: only one modality (insufficient) → ambiguous', () => {
  const r = f.fuse({
    visual: makeModality('happy', 0.8),
    voice: null,
    text: null,
  })
  assert.equal(r.agreement, 'insufficient')
  assert.equal(r.ambiguous, true)
})

test('fuse: empty input → neutral + insufficient', () => {
  const r = f.fuse({})
  assert.equal(r.dominant, 'neutral')
  assert.equal(r.agreement, 'insufficient')
})

test('fuse: confidence-weighted (higher confidence wins)', () => {
  const r = f.fuse({
    visual: makeModality('happy', 0.9),   // 高 confidence
    voice: makeModality('sad', 0.3),     // 低 confidence
    text: null,
  })
  // happy 的视觉权重更大
  assert.equal(r.dominant, 'happy')
})

test('fuse: modality weights (text 0.6 < visual 1.0)', () => {
  // 仅用文本和视觉做对比
  const r = f.fuse({
    visual: makeModality('happy', 0.6),
    voice: null,
    text: { joy: 0.5, anger: 0.5 },  // 文本不分
    textConfidence: 0.9,            // 文本 confidence 高
    weights: { visual: 1.0, text: 0.6 },
  })
  // 视觉权重更高，倾向视觉的情绪
  assert.equal(r.dominant, 'happy')
})

test('fuse: low confidence modality ignored (< 0.2)', () => {
  const r = f.fuse({
    visual: makeModality('happy', 0.1),  // 低于 MIN_MODALITY_CONFIDENCE
    voice: makeModality('sad', 0.8),
    text: null,
  })
  // happy 被忽略，dominant = sad
  assert.equal(r.dominant, 'sad')
  assert.deepEqual(r.modalitiesUsed, ['voice'])
})

// ─── state (滑动窗口) — 4 tests ────────────────────────────

test('state: addFusion + getStableFusion', () => {
  const state = f.defaultFusionState()
  for (let i = 0; i < 4; i++) {
    f.addFusion({
      state,
      fusion: {
        dominant: 'happy',
        scores: { happy: 0.9, neutral: 0.1, sad: 0, angry: 0, surprised: 0, disgusted: 0, fearful: 0 },
        confidence: 0.8,
        agreement: 'all',
        ambiguous: false,
        timestamp: 1000 + i * 200,
      },
      now: 1000 + i * 200,
    })
  }
  const stable = f.getStableFusion({ state, now: 2000 })
  assert.ok(stable)
  assert.equal(stable.dominant, 'happy')
})

test('state: smooths jitter across fusions', () => {
  const state = f.defaultFusionState()
  f.addFusion({ state, fusion: { dominant: 'happy', scores: { happy: 0.9, neutral: 0.1 }, confidence: 0.8, agreement: 'all', ambiguous: false }, now: 1000 })
  f.addFusion({ state, fusion: { dominant: 'sad', scores: { sad: 0.9, neutral: 0.1 }, confidence: 0.8, agreement: 'all', ambiguous: false }, now: 1200 })
  f.addFusion({ state, fusion: { dominant: 'happy', scores: { happy: 0.9, neutral: 0.1 }, confidence: 0.8, agreement: 'all', ambiguous: false }, now: 1400 })
  f.addFusion({ state, fusion: { dominant: 'happy', scores: { happy: 0.9, neutral: 0.1 }, confidence: 0.8, agreement: 'all', ambiguous: false }, now: 1600 })
  const stable = f.getStableFusion({ state, now: 1800 })
  // 单帧 sad 被平滑掉
  assert.equal(stable.dominant, 'happy')
})

test('state: resetFusion clears all', () => {
  const state = f.defaultFusionState()
  f.addFusion({ state, fusion: { dominant: 'happy', scores: { happy: 1 }, confidence: 0.8, agreement: 'all', ambiguous: false }, now: 1000 })
  f.resetFusion(state)
  assert.equal(state.frames.length, 0)
})

test('state: insufficient frames → null', () => {
  const state = f.defaultFusionState()
  f.addFusion({ state, fusion: { dominant: 'happy', scores: { happy: 1 }, confidence: 0.8, agreement: 'all', ambiguous: false }, now: 1000 })
  // 只 1 帧
  const stable = f.getStableFusion({ state, now: 1100 })
  assert.equal(stable, null)
})

// ─── privacy-guard — 4 tests ────────────────────────────────

test('privacy: sanitizeModality strips extra fields', () => {
  const m = {
    dominant: 'happy',
    scores: { happy: 0.9, neutral: 0.1 },
    confidence: 0.8,
    landmarks: [[0, 0]],  // 必须删
    rawAudio: new Float32Array(100),  // 必须删
  }
  const s = f.sanitizeModality(m)
  assert.equal(s.dominant, 'happy')
  assert.equal(s.landmarks, undefined)
  assert.equal(s.rawAudio, undefined)
})

test('privacy: sanitizeFusion keeps safe fields', () => {
  const fusion = {
    dominant: 'happy',
    scores: { happy: 0.9 },
    confidence: 0.85,
    agreement: 'all',
    modalities: { visual: 'happy', voice: 'happy', text: 'happy' },
    modalityConfidences: { visual: 0.8, voice: 0.7, text: 0.6 },
    modalitiesUsed: ['visual', 'voice', 'text'],
    ambiguous: false,
    timestamp: 1000,
    landmarks: 'should-be-removed',
    rawAudio: 'should-be-removed',
  }
  const s = f.sanitizeFusion(fusion)
  assert.equal(s.dominant, 'happy')
  assert.equal(s.agreement, 'all')
  assert.equal(s.landmarks, undefined)
  assert.equal(s.rawAudio, undefined)
})

test('privacy: isFusionClean detects prohibited fields', () => {
  assert.equal(f.isFusionClean({ dominant: 'happy' }), true)
  assert.equal(f.isFusionClean({ dominant: 'happy', landmarks: [[0, 0]] }), false)
  assert.equal(f.isFusionClean({ dominant: 'happy', voicePrint: 'xxx' }), false)
})

test('privacy: clearFusionState wipes frames', () => {
  const state = f.defaultFusionState()
  state.frames = [{ at: 1000, expressions: { happy: 1 } }]
  f.clearFusionState(state)
  assert.equal(state.frames.length, 0)
})

// ─── 集成 + 隔离 — 3 tests ─────────────────────────────────

test('integration: full pipeline 3 modalities → fusion → stable', () => {
  // 模拟 5 次 3 模态融合（持续 happy）
  const state = f.defaultFusionState()
  for (let i = 0; i < 5; i++) {
    const fusion = f.fuse({
      visual: makeModality('happy', 0.85),
      voice: makeModality('happy', 0.75),
      text: { joy: 0.9, surprise: 0.1 },
      textConfidence: 0.7,
      now: 1000 + i * 200,
    })
    f.addFusion({ state, fusion, now: 1000 + i * 200 })
  }
  const stable = f.getStableFusion({ state, now: 2500 })
  assert.ok(stable)
  assert.equal(stable.dominant, 'happy')
  assert.ok(stable.confidence > 0.5)
})

test('integration: ambiguous flow → stable still works', () => {
  // 模拟 3 模态全不同的场景
  const state = f.defaultFusionState()
  for (let i = 0; i < 4; i++) {
    const fusion = f.fuse({
      visual: makeModality('happy', 0.4),
      voice: makeModality('sad', 0.4),
      text: { anger: 0.7 },
      textConfidence: 0.5,
      now: 1000 + i * 200,
    })
    f.addFusion({ state, fusion, now: 1000 + i * 200 })
  }
  // 全不一 → ambiguous
  const last = f.getStableFusion({ state, now: 2500 })
  // 即使 ambiguous，stable 仍可能输出（取 confidence 最高的）
  assert.ok(last)
})

test('isolation: fusion 0 import emotion-state (ADR-002 验证)', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/fusion/'
  for (const f of ['fuser.js', 'state.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /from\s+['"][^'"]*emotion-state['"]/i, `${f} must not import emotion-state`)
    assert.doesNotMatch(src, /from\s+['"][^'"]*joy-state['"]/i, `${f} must not import joy-state`)
  }
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
