// Git commit helper for self-modification.
//
// All operations use child_process.spawnSync for deterministic output.
// We never auto-push; only local commits. Push is a separate user action.

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { runAllChecks } from './safety-checker.js'

// ─── Low-level git wrappers ────────────────────────────────

function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, {
    encoding: 'utf-8',
    cwd,
    timeout: opts.timeout || 30_000
  })
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim()
  }
}

// Check if directory is a git repo
export function isGitRepo(dir) {
  return git(dir, ['rev-parse', '--is-inside-work-tree']).ok
}

// Get current HEAD commit hash
export function getHeadCommit(dir) {
  return git(dir, ['rev-parse', 'HEAD']).stdout
}

// Stage specific files
export function gitAdd({ cwd, files }) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('files required')
  return git(cwd, ['add', '--', ...files])
}

// Show diff (staged or working tree)
export function getDiff({ cwd, staged = true } = {}) {
  const args = ['diff', '--no-color']
  if (staged) args.push('--staged')
  return git(cwd, args).stdout
}

// Commit staged changes
export function gitCommit({ cwd, message, author = null } = {}) {
  if (!message) throw new Error('commit message required')
  const args = ['commit', '-m', message]
  if (author) args.push(`--author=${author}`)
  return git(cwd, args, { timeout: 60_000 })
}

// Revert a commit (keep changes staged) or hard reset
export function gitRevert({ cwd, commit, mode = 'soft' } = {}) {
  if (!commit) throw new Error('commit required')
  if (mode === 'soft') return git(cwd, ['reset', '--soft', `${commit}~1`])
  if (mode === 'mixed') return git(cwd, ['reset', '--mixed', `${commit}~1`])
  if (mode === 'hard') return git(cwd, ['reset', '--hard', `${commit}~1`])
  throw new Error(`invalid mode: ${mode}`)
}

// ─── High-level: full safe-commit cycle ────────────────────

// commitIfPasses: run safety checks, then git add + commit if all pass.
// Returns { committed, commitHash, error?, gateResults }
export function commitIfPasses({ cwd, files, message, author = null, originalContent, newContent, testCommand, maxDiffBytes = 50_000 } = {}) {
  if (!cwd) throw new Error('cwd required')
  if (!isGitRepo(cwd)) return { committed: false, error: 'not a git repo' }
  // Read new content if a file is provided
  const targets = Array.isArray(files) ? files : [files]
  const fileToCheck = targets[0]
  const newC = newContent || (fs.existsSync(fileToCheck) ? fs.readFileSync(fileToCheck, 'utf-8') : '')
  // Run gates
  const checks = runAllChecks({
    filePath: fileToCheck,
    originalContent,
    newContent: newC,
    testCommand,
    cwd,
    maxDiffBytes
  })
  if (!checks.ok) {
    return { committed: false, gateResults: checks.results, error: 'safety check failed' }
  }
  // Stage
  const add = gitAdd({ cwd, files: targets })
  if (!add.ok) return { committed: false, error: `git add failed: ${add.stderr}` }
  // Commit
  const commit = gitCommit({ cwd, message, author })
  if (!commit.ok) return { committed: false, error: `git commit failed: ${commit.stderr}` }
  const hash = getHeadCommit(cwd)
  return { committed: true, commitHash: hash, gateResults: checks.results }
}
