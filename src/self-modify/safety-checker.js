// Safety checker: validate a self-modification before committing.
//
// Three gates (all must pass to allow commit):
//   1. Syntax: node --check on the file
//   2. Test: run a test command and require 0 failures
//   3. Diff: the change is non-empty and not absurdly large
//
// We use child_process.spawnSync to run shell commands deterministically.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ─── Individual gates ───────────────────────────────────────

export function checkSyntax({ filePath, cwd } = {}) {
  if (!filePath) throw new Error('filePath required')
  // Resolve to absolute path so spawnSync can find it regardless of cwd
  const absPath = path.isAbsolute(filePath) ? filePath : (cwd ? path.join(cwd, filePath) : path.resolve(filePath))
  if (!fs.existsSync(absPath)) return { ok: false, error: 'file not found' }
  const r = spawnSync(process.execPath, ['--check', absPath], {
    encoding: 'utf-8',
    timeout: 10_000
  })
  if (r.status === 0) return { ok: true }
  return {
    ok: false,
    error: (r.stderr || r.stdout || 'unknown syntax error').slice(0, 800)
  }
}

export function runTests({ cmd = 'npm', args = ['test', '--', '--test-name-pattern=.', '--test-reporter=spec'], cwd, timeout = 120_000 } = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    cwd: cwd || process.cwd(),
    timeout,
    maxBuffer: 10 * 1024 * 1024
  })
  const stdout = (r.stdout || '').slice(-3000)
  const stderr = (r.stderr || '').slice(-2000)
  return {
    ok: r.status === 0,
    status: r.status,
    timedOut: r.signal === 'SIGTERM' && !r.stdout && !r.stderr,
    stdout,
    stderr
  }
}

export function checkDiffSize({ filePath, originalContent, newContent, maxBytes = 50_000 } = {}) {
  if (!filePath) throw new Error('filePath required')
  if (originalContent == null || newContent == null) {
    throw new Error('originalContent and newContent required')
  }
  const diff = newContent.length - originalContent.length
  if (Math.abs(diff) > maxBytes) {
    return {
      ok: false,
      error: `change too large: ${diff} bytes (max ${maxBytes})`,
      diffBytes: diff
    }
  }
  if (newContent.trim().length === 0) {
    return { ok: false, error: 'change produces empty file', diffBytes: diff }
  }
  return { ok: true, diffBytes: diff }
}

// ─── Composite: run all gates ───────────────────────────────

export function runAllChecks({ filePath, originalContent, newContent, testCommand, cwd, maxDiffBytes = 50_000 } = {}) {
  const results = []
  // Gate 1: syntax
  const syntax = checkSyntax({ filePath, cwd })
  results.push({ gate: 'syntax', ...syntax })
  // Gate 2: diff size
  if (originalContent != null && newContent != null) {
    const diff = checkDiffSize({ filePath, originalContent, newContent, maxBytes: maxDiffBytes })
    results.push({ gate: 'diff_size', ...diff })
  }
  // Gate 3: tests
  if (testCommand) {
    const tests = runTests(testCommand)
    results.push({ gate: 'tests', ok: tests.ok, status: tests.status, summary: tests.stdout.split('\n').slice(-3).join(' / ').slice(0, 200) })
  }
  const allOk = results.every(r => r.ok)
  return { ok: allOk, results, gatesPassed: results.filter(r => r.ok).length, totalGates: results.length }
}
