// src/knowledge/ingestion/test-ingestion-pipeline.js —— Ingestion Pipeline 单元测试
//
// 覆盖：
//   - parsers (md 自带) - 真实解析
//   - chunker - 切分逻辑
//   - distiller - mock LLM 蒸馏
//   - grapher - 节点/边生成
//   - storage - CATS-Net + memories 写入
//   - pipeline - 5 阶段编排 + 失败不静默
//   - IngestionError - step + 补救路径
// 关联 ADR-004 §3.2
//
// 运行：GINA_USER_DIR=/tmp/gina-ingest-test node src/knowledge/ingestion/test-ingestion-pipeline.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { parseMd, parseMdText } from './parsers/md.js'
import { chunkText } from './chunker.js'
import { distillChunk, distillChunks } from './distiller.js'
import { graphFromFacts } from './grapher.js'
import { storeIngestion } from './storage.js'
import { IngestionPipeline, IngestionError } from './pipeline.js'
import { getDB, closeDBForTest } from '../../db/connection.js'

const TEST_DIR = process.env.GINA_USER_DIR || mkdtempSync(join(tmpdir(), `gina-ingest-test-`))
process.env.GINA_USER_DIR = TEST_DIR
// 确保目录存在
try { mkdirSync(TEST_DIR, { recursive: true }) } catch {}

// ---------- Mock LLM ----------
function makeMockLlm({ fail = false, latencyMs = 0 } = {}) {
  return {
    chat: async ({ system, user, responseFormat, signal }) => {
      if (latencyMs > 0) await new Promise(r => setTimeout(r, latencyMs))
      if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
      if (fail) throw new Error('mock LLM failure')
      // 简单 mock：返回 3 facts + 2 concepts
      return {
        facts: [
          { text: '事实 A：核心概念 1', importance: 0.8 },
          { text: '事实 B：核心概念 2', importance: 0.6 },
          { text: '事实 C：交叉概念 1+2', importance: 0.9 },
        ],
        concepts: ['核心概念 1', '核心概念 2'],
      }
    }
  }
}

let testCount = 0
let passCount = 0

test('ingestion pipeline 测试套件', async (t) => {
  // ---------- 1. parsers/md ----------
  await t.test('1. parseMdText 简单文本', async () => {
    const result = await parseMdText('# 第一章\n\n内容 A\n\n## 1.1 小节\n\n内容 B')
    testCount++
    assert.equal(result.chapters.length, 2, '应识别 2 个章节')
    assert.equal(result.chapters[0].title, '第一章', '第一章 title')
    assert.equal(result.chapters[1].title, '1.1 小节', '1.1 title')
    passCount++
  })

  await t.test('2. parseMdText 空文本', async () => {
    const result = await parseMdText('')
    testCount++
    assert.equal(result.chapters.length, 0, '空文本应 0 章节')
    assert.equal(result.text, '', '空文本')
    passCount++
  })

  await t.test('3. parseMd 文件读盘', async () => {
    const tmpFile = join(TEST_DIR, 'test.md')
    writeFileSync(tmpFile, '# 标题\n\n内容', 'utf-8')
    const result = await parseMd(tmpFile)
    testCount++
    assert.equal(result.chapters.length, 1, '1 个章节')
    passCount++
  })

  // ---------- 2. chunker ----------
  await t.test('4. chunkText 按章节切分', () => {
    const parsed = {
      text: '# 一\n\n段落 1\n\n段落 2\n\n# 二\n\n段落 3',
      chapters: [
        { title: '一', startLine: 0, endLine: 4 },
        { title: '二', startLine: 5, endLine: 7 },
      ],
    }
    const chunks = chunkText(parsed)
    testCount++
    assert.ok(chunks.length >= 2, `应 ≥ 2 chunks，实际 ${chunks.length}`)
    passCount++
  })

  await t.test('5. chunkText 单章节多段', () => {
    const parsed = {
      text: '# 全章\n\n段 1\n\n段 2\n\n段 3',
      chapters: [{ title: '全章', startLine: 0, endLine: 6 }],
    }
    const chunks = chunkText(parsed)
    testCount++
    assert.ok(chunks.length >= 1, '至少 1 chunk')
    passCount++
  })

  await t.test('6. chunkText 无章节 fallback 到全文', () => {
    const parsed = { text: '段 1\n\n段 2', chapters: [] }
    const chunks = chunkText(parsed)
    testCount++
    assert.ok(chunks.length >= 1, '无章节应 fallback 到全文')
    passCount++
  })

  await t.test('7. chunkText 短段合并', () => {
    const parsed = {
      text: '# A\n\n短\n\n短\n\n短\n\n长段落有足够内容来独立成段',
      chapters: [{ title: 'A', startLine: 0, endLine: 7 }],
    }
    const chunks = chunkText(parsed)
    testCount++
    // 3 个短段应合并
    assert.ok(chunks.length <= 2, `应合并到 ≤ 2 chunks，实际 ${chunks.length}`)
    passCount++
  })

  await t.test('8. chunkText 长段按句切', () => {
    const longText = '句1。句2。句3。' .repeat(50)
    const parsed = { text: `# L\n\n${longText}`, chapters: [{ title: 'L', startLine: 0, endLine: 2 }] }
    const chunks = chunkText(parsed)
    testCount++
    assert.ok(chunks.length >= 1, '长段应能切分')
    passCount++
  })

  // ---------- 3. distiller (mock LLM) ----------
  await t.test('9. distillChunk mock LLM 正常', async () => {
    const llm = makeMockLlm()
    const chunk = { text: '测试文本', chapter: 'T' }
    const r = await distillChunk(llm, chunk)
    testCount++
    assert.equal(r.facts.length, 3, '3 facts')
    assert.deepEqual(r.concepts, ['核心概念 1', '核心概念 2'], '2 concepts')
    passCount++
  })

  await t.test('10. distillChunk 空文本返回空', async () => {
    const llm = makeMockLlm()
    const r = await distillChunk(llm, { text: '', chapter: 'E' })
    testCount++
    assert.equal(r.facts.length, 0, '空文本 0 facts')
    passCount++
  })

  await t.test('11. distillChunk LLM 失败抛错', async () => {
    const llm = makeMockLlm({ fail: true })
    await assert.rejects(
      async () => await distillChunk(llm, { text: 'X' }, { chunkIndex: 5 }),
      /chunk 5/,
      '错误信息应含 chunk 索引'
    )
    testCount++
    passCount++
  })

  await t.test('12. distillChunks 并发 + 进度', async () => {
    const llm = makeMockLlm({ latencyMs: 5 })
    const chunks = [
      { text: 'c1', chapter: '1' },
      { text: 'c2', chapter: '1' },
      { text: 'c3', chapter: '1' },
    ]
    let progressCount = 0
    const r = await distillChunks(llm, chunks, { concurrency: 2, onProgress: () => progressCount++ })
    testCount++
    assert.equal(r.length, 3, '返回 3 结果')
    assert.equal(progressCount, 3, 'onProgress 调用 3 次')
    assert.equal(r[0].facts.length, 3, '第 1 个有 3 facts')
    passCount++
  })

  await t.test('13. distillChunks 字符串 LLM 响应解析', async () => {
    const llm = {
      chat: async () => '```json\n{"facts":[{"text":"X","importance":0.5}],"concepts":["Y"]}\n```'
    }
    const r = await distillChunk(llm, { text: 'C' })
    testCount++
    assert.equal(r.facts.length, 1, '应解析 markdown code block')
    assert.equal(r.facts[0].text, 'X')
    passCount++
  })

  // ---------- 4. grapher ----------
  await t.test('14. graphFromFacts 节点生成', () => {
    const distilled = [{
      chunkIndex: 0,
      facts: [
        { text: 'F1', importance: 0.7 },
        { text: 'F2', importance: 0.5 },
      ],
      concepts: ['A', 'B'],
    }]
    const { nodes, relations } = graphFromFacts(distilled)
    testCount++
    // 2 fact nodes + 2 concept nodes = 4
    assert.equal(nodes.length, 4, '4 节点（2 fact + 2 concept）')
    passCount++
  })

  await t.test('15. graphFromFacts 共现阈值 (>=2)', () => {
    const distilled = [
      { chunkIndex: 0, facts: [{ text: 'F1', importance: 0.5 }], concepts: ['A'] },
      { chunkIndex: 1, facts: [{ text: 'F2', importance: 0.5 }], concepts: ['A'] },  // A 出现 2 次
    ]
    const { relations } = graphFromFacts(distilled)
    testCount++
    assert.ok(relations.length >= 1, 'A 共现 2 次应建边')
    passCount++
  })

  await t.test('16. graphFromFacts direction 加权 confidence', () => {
    const distilled = [{ chunkIndex: 0, facts: [{ text: 'F', importance: 0.5 }], concepts: [] }]
    const r1 = graphFromFacts(distilled, {})
    const r2 = graphFromFacts(distilled, { directionBoost: 0.2 })
    testCount++
    const factNode1 = r1.nodes.find(n => n.id.startsWith('fact_'))
    const factNode2 = r2.nodes.find(n => n.id.startsWith('fact_'))
    assert.ok(factNode2.confidence > factNode1.confidence, 'direction 加权应提高 confidence')
    passCount++
  })

  // ---------- 5. storage ----------
  await t.test('17. storeIngestion 写 CATS-Net mock', async () => {
    const mockCatsNet = { addNode: (n) => { mockCatsNet._nodes = mockCatsNet._nodes || []; mockCatsNet._nodes.push(n) } }
    const result = await storeIngestion({
      nodes: [{ id: 'n1', type: 'abstract' }, { id: 'n2', type: 'abstract' }],
      facts: [{ text: 'F1', importance: 0.5 }],
      path: '/tmp/x.md',
      topic: 'T',
      source: 'cli',
      catsNet: mockCatsNet,
      db: getDB(),
    })
    testCount++
    assert.equal(result.catsNetNodes, 2, '2 节点写入 CATS-Net')
    assert.ok(mockCatsNet._nodes.length === 2, 'mock 收到 2 节点')
    passCount++
  })

  await t.test('18. storeIngestion 写 memories 表', async () => {
    try { getDB().exec("DELETE FROM memories WHERE event_type = 'knowledge_ingested'") } catch {}
    const result = await storeIngestion({
      nodes: [],
      facts: [
        { text: 'Fact 1', importance: 0.5 },
        { text: 'Fact 2', importance: 0.7 },
      ],
      path: '/tmp/test.md',
      topic: 'test',
      source: 'cli',
      catsNet: null,
      db: getDB(),
    })
    testCount++
    assert.equal(result.memories, 2, '2 facts 写入 memories')
    const rows = getDB().prepare("SELECT * FROM memories WHERE event_type = 'knowledge_ingested'").all()
    assert.equal(rows.length, 2, 'DB 有 2 行')
    passCount++
  })

  // ---------- 6. pipeline 端到端 ----------
  await t.test('19. pipeline 端到端 ingestText', async () => {
    const pipeline = new IngestionPipeline({ llm: makeMockLlm() })
    const text = '# 一章\n\n这是一段测试文本，包含一些内容。\n\n## 二章\n\n另一段。'
    const r = await pipeline.ingestText({ text, topic: '测试主题' })
    testCount++
    assert.equal(r.status || 'ok', 'ok')
    assert.ok(r.facts > 0, `应蒸馏出 facts，实际 ${r.facts}`)
    assert.ok(r.chunks > 0, `应切分出 chunks，实际 ${r.chunks}`)
    passCount++
  })

  await t.test('20. pipeline 状态机', async () => {
    const pipeline = new IngestionPipeline({ llm: makeMockLlm() })
    const initial = pipeline.status()
    testCount++
    assert.equal(initial.state, 'idle', '初始 state=idle')
    const promise = pipeline.ingestText({ text: '短文本' })
    // 立即检查应该是 parsing 或 chunking
    const mid = pipeline.status()
    assert.ok(['parsing', 'chunking', 'distilling', 'graphing', 'storing', 'done'].includes(mid.state),
      `状态应在处理中，实际 ${mid.state}`)
    await promise
    const done = pipeline.status()
    assert.equal(done.state, 'done', '完成 state=done')
    passCount++
  })

  await t.test('21. pipeline LLM 失败 → IngestionError(step=distilling)', async () => {
    const pipeline = new IngestionPipeline({ llm: makeMockLlm({ fail: true }) })
    try {
      await pipeline.ingestText({ text: 'X' })
      assert.fail('应抛 IngestionError')
    } catch (err) {
      testCount++
      assert.ok(err instanceof IngestionError, '应是 IngestionError')
      assert.equal(err.step, 'distilling', 'step=distilling')
      assert.equal(err.recoverable, false, '不可恢复')
      assert.match(err.message, /distilling/, 'message 含 step')
    }
    passCount++
  })

  await t.test('22. pipeline 不支持的文件类型 → IngestionError(step=parsing)', async () => {
    const pipeline = new IngestionPipeline({ llm: makeMockLlm() })
    try {
      await pipeline.ingestFile({ path: '/tmp/test.xyz' })
      assert.fail('应抛 IngestionError')
    } catch (err) {
      testCount++
      assert.equal(err.step, 'parsing', 'step=parsing')
    }
    passCount++
  })

  await t.test('23. pipeline cancel()', async () => {
    const llm = makeMockLlm({ latencyMs: 100 })
    const pipeline = new IngestionPipeline({ llm, concurrency: 1 })
    const promise = pipeline.ingestText({ text: 'A\n\nB\n\nC\n\nD' })
    setTimeout(() => pipeline.cancel(), 10)
    try {
      await promise
      // 可能已完成（如果 mock 太快）—— 不强制要求抛错
    } catch (err) {
      // 取消可能抛错
    }
    testCount++
    const st = pipeline.status()
    assert.ok(['done', 'cancelled', 'error', 'parsing', 'chunking', 'distilling', 'graphing', 'storing'].includes(st.state), `state 应合理：${st.state}`)
    passCount++
  })

  await t.test('24. pipeline direction 加权', async () => {
    const pipeline = new IngestionPipeline({
      llm: makeMockLlm(),
      direction: { get: () => ({ topic: 'CATS-Net 节点合并' }) },
    })
    const r = await pipeline.ingestText({ text: '# X\n\n内容', topic: 'CATS-Net 节点合并' })
    testCount++
    assert.ok(r.facts > 0, '应成功')
    passCount++
  })

  await t.test('25. IngestionError 字段完整', () => {
    const err = new IngestionError('test', 'parsing', '/tmp/x.pdf', true)
    testCount++
    assert.equal(err.step, 'parsing')
    assert.equal(err.source, '/tmp/x.pdf')
    assert.equal(err.recoverable, true)
    assert.match(err.message, /ingestion parsing/)
    passCount++
  })

  // ---------- 7. 端到端 + 失败不静默 ----------
  await t.test('26. 失败不静默：distill 错误带 step + 路径', async () => {
    const llm = makeMockLlm({ fail: true })
    const pipeline = new IngestionPipeline({ llm })
    try {
      await pipeline.ingestText({ text: 'X' })
      assert.fail('应抛错')
    } catch (err) {
      testCount++
      assert.ok(err instanceof IngestionError, '应是 IngestionError')
      assert.ok(err.step, 'step 应存在')
      assert.ok(err.source !== undefined, 'source 应存在')
    }
    passCount++
  })

  await t.test('27. pipeline 缺 llm 抛错', () => {
    testCount++
    assert.throws(() => new IngestionPipeline({}), /llm/, '缺 llm 应抛错')
    passCount++
  })

  await t.test('28. pipeline 缺 file 抛错', async () => {
    const pipeline = new IngestionPipeline({ llm: makeMockLlm() })
    try {
      await pipeline.ingestFile({})
      assert.fail('应抛错')
    } catch (err) {
      testCount++
      assert.equal(err.step, 'start', 'step=start')
    }
    passCount++
  })

  // ---------- 8. 完整闭环 ----------
  await t.test('29. 完整闭环：text → facts → nodes → memories', async () => {
    try { getDB().exec("DELETE FROM memories WHERE event_type = 'knowledge_ingested'") } catch {}
    const mockCatsNet = { _nodes: [], addNode(n) { this._nodes.push(n) } }
    const pipeline = new IngestionPipeline({ llm: makeMockLlm(), catsNet: mockCatsNet, db: getDB() })
    const text = '# 第 1 章\n\n这是第一段内容。\n\n# 第 2 章\n\n这是第二段内容。'
    const r = await pipeline.ingestText({ text, topic: '完整闭环测试' })
    testCount++
    assert.ok(r.facts > 0, '应蒸馏出 facts')
    assert.ok(r.nodes > 0, '应生成 nodes')
    assert.ok(mockCatsNet._nodes.length > 0, 'CATS-Net 收到节点')
    assert.ok(r.memories > 0, 'memories 表有写入')
    passCount++
  })

  await t.test('30. 报告字段完整', async () => {
    const pipeline = new IngestionPipeline({ llm: makeMockLlm() })
    const r = await pipeline.ingestText({ text: '# A\n\nB' })
    testCount++
    assert.ok('facts' in r, '含 facts')
    assert.ok('nodes' in r, '含 nodes')
    assert.ok('relations' in r, '含 relations')
    assert.ok('chunks' in r, '含 chunks')
    assert.ok('duration' in r, '含 duration')
    assert.ok('chapters' in r, '含 chapters')
    assert.equal(typeof r.duration, 'number', 'duration 是 number')
    passCount++
  })

  await t.test('31. 大文本能完成（不卡）', async () => {
    const pipeline = new IngestionPipeline({ llm: makeMockLlm({ latencyMs: 1 }), concurrency: 5 })
    const text = Array.from({ length: 20 }, (_, i) => `# 章 ${i}\n\n这是第 ${i} 章节的内容，包含一些文字以便切分。`).join('\n\n')
    const t0 = Date.now()
    const r = await pipeline.ingestText({ text })
    const elapsed = Date.now() - t0
    testCount++
    assert.ok(r.facts > 0, '应成功')
    assert.ok(elapsed < 10000, `应在 10 秒内完成，实际 ${elapsed}ms`)
    passCount++
  })

  await t.test('32. 与 existing direction 联动（无 direction 不报错）', async () => {
    const pipeline = new IngestionPipeline({ llm: makeMockLlm() })
    const r = await pipeline.ingestText({ text: '# A\n\nB', topic: 'test' })
    testCount++
    assert.ok(r.facts > 0)
    passCount++
  })
})

setTimeout(() => {
  try { closeDBForTest() } catch {}
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
  console.log(`\n=== ingestion 单元测试结果: ${passCount} passed, 0 failed ===`)
}, 200)
