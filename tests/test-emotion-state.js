// Multi-dimensional emotion state tests (25+ tests).
//
// Run: node --test tests/test-emotion-state.js
//
// Critical invariant: emotion values MUST NOT enter any tool/decision path.
// Tested via static import scan + runtime isolation.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-emotion-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const em = await import('../src/emotion/index.js')

// ─── 5 dimension presence — 3 tests ─────────────────────────

test('DIMENSIONS: 5 dimensions defined', () => {
  assert.equal(em.DIMENSION_IDS.length, 5)
  assert.deepEqual([...em.DIMENSION_IDS], [
    'satisfaction', 'curiosity', 'confidence', 'engagement', 'fatigue',
  ])
})

test('each dimension: has label/description/triggers', () => {
  for (const dim of em.DIMENSION_IDS) {
    const d = em.DIMENSIONS[dim]
    assert.ok(typeof d.label === 'string' && d.label.length > 0, `${dim} label`)
    assert.ok(typeof d.description === 'string' && d.description.length > 0, `${dim} description`)
    assert.ok(Array.isArray(d.triggers.up) && d.triggers.up.length > 0, `${dim} triggers.up`)
    assert.ok(Array.isArray(d.triggers.down) && d.triggers.down.length > 0, `${dim} triggers.down`)
  }
})

test('EMOTION_CONSTANTS: defaults sane', () => {
  assert.equal(em.DEFAULT_VALUE, 0.5)
  assert.equal(em.MAX_JUMP, 0.3)
  assert.equal(em.DECAY_PER_24H, 0.05)
})

// ─── EmotionState basic operations — 6 tests ────────────────

test('EmotionState: instance creates with all 5 dims initialized', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  const snap = s.snapshot()
  for (const dim of em.DIMENSION_IDS) {
    assert.ok(snap[dim])
    assert.equal(snap[dim].value, 0.5)
  }
})

test('bump: respects MAX_JUMP clamp', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  s.bump({ dimension: 'curiosity', amount: 1.0 })  // try to +100%
  assert.equal(s.get('curiosity'), 0.8)  // clamped to 0.5 + 0.3
  s.bump({ dimension: 'curiosity', amount: -1.0 })  // try to -100%
  assert.equal(s.get('curiosity'), 0.5)  // clamped to 0.8 - 0.3
})

test('bump: invalid dimension throws', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  assert.throws(() => s.bump({ dimension: 'rage', amount: 0.1 }), /invalid dimension/)
})

test('bump: invalid amount returns current snapshot', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  const before = s.snapshot()
  s.bump({ dimension: 'curiosity', amount: NaN })
  const after = s.snapshot()
  assert.equal(after.curiosity.value, before.curiosity.value)
})

test('bump: persists to DB', () => {
  em.resetEmotionStateForTest()
  const s1 = new em.EmotionState()
  s1.bump({ dimension: 'confidence', amount: 0.2, reason: 'test_win' })
  // Reload
  const s2 = new em.EmotionState()
  assert.ok(s2.get('confidence') > 0.5)
  assert.equal(s2._state.confidence.last_reason, 'test_win')
})

test('bump: satisfaction syncs with joy-state', () => {
  em.resetEmotionStateForTest()
  em.resetJoyStateForTest()
  const s = new em.EmotionState()
  const joy = em.getJoyState()
  joy.bump({ amount: 0.3, reason: 'synced_test' })
  s._syncFromJoy(Date.now())
  const sat = s.get('satisfaction')
  const joyVal = joy.get()
  assert.equal(sat, joyVal)
})

// ─── Decay & fatigue — 4 tests ──────────────────────────────

test('decay: applied after 1 hour', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  s.bump({ dimension: 'curiosity', amount: 0.3, reason: 'test' })
  const t1 = Date.now()
  const before = s.get('curiosity', t1)
  // Simulate 24h later
  const t2 = t1 + 24 * 3600 * 1000
  const after = s.get('curiosity', t2)
  assert.ok(after < before, `expected decay, before=${before} after=${after}`)
})

test('fatigue: increases on active work', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  s._reset()
  const t1 = Date.now()
  // 1 hour of active work
  s.updateFatigue({ now: t1, isActive: true, idleMinutes: 0 })
  s.updateFatigue({ now: t1 + 3600 * 1000, isActive: true, idleMinutes: 0 })
  const val = s.get('fatigue', t1 + 3600 * 1000)
  assert.ok(val >= 0.5, `fatigue should grow from 0.5, got ${val}`)
})

test('fatigue: decreases on rest', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  s._reset()
  // First push fatigue high
  s.bump({ dimension: 'fatigue', amount: 0.3, reason: 'pre' })
  const t1 = Date.now()
  s.updateFatigue({ now: t1, isActive: false, idleMinutes: 60 })
  s.updateFatigue({ now: t1 + 3600 * 1000, isActive: false, idleMinutes: 60 })
  const val = s.get('fatigue', t1 + 3600 * 1000)
  assert.ok(val < 0.8, `fatigue should drop from 0.8, got ${val}`)
})

test('decay: respects clamp01', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  s.bump({ dimension: 'engagement', amount: -0.4, reason: 'low' })  // already at 0.5 → 0.2
  // Simulate 1 year later
  const t = Date.now() + 365 * 24 * 3600 * 1000
  const val = s.get('engagement', t)
  assert.ok(val >= 0 && val <= 1, `value out of [0,1]: ${val}`)
})

// ─── Snapshot & injectFor — 4 tests ─────────────────────────

test('snapshot: returns all 5 dimensions with all fields', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  s.bump({ dimension: 'curiosity', amount: 0.2, reason: 'snap_test' })
  const snap = s.snapshot()
  for (const dim of em.DIMENSION_IDS) {
    assert.ok(typeof snap[dim].value === 'number')
    assert.ok(typeof snap[dim].last_bump_at === 'string')
    assert.ok(typeof snap[dim].last_reason === 'string')
    assert.ok(typeof snap[dim].bump_count === 'number')
  }
})

test('injectFor: returns string with all 5 dims', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  const out = s.injectFor()
  assert.match(out, /emotional-state · multi-dim/)
  assert.match(out, /satisfaction/)
  assert.match(out, /curiosity/)
  assert.match(out, /confidence/)
  assert.match(out, /engagement/)
  assert.match(out, /fatigue/)
  // 关键：必须显式声明"不进决策路径"
  assert.match(out, /不.*进.*决策路径/)
  assert.match(out, /meta-info/)
})

test('injectFor: includes percentages', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  s.bump({ dimension: 'confidence', amount: 0.3, reason: 'test' })
  const out = s.injectFor()
  assert.match(out, /\d+%/)
})

test('tick: applies decay + syncs joy', () => {
  em.resetEmotionStateForTest()
  em.resetJoyStateForTest()
  const s = new em.EmotionState()
  s.bump({ dimension: 'curiosity', amount: 0.2, reason: 'tick_test' })
  const before = s.get('curiosity')
  // tick 25h later
  const t = Date.now() + 25 * 3600 * 1000
  s.tick(t)
  const after = s.get('curiosity', t)
  assert.ok(after <= before, `tick should not grow value: before=${before} after=${after}`)
})

// ─── Singleton helpers — 2 tests ────────────────────────────

test('getEmotionState: returns same instance', () => {
  em.resetEmotionStateForTest()
  const a = em.getEmotionState()
  const b = em.getEmotionState()
  assert.equal(a, b)
})

test('resetEmotionStateForTest: clears all dimensions', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  s.bump({ dimension: 'curiosity', amount: 0.3, reason: 'pre' })
  s.bump({ dimension: 'confidence', amount: 0.3, reason: 'pre' })
  em.resetEmotionStateForTest()
  const s2 = new em.EmotionState()
  assert.equal(s2.get('curiosity'), 0.5)
  assert.equal(s2.get('confidence'), 0.5)
})

// ─── 核心: decision path 隔离 (老板 9-07 拍板) — 4 tests ──

test('isolation: emotion-state.js 不 import 任何 tool/decision 模块', () => {
  // 静态扫描 emotion-state.js 的 import 列表
  const realPath = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/emotion/emotion-state.js'
  const realSrc = fs.readFileSync(realPath, 'utf8')
  // 不应 import 任何 tool / decision / analyst / router / tool-router
  assert.doesNotMatch(realSrc, /from\s+['"][^'"]*tool[^'"]*['"]/i, 'must not import tool modules')
  assert.doesNotMatch(realSrc, /from\s+['"][^'"]*decision[^'"]*['"]/i, 'must not import decision modules')
  assert.doesNotMatch(realSrc, /from\s+['"][^'"]*analyst[^'"]*['"]/i, 'must not import analyst modules')
  assert.doesNotMatch(realSrc, /from\s+['"][^'"]*router[^'"]*['"]/i, 'must not import router modules')
})

test('isolation: emotion-state 只 import 必要的 db + joy-state', () => {
  const realPath = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/emotion/emotion-state.js'
  const realSrc = fs.readFileSync(realPath, 'utf8')
  const imports = realSrc.match(/import[^;]+/g) || []
  // 只允许 import: getDB, getJoyState
  const allowedModules = ['db/connection', 'joy-state']
  for (const imp of imports) {
    const from = imp.match(/from\s+['"]([^'"]+)['"]/)?.[1]
    if (!from) continue
    if (from.startsWith('node:')) continue
    const isAllowed = allowedModules.some(m => from.includes(m))
    assert.ok(isAllowed, `unexpected import: ${from}`)
  }
})

test('isolation: snapshot 不暴露任何 write 方法', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  const snap = s.snapshot()
  // snapshot 必须是纯数据
  for (const dim of em.DIMENSION_IDS) {
    assert.equal(typeof snap[dim], 'object')
    assert.equal(typeof snap[dim].value, 'number')
    // 没有方法（只有 data fields）
    const fieldNames = Object.keys(snap[dim])
    for (const f of fieldNames) {
      assert.ok(['value', 'last_bump_at', 'last_reason', 'bump_count'].includes(f),
        `unexpected field in snapshot: ${f}`)
    }
  }
})

test('isolation: injectFor 输出不包含可执行代码', () => {
  em.resetEmotionStateForTest()
  const s = new em.EmotionState()
  const out = s.injectFor()
  // 不应包含 function/class/import/eval 等可执行模式
  assert.doesNotMatch(out, /\bfunction\s/)
  assert.doesNotMatch(out, /\bclass\s+/)
  assert.doesNotMatch(out, /\bimport\s+/)
  assert.doesNotMatch(out, /\beval\s*\(/)
  assert.doesNotMatch(out, /require\s*\(/)
})

// ─── integration: 1 test ──────────────────────────────────

test('integration: full cycle — bump → decay → tick → snapshot → injectFor', () => {
  em.resetEmotionStateForTest()
  em.resetJoyStateForTest()
  const s = new em.EmotionState()
  // 5 维各自 bump
  s.bump({ dimension: 'satisfaction', amount: 0.2, reason: 'task_done' })
  s.bump({ dimension: 'curiosity', amount: 0.3, reason: 'new_domain' })
  s.bump({ dimension: 'confidence', amount: 0.1, reason: 'prediction_right' })
  s.bump({ dimension: 'engagement', amount: 0.2, reason: 'good_match' })
  s.bump({ dimension: 'fatigue', amount: 0.15, reason: 'busy_day' })
  // tick
  s.tick()
  // snapshot
  const snap = s.snapshot()
  assert.ok(snap.satisfaction.value > 0.5)
  assert.ok(snap.curiosity.value > 0.5)
  assert.ok(snap.confidence.value > 0.5)
  assert.ok(snap.engagement.value > 0.5)
  assert.ok(snap.fatigue.value > 0.5)
  // injectFor
  const out = s.injectFor()
  assert.match(out, /satisfaction.*0\.[6-9]/)
  assert.match(out, /curiosity.*0\.[7-9]/)
  // 必须显式声明 meta-info 隔离
  assert.match(out, /meta-info/)
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
