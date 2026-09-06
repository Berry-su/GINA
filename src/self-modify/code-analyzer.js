// Code analyzer: scan GINA source files and find candidates for self-modification.
//
// Metrics (each contributes to a 0-100 score, higher = more "needs improvement"):
//   - size_score: lines per file beyond a threshold
//   - complexity_score: rough complexity (function count + max nesting)
//   - duplication_score: imported by many other files (high change risk = improvement signal)
//   - missing_tests_score: files with no associated test file
//
// Output: list of { file, scores, totalScore, reason } sorted by totalScore desc.

import fs from 'node:fs'
import path from 'node:path'

// Thresholds (tuned for GINA codebase ~100K+ lines)
const SIZE_LINES_THRESHOLD = 600      // files > this contribute to size_score
const SIZE_LINES_MAX = 2000            // saturation
const FUNCTION_COUNT_HIGH = 30         // > this contributes
const FUNCTION_COUNT_MAX = 100
const NESTING_DEPTH_HIGH = 5
const NESTING_DEPTH_MAX = 10

function countLines(content) {
  if (!content) return 0
  return content.split('\n').length
}

// Naive function detector: counts top-level function declarations + arrow functions
// assigned to const/let. Not perfect but good enough as a proxy.
function countFunctions(content) {
  if (!content) return 0
  const fnDecl = (content.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+/gm) || []).length
  const arrowAssigned = (content.match(/^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/gm) || []).length
  const methodShorthand = (content.match(/^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*\{/gm) || []).length
  return fnDecl + arrowAssigned + methodShorthand
}

// Rough max nesting depth via brace counting per function body.
// Not perfect but a usable proxy.
function estimateMaxNesting(content) {
  if (!content) return 0
  let max = 0
  let depth = 0
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    // Skip strings/comments naively (good enough)
    if (c === '/' && content[i + 1] === '/') {
      while (i < content.length && content[i] !== '\n') i++
      continue
    }
    if (c === '/' && content[i + 1] === '*') {
      i += 2
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) i++
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++
        i++
      }
      continue
    }
    if (c === '{') {
      depth++
      if (depth > max) max = depth
    } else if (c === '}') {
      depth--
    }
  }
  return max
}

// Find files in a directory recursively, filter by extension
function walkDir(dir, ext = '.js', results = []) {
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      walkDir(full, ext, results)
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full)
    }
  }
  return results
}

// Normalize a path for cross-platform use
function normalizePath(p) {
  return p.replace(/\\/g, '/')
}

// Compute per-file metrics
function analyzeFile(filePath) {
  let content
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch (e) {
    return null
  }
  const lines = countLines(content)
  const functions = countFunctions(content)
  const nesting = estimateMaxNesting(content)
  return { filePath, lines, functions, nesting, content }
}

// Compute score 0-100 from raw metric + thresholds
function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v))
}

function scoreSize(lines) {
  if (lines <= SIZE_LINES_THRESHOLD) return 0
  return clamp(((lines - SIZE_LINES_THRESHOLD) / (SIZE_LINES_MAX - SIZE_LINES_THRESHOLD)) * 100)
}

function scoreComplexity(functions, nesting) {
  const fnScore = functions <= FUNCTION_COUNT_HIGH ? 0
    : clamp(((functions - FUNCTION_COUNT_HIGH) / (FUNCTION_COUNT_MAX - FUNCTION_COUNT_HIGH)) * 100)
  const nestScore = nesting <= NESTING_DEPTH_HIGH ? 0
    : clamp(((nesting - NESTING_DEPTH_HIGH) / (NESTING_DEPTH_MAX - NESTING_DEPTH_HIGH)) * 100)
  return Math.max(fnScore, nestScore)
}

function scoreMissingTests(filePath, repoRoot) {
  // A test exists if <basename>.test.js or src/<basename>/__tests__/*.test.js exists
  const rel = path.relative(repoRoot, filePath)
  const base = rel.replace(/^src\//, '').replace(/\.js$/, '')
  const candidates = [
    path.join(repoRoot, 'tests', `test-${base.replace(/\//g, '-')}.js`),
    path.join(repoRoot, 'tests', `${path.basename(filePath, '.js')}.test.js`),
    path.join(repoRoot, 'tests', `${base.split('/').pop()}.test.js`),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return 0
  }
  return 100
}

// Top-level scan
export function analyzeCodebase({ repoRoot, srcDir = 'src', minScore = 30 } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required')
  const absSrcDir = path.join(repoRoot, srcDir)
  const files = walkDir(absSrcDir, '.js')
  const all = []
  for (const f of files) {
    const m = analyzeFile(f)
    if (!m) continue
    const size = scoreSize(m.lines)
    const complexity = scoreComplexity(m.functions, m.nesting)
    const tests = scoreMissingTests(f, repoRoot)
    const totalScore = Math.round((size + complexity + tests) / 3)
    if (totalScore < minScore) continue
    const reasons = []
    if (size > 0) reasons.push(`large file (${m.lines} lines)`)
    if (complexity > 0) reasons.push(`complex (${m.functions} funcs, depth ${m.nesting})`)
    if (tests > 0) reasons.push('no test file found')
    all.push({
      file: normalizePath(path.relative(repoRoot, f)),
      lines: m.lines,
      functions: m.functions,
      nesting: m.nesting,
      scores: { size, complexity, tests },
      totalScore,
      reason: reasons.join('; ') || 'baseline'
    })
  }
  all.sort((a, b) => b.totalScore - a.totalScore)
  return all
}

// Public: pick top N candidates
export function pickTopCandidates({ repoRoot, srcDir, n = 5, minScore = 30 } = {}) {
  return analyzeCodebase({ repoRoot, srcDir, minScore }).slice(0, n)
}

// Test-only: reset
export function _resetForTest() {
  // no module-level state
}
