// Importance-weighted decay tests (15+ tests).
//
// Run: node --test tests/test-importance-decay.js

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-decay-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const d = await import('../src/memory/importance-decay.js')

// ─── 公式 — 5 tests ─────────────────────────────────────────

test('formula: importance=0.0 → effectiveDecayMs = 1.0x base', () => {
  const base = 30 * 24 * 60 * 60 * 1000  // 30 天
  const eff = d.importanceDecayMs({}, { baseDecayMs: base, importance: 0.0 })
  assert.equal(eff, base)
})

test('formula: importance=0.5 → effectiveDecayMs = 1.5x base', () => {
  const base = 30 * 24 * 60 * 60 * 1000
  const eff = d.importanceDecayMs({}, { baseDecayMs: base, importance: 0.5 })
  assert.equal(eff, base * 1.5)
})

test('formula: importance=1.0 → effectiveDecayMs = 2.0x base', () => {
  const base = 30 * 24 * 60 * 60 * 1000
  const eff = d.importanceDecayMs({}, { baseDecayMs: base, importance: 1.0 })
  assert.equal(eff, base * 2.0)
})

test('formula: importance clamp [0, 1]', () => {
  const base = 30 * 24 * 60 * 60 * 1000
  assert.equal(d.importanceDecayMs({}, { baseDecayMs: base, importance: -0.5 }), base)
  assert.equal(d.importanceDecayMs({}, { baseDecayMs: base, importance: 1.5 }), base * 2.0)
})

test('formula: minimum 1 day protection', () => {
  const eff = d.importanceDecayMs({}, { baseDecayMs: 100, importance: 0 })
  assert.ok(eff >= d.MIN_DECAY_MS, 'must be at least MIN_DECAY_MS')
})

// ─── extractImportance — 4 tests ───────────────────────────

test('extractImportance: knowledge.importance priority', () => {
  assert.equal(d.extractImportance({ importance: 0.8 }), 0.8)
  assert.equal(d.extractImportance({ importance: 1.5 }), 1)
  assert.equal(d.extractImportance({ importance: -0.3 }), 0)
})

test('extractImportance: metadata.importance fallback', () => {
  assert.equal(d.extractImportance({ metadata: { importance: 0.7 } }), 0.7)
})

test('extractImportance: salience fallback', () => {
  assert.equal(d.extractImportance({ salience: 0.6 }), 0.6)
})

test('extractImportance: default 0.5 if nothing', () => {
  assert.equal(d.extractImportance({}), 0.5)
  assert.equal(d.extractImportance(null), 0.5)
})

// ─── shouldDecay — 4 tests ─────────────────────────────────

test('shouldDecay: 30 天 + importance 0.0 → should decay (base 1.0x)', () => {
  const base = 30 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const k = { lastUsedAt: now - 31 * 24 * 60 * 60 * 1000, importance: 0 }
  const r = d.shouldDecay(k, { baseDecayMs: base, now })
  assert.equal(r.shouldDecay, true)
})

test('shouldDecay: 30 天 + importance 1.0 → should NOT decay (2.0x = 60 天门槛)', () => {
  const base = 30 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const k = { lastUsedAt: now - 31 * 24 * 60 * 60 * 1000, importance: 1.0 }
  const r = d.shouldDecay(k, { baseDecayMs: base, now })
  assert.equal(r.shouldDecay, false)
  assert.equal(r.effectiveDecayMs, base * 2)
})

test('shouldDecay: 60 天 + importance 1.0 → should decay', () => {
  const base = 30 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const k = { lastUsedAt: now - 61 * 24 * 60 * 60 * 1000, importance: 1.0 }
  const r = d.shouldDecay(k, { baseDecayMs: base, now })
  assert.equal(r.shouldDecay, true)
})

test('shouldDecay: 5 天 + importance 0 → should NOT decay', () => {
  const base = 30 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const k = { lastUsedAt: now - 5 * 24 * 60 * 60 * 1000, importance: 0 }
  const r = d.shouldDecay(k, { baseDecayMs: base, now })
  assert.equal(r.shouldDecay, false)
})

// ─── applyImportanceDecay — 4 tests ────────────────────────

test('applyImportanceDecay: mixed importance → different fates', () => {
  const now = Date.now()
  const base = 30 * 24 * 60 * 60 * 1000
  const list = [
    { id: 'high', lastUsedAt: now - 40 * 86400 * 1000, importance: 0.9 },   // importance 0.9 → 60天门槛 → 40天 < 60 → keep
    { id: 'low', lastUsedAt: now - 40 * 86400 * 1000, importance: 0.0 },    // importance 0 → 30天门槛 → 40天 > 30 → deprecate
    { id: 'fresh', lastUsedAt: now - 5 * 86400 * 1000, importance: 0.5 },  // fresh → keep
  ]
  const r = d.applyImportanceDecay(list, { baseDecayMs: base, now })
  assert.equal(r.stats.deprecating, 1)
  assert.equal(r.stats.keeping, 2)
  assert.equal(r.toDeprecate[0].knowledge.id, 'low')
  assert.equal(r.toKeep.find(k => k.knowledge.id === 'high') != null, true)
  assert.equal(r.toKeep.find(k => k.knowledge.id === 'fresh') != null, true)
})

test('applyImportanceDecay: empty list', () => {
  const r = d.applyImportanceDecay([])
  assert.equal(r.stats.total, 0)
})

test('applyImportanceDecay: stats.avgImportance', () => {
  const now = Date.now()
  const r = d.applyImportanceDecay([
    { id: '1', lastUsedAt: now - 10 * 86400 * 1000, importance: 0.8 },
    { id: '2', lastUsedAt: now - 10 * 86400 * 1000, importance: 0.4 },
  ], { baseDecayMs: 30 * 86400 * 1000, now })
  assert.ok(Math.abs(r.stats.avgImportance - 0.6) < 0.001)
})

test('applyImportanceDecay: large list batch', () => {
  const now = Date.now()
  const list = []
  for (let i = 0; i < 100; i++) {
    list.push({
      id: `k${i}`,
      lastUsedAt: now - 10 * 86400 * 1000,
      importance: i / 100,
    })
  }
  const r = d.applyImportanceDecay(list, { baseDecayMs: 30 * 86400 * 1000, now })
  assert.equal(r.stats.total, 100)
  assert.equal(r.stats.keeping, 100)  // 10 天 < 30 天门槛
})

// ─── explainDecay — 3 tests ─────────────────────────────────

test('explainDecay: returns Chinese label for high importance', () => {
  const now = Date.now()
  const k = { lastUsedAt: now - 40 * 86400 * 1000, importance: 0.8 }
  const r = d.explainDecay(k, { baseDecayMs: 30 * 86400 * 1000, now })
  assert.match(r.summary, /高/)
  assert.equal(r.decision.shouldDecay, false)
})

test('explainDecay: returns Chinese label for low importance', () => {
  const now = Date.now()
  const k = { lastUsedAt: now - 40 * 86400 * 1000, importance: 0.2 }
  const r = d.explainDecay(k, { baseDecayMs: 30 * 86400 * 1000, now })
  assert.match(r.summary, /低/)
  assert.equal(r.decision.shouldDecay, true)
})

test('explainDecay: returns Chinese label for medium importance', () => {
  const now = Date.now()
  const k = { lastUsedAt: now - 10 * 86400 * 1000, importance: 0.5 }
  const r = d.explainDecay(k, { baseDecayMs: 30 * 86400 * 1000, now })
  assert.match(r.summary, /中/)
})

// ─── importanceWeightedDecay — 3 tests ──────────────────────

test('importanceWeightedDecay: marks deprecated with reason', () => {
  const now = Date.now()
  const base = 30 * 24 * 60 * 60 * 1000
  const list = [
    { id: 'old-low', lastUsedAt: now - 35 * 86400 * 1000, importance: 0.1, status: 'active' },
  ]
  const r = d.importanceWeightedDecay(list, { baseDecayMs: base, now })
  assert.equal(r.deprecated.length, 1)
  assert.equal(r.deprecated[0].status, 'deprecated')
  assert.equal(r.deprecated[0].decayReason, 'importance_weighted')
  assert.equal(r.deprecated[0].decayedAt, now)
})

test('importanceWeightedDecay: skips non-active', () => {
  const now = Date.now()
  const list = [
    { id: 'already', status: 'deprecated', lastUsedAt: now - 100 * 86400 * 1000 },
  ]
  const r = d.importanceWeightedDecay(list, { now })
  assert.equal(r.stats.total, 0)
})

test('importanceWeightedDecay: integration stats', () => {
  const now = Date.now()
  const base = 30 * 24 * 60 * 60 * 1000
  const list = [
    { id: '1', lastUsedAt: now - 40 * 86400 * 1000, importance: 0.1, status: 'active' },
    { id: '2', lastUsedAt: now - 40 * 86400 * 1000, importance: 0.9, status: 'active' },
    { id: '3', lastUsedAt: now - 5 * 86400 * 1000, importance: 0.5, status: 'active' },
  ]
  const r = d.importanceWeightedDecay(list, { baseDecayMs: base, now })
  assert.equal(r.stats.deprecated, 1)
  assert.ok(r.stats.avgImportance > 0.4 && r.stats.avgImportance < 0.6)
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
