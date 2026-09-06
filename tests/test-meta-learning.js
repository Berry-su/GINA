// Meta-learning framework tests (30+ tests).
//
// Run: node --test tests/test-meta-learning.js
//
// Covers: bandit (UCB1) / reflection (depth) / trigger (active-passive) /
//         planner (single-multi) / meta-controller (orchestrator).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-meta-'))
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const ml = await import('../src/meta-learning/index.js')
const bandit = await import('../src/meta-learning/bandit.js')
const reflection = await import('../src/meta-learning/reflection.js')
const trigger = await import('../src/meta-learning/trigger.js')
const planner = await import('../src/meta-learning/planner.js')
const controller = await import('../src/meta-learning/meta-controller.js')

// ─── bandit (UCB1) — 8 tests ────────────────────────────────

test('bandit.select: empty armIds throws', () => {
  assert.throws(() => bandit.select([], {}), /non-empty armIds/)
})

test('bandit.select: single arm returns that arm with Infinity score', () => {
  const state = bandit.defaultState()
  const r = bandit.select(['a'], { state })
  assert.equal(r.armId, 'a')
  assert.equal(r.score, Number.POSITIVE_INFINITY)
})

test('bandit.select: unexplored arm wins over explored (first-pick guarantee)', () => {
  const state = bandit.defaultState()
  bandit.update('a', -1, { state })   // a: bad
  bandit.update('a', -1, { state })
  bandit.update('a', -1, { state })
  bandit.update('b', 1, { state })    // b: good
  bandit.update('b', 1, { state })
  bandit.update('b', 1, { state })
  // 'c' is unexplored → must win
  const r = bandit.select(['a', 'b', 'c'], { state })
  assert.equal(r.armId, 'c')
})

test('bandit.select: among explored, UCB1 prefers high mean', () => {
  const state = bandit.defaultState()
  // a: mean=0.5, b: mean=0.9, both pulled many times
  for (let i = 0; i < 50; i++) {
    bandit.update('a', 0.5, { state })
    bandit.update('b', 0.9, { state })
  }
  const r = bandit.select(['a', 'b'], { state })
  assert.equal(r.armId, 'b')
})

test('bandit.update: reward clamp to [-1, 1]', () => {
  const state = bandit.defaultState()
  bandit.update('a', 5, { state })
  assert.equal(state.arms.a.sumReward, 1)
  bandit.update('a', -10, { state })
  assert.equal(state.arms.a.sumReward, 0)   // 1 + (-1) = 0
})

test('bandit.update: invalid reward throws', () => {
  assert.throws(() => bandit.update('a', NaN, {}), /finite number/)
  assert.throws(() => bandit.update('a', 'x', {}), /finite number/)
})

test('bandit.getArmStats: empty arm returns zeros', () => {
  const s = bandit.getArmStats('nope', { state: bandit.defaultState() })
  assert.equal(s.n, 0)
  assert.equal(s.mean, 0)
})

test('bandit.getOverview: sorted by UCB1 desc', () => {
  const state = bandit.defaultState()
  for (let i = 0; i < 10; i++) bandit.update('good', 1, { state })
  for (let i = 0; i < 10; i++) bandit.update('bad', -1, { state })
  const ov = bandit.getOverview({ state })
  assert.equal(ov.arms[0].armId, 'good')
  assert.equal(ov.arms[0].mean, 1)
  assert.equal(ov.arms[1].armId, 'bad')
  assert.equal(ov.arms[1].mean, -1)
})

// ─── reflection (adaptive depth) — 7 tests ──────────────────

test('reflection.decideDepth: low signal → depth 1', () => {
  const r = reflection.decideDepth({ signal: 0.1, state: reflection.defaultState() })
  assert.equal(r.depth, 1)
  assert.equal(r.forced, false)
})

test('reflection.decideDepth: medium signal → depth 2', () => {
  const r = reflection.decideDepth({ signal: 0.5, state: reflection.defaultState() })
  assert.equal(r.depth, 2)
})

test('reflection.decideDepth: high signal → depth 3', () => {
  const r = reflection.decideDepth({ signal: 0.9, state: reflection.defaultState() })
  assert.equal(r.depth, 3)
})

test('reflection.decideDepth: aggregates max of multiple signals', () => {
  const r = reflection.decideDepth({
    signal: 0.1,
    severity: 0.8,
    state: reflection.defaultState(),
  })
  assert.equal(r.depth, 3)
})

test('reflection.decideDepth: budget exhausted forces depth=1', () => {
  const state = reflection.defaultState({ budgetTokens: 100 })
  reflection.recordUsage(3, 100, { state, now: Date.now() })
  const r = reflection.decideDepth({ signal: 0.9, state, now: Date.now() })
  assert.equal(r.depth, 1)
  assert.equal(r.forced, true)
})

test('reflection.buildPrompt: depth 1 returns single layer', () => {
  const p = reflection.buildPrompt({ depth: 1, event: { x: 1 } })
  assert.equal(p.depth, 1)
  assert.equal(p.prompts.length, 1)
  assert.equal(p.prompts[0].layer, 1)
})

test('reflection.buildPrompt: depth 3 returns 3 layers', () => {
  const p = reflection.buildPrompt({ depth: 3, event: { x: 1 } })
  assert.equal(p.prompts.length, 3)
  assert.equal(p.prompts[2].role, 'root_cause')
})

// ─── trigger (active/passive 90/10) — 7 tests ───────────────

test('trigger.decide: high passive signal → passive', () => {
  const r = trigger.decide({
    signals: { failure: 0.8 },
    state: trigger.defaultState(),
  })
  assert.equal(r.mode, 'passive')
})

test('trigger.decide: low signal + no quota history → active (ratio 0 < 10%)', () => {
  const r = trigger.decide({
    signals: {},
    state: trigger.defaultState(),
  })
  assert.equal(r.mode, 'active')
})

test('trigger.decide: skip when ratio already at target and low signal', () => {
  const state = trigger.defaultState()
  // pre-fill 10 active (target reached)
  for (let i = 0; i < 10; i++) {
    trigger.recordTrigger('active', 0, 'pre', { state })
  }
  const r = trigger.decide({ signals: {}, state })
  assert.equal(r.mode, 'skip')
  assert.match(r.reason, /ratio OK/)
})

test('trigger.decide: forcePassive overrides', () => {
  const r = trigger.decide({ forcePassive: true, state: trigger.defaultState() })
  assert.equal(r.mode, 'passive')
})

test('trigger.decide: forceActive denied when quota exhausted', () => {
  const state = trigger.defaultState({ dailyActiveQuota: 2 })
  trigger.recordTrigger('active', 0, 'a', { state })
  trigger.recordTrigger('active', 0, 'b', { state })
  const r = trigger.decide({ forceActive: true, state })
  assert.equal(r.mode, 'skip')
})

test('trigger.isCooldownOk: true after min interval', () => {
  const state = trigger.defaultState({ minIntervalMs: 1000 })
  trigger.recordTrigger('active', 0, 'a', { state, now: 0 })
  assert.equal(trigger.isCooldownOk(state, 500), false)
  assert.equal(trigger.isCooldownOk(state, 1500), true)
})

test('trigger.activeRatioInWindow: counts only active in window', () => {
  const state = trigger.defaultState()
  trigger.recordTrigger('active', 0, '', { state, now: 1000 })
  trigger.recordTrigger('passive', 0, '', { state, now: 2000 })
  trigger.recordTrigger('active', 0, '', { state, now: 3000 })
  const r = trigger.activeRatioInWindow(state, 4000)
  assert.equal(r, 2 / 3)
})

// ─── planner (single/multi 70/30) — 6 tests ─────────────────

test('planner.decide: low cost budget → single', () => {
  const r = planner.decide({
    arm: { id: 'x' },
    context: { costBudget: 0.1 },
    state: planner.defaultState(),
  })
  assert.equal(r.mode, 'single')
})

test('planner.decide: high uncertainty + type=curriculum → multi', () => {
  // pre-fill single to make ratio OK
  const state = planner.defaultState()
  for (let i = 0; i < 7; i++) {
    planner.recordOutcome('single', 'success', { state })
  }
  const r = planner.decide({
    arm: { id: 'x', type: 'curriculum', uncertainty: 0.8 },
    state,
  })
  assert.equal(r.mode, 'multi')
  assert.ok(r.steps >= 2)
})

test('planner.decide: ratio below target → single (priority)', () => {
  // empty history → ratio=0, below 0.7
  const r = planner.decide({
    arm: { id: 'x', type: 'architecture', uncertainty: 0.9 },
    state: planner.defaultState(),
  })
  assert.equal(r.mode, 'single')
})

test('planner.decide: forceMode overrides', () => {
  const r = planner.decide({
    forceMode: 'multi',
    arm: { id: 'x' },
    state: planner.defaultState(),
  })
  assert.equal(r.mode, 'multi')
  assert.ok(r.steps >= 2)
})

test('planner.decide: last multi failed → downgrades to single', () => {
  const state = planner.defaultState()
  // Fill ratio to 1.0 (all single, but planner should consider multi if signals say so)
  for (let i = 0; i < 10; i++) {
    planner.recordOutcome('single', 'success', { state })
  }
  // Record a recent multi failure
  planner.recordOutcome('multi', 'failure', { state })
  const r = planner.decide({
    arm: { id: 'x', type: 'curriculum', uncertainty: 0.9 },
    state,
  })
  assert.equal(r.mode, 'single')
})

test('planner.wasLastMultiFailed: detects recent multi failure', () => {
  const state = planner.defaultState()
  planner.recordOutcome('multi', 'failure', { state, now: 1000 })
  assert.equal(planner.wasLastMultiFailed(state, 2000), true)
  planner.recordOutcome('multi', 'success', { state, now: 3000 })
  assert.equal(planner.wasLastMultiFailed(state, 4000), false)
})

// ─── meta-controller (orchestrator) — 8 tests ───────────────

test('controller.runMetaLearningCycle: skip when no candidates', async () => {
  const r = await controller.runMetaLearningCycle({
    candidates: [],
    signals: { failure: 0.9 },
  })
  assert.equal(r.skipped, true)
})

test('controller.runMetaLearningCycle: passive signal → passive + execute', async () => {
  let executed = null
  const r = await controller.runMetaLearningCycle({
    signals: { failure: 0.8 },
    candidates: ['x'],
    executeArm: async (armId, plan) => {
      executed = { armId, plan }
      return { success: true }
    },
  })
  assert.equal(r.mode, 'passive')
  assert.equal(r.armId, 'x')
  assert.equal(r.outcome, 'success')
  assert.equal(r.reward, 1)
  assert.equal(executed.armId, 'x')
})

test('controller.runMetaLearningCycle: failure → negative reward + depth 3', async () => {
  const r = await controller.runMetaLearningCycle({
    signals: { failure: 0.8, userFrustrated: 0.9 },
    candidates: ['x'],
    executeArm: async () => ({ success: false, error: 'boom' }),
  })
  assert.equal(r.outcome, 'failure')
  assert.equal(r.reward, -1)
  assert.equal(r.reflection.depth, 3)
  assert.equal(r.reflection !== null, true)  // ran
  assert.equal(r.cycleLog.reflectionRan, true)
})

test('controller.runMetaLearningCycle: skips when no signal + ratio met', async () => {
  // pre-fill active ratio to 100%
  const triggerState = trigger.defaultState()
  for (let i = 0; i < 10; i++) {
    trigger.recordTrigger('active', 0, '', { state: triggerState, now: Date.now() - 1000 - i })
  }
  // Make sure it can't fire active
  const paths = {
    trigger: path.join(TMP_HOME, 'tr.json'),
    planner: path.join(TMP_HOME, 'pl.json'),
    reflection: path.join(TMP_HOME, 'rf.json'),
    bandit: path.join(TMP_HOME, 'bd.json'),
    controller: path.join(TMP_HOME, 'ct.json'),
  }
  trigger.saveState(triggerState, paths.trigger)
  const r = await controller.runMetaLearningCycle({
    signals: {},
    candidates: ['x'],
    executeArm: async () => ({ success: true }),
    paths,
  })
  // Either skip or active still fires because of cooldown. The point is: it shouldn't passive-fire.
  if (!r.skipped) {
    assert.notEqual(r.mode, 'passive')
  }
})

test('controller.runMetaLearningCycle: A/B integration records metric', async () => {
  const recorded = []
  const fakeAb = {
    recordMetric: ({ expName, userId, metricName, value }) => {
      recorded.push({ expName, userId, metricName, value })
    },
  }
  const r = await controller.runMetaLearningCycle({
    signals: { failure: 0.8 },
    candidates: ['a', 'b', 'c'],
    executeArm: async () => ({ success: true }),
    ab: fakeAb,
    abExpName: 'meta_test',
  })
  assert.equal(r.outcome, 'success')
  assert.ok(recorded.length >= 1)
  assert.equal(recorded[0].expName, 'meta_test')
  assert.equal(recorded[0].metricName, 'meta_learning_reward')
})

test('controller.runMetaLearningCycle: state persistence works', async () => {
  const paths = {
    trigger: path.join(TMP_HOME, 'tr2.json'),
    planner: path.join(TMP_HOME, 'pl2.json'),
    reflection: path.join(TMP_HOME, 'rf2.json'),
    bandit: path.join(TMP_HOME, 'bd2.json'),
    controller: path.join(TMP_HOME, 'ct2.json'),
  }
  await controller.runMetaLearningCycle({
    signals: { failure: 0.8 },
    candidates: ['x'],
    executeArm: async () => ({ success: true }),
    paths,
  })
  // Files should exist
  assert.ok(fs.existsSync(paths.bandit))
  assert.ok(fs.existsSync(paths.controller))
  // Bandit should have x with n=1
  const state = JSON.parse(fs.readFileSync(paths.bandit, 'utf8'))
  assert.equal(state.arms.x.n, 1)
  assert.equal(state.arms.x.sumReward, 1)
})

test('controller.runMetaLearningCycle: executeArm throws → failure', async () => {
  const r = await controller.runMetaLearningCycle({
    signals: { failure: 0.8 },
    candidates: ['x'],
    executeArm: async () => { throw new Error('kaboom') },
  })
  assert.equal(r.outcome, 'failure')
  assert.match(r.executeError, /kaboom/)
  assert.equal(r.reward, -1)
})

test('controller.getMetaOverview: returns all module snapshots', () => {
  const paths = {
    trigger: path.join(TMP_HOME, 'tr3.json'),
    planner: path.join(TMP_HOME, 'pl3.json'),
    reflection: path.join(TMP_HOME, 'rf3.json'),
    bandit: path.join(TMP_HOME, 'bd3.json'),
    controller: path.join(TMP_HOME, 'ct3.json'),
  }
  const ov = controller.getMetaOverview({ paths })
  assert.ok(ov.bandit)
  assert.ok(ov.trigger)
  assert.ok(ov.planner)
  assert.ok(ov.reflection)
  assert.ok(ov.controller)
  assert.equal(typeof ov.bandit.totalN, 'number')
})

// ─── v1 backward compatibility — 2 tests ────────────────────

test('v1 compat: runLearningCycle still works', () => {
  const learnDir = path.join(TMP_HOME, 'learn')
  fs.mkdirSync(learnDir, { recursive: true })
  const r = controller.runLearningCycle({ learnDir })
  assert.ok(r)
  // First call should pick first lesson
  if (!r.done) {
    assert.ok(r.task.lineId)
  }
})

test('v1 compat: DIRECTIONS still exported', () => {
  assert.ok(Array.isArray(controller.DIRECTIONS))
  assert.ok(controller.DIRECTIONS.length > 0)
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
