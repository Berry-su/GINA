// face-detector.js — 人脸检测 + 表情分类（抽象层）
//
// 定位：把 face-api.js / MediaPipe / 其他后端封装成统一接口。
// 不硬编码某个库（保持测试时用 mock，生产用真实模型）。
//
// 标准输入: frame (OffscreenCanvas / HTMLCanvasElement / ImageData)
// 标准输出: {
//   faces: [{
//     bbox: { x, y, width, height },
//     landmarks: [[x, y], ...],   // 68 点
//     expressions: {
//       neutral, happy, sad, angry, surprised, disgusted, fearful
//     },
//     confidence: 0-1,
//   }],
//   width, height,
//   durationMs,
// }
//
// 7 类表情（基于 face-api.js 标准分类）:
//   neutral / happy / sad / angry / surprised / disgusted / fearful

// ─── 7 类表情常量 ──────────────────────────────────────────

export const EXPRESSIONS = Object.freeze([
  'neutral', 'happy', 'sad', 'angry', 'surprised', 'disgusted', 'fearful',
])

export const EXPRESSION_LABELS_ZH = Object.freeze({
  neutral: '平静',
  happy: '高兴',
  sad: '难过',
  angry: '愤怒',
  surprised: '惊讶',
  disgusted: '厌恶',
  fearful: '害怕',
})

const MAX_FACES = 5
const MIN_CONFIDENCE = 0.1
const DEFAULT_TIMEOUT_MS = 5000

// ─── 内部工具 ───────────────────────────────────────────────

function normalizeExpressions(raw) {
  // 接受 {neutral: 0.x, happy: 0.y, ...} 或 {expression: score} 数组
  if (!raw) return null
  if (Array.isArray(raw)) {
    const out = {}
    for (const item of raw) {
      if (item && typeof item === 'object' && item.expression && typeof item.score === 'number') {
        out[item.expression] = item.score
      }
    }
    return out
  }
  if (typeof raw === 'object') {
    const out = {}
    for (const expr of EXPRESSIONS) {
      if (typeof raw[expr] === 'number') out[expr] = raw[expr]
    }
    return Object.keys(out).length > 0 ? out : null
  }
  return null
}

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

// ─── Detector 接口（mock 后端参考） ─────────────────────────

// 创建 mock detector（用于测试 + 离线 demo）
//   options: { faces: [{bbox, expressions, landmarks}], delayMs, failRate }
export function createMockDetector(options = {}) {
  const faces = Array.isArray(options.faces) ? options.faces : []
  const delayMs = options.delayMs || 0
  const failRate = options.failRate || 0
  return {
    type: 'mock',
    async detect(frame, opts = {}) {
      if (failRate > 0 && Math.random() < failRate) {
        throw new Error('mock detector failure')
      }
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
      return {
        faces: faces.map((f, i) => ({
          id: `face-${i}`,
          bbox: f.bbox || { x: 0, y: 0, width: 100, height: 100 },
          landmarks: f.landmarks || [],
          expressions: f.expressions || { neutral: 1 },
          confidence: clamp01(f.confidence != null ? f.confidence : 0.9),
        })),
        width: frame?.width || 640,
        height: frame?.height || 480,
        durationMs: delayMs,
      }
    },
    async close() { return null },
  }
}

// 真实 face-api.js detector 包装（生产用）
//   options: { detector: realFaceApiDetector, minConfidence }
//   detector 必须有 detect(input) → 原始结果
export function createFaceApiDetector(options = {}) {
  const inner = options.detector
  if (!inner || typeof inner.detect !== 'function') {
    throw new Error('createFaceApiDetector: options.detector must have detect() method')
  }
  const minConfidence = options.minConfidence != null ? options.minConfidence : MIN_CONFIDENCE
  return {
    type: 'face-api',
    async detect(frame, opts = {}) {
      const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
      const result = await Promise.race([
        inner.detect(frame),
        new Promise((_, reject) => setTimeout(() => reject(new Error('detect timeout')), timeoutMs)),
      ])
      // 适配 face-api.js 标准输出
      const detections = Array.isArray(result) ? result : (result?.detections || [])
      return {
        faces: detections.slice(0, MAX_FACES)
          .filter(d => (d.score != null ? d.score : d.confidence || 1) >= minConfidence)
          .map((d, i) => {
            const box = d.detection?.box || d.box || d.bbox || { x: 0, y: 0, width: 0, height: 0 }
            return {
              id: `face-${i}`,
              bbox: {
                x: box.x || box.left || 0,
                y: box.y || box.top || 0,
                width: box.width || 0,
                height: box.height || 0,
              },
              landmarks: d.landmarks?._positions || d.landmarks || [],
              expressions: normalizeExpressions(d.expressions) || { neutral: 1 },
              confidence: clamp01(d.score != null ? d.score : d.confidence || 0.5),
            }
          }),
        width: frame?.width || 640,
        height: frame?.height || 480,
        durationMs: 0,
      }
    },
    async close() {
      if (typeof inner.close === 'function') return inner.close()
      return null
    },
  }
}

// ─── 主导出：检测单帧 ──────────────────────────────────────

//   options: { detector, frame, minConfidence, maxFaces }
//   返回: { faces, width, height, durationMs, error }
export async function detectFaces(options = {}) {
  if (!options.detector || typeof options.detector.detect !== 'function') {
    return { faces: [], width: 0, height: 0, durationMs: 0, error: 'detector required' }
  }
  if (!options.frame) {
    return { faces: [], width: 0, height: 0, durationMs: 0, error: 'frame required' }
  }
  const start = Date.now()
  try {
    const r = await options.detector.detect(options.frame, options)
    const maxFaces = options.maxFaces || MAX_FACES
    return {
      faces: (r.faces || []).slice(0, maxFaces),
      width: r.width || options.frame?.width || 0,
      height: r.height || options.frame?.height || 0,
      durationMs: r.durationMs != null ? r.durationMs : Date.now() - start,
      error: null,
    }
  } catch (e) {
    return {
      faces: [],
      width: options.frame?.width || 0,
      height: options.frame?.height || 0,
      durationMs: Date.now() - start,
      error: e?.message || String(e),
    }
  }
}

export {
  normalizeExpressions,
  clamp01,
  MAX_FACES,
  MIN_CONFIDENCE,
  DEFAULT_TIMEOUT_MS,
}
