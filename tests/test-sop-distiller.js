// SOP distiller tests (20+ tests).
//
// Run: node --test tests/test-sop-distiller.js

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-sop-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const s = await import('../src/memory/sop-distiller.js')

// ─── clusterExperiences — 5 tests ───────────────────────────

test('cluster: similar triggers grouped', () => {
  const exps = [
    { trigger: 'git push failed', confidence: 0.8 },
    { trigger: 'git push failed', confidence: 0.7 },
    { trigger: 'git push failed', confidence: 0.9 },
  ]
  const clusters = s.clusterExperiences(exps, { similarityThreshold: 0.3 })
  // 应该聚成 1 组（trigger 完全相同）
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].occurrences, 3)
})

test('cluster: different triggers → multiple clusters', () => {
  const exps = [
    { trigger: 'git push failed', confidence: 0.8 },
    { trigger: 'mcp connection lost', confidence: 0.7 },
  ]
  const clusters = s.clusterExperiences(exps, { similarityThreshold: 0.5 })
  assert.equal(clusters.length, 2)
})

test('cluster: high similarity threshold → fewer merges', () => {
  const exps = [
    { trigger: 'git push failed on main branch', confidence: 0.8 },
    { trigger: 'git push failed on dev branch', confidence: 0.8 },
  ]
  const loose = s.clusterExperiences(exps, { similarityThreshold: 0.3 })
  const strict = s.clusterExperiences(exps, { similarityThreshold: 0.9 })
  assert.ok(loose.length <= strict.length)
})

test('cluster: avgConfidence computed', () => {
  const clusters = s.clusterExperiences([
    { trigger: 'fix me', confidence: 0.8 },
    { trigger: 'fix me', confidence: 0.6 },
    { trigger: 'fix me', confidence: 1.0 },
  ])
  assert.equal(clusters[0].occurrences, 3)
  assert.ok(Math.abs(clusters[0].avgConfidence - 0.8) < 0.01)
})

test('cluster: empty list → no clusters', () => {
  const clusters = s.clusterExperiences([])
  assert.equal(clusters.length, 0)
})

// ─── generateSOPs — 6 tests ────────────────────────────────

test('generateSOPs: high frequency + high confidence → SOP', () => {
  const clusters = [{
    trigger: 'git push failed',
    occurrences: 5,
    avgConfidence: 0.85,
    avgImportance: 0.7,
    experiences: [
      { trigger: 'git push failed', action: 'git status', outcome: 'success', timestamp: 1, confidence: 0.9 },
      { trigger: 'git push failed', action: 'git pull origin main', outcome: 'success', timestamp: 2, confidence: 0.8 },
      { trigger: 'git push failed', action: 'git push', outcome: 'success', timestamp: 3, confidence: 0.85 },
    ],
  }]
  const sops = s.generateSOPs(clusters)
  assert.equal(sops.length, 1)
  assert.equal(sops[0].steps.length, 3)
  assert.equal(sops[0].status, 'pending_review')
})

test('generateSOPs: low frequency → no SOP', () => {
  const clusters = [{
    trigger: 'rare thing',
    occurrences: 1,  // < 3
    avgConfidence: 0.9,
    avgImportance: 0.5,
    experiences: [{ trigger: 'rare thing', action: 'wait' }],
  }]
  const sops = s.generateSOPs(clusters)
  assert.equal(sops.length, 0)
})

test('generateSOPs: low confidence → no SOP', () => {
  const clusters = [{
    trigger: 'unconfident',
    occurrences: 5,
    avgConfidence: 0.3,  // < 0.6
    avgImportance: 0.5,
    experiences: [
      { trigger: 'unconfident', action: 'a', confidence: 0.3 },
      { trigger: 'unconfident', action: 'a', confidence: 0.3 },
      { trigger: 'unconfident', action: 'a', confidence: 0.3 },
    ],
  }]
  const sops = s.generateSOPs(clusters)
  assert.equal(sops.length, 0)
})

test('generateSOPs: successRate computed', () => {
  const clusters = [{
    trigger: 'mixed outcome',
    occurrences: 4,
    avgConfidence: 0.8,
    avgImportance: 0.7,
    experiences: [
      { trigger: 'x', action: 'a', outcome: 'success' },
      { trigger: 'x', action: 'a', outcome: 'success' },
      { trigger: 'x', action: 'a', outcome: 'failure' },
      { trigger: 'x', action: 'a', outcome: 'success' },
    ],
  }]
  const sops = s.generateSOPs(clusters)
  assert.equal(sops.length, 1)
  assert.equal(sops[0].successRate, 0.75)
})

test('generateSOPs: step type inference', () => {
  const clusters = [{
    trigger: 'types',
    occurrences: 4,
    avgConfidence: 0.8,
    avgImportance: 0.7,
    experiences: [
      { trigger: 'x', action: 'read file', outcome: 'success' },
      { trigger: 'x', action: 'write data', outcome: 'success' },
      { trigger: 'x', action: 'validate input', outcome: 'success' },
      { trigger: 'x', action: 'call tool', outcome: 'success' },
    ],
  }]
  const sops = s.generateSOPs(clusters)
  const steps = sops[0].steps
  assert.equal(steps[0].type, 'read')
  assert.equal(steps[1].type, 'write')
  assert.equal(steps[2].type, 'validate')
  assert.equal(steps[3].type, 'tool_call')
})

test('generateSOPs: maxSteps limit', () => {
  const clusters = [{
    trigger: 'long',
    occurrences: 30,
    avgConfidence: 0.8,
    avgImportance: 0.7,
    experiences: Array(30).fill(null).map((_, i) => ({
      trigger: 'long',
      action: `step ${i}`,
      outcome: 'success',
      timestamp: i,
      confidence: 0.8,
    })),
  }]
  const sops = s.generateSOPs(clusters, { maxSteps: 5 })
  assert.equal(sops[0].steps.length, 5)
})

// ─── saveSOPs / loadSOPs — 3 tests ─────────────────────────

test('saveSOPs: writes to file', () => {
  const file = path.join(TMP_HOME, 'sops.jsonl')
  const sops = [
    { id: 'sop1', trigger: 't1', steps: [{ order: 1, action: 'a' }], status: 'pending_review' },
    { id: 'sop2', trigger: 't2', steps: [], status: 'pending_review' },
  ]
  const r = s.saveSOPs(sops, { sopFile: file })
  assert.equal(r.saved, 2)
  assert.ok(fs.existsSync(file))
})

test('loadSOPs: reads back', () => {
  const file = path.join(TMP_HOME, 'load-test.jsonl')
  s.saveSOPs([{ id: 'sop1', trigger: 't1', steps: [], status: 'pending_review' }], { sopFile: file })
  const loaded = s.loadSOPs({ sopFile: file })
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'sop1')
})

test('loadSOPs: empty file returns []', () => {
  const file = path.join(TMP_HOME, 'nonexistent.jsonl')
  const loaded = s.loadSOPs({ sopFile: file })
  assert.equal(loaded.length, 0)
})

// ─── distillSOPs 一站式 — 4 tests ──────────────────────────

test('distillSOPs: end-to-end dryRun', async () => {
  const exps = [
    { trigger: 'fix bug', action: 'reproduce', outcome: 'success', confidence: 0.8, timestamp: 1 },
    { trigger: 'fix bug', action: 'debug', outcome: 'success', confidence: 0.9, timestamp: 2 },
    { trigger: 'fix bug', action: 'fix', outcome: 'success', confidence: 0.85, timestamp: 3 },
    { trigger: 'fix bug', action: 'verify', outcome: 'success', confidence: 0.9, timestamp: 4 },
  ]
  const r = await s.distillSOPs({ experiences: exps, dryRun: true })
  assert.equal(r.dryRun, true)
  assert.equal(r.stats.sopsGenerated, 1)
  assert.equal(r.saved, null)
  assert.equal(r.sops[0].status, 'pending_review')
})

test('distillSOPs: dryRun=false → persists to file', async () => {
  const file = path.join(TMP_HOME, 'sop-dryrun.jsonl')
  const exps = [
    { trigger: 'action', action: 'step1', outcome: 'success', confidence: 0.8, timestamp: 1 },
    { trigger: 'action', action: 'step2', outcome: 'success', confidence: 0.8, timestamp: 2 },
    { trigger: 'action', action: 'step3', outcome: 'success', confidence: 0.8, timestamp: 3 },
  ]
  const r = await s.distillSOPs({ experiences: exps, dryRun: false, sopFile: file })
  assert.equal(r.dryRun, false)
  assert.equal(r.saved.saved, 1)
  assert.ok(fs.existsSync(file))
})

test('distillSOPs: empty experience list', async () => {
  const r = await s.distillSOPs({ experiences: [], dryRun: true })
  assert.equal(r.sops.length, 0)
  assert.equal(r.stats.sopsGenerated, 0)
})

test('distillSOPs: respects custom thresholds', async () => {
  const exps = Array(2).fill(null).map((_, i) => ({
    trigger: 'rare',
    action: `step${i}`,
    outcome: 'success',
    confidence: 0.8,
    timestamp: i,
  }))
  // 默认 minOccurrences=3 → 不生成
  const r1 = await s.distillSOPs({ experiences: exps, dryRun: true })
  assert.equal(r1.sops.length, 0)
  // 改 minOccurrences=2 → 生成
  const r2 = await s.distillSOPs({ experiences: exps, dryRun: true, minOccurrences: 2 })
  assert.equal(r2.sops.length, 1)
})

// ─── approveSOP / rejectSOP — 2 tests ─────────────────────

test('approveSOP: marks approved + approvedBy + approvedAt', () => {
  const sop = { id: 'sop1', status: 'pending_review' }
  const approved = s.approveSOP(sop, { approvedBy: 'boss' })
  assert.equal(approved.status, 'approved')
  assert.equal(approved.approvedBy, 'boss')
  assert.ok(approved.approvedAt)
})

test('rejectSOP: marks rejected + reason', () => {
  const sop = { id: 'sop1', status: 'pending_review' }
  const rejected = s.rejectSOP(sop, { reason: 'too narrow' })
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.reason, 'too narrow')
})

// ─── listSOPs — 2 tests ────────────────────────────────────

test('listSOPs: filter by status', () => {
  const sops = [
    { id: '1', status: 'pending_review', avgConfidence: 0.7 },
    { id: '2', status: 'approved', avgConfidence: 0.9 },
    { id: '3', status: 'rejected', avgConfidence: 0.5 },
  ]
  const pending = s.listSOPs(sops, { status: 'pending_review' })
  assert.equal(pending.length, 1)
  assert.equal(pending[0].id, '1')
})

test('listSOPs: sorted by confidence desc', () => {
  const sops = [
    { id: '1', status: 'pending_review', avgConfidence: 0.5 },
    { id: '2', status: 'pending_review', avgConfidence: 0.9 },
    { id: '3', status: 'pending_review', avgConfidence: 0.7 },
  ]
  const sorted = s.listSOPs(sops, { status: 'pending_review' })
  assert.equal(sorted[0].id, '2')
  assert.equal(sorted[1].id, '3')
  assert.equal(sorted[2].id, '1')
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
