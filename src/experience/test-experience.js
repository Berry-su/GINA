// src/experience/test-experience.js —— ExperienceLibrary 单元测试
//
// 覆盖：record / query / feedback / merge / 持久化 / CATS-Net 联动 / direction 加权
// 关联 ADR-004 §3.3
//
// 运行：GINA_USER_DIR=/tmp/gina-exp-test node src/experience/test-experience.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExperienceLibrary, getExperienceLibrary, resetExperienceLibraryForTest, EXPERIENCE_CONSTANTS } from './library.js'
import { getDB, closeDBForTest } from '../db/connection.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'

const TEST_DIR = process.env.GINA_USER_DIR || join(tmpdir(), `gina-exp-test-${Date.now()}-${process.pid}`)
process.env.GINA_USER_DIR = TEST_DIR

let testCount = 0
let passCount = 0
const failures = []

test('experience 单元测试套件', async (t) => {
  await t.test('1. 构造 + 默认 stats 0', () => {
    // 先清表
    try {
      getDB().exec('DELETE FROM experience')
    } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const stats = lib.stats()
    testCount++
    assert.equal(stats.total, 0, 'total = 0')
    assert.equal(stats.avgConfidence, 0, 'avgConfidence = 0')
    passCount++
  })

  await t.test('2. record 一条经验', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const id = lib.record({
      trigger: '用户问 "今天天气怎么样"',
      action: '调 getWeather 工具',
      result: '成功返回温度+湿度',
      learned: '对 TUI 渠道的天气查询应该直接调工具，不要问用户地点',
      confidence: 0.7,
      source: 'reflection',
      relatedConcepts: ['weather', 'tui_channel'],
    })
    testCount++
    assert.ok(Number.isInteger(id) && id > 0, `record 应返回正整数 id，实际 ${id}`)
    passCount++
  })

  await t.test('3. record 必填字段缺失静默', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const id1 = lib.record({ trigger: 'x' })  // 缺 action/result/learned
    const id2 = lib.record({})
    testCount++
    assert.equal(id1, -1, '缺字段应返回 -1')
    assert.equal(id2, -1, '空对象应返回 -1')
    passCount++
  })

  await t.test('4. record 重复 trigger 合并 use_count + 调权 confidence', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const id1 = lib.record({ trigger: 'T', action: 'A1', result: 'R1', learned: 'L1', confidence: 0.6 })
    const id2 = lib.record({ trigger: 'T', action: 'A2', result: 'R2', learned: 'L2', confidence: 0.8 })
    testCount++
    assert.equal(id1, id2, '同一 trigger 应合并到同一 row')
    const list = lib.list({ limit: 10 })
    assert.equal(list.length, 1, 'list 应只有 1 条')
    assert.equal(list[0].use_count, 2, 'use_count = 2')
    // 合并后 confidence: (0.6 * 1 + 0.8) / 2 = 0.7
    assert.ok(Math.abs(list[0].confidence - 0.7) < 0.001, `合并 confidence 应 ≈ 0.7，实际 ${list[0].confidence}`)
    passCount++
  })

  await t.test('5. query 精确匹配 trigger_sig', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    lib.record({ trigger: '用户问天气', action: 'getWeather', result: 'ok', learned: 'L1', confidence: 0.6 })
    lib.record({ trigger: '用户问新闻', action: 'getNews', result: 'ok', learned: 'L2', confidence: 0.7 })
    const results = lib.query({ currentContext: '用户问天气' })
    testCount++
    assert.equal(results.length, 1, '应匹配 1 条')
    assert.equal(results[0].trigger, '用户问天气', '匹配的 trigger 正确')
    passCount++
  })

  await t.test('6. query 关键词 LIKE fallback', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    lib.record({ trigger: '批量处理 CSV 文件', action: 'read_file', result: 'ok', learned: '大文件要分批', confidence: 0.5 })
    // 不同措辞但同关键词
    const results = lib.query({ currentContext: '我现在要处理一些 CSV 数据文件' })
    testCount++
    assert.ok(results.length >= 1, '关键词匹配应 ≥ 1 条')
    passCount++
  })

  await t.test('7. query minConfidence 过滤', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    lib.record({ trigger: 'low', action: 'a', result: 'r', learned: 'l', confidence: 0.2 })
    lib.record({ trigger: 'high', action: 'a', result: 'r', learned: 'l', confidence: 0.9 })
    const results = lib.query({ currentContext: 'low', minConfidence: 0.5 })
    testCount++
    // 精确匹配 low 但 confidence < 0.5 → 过滤掉
    // 关键词 fallback 也找不到
    assert.equal(results.length, 0, 'minConfidence 应过滤掉低 confidence')
    passCount++
  })

  await t.test('8. query limit 限制', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    for (let i = 0; i < 10; i++) {
      lib.record({ trigger: `场景_${i}`, action: 'a', result: 'r', learned: 'l', confidence: 0.5 })
    }
    const results = lib.query({ currentContext: '场景', limit: 3 })
    testCount++
    assert.ok(results.length <= 3, `query limit 应限制 ≤ 3，实际 ${results.length}`)
    passCount++
  })

  await t.test('9. feedback 强化 +confidence', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const id = lib.record({ trigger: 'F', action: 'a', result: 'r', learned: 'l', confidence: 0.5 })
    lib.feedback(id, { worked: true })
    const list = lib.list()
    testCount++
    assert.equal(list[0].feedback_pos, 1, 'feedback_pos = 1')
    assert.ok(list[0].confidence > 0.5, `强化后 confidence > 0.5，实际 ${list[0].confidence}`)
    passCount++
  })

  await t.test('10. feedback 弱化 -confidence', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const id = lib.record({ trigger: 'F', action: 'a', result: 'r', learned: 'l', confidence: 0.5 })
    lib.feedback(id, { worked: false })
    const list = lib.list()
    testCount++
    assert.equal(list[0].feedback_neg, 1, 'feedback_neg = 1')
    assert.ok(list[0].confidence < 0.5, `弱化后 confidence < 0.5，实际 ${list[0].confidence}`)
    passCount++
  })

  await t.test('11. feedback(worked=false, better=X) 记录新经验', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const id1 = lib.record({ trigger: 'F', action: 'a', result: 'r', learned: 'l', confidence: 0.5 })
    lib.feedback(id1, { worked: false, better: '更好的方案' })
    const list = lib.list()
    testCount++
    assert.equal(list.length, 2, '应有 2 条（1 弱化 + 1 better 新经验）')
    const better = list.find(e => e.action === 'better_approach')
    assert.ok(better, '应有 better_approach action 的新经验')
    passCount++
  })

  await t.test('12. feedback confidence clamp', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const id = lib.record({ trigger: 'F', action: 'a', result: 'r', learned: 'l', confidence: 0.9 })
    // 多次强化到 0.95 上限
    for (let i = 0; i < 5; i++) lib.feedback(id, { worked: true })
    const list = lib.list()
    testCount++
    assert.ok(list[0].confidence <= EXPERIENCE_CONSTANTS.CONFIDENCE_CEIL, `confidence 应 ≤ ${EXPERIENCE_CONSTANTS.CONFIDENCE_CEIL}，实际 ${list[0].confidence}`)
    passCount++
  })

  await t.test('13. direction 加权 relevance_score +0.2', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    lib.record({ trigger: 'CATS-Net 节点合并', action: 'addNode', result: 'ok', learned: 'L', confidence: 0.5 })
    const without = lib.query({ currentContext: 'CATS-Net 节点合并' })[0]
    const withDir = lib.query({ currentContext: 'CATS-Net 节点合并', directionTopic: 'CATS-Net' })[0]
    testCount++
    assert.ok(withDir, 'withDir 应有结果')
    assert.ok(Math.abs(withDir.relevance_score - without.relevance_score - 0.2) < 0.01,
      `direction 加权应 +0.2，差值: ${withDir.relevance_score - without.relevance_score}`)
    passCount++
  })

  await t.test('14. CATS-Net 联动 mock', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    // mock catsNet：getNode 返回带 bump 方法的对象
    const mockCatsNet = {
      getNode: (id) => id === 'foo' ? { bump: () => bumpCount++ } : null
    }
    let bumpCount = 0
    const lib = new ExperienceLibrary({ db: getDB(), catsNet: mockCatsNet })
    lib.record({ trigger: 'T', action: 'a', result: 'r', learned: 'l', confidence: 0.5, relatedConcepts: ['foo', 'bar'] })
    testCount++
    assert.equal(bumpCount, 1, 'foo 应被 bump 1 次，bar 找不到不 bump')
    passCount++
  })

  await t.test('15. 持久化：record 后新实例能读到', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib1 = new ExperienceLibrary({ db: getDB() })
    lib1.record({ trigger: '持久化测试', action: 'a', result: 'r', learned: 'l', confidence: 0.6 })
    const lib2 = new ExperienceLibrary({ db: getDB() })
    const list = lib2.list()
    testCount++
    assert.equal(list.length, 1, '新实例应读到 1 条')
    assert.equal(list[0].trigger, '持久化测试')
    passCount++
  })

  await t.test('16. 单例模式：getExperienceLibrary 同一实例', () => {
    resetExperienceLibraryForTest()
    const a = getExperienceLibrary()
    const b = getExperienceLibrary()
    testCount++
    assert.equal(a, b, 'getExperienceLibrary 应返回同一实例')
    passCount++
  })

  await t.test('17. stats 统计正确', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    lib.record({ trigger: 'A', action: 'a', result: 'r', learned: 'l', confidence: 0.5, source: 'reflection' })
    lib.record({ trigger: 'B', action: 'a', result: 'r', learned: 'l', confidence: 0.7, source: 'manual' })
    lib.record({ trigger: 'C', action: 'a', result: 'r', learned: 'l', confidence: 0.9, source: 'manual' })
    const stats = lib.stats()
    testCount++
    assert.equal(stats.total, 3, 'total = 3')
    assert.ok(Math.abs(stats.avgConfidence - 0.7) < 0.01, `avgConfidence 应 ≈ 0.7，实际 ${stats.avgConfidence}`)
    const manualCount = stats.bySource.find(s => s.source === 'manual')?.c || 0
    assert.equal(manualCount, 2, 'manual source 2 条')
    passCount++
  })

  await t.test('18. query 空 currentContext 返回空', () => {
    const lib = new ExperienceLibrary({ db: getDB() })
    const r1 = lib.query({ currentContext: '' })
    const r2 = lib.query({})
    testCount++
    assert.equal(r1.length, 0, '空字符串应返回空')
    assert.equal(r2.length, 0, 'undefined 应返回空')
    passCount++
  })

  await t.test('19. related_concepts JSON 序列化/反序列化', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    lib.record({ trigger: 'X', action: 'a', result: 'r', learned: 'l', confidence: 0.5, relatedConcepts: ['foo', 'bar', 'baz'] })
    const list = lib.list()
    testCount++
    assert.deepEqual(list[0].related_concepts, ['foo', 'bar', 'baz'], 'related_concepts 应正确反序列化')
    passCount++
  })

  await t.test('20. query 不重复返回（trigger_sig 重复时不出现多次）', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    // 录 3 次相同 trigger（合并到 1 条）
    for (let i = 0; i < 3; i++) {
      lib.record({ trigger: 'Same', action: 'a', result: 'r', learned: 'l', confidence: 0.5 })
    }
    const results = lib.query({ currentContext: 'Same' })
    testCount++
    assert.equal(results.length, 1, 'query 应不重复')
    passCount++
  })

  await t.test('21. EXPERIENCE_CONSTANTS 正确', () => {
    testCount++
    assert.equal(EXPERIENCE_CONSTANTS.SCHEMA_VERSION, 1)
    assert.equal(EXPERIENCE_CONSTANTS.DEFAULT_CONFIDENCE, 0.5)
    assert.equal(EXPERIENCE_CONSTANTS.CONFIDENCE_CEIL, 0.95)
    assert.equal(EXPERIENCE_CONSTANTS.CONFIDENCE_FLOOR, 0.1)
    passCount++
  })

  await t.test('22. embedding 字段可存 Buffer', () => {
    try { getDB().exec('DELETE FROM experience') } catch {}
    const lib = new ExperienceLibrary({ db: getDB() })
    const emb = new Float32Array([0.1, 0.2, 0.3, 0.4])
    const buf = Buffer.from(emb.buffer)
    const id = lib.record({ trigger: 'E', action: 'a', result: 'r', learned: 'l', confidence: 0.5, embedding: buf })
    testCount++
    assert.ok(id > 0, 'embedding 应能存入')
    passCount++
  })
})

setTimeout(() => {
  try { closeDBForTest() } catch {}
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
  console.log(`\n=== experience 单元测试结果: ${passCount} passed, ${failures.length} failed ===`)
  if (failures.length > 0) {
    failures.forEach((f, i) => console.error(`  [${i + 1}] ${f}`))
    process.exit(1)
  }
}, 200)
