// Tool self-create framework tests (35+ tests).
//
// Run: node --test tests/test-tool-self-create.js
//
// Covers: tool-spec / tool-validator (3 gates) / tool-registry (canary/rollback) /
//         tool-generator (LLM-injected) / tool-evolution (decisions).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-toolself-'))
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const ts = await import('../src/tool-self-create/index.js')

// ─── Test helpers ───────────────────────────────────────────

function makeValidSpec(overrides = {}) {
  return {
    name: 'my_tool',
    version: '1.0.0',
    description: 'A test tool that does something safe',
    category: 'custom',
    inputs: [
      { name: 'x', type: 'string', required: true, description: 'input' },
    ],
    outputs: { name: 'result', type: 'string', description: 'output' },
    sideEffects: ['none'],
    testCases: [
      { name: 'smoke', args: ['hello'], expect: 'hello' },
    ],
    tags: ['test'],
    estimatedComplexity: 3,
    ...overrides,
  }
}

// ─── tool-spec — 8 tests ────────────────────────────────────

test('spec.validateSpec: valid spec passes', () => {
  assert.doesNotThrow(() => ts.validateSpec(makeValidSpec()))
})

test('spec.validateSpec: invalid name throws', () => {
  assert.throws(() => ts.validateSpec(makeValidSpec({ name: 'Bad-Name' })), /name must match/)
  assert.throws(() => ts.validateSpec(makeValidSpec({ name: 'a' })), /name must match/)   // too short
  assert.throws(() => ts.validateSpec(makeValidSpec({ name: '1abc' })), /name must match/)  // starts with digit
})

test('spec.validateSpec: invalid version throws', () => {
  assert.throws(() => ts.validateSpec(makeValidSpec({ version: '1.0' })), /semver/)
  assert.throws(() => ts.validateSpec(makeValidSpec({ version: 'abc' })), /semver/)
})

test('spec.validateSpec: empty sideEffects throws (must be explicit)', () => {
  assert.throws(() => ts.validateSpec(makeValidSpec({ sideEffects: [] })), /explicitly include/)
})

test('spec.validateSpec: invalid sideEffect throws', () => {
  assert.throws(() => ts.validateSpec(makeValidSpec({ sideEffects: ['nuke'] })), /invalid/)
})

test('spec.validateSpec: empty testCases throws (must prove works)', () => {
  assert.throws(() => ts.validateSpec(makeValidSpec({ testCases: [] })), /at least 1/)
})

test('spec.validateSpec: duplicate input names throws', () => {
  const bad = makeValidSpec()
  bad.inputs.push({ name: 'x', type: 'string', required: false })
  assert.throws(() => ts.validateSpec(bad), /duplicate/)
})

test('spec.specHash: same spec → same hash', () => {
  const a = makeValidSpec()
  const b = makeValidSpec()
  assert.equal(ts.specHash(a), ts.specHash(b))
})

test('spec.assessRisk: shell_exec high risk', () => {
  const a = ts.assessRisk(makeValidSpec({ sideEffects: ['none'], estimatedComplexity: 1 }))
  const b = ts.assessRisk(makeValidSpec({ sideEffects: ['shell_exec', 'fs_write'], estimatedComplexity: 8, category: 'shell' }))
  assert.ok(b > a)
  assert.ok(b >= 12)  // shell+fs_write+complexity+category
})

test('spec.isCompatibleVersion: same major compatible', () => {
  assert.equal(ts.isCompatibleVersion('1.0.0', '1.5.2'), true)
  assert.equal(ts.isCompatibleVersion('1.0.0', '2.0.0'), false)
  assert.equal(ts.isCompatibleVersion('1.0.0', '1.0.0'), true)
})

// ─── tool-validator (3 gates) — 10 tests ────────────────────

test('validator.gateSchema: valid spec passes', () => {
  const r = ts.gateSchema(makeValidSpec())
  assert.equal(r.pass, true)
})

test('validator.gateSchema: invalid spec fails', () => {
  const r = ts.gateSchema({ name: 'X' })
  assert.equal(r.pass, false)
  assert.ok(r.reasons.length > 0)
})

test('validator.gateSourceSafety: clean source passes', () => {
  const r = ts.gateSourceSafety('export function add(a, b) { return a + b }')
  assert.equal(r.pass, true)
})

test('validator.gateSourceSafety: eval() blocked', () => {
  const r = ts.gateSourceSafety('const x = eval("1+1")')
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /eval/.test(x)))
})

test('validator.gateSourceSafety: child_process blocked', () => {
  const r = ts.gateSourceSafety('import cp from "child_process"')
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /child_process/.test(x)))
})

test('validator.gateSourceSafety: hardcoded API key blocked', () => {
  const r = ts.gateSourceSafety('const apiKey = "sk-abc123def456ghi789jkl012mno"')
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /API key/.test(x)))
})

test('validator.gateSourceSafety: .ssh path blocked', () => {
  const r = ts.gateSourceSafety('const path = "/home/user/.ssh/id_rsa"')
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some(x => /\.ssh/.test(x)))
})

test('validator.gateSourceSafety: private network blocked', () => {
  const r = ts.gateSourceSafety('const url = "http://192.168.1.1/api"')
  assert.equal(r.pass, false)
})

test('validator.gateResourceLimits: spec without resources = advisory pass', () => {
  const r = ts.gateResourceLimits(makeValidSpec())
  assert.equal(r.pass, true)
  assert.equal(r.advisory, true)
})

test('validator.gateResourceLimits: spec exceeding limit fails', () => {
  const spec = makeValidSpec({ resources: { timeoutMs: 60000 } })
  const r = ts.gateResourceLimits(spec, { maxTimeoutMs: 30000 })
  assert.equal(r.pass, false)
  assert.match(r.reasons[0], /timeoutMs/)
})

test('validator.validateAll: combines 3 gates', () => {
  const r = ts.validateAll(
    makeValidSpec(),
    'export function add(a, b) { return a + b }',
  )
  assert.equal(r.pass, true)
  assert.ok(r.gates.schema)
  assert.ok(r.gates.sourceSafety)
  assert.ok(r.gates.resources)
})

test('validator.suggestCanaryPercent: low risk → 100%', () => {
  const r = ts.suggestCanaryPercent(makeValidSpec({ sideEffects: ['none'], estimatedComplexity: 1 }))
  assert.equal(r.percent, 100)
})

test('validator.suggestCanaryPercent: high risk → low percent', () => {
  const r = ts.suggestCanaryPercent(makeValidSpec({ sideEffects: ['shell_exec', 'fs_write', 'net_call'], estimatedComplexity: 9, category: 'shell' }))
  assert.ok(r.percent <= 10)
})

// ─── tool-registry — 8 tests ────────────────────────────────

test('registry.register: v1 with no currentVersion becomes current', () => {
  const reg = ts.defaultRegistry()
  const r = ts.register(reg, { spec: makeValidSpec(), source: 'export const x = 1' })
  assert.equal(r.name, 'my_tool')
  assert.equal(r.version, '1.0.0')
  const got = ts.get(reg, 'my_tool')
  assert.equal(got.version, '1.0.0')
  assert.equal(got.status, 'canary')
  assert.equal(got.canaryPercent, 1)
})

test('registry.register: duplicate version without replace throws', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  assert.throws(() => ts.register(reg, { spec: makeValidSpec(), source: 'x' }), /already registered/)
})

test('registry.advanceCanary: insufficient calls → no advance', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  const r = ts.advanceCanary(reg, 'my_tool', { calls: 5, errors: 0 })
  assert.equal(r.advanced, false)
  assert.match(r.reason, /not enough calls/)
})

test('registry.advanceCanary: high error rate → no advance', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  const r = ts.advanceCanary(reg, 'my_tool', { calls: 100, errors: 20 })
  assert.equal(r.advanced, false)
  assert.match(r.reason, /error rate/)
})

test('registry.advanceCanary: good stats → 1% → 5%', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  const r = ts.advanceCanary(reg, 'my_tool', { calls: 100, errors: 1 })
  assert.equal(r.advanced, true)
  assert.equal(r.canaryPercent, 5)
})

test('registry.advanceCanary: 100 → stable', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  // 1→5→25→50→100→stable 需要 5 次 advance
  ts.advanceCanary(reg, 'my_tool', { calls: 100, errors: 0 })
  ts.advanceCanary(reg, 'my_tool', { calls: 100, errors: 0 })
  ts.advanceCanary(reg, 'my_tool', { calls: 100, errors: 0 })
  ts.advanceCanary(reg, 'my_tool', { calls: 100, errors: 0 })
  const r = ts.advanceCanary(reg, 'my_tool', { calls: 100, errors: 0 })
  assert.equal(r.status, 'stable')
})

test('registry.rollback: needs previousVersion', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  const r = ts.rollback(reg, 'my_tool')
  assert.equal(r.rolled, false)
  assert.match(r.reason, /no previous/)
})

test('registry.rollback: from v2 to v1 marks v2 deprecated', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec({ version: '1.0.0' }), source: 'x', status: 'stable' })
  ts.register(reg, { spec: makeValidSpec({ version: '1.1.0' }), source: 'y', status: 'stable', previousVersion: '1.0.0' })
  const r = ts.rollback(reg, 'my_tool', { reason: 'broken' })
  assert.equal(r.rolled, true)
  assert.equal(r.current, '1.0.0')
  const v11 = reg.tools.my_tool.versions['1.1.0']
  assert.equal(v11.status, 'deprecated')
})

test('registry.recordCall: increments stats', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  ts.recordCall(reg, 'my_tool')
  ts.recordCall(reg, 'my_tool', { error: true, errorMessage: 'boom' })
  const got = ts.get(reg, 'my_tool')
  assert.equal(got.stats.calls, 2)
  assert.equal(got.stats.errors, 1)
  assert.equal(got.stats.lastError, 'boom')
})

// ─── tool-generator — 4 tests ───────────────────────────────

test('generator.buildPrompt: includes spec details', () => {
  const spec = makeValidSpec()
  const p = ts.buildPrompt(spec)
  assert.match(p, /my_tool/)
  assert.match(p, /A test tool/)
  assert.match(p, /Side effects/)
  assert.match(p, /Test cases/)
})

test('generator.stripCodeFences: removes markdown fences', () => {
  assert.equal(ts.stripCodeFences('```js\nfoo()\n```'), 'foo()')
  assert.equal(ts.stripCodeFences('```javascript\nfoo()\n```'), 'foo()')
  assert.equal(ts.stripCodeFences('foo()'), 'foo()')
  assert.equal(ts.stripCodeFences('  ```\nfoo()\n```  '), 'foo()')
})

test('generator.generate: passes clean source', async () => {
  const spec = makeValidSpec()
  const r = await ts.generate(spec, {
    generateCode: async () => 'export function my_tool(x) { return x }',
  })
  assert.equal(r.validation.pass, true)
  assert.equal(r.failed, undefined || false)
})

test('generator.generate: blocked source → returns failed', async () => {
  const spec = makeValidSpec()
  const r = await ts.generate(spec, {
    generateCode: async () => 'const x = eval("1")',
  })
  assert.equal(r.validation.pass, false)
  assert.equal(r.failed, true)
})

test('generator.generate: with testRunner, runs tests', async () => {
  const spec = makeValidSpec()
  const r = await ts.generate(spec, {
    generateCode: async () => 'export function my_tool(x) { return x }',
    testRunner: async (source, testCases) => {
      // Just return all passed (we don't actually run the source for safety)
      return { passed: testCases.length, failed: 0, details: [] }
    },
  })
  assert.equal(r.testResults.passed, 1)
  assert.equal(r.testResults.failed, 0)
})

// ─── tool-evolution — 6 tests ───────────────────────────────

test('evolution.detectGap: covered by existing tool → no proposal', () => {
  const r = ts.detectGap({
    intent: { category: 'shell', toolHint: 'my_tool' },
    existingTools: [{ name: 'my_tool' }],
    failureCount: 0,
  })
  assert.equal(r.shouldPropose, false)
})

test('evolution.detectGap: many failures + category → propose', () => {
  const r = ts.detectGap({
    intent: {
      category: 'shell',
      toolHint: 'new_shell_helper',
      description: 'needs a shell helper',
      inputs: [{ name: 'cmd', type: 'string', required: true }],
    },
    existingTools: [],
    failureCount: 10,
  })
  assert.equal(r.shouldPropose, true)
  assert.ok(r.suggestedSpec)
  assert.equal(r.suggestedSpec.category, 'shell')
})

test('evolution.shouldUpgrade: low error rate → no upgrade', () => {
  const r = ts.shouldUpgrade({
    toolName: 'x',
    currentStats: { calls: 100, errors: 1 },
  })
  assert.equal(r.shouldUpgrade, false)
})

test('evolution.shouldUpgrade: high error rate → major bump', () => {
  const r = ts.shouldUpgrade({
    toolName: 'x',
    currentStats: { calls: 100, errors: 50 },
  })
  assert.equal(r.shouldUpgrade, true)
  assert.equal(r.suggestedBump, 'major')
})

test('evolution.shouldDeprecate: 100 days idle + enough calls → deprecate', () => {
  const now = Date.now()
  const r = ts.shouldDeprecate({
    toolName: 'x',
    lastCallAt: new Date(now - 100 * 86400 * 1000).toISOString(),
    calls: 50,
    now,
  })
  assert.equal(r.shouldDeprecate, true)
})

test('evolution.evaluate: returns prioritized proposals', () => {
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  // simulate high errors
  for (let i = 0; i < 60; i++) ts.recordCall(reg, 'my_tool')
  for (let i = 0; i < 30; i++) ts.recordCall(reg, 'my_tool', { error: true })
  const r = ts.evaluate({ registry: reg })
  assert.ok(r.length > 0)
  // First should be upgrade with major bump (priority 4)
  const upgrade = r.find(p => p.action === 'upgrade')
  assert.ok(upgrade)
  assert.equal(upgrade.suggestedBump, 'major')
})

// ─── integration — 2 tests ──────────────────────────────────

test('integration: end-to-end register after generate', async () => {
  const reg = ts.defaultRegistry()
  const spec = makeValidSpec()
  const r = await ts.generate(spec, {
    generateCode: async () => 'export function my_tool(x) { return x }',
  })
  assert.equal(r.validation.pass, true)
  const reg2 = ts.register(reg, { spec: r.spec, source: r.source })
  assert.equal(reg2.status, 'canary')
  const got = ts.get(reg, 'my_tool')
  assert.equal(got.spec.name, 'my_tool')
})

test('integration: state persistence round-trip', () => {
  const statePath = path.join(TMP_HOME, 'registry.json')
  const reg = ts.defaultRegistry()
  ts.register(reg, { spec: makeValidSpec(), source: 'x' })
  ts.saveRegistry(reg, statePath)
  assert.ok(fs.existsSync(statePath))
  const reg2 = ts.loadRegistry(statePath)
  const got = ts.get(reg2, 'my_tool')
  assert.equal(got.spec.name, 'my_tool')
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
