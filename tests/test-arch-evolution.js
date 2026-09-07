// Architecture self-evolution framework tests (30+ tests).
//
// Run: node --test tests/test-arch-evolution.js
//
// Covers: arch-graph / arch-metrics / arch-analyzer / arch-rewriter (dryRun) /
//         arch-controller (orchestrator + report).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-arch-'))
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const ae = await import('../src/arch-evolution/index.js')

// ─── Test helpers ───────────────────────────────────────────

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-arch-tree-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

function cleanupTree(root) {
  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
}

// ─── arch-graph — 7 tests ───────────────────────────────────

test('graph.walkJsFiles: finds .js files', () => {
  const root = makeTree({
    'a.js': 'export const a = 1',
    'b.mjs': 'export const b = 2',
    'c.txt': 'not js',
    'sub/d.js': 'export const d = 3',
  })
  const files = ae.walkJsFiles(root)
  assert.ok(files.some(f => f.endsWith('a.js')))
  assert.ok(files.some(f => f.endsWith('b.mjs')))
  assert.ok(files.some(f => f.endsWith('d.js')))
  assert.ok(!files.some(f => f.endsWith('c.txt')))
  cleanupTree(root)
})

test('graph.walkJsFiles: skips node_modules', () => {
  const root = makeTree({
    'a.js': 'x',
    'node_modules/pkg/index.js': 'y',
  })
  const files = ae.walkJsFiles(root)
  assert.ok(files.some(f => f.endsWith('a.js')))
  assert.ok(!files.some(f => f.includes('node_modules')))
  cleanupTree(root)
})

test('graph.extractImports: parses multiple forms', () => {
  const src = `
import x from './foo.js'
import { y } from '../bar.js'
import z from 'lodash'
import fs from 'node:fs'
const m = await import('./dyn.js')
export { q } from './reexport.js'
`
  const imps = ae.extractImports(src, '/x/y.js')
  const specs = imps.map(i => i.spec)
  assert.ok(specs.includes('./foo.js'))
  assert.ok(specs.includes('../bar.js'))
  assert.ok(specs.includes('lodash'))
  assert.ok(specs.includes('node:fs'))
  assert.ok(specs.includes('./dyn.js'))
  assert.ok(specs.includes('./reexport.js'))
  cleanupTree(null)
})

test('graph.classifyImport: returns correct kind', () => {
  assert.equal(ae.classifyImport('./foo', '/x.js'), 'relative')
  assert.equal(ae.classifyImport('/abs/path', '/x.js'), 'absolute')
  assert.equal(ae.classifyImport('node:fs', '/x.js'), 'builtin')
  assert.equal(ae.classifyImport('lodash', '/x.js'), 'npm')
  assert.equal(ae.classifyImport('@org/pkg', '/x.js'), 'npm')
})

test('graph.buildGraph: simple tree with no cycles', () => {
  const root = makeTree({
    'a.js': `import { b } from './b.js'\nexport const a = b + 1`,
    'b.js': `export const b = 2`,
  })
  const g = ae.buildGraph(root)
  assert.equal(g.stats.files, 2)
  assert.equal(g.stats.edges, 1)
  assert.equal(g.cycles.length, 0)
  assert.equal(g.edges[0].from.endsWith('a.js'), true)
  assert.equal(g.edges[0].to.endsWith('b.js'), true)
  cleanupTree(root)
})

test('graph.buildGraph: detects cycle', () => {
  const root = makeTree({
    'a.js': `import './b.js'\nexport const a = 1`,
    'b.js': `import './a.js'\nexport const b = 2`,
  })
  const g = ae.buildGraph(root)
  assert.equal(g.stats.cycles, 1)
  assert.ok(g.cycles[0].length >= 2)
  cleanupTree(root)
})

test('graph.getFanIn / getFanOut', () => {
  const root = makeTree({
    'a.js': `import './x.js'\nimport './y.js'`,
    'b.js': `import './x.js'`,
    'x.js': `export const x = 1`,
    'y.js': `export const y = 1`,
  })
  const g = ae.buildGraph(root)
  const xFile = g.nodes.find(n => n.endsWith('x.js'))
  const aFile = g.nodes.find(n => n.endsWith('a.js'))
  assert.equal(ae.getFanIn(g.edges, xFile), 2)
  assert.equal(ae.getFanOut(g.edges, aFile), 2)
  cleanupTree(root)
})

// ─── arch-metrics — 7 tests ─────────────────────────────────

test('metrics.fileMetrics: counts lines + functions', () => {
  const m = ae.fileMetrics('test.js', `
export function foo() { return 1 }
export function bar() { return 2 }
export class Baz { method() {} }
export const arrow = () => 3
// comment
// another
`)
  assert.equal(m.functionCount >= 3, true)
  assert.equal(m.classCount, 1)
  assert.equal(m.exportCount >= 4, true)
  assert.equal(m.cyclomatic >= 1, true)
})

test('metrics.fileMetrics: detects nesting', () => {
  const m = ae.fileMetrics('test.js', `
function f() {
  if (true) {
    if (false) {
      if (1) {
        return 1
      }
    }
  }
}
`)
  assert.ok(m.maxNesting >= 4)
})

test('metrics.nodeMetrics: computes fanIn/fanOut + instability', () => {
  const root = makeTree({
    'a.js': `import './x.js'`,
    'b.js': `import './x.js'`,
    'x.js': `import './a.js'\nexport const x = 1`,
  })
  const g = ae.buildGraph(root)
  const metrics = ae.nodeMetrics(g)
  const x = metrics.find(m => m.file.endsWith('x.js'))
  // x has fanIn=2 (a, b import x), fanOut=1 (x imports a)
  assert.equal(x.fanIn, 2)
  assert.equal(x.fanOut, 1)
  // instability = 1/3
  assert.ok(Math.abs(x.instability - 0.333) < 0.01)
  cleanupTree(root)
})

test('metrics.deadCodeCandidates: detects low fanIn + small file', () => {
  const root = makeTree({
    'a.js': `import './b.js'\nexport const a = 1`,
    'b.js': `import './c.js'\nexport const b = 2`,
    'c.js': `import './d.js'\nexport const c = 3`,
    'd.js': `import './e.js'\nexport const d = 4`,
    'e.js': `import './f.js'\nexport const e = 5`,
    'f.js': `import './g.js'\nexport const f = 6`,
    'g.js': `import './h.js'\nexport const g = 7`,
    'h.js': `export const h = 8`,  // isolated
  })
  const g = ae.buildGraph(root)
  const metrics = ae.computeAll(g)
  // h.js is isolated (fanIn=0)
  const dead = metrics.deadCode.find(d => d.file.endsWith('h.js'))
  assert.ok(dead, 'h.js should be flagged as dead code')
  cleanupTree(root)
})

test('metrics.hotPathCandidates: high fanIn detected', () => {
  const root = makeTree({})
  // Create 60 files importing x
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'x.js'), 'export const x = 1\n'.repeat(300))
  for (let i = 0; i < 60; i++) {
    fs.writeFileSync(path.join(root, `u${i}.js`), `import { x } from './x.js'\nexport const u${i} = x\n`)
  }
  const g = ae.buildGraph(root)
  const metrics = ae.computeAll(g)
  const x = metrics.hotPath.find(h => h.file.endsWith('x.js'))
  assert.ok(x, 'x.js should be in hot path')
  assert.ok(x.fanIn >= 50)
  cleanupTree(root)
})

test('metrics.globalStats: aggregates', () => {
  const root = makeTree({
    'a.js': 'export const a = 1',
    'b.js': 'import "./a.js"\nexport const b = 2',
  })
  const g = ae.buildGraph(root)
  const metrics = ae.computeAll(g)
  assert.equal(metrics.global.files, 2)
  assert.ok(metrics.global.totalLines > 0)
  cleanupTree(root)
})

test('metrics.isOversized: large file flagged', () => {
  const root = makeTree({
    'big.js': 'export const x = 1\n'.repeat(2000),
    'normal.js': 'export const y = 2',
  })
  const g = ae.buildGraph(root)
  const metrics = ae.computeAll(g)
  const big = metrics.nodes.find(n => n.file.endsWith('big.js'))
  assert.equal(big.isOversized, true)
  assert.equal(big.isCritical, true)
  cleanupTree(root)
})

// ─── arch-analyzer — 4 tests ────────────────────────────────

test('analyzer.analyze: returns proposals sorted by priority', () => {
  const root = makeTree({
    'big.js': 'export const x = 1\n'.repeat(2000),
    'a.js': `import './big.js'\n` + 'export const a = 1\n'.repeat(40),
  })
  const g = ae.buildGraph(root)
  const metrics = ae.computeAll(g)
  const r = ae.analyze(g, metrics)
  assert.ok(r.proposals.length > 0)
  // priority desc
  for (let i = 1; i < r.proposals.length; i++) {
    assert.ok(r.proposals[i - 1].priority >= r.proposals[i].priority)
  }
  // should have split proposal for big.js
  const split = r.proposals.find(p => p.type === 'split')
  assert.ok(split)
  cleanupTree(root)
})

test('analyzer.analyze: generates break_cycle proposal', () => {
  const root = makeTree({
    'a.js': `import './b.js'\nexport const a = 1`,
    'b.js': `import './a.js'\nexport const b = 2`,
  })
  const g = ae.buildGraph(root)
  const metrics = ae.computeAll(g)
  const r = ae.analyze(g, metrics)
  const cycle = r.proposals.find(p => p.type === 'break_cycle')
  assert.ok(cycle)
  assert.equal(cycle.priority, 10)   // highest
  cleanupTree(root)
})

test('analyzer.analyze: delete proposal for dead code', () => {
  const root = makeTree({
    'a.js': `import './b.js'\nexport const a = 1`,
    'b.js': `import './c.js'\nexport const b = 2`,
    'c.js': `import './d.js'\nexport const c = 3`,
    'd.js': `import './e.js'\nexport const d = 4`,
    'e.js': `import './f.js'\nexport const e = 5`,
    'f.js': `import './g.js'\nexport const f = 6`,
    'g.js': `import './h.js'\nexport const g = 7`,
    'h.js': `export const h = 8`,  // isolated, dead
  })
  const g = ae.buildGraph(root)
  const metrics = ae.computeAll(g)
  const r = ae.analyze(g, metrics)
  const del = r.proposals.find(p => p.type === 'delete')
  assert.ok(del)
  cleanupTree(root)
})

test('analyzer.summary: byType and byRisk', () => {
  const root = makeTree({
    'big.js': 'export const x = 1\n'.repeat(2000),
    'a.js': 'export const a = 1',
    'b.js': `import './a.js'\n` + 'export const b = 1\n'.repeat(40),
  })
  const g = ae.buildGraph(root)
  const metrics = ae.computeAll(g)
  const r = ae.analyze(g, metrics)
  assert.ok(r.summary.totalProposals > 0)
  assert.ok(r.summary.byType)
  cleanupTree(root)
})

// ─── arch-rewriter (dryRun) — 5 tests ───────────────────────

test('rewriter.applyProposal: rename dryRun returns plan', () => {
  const root = makeTree({
    'old.js': 'export const x = 1',
    'a.js': `import { x } from './old.js'\nexport const a = x`,
  })
  const proposal = {
    type: 'rename',
    from: path.join(root, 'old.js'),
    to: path.join(root, 'new.js'),
  }
  const r = ae.applyProposal(proposal, { baseDir: root, dryRun: true })
  assert.equal(r.dryRun, true)
  assert.equal(r.applied, false)
  assert.ok(r.plan)
  assert.equal(r.plan.type, 'rename')
  assert.equal(r.plan.referencesToUpdate, 1)
  // 文件未动
  assert.ok(fs.existsSync(path.join(root, 'old.js')))
  assert.ok(!fs.existsSync(path.join(root, 'new.js')))
  cleanupTree(root)
})

test('rewriter.applyProposal: rename actually applies', () => {
  const root = makeTree({
    'old.js': 'export const x = 1',
    'a.js': `import { x } from './old.js'\nexport const a = x`,
  })
  const proposal = {
    type: 'rename',
    from: path.join(root, 'old.js'),
    to: path.join(root, 'new.js'),
    autoApply: true,
  }
  const r = ae.applyProposal(proposal, { baseDir: root, dryRun: false })
  assert.equal(r.applied, true)
  assert.ok(fs.existsSync(path.join(root, 'new.js')))
  assert.ok(!fs.existsSync(path.join(root, 'old.js')))
  // a.js should reference new.js
  const aContent = fs.readFileSync(path.join(root, 'a.js'), 'utf8')
  assert.match(aContent, /from\s+['"]\.\/new\.js['"]/)
  cleanupTree(root)
})

test('rewriter.applyProposal: split is plan-only', () => {
  const proposal = { type: 'split', target: '/x.js', reason: 'too big', autoApply: false }
  const r = ae.applyProposal(proposal)
  assert.equal(r.applied, false)
  assert.equal(r.skipped, true)
  assert.ok(r.plan)
  assert.ok(r.plan.suggestedSteps.length > 0)
})

test('rewriter.applyProposal: invalid type rejected', () => {
  const r = ae.applyProposal({ type: 'invalid' })
  assert.equal(r.applied, false)
  assert.match(r.reason, /not auto-apply|not implemented/)
})

test('rewriter.applyProposals: batch with mixed results', () => {
  const root = makeTree({
    'old.js': 'export const x = 1',
    'a.js': `import { x } from './old.js'\nexport const a = x`,
  })
  const proposals = [
    { type: 'rename', from: path.join(root, 'old.js'), to: path.join(root, 'new.js'), autoApply: true },
    { type: 'split', target: '/x.js', autoApply: false },
  ]
  const r = ae.applyProposals(proposals, { baseDir: root, dryRun: false })
  assert.equal(r.total, 2)
  assert.equal(r.applied, 1)
  assert.equal(r.skipped, 1)
  cleanupTree(root)
})

// ─── arch-controller — 5 tests ──────────────────────────────

test('controller.runArchAudit: dryRun mode', async () => {
  const root = makeTree({
    'big.js': 'export const x = 1\n'.repeat(2000),
    'a.js': `import './big.js'\nexport const a = 1`,
  })
  const r = await ae.runArchAudit({ srcDir: root, dryRun: true })
  assert.equal(r.audit.dryRun, true)
  assert.ok(r.audit.proposals > 0)
  assert.equal(r.results.dryRun, true)
  // 文件没动
  assert.ok(fs.existsSync(path.join(root, 'big.js')))
  cleanupTree(root)
})

test('controller.runArchAudit: detects cycles in real GINA layout', async () => {
  const root = makeTree({
    'a.js': `import './b.js'\nexport const a = 1`,
    'b.js': `import './a.js'\nexport const b = 2`,
    'c.js': `import './a.js'\nexport const c = 3`,
  })
  const r = await ae.runArchAudit({ srcDir: root })
  assert.ok(r.graph.cycles.length > 0)
  cleanupTree(root)
})

test('controller.buildReport: human-readable output', async () => {
  const root = makeTree({
    'a.js': 'export const a = 1',
    'b.js': `import './a.js'\nexport const b = 2`,
  })
  const r = await ae.runArchAudit({ srcDir: root })
  const report = ae.buildReport(r)
  assert.match(report, /GINA 架构审计报告/)
  assert.match(report, /DRY RUN/)
  assert.match(report, /Top 10 提案/)
  cleanupTree(root)
})

test('controller.getArchOverview: dashboard data', async () => {
  const root = makeTree({
    'a.js': 'export const a = 1',
    'b.js': `import './a.js'\nexport const b = 2`,
  })
  const r = await ae.runArchAudit({ srcDir: root })
  const ov = ae.getArchOverview(r)
  assert.equal(typeof ov.files, 'number')
  assert.equal(ov.dryRun, true)
  cleanupTree(root)
})

test('controller.runArchAudit: filters by applyTypes', async () => {
  const root = makeTree({
    'big.js': 'export const x = 1\n'.repeat(2000),
    'a.js': `import './big.js'\nexport const a = 1`,
  })
  const r = await ae.runArchAudit({ srcDir: root, applyTypes: ['split'] })
  const types = r.proposals.map(p => p.type)
  assert.ok(types.every(t => t === 'split'))
  cleanupTree(root)
})

// ─── integration — 1 test ──────────────────────────────────

test('integration: full audit on small project, all parts wire up', async () => {
  const root = makeTree({
    'core.js': 'export const core = 1\n'.repeat(300),
    'a.js': `import './core.js'\nexport const a = 1`,
    'b.js': `import './core.js'\nexport const b = 2`,
    'c.js': `import './core.js'\nexport const c = 3`,
    'util.js': 'export const u = 1',  // small, isolated
    'old.js': 'export const x = 1',
    'user.js': `import { x } from './old.js'\nexport const u = x`,
  })
  const r = await ae.runArchAudit({ srcDir: root, dryRun: true })
  // graph built
  assert.ok(r.graph.nodes.length > 0)
  // metrics computed
  assert.ok(r.metrics.nodes.length > 0)
  // analysis ran
  assert.ok(r.analysis.proposals.length > 0)
  // report builds
  const report = ae.buildReport(r)
  assert.ok(report.length > 100)
  cleanupTree(root)
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
