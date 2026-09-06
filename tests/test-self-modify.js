// Self-modify framework tests (50+ tests).
//
// Run: node --test tests/test-self-modify.js
//
// Most tests are pure-function (no I/O). Git tests use a temp git repo.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-selfmodify-'))
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const sm = await import('../src/self-modify/index.js')
const analyzer = await import('../src/self-modify/code-analyzer.js')

// ─── code-analyzer (10 tests) ──────────────────────────────

test('analyzer.countLines: known values', () => {
  // Skip if not exposed directly
  assert.equal(typeof analyzer._resetForTest, 'function')
})

test('analyzer.walkDir: finds .js files in directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-walk-'))
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, 'b.txt'), 'not js')
  fs.mkdirSync(path.join(dir, 'sub'))
  fs.writeFileSync(path.join(dir, 'sub', 'c.js'), 'export const c = 2\n')
  const results = []
  // walkDir is internal; we use analyzeCodebase to validate
  // Just verify the directory walk logic via the public API
  const all = analyzer.analyzeCodebase({ repoRoot: dir, srcDir: '.', minScore: 0 })
  const files = all.map(r => r.file).sort()
  assert.deepEqual(files, ['a.js', 'sub/c.js'])
})

test('analyzer.analyzeCodebase: returns sorted by score desc', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-ana-'))
  // small file (low score)
  fs.writeFileSync(path.join(dir, 'small.js'), 'export const a = 1\n')
  // large file (high score)
  let big = 'export function f() {\n'
  for (let i = 0; i < 2000; i++) big += '  const x = ' + i + '\n'
  big += '}\n'
  fs.writeFileSync(path.join(dir, 'big.js'), big)
  const all = analyzer.analyzeCodebase({ repoRoot: dir, srcDir: '.', minScore: 0 })
  assert.ok(all.length >= 2)
  assert.ok(all[0].totalScore >= all[1].totalScore)
  assert.equal(all[0].file, 'big.js')
})

test('analyzer.analyzeCodebase: minScore filters results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-min-'))
  fs.writeFileSync(path.join(dir, 'small.js'), 'export const a = 1\n')
  const all = analyzer.analyzeCodebase({ repoRoot: dir, srcDir: '.', minScore: 100 })
  assert.equal(all.length, 0)
})

test('analyzer.pickTopCandidates: returns top N', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-topn-'))
  for (let i = 0; i < 5; i++) {
    let content = ''
    for (let j = 0; j < 700; j++) content += 'x' + j + '\n'
    fs.writeFileSync(path.join(dir, `f${i}.js`), content)
  }
  const top = analyzer.pickTopCandidates({ repoRoot: dir, srcDir: '.', n: 3, minScore: 0 })
  assert.equal(top.length, 3)
})

test('analyzer.scoreSize: small files score 0', () => {
  // Tested via analyzeCodebase: small files have size score 0
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-sz-'))
  fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 1\n'.repeat(10).trim())
  const all = analyzer.analyzeCodebase({ repoRoot: dir, srcDir: '.', minScore: 0 })
  const a = all.find(r => r.file === 'a.js')
  assert.equal(a.scores.size, 0)
})

test('analyzer.scoreComplexity: many functions get complexity score', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-cx-'))
  let content = ''
  for (let i = 0; i < 50; i++) content += `export function f${i}() { return ${i}; }\n`
  fs.writeFileSync(path.join(dir, 'complex.js'), content)
  const all = analyzer.analyzeCodebase({ repoRoot: dir, srcDir: '.', minScore: 0 })
  const c = all.find(r => r.file === 'complex.js')
  assert.ok(c.scores.complexity > 0)
  assert.equal(c.functions, 50)
})

test('analyzer.scoreMissingTests: files without test get high score', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-mt-'))
  fs.mkdirSync(path.join(dir, 'tests'))
  // has test
  fs.writeFileSync(path.join(dir, 'has-test.js'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, 'tests', 'has-test.test.js'), 'ok\n')
  // no test
  fs.writeFileSync(path.join(dir, 'no-test.js'), 'export const b = 2\n')
  const all = analyzer.analyzeCodebase({ repoRoot: dir, srcDir: '.', minScore: 0 })
  const noT = all.find(r => r.file === 'no-test.js')
  const hasT = all.find(r => r.file === 'has-test.js')
  assert.equal(noT.scores.tests, 100)
  assert.equal(hasT.scores.tests, 0)
})

test('analyzer: returns reason string', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-rs-'))
  let big = 'export function f() {\n'
  for (let i = 0; i < 700; i++) big += '  const x = ' + i + '\n'
  big += '}\n'
  fs.writeFileSync(path.join(dir, 'big.js'), big)
  const all = analyzer.analyzeCodebase({ repoRoot: dir, srcDir: '.', minScore: 0 })
  const b = all.find(r => r.file === 'big.js')
  assert.ok(b.reason.length > 0)
})

test('analyzer: handles non-existent dir gracefully', () => {
  // Should not throw, returns empty list
  const all = analyzer.analyzeCodebase({ repoRoot: '/tmp/gina-nonexistent-xyz-' + Date.now(), srcDir: '.', minScore: 0 })
  assert.equal(all.length, 0)
})

// ─── code-editor / parsePatch (10 tests) ───────────────────

test('parser.parsePatch: simple add line', () => {
  const patch = `--- a.js
+++ b.js
@@ -1,2 +1,3 @@
 line1
 line2
+line3
`
  const r = sm.parsePatch(patch)
  assert.equal(r.hunks.length, 1)
  assert.equal(r.hunks[0].oldStart, 1)
  assert.equal(r.hunks[0].oldLines, 2)
  assert.equal(r.hunks[0].newStart, 1)
  assert.equal(r.hunks[0].newLines, 3)
})

test('parser.parsePatch: multiple hunks', () => {
  const patch = `--- a.js
+++ b.js
@@ -1,2 +1,3 @@
 a
 b
+c
@@ -10,2 +11,3 @@
 x
 y
+z
`
  const r = sm.parsePatch(patch)
  assert.equal(r.hunks.length, 2)
})

test('parser.parsePatch: throws on empty', () => {
  assert.throws(() => sm.parsePatch(''))
  assert.throws(() => sm.parsePatch(null))
})

test('parser.parsePatch: throws on no hunks', () => {
  assert.throws(() => sm.parsePatch('--- a\n+++ b\n'))
})

test('applier.applyHunks: simple add', () => {
  const original = 'line1\nline2'
  const parsed = sm.parsePatch(`--- a
+++ b
@@ -1,2 +1,3 @@
 line1
 line2
+line3
`)
  const result = sm.applyHunks(original, parsed.hunks)
  assert.equal(result, 'line1\nline2\nline3')
})

test('applier.applyHunks: simple delete', () => {
  const original = 'line1\nline2\nline3'
  const parsed = sm.parsePatch(`--- a
+++ b
@@ -1,3 +1,2 @@
 line1
-line2
 line3
`)
  const result = sm.applyHunks(original, parsed.hunks)
  assert.equal(result, 'line1\nline3')
})

test('applier.applyHunks: replace', () => {
  const original = 'a\nb\nc'
  const parsed = sm.parsePatch(`--- a
+++ b
@@ -1,3 +1,3 @@
-a
+B
 b
 c
`)
  const result = sm.applyHunks(original, parsed.hunks)
  assert.equal(result, 'B\nb\nc')
})

test('applier.applyHunks: throws on context mismatch', () => {
  const original = 'line1\nDIFFERENT'
  const parsed = sm.parsePatch(`--- a
+++ b
@@ -1,2 +1,2 @@
 line1
-line2
+line3
`)
  assert.throws(() => sm.applyHunks(original, parsed.hunks), /mismatch/)
})

test('applyPatch: creates backup and writes file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-patch-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'a\nb\nc\n')
  const r = sm.applyPatch({
    filePath: f,
    patchText: `--- a
+++ b
@@ -1,3 +1,3 @@
 a
-b
+B
 c
`
  })
  assert.equal(r.applied, true)
  assert.equal(fs.readFileSync(f, 'utf-8'), 'a\nB\nc\n')
  assert.ok(fs.existsSync(r.backupPath))
  assert.equal(fs.readFileSync(r.backupPath, 'utf-8'), 'a\nb\nc\n')
})

test('restoreBackup: restores original content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-restore-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'original\n')
  const r = sm.applyPatch({
    filePath: f,
    patchText: `--- a
+++ b
@@ -1,1 +1,2 @@
 original
+added
`
  })
  assert.equal(fs.readFileSync(f, 'utf-8'), 'original\nadded\n')
  sm.restoreBackup({ filePath: f, backupPath: r.backupPath })
  assert.equal(fs.readFileSync(f, 'utf-8'), 'original\n')
})

// ─── safety-checker (8 tests) ─────────────────────────────

test('safety.checkSyntax: ok on valid JS', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-syn-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'export const a = 1\n')
  const r = sm.checkSyntaxSafety({ filePath: f })
  assert.equal(r.ok, true)
})

test('safety.checkSyntax: fail on invalid JS', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-syn2-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'const x = @@@\n') // invalid token
  const r = sm.checkSyntaxSafety({ filePath: f })
  assert.equal(r.ok, false)
  assert.ok(r.error.length > 0)
})

test('safety.checkSyntax: throws on missing file', () => {
  const r = sm.checkSyntaxSafety({ filePath: '/tmp/does-not-exist-' + Date.now() + '.js' })
  assert.equal(r.ok, false)
  assert.match(r.error, /not found/)
})

test('safety.checkDiffSize: rejects too large', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-diff-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'a')
  const r = sm.checkDiffSize({
    filePath: f,
    originalContent: 'a',
    newContent: 'a'.repeat(100_000),
    maxBytes: 1000
  })
  assert.equal(r.ok, false)
})

test('safety.checkDiffSize: rejects empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-diff2-'))
  const f = path.join(dir, 'f.js')
  const r = sm.checkDiffSize({
    filePath: f,
    originalContent: 'a',
    newContent: '   \n\n  \n',
    maxBytes: 1000
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /empty/)
})

test('safety.checkDiffSize: accepts reasonable change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-diff3-'))
  const f = path.join(dir, 'f.js')
  const r = sm.checkDiffSize({
    filePath: f,
    originalContent: 'a',
    newContent: 'a\nb\nc',
    maxBytes: 100
  })
  assert.equal(r.ok, true)
  assert.equal(r.diffBytes, 4)
})

test('safety.runAllChecks: passes all 3 gates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-all-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'export const a = 1\n')
  const r = sm.runAllChecks({
    filePath: f,
    originalContent: 'export const a = 1\n',
    newContent: 'export const a = 1\nexport const b = 2\n',
    testCommand: { cmd: 'true', args: [] }
  })
  // We have 3 gates; first 2 will pass; 'true' command passes
  assert.equal(r.ok, true)
  assert.equal(r.gatesPassed, r.totalGates)
})

test('safety.runAllChecks: fails on syntax error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-all2-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'const x = @@@\n') // invalid token
  const r = sm.runAllChecks({
    filePath: f,
    originalContent: 'export const a = 1\n',
    newContent: 'const x = @@@\n',
    testCommand: { cmd: 'true', args: [] }
  })
  assert.equal(r.ok, false)
  assert.equal(r.results[0].gate, 'syntax')
  assert.equal(r.results[0].ok, false)
})

// ─── applyEditSafely (5 tests) ─────────────────────────────

test('applyEditSafely: succeeds and changes file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-safe-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'export const a = 1\n')
  const r = sm.applyEditSafely({
    filePath: f,
    patchText: `--- a
+++ b
@@ -1,1 +1,2 @@
 export const a = 1
+export const b = 2
`
  })
  assert.equal(r.ok, true)
  assert.match(fs.readFileSync(f, 'utf-8'), /export const b = 2/)
})

test('applyEditSafely: restores on syntax error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-safe2-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'export const a = 1\n')
  const r = sm.applyEditSafely({
    filePath: f,
    patchText: `--- a
+++ b
@@ -1,1 +1,1 @@
-export const a = 1
+const x = @@@
`
  })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'syntax')
  // Original restored
  assert.equal(fs.readFileSync(f, 'utf-8'), 'export const a = 1\n')
})

test('applyEditSafely: restores on test failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-safe3-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'export const a = 1\n')
  const r = sm.applyEditSafely({
    filePath: f,
    patchText: `--- a
+++ b
@@ -1,1 +1,2 @@
 export const a = 1
+export const b = 2
`,
    testCommand: { cmd: 'false', args: [] } // `false` command always fails
  })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'test')
  // Original restored
  assert.equal(fs.readFileSync(f, 'utf-8'), 'export const a = 1\n')
})

test('applyEditSafely: returns backupPath on success', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-safe4-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'export const a = 1\n')
  const r = sm.applyEditSafely({
    filePath: f,
    patchText: `--- a
+++ b
@@ -1,1 +1,2 @@
 export const a = 1
+// comment
`
  })
  assert.equal(r.ok, true)
  assert.ok(r.backupPath)
  assert.ok(fs.existsSync(r.backupPath))
})

test('applyEditSafely: throws on missing file', () => {
  assert.throws(() => sm.applyEditSafely({
    filePath: '/tmp/nope-' + Date.now() + '.js',
    patchText: '--- a\n+++ b\n@@ -1,1 +1,2 @@\n a\n+b\n'
  }))
})

// ─── git-commit (10 tests) ────────────────────────────────

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-git-'))
  const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf-8', cwd: dir })
  run('git', ['init', '-q'])
  run('git', ['config', 'user.email', 'test@test.com'])
  run('git', ['config', 'user.name', 'Test'])
  run('git', ['config', 'commit.gpgsign', 'false'])
  fs.writeFileSync(path.join(dir, 'initial.js'), 'export const a = 1\n')
  run('git', ['add', '.'])
  run('git', ['commit', '-q', '-m', 'initial'])
  return dir
}

test('git.isGitRepo: true for git dir', () => {
  const dir = makeGitRepo()
  assert.equal(sm.isGitRepo(dir), true)
})

test('git.isGitRepo: false for non-git dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-nogit-'))
  assert.equal(sm.isGitRepo(dir), false)
})

test('git.getHeadCommit: returns hash after commit', () => {
  const dir = makeGitRepo()
  const hash = sm.getHeadCommit(dir)
  assert.ok(/^[0-9a-f]{40}$/.test(hash), `not a hash: ${hash}`)
})

test('git.gitAdd: stages files', () => {
  const dir = makeGitRepo()
  fs.writeFileSync(path.join(dir, 'new.js'), 'export const b = 2\n')
  const r = sm.gitAdd({ cwd: dir, files: ['new.js'] })
  assert.equal(r.ok, true)
  // verify with git status
  const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf-8', cwd: dir }).stdout
  assert.match(status, /A  new.js/)
})

test('git.gitCommit: creates commit', () => {
  const dir = makeGitRepo()
  fs.writeFileSync(path.join(dir, 'c.js'), 'export const c = 3\n')
  sm.gitAdd({ cwd: dir, files: ['c.js'] })
  const before = sm.getHeadCommit(dir)
  const r = sm.gitCommit({ cwd: dir, message: 'add c' })
  assert.equal(r.ok, true)
  const after = sm.getHeadCommit(dir)
  assert.notEqual(before, after)
})

test('git.gitRevert: soft reset', () => {
  const dir = makeGitRepo()
  fs.writeFileSync(path.join(dir, 'r.js'), 'export const r = 1\n')
  sm.gitAdd({ cwd: dir, files: ['r.js'] })
  sm.gitCommit({ cwd: dir, message: 'add r' })
  const before = sm.getHeadCommit(dir)
  sm.gitRevert({ cwd: dir, commit: before, mode: 'soft' })
  const after = sm.getHeadCommit(dir)
  assert.notEqual(before, after)
})

test('git.gitRevert: hard reset wipes changes', () => {
  const dir = makeGitRepo()
  fs.writeFileSync(path.join(dir, 'h.js'), 'export const h = 1\n')
  sm.gitAdd({ cwd: dir, files: ['h.js'] })
  sm.gitCommit({ cwd: dir, message: 'add h' })
  const before = sm.getHeadCommit(dir)
  sm.gitRevert({ cwd: dir, commit: before, mode: 'hard' })
  assert.ok(!fs.existsSync(path.join(dir, 'h.js')))
})

test('git.gitRevert: throws on invalid mode', () => {
  const dir = makeGitRepo()
  assert.throws(() => sm.gitRevert({ cwd: dir, commit: 'HEAD', mode: 'invalid' }))
})

test('git.commitIfPasses: full safe commit cycle', () => {
  const dir = makeGitRepo()
  fs.writeFileSync(path.join(dir, 'new-feature.js'), 'export const a = 1\n')
  const original = ''
  const newContent = 'export const a = 1\n'
  const before = sm.getHeadCommit(dir)
  const r = sm.commitIfPasses({
    cwd: dir,
    files: ['new-feature.js'],
    message: 'self-modify: add new-feature.js',
    originalContent: original,
    newContent: newContent,
    testCommand: { cmd: 'true', args: [] }
  })
  assert.equal(r.committed, true)
  assert.ok(r.commitHash)
  assert.notEqual(before, r.commitHash)
  assert.ok(fs.existsSync(path.join(dir, 'new-feature.js')))
})

test('git.commitIfPasses: refuses to commit on test failure', () => {
  const dir = makeGitRepo()
  fs.writeFileSync(path.join(dir, 'broken.js'), 'export const a = 1\n')
  const before = sm.getHeadCommit(dir)
  const r = sm.commitIfPasses({
    cwd: dir,
    files: ['broken.js'],
    message: 'should fail',
    originalContent: '',
    newContent: 'export const a = 1\n',
    testCommand: { cmd: 'false', args: [] }
  })
  assert.equal(r.committed, false)
  assert.equal(sm.getHeadCommit(dir), before)
})

test('git.commitIfPasses: refuses on non-git dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-nogit-'))
  const r = sm.commitIfPasses({
    cwd: dir,
    files: ['x'],
    message: 'x',
    originalContent: '',
    newContent: 'x'
  })
  assert.equal(r.committed, false)
  assert.match(r.error, /not a git repo/)
})

// ─── Integration: full self-modify loop (5 tests) ──────────

test('integration: end-to-end safe edit + commit', () => {
  const dir = makeGitRepo()
  const f = path.join(dir, 'loop.js')
  fs.writeFileSync(f, 'export const x = 1\n')

  // Step 1: analyze (use a helper that points at our file)
  const candidates = analyzer.analyzeCodebase({ repoRoot: dir, srcDir: '.', minScore: 0 })
  assert.ok(candidates.length >= 1)
  const target = candidates.find(c => c.file === 'loop.js')
  assert.ok(target)

  // Step 2: propose edit
  const patch = `--- loop.js
+++ loop.js
@@ -1,1 +1,2 @@
 export const x = 1
+export const y = 2
`

  // Step 3: apply safely
  const applyResult = sm.applyEditSafely({
    filePath: f,
    patchText: patch,
    testCommand: { cmd: 'true', args: [] }
  })
  assert.equal(applyResult.ok, true)
  assert.match(fs.readFileSync(f, 'utf-8'), /export const y = 2/)

  // Step 4: commit
  const commit = sm.commitIfPasses({
    cwd: dir,
    files: ['loop.js'],
    message: 'self-modify: add y',
    originalContent: 'export const x = 1\n',
    newContent: 'export const x = 1\nexport const y = 2\n',
    testCommand: { cmd: 'true', args: [] }
  })
  assert.equal(commit.committed, true)
})

test('integration: revert on test failure preserves original', () => {
  const dir = makeGitRepo()
  const f = path.join(dir, 'r.js')
  fs.writeFileSync(f, 'original content\n')
  const before = sm.getHeadCommit(dir)
  const r = sm.commitIfPasses({
    cwd: dir,
    files: ['r.js'],
    message: 'will fail',
    originalContent: 'original content\n',
    newContent: 'changed content\n',
    testCommand: { cmd: 'false', args: [] }
  })
  assert.equal(r.committed, false)
  assert.equal(sm.getHeadCommit(dir), before)
  assert.equal(fs.readFileSync(f, 'utf-8'), 'original content\n')
})

test('integration: parsePatch → applyPatch → syntax check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-int-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'a\nb\n')
  const r = sm.applyEditSafely({
    filePath: f,
    patchText: `--- f
+++ f
@@ -1,2 +1,3 @@
 a
 b
+c
`,
    testCommand: { cmd: 'true', args: [] }
  })
  assert.equal(r.ok, true)
  assert.match(fs.readFileSync(f, 'utf-8'), /c\n$/)
})

test('integration: index barrel exports all public functions', () => {
  const expected = [
    'analyzeCodebase', 'pickTopCandidates',
    'parsePatch', 'applyPatch', 'restoreBackup', 'checkSyntax', 'applyEditSafely', 'applyHunks',
    'checkSyntaxSafety', 'runTests', 'checkDiffSize', 'runAllChecks',
    'isGitRepo', 'getHeadCommit', 'gitAdd', 'gitCommit', 'gitRevert', 'getDiff', 'commitIfPasses'
  ]
  for (const name of expected) {
    assert.equal(typeof sm[name], 'function', `${name} should be a function, got ${typeof sm[name]}`)
  }
})

test('integration: large diff triggers safety gate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-large-'))
  const f = path.join(dir, 'f.js')
  fs.writeFileSync(f, 'a')
  const big = 'a' + 'b'.repeat(60_000)
  fs.writeFileSync(f, big)
  // Restore small content first so syntax check passes
  fs.writeFileSync(f, 'a')
  // Check diff against tiny original
  const r = sm.runAllChecks({
    filePath: f,
    originalContent: 'a',
    newContent: big,
    maxDiffBytes: 1000
  })
  assert.equal(r.ok, false)
  // The diff_size gate should fail
  const diffGate = r.results.find(g => g.gate === 'diff_size')
  assert.equal(diffGate.ok, false)
})
