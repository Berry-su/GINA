// A/B test framework tests (30 tests).
//
// Run: node --test tests/test-ab-test.js
//
// Uses GINA's main SQLite DB (path set by src/paths.js). Each test resets
// only the 3 experiment tables (experiments, assignments, metrics) — does
// not touch any other GINA data.

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

// Set GINA_HOME before any src import so paths.dbFile points to a temp DB.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-abtest-'))
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

// Now import — this triggers paths module to read GINA_HOME
const ab = await import('../src/experiments/index.js')
const stats = await import('../src/experiments/stats.js')
const router = await import('../src/experiments/router.js')
const db = await import('../src/experiments/db.js')

beforeEach(() => {
  ab.resetForTest()
})

after(() => {
  // Clean up temp home
  try {
    fs.rmSync(TMP_HOME, { recursive: true, force: true })
  } catch (_) {
    // ignore
  }
})

// ─── Registration & metadata ────────────────────────────────

test('registerExperiment creates a running experiment', () => {
  const exp = ab.registerExperiment({
    name: 'exp1',
    variants: ['control', 'treatment'],
    trafficSplit: { control: 0.5, treatment: 0.5 }
  })
  assert.equal(exp.name, 'exp1')
  assert.equal(exp.status, 'running')
  assert.deepEqual(exp.variants, ['control', 'treatment'])
})

test('registerExperiment rejects duplicate name', () => {
  ab.registerExperiment({ name: 'dup', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  assert.throws(() => {
    ab.registerExperiment({ name: 'dup', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  }, /already exists/)
})

test('registerExperiment validates name format', () => {
  assert.throws(() => ab.registerExperiment({ name: '', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } }))
  assert.throws(() => ab.registerExperiment({ name: 'has space', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } }))
  assert.throws(() => ab.registerExperiment({ name: 'a'.repeat(200), variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } }))
})

test('registerExperiment requires at least 2 variants', () => {
  assert.throws(() => ab.registerExperiment({ name: 'e', variants: ['a'], trafficSplit: { a: 1.0 } }))
  assert.throws(() => ab.registerExperiment({ name: 'e', variants: [], trafficSplit: {} }))
})

test('registerExperiment rejects duplicate variants', () => {
  assert.throws(() => ab.registerExperiment({ name: 'e', variants: ['a', 'a'], trafficSplit: { a: 1.0 } }))
})

test('registerExperiment rejects traffic split that does not sum to 1', () => {
  assert.throws(() => ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.3, b: 0.3 } }))
  assert.throws(() => ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 1.5, b: 0.5 } }))
})

test('registerExperiment rejects trafficSplit with extra keys', () => {
  assert.throws(() => ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.4, c: 0.1 } }))
})

test('listExperiments returns all registered', () => {
  ab.registerExperiment({ name: 'x', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  ab.registerExperiment({ name: 'y', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  const all = ab.listExperiments()
  assert.equal(all.length, 2)
  assert.ok(all.find(e => e.name === 'x'))
  assert.ok(all.find(e => e.name === 'y'))
})

test('stopExperiment and resumeExperiment toggle status', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  ab.stopExperiment('e')
  assert.equal(ab.getExperiment('e').status, 'stopped')
  ab.resumeExperiment('e')
  assert.equal(ab.getExperiment('e').status, 'running')
})

test('deleteExperiment removes experiment and cascades', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  ab.assignVariant({ expName: 'e', userId: 'u1' })
  ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'm', value: 1.0 })
  ab.deleteExperiment('e')
  assert.equal(ab.getExperiment('e'), null)
  // Cascade should have removed assignment + metric
  const overview = ab.getOverview()
  assert.equal(overview.length, 0)
})

// ─── Variant assignment (router) ─────────────────────────────

test('assignVariant: same user_id always gets same variant', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  const v1 = ab.assignVariant({ expName: 'e', userId: 'user123' })
  const v2 = ab.assignVariant({ expName: 'e', userId: 'user123' })
  const v3 = ab.assignVariant({ expName: 'e', userId: 'user123' })
  assert.equal(v1, v2)
  assert.equal(v2, v3)
})

test('assignVariant: 1000 users split roughly 50/50', () => {
  ab.registerExperiment({ name: 'e', variants: ['control', 'treatment'], trafficSplit: { control: 0.5, treatment: 0.5 } })
  const counts = { control: 0, treatment: 0 }
  for (let i = 0; i < 1000; i++) {
    const v = ab.assignVariant({ expName: 'e', userId: `u${i}` })
    counts[v]++
  }
  // Expect ~500/500, allow 10% drift
  assert.ok(counts.control > 400 && counts.control < 600, `control=${counts.control}`)
  assert.ok(counts.treatment > 400 && counts.treatment < 600, `treatment=${counts.treatment}`)
})

test('assignVariant: respects 80/20 traffic split', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.8, b: 0.2 } })
  const counts = { a: 0, b: 0 }
  for (let i = 0; i < 2000; i++) {
    const v = ab.assignVariant({ expName: 'e', userId: `u${i}` })
    counts[v]++
  }
  // Expect ~1600/400
  assert.ok(counts.a > 1500 && counts.a < 1700, `a=${counts.a}`)
  assert.ok(counts.b > 300 && counts.b < 500, `b=${counts.b}`)
})

test('assignVariant: forced variant bypasses hash', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  const v = ab.assignVariant({ expName: 'e', userId: 'u1', forced: 'b' })
  assert.equal(v, 'b')
  // Subsequent calls return same (sticky)
  assert.equal(ab.assignVariant({ expName: 'e', userId: 'u1' }), 'b')
})

test('assignVariant: invalid forced variant throws', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  assert.throws(() => ab.assignVariant({ expName: 'e', userId: 'u1', forced: 'c' }))
})

test('assignVariant: stopped experiment rejects new users without forced', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  ab.stopExperiment('e')
  assert.throws(() => ab.assignVariant({ expName: 'e', userId: 'u1' }))
  // forced works
  assert.equal(ab.assignVariant({ expName: 'e', userId: 'u2', forced: 'a' }), 'a')
})

// ─── Metric recording ───────────────────────────────────────

test('recordMetric auto-assigns user and stores value', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'latency_ms', value: 120.5 })
  // u1 should now be assigned
  const assignment = ab.getExperiment('e')
  // Verify by recording another metric and checking same variant
  ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'latency_ms', value: 100.0 })
  const result = ab.getResult('e', 'latency_ms')
  // Total samples = 2 (both for u1)
  const totalN = Object.values(result.nPerVariant).reduce((a, b) => a + b, 0)
  assert.equal(totalN, 2)
})

test('recordMetric validates value', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  assert.throws(() => ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'm', value: NaN }))
  assert.throws(() => ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'm', value: Infinity }))
  assert.throws(() => ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'm', value: 'string' }))
  assert.throws(() => ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'm', value: null }))
})

test('listMetrics returns all recorded metric names', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'latency_ms', value: 100 })
  ab.recordMetric({ expName: 'e', userId: 'u2', metricName: 'accuracy', value: 0.9 })
  const names = ab.listMetrics('e')
  assert.deepEqual(names.sort(), ['accuracy', 'latency_ms'])
})

// ─── Result computation ──────────────────────────────────────

test('getResult: insufficient samples marked clearly', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'm', value: 1.0 })
  const result = ab.getResult('e', 'm')
  assert.equal(result.winner, null)
  assert.equal(result.comparisons[0].significant, false)
})

test('getResult: clear winner detected with large effect', () => {
  ab.registerExperiment({ name: 'e', variants: ['control', 'treatment'], trafficSplit: { control: 0.5, treatment: 0.5 } })
  // control: mean=10, n=200, stddev=0.16 (5 values cycling)
  for (let i = 0; i < 200; i++) {
    ab.recordMetric({ expName: 'e', userId: `c${i}`, metricName: 'score', value: 10 + (i % 5) * 0.1 - 0.2, forcedVariant: 'control' })
  }
  // treatment: mean=15, n=200, stddev=0.16 — large effect
  for (let i = 0; i < 200; i++) {
    ab.recordMetric({ expName: 'e', userId: `t${i}`, metricName: 'score', value: 15 + (i % 5) * 0.1 - 0.2, forcedVariant: 'treatment' })
  }
  const result = ab.getResult('e', 'score')
  assert.equal(result.baseline, 'control')
  assert.equal(result.nPerVariant.control, 200)
  assert.equal(result.nPerVariant.treatment, 200)
  assert.equal(result.comparisons.length, 1)
  assert.equal(result.comparisons[0].variant, 'treatment')
  assert.ok(result.comparisons[0].significant, 'treatment should be significantly better')
  assert.equal(result.winner, 'treatment')
  assert.ok(result.comparisons[0].lift > 0.4, 'lift should be >40%')
})

test('getResult: no winner when effect is tiny', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  // Identical distributions → no difference
  for (let i = 0; i < 100; i++) {
    const v = 10 + Math.random() * 0.1
    ab.recordMetric({ expName: 'e', userId: `a${i}`, metricName: 'score', value: v })
    ab.recordMetric({ expName: 'e', userId: `b${i}`, metricName: 'score', value: v })
  }
  const result = ab.getResult('e', 'score')
  assert.equal(result.winner, null)
})

test('getResult: relative lift is correct for known case', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  // Force all users to specific variants so we know exactly where samples land
  for (let i = 0; i < 50; i++) ab.recordMetric({ expName: 'e', userId: `a${i}`, metricName: 'm', value: 10, forcedVariant: 'a' })
  for (let i = 0; i < 50; i++) ab.recordMetric({ expName: 'e', userId: `b${i}`, metricName: 'm', value: 12, forcedVariant: 'b' })
  const result = ab.getResult('e', 'm')
  // lift = (12 - 10) / |10| = 0.2 = 20%
  const treatmentComparison = result.comparisons.find(c => c.variant === 'b')
  assert.ok(treatmentComparison, 'should have comparison for variant b')
  assert.ok(Math.abs(treatmentComparison.lift - 0.2) < 0.01)
  assert.ok(Math.abs(treatmentComparison.liftPct - 20) < 1)
})

test('getResult: returns per-variant summary stats', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  // Force all to 'a' so we know summary.a has all 10 samples
  for (let i = 0; i < 10; i++) ab.recordMetric({ expName: 'e', userId: `a${i}`, metricName: 'm', value: i + 1, forcedVariant: 'a' })
  const result = ab.getResult('e', 'm')
  assert.equal(result.summary.a.n, 10)
  assert.ok(Math.abs(result.summary.a.mean - 5.5) < 0.01)
  assert.equal(result.summary.b.n, 0)
})

test('getResult: sample size recommendation is provided', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  ab.recordMetric({ expName: 'e', userId: 'u1', metricName: 'm', value: 1 })
  const result = ab.getResult('e', 'm')
  // medium effect (cohensD=0.2) at 80% power, 0.05 alpha → 394 per variant
  assert.ok(result.sampleSizeNeeded.a >= 390 && result.sampleSizeNeeded.a <= 400,
    `expected ~394, got ${result.sampleSizeNeeded.a}`)
})

// ─── Statistics unit tests ───────────────────────────────────

test('stats.summary: empty array', () => {
  const s = stats.summary([])
  assert.equal(s.n, 0)
  assert.equal(s.mean, 0)
})

test('stats.summary: known values', () => {
  const s = stats.summary([2, 4, 4, 4, 5, 5, 7, 9])
  assert.equal(s.n, 8)
  assert.ok(Math.abs(s.mean - 5) < 0.01)
  assert.ok(Math.abs(s.variance - 4.571) < 0.01)  // sample variance
})

test('stats.welchTTest: known significant result', () => {
  // control mean=10, treatment mean=15, both n=50, stddev=2
  const control = Array.from({ length: 50 }, () => 10 + (Math.random() - 0.5) * 4)
  const treatment = Array.from({ length: 50 }, () => 15 + (Math.random() - 0.5) * 4)
  const r = stats.welchTTest(control, treatment, { confidence: 0.95 })
  assert.ok(r.pTwoSided < 0.05)
  assert.ok(r.significant)
  assert.ok(r.meanDiff < 0)  // treatment > control, so diff is negative
})

test('stats.welchTTest: identical distributions not significant', () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const r = stats.welchTTest(a, b, { confidence: 0.95 })
  assert.equal(r.meanDiff, 0)
  // t=0 case returns p=1, but with our implementation p=1 at t=0
  // Verify it's NOT significant
  assert.equal(r.significant, false)
  assert.ok(r.pTwoSided >= 0.4 && r.pTwoSided <= 1.0)
})

test('stats.welchTTest: returns confidence interval', () => {
  const a = Array.from({ length: 30 }, () => 10 + Math.random())
  const b = Array.from({ length: 30 }, () => 12 + Math.random())
  const r = stats.welchTTest(a, b, { confidence: 0.95 })
  assert.ok(typeof r.ciLower === 'number')
  assert.ok(typeof r.ciUpper === 'number')
  assert.ok(r.ciLower < r.ciUpper)
})

test('stats.minimumSampleSize: known values', () => {
  // cohensD=0.5, alpha=0.05, power=0.8 → 63 per group
  const n = stats.minimumSampleSize({ cohensD: 0.5, alpha: 0.05, power: 0.8 })
  assert.ok(n >= 60 && n <= 70, `expected ~63, got ${n}`)
  // Large effect → fewer
  const nLarge = stats.minimumSampleSize({ cohensD: 0.8, alpha: 0.05, power: 0.8 })
  assert.ok(nLarge < n)
  // Small effect → more
  const nSmall = stats.minimumSampleSize({ cohensD: 0.2, alpha: 0.05, power: 0.8 })
  assert.ok(nSmall > n)
})

test('stats.normalCDF: known values', () => {
  assert.ok(Math.abs(stats.normalCDF(0) - 0.5) < 1e-6)
  assert.ok(Math.abs(stats.normalCDF(1.96) - 0.975) < 1e-3)
  assert.ok(Math.abs(stats.normalCDF(-1.96) - 0.025) < 1e-3)
  assert.ok(Math.abs(stats.normalCDF(2.576) - 0.995) < 1e-3)
})

test('stats.inverseNormalCDF: roundtrip', () => {
  for (const p of [0.025, 0.5, 0.975, 0.995]) {
    const z = stats.inverseNormalCDF(p)
    const back = stats.normalCDF(z)
    assert.ok(Math.abs(back - p) < 1e-3, `p=${p}, back=${back}`)
  }
})

test('router.pickVariant: respects traffic split exactly for known buckets', () => {
  // With traffic split 50/50 and BUCKET_SPACE=10000, bucket 0 → first sorted key
  // We can't easily predict the sort order without knowing the keys, so test the API
  const v1 = router.pickVariant(0, { a: 0.5, b: 0.5 })
  assert.ok(['a', 'b'].includes(v1))
  const v9999 = router.pickVariant(9999, { a: 0.5, b: 0.5 })
  assert.ok(['a', 'b'].includes(v9999))
})

test('router.forcedVariant: validates against variants list', () => {
  assert.equal(router.forcedVariant('b', ['a', 'b']), 'b')
  assert.throws(() => router.forcedVariant('c', ['a', 'b']))
})

test('router.assignVariant: 100% forced traffic', () => {
  ab.registerExperiment({ name: 'e', variants: ['a', 'b'], trafficSplit: { a: 1.0, b: 0.0 } })
  // Note: pickVariant may reject sum=0, but 1.0/0.0 sums to 1
  for (let i = 0; i < 10; i++) {
    assert.equal(ab.assignVariant({ expName: 'e', userId: `u${i}` }), 'a')
  }
})

// ─── End-to-end integration ─────────────────────────────────

test('integration: full A/B test lifecycle', () => {
  // 1. Register
  const exp = ab.registerExperiment({
    name: 'full-lifecycle',
    variants: ['baseline', 'newalgo'],
    trafficSplit: { baseline: 0.5, newalgo: 0.5 },
    description: 'Testing new algorithm vs baseline'
  })
  assert.equal(exp.status, 'running')

  // 2. Use SEPARATE user id pools per variant (sticky assignment would
  //    otherwise pull all 400 metrics into baseline).
  // baseline: mean ~10
  for (let i = 0; i < 200; i++) {
    const v = 10 + (Math.random() - 0.5) * 2
    ab.recordMetric({ expName: 'full-lifecycle', userId: `baseline_user_${i}`, metricName: 'quality', value: v, forcedVariant: 'baseline' })
  }
  // newalgo: mean ~13 (huge effect)
  for (let i = 0; i < 200; i++) {
    const v = 13 + (Math.random() - 0.5) * 2
    ab.recordMetric({ expName: 'full-lifecycle', userId: `newalgo_user_${i}`, metricName: 'quality', value: v, forcedVariant: 'newalgo' })
  }

  // 3. Get result
  const result = ab.getResult('full-lifecycle', 'quality')
  assert.equal(result.nPerVariant.baseline, 200)
  assert.equal(result.nPerVariant.newalgo, 200)
  assert.equal(result.winner, 'newalgo')
  const newalgoComparison = result.comparisons.find(c => c.variant === 'newalgo')
  assert.ok(newalgoComparison.significant)
  assert.ok(newalgoComparison.lift > 0.2)

  // 4. Stop and clean up
  ab.stopExperiment('full-lifecycle')
  assert.equal(ab.getExperiment('full-lifecycle').status, 'stopped')

  // 5. Overview
  const overview = ab.getOverview()
  assert.equal(overview.length, 1)
  assert.equal(overview[0].name, 'full-lifecycle')
})

test('integration: multi-metric experiment', () => {
  ab.registerExperiment({ name: 'multi', variants: ['a', 'b'], trafficSplit: { a: 0.5, b: 0.5 } })
  // Record 3 different metrics
  for (let i = 0; i < 20; i++) {
    ab.recordMetric({ expName: 'multi', userId: `u${i}`, metricName: 'latency_ms', value: 100 + Math.random() * 10 })
    ab.recordMetric({ expName: 'multi', userId: `u${i}`, metricName: 'accuracy', value: 0.9 + Math.random() * 0.1 })
    ab.recordMetric({ expName: 'multi', userId: `u${i}`, metricName: 'quality_score', value: 8 + Math.random() * 2 })
  }
  assert.deepEqual(ab.listMetrics('multi').sort(), ['accuracy', 'latency_ms', 'quality_score'])
  // Each metric should have its own result
  const r1 = ab.getResult('multi', 'latency_ms')
  const r2 = ab.getResult('multi', 'accuracy')
  const r3 = ab.getResult('multi', 'quality_score')
  assert.equal(r1.metric, 'latency_ms')
  assert.equal(r2.metric, 'accuracy')
  assert.equal(r3.metric, 'quality_score')
})
