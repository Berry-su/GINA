// Visual emotion framework tests (25+ tests).
//
// Run: node --test tests/test-visual-emotion.js
//
// Critical invariants (老板 9-07 纪律):
//   1. 摄像头默认关闭（必须 grant 才开）
//   2. 帧检测后立即 sanitize（不持久化像素）
//   3. 仅本地处理（不调云端 emotion API）
//   4. 7 类表情输出
//   5. 滑动窗口稳定化
//   6. emotion 仍走 ADR-002 meta-info 隔离

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-visual-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const ve = await import('../src/perception/visual-emotion/index.js')

// ─── camera — 5 tests ──────────────────────────────────────

test('camera: default state is closed', () => {
  const s = ve.defaultCameraState()
  assert.equal(s.enabled, false)
  assert.equal(s.stream, null)
})

test('camera: openCamera with no mediaDevices returns error', async () => {
  const r = await ve.openCamera({ mediaDevices: null })
  assert.ok(r.error)
  assert.match(r.error, /not available/)
})

test('camera: openCamera with mock mediaDevices', async () => {
  const mockStream = {
    getTracks: () => [{ stop: () => {}, addEventListener: () => {} }],
    getVideoTracks: () => [{
      getSettings: () => ({ deviceId: 'mock-cam' }),
      addEventListener: () => {},
    }],
  }
  const mockMediaDevices = {
    getUserMedia: async (constraints) => {
      assert.ok(constraints.video)
      assert.equal(constraints.audio, false)
      return mockStream
    },
    enumerateDevices: async () => [{
      kind: 'videoinput',
      deviceId: 'mock-cam',
      label: 'Mock Camera',
    }],
  }
  const r = await ve.openCamera({ mediaDevices: mockMediaDevices, state: ve.defaultCameraState() })
  assert.equal(r.error, null)
  assert.equal(r.state.enabled, true)
  assert.equal(r.state.stream, mockStream)
})

test('camera: closeCamera stops all tracks', () => {
  const state = ve.defaultCameraState()
  let stopped = 0
  state.stream = {
    getTracks: () => [{ stop: () => { stopped++ } }, { stop: () => { stopped++ } }],
  }
  state.enabled = true
  ve.closeCamera({ state })
  assert.equal(stopped, 2)
  assert.equal(state.enabled, false)
  assert.equal(state.stream, null)
})

test('camera: isOpen reflects state', () => {
  const s = ve.defaultCameraState()
  assert.equal(ve.isOpen(s), false)
  s.enabled = true
  s.stream = { getTracks: () => [] }
  assert.equal(ve.isOpen(s), true)
})

// ─── face-detector — 6 tests ────────────────────────────────

test('face-detector: 7 expressions defined', () => {
  assert.equal(ve.EXPRESSIONS.length, 7)
  assert.ok(ve.EXPRESSIONS.includes('neutral'))
  assert.ok(ve.EXPRESSIONS.includes('happy'))
  assert.ok(ve.EXPRESSIONS.includes('sad'))
  assert.ok(ve.EXPRESSIONS.includes('angry'))
  assert.ok(ve.EXPRESSIONS.includes('surprised'))
  assert.ok(ve.EXPRESSIONS.includes('disgusted'))
  assert.ok(ve.EXPRESSIONS.includes('fearful'))
})

test('face-detector: mock detector returns faces', async () => {
  const detector = ve.createMockDetector({
    faces: [{
      bbox: { x: 100, y: 100, width: 200, height: 200 },
      expressions: { neutral: 0.1, happy: 0.9 },
      confidence: 0.95,
    }],
  })
  const r = await ve.detectFaces({
    detector,
    frame: { width: 640, height: 480 },
  })
  assert.equal(r.error, null)
  assert.equal(r.faces.length, 1)
  assert.equal(r.faces[0].expressions.happy, 0.9)
  assert.equal(r.faces[0].bbox.width, 200)
})

test('face-detector: detectFaces without detector returns error', async () => {
  const r = await ve.detectFaces({ detector: null, frame: { width: 640, height: 480 } })
  assert.ok(r.error)
  assert.equal(r.faces.length, 0)
})

test('face-detector: createFaceApiDetector with stub', async () => {
  const inner = {
    detect: async () => [{
      score: 0.92,
      detection: { box: { x: 50, y: 50, width: 150, height: 150 } },
      landmarks: { _positions: [[60, 60]] },
      expressions: { neutral: 0.1, happy: 0.9 },
    }],
  }
  const detector = ve.createFaceApiDetector({ detector: inner })
  const r = await ve.detectFaces({ detector, frame: { width: 640, height: 480 } })
  assert.equal(r.error, null)
  assert.equal(r.faces.length, 1)
  assert.equal(r.faces[0].expressions.happy, 0.9)
})

test('face-detector: low confidence face filtered out', async () => {
  const inner = {
    detect: async () => [
      { score: 0.05, detection: { box: { x: 0, y: 0, width: 100, height: 100 } }, expressions: { neutral: 1 } },
      { score: 0.95, detection: { box: { x: 0, y: 0, width: 100, height: 100 } }, expressions: { happy: 0.9 } },
    ],
  }
  const detector = ve.createFaceApiDetector({ detector: inner, minConfidence: 0.5 })
  const r = await ve.detectFaces({ detector, frame: { width: 640, height: 480 } })
  assert.equal(r.faces.length, 1)
  assert.equal(r.faces[0].expressions.happy, 0.9)
})

test('face-detector: max 5 faces', async () => {
  const inner = {
    detect: async () => Array(10).fill(null).map((_, i) => ({
      score: 0.9,
      detection: { box: { x: i * 50, y: 0, width: 40, height: 40 } },
      expressions: { neutral: 1 },
    })),
  }
  const detector = ve.createFaceApiDetector({ detector: inner })
  const r = await ve.detectFaces({ detector, frame: { width: 640, height: 480 } })
  assert.ok(r.faces.length <= 5)
})

// ─── emotion-tracker — 6 tests ──────────────────────────────

test('tracker: empty state returns null', () => {
  const state = ve.defaultTrackerState()
  const r = ve.getStableEmotion({ state })
  assert.equal(r, null)
})

test('tracker: 1 frame insufficient', () => {
  const state = ve.defaultTrackerState()
  ve.addFrame({ state, expressions: { happy: 0.9, neutral: 0.1 }, now: 1000 })
  const r = ve.getStableEmotion({ state, now: 1100 })
  assert.equal(r, null)
})

test('tracker: 3 frames stable', () => {
  const state = ve.defaultTrackerState()
  ve.addFrame({ state, expressions: { happy: 0.8, neutral: 0.2 }, now: 1000 })
  ve.addFrame({ state, expressions: { happy: 0.9, neutral: 0.1 }, now: 1500 })
  ve.addFrame({ state, expressions: { happy: 0.85, neutral: 0.15 }, now: 2000 })
  const r = ve.getStableEmotion({ state, now: 2200 })
  assert.ok(r)
  assert.equal(r.dominant, 'happy')
  assert.ok(r.confidence > 0.5)
  assert.equal(r.frameCount, 3)
})

test('tracker: smooths jitter (single outlier filtered)', () => {
  const state = ve.defaultTrackerState()
  ve.addFrame({ state, expressions: { neutral: 1 }, now: 1000 })
  ve.addFrame({ state, expressions: { happy: 1 }, now: 1200 })  // 单帧跳变
  ve.addFrame({ state, expressions: { neutral: 1 }, now: 1400 })
  ve.addFrame({ state, expressions: { neutral: 1 }, now: 1600 })
  const r = ve.getStableEmotion({ state, now: 1800 })
  // 中性占主导（因为 happy 是单帧）
  assert.equal(r.dominant, 'neutral')
})

test('tracker: resetTracker clears all', () => {
  const state = ve.defaultTrackerState()
  ve.addFrame({ state, expressions: { happy: 1 }, now: 1000 })
  ve.addFrame({ state, expressions: { happy: 1 }, now: 1100 })
  ve.resetTracker(state)
  assert.equal(state.frames.length, 0)
  assert.equal(ve.getStableEmotion({ state }), null)
})

test('tracker: setWindowSize truncates', () => {
  const state = ve.defaultTrackerState({ windowSize: 10 })
  for (let i = 0; i < 15; i++) {
    ve.addFrame({ state, expressions: { happy: 1 }, now: 1000 + i * 100 })
  }
  ve.setWindowSize(state, 5)
  assert.ok(state.frames.length <= 5)
})

// ─── privacy-guard — 6 tests ────────────────────────────────

test('privacy: only allowed detectors (face-api/mock/mediapipe)', () => {
  assert.equal(ve.isDetectorAllowed('face-api'), true)
  assert.equal(ve.isDetectorAllowed('mock'), true)
  assert.equal(ve.isDetectorAllowed('mediapipe'), true)
  assert.equal(ve.isDetectorAllowed('aws-rekognition'), false)  // 云端禁止
  assert.equal(ve.isDetectorAllowed('azure-face'), false)
  assert.equal(ve.isDetectorAllowed('unknown'), false)
})

test('privacy: local-only URL allowlist', () => {
  assert.equal(ve.isLocalOnly('http://localhost:3000/api'), true)
  assert.equal(ve.isLocalOnly('http://127.0.0.1:8080'), true)
  assert.equal(ve.isLocalOnly('file:///path/to/model.json'), true)
  assert.equal(ve.isLocalOnly('data:image/png;base64,...'), true)
  assert.equal(ve.isLocalOnly('https://api.openai.com/v1/emotion'), false)
  assert.equal(ve.isLocalOnly('https://googleapis.com/face'), false)
  assert.equal(ve.isLocalOnly('https://emotion-detection-api.example.com'), false)
})

test('privacy: sanitizeFrame strips pixel data', () => {
  const frame = {
    width: 640,
    height: 480,
    data: new Uint8Array(100),  // 像素数据
    canvas: 'fake canvas ref',
  }
  const sanitized = ve.sanitizeFrame(frame)
  assert.equal(sanitized.width, 640)
  assert.equal(sanitized.height, 480)
  assert.equal(sanitized.data, undefined)
  assert.equal(sanitized.canvas, undefined)
})

test('privacy: sanitizeDetection strips landmarks', () => {
  const detection = {
    faces: [{
      id: 'f1',
      bbox: { x: 100, y: 100, width: 200, height: 200 },
      landmarks: [[150, 150], [160, 160]],  // 68 点
      expressions: { happy: 0.9 },
      confidence: 0.95,
    }],
    width: 640,
    height: 480,
  }
  const sanitized = ve.sanitizeDetection(detection)
  assert.equal(sanitized.faces.length, 1)
  assert.ok(!sanitized.faces[0].landmarks)  // 必须删
  assert.equal(sanitized.faces[0].expressions.happy, 0.9)
})

test('privacy: clearTrackerState wipes frames', () => {
  const state = ve.defaultTrackerState()
  state.frames = [{ at: 1000, expressions: { happy: 1 } }]
  ve.clearTrackerState(state)
  assert.equal(state.frames.length, 0)
})

test('privacy: consent state default is not granted', () => {
  const s = ve.defaultConsentState()
  assert.equal(ve.isGranted(s), false)
  ve.grant(s)
  assert.equal(ve.isGranted(s), true)
  assert.ok(s.grantedAt)
  ve.revoke(s)
  assert.equal(ve.isGranted(s), false)
  assert.ok(s.revokedAt)
})

// ─── 集成 + 隔离 — 3 tests ─────────────────────────────────

test('integration: full pipeline camera + detect + tracker', async () => {
  // 模拟完整流程：开摄像头 → 检测 → 跟踪 → 关摄像头 → 清空
  const mockStream = {
    getTracks: () => [{ stop: () => {}, addEventListener: () => {} }],
    getVideoTracks: () => [{ getSettings: () => ({}), addEventListener: () => {} }],
  }
  const mockMediaDevices = {
    getUserMedia: async () => mockStream,
    enumerateDevices: async () => [],
  }
  const consent = ve.defaultConsentState()
  ve.grant(consent)
  assert.equal(ve.isGranted(consent), true)
  // 1. 开
  const cam = await ve.openCamera({ mediaDevices: mockMediaDevices })
  assert.equal(cam.error, null)
  assert.equal(ve.isOpen(cam.state), true)
  // 2. 检测
  const detector = ve.createMockDetector({
    faces: [{ bbox: { x: 0, y: 0, width: 100, height: 100 }, expressions: { happy: 0.9, neutral: 0.1 }, confidence: 0.9 }],
  })
  const tracker = ve.defaultTrackerState()
  for (let i = 0; i < 4; i++) {
    const r = await ve.detectFaces({ detector, frame: { width: 640, height: 480 } })
    if (r.faces.length > 0) {
      ve.addFrame({ state: tracker, expressions: r.faces[0].expressions, faceCount: 1, confidence: r.faces[0].confidence, now: 1000 + i * 200 })
    }
  }
  const stable = ve.getStableEmotion({ state: tracker, now: 2000 })
  assert.ok(stable)
  assert.equal(stable.dominant, 'happy')
  // 3. 关 + 清
  ve.closeCamera({ state: cam.state })
  ve.clearTrackerState(tracker)
  assert.equal(ve.isOpen(cam.state), false)
  assert.equal(tracker.frames.length, 0)
})

test('isolation: visual-emotion 0 import emotion-state (ADR-002 验证)', () => {
  // 静态扫描
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/visual-emotion/'
  for (const f of ['camera.js', 'face-detector.js', 'emotion-tracker.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    // 不应 import emotion-state（ADR-002 隔离）
    assert.doesNotMatch(src, /from\s+['"][^'"]*emotion-state['"]/i, `${f} must not import emotion-state`)
    assert.doesNotMatch(src, /from\s+['"][^'"]*joy-state['"]/i, `${f} must not import joy-state`)
  }
})

test('isolation: visual-emotion 0 调用云端 emotion API', () => {
  // 静态扫描
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/visual-emotion/'
  for (const f of ['camera.js', 'face-detector.js', 'emotion-tracker.js', 'privacy-guard.js', 'index.js']) {
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
