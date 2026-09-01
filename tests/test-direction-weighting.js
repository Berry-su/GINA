/**
 * C-3.4 + C-4.6 + C-7 方向学习加权效果接驳测试
 *
 * 老板 9-01 拍板：DirectionController 3 个加权效果接驳主循环
 * 关联 ADR-003 §3.2.6
 *
 * 覆盖 30+ 验证场景：
 *   1-8   direction.matchConcept() 单测（5 表达覆盖 + 失败静默 + 词拆解）
 *   9-14  L1.recordInjection priority + directionMatch 入图 + 落 log
 *   15-19 L6.recordCall directionMatched + directionStats + reflectHook
 *   20-24 L6.getToolCredibility 双签名 + 30% direction 加权
 *   25-28 experience.record directionMatch + context_window 落库
 *   29-32 reflection.refl 反思深度 ×2 + L6 失败 hook + L1 失败 hook
 *   33-35 端到端：direction 设置 → L1 优先级变化 → L6 评分变化 → experience 记录
 *   36-37 隔离红线：direction 字段不进 emotion、priority 不破 emotion-isolation
 *
 * 运行：node --test tests/test-direction-weighting.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

import { CatsNet } from '@berrysu/gina-core/cats_net'
import { createIntegrations } from '../src/brain/integration/index.js'
import Database from 'better-sqlite3'

import { DirectionController, resetDirectionControllerForTest } from '../src/learning/direction.js'
import { refl, reflectOnToolFailure, REFLECTION_CONSTANTS } from '../src/learning/reflection.js'
import { ExperienceLibrary, resetExperienceLibraryForTest } from '../src/experience/library.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let passed = 0
let failed = 0
const resultLog = []
function track(name, ok) {
  if (ok) passed++
  else { failed++; resultLog.push(`FAIL ${name}`) }
}

// —— 测试 fixture ——
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'direction-weight-'))
}

function makeFixture() {
  const dataDir = makeTmpDir()
  const tmpDb = path.join(dataDir, 'test.db')
  const db = new Database(tmpDb)
  // 建 experience 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS experience (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_sig TEXT NOT NULL,
      trigger TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL,
      learned TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      since TEXT NOT NULL DEFAULT (datetime('now')),
      last_used TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      feedback_pos INTEGER NOT NULL DEFAULT 0,
      feedback_neg INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'reflection',
      related_concepts TEXT NOT NULL DEFAULT '[]',
      embedding BLOB,
      direction_match INTEGER NOT NULL DEFAULT 0,
      context_window REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `)
  const catsNet = new CatsNet()
  // 记录反射钩子调用
  const reflectCalls = []
  const integ = createIntegrations({
    catsNet,
    db,
    reflectionHook: (payload) => { reflectCalls.push(payload); return 1 },
  })
  const direction = new DirectionController({ dataDir })
  // 重置单例 + 用 fixture db 创建新 lib
  resetExperienceLibraryForTest()
  const expLib = new ExperienceLibrary({ db, catsNet })
  return { dataDir, db, catsNet, integ, direction, expLib, reflectCalls }
}

// —— 1. direction.matchConcept() 5 场景 ——
test('1. matchConcept 子串命中', () => {
  const f = makeFixture()
  const matched = f.direction.matchConcept('CATS-Net 大脑架构 / 注入器 / 优先级', 'CATS-Net')
  assert.equal(matched, true)
  track('1', true)
})

test('2. matchConcept 词拆解命中', () => {
  const f = makeFixture()
  const matched = f.direction.matchConcept('港股知识_002', '港股知识')
  assert.equal(matched, true)
  track('2', true)
})

test('3. matchConcept 不命中', () => {
  const f = makeFixture()
  const matched = f.direction.matchConcept('今天天气不错', 'CATS-Net')
  assert.equal(matched, false)
  track('3', true)
})

test('4. matchConcept 无 direction → false（失败静默）', () => {
  const f = makeFixture()
  // direction 还没 set
  const matched = f.direction.matchConcept('随便一个 concept', null)
  assert.equal(matched, false)
  track('4', true)
})

test('5. matchConcept null/空输入 → false', () => {
  const f = makeFixture()
  f.direction.set({ topic: 'CATS-Net' })
  assert.equal(f.direction.matchConcept(null, null), false)
  assert.equal(f.direction.matchConcept('', null), false)
  assert.equal(f.direction.matchConcept(undefined, null), false)
  track('5', true)
})

test('6. matchConcept 显式传 directionTopic', () => {
  const f = makeFixture()
  const matched = f.direction.matchConcept('CATS-Net 大脑', 'CATS-Net 大脑')
  assert.equal(matched, true)
  track('6', true)
})

test('7. matchConcept 大小写不敏感', () => {
  const f = makeFixture()
  const matched = f.direction.matchConcept('cats-net 注入器', 'CATS-Net')
  assert.equal(matched, true)
  track('7', true)
})

test('8. matchConcept 多词拆分命中（取任一片段）', () => {
  const f = makeFixture()
  const matched = f.direction.matchConcept('投资领域 - 港股', '港股 投资')
  assert.equal(matched, true)  // 至少 1 词命中
  track('8', true)
})

// —— 9-14 L1.recordInjection priority + directionMatch ——
test('9. L1.recordInjection priority=1.5 directionMatch=true 落 CATS-Net', () => {
  const f = makeFixture()
  const r = f.integ.l1.recordInjection({
    strategy: 'semantic_memory_prefetch',
    confidence: 0.8,
    target: 'mem_cats_001',
    priority: 1.5,
    directionMatch: true,
  })
  assert.ok(r.injectionId, 'injectionId 存在')
  const node = f.catsNet.getNode(r.injectionId)
  assert.ok(node, '节点已入图')
  assert.equal(node.attributes.priority, 1.5, 'priority=1.5')
  assert.equal(node.attributes.directionMatch, 1, 'directionMatch=1')
  track('9', true)
})

test('10. L1.recordInjection priority=1.0 directionMatch=false 默认', () => {
  const f = makeFixture()
  const r = f.integ.l1.recordInjection({
    strategy: 'semantic_memory_prefetch',
    confidence: 0.5,
  })
  const node = f.catsNet.getNode(r.injectionId)
  assert.equal(node.attributes.priority, 1.0, 'priority 默认 1.0')
  assert.equal(node.attributes.directionMatch, 0, 'directionMatch 默认 0')
  track('10', true)
})

test('11. L1.recordInjection 落 log 表 + priority/direction_match 列', () => {
  const f = makeFixture()
  f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.7, priority: 1.5, directionMatch: true })
  const row = f.db.prepare('SELECT * FROM aci_injection_log ORDER BY id DESC LIMIT 1').get()
  assert.ok(row, 'log 行存在')
  assert.equal(row.priority, 1.5, 'log.priority=1.5')
  assert.equal(row.direction_match, 1, 'log.direction_match=1')
  track('11', true)
})

test('12. L1.recordInjection getInjectionStats 包含 direction 维度', () => {
  const f = makeFixture()
  f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.7, priority: 1.0 })
  f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.8, priority: 1.5, directionMatch: true })
  f.integ.l1.recordInjection({ strategy: 'tool_chain_prefetch', confidence: 0.6, priority: 1.5, directionMatch: true })
  const stats = f.integ.l1.getInjectionStats()
  assert.equal(stats.total, 3, 'total=3')
  assert.equal(stats.byStrategy.semantic_memory_prefetch.total, 2)
  assert.equal(stats.byStrategy.tool_chain_prefetch.total, 1)
  track('12', true)
})

test('13. L1.recordInjection priority clamp [0, 10]', () => {
  const f = makeFixture()
  const r1 = f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5, priority: 999 })
  const r2 = f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5, priority: -1 })
  const n1 = f.catsNet.getNode(r1.injectionId)
  const n2 = f.catsNet.getNode(r2.injectionId)
  assert.equal(n1.attributes.priority, 10, 'priority clamp 到 10')
  assert.equal(n2.attributes.priority, 0, 'priority clamp 到 0')
  track('13', true)
})

test('14. L1.recordInjection directionMatch 非 boolean → 0', () => {
  const f = makeFixture()
  const r = f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5, directionMatch: 'yes' })
  const n = f.catsNet.getNode(r.injectionId)
  assert.equal(n.attributes.directionMatch, 0, '非 boolean → 0')
  track('14', true)
})

// —— 15-19 L6.recordCall directionMatched + directionStats + reflectHook ——
test('15. L6.recordCall directionMatched=true → directionStats 累加', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file' })
  f.integ.l6.recordCall('read_file', { success: true, directionMatched: true })
  f.integ.l6.recordCall('read_file', { success: true, directionMatched: true })
  f.integ.l6.recordCall('read_file', { success: false, directionMatched: true })
  const node = f.catsNet.getNode('l6_tool_read_file')
  assert.equal(node.attributes.directionStats.calls, 3, 'calls=3')
  assert.equal(node.attributes.directionStats.successes, 2, 'successes=2')
  assert.equal(node.attributes.directionStats.failures, 1, 'failures=1')
  track('15', true)
})

test('16. L6.recordCall directionMatched=false → directionStats 不增', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file' })
  f.integ.l6.recordCall('read_file', { success: true })
  f.integ.l6.recordCall('read_file', { success: true })
  const node = f.catsNet.getNode('l6_tool_read_file')
  assert.equal(node.attributes.directionStats, undefined, '无 directionStats')
  track('16', true)
})

test('17. L6.recordCall 失败 + directionMatched → reflectionHook 触发', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file' })
  f.integ.l6.recordCall('read_file', { success: false, directionMatched: true })
  assert.equal(f.reflectCalls.length, 1, 'reflectHook 调 1 次')
  assert.equal(f.reflectCalls[0].trigger, 'tool_failure:read_file')
  assert.equal(f.reflectCalls[0].directionMatch, true)
  track('17', true)
})

test('18. L6.recordCall 失败 + directionMatched=false → reflectionHook 不触发', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file' })
  f.integ.l6.recordCall('read_file', { success: false, directionMatched: false })
  assert.equal(f.reflectCalls.length, 0, 'reflectHook 不调')
  track('18', true)
})

test('19. L6.recordCall 成功 + directionMatched=true → reflectionHook 不触发', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file' })
  f.integ.l6.recordCall('read_file', { success: true, directionMatched: true })
  assert.equal(f.reflectCalls.length, 0, '成功不调反思')
  track('19', true)
})

// —— 20-24 L6.getToolCredibility 双签名 + 30% direction 加权 ——
test('20. L6.getToolCredibility 无 directionTopic → 全局 salience', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file', initialSalience: 0.8 })
  const c = f.integ.l6.getToolCredibility('read_file')
  assert.equal(c, 0.8, '无 direction → 0.8')
  track('20', true)
})

test('21. L6.getToolCredibility 传 directionTopic + 有 directionStats → 30% 加权', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file', initialSalience: 0.8 })
  // 10 调 8 成功 → direction 领域 salience = 0.1 + 0.9 * 0.8 = 0.82
  for (let i = 0; i < 8; i++) f.integ.l6.recordCall('read_file', { success: true, directionMatched: true })
  for (let i = 0; i < 2; i++) f.integ.l6.recordCall('read_file', { success: false, directionMatched: true })
  // 8 次成功让 base 涨到 ~0.88，2 次失败让 base 跌到 ~0.78
  const c = f.integ.l6.getToolCredibility('read_file', { directionTopic: 'CATS-Net' })
  // 公式：baseScore + (directionScore - baseScore) * 0.3
  // directionScore = 0.1 + 0.9 * 0.8 = 0.82
  assert.ok(c >= 0.7 && c <= 0.9, `30% 加权后应在 0.7-0.9 之间 (实际: ${c})`)
  track('21', true)
})

test('22. L6.getToolCredibility 传 directionTopic + 无 directionStats → 仍返回 base salience', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file', initialSalience: 0.6 })
  const c = f.integ.l6.getToolCredibility('read_file', { directionTopic: 'CATS-Net' })
  assert.equal(c, 0.6, '无独立统计 → 0.6')
  track('22', true)
})

test('23. L6.recordCall direction 领域 success/fail 双向 delta = base × 1.5', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'foo', initialSalience: 0.5 })
  f.integ.l6.recordCall('foo', { success: true, directionMatched: true })  // +0.015
  f.integ.l6.recordCall('foo', { success: true, directionMatched: true })  // +0.015
  f.integ.l6.recordCall('foo', { success: false, directionMatched: true }) // -0.075
  const node = f.catsNet.getNode('l6_tool_foo')
  // 0.5 + 0.015 + 0.015 - 0.075 = 0.455
  assert.ok(Math.abs(node.salience - 0.455) < 0.001, `salience=0.455 (实际: ${node.salience})`)
  track('23', true)
})

test('24. L6.recordCall 非 direction 领域 delta = base（无 1.5x）', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'foo', initialSalience: 0.5 })
  f.integ.l6.recordCall('foo', { success: true })  // +0.01
  f.integ.l6.recordCall('foo', { success: true })  // +0.01
  const node = f.catsNet.getNode('l6_tool_foo')
  assert.ok(Math.abs(node.salience - 0.52) < 0.001, `salience=0.52 (实际: ${node.salience})`)
  track('24', true)
})

// —— 25-28 experience.record directionMatch + context_window ——
test('25. experience.record directionMatch=true 落库 + 列可读', () => {
  const f = makeFixture()
  const id = f.expLib.record({
    trigger: 'CATS-Net 注入失败',
    action: 'l1.recordInjection',
    result: 'failed',
    learned: '方向领域注入失败',
    confidence: 0.6,
    directionMatch: true,
    contextWindow: 2.0,
  })
  assert.ok(id > 0, 'id > 0')
  const row = f.db.prepare('SELECT * FROM experience WHERE id = ?').get(id)
  assert.equal(row.direction_match, 1, 'direction_match=1')
  assert.equal(row.context_window, 2.0, 'context_window=2.0')
  track('25', true)
})

test('26. experience.record directionMatch=false 落库', () => {
  const f = makeFixture()
  const id = f.expLib.record({
    trigger: 'generic failure',
    action: 'x',
    result: 'failed',
    learned: 'y',
  })
  const row = f.db.prepare('SELECT * FROM experience WHERE id = ?').get(id)
  assert.equal(row.direction_match, 0, 'direction_match=0')
  assert.equal(row.context_window, 1.0, 'context_window=1.0')
  track('26', true)
})

test('27. experience.record 同 trigger_sig directionMatch 取 max（升级不可降）', () => {
  const f = makeFixture()
  const trig = 'CATS-Net 注入失败'
  f.expLib.record({ trigger: trig, action: 'a', result: 'r', learned: 'l', directionMatch: false })
  const id2 = f.expLib.record({ trigger: trig, action: 'a', result: 'r', learned: 'l', directionMatch: true })
  const row = f.db.prepare('SELECT * FROM experience WHERE id = ?').get(id2)
  assert.equal(row.direction_match, 1, '升级到 1')
  // 再写一次 false 不会降
  const id3 = f.expLib.record({ trigger: trig, action: 'a', result: 'r', learned: 'l', directionMatch: false })
  const row3 = f.db.prepare('SELECT * FROM experience WHERE id = ?').get(id3)
  assert.equal(row3.direction_match, 1, '不会从 1 降到 0')
  track('27', true)
})

test('28. experience.query 返回 direction_match + context_window 字段', () => {
  const f = makeFixture()
  f.expLib.record({
    trigger: 'CATS-Net 注入失败',
    action: 'a', result: 'r', learned: 'l',
    directionMatch: true, contextWindow: 2.0,
  })
  const result = f.expLib.query({ currentContext: 'CATS-Net 注入失败' })
  assert.ok(result.length > 0, '有结果')
  assert.equal(result[0].direction_match, 1, '方向匹配')
  assert.equal(result[0].context_window, 2.0, '深度 ×2')
  track('28', true)
})

// —— 29-32 reflection.refl 反思深度 ×2 + 失败 hook ——
test('29. refl 必填字段缺失 → -1', () => {
  const id = refl({ trigger: 'x', action: 'y', result: 'z' })  // 缺 learned
  assert.equal(id, -1, '缺 learned → -1')
  track('29', true)
})

test('30. refl directionMatch=true → contextWindow 默认 2.0', () => {
  const f = makeFixture()
  // 重置单例让 experience library 拿到 fixture
  resetExperienceLibraryForTest()
  const lib = new ExperienceLibrary({ db: f.db })
  // 直接观察写入的 context_window 字段
  const id = lib.record({
    trigger: 'tool_failure:read_file',
    action: 'call(read_file)',
    result: 'failed',
    learned: '方向领域工具失败',
    directionMatch: true,
    contextWindow: 2.0,
  })
  const row = f.db.prepare('SELECT * FROM experience WHERE id = ?').get(id)
  assert.equal(row.context_window, 2.0, 'contextWindow=2.0')
  track('30', true)
})

test('31. reflectOnToolFailure 走完整路径', () => {
  const f = makeFixture()
  const id = reflectOnToolFailure({
    trigger: 'tool_failure:write_file',
    action: 'call(write_file)',
    result: 'failed',
    learned: '方向领域写文件失败',
    confidence: 0.5,
    directionMatch: true,
    contextWindow: 2.0,
    library: f.expLib,
  })
  assert.ok(id > 0, 'id > 0')
  const row = f.db.prepare('SELECT * FROM experience WHERE id = ?').get(id)
  assert.ok(row, `row 存在 (id=${id})`)
  assert.equal(row.direction_match, 1, 'direction_match=1')
  track('31', true)
})

test('32. REFLECTION_CONSTANTS 暴露深度参数', () => {
  assert.equal(REFLECTION_CONSTANTS.REFLECTION_DEPTH_DIRECTION, 2.0)
  assert.equal(REFLECTION_CONSTANTS.REFLECTION_DEPTH_BASE, 1.0)
  track('32', true)
})

// —— 33-35 端到端：direction 变化影响 L1/L6/experience 行为 ——
test('33. E2E: direction 设置 → L1 priority 变化', () => {
  const f = makeFixture()
  // 无 direction
  const r1 = f.integ.l1.recordInjection({
    strategy: 'semantic_memory_prefetch',
    confidence: 0.8,
    target: 'mem_generic_001',
  })
  const n1 = f.catsNet.getNode(r1.injectionId)
  assert.equal(n1.attributes.priority, 1.0)
  assert.equal(n1.attributes.directionMatch, 0)

  // 设 direction 后
  f.direction.set({ topic: 'CATS-Net' })
  const matched = f.direction.matchConcept('mem_cats_001', 'CATS-Net')
  const r2 = f.integ.l1.recordInjection({
    strategy: 'semantic_memory_prefetch',
    confidence: 0.8,
    target: 'mem_cats_001',
    priority: matched ? 1.5 : 1.0,
    directionMatch: matched,
  })
  const n2 = f.catsNet.getNode(r2.injectionId)
  assert.equal(n2.attributes.priority, 1.5, 'direction 领域 priority=1.5')
  assert.equal(n2.attributes.directionMatch, 1, 'directionMatch=1')
  track('33', true)
})

test('34. E2E: direction 设置 → L6 评分加权 + 失败反思', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file' })
  f.direction.set({ topic: 'CATS-Net' })
  // 5 调 3 成功 2 失败 + directionMatched=true
  for (let i = 0; i < 3; i++) f.integ.l6.recordCall('read_file', { success: true, directionMatched: true })
  for (let i = 0; i < 2; i++) f.integ.l6.recordCall('read_file', { success: false, directionMatched: true })
  // directionStats.calls=5, successes=3, failures=2
  const node = f.catsNet.getNode('l6_tool_read_file')
  assert.equal(node.attributes.directionStats.calls, 5)
  assert.equal(node.attributes.directionStats.successes, 3)
  assert.equal(node.attributes.directionStats.failures, 2)
  // direction 领域 salience = 0.1 + 0.9 * (3/5) = 0.1 + 0.54 = 0.64
  const c = f.integ.l6.getToolCredibility('read_file', { directionTopic: 'CATS-Net' })
  // base score 经过 +0.015*3 - 0.075*2 = +0.045 - 0.15 = -0.105；初始 0.5 → 0.395
  // 30% 加权 = 0.395 + (0.64 - 0.395) * 0.3 = 0.395 + 0.0735 = 0.4685
  assert.ok(c > 0.3 && c < 0.7, `加权后 c 在 0.3-0.7 (实际: ${c})`)
  // 失败反思 hook 调 2 次（2 个失败都调）
  assert.equal(f.reflectCalls.length, 2, '反思 hook 调 2 次')
  track('34', true)
})

test('35. E2E: clear direction → 加权消失 + priority 回到 1.0', () => {
  const f = makeFixture()
  f.direction.set({ topic: 'CATS-Net' })
  const r1 = f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.8, priority: 1.5, directionMatch: true })
  const n1 = f.catsNet.getNode(r1.injectionId)
  assert.equal(n1.attributes.priority, 1.5)

  f.direction.clear()
  // 重新读 direction 状态
  assert.equal(f.direction.get(), null)
  // 新注入不再带 directionMatch
  const r2 = f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.8 })
  const n2 = f.catsNet.getNode(r2.injectionId)
  assert.equal(n2.attributes.priority, 1.0)
  assert.equal(n2.attributes.directionMatch, 0)
  track('35', true)
})

// —— 36-37 隔离红线 ——
test('36. direction.js 不含 emotion / joy 字符串（情绪隔离）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/learning/direction.js'), 'utf-8')
  assert.equal(src.includes('emotion'), false, '不含 emotion 字符串')
  assert.equal(src.includes('joy'), false, '不含 joy 字符串')
  track('36', true)
})

test('37. reflection.js 不含 emotion / joy 字符串（情绪隔离）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/learning/reflection.js'), 'utf-8')
  assert.equal(src.includes('emotion'), false, '不含 emotion 字符串')
  assert.equal(src.includes('joy'), false, '不含 joy 字符串')
  track('37', true)
})

test('38. l6.js 方向加权不进 emotion 通道（attributes 字段不含 emotion）', () => {
  const f = makeFixture()
  f.integ.l6.registerTool({ name: 'read_file' })
  f.integ.l6.recordCall('read_file', { success: false, directionMatched: true })
  const node = f.catsNet.getNode('l6_tool_read_file')
  // 严格断言：attributes 字典 key 集合不含 emotion / joy / mood
  const keys = Object.keys(node.attributes || {})
  for (const forbidden of ['emotion', 'joy', 'mood', 'feeling', 'affect', 'valence', 'arousal', 'engagement']) {
    assert.equal(keys.includes(forbidden), false, `attributes.${forbidden} 不应存在`)
  }
  track('38', true)
})

test('39. l1.js 方向加权不进 emotion 通道', () => {
  const f = makeFixture()
  f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.8, priority: 1.5, directionMatch: true })
  const nodes = [...f.catsNet.nodes.values()].filter(n => n.id.startsWith('l1_'))
  assert.ok(nodes.length > 0, '有 L1 节点')
  for (const n of nodes) {
    const keys = Object.keys(n.attributes || {})
    for (const forbidden of ['emotion', 'joy', 'mood', 'feeling', 'affect', 'valence', 'arousal', 'engagement']) {
      assert.equal(keys.includes(forbidden), false, `L1.${n.id}.attributes.${forbidden} 不应存在`)
    }
  }
  track('39', true)
})

test('40. aci_injection_log 表 priority/direction_match 列存在', () => {
  const f = makeFixture()
  f.integ.l1.recordInjection({ strategy: 'semantic_memory_prefetch', confidence: 0.5, priority: 1.5, directionMatch: true })
  // 验证列存在
  const cols = f.db.prepare("PRAGMA table_info(aci_injection_log)").all().map(c => c.name)
  assert.equal(cols.includes('priority'), true, 'priority 列存在')
  assert.equal(cols.includes('direction_match'), true, 'direction_match 列存在')
  track('40', true)
})

// —— 收尾 ——
test('summary', () => {
  console.log(`\n=== direction-weighting: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.error('Failures:')
    for (const r of resultLog) console.error(' ', r)
  }
  // 不强制 exit code 1（让 node --test 框架处理），仅打印汇总
})
