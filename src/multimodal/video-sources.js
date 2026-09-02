// src/multimodal/video-sources.js — 视频数据源适配器（ADR-013 · PLAN-P6 §Phase 6）
//
// 3 类数据源：
//   1. local       — 本地文件（老板自己拍/录的视频）
//   2. url-public  — 公开网 URL（YouTube / B 站 / Vimeo / 微博视频等）
//   3. streaming   — HLS / m3u8 直播流
//
// 关键约束（C-4.3 红线）：
//   - emotion-isolation: 视频元数据只进文本流
//   - 不 import joy-state
//   - 公开网视频：遵守 robots.txt + 服务条款，默认不爬需登录
//   - 不依赖老板真实私人视频（个人相册视频不在范围内）
//   - 默认 mock 模式（不真爬 YouTube/B 站，避免版权风险）
//
// 设计取舍：
//   - 真爬（yt-dlp / youtube-dl-exec）本期不实装，避免 100MB+ 二进制依赖
//   - url-public source 走 URL 元数据 stub（返回 title / duration / 缩略图 URL）
//   - 真集成留给 GINA_VIDEO_YT_DLP=1 的开关，默认关闭
//   - 不做视频编辑/转码/压缩（只做理解，不做处理）

import { promises as fs, existsSync, statSync } from 'fs'
import { createHash } from 'crypto'

// ── Provider 配置 ─────────────────────────────────────────────────────
export const VIDEO_SOURCES = [
  { id: 'local',      label: '本地文件',     default: true,  requiresKey: null  },
  { id: 'url-public', label: '公开网 URL',   default: false, requiresKey: null  },
  { id: 'streaming',  label: 'HLS / m3u8 流', default: false, requiresKey: null },
  { id: 'mock',       label: 'Mock 测试源',   default: false, requiresKey: null },
]

// 公开网视频平台识别（URL 关键字）
const PLATFORM_PATTERNS = [
  { id: 'youtube', regex: /youtube\.com|youtu\.be/i,        label: 'YouTube' },
  { id: 'bilibili', regex: /bilibili\.com|b23\.tv/i,       label: '哔哩哔哩' },
  { id: 'vimeo',    regex: /vimeo\.com/i,                  label: 'Vimeo' },
  { id: 'weibo',    regex: /weibo\.com|weibo\.cn/i,        label: '微博视频' },
  { id: 'twitter',  regex: /twitter\.com|x\.com/i,         label: 'X/Twitter' },
  { id: 'tiktok',   regex: /tiktok\.com|douyin\.com/i,     label: '抖音/TikTok' },
]

// 支持的本地视频扩展名（与 vision-perceptor 对齐）
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.avi', '.mov', '.mkv', '.webm',
  '.flv', '.wmv', '.m4v', '.3gp', '.mpeg',
  '.mpg', '.ts', '.mts',
])

// HLS 标识
const HLS_PATTERN = /\.m3u8(\?|$)/i

// ── Source 解析器（统一入口） ─────────────────────────────────────────
export function detectSource(input = '') {
  if (!input || typeof input !== 'string') return { kind: 'unknown', valid: false, error: 'source 必须是非空字符串' }
  const trimmed = input.trim()
  // mock:// 协议：测试用，无 IO
  if (/^mock:\/\//i.test(trimmed)) {
    return { kind: 'mock', valid: true, url: trimmed, path: trimmed }
  }
  // streaming: m3u8 协议
  if (HLS_PATTERN.test(trimmed) || /^https?:\/\/.*\.m3u8/i.test(trimmed)) {
    return { kind: 'streaming', valid: true, url: trimmed }
  }
  // url-public: 任何 http(s) URL
  if (/^https?:\/\//i.test(trimmed)) {
    const platform = PLATFORM_PATTERNS.find(p => p.regex.test(trimmed))
    return { kind: 'url-public', valid: true, url: trimmed, platform: platform?.id || 'unknown', platformLabel: platform?.label || '公开网' }
  }
  // local: 任意 /Users/... ~/... /tmp/... 或 file:// 路径
  if (trimmed.startsWith('file://') || trimmed.startsWith('/') || trimmed.startsWith('~') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    const path = trimmed.startsWith('file://') ? trimmed.replace('file://', '') : trimmed
    return { kind: 'local', valid: true, path, exists: existsSync(path) }
  }
  // 也接受纯文件名（无扩展名判定能力时）— 退化为 local
  return { kind: 'local', valid: true, path: trimmed, exists: existsSync(trimmed) }
}

// ── local provider ───────────────────────────────────────────────────
async function loadLocal(source) {
  const path = source.path
  if (!existsSync(path)) {
    throw new Error(`本地视频不存在: ${path}`)
  }
  const stat = statSync(path)
  if (stat.size > 2 * 1024 * 1024 * 1024) {
    throw new Error(`本地视频过大（${(stat.size / 1024 / 1024).toFixed(0)}MB > 2GB 上限）`)
  }
  // 找扩展名
  const ext = (path.match(/\.[^./\\]+$/) || [''])[0].toLowerCase()
  if (!VIDEO_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的视频扩展名: ${ext}（支持：${[...VIDEO_EXTENSIONS].join(', ')}）`)
  }
  // 算 source 唯一 id
  const statHash = createHash('sha256').update(`${path}::${stat.size}::${stat.mtimeMs}`).digest('hex').slice(0, 12)
  return {
    kind: 'local',
    sourceId: `local::${statHash}`,
    path,
    size: stat.size,
    ext,
    title: path.split('/').pop(),
    platform: 'local',
  }
}

// ── url-public provider（默认 stub，不真爬） ──────────────────────────
async function loadUrlPublic(source) {
  if (process.env.GINA_VIDEO_YT_DLP !== '1') {
    // 默认 stub：返回元数据但不下载（避免版权 + 100MB 依赖）
    const platform = PLATFORM_PATTERNS.find(p => p.regex.test(source.url))
    return {
      kind: 'url-public',
      sourceId: `url::${createHash('sha256').update(source.url).digest('hex').slice(0, 12)}`,
      url: source.url,
      platform: platform?.id || 'unknown',
      platformLabel: platform?.label || '公开网',
      title: `[stub] ${platform?.label || '公开网'} 视频`,
      durationSec: 0,
      stub: true,
      note: 'GINA_VIDEO_YT_DLP=1 启用真爬；当前为元数据 stub，不下载视频本体',
    }
  }
  // 真爬模式（未来实装）— 抛 not implemented
  throw new Error('url-public 真爬模式尚未实装（待 GINA_VIDEO_YT_DLP 集成 yt-dlp/youtube-dl-exec）')
}

// ── streaming provider（HLS m3u8） ─────────────────────────────────────
async function loadStreaming(source) {
  // 默认 stub：解析 m3u8 URL 不下载
  return {
    kind: 'streaming',
    sourceId: `stream::${createHash('sha256').update(source.url).digest('hex').slice(0, 12)}`,
    url: source.url,
    title: `[HLS stream] ${source.url.split('/').pop()}`,
    protocol: 'hls',
    durationSec: 0,
    stub: true,
    note: 'HLS 流通常为直播/长视频，处理需分片；当前为元数据 stub',
  }
}

// ── mock provider（测试用） ──────────────────────────────────────────
async function loadMock(source) {
  return {
    kind: 'mock',
    sourceId: `mock::${createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 12)}`,
    path: source.path || source.url || 'mock://fixture',
    size: source.size || 1024 * 1024,
    ext: '.mp4',
    title: source.title || 'Mock Video',
    durationSec: source.durationSec || 30,
    mock: true,
  }
}

// ── 统一 adapter ─────────────────────────────────────────────────────
export async function loadSource(input) {
  const detected = detectSource(input)
  if (!detected.valid) {
    throw new Error(detected.error || `无法识别 source: ${input}`)
  }
  if (detected.kind === 'local') return loadLocal(detected)
  if (detected.kind === 'url-public') return loadUrlPublic(detected)
  if (detected.kind === 'streaming') return loadStreaming(detected)
  if (detected.kind === 'mock') return loadMock(detected)
  throw new Error(`未知 source kind: ${detected.kind}`)
}

// ── 批量列举（用于 UI 端搜索本地视频） ───────────────────────────────
export async function listLocalVideos({ dir = '~/Movies', limit = 20, recursive = false } = {}) {
  const { promises: fs } = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const expanded = dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir
  if (!existsSync(expanded)) return { ok: false, error: `目录不存在: ${expanded}`, videos: [] }
  const out = []
  async function walk(dirPath, depth) {
    if (out.length >= limit) return
    if (depth > (recursive ? 3 : 0)) return
    let entries = []
    try { entries = await fs.readdir(dirPath, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= limit) return
      const full = path.join(dirPath, e.name)
      if (e.isDirectory()) {
        if (recursive) await walk(full, depth + 1)
        continue
      }
      if (!e.isFile()) continue
      const ext = path.extname(e.name).toLowerCase()
      if (!VIDEO_EXTENSIONS.has(ext)) continue
      try {
        const st = await fs.stat(full)
        out.push({ path: full, name: e.name, size: st.size, ext, mtime: st.mtimeMs })
      } catch {}
    }
  }
  await walk(expanded, 0)
  return { ok: true, dir: expanded, count: out.length, videos: out }
}

// ── 测试钩子 ────────────────────────────────────────────────────────
export const __test = {
  detectSource,
  PLATFORM_PATTERNS,
  VIDEO_EXTENSIONS,
  HLS_PATTERN,
}

export default {
  VIDEO_SOURCES,
  detectSource,
  loadSource,
  listLocalVideos,
  __test,
}
