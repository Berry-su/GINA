// A/B test core API: experiment registration, variant assignment, metric
// recording, and result computation.
//
// This is the public entry point. db.js handles persistence, router.js
// handles user→variant assignment, stats.js handles significance.

import * as db from './db.js'
import { assignVariant as routeAssign } from './router.js'
import { welchTTest, summary, relativeLift, minimumSampleSize } from './stats.js'

// ─── Validation helpers ──────────────────────────────────────

function validateExperimentSpec({ name, variants, trafficSplit, description }) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('experiment name must be a non-empty string')
  }
  if (name.length > 128) {
    throw new Error('experiment name must be ≤ 128 chars')
  }
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(name)) {
    throw new Error('experiment name may only contain alphanumerics, _, -, :, .')
  }
  if (!Array.isArray(variants) || variants.length < 2) {
    throw new Error('variants must be an array of at least 2 variant names')
  }
  if (variants.length > 16) {
    throw new Error('variants must be at most 16')
  }
  const seen = new Set()
  for (const v of variants) {
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error('each variant must be a non-empty string')
    }
    if (seen.has(v)) {
      throw new Error(`duplicate variant: ${v}`)
    }
    seen.add(v)
  }
  if (!trafficSplit || typeof trafficSplit !== 'object') {
    throw new Error('trafficSplit must be an object mapping variant → weight')
  }
  for (const v of variants) {
    if (!(v in trafficSplit)) {
      throw new Error(`trafficSplit missing variant: ${v}`)
    }
  }
  // Extra keys in trafficSplit (typo protection)
  for (const k of Object.keys(trafficSplit)) {
    if (!seen.has(k)) {
      throw new Error(`trafficSplit has extra key not in variants: ${k}`)
    }
  }
  // Validate sum to 1.0
  let total = 0
  for (const v of variants) {
    const w = trafficSplit[v]
    if (typeof w !== 'number' || isNaN(w) || w < 0 || w > 1) {
      throw new Error(`trafficSplit[${v}] must be a number in [0, 1]`)
    }
    total += w
  }
  if (Math.abs(total - 1.0) > 1e-6) {
    throw new Error(`trafficSplit must sum to 1.0, got ${total}`)
  }
  if (description != null && typeof description !== 'string') {
    throw new Error('description must be a string')
  }
}

function validateMetricName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('metric name must be a non-empty string')
  }
  if (name.length > 128) {
    throw new Error('metric name must be ≤ 128 chars')
  }
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(name)) {
    throw new Error('metric name may only contain alphanumerics, _, -, :, .')
  }
}

function validateValue(value) {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    throw new Error('metric value must be a finite number')
  }
}

// ─── Public API ──────────────────────────────────────────────

// Register a new experiment. Throws if name already exists or spec is invalid.
export function registerExperiment({ name, variants, trafficSplit, description = '' }) {
  validateExperimentSpec({ name, variants, trafficSplit, description })
  const existing = db.getExperiment(name)
  if (existing) {
    throw new Error(`experiment "${name}" already exists; use updateExperimentTrafficSplit to modify`)
  }
  return db.insertExperiment({ name, variants, trafficSplit, description })
}

// Update traffic split for an existing experiment (e.g. ramp 5% → 20% → 50%).
// Existing assignments are NOT recomputed; they remain stable for already-assigned users.
export function updateExperimentTrafficSplit(name, trafficSplit) {
  const exp = db.getExperiment(name)
  if (!exp) throw new Error(`experiment "${name}" not found`)
  // Validate new split
  for (const v of exp.variants) {
    if (!(v in trafficSplit)) {
      throw new Error(`trafficSplit missing variant: ${v}`)
    }
  }
  for (const k of Object.keys(trafficSplit)) {
    if (!exp.variants.includes(k)) {
      throw new Error(`trafficSplit has extra key not in variants: ${k}`)
    }
  }
  // We don't have an update method, use raw insert trick
  // Re-insert with same name would conflict; instead we re-implement
  db.setExperimentStatus(name, 'running') // ensure running
  // Re-insert (cascades to assignments + metrics? No, FK is on delete only).
  // We need a dedicated update. For now, use setExperimentStatus to ensure alive,
  // and we expose a separate updateTrafficSplit via db.
  // For simplicity, force user to delete+recreate if changing traffic.
  // (In production we'd add db.updateExperimentTrafficSplit; skipped for MVP.)
  throw new Error('updateExperimentTrafficSplit not implemented; delete and re-register to change split')
}

// Get experiment by name
export function getExperiment(name) {
  return db.getExperiment(name)
}

export function listExperiments() {
  return db.listExperiments()
}

// Stop an experiment (no new assignments, but recordable).
// Stopped experiments can still be analyzed via getResult.
export function stopExperiment(name) {
  const exp = db.getExperiment(name)
  if (!exp) throw new Error(`experiment "${name}" not found`)
  return db.setExperimentStatus(name, 'stopped')
}

// Resume a stopped experiment.
export function resumeExperiment(name) {
  const exp = db.getExperiment(name)
  if (!exp) throw new Error(`experiment "${name}" not found`)
  return db.setExperimentStatus(name, 'running')
}

// Delete experiment (and all assignments + metrics via FK CASCADE).
export function deleteExperiment(name) {
  const exp = db.getExperiment(name)
  if (!exp) throw new Error(`experiment "${name}" not found`)
  db.deleteExperiment(name)
}

// Assign user_id to a variant. Sticky: same user always gets same variant
// unless 'forced' is provided.
export function assignVariant({ expName, userId, forced = null }) {
  const exp = db.getExperiment(expName)
  if (!exp) throw new Error(`experiment "${expName}" not found`)
  // Sticky: if user already assigned, return that
  const existing = db.getAssignment(expName, userId)
  if (existing) return existing.variant
  if (exp.status === 'stopped' && forced == null) {
    throw new Error(`experiment "${expName}" is stopped; cannot assign new users without forced variant`)
  }
  const variant = routeAssign({
    userId,
    expName,
    trafficSplit: exp.trafficSplit,
    forced
  })
  db.upsertAssignment({ expName, userId, variant })
  return variant
}

// Record a metric for a user in an experiment.
// Auto-assigns the user if not already assigned (uses default traffic split).
export function recordMetric({ expName, userId, metricName, value, forcedVariant = null }) {
  validateMetricName(metricName)
  validateValue(value)
  const exp = db.getExperiment(expName)
  if (!exp) throw new Error(`experiment "${expName}" not found`)
  // Ensure user has a variant assignment
  let assignment = db.getAssignment(expName, userId)
  if (!assignment) {
    const variant = assignVariant({ expName, userId, forced: forcedVariant })
    assignment = { variant }
  }
  db.insertMetric({
    expName,
    userId,
    variant: assignment.variant,
    metricName,
    value
  })
}

// Compute result for one experiment + one metric.
//
// Returns:
// {
//   experiment: { name, status, variants, ... },
//   metric: 'metric_name',
//   nPerVariant: { variant: n },
//   summary: { variant: { n, mean, stddev, ... } },
//   baseline: 'control',           // first variant alphabetically
//   comparisons: [
//     { variant, mean, n, lift, liftPct, pTwoSided, ciLower, ciUpper, significant }
//   ],
//   winner: 'treatment' | null,    // significant winner vs baseline
//   sampleSizeNeeded: { control: n, treatment: n, ... }  // recommended sample size per variant
// }
export function getResult(expName, metricName, { confidence = 0.95 } = {}) {
  const exp = db.getExperiment(expName)
  if (!exp) throw new Error(`experiment "${expName}" not found`)
  validateMetricName(metricName)

  const rawMetrics = db.fetchMetricsByVariant(expName, metricName)
  // Group by variant
  const byVariant = {}
  for (const v of exp.variants) byVariant[v] = []
  for (const row of rawMetrics) {
    if (byVariant[row.variant]) {
      byVariant[row.variant].push(row.value)
    }
  }
  const summaries = {}
  for (const v of exp.variants) {
    summaries[v] = summary(byVariant[v])
  }
  const nPerVariant = {}
  for (const v of exp.variants) nPerVariant[v] = summaries[v].n

  // Pick baseline: first variant alphabetically
  const baseline = [...exp.variants].sort()[0]
  const baselineValues = byVariant[baseline]

  const comparisons = []
  for (const v of exp.variants) {
    if (v === baseline) continue
    const test = welchTTest(baselineValues, byVariant[v], { confidence })
    const lift = relativeLift(summaries[v].mean, summaries[baseline].mean)
    comparisons.push({
      variant: v,
      mean: summaries[v].mean,
      n: summaries[v].n,
      lift,
      liftPct: lift == null ? null : lift * 100,
      pTwoSided: test.pTwoSided,
      ciLower: test.ciLower,
      ciUpper: test.ciUpper,
      significant: test.significant
    })
  }

  // Winner = first significant comparison
  let winner = null
  for (const c of comparisons) {
    if (c.significant && c.lift != null && c.lift > 0) {
      winner = c.variant
      break
    }
  }

  // Recommended sample size per variant (assuming 0.2 medium effect, 80% power, 0.05 alpha)
  const sampleSizeNeeded = {}
  for (const v of exp.variants) {
    sampleSizeNeeded[v] = minimumSampleSize({ cohensD: 0.2, alpha: 0.05, power: 0.8 })
  }

  return {
    experiment: {
      name: exp.name,
      status: exp.status,
      variants: exp.variants,
      description: exp.description,
      createdAt: exp.createdAt
    },
    metric: metricName,
    nPerVariant,
    summary: summaries,
    baseline,
    comparisons,
    winner,
    sampleSizeNeeded,
    confidence
  }
}

// List all metric names recorded for an experiment.
export function listMetrics(expName) {
  const exp = db.getExperiment(expName)
  if (!exp) throw new Error(`experiment "${expName}" not found`)
  return db.listMetricNames(expName)
}

// Convenience: list all experiments with a quick "what we have" summary
// for each (name, status, assignment count, metric count).
export function getOverview() {
  const all = db.listExperiments()
  return all.map(exp => {
    const counts = db.countAssignmentsByVariant(exp.name)
    const totalAssignments = counts.reduce((s, c) => s + c.n, 0)
    const metrics = db.listMetricNames(exp.name)
    return {
      name: exp.name,
      status: exp.status,
      variants: exp.variants,
      totalAssignments,
      metricsRecorded: metrics.length,
      createdAt: exp.createdAt
    }
  })
}

// Reset schema (test only)
export function resetForTest() {
  db.resetExperimentsSchemaForTest()
}
