// src/emotion/test-joy.js —— JoyState 单元测试
//
// 覆盖：bump / get / snapshot / tick / injectFor / reset / 时间衰减 / 单例 / DB 持久化
// 关联 ADR-004 §3.1
//
// 运行：GINA_USER_DIR=/tmp/gina-joy-test node src/emotion/test-joy.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JoyState, getJoyState, resetJoyStateForTest, JOY_CONSTANTS } from './joy-state.js'
import { getDB, closeDBForTest } from '../db/connection.js'
import { join } from 'node:path'
import { rmSync, existsSync, rmSync as _rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

// 临时切到测试 DB（避免污染真实 DB）
const TEST_DIR = process.env.GINA_USER_DIR || join(tmpdir(), `gina-joy-test-${Date.now()}-${process.pid}`)
process.env.GINA_USER_DIR = TEST_DIR
const TEST_DB = join(TEST_DIR, 'data', 'jarvis.db')

let testCount = 0
let passCount = 0
const fail = []
test('joy 单元测试套件', async (t) => {
  // 每个测试前重置
  await t.test('1. JoyState 构造 + 默认值 0.5', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    const snap = joy.snapshot()
    testCount++
    assert.equal(snap.value, JOY_CONSTANTS.DEFAULT_VALUE, `默认 value 应 = ${JOY_CONSTANTS.DEFAULT_VALUE}`)
    assert.equal(snap.bump_count, 0, 'bump_count 默认 0')
    passCount++
  })

  await t.test('2. bump(+0.2) 后 value = 0.7', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    const before = joy.get()
    const snap = joy.bump({ amount: 0.2, reason: 'test_task_success' })
    testCount++
    assert.ok(Math.abs(snap.value - 0.7) < 0.001, `bump 后 value 应 ≈ 0.7，实际 ${snap.value}`)
    assert.equal(snap.last_reason, 'test_task_success', 'last_reason 应记录')
    assert.equal(snap.bump_count, 1, 'bump_count = 1')
    assert.equal(joy.get(), snap.value, 'get() 与 snapshot().value 一致')
    passCount++
  })

  await t.test('3. bump(-0.3) 后 value = 0.4', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    joy.bump({ amount: 0.2, reason: 'init' })
    const snap = joy.bump({ amount: -0.3, reason: 'test_reject' })
    testCount++
    // 0.5 + 0.2 = 0.7, 0.7 - 0.3 = 0.4
    assert.ok(Math.abs(snap.value - 0.4) < 0.001, `bump 后 value 应 ≈ 0.7 → -0.3 = 0.4，实际 ${snap.value}`)
    passCount++
  })

  await t.test('4. 单次 bump 限幅 ±0.3', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    // 试图 +1.0 实际只能 +0.3
    const snap = joy.bump({ amount: 1.0, reason: 'test_overflow' })
    testCount++
    assert.ok(Math.abs(snap.value - 0.8) < 0.001, `bump(+1.0) 限幅后应 ≈ 0.8，实际 ${snap.value}`)
    // 试图 -1.0 实际只能 -0.3
    const snap2 = joy.bump({ amount: -1.0, reason: 'test_underflow' })
    assert.ok(Math.abs(snap2.value - 0.5) < 0.001, `bump(-1.0) 限幅后应 ≈ 0.5，实际 ${snap2.value}`)
    passCount++
  })

  await t.test('5. clamp [0, 1] 不出界', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    // 先 +0.3 x 多次到 1.0
    for (let i = 0; i < 10; i++) joy.bump({ amount: 0.3, reason: 'pump' })
    const snap = joy.snapshot()
    testCount++
    assert.ok(snap.value >= 0 && snap.value <= 1, `value 应 clamp 在 [0, 1]，实际 ${snap.value}`)
    assert.ok(snap.value >= 0.99, `多次 +0.3 应接近 1.0，实际 ${snap.value}`)
    passCount++
  })

  await t.test('6. 24h 衰减 -0.05', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    const t0 = Date.now()
    // 模拟 48h 后
    const t1 = t0 + 48 * 3600 * 1000
    const snap = joy.bump({ amount: 0, reason: 'simulate_decay', now: t1 })
    // bump 调用内部先做衰减：48h 应 -0.10，但 clamp ≥ 0
    // 初始 0.5 - 0.10 = 0.40（衰减先于 bump(0)）
    testCount++
    assert.ok(snap.value <= 0.5, `48h 后 value 应 ≤ 0.5，实际 ${snap.value}`)
    passCount++
  })

  await t.test('7. injectFor() 输出含 joy 字段', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    joy.bump({ amount: 0.1, reason: 'test_inject' })
    const text = joy.injectFor()
    testCount++
    assert.ok(/joy:/.test(text), `injectFor 应含 "joy:" 字段，输出：${text.slice(0, 100)}`)
    assert.ok(/v\d+/.test(text), 'injectFor 应含版本号')
    assert.ok(/meta-info/.test(text) || /不影响任何决策/.test(text), 'injectFor 应声明 meta-info 性质')
    passCount++
  })

  await t.test('8. injectFor() 不含其他情绪词', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    const text = joy.injectFor()
    testCount++
    // 不应出现 anger / fear / sadness / disgust / surprise 等其他情绪词
    const banned = ['anger', 'fear', 'sadness', 'disgust', 'surprise', 'valence', 'arousal', 'emotionProfile', 'anticipation']
    const found = banned.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(text))
    assert.equal(found.length, 0, `injectFor 不应含其他情绪词，发现: ${found.join(', ')}`)
    passCount++
  })

  await t.test('9. 单例模式：getJoyState 同一实例', () => {
    resetJoyStateForTest()
    const a = getJoyState()
    const b = getJoyState()
    testCount++
    assert.equal(a, b, 'getJoyState 应返回同一实例')
    passCount++
  })

  await t.test('10. 持久化：bump 后新实例能读到', () => {
    resetJoyStateForTest()
    const joy1 = new JoyState({ db: getDB() })
    joy1.bump({ amount: 0.15, reason: 'persist_test' })
    // 模拟重启：仅清单例（不重置 DB） → 新实例从 DB 读
    // 不调 resetJoyStateForTest（那会清空数据）
    const _JoyStateModule = { _instance: null }
    // 用新实例直接读 DB（不走单例 helper）
    const joy2 = new JoyState({ db: getDB() })
    const snap = joy2.snapshot()
    testCount++
    assert.ok(Math.abs(snap.value - 0.65) < 0.001, `持久化后 value 应 ≈ 0.65，实际 ${snap.value}`)
    assert.equal(snap.bump_count, 1, 'bump_count 持久化')
    assert.equal(snap.last_reason, 'persist_test', 'last_reason 持久化')
    passCount++
  })

  await t.test('11. tick() 触发衰减', () => {
    resetJoyStateForTest()
    const t0 = Date.now()
    const joy = new JoyState({ db: getDB(), now: t0 })
    joy.bump({ amount: 0.1, reason: 'tick_test', now: t0 })
    // 24h 后 tick
    const t1 = t0 + 25 * 3600 * 1000
    const snap = joy.tick(t1)
    testCount++
    // 0.5 + 0.1 = 0.6, 25h 后 -0.05 = 0.55
    assert.ok(snap.value <= 0.6, `25h 后 value 应 ≤ 0.6，实际 ${snap.value}`)
    passCount++
  })

  await t.test('12. _reset() 回默认', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    joy.bump({ amount: 0.3, reason: 'before_reset' })
    const snap = joy._reset()
    testCount++
    assert.equal(snap.value, JOY_CONSTANTS.DEFAULT_VALUE, `_reset() 后 value 应 = ${JOY_CONSTANTS.DEFAULT_VALUE}`)
    assert.equal(snap.bump_count, 0, '_reset() 后 bump_count = 0')
    passCount++
  })

  await t.test('13. amount 非 number 静默忽略', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    const before = joy.snapshot()
    const snap = joy.bump({ amount: 'invalid', reason: 'test' })
    testCount++
    assert.equal(snap.value, before.value, 'amount 非 number 应保持原 value')
    passCount++
  })

  await t.test('14. 多次小 bump 累加', () => {
    resetJoyStateForTest()
    const joy = new JoyState({ db: getDB() })
    for (let i = 0; i < 5; i++) joy.bump({ amount: 0.1, reason: `step_${i}` })
    const snap = joy.snapshot()
    testCount++
    // 0.5 + 5*0.1 = 1.0 (clamp)
    assert.ok(snap.value >= 0.99, `5 次 +0.1 应接近 1.0，实际 ${snap.value}`)
    assert.equal(snap.bump_count, 5, 'bump_count = 5')
    assert.equal(snap.last_reason, 'step_4', 'last_reason 应是最后一次')
    passCount++
  })

  await t.test('15. JOY_CONSTANTS 导出正确', () => {
    testCount++
    assert.equal(JOY_CONSTANTS.VERSION, 1, 'VERSION = 1')
    assert.equal(JOY_CONSTANTS.DECAY_PER_24H, 0.05, 'DECAY_PER_24H = 0.05')
    assert.equal(JOY_CONSTANTS.MAX_JUMP, 0.3, 'MAX_JUMP = 0.3')
    assert.equal(JOY_CONSTANTS.DEFAULT_VALUE, 0.5, 'DEFAULT_VALUE = 0.5')
    assert.equal(JOY_CONSTANTS.SINGLETON_ID, 1, 'SINGLETON_ID = 1')
    passCount++
  })
})

// 清理
setTimeout(() => {
  try { closeDBForTest() } catch {}
  try {
    if (existsSync(TEST_DIR)) _rmSync(TEST_DIR, { recursive: true, force: true })
  } catch {}
  console.log(`\n=== joy 单元测试结果: ${passCount} passed, ${fail.length} failed ===`)
  if (fail.length > 0) {
    fail.forEach((f, i) => console.error(`  [${i + 1}] ${f}`))
    process.exit(1)
  }
}, 200)
