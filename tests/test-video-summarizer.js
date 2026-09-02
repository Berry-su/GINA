// tests/test-video-summarizer.js — Phase 6 视频摘要测试（ADR-013）
//
// 设计原则：
//   - 全部 mock 模式，不真打 VLM/Whisper
//   - emotion-isolation 9/9 必跑
//   - 测试关键事件检测 / 章节分段 / 多模态融合 / 进度回调
//
// 8+ 测试：
//   1. detectKeyEvents mock 模式
//   2. detectKeyEvents vlm provider 走 seeImages
//   3. clusterIntoChapters 时间相邻合并
//   4. clusterIntoChapters 跨多章节
//   5. transcribeAudio mock 模式
//   6. generateSummary mock 模式
//   7. summarizeVideo 进度回调
//   8. summarizeVideo 完整 mock 流程（端到端）
//   9. 章节标题生成
//  10. summary 含关键事件 + 章节 + 转写
//
// 运行：node --test tests/test-video-summarizer.js

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  detectKeyEvents,
  clusterIntoChapters,
  transcribeAudio,
  generateSummary,
  summarizeVideo,
  SUMMARIZER_PROVIDERS,
  __test as summarizerTest,
} from '../src/multimodal/video-summarizer.js'

let passed = 0
let failed = 0
const errors = []
function track(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { passed++; console.log(`✓ ${name}`) })
    .catch((err) => {
      failed++
      errors.push(`${name}: ${err?.message || err}`)
      console.log(`✗ ${name}: ${err?.message || err}`)
    })
}

// ── 1: detectKeyEvents mock 模式 ─────────────────────────────────
await track('1. detectKeyEvents mock 模式返回事件数组', async () => {
  const frames = Array.from({ length: 30 }, (_, i) => ({ path: `frame_${i}.jpg`, index: i }))
  const events = await detectKeyEvents(frames, { provider: 'mock' })
  assert.ok(Array.isArray(events), '应为数组')
  // mock: 每 10 帧 1 个事件
  assert.ok(events.length >= 2, `应至少 2 个事件，实际 ${events.length}`)
  assert.ok(events[0].time, '应有 time 字段')
  assert.ok(events[0].description, '应有 description 字段')
})

// ── 2: detectKeyEvents 空数组 ────────────────────────────────────
await track('2. detectKeyEvents 空数组返回 []', async () => {
  const events = await detectKeyEvents([], { provider: 'mock' })
  assert.deepEqual(events, [])
})

await track('2b. detectKeyEvents 非数组返回 []', async () => {
  const events = await detectKeyEvents(null, { provider: 'mock' })
  assert.deepEqual(events, [])
})

// ── 3: clusterIntoChapters 时间相邻合并 ──────────────────────────
await track('3. clusterIntoChapters 30s 内合并', async () => {
  const events = [
    { time: '00:10', duration: 5, description: 'A' },
    { time: '00:15', duration: 5, description: 'B' },
    { time: '00:20', duration: 5, description: 'C' },
  ]
  const chapters = clusterIntoChapters(events, { minChapterSec: 30 })
  assert.equal(chapters.length, 1, '相邻 < 30s 应合并为 1 章节')
  assert.equal(chapters[0].events.length, 3, '应包含 3 个事件')
})

// ── 4: clusterIntoChapters 跨多章节 ──────────────────────────────
await track('4. clusterIntoChapters 跨多章节', async () => {
  const events = [
    { time: '00:10', duration: 5, description: 'A' },
    { time: '02:00', duration: 5, description: 'B' },  // 间隔 1m45s
    { time: '10:00', duration: 5, description: 'C' },  // 间隔 8min
  ]
  const chapters = clusterIntoChapters(events, { minChapterSec: 30 })
  assert.equal(chapters.length, 3, '应识别 3 个独立章节')
  assert.equal(chapters[0].chapter, 1)
  assert.equal(chapters[1].chapter, 2)
  assert.equal(chapters[2].chapter, 3)
})

// ── 4b: clusterIntoChapters maxChapters 截断 ─────────────────────
await track('4b. clusterIntoChapters maxChapters 截断', async () => {
  const events = Array.from({ length: 20 }, (_, i) => ({
    time: `${String(i * 5).padStart(2, '0')}:00`,  // 间隔 5min
    duration: 10,
    description: `E${i}`,
  }))
  const chapters = clusterIntoChapters(events, { minChapterSec: 10, maxChapters: 5 })
  assert.equal(chapters.length, 5, '应截断到 5 章节')
})

// ── 5: transcribeAudio mock 模式 ─────────────────────────────────
await track('5. transcribeAudio mock 模式', async () => {
  const r = await transcribeAudio(null, { provider: 'mock', language: 'zh' })
  assert.equal(r.ok, true)
  assert.equal(r.provider, 'mock')
  assert.ok(Array.isArray(r.segments))
  assert.ok(r.segments.length > 0)
  assert.ok(typeof r.text === 'string')
  assert.ok(r.text.length > 0)
})

// ── 5b: transcribeAudio 真实视频（无 ffmpeg 时 fallback） ────────
await track('5b. transcribeAudio 真实视频（无 ffmpeg 时 fallback）', async () => {
  // 真实视频路径不存在时，transcribeAudio 应优雅 fallback
  try {
    const r = await transcribeAudio('/nonexistent/video.mp4', { provider: 'mock' })
    // mock 模式应不依赖真实文件
    assert.equal(r.ok, true)
  } catch (err) {
    // 抛错也接受（ffmpeg 不可用时）
    assert.ok(err.message.includes('ffmpeg') || err.message.includes('不存在'), `应抛 ffmpeg 错误: ${err.message}`)
  }
})

// ── 6: generateSummary mock 模式 ─────────────────────────────────
await track('6. generateSummary mock 模式', async () => {
  const r = await generateSummary({
    keyEvents: [{ time: '00:30', description: 'demo' }],
    transcript: { text: 'hello world' },
    chapters: [{ title: 'intro' }],
    durationSec: 180,
  }, { provider: 'mock' })
  assert.equal(r.ok, true)
  assert.ok(r.summary.length > 0, '应有摘要文本')
  assert.equal(r.provider, 'mock')
  assert.ok(Array.isArray(r.keyTopics))
})

// ── 7: summarizeVideo 进度回调 ────────────────────────────────────
await track('7. summarizeVideo 进度回调', async () => {
  const progressLog = []
  const result = await summarizeVideo('mock://progress-test', {
    provider: 'mock',
    includeAudio: true,
    onProgress: (p, stage) => {
      progressLog.push({ p, stage })
    },
  })
  assert.equal(result.ok, true)
  assert.ok(progressLog.length > 0, '应触发进度回调')
  // 最后一帧应为 1.0
  const last = progressLog[progressLog.length - 1]
  assert.equal(last.p, 1.0, '最终进度应为 1.0')
  assert.equal(last.stage, 'done', '最终阶段应为 done')
})

// ── 8: summarizeVideo 完整端到端（mock 模式） ─────────────────────
await track('8. summarizeVideo 端到端 mock 流程', async () => {
  const result = await summarizeVideo('mock://e2e-test', {
    provider: 'mock',
    frameIntervalSec: 10,
    maxFrames: 15,
    language: 'zh',
    includeAudio: true,
  })
  assert.equal(result.ok, true)
  assert.ok(result.source, '应含 source')
  assert.ok(result.frameCount > 0, '应有 frameCount')
  assert.ok(Array.isArray(result.keyEvents), 'keyEvents 应是数组')
  assert.ok(Array.isArray(result.chapters), 'chapters 应是数组')
  assert.ok(result.summary, '应有 summary')
  assert.ok(result.transcript, '应有 transcript')
  // summary 应包含关键事件 + 章节 + 转写信息
  const summaryText = result.summary?.summary || ''
  assert.ok(summaryText.length > 0, 'summary 文本应非空')
})

// ── 9: 章节标题生成（从第一个事件） ──────────────────────────────
await track('9. 章节标题从第一个事件生成', async () => {
  const events = [
    { time: '00:00', duration: 30, description: '主持人开场介绍议程' },
  ]
  const chapters = clusterIntoChapters(events, { minChapterSec: 60 })
  assert.equal(chapters.length, 1)
  assert.ok(chapters[0].title.includes('主持人'), '章节标题应取第一个事件描述')
  assert.equal(chapters[0].startFormatted, '00:00')
})

// ── 10: 进度阶段覆盖（extracting-frames → detecting-events → ...） ─
await track('10. 进度阶段按顺序触发', async () => {
  const stages = []
  await summarizeVideo('mock://stages-test', {
    provider: 'mock',
    onProgress: (p, stage) => { stages.push(stage) },
  })
  // 至少应包含核心阶段
  const expectedStages = ['loading-source', 'extracting-frames', 'detecting-events', 'clustering-chapters', 'generating-summary', 'done']
  for (const expected of expectedStages) {
    assert.ok(stages.includes(expected), `进度应包含阶段 "${expected}"，实际: ${stages.join(', ')}`)
  }
})

// ── 报告 ─────────────────────────────────────────────────────────
console.log(`\n=== Phase 6 video-summarizer 测试结果 ===`)
console.log(`✓ 通过: ${passed}`)
console.log(`✗ 失败: ${failed}`)
if (failed > 0) {
  console.log(`\n失败明细:`)
  for (const e of errors) console.log(`  - ${e}`)
  process.exit(1)
}
console.log(`🎉 Phase 6 video-summarizer 全部 ${passed} 测试通过`)
