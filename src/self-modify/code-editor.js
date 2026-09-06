// Code editor: apply a unified diff patch to a file with backup + safety check.
//
// Workflow:
//   1. Read original file
//   2. Backup to <file>.bak.<timestamp>
//   3. Apply patch (string-based, dry-run first via `git apply --check`)
//   4. On failure: restore from backup
//   5. Return: { applied, backupPath, error? }
//
// We use string replacement (not git apply) to avoid shell-out and platform
// differences. The patch is parsed into hunks and matched against the
// original file line-by-line. This is a minimal but reliable implementation.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

// ─── Patch parser ────────────────────────────────────────────

// Parse a unified diff (output of `git diff` or `diff -u`).
// Returns: { oldFile, newFile, hunks: [{ oldStart, oldLines, newStart, newLines, lines: [...] }] }
export function parsePatch(patchText) {
  if (typeof patchText !== 'string' || patchText.length === 0) {
    throw new Error('patch text is empty')
  }
  const lines = patchText.split('\n')
  let oldFile = null
  let newFile = null
  const hunks = []
  let i = 0
  // Header
  while (i < lines.length && !lines[i].startsWith('@@')) {
    const line = lines[i]
    if (line.startsWith('--- ')) oldFile = line.slice(4).replace(/\t.*$/, '').trim()
    if (line.startsWith('+++ ')) newFile = line.slice(4).replace(/\t.*$/, '').trim()
    i++
  }
  // Hunks
  while (i < lines.length) {
    if (!lines[i].startsWith('@@')) { i++; continue }
    const m = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!m) { i++; continue }
    const oldStart = parseInt(m[1], 10)
    const oldLines = m[2] ? parseInt(m[2], 10) : 1
    const newStart = parseInt(m[3], 10)
    const newLines = m[4] ? parseInt(m[4], 10) : 1
    i++
    const hunkLines = []
    while (i < lines.length && !lines[i].startsWith('@@')) {
      hunkLines.push(lines[i])
      i++
    }
    hunks.push({ oldStart, oldLines, newStart, newLines, lines: hunkLines })
  }
  if (hunks.length === 0) throw new Error('no hunks found in patch')
  return { oldFile, newFile, hunks }
}

// ─── Patch applicator ──────────────────────────────────────

// Apply parsed hunks to the original text. Returns new text.
// Throws if hunks don't match original.
export function applyHunks(originalText, hunks) {
  const originalLines = originalText.split('\n')
  // Apply in reverse order to keep earlier line numbers stable
  const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart)
  for (const h of sortedHunks) {
    const startIdx = h.oldStart - 1
    // First pass: verify ' ' and '-' lines, count old line span
    let oldLineCount = 0
    for (const line of h.lines) {
      if (line.startsWith('\\ No newline at end of file')) continue
      if (line.startsWith(' ')) {
        const expected = line.slice(1)
        const actual = originalLines[startIdx + oldLineCount]
        if (actual !== expected) {
          throw new Error(`hunk mismatch at line ${startIdx + oldLineCount + 1}: expected "${expected.slice(0, 60)}", got "${(actual || '').slice(0, 60)}"`)
        }
        oldLineCount++
      } else if (line.startsWith('-')) {
        // Also verify '-' lines match original (don't get silently dropped)
        const expected = line.slice(1)
        const actual = originalLines[startIdx + oldLineCount]
        if (actual !== expected) {
          throw new Error(`hunk mismatch at line ${startIdx + oldLineCount + 1}: expected "${expected.slice(0, 60)}", got "${(actual || '').slice(0, 60)}"`)
        }
        oldLineCount++
      }
    }
    // Second pass: build new content (context + added)
    const newLines = []
    for (const line of h.lines) {
      if (line.startsWith('\\ No newline at end of file')) continue
      if (line.startsWith('+')) {
        newLines.push(line.slice(1))
      } else if (line.startsWith(' ')) {
        newLines.push(line.slice(1))
      }
    }
    // Splice: replace old line span with new lines
    originalLines.splice(startIdx, oldLineCount, ...newLines)
  }
  return originalLines.join('\n')
}

// ─── High-level: applyPatch with backup ─────────────────────

export function applyPatch({ filePath, patchText, backupDir = null } = {}) {
  if (!filePath) throw new Error('filePath required')
  if (!patchText) throw new Error('patchText required')
  if (!fs.existsSync(filePath)) throw new Error(`file not found: ${filePath}`)

  const original = fs.readFileSync(filePath, 'utf-8')
  const parsed = parsePatch(patchText)
  const patched = applyHunks(original, parsed.hunks)

  // Backup
  const backupPath = backupDir
    ? path.join(backupDir, `${path.basename(filePath)}.bak.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`)
    : `${filePath}.bak.${Date.now()}`
  fs.writeFileSync(backupPath, original, 'utf-8')

  // Write patched
  fs.writeFileSync(filePath, patched, 'utf-8')
  return { applied: true, backupPath, bytesChanged: patched.length - original.length }
}

// Restore from backup
export function restoreBackup({ filePath, backupPath } = {}) {
  if (!fs.existsSync(backupPath)) throw new Error(`backup not found: ${backupPath}`)
  const original = fs.readFileSync(backupPath, 'utf-8')
  fs.writeFileSync(filePath, original, 'utf-8')
  return { restored: true, filePath, backupPath }
}

// ─── Syntax check (lightweight) ─────────────────────────────

// Use node --check to validate JS syntax. Returns { ok, error? }.
export function checkSyntax({ filePath } = {}) {
  if (!filePath) throw new Error('filePath required')
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf-8',
    timeout: 10_000
  })
  if (result.status === 0) {
    return { ok: true }
  }
  return {
    ok: false,
    stderr: result.stderr ? result.stderr.slice(0, 500) : '',
    stdout: result.stdout ? result.stdout.slice(0, 500) : ''
  }
}

// ─── Convenience: full safe edit cycle ───────────────────────

// applyEditSafely: apply patch, syntax-check, run tests. Restore on failure.
export function applyEditSafely({ filePath, patchText, testCommand = null, backupDir = null } = {}) {
  // 1. Backup
  const original = fs.readFileSync(filePath, 'utf-8')
  const parsed = parsePatch(patchText)
  const patched = applyHunks(original, parsed.hunks)
  const backupPath = backupDir
    ? path.join(backupDir, `${path.basename(filePath)}.bak.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`)
    : `${filePath}.bak.${Date.now()}`
  fs.writeFileSync(backupPath, original, 'utf-8')
  // 2. Apply
  fs.writeFileSync(filePath, patched, 'utf-8')
  // 3. Syntax check
  const syntax = checkSyntax({ filePath })
  if (!syntax.ok) {
    fs.writeFileSync(filePath, original, 'utf-8')
    return { ok: false, stage: 'syntax', error: syntax.stderr, backupPath }
  }
  // 4. Run tests if provided
  if (testCommand) {
    const r = spawnSync(testCommand.cmd, testCommand.args, {
      encoding: 'utf-8',
      cwd: testCommand.cwd || process.cwd(),
      timeout: testCommand.timeout || 60_000
    })
    if (r.status !== 0) {
      fs.writeFileSync(filePath, original, 'utf-8')
      return {
        ok: false,
        stage: 'test',
        error: (r.stderr || r.stdout || '').slice(0, 1000),
        backupPath
      }
    }
  }
  return { ok: true, backupPath, bytesChanged: patched.length - original.length }
}
