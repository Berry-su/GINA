// Voice emotion framework tests (25+ tests).
//
// Run: node --test tests/test-voice-emotion.js
//
// Critical invariants:
//   1. 麦克风默认关闭（必须 grant 才开）
//   2. 原始音频不持久化（FORBIDDEN_PERSISTENT_FIELDS）
//   3. 仅本地处理（不调云端 emotion API）
//   4. 7 类情绪输出（与 face-detector 一致）
//   5. 滑动窗口稳定化
//   6. emotion 仍走 ADR-002 meta-info 隔离
//   7. 复用视觉情绪的 tracker 模式

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-voice-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const ve = await import('../src/perception/voice-emotion/index.js')

// ─── prosody — 8 tests ──────────────────────────────────────

test('prosody: computeRMS on silence returns 0', () => {
  const silence = new Float32Array(1024)  // 全 0
  assert.equal(ve.computeRMS(silence), 0)
})

test('prosody: computeRMS on noise returns > 0', () => {
  const noise = new Float32Array(1024)
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() - 0.5) * 0.5
  const rms = ve.computeRMS(noise)
  assert.ok(rms > 0)
  assert.ok(rms < 1)
})

test('prosody: computePitch on silence returns 0', () => {
  const silence = new Float32Array(2048)
  assert.equal(ve.computePitch(silence, 16000), 0)
})

test('prosody: computePitch on sine 200Hz returns ~200', () => {
  const sr = 16000
  const freq = 200
  const samples = Math.floor(sr / freq * 20)  // 20 周期
  const frame = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    frame[i] = 0.5 * Math.sin(2 * Math.PI * freq * i / sr)
  }
  const pitch = ve.computePitch(frame, sr)
  assert.ok(pitch > 150 && pitch < 250, `expected ~200, got ${pitch}`)
})

test('prosody: computeZCR on alternating signal returns 1', () => {
  const sig = new Float32Array(100)
  for (let i = 0; i < sig.length; i++) sig[i] = i % 2 === 0 ? 0.5 : -0.5
  const zcr = ve.computeZCR(sig)
  assert.ok(zcr > 0.9, `expected ~1, got ${zcr}`)
})

test('prosody: computeSpectralCentroid on low freq returns low', () => {
  const sr = 16000
  const fftSize = 2048
  // bin 10 = ~78 Hz（low）
  const freq = new Uint8Array(fftSize / 2)
  freq[10] = 255
  const cent = ve.computeSpectralCentroid(freq, sr, fftSize)
  assert.ok(cent < 200, `expected low, got ${cent}`)
})

test('prosody: extractFeatures returns 6 fields', () => {
  const timeFrame = new Float32Array(1024)
  for (let i = 0; i < timeFrame.length; i++) timeFrame[i] = Math.sin(2 * Math.PI * 200 * i / 16000) * 0.3
  const freqFrame = new Uint8Array(512)
  freqFrame[20] = 200
  const f = ve.extractFeatures({
    timeFrame,
    freqFrame,
    sampleRate: 16000,
    fftSize: 1024,
  })
  assert.ok(typeof f.rms === 'number')
  assert.ok(typeof f.pitch === 'number')
  assert.ok(typeof f.zcr === 'number')
  assert.ok(typeof f.centroid === 'number')
  assert.ok(typeof f.flux === 'number')
  assert.ok(typeof f.voiced === 'boolean')
})

test('prosody: aggregateFeatures returns full stats', () => {
  const frames = []
  for (let i = 0; i < 5; i++) {
    frames.push({
      rms: 0.1 + i * 0.01,
      pitch: 150 + i * 5,
      zcr: 0.1,
      centroid: 1000,
      flux: 10,
      voiced: i % 2 === 0,
    })
  }
  const a = ve.aggregateFeatures({ frames })
  assert.equal(a.voicedRatio, 3 / 5)
  assert.ok(a.rms.mean > 0)
  assert.ok(a.pitch.mean > 0)
})

// ─── audio-capture — 4 tests ───────────────────────────────

test('audio: default state is closed', () => {
  const s = ve.defaultAudioState()
  assert.equal(s.enabled, false)
  assert.equal(s.stream, null)
  assert.equal(s.audioContext, null)
})

test('audio: openMicrophone without mediaDevices returns error', async () => {
  const r = await ve.openMicrophone({ mediaDevices: null })
  assert.ok(r.error)
  assert.match(r.error, /not available/)
})

test('audio: openMicrophone with mock mediaDevices + AudioContext', async () => {
  const mockStream = {
    getTracks: () => [{ stop: () => {}, addEventListener: () => {} }],
    getAudioTracks: () => [{ getSettings: () => ({ deviceId: 'mock-mic' }), addEventListener: () => {} }],
  }
  const mockMediaDevices = {
    getUserMedia: async (constraints) => {
      assert.ok(constraints.audio)
      assert.equal(constraints.video, false)
      return mockStream
    },
    enumerateDevices: async () => [{
      kind: 'audioinput',
      deviceId: 'mock-mic',
      label: 'Mock Microphone',
    }],
  }
  const mockAudioContext = {
    sampleRate: 16000,
    createAnalyser: () => ({
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0.6,
      getFloatTimeDomainData: () => {},
      getByteFrequencyData: () => {},
      disconnect: () => {},
    }),
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    close: () => {},
  }
  const r = await ve.openMicrophone({
    mediaDevices: mockMediaDevices,
    audioContext: mockAudioContext,
    state: ve.defaultAudioState(),
  })
  assert.equal(r.error, null)
  assert.equal(r.state.enabled, true)
})

test('audio: closeMicrophone stops all tracks', () => {
  const state = ve.defaultAudioState()
  let stopped = 0
  state.stream = {
    getTracks: () => [{ stop: () => { stopped++ } }],
  }
  state.analyser = { disconnect: () => {} }
  state.audioContext = { close: () => {} }
  state.source = { disconnect: () => {} }
  state.enabled = true
  ve.closeMicrophone({ state })
  assert.equal(stopped, 1)
  assert.equal(state.enabled, false)
  assert.equal(state.stream, null)
})

// ─── emotion-classifier — 6 tests ──────────────────────────

test('classifier: 7 expressions defined', () => {
  assert.equal(ve.EXPRESSIONS.length, 7)
  for (const e of ['neutral', 'happy', 'sad', 'angry', 'surprised', 'disgusted', 'fearful']) {
    assert.ok(ve.EXPRESSIONS.includes(e))
  }
})

test('classifier: classifyByRules returns 7 scores', () => {
  const r = ve.classifyByRules({
    pitch: { mean: 150, std: 10 },
    rms: { mean: 0.1 },
    centroid: { mean: 1000 },
    flux: { mean: 10 },
    pauseRatio: 0.3,
    speakingRate: 5,
  })
  assert.equal(typeof r.dominant, 'string')
  assert.ok(r.scores)
  assert.equal(Object.keys(r.scores).length, 7)
})

test('classifier: high pitch + high energy → happy/angry/surprised', () => {
  const r = ve.classifyByRules({
    pitch: { mean: 250, std: 20 },
    rms: { mean: 0.3 },
    centroid: { mean: 2000 },
    flux: { mean: 30 },
    pauseRatio: 0.2,
    speakingRate: 10,
  })
  // happy / angry / surprised 都应该得分
  assert.ok(r.scores.happy > 0 || r.scores.angry > 0 || r.scores.surprised > 0)
})

test('classifier: low pitch + low energy + low rate → sad', () => {
  const r = ve.classifyByRules({
    pitch: { mean: 100, std: 5 },
    rms: { mean: 0.02 },
    centroid: { mean: 500 },
    flux: { mean: 5 },
    pauseRatio: 0.4,
    speakingRate: 1,
  })
  assert.equal(r.dominant, 'sad')
})

test('classifier: high pause ratio → neutral', () => {
  const r = ve.classifyByRules({
    pitch: { mean: 150, std: 5 },
    rms: { mean: 0.05 },
    centroid: { mean: 1000 },
    flux: { mean: 5 },
    pauseRatio: 0.7,  // 70% 停顿
    speakingRate: 2,
  })
  assert.equal(r.dominant, 'neutral')
})

test('classifier: mock classifier with fixed scores', () => {
  const c = ve.createMockClassifier({
    dominant: 'happy',
    scores: { happy: 0.8, neutral: 0.1, sad: 0.1, angry: 0, surprised: 0, disgusted: 0, fearful: 0 },
  })
  const r = c.classify({})
  assert.equal(r.dominant, 'happy')
  assert.equal(r.scores.happy, 0.8)
})

// ─── emotion-tracker — 4 tests ─────────────────────────────

test('tracker: empty state returns null', () => {
  const state = ve.defaultTrackerState()
  const r = ve.getStableEmotion({ state })
  assert.equal(r, null)
})

test('tracker: 3 frames stable', () => {
  const state = ve.defaultTrackerState()
  const c = ve.createMockClassifier({ dominant: 'happy', scores: { happy: 0.9, neutral: 0.1, sad: 0, angry: 0, surprised: 0, disgusted: 0, fearful: 0 } })
  for (let i = 0; i < 3; i++) {
    const r = c.classify({})
    ve.addFrame({ state, classification: r, now: 1000 + i * 200 })
  }
  const stable = ve.getStableEmotion({ state, now: 2000 })
  assert.ok(stable)
  assert.equal(stable.dominant, 'happy')
})

test('tracker: smooths jitter (single outlier filtered)', () => {
  const state = ve.defaultTrackerState()
  const cNeutral = ve.createMockClassifier({ dominant: 'neutral', scores: { neutral: 0.9, happy: 0.1, sad: 0, angry: 0, surprised: 0, disgusted: 0, fearful: 0 } })
  const cHappy = ve.createMockClassifier({ dominant: 'happy', scores: { happy: 0.9, neutral: 0.1, sad: 0, angry: 0, surprised: 0, disgusted: 0, fearful: 0 } })
  ve.addFrame({ state, classification: cNeutral.classify({}), now: 1000 })
  ve.addFrame({ state, classification: cHappy.classify({}), now: 1200 })
  ve.addFrame({ state, classification: cNeutral.classify({}), now: 1400 })
  ve.addFrame({ state, classification: cNeutral.classify({}), now: 1600 })
  const stable = ve.getStableEmotion({ state, now: 1800 })
  // 中性应胜出
  assert.equal(stable.dominant, 'neutral')
})

test('tracker: resetTracker clears all', () => {
  const state = ve.defaultTrackerState()
  const c = ve.createMockClassifier({ dominant: 'happy', scores: { happy: 1, neutral: 0, sad: 0, angry: 0, surprised: 0, disgusted: 0, fearful: 0 } })
  ve.addFrame({ state, classification: c.classify({}), now: 1000 })
  ve.addFrame({ state, classification: c.classify({}), now: 1100 })
  ve.resetTracker(state)
  assert.equal(state.frames.length, 0)
})

// ─── privacy-guard — 4 tests ───────────────────────────────

test('privacy: FORBIDDEN_PERSISTENT_FIELDS includes rawAudio + pitchHistogram + voicePrint', () => {
  assert.ok(ve.FORBIDDEN_PERSISTENT_FIELDS.includes('rawAudio'))
  assert.ok(ve.FORBIDDEN_PERSISTENT_FIELDS.includes('pitchHistogram'))
  assert.ok(ve.FORBIDDEN_PERSISTENT_FIELDS.includes('voicePrint'))
})

test('privacy: sanitizeAudioFrame strips Float32Array', () => {
  const buf = new Float32Array(1024)
  assert.equal(ve.sanitizeAudioFrame(buf), null)
  const obj = ve.sanitizeAudioFrame({ length: 1024, sampleRate: 16000 })
  assert.equal(obj.length, 1024)
  assert.equal(obj.sampleRate, 16000)
})

test('privacy: sanitizeClassification keeps only scores + dominant', () => {
  const c = {
    dominant: 'happy',
    scores: { happy: 0.9, neutral: 0.1, sad: 0, angry: 0, surprised: 0, disgusted: 0, fearful: 0 },
    confidence: 0.9,
    stable: true,
    voicePrint: 'should-be-removed',  // 声纹特征
    pitchHistogram: [150, 160, 170],
  }
  const s = ve.sanitizeClassification(c)
  assert.equal(s.dominant, 'happy')
  assert.equal(s.scores.happy, 0.9)
  assert.equal(s.voicePrint, undefined)
  assert.equal(s.pitchHistogram, undefined)
})

test('privacy: isFrameClean rejects frames with rawAudio', () => {
  assert.equal(ve.isFrameClean({ rms: 0.1, pitch: 150 }), true)
  assert.equal(ve.isFrameClean({ rms: 0.1, rawAudio: new Float32Array(100) }), false)
  assert.equal(ve.isFrameClean({ pitchHistogram: [150, 160] }), false)
})

// ─── 集成 + 隔离 — 4 tests ─────────────────────────────────

test('integration: full pipeline mic + prosody + classify + tracker', async () => {
  const mockStream = {
    getTracks: () => [{ stop: () => {}, addEventListener: () => {} }],
    getAudioTracks: () => [{ getSettings: () => ({}), addEventListener: () => {} }],
  }
  const mockMediaDevices = {
    getUserMedia: async () => mockStream,
    enumerateDevices: async () => [],
  }
  const mockAudioContext = {
    sampleRate: 16000,
    createAnalyser: () => ({
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0.6,
      getFloatTimeDomainData: () => {},
      getByteFrequencyData: () => {},
      disconnect: () => {},
    }),
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    close: () => {},
  }
  // 1. grant + 开
  const consent = ve.defaultConsentState()
  ve.grant(consent)
  assert.equal(ve.isGranted(consent), true)
  const cam = await ve.openMicrophone({ mediaDevices: mockMediaDevices, audioContext: mockAudioContext })
  assert.equal(cam.error, null)
  // 2. 模拟 5 帧 prosody + classify
  const tracker = ve.defaultTrackerState()
  const c = ve.createMockClassifier({ dominant: 'happy', scores: { happy: 0.9, neutral: 0.1, sad: 0, angry: 0, surprised: 0, disgusted: 0, fearful: 0 } })
  for (let i = 0; i < 5; i++) {
    const r = c.classify({})
    ve.addFrame({ state: tracker, classification: r, now: 1000 + i * 200 })
  }
  const stable = ve.getStableEmotion({ state: tracker, now: 2500 })
  assert.ok(stable)
  assert.equal(stable.dominant, 'happy')
  // 3. 关 + 清
  ve.closeMicrophone({ state: cam.state })
  ve.clearTrackerState(tracker)
  assert.equal(ve.isOpen(cam.state), false)
  assert.equal(tracker.frames.length, 0)
})

test('isolation: voice-emotion 0 import emotion-state (ADR-002 验证)', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/voice-emotion/'
  for (const f of ['audio-capture.js', 'prosody.js', 'emotion-classifier.js', 'emotion-tracker.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /from\s+['"][^'"]*emotion-state['"]/i, `${f} must not import emotion-state`)
    assert.doesNotMatch(src, /from\s+['"][^'"]*joy-state['"]/i, `${f} must not import joy-state`)
  }
})

test('isolation: voice-emotion 0 调用云端 emotion API', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/voice-emotion/'
  for (const f of ['audio-capture.js', 'prosody.js', 'emotion-classifier.js', 'emotion-tracker.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${f} must not use fetch`)
    assert.doesNotMatch(src, /\baxios\b/, `${f} must not use axios`)
    assert.doesNotMatch(src, /\bhttps?:\/\/(?:api\.|googleapis)/, `${f} must not hardcode cloud URLs`)
  }
})

test('isolation: tracker 复用视觉 emotion 共享 base 实现', () => {
  // 验证 emotion-tracker.js 用的就是视觉 emotion 的 base
  const src = fs.readFileSync('/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/voice-emotion/emotion-tracker.js', 'utf8')
  assert.match(src, /from\s+['"]\.\.\/visual-emotion\/emotion-tracker\.js['"]/i)
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
