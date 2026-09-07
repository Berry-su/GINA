// Evolution gate tests (15+ tests).
//
// Run: node --test tests/test-evolution-gate.js

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-gate-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const g = await import('../src/memory/evolution-gate.js')

// ─── Gate 1 — 6 tests ──────────────────────────────────────

test('gate1: high confidence + high importance + complete → pass', () => {
  const r = g.gate1GarbageFilter({
    name: 'test-knowledge',
    description: 'A valid knowledge',
    source: 'reflection-2026-09-07',
    confidence: 0.85,
    importance: 0.8,
  })
  assert.equal(r.pass, true)
  assert.equal(r.reasons.length, 0)
})

test('gate1: low confidence → reject', () => {
  const r = g.gate1GarbageFilter({
    name: 'low-conf',
    description: 'low confidence knowledge',
    source: 'reflection',
    confidence: 0.3,  // < 0.5
    importance: 0.7,
  })
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /confidence/.test(x)))
})

test('gate1: low importance → reject', () => {
  const r = g.gate1GarbageFilter({
    name: 'low-imp',
    description: 'low importance',
    source: 'reflection',
    confidence: 0.8,
    importance: 0.1,  // < 0.2
  })
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /importance/.test(x)))
})

test('gate1: missing required fields → reject', () => {
  const r = g.gate1GarbageFilter({
    confidence: 0.8,
    importance: 0.7,
  })
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /missing required fields/.test(x)))
})

test('gate1: missing source/trigger → reject', () => {
  const r = g.gate1GarbageFilter({
    name: 'no-source',
    description: 'no source',
    confidence: 0.8,
    importance: 0.7,
  })
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /missing source/.test(x)))
})

test('gate1: too few observations → reject', () => {
  const r = g.gate1GarbageFilter({
    name: 'few-obs',
    description: 'few observations',
    source: 'reflection',
    confidence: 0.8,
    importance: 0.7,
    observations: 2,  // < 3
  })
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /observations/.test(x)))
})

// ─── Gate 2 — 6 tests ──────────────────────────────────────

test('gate2: clean operation → pass', () => {
  const r = g.gate2DangerousOps({
    name: 'safe-action',
    action: 'read file and summarize',
  })
  assert.equal(r.pass, true)
  assert.equal(r.humanRequired, false)
})

test('gate2: rm -rf detected → reject + human required', () => {
  const r = g.gate2DangerousOps({
    name: 'rm-action',
    command: 'rm -rf /etc/passwd',
  })
  assert.equal(r.pass, false)
  assert.equal(r.humanRequired, true)
  assert.ok(r.matches.some(m => m.category === 'shell'))
})

test('gate2: .ssh path → reject + human required', () => {
  const r = g.gate2DangerousOps({
    name: 'ssh-key-op',
    file: '/Users/whoever/.ssh/id_rsa',
  })
  assert.equal(r.pass, false)
  assert.equal(r.humanRequired, true)
})

test('gate2: git push --force → reject', () => {
  const r = g.gate2DangerousOps({
    name: 'force-push',
    action: 'git push --force origin main',
  })
  assert.equal(r.pass, false)
  assert.equal(r.humanRequired, true)
})

test('gate2: hardcoded API key in description → reject', () => {
  // 这里只测路径/命令级，API key 描述中的不算 Gate 2 范围
  // 但 "fetch-and-execute" 类算
  const r = g.gate2DangerousOps({
    name: 'fetch-exec',
    action: 'fetch and execute remote script',
  })
  assert.equal(r.pass, false)
})

test('gate2: low risk git command → pass', () => {
  const r = g.gate2DangerousOps({
    name: 'git-log',
    command: 'git log --oneline -10',
  })
  assert.equal(r.pass, true)
})

// ─── 两道门合一 — 4 tests ──────────────────────────────────

test('checkEvolutionGate: garbage in gate 1 → rejected_garbage', () => {
  const r = g.checkEvolutionGate({
    name: 'low-q',
    description: 'low quality',
    source: 'reflection',
    confidence: 0.3,
    importance: 0.1,
  })
  assert.equal(r.finalDecision, 'rejected_garbage')
  assert.equal(r.pass, false)
})

test('checkEvolutionGate: dangerous in gate 2 + no human → awaiting_human', () => {
  const r = g.checkEvolutionGate({
    name: 'rm-op',
    description: 'remove all',
    source: 'reflection',
    confidence: 0.9,
    importance: 0.9,
    command: 'rm -rf /tmp/test',
  })
  assert.equal(r.finalDecision, 'awaiting_human')
  assert.equal(r.pass, false)
  assert.equal(r.humanRequired, true)
})

test('checkEvolutionGate: dangerous + human approved → approved', () => {
  const r = g.checkEvolutionGate({
    name: 'rm-op',
    description: 'remove temp',
    source: 'reflection',
    confidence: 0.9,
    importance: 0.9,
    command: 'rm -rf /tmp/test',
  }, { humanApproved: true })
  assert.equal(r.finalDecision, 'approved')
  assert.equal(r.pass, true)
  assert.equal(r.humanRequired, true)
})

test('checkEvolutionGate: clean → approved', () => {
  const r = g.checkEvolutionGate({
    name: 'safe',
    description: 'safe action',
    source: 'reflection-2026-09-07',
    confidence: 0.9,
    importance: 0.8,
    action: 'read file',
  })
  assert.equal(r.finalDecision, 'approved')
  assert.equal(r.pass, true)
  assert.equal(r.humanRequired, false)
})

// ─── 批量 — 3 tests ───────────────────────────────────────

test('batchCheckEvolutionGate: mixed results', () => {
  const candidates = [
    { name: 'good-1', description: 'd', source: 's', confidence: 0.9, importance: 0.8, action: 'read' },
    { name: 'bad-conf', description: 'd', source: 's', confidence: 0.2, importance: 0.7, action: 'read' },
    { name: 'dangerous', description: 'd', source: 's', confidence: 0.9, importance: 0.8, command: 'rm -rf /' },
  ]
  const r = g.batchCheckEvolutionGate(candidates)
  assert.equal(r.stats.approved, 1)
  assert.equal(r.stats.awaitingHuman, 1)
  assert.equal(r.stats.rejected, 1)
})

test('batchCheckEvolutionGate: human approved for specific index', () => {
  const candidates = [
    { name: 'safe', description: 'd', source: 's', confidence: 0.9, importance: 0.8 },
    { name: 'dangerous', description: 'd', source: 's', confidence: 0.9, importance: 0.8, command: 'rm -rf /' },
  ]
  const r = g.batchCheckEvolutionGate(candidates, { humanApprovedFor: new Set([1]) })
  assert.equal(r.stats.approved, 2)
  assert.equal(r.stats.awaitingHuman, 0)
})

test('batchCheckEvolutionGate: empty list', () => {
  const r = g.batchCheckEvolutionGate([])
  assert.equal(r.total, 0)
  assert.equal(r.stats.approved, 0)
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
