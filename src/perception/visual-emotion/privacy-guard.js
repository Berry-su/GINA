// privacy-guard.js — 隐私保护（视觉情绪硬约束）
//
// 老板 9-07 翻身唯一机会 + 零妥协 + 隐私保护红线：
//
// 1. **本地处理**：不调用任何云端 API（不传图、不传 landmark、不传 emotion）
// 2. **不持久化原始帧**：检测后立即丢弃（不存盘、不入 DB、不缓存帧像素）
// 3. **不缓存情绪历史超出窗口**：只保留最近 5 帧（约 2.5s）的稳定化输出
// 4. **摄像头关闭 = 立即清空**：摄像头关 → 清空所有 tracker 状态
// 5. **不传到对话**：emotion 仍按 ADR-002 走 meta-info 隔离
// 6. **显式同意**：首次启动需老板说"开"才开（默认关闭）

// ─── 常量 ───────────────────────────────────────────────────

const ALLOWED_DETECTORS = new Set(['face-api', 'mock', 'mediapipe'])
const MAX_PERSISTENT_FRAMES = 0       // 0 = 不允许持久化任何帧
const MAX_TRACKER_WINDOW = 30         // 滑动窗口上限
const NETWORK_BLOCKED_HOSTS = [
  /api\.openai\.com/,
  /api\.anthropic\.com/,
  /googleapis\.com/,
  /face-recognition\.com/,
  /emotion-detection-api/,
]

// ─── 工具 ───────────────────────────────────────────────────

// 验证 detector 类型是否在白名单
export function isDetectorAllowed(detectorType) {
  return ALLOWED_DETECTORS.has(detectorType)
}

// 验证 URL 不在云端黑名单（防止误调用）
export function isLocalOnly(url) {
  if (typeof url !== 'string') return false
  for (const re of NETWORK_BLOCKED_HOSTS) {
    if (re.test(url)) return false
  }
  // 只允许 localhost / 127.0.0.1 / 内网 IP / file: / data: / blob:
  if (url.startsWith('file://')) return true
  if (url.startsWith('data:')) return true
  if (url.startsWith('blob:')) return true
  if (url.startsWith('http://localhost')) return true
  if (url.startsWith('http://127.0.0.1')) return true
  if (url.startsWith('https://localhost')) return true
  if (url.startsWith('https://127.0.0.1')) return true
  return false
}

// 立刻清空 frame（不持久化）
//   任何传入的 frame 都立即"清"：只保留元数据（width/height/expressions），丢弃像素
export function sanitizeFrame(frame) {
  if (!frame) return null
  if (typeof frame === 'object') {
    return {
      width: frame.width || 0,
      height: frame.height || 0,
      // 不保留 frame 像素（canvas / image data / video element）
    }
  }
  return null
}

// 立刻清空所有 face 检测结果中的图像引用
export function sanitizeDetection(detection) {
  if (!detection || typeof detection !== 'object') return null
  return {
    faces: (detection.faces || []).map(f => ({
      id: f.id,
      bbox: f.bbox ? { x: f.bbox.x, y: f.bbox.y, width: f.bbox.width, height: f.bbox.height } : null,
      // 不保留 landmarks（可能反向识别）
      expressions: f.expressions ? { ...f.expressions } : null,
      confidence: f.confidence,
    })),
    width: detection.width || 0,
    height: detection.height || 0,
    durationMs: detection.durationMs || 0,
  }
}

// 立刻清空 tracker 状态（老板关摄像头时调用）
export function clearTrackerState(state) {
  if (!state) return null
  if (Array.isArray(state.frames)) {
    state.frames = []  // 清空所有 frame 历史
  }
  return state
}

// 强制窗口大小 ≤ 上限（防 OOM）
export function clampWindowSize(size) {
  if (typeof size !== 'number' || !isFinite(size) || size <= 0) return 5
  return Math.min(MAX_TRACKER_WINDOW, Math.floor(size))
}

// 完整性检查：frame 不应被持久化
//   通过对 frame 引用计数（如果可能）
//   实际工程中：依赖"代码不写 frame 引用"的纪律 + 测试时静态扫描
export function isFramePersisted(frame, persistentStore) {
  if (!frame || !persistentStore) return false
  if (typeof persistentStore.has === 'function') {
    return persistentStore.has(frame)
  }
  if (typeof persistentStore.includes === 'function') {
    return persistentStore.includes(frame)
  }
  return false
}

// 显式同意状态（首次启动需要老板说"开"）
//   state: { granted, grantedAt, revokedAt }
export function defaultConsentState() {
  return {
    granted: false,
    grantedAt: null,
    revokedAt: null,
  }
}

export function grant(state) {
  state.granted = true
  state.grantedAt = new Date().toISOString()
  state.revokedAt = null
  return state
}

export function revoke(state) {
  state.granted = false
  state.revokedAt = new Date().toISOString()
  return state
}

export function isGranted(state) {
  return !!(state && state.granted === true)
}

export {
  ALLOWED_DETECTORS,
  MAX_PERSISTENT_FRAMES,
  MAX_TRACKER_WINDOW,
  NETWORK_BLOCKED_HOSTS,
}
