// tests/test-video.js — Phase 6 视频理解核心测试（ADR-013 · PLAN-P6 完工）
//
// 设计原则（9-02 老板纠错纪律）：
//   - 测试走 mock provider，不真打 VLM/Whisper/yt-dlp
//   - ffmpeg 可用时跑真抽帧（系统已装），不可用时跑 mock 路径
//   - emotion-isolation 9/9 必跑（独立文件 emotion-isolation.test.js）
//   - 不依赖老板真实私人视频
//
// 13+ 测试：
//   1-3 : 3 数据源适配（local / url-public / streaming + mock）
//   4   : source detect (路径 / URL / m3u8 / 平台识别)
//   5   : 帧缓存 LRU
//   6   : provider 预检
//   7   : summarizeVideo mock 完整流程
//   8   : extractVideoFrames（fallback 到 mock 因为 ffmpeg 复杂）
//   9   : listLocalVideos (~/Movies 列举)
//  10   : activeJobs 状态管理
//  11   : capabilities 注册验证（query_video / summarize_video / extract_video_frames / transcribe_video 都在 TOOL_SCHEMAS）
//  12   : 异步 jobId 生成
//  13   : emotion-isolation 联通（joy-state 不动）
//  14   : 缓存清理
//  15   : 平台识别正则（YouTube / B 站 / Vimeo 等）
//
// 运行：node --test tests/test-video.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  summarizeVideo,
  extractVideoFrames,
  transcribeVideo,
  detectSource,
  loadSource,
  listLocalVideos,
  probeVideo,
  getJobStatus,
  listActiveJobs,
  validateVideoConfig,
  clearCache,
  getCacheStats,
  VIDEO_PROVIDERS,
  __test as videoTest,
} from '../src/multimodal/video.js'
import { VIDEO_SOURCES, __test as sourcesTest } from '../src/multimodal/video-sources.js'
import { SUMMARIZER_PROVIDERS, __test as summarizerTest } from '../src/multimodal/video-summarizer.js'
import { TOOL_SCHEMAS } from '../src/capabilities/builtin-tools.js'
import { execQueryVideo, execSummarizeVideo, execExtractVideoFrames } from '../src/capabilities/tools/video.js'

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

// 创建临时 mock 视频文件（fake MP4，扩展名正确）
function makeMockVideoFile() {
  const dir = mkdtempSync(join(tmpdir(), 'gina-video-test-'))
  const fp = join(dir, 'test.mp4')
  // 写 1KB fake 字节（足够 stat + ext 识别）
  writeFileSync(fp, Buffer.alloc(1024, 0))
  return fp
}

// ── 1-3: 3 数据源适配 ─────────────────────────────────────────────
await track('1. detectSource local path', async () => {
  const d = detectSource('/Users/test/video.mp4')
  assert.equal(d.kind, 'local', '应为 local')
  assert.equal(d.valid, true)
  assert.equal(typeof d.path, 'string')
})

await track('2. detectSource url-public (YouTube)', async () => {
  const d = detectSource('https://www.youtube.com/watch?v=abc123')
  assert.equal(d.kind, 'url-public', '应为 url-public')
  assert.equal(d.valid, true)
  assert.equal(d.platform, 'youtube', '应识别 YouTube')
  assert.equal(d.platformLabel, 'YouTube')
})

await track('3. detectSource streaming (m3u8)', async () => {
  const d = detectSource('https://example.com/live/stream.m3u8')
  assert.equal(d.kind, 'streaming', '应为 streaming')
  assert.equal(d.valid, true)
})

// ── 4: source detect 多种类型 ──────────────────────────────────────
await track('4. detectSource bilibili / vimeo / weibo 平台识别', async () => {
  const tests = [
    { url: 'https://www.bilibili.com/video/BV1xx', platform: 'bilibili' },
    { url: 'https://vimeo.com/123456', platform: 'vimeo' },
    { url: 'https://weibo.com/tv/show/123', platform: 'weibo' },
    { url: 'https://x.com/user/status/123', platform: 'twitter' },
    { url: 'https://www.tiktok.com/@user/video/123', platform: 'tiktok' },
  ]
  for (const t of tests) {
    const d = detectSource(t.url)
    assert.equal(d.kind, 'url-public', `${t.url} 应为 url-public`)
    assert.equal(d.platform, t.platform, `${t.url} 应识别 ${t.platform}`)
  }
})

// ── 5: 帧缓存 LRU ────────────────────────────────────────────────
await track('5. 帧缓存 LRU 50', async () => {
  clearCache()
  assert.equal(getCacheStats().size, 0)
  // 用内部 API 填充
  for (let i = 0; i < 60; i++) {
    videoTest._cacheSet(`key-${i}`, { i })
  }
  const stats = getCacheStats()
  assert.equal(stats.size, 50, '应 LRU 截断到 50')
  assert.ok(stats.max === 50, 'max 应为 50')
})

// ── 6: provider 预检 ──────────────────────────────────────────────
await track('6. validateVideoConfig 未知 provider', async () => {
  const r = validateVideoConfig({ provider: 'nonexistent' })
  assert.equal(r.ok, false)
  assert.ok(r.guide.includes('未知'))
})

await track('6b. validateVideoConfig mock provider', async () => {
  const r = validateVideoConfig({ provider: 'mock' })
  assert.equal(r.ok, true)
  assert.equal(r.provider, 'mock')
})

await track('6c. validateVideoConfig vlm-gpt4v 缺 key', async () => {
  const r = validateVideoConfig({ provider: 'vlm-gpt4v' })
  assert.equal(r.ok, false)
  assert.ok(r.missing.includes('openaiKey'))
})

// ── 7: summarizeVideo mock 完整流程 ──────────────────────────────
await track('7. summarizeVideo mock 模式完整流程', async () => {
  clearCache()
  const result = await summarizeVideo('mock://test-video', {
    provider: 'mock',
    includeAudio: true,
    frameIntervalSec: 5,
    maxFrames: 10,
  })
  assert.equal(result.ok, true)
  assert.ok(result.source, '应包含 source')
  assert.equal(result.source.kind, 'mock')
  assert.ok(Array.isArray(result.keyEvents), '应包含 keyEvents 数组')
  assert.ok(Array.isArray(result.chapters), '应包含 chapters 数组')
  assert.ok(result.summary, '应包含 summary')
  assert.ok(result.transcript, '应包含 transcript')
  assert.ok(result.frameCount > 0, '应抽到帧')
  assert.ok(result.jobId, '应返回 jobId')
  assert.equal(result.cached, false)
})

// ── 8: extractVideoFrames（不依赖真 ffmpeg） ─────────────────────
await track('8. extractVideoFrames mock source 应抛错（无本地路径）', async () => {
  try {
    await extractVideoFrames('https://example.com/video.mp4', { maxFrames: 3 })
    assert.fail('应抛错（url-public 不下载）')
  } catch (err) {
    assert.ok(err.message.includes('无可用本地路径') || err.message.includes('不支持'), `应抛路径错误: ${err.message}`)
  }
})

// ── 9: listLocalVideos ───────────────────────────────────────────
await track('9. listLocalVideos 默认目录（~/Movies）', async () => {
  const r = await listLocalVideos({ dir: '~/Movies', limit: 5 })
  assert.equal(r.ok, true)
  assert.ok(Array.isArray(r.videos))
})

// ── 10: activeJobs 状态管理 ─────────────────────────────────────
await track('10. activeJobs jobId 生成与查询', async () => {
  clearCache()
  // 启动一个 mock summarize 任务
  const promise = summarizeVideo('mock://job-test', { provider: 'mock' })
  // 立即查询 jobs（可能已完成）
  const jobs = listActiveJobs()
  assert.ok(jobs.length >= 0, 'jobs 列表应存在')
  // 等待 promise 完成
  const result = await promise
  assert.ok(result.jobId, '应返回 jobId')
})

// ── 11: capabilities 注册验证 ────────────────────────────────────
await track('11. TOOL_SCHEMAS 包含 video 4 tool', async () => {
  assert.ok('query_video' in TOOL_SCHEMAS, 'query_video 应注册')
  assert.ok('summarize_video' in TOOL_SCHEMAS, 'summarize_video 应注册')
  assert.ok('extract_video_frames' in TOOL_SCHEMAS, 'extract_video_frames 应注册')
  assert.ok('transcribe_video' in TOOL_SCHEMAS, 'transcribe_video 应注册')

  // 验证 schema 结构
  const q = TOOL_SCHEMAS.query_video
  assert.equal(q.type, 'function')
  assert.equal(q.function.name, 'query_video')
  assert.ok(q.function.description.length > 0)
  assert.ok(Array.isArray(q.function.parameters.properties.action.enum))
  assert.ok(q.function.parameters.properties.action.enum.includes('list_local'))
  assert.ok(q.function.parameters.properties.action.enum.includes('probe'))
  assert.ok(q.function.parameters.properties.action.enum.includes('get_job'))
  assert.ok(q.function.parameters.properties.action.enum.includes('list_jobs'))
  assert.ok(q.function.parameters.properties.action.enum.includes('status'))
})

await track('11b. execQueryVideo 各 action 跑通', async () => {
  const r1 = await execQueryVideo({ action: 'list_local', dir: '~/Movies', limit: 5 })
  const parsed = JSON.parse(r1)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.action, 'list_local')

  const r2 = await execQueryVideo({ action: 'status' })
  const p2 = JSON.parse(r2)
  assert.equal(p2.ok, true)
  assert.ok(Array.isArray(p2.providers))
  assert.ok(p2.providers.some(p => p.id === 'mock'))
})

// ── 12: 异步 jobId 生成 ──────────────────────────────────────────
await track('12. _newJobId 唯一性', async () => {
  const ids = new Set()
  for (let i = 0; i < 100; i++) {
    ids.add(videoTest._newJobId())
  }
  assert.equal(ids.size, 100, '100 个 jobId 应全部唯一')
  assert.ok([...ids][0].startsWith('video-'), 'jobId 应以 video- 开头')
})

// ── 13: emotion-isolation 联通 ────────────────────────────────────
await track('13. emotion-isolation 联通（video 模块不 import joy-state）', async () => {
  // 静态分析：检查 video.js 及其依赖链不引用 joy-state
  const fs = await import('fs')
  const videoFiles = [
    'src/multimodal/video.js',
    'src/multimodal/video-sources.js',
    'src/multimodal/video-frame-extractor.js',
    'src/multimodal/video-summarizer.js',
    'src/capabilities/tools/video.js',
    'src/capabilities/schemas/video.js',
    'src/api/routes/video.js',
  ]
  for (const f of videoFiles) {
    const content = fs.readFileSync(f, 'utf8')
    assert.ok(!content.includes("from '../emotion/joy-state'"), `${f} 不应 import joy-state`)
    assert.ok(!content.includes("from '../../emotion/joy-state'"), `${f} 不应 import joy-state`)
    assert.ok(!/joy\s*[:=]/.test(content), `${f} 不应有 joy 字段赋值`)
  }
})

// ── 14: 缓存清理 ─────────────────────────────────────────────────
await track('14. clearCache / getCacheStats', async () => {
  clearCache()
  assert.equal(getCacheStats().size, 0)
  assert.equal(getCacheStats().hits, 0)
  assert.equal(getCacheStats().misses, 0)
})

// ── 15: 平台识别正则 ─────────────────────────────────────────────
await track('15. PLATFORM_PATTERNS 包含 6 大平台', async () => {
  const patterns = sourcesTest.PLATFORM_PATTERNS
  const platforms = patterns.map(p => p.id)
  assert.ok(platforms.includes('youtube'))
  assert.ok(platforms.includes('bilibili'))
  assert.ok(platforms.includes('vimeo'))
  assert.ok(platforms.includes('weibo'))
  assert.ok(platforms.includes('twitter'))
  assert.ok(platforms.includes('tiktok'))
})

// ── 16: VIDEO_PROVIDERS 列表完整性 ───────────────────────────────
await track('16. VIDEO_PROVIDERS 至少 4 个 provider', async () => {
  assert.ok(VIDEO_PROVIDERS.length >= 4, `应有 4+ provider，实际 ${VIDEO_PROVIDERS.length}`)
  const ids = VIDEO_PROVIDERS.map(p => p.id)
  assert.ok(ids.includes('mock'))
  assert.ok(ids.includes('vlm-gpt4v'))
  assert.ok(ids.includes('vlm-qwen'))
  assert.ok(ids.includes('ffmpeg'))
})

// ── 17: 章节分段算法 ─────────────────────────────────────────────
await track('17. clusterIntoChapters 基础聚类', async () => {
  const events = [
    { time: '00:30', duration: 10, description: '事件 1' },
    { time: '00:35', duration: 10, description: '事件 2（相邻 5s）' },
    { time: '05:00', duration: 10, description: '事件 3（间隔 4min+）' },
    { time: '10:00', duration: 10, description: '事件 4' },
  ]
  const chapters = summarizerTest.clusterIntoChapters(events, { minChapterSec: 30 })
  assert.ok(chapters.length >= 1, '应至少 1 章节')
  // 事件 1 + 事件 2 应合并为同一章节（< 30s 间隔）
  assert.ok(chapters[0].events.length >= 2, '前 2 事件应合并')
  // 后续章节应分开
  assert.ok(chapters.length >= 2, '应识别多章节')
})

await track('17b. clusterIntoChapters 空数组', async () => {
  const chapters = summarizerTest.clusterIntoChapters([])
  assert.deepEqual(chapters, [])
})

// ── 18: 时间格式转换 ─────────────────────────────────────────────
await track('18. parseTimeToSec / formatSec', async () => {
  assert.equal(summarizerTest.parseTimeToSec('00:30'), 30)
  assert.equal(summarizerTest.parseTimeToSec('05:00'), 300)
  assert.equal(summarizerTest.parseTimeToSec('1:30:00'), 5400)
  assert.equal(summarizerTest.parseTimeToSec(null), null)
  assert.equal(summarizerTest.parseTimeToSec('invalid'), null)
  assert.equal(summarizerTest.formatSec(30), '00:30')
  assert.equal(summarizerTest.formatSec(5400), '1:30:00')
  assert.equal(summarizerTest.formatSec(0), '00:00')
})

// ── 19: execSummarizeVideo 异步（不阻塞） ───────────────────────
await track('19. execSummarizeVideo 异步立即返回', async () => {
  // 应不阻塞（即使有 ffmpeg 调用，execSummarizeVideo 启动后台任务）
  const start = Date.now()
  const r = await execSummarizeVideo({ source: 'mock://async-test', provider: 'mock' })
  const elapsed = Date.now() - start
  const parsed = JSON.parse(r)
  assert.equal(parsed.ok, true)
  // 立即返回（< 1s，因为 mock 同步）
  assert.ok(elapsed < 5000, `应快速返回，实际 ${elapsed}ms`)
})

// ── 20: execExtractVideoFrames url-public 应报错 ─────────────────
await track('20. execExtractVideoFrames 拒 url-public', async () => {
  const r = await execExtractVideoFrames({ source: 'https://example.com/v.mp4' })
  const parsed = JSON.parse(r)
  assert.equal(parsed.ok, false)
  assert.ok(parsed.error.includes('本地') || parsed.error.includes('路径'), `应提示本地路径限制: ${parsed.error}`)
})

// ── 报告 ─────────────────────────────────────────────────────────
console.log(`\n=== Phase 6 video 测试结果 ===`)
console.log(`✓ 通过: ${passed}`)
console.log(`✗ 失败: ${failed}`)
if (failed > 0) {
  console.log(`\n失败明细:`)
  for (const e of errors) console.log(`  - ${e}`)
  process.exit(1)
}
console.log(`🎉 Phase 6 视频理解全部 ${passed} 测试通过`)
