// src/multimodal/video-summarizer.js — 视频摘要引擎（ADR-013 · Phase 6）
//
// 职责：
//   1. VLM 串接（每 N 秒 1 关键帧 → Phase 1 vlm.js seeImages）
//   2. Whisper 转写（抽音频 → voice 服务）
//   3. 关键事件检测（VLM 提示"识别关键场景变化"）
//   4. 章节分段（聚类 + 标题生成）
//   5. 多模态融合（音频文字 + 视觉描述 → 摘要）
//
// 关键约束（C-4.3 红线）：
//   - emotion-isolation: 摘要只输出文本
//   - 不 import joy-state
//   - 复用 Phase 1 VLM/OCR，不重复实装
//   - mock 模式：不真打 VLM/Whisper，全 stub（默认）
//
// 设计取舍：
//   - LLM 融合步骤是可选的（没 LLM key 时只返回结构化数据）
//   - 关键事件检测走 VLM 提示（用 GPT-4o-vision 一次问多帧）
//   - 章节分段：基于场景变化的聚类，时间相邻 30s 内合并

import { seeImages } from './vlm.js'
import { extractFrames, extractAudio, cleanupTempFrames } from './video-frame-extractor.js'
import { loadSource } from './video-sources.js'

// ── Provider 配置 ─────────────────────────────────────────────────
export const SUMMARIZER_PROVIDERS = [
  { id: 'vlm-gpt4v',  label: 'GPT-4o-vision (Phase 1)', default: true,  requiresKey: 'openaiKey' },
  { id: 'vlm-qwen',   label: 'Qwen-VL 本地 stub (Phase 1)', default: false, requiresKey: null },
  { id: 'mock',       label: 'Mock 摘要（测试用）',       default: false, requiresKey: null },
]

// 默认参数
const DEFAULT_FRAME_INTERVAL_SEC = 30   // 每 30 秒抽 1 帧
const DEFAULT_MAX_FRAMES = 30            // 最多 30 帧
const DEFAULT_KEYFRAME_PROMPT = `分析这组视频帧，识别：
1. 关键事件（场景变化、重要动作、视觉重点）
2. 每个事件的开始时间和持续时间（格式: MM:SS）
3. 简短描述（每事件 1-2 句）
用 JSON 数组返回：[{"time": "MM:SS", "duration": 10, "description": "..."}]`

// ── 关键事件检测（VLM 串接） ─────────────────────────────────────
export async function detectKeyEvents(frames, { provider = null, prompt, creds = {}, concurrency = 3 } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) return []
  const framePaths = frames.map(f => f.path).filter(Boolean)
  if (framePaths.length === 0) return []

  if (provider === 'mock') {
    // mock: 模拟 3 个事件（每 10 帧 1 个）
    return framePaths.filter((_, i) => i % 10 === 0).map((_, idx) => ({
      time: `${String(idx * 5).padStart(2, '0')}:00`,
      duration: 30,
      description: `[mock] 关键事件 ${idx + 1}`,
    }))
  }

  // 串接 Phase 1 VLM：一次问多帧（GPT-4o-vision 支持多图）
  try {
    const usePrompt = prompt || DEFAULT_KEYFRAME_PROMPT
    const result = await seeImages(framePaths, usePrompt, { provider, creds })
    // 解析 VLM 返回的 JSON（VLM 可能返回 markdown 包裹）
    const text = Array.isArray(result) ? result[0]?.text : result?.text
    if (!text) return []
    const jsonMatch = text.match(/\[[\s\S]*?\]/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        return Array.isArray(parsed) ? parsed : []
      } catch {}
    }
    // 解析失败：返回原始描述
    return [{ time: '00:00', duration: 0, description: text.slice(0, 500) }]
  } catch (err) {
    console.warn('[video-summarizer] 关键事件检测失败:', err?.message || err)
    return []
  }
}

// ── 章节分段（聚类时间戳） ─────────────────────────────────────
export function clusterIntoChapters(keyEvents, { minChapterSec = 30, maxChapters = 10 } = {}) {
  if (!Array.isArray(keyEvents) || keyEvents.length === 0) return []
  // 按时间排序
  const sorted = [...keyEvents]
    .map(e => ({
      timeSec: parseTimeToSec(e.time),
      duration: e.duration || 0,
      description: e.description || '',
    }))
    .filter(e => e.timeSec != null)
    .sort((a, b) => a.timeSec - b.timeSec)
  if (sorted.length === 0) return []

  // 聚类：相邻 < minChapterSec 的事件合并
  const chapters = []
  let cur = { startSec: sorted[0].timeSec, endSec: sorted[0].timeSec + (sorted[0].duration || 30), events: [sorted[0]] }
  for (let i = 1; i < sorted.length; i++) {
    const ev = sorted[i]
    if (ev.timeSec - cur.endSec < minChapterSec) {
      cur.endSec = Math.max(cur.endSec, ev.timeSec + (ev.duration || 30))
      cur.events.push(ev)
    } else {
      chapters.push(cur)
      cur = { startSec: ev.timeSec, endSec: ev.timeSec + (ev.duration || 30), events: [ev] }
    }
  }
  chapters.push(cur)
  // 截断到 maxChapters
  return chapters.slice(0, maxChapters).map((c, i) => ({
    chapter: i + 1,
    startSec: c.startSec,
    endSec: c.endSec,
    startFormatted: formatSec(c.startSec),
    endFormatted: formatSec(c.endSec),
    title: c.events[0]?.description?.slice(0, 40) || `Chapter ${i + 1}`,
    events: c.events,
  }))
}

// ── 时间格式转换 ────────────────────────────────────────────────
function parseTimeToSec(t) {
  if (typeof t === 'number') return t
  if (typeof t !== 'string') return null
  const m = t.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return null
  if (m[3] != null) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
  return parseInt(m[1]) * 60 + parseInt(m[2])
}
function formatSec(sec) {
  if (sec == null) return '00:00'
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── 音频转写（Whisper 串接，stub） ──────────────────────────────
export async function transcribeAudio(videoPath, { language = 'auto', provider = 'mock' } = {}) {
  if (provider === 'mock') {
    return {
      ok: true,
      language: language === 'auto' ? 'zh' : language,
      segments: [
        { start: 0, end: 5, text: '[mock 字幕] 这是测试字幕 1' },
        { start: 5, end: 10, text: '[mock 字幕] 这是测试字幕 2' },
      ],
      text: '[mock 字幕] 这是测试字幕 1 [mock 字幕] 这是测试字幕 2',
      provider: 'mock',
    }
  }
  // 真转写留待 Phase 1 voice/whisper 集成
  try {
    const { extractAudio } = await import('./video-frame-extractor.js')
    const audio = await extractAudio(videoPath)
    // 真集成 Phase 1：transcribeAudioFile(audio.audioPath, language)
    return { ok: false, error: '真实 Whisper 转写尚未集成（默认 mock 模式）', audioPath: audio.audioPath }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

// ── 多模态融合（LLM 摘要生成） ─────────────────────────────────
export async function generateSummary({ keyEvents, transcript, chapters, durationSec }, { provider = 'mock', creds = {} } = {}) {
  if (provider === 'mock') {
    const eventCount = Array.isArray(keyEvents) ? keyEvents.length : 0
    const chapterCount = Array.isArray(chapters) ? chapters.length : 0
    const transcriptText = typeof transcript === 'string' ? transcript : transcript?.text || ''
    return {
      ok: true,
      summary: `[mock 摘要] 时长 ${formatSec(durationSec || 0)}，共 ${eventCount} 个关键事件、${chapterCount} 个章节。${
        transcriptText ? `音频转写：${transcriptText.slice(0, 100)}…` : ''}`,
      keyTopics: ['mock topic 1', 'mock topic 2'],
      provider: 'mock',
    }
  }
  // 真 LLM 融合：调 openai / claude
  try {
    const eventsText = (keyEvents || []).map(e => `[${e.time}] ${e.description}`).join('\n')
    const chaptersText = (chapters || []).map(c => `${c.startFormatted}-${c.endFormatted}: ${c.title}`).join('\n')
    const prompt = `请基于以下信息生成视频摘要：\n\n时长：${formatSec(durationSec || 0)}\n\n章节：\n${chaptersText}\n\n关键事件：\n${eventsText}\n\n音频转写：\n${typeof transcript === 'string' ? transcript : transcript?.text || ''}\n\n请用 200 字内总结视频主要内容。`
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
      }),
    })
    if (!resp.ok) throw new Error(`LLM ${resp.status}`)
    const data = await resp.json()
    return { ok: true, summary: data?.choices?.[0]?.message?.content || '', provider: 'openai' }
  } catch (err) {
    return { ok: false, error: `LLM 摘要失败: ${err?.message || err}` }
  }
}

// ── 统一 summarize API ──────────────────────────────────────────
export async function summarizeVideo(sourceInput, opts = {}) {
  const {
    frameIntervalSec = DEFAULT_FRAME_INTERVAL_SEC,
    maxFrames = DEFAULT_MAX_FRAMES,
    language = 'auto',
    includeAudio = true,
    provider = 'mock',
    creds = {},
    onProgress = null,  // (progress: 0-1, stage: string) => void
  } = opts

  const progress = (p, stage) => { if (typeof onProgress === 'function') { try { onProgress(p, stage) } catch {} } }

  // 1. 加载源
  progress(0.05, 'loading-source')
  const source = await loadSource(sourceInput)
  if (!source.path && provider !== 'mock') {
    throw new Error('当前 source 不支持处理（仅 mock 模式可用）')
  }

  // 2. 抽帧
  progress(0.15, 'extracting-frames')
  let frames = []
  if (source.path && source.kind !== 'mock') {
    try {
      const fr = await extractFrames(source.path, {
        strategy: 'interval',
        intervalSec: frameIntervalSec,
        maxFrames,
      })
      frames = fr.frames
    } catch (err) {
      console.warn('[video-summarizer] 抽帧失败:', err?.message || err)
    }
  } else {
    // mock 模式：构造虚拟帧
    frames = Array.from({ length: 10 }, (_, i) => ({
      index: i,
      path: null,
      contentHash: `mock_${i}`,
      timestampSec: i * frameIntervalSec,
      description: `[mock 帧 ${i + 1}]`,
    }))
  }

  // 3. 关键事件检测
  progress(0.40, 'detecting-events')
  const keyEvents = await detectKeyEvents(frames, { provider, creds })

  // 4. 音频转写（可选）
  progress(0.55, 'transcribing-audio')
  let transcript = null
  if (includeAudio && source.path) {
    transcript = await transcribeAudio(source.path, { language, provider: provider === 'mock' ? 'mock' : 'whisper' })
  } else if (includeAudio) {
    transcript = await transcribeAudio(null, { language, provider: 'mock' })
  }

  // 5. 章节分段
  progress(0.75, 'clustering-chapters')
  const chapters = clusterIntoChapters(keyEvents)

  // 6. 多模态融合摘要
  progress(0.85, 'generating-summary')
  const summary = await generateSummary({
    keyEvents,
    transcript,
    chapters,
    durationSec: source.durationSec || (frames.length * frameIntervalSec),
  }, { provider, creds })

  progress(1.0, 'done')

  // 7. 清理临时帧
  if (frames.some(f => f.path && f.path.includes('gina-video-frames-'))) {
    try { await cleanupTempFrames() } catch {}
  }

  return {
    ok: true,
    source: {
      kind: source.kind,
      title: source.title,
      platform: source.platform,
      durationSec: source.durationSec || null,
    },
    frameCount: frames.length,
    keyEvents,
    chapters,
    transcript,
    summary,
    provider,
    timestamp: Date.now(),
  }
}

// ── 测试钩子 ────────────────────────────────────────────────────
export const __test = {
  parseTimeToSec,
  formatSec,
  clusterIntoChapters,
  DEFAULT_FRAME_INTERVAL_SEC,
  DEFAULT_KEYFRAME_PROMPT,
}

export default {
  SUMMARIZER_PROVIDERS,
  detectKeyEvents,
  clusterIntoChapters,
  transcribeAudio,
  generateSummary,
  summarizeVideo,
  __test,
}
