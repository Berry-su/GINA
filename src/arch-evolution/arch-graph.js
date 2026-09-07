// arch-graph.js — GINA 模块依赖图（import/export 静态扫描）
//
// 定位：GINA 用工具扫描自己的 src/ 目录，构建模块依赖图，
// 后续 metrics / analyzer / rewriter 都依赖此图。
//
// 不做的事：
//   - 不执行代码（纯字符串扫描）
//   - 不解析完整 AST（避免引入 babel/acorn 依赖）
//   - 不处理 CommonJS（仅 ESM，GINA 已全量 ESM 化）
//
// 能识别的 import 形式：
//   import x from './foo.js'                   → relative 边
//   import x from '../bar/baz.js'              → relative 边
//   import x from '/abs/path/foo.js'           → absolute 边
//   import x from 'node:fs'                    → builtin（不画边）
//   import x from 'lodash'                     → npm 依赖（不画边，单独记）
//   import('./dynamic.js')                     → dynamic 边
//   export { x } from './foo.js'               → re-export 边

import fs from 'node:fs'
import path from 'node:path'

// ─── 常量 ───────────────────────────────────────────────────

const BUILTIN_PREFIX = 'node:'
const NPM_PACKAGE_RE = /^(?:@[^/]+\/)?[^./]/
const MAX_FILE_SIZE = 512 * 1024     // 512K 上限
const MAX_FILES = 4096               // 防爆扫
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', 'out', 'target', '__pycache__',
])
const ESM_EXTENSIONS = new Set(['.js', '.mjs'])

// ─── 文件发现 ───────────────────────────────────────────────

export function walkJsFiles(rootDir, options = {}) {
  const max = options.maxFiles || MAX_FILES
  const results = []
  const skip = options.skipDirs || IGNORE_DIRS
  function walk(dir) {
    if (results.length >= max) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const ent of entries) {
      if (results.length >= max) return
      if (ent.name.startsWith('.') && ent.name !== '.') continue
      if (skip.has(ent.name)) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        walk(full)
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name)
        if (ESM_EXTENSIONS.has(ext)) {
          results.push(full)
        }
      }
    }
  }
  walk(rootDir)
  return results.sort()
}

// ─── 单文件 import 提取 ─────────────────────────────────────

const IMPORT_PATTERNS = [
  // import x from '...'
  /import\s+(?:[\w*${},\s]+\s+from\s+)?['"]([^'"]+)['"]/g,
  // import('...') 动态
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // export { x } from '...'
  /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
]

export function extractImports(sourceText, filePath) {
  if (typeof sourceText !== 'string') return []
  const imports = []
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(sourceText)) !== null) {
      const spec = m[1]
      const kind = classifyImport(spec, filePath)
      imports.push({ spec, kind, file: filePath, line: lineOf(sourceText, m.index) })
    }
  }
  return imports
}

function classifyImport(spec, filePath) {
  if (spec.startsWith(BUILTIN_PREFIX)) return 'builtin'
  if (spec.startsWith('.')) return 'relative'
  if (spec.startsWith('/')) return 'absolute'
  if (NPM_PACKAGE_RE.test(spec)) return 'npm'
  return 'unknown'
}

function lineOf(text, idx) {
  let line = 1
  for (let i = 0; i < idx && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

// ─── 相对路径解析 ───────────────────────────────────────────

// 把 import spec 解析为绝对文件路径
//   './foo.js' → /abs/.../foo.js
//   './foo'    → /abs/.../foo.js (default ext)
//   '../bar'   → /abs/.../../bar.js
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null
  const fromDir = path.dirname(fromFile)
  let resolved
  if (spec.startsWith('/')) {
    resolved = spec
  } else {
    resolved = path.resolve(fromDir, spec)
  }
  // 已经是 .js/.mjs
  if (ESM_EXTENSIONS.has(path.extname(resolved))) {
    return resolved
  }
  // 试加 .js / .mjs
  for (const ext of ['.js', '.mjs']) {
    if (fs.existsSync(resolved + ext)) return resolved + ext
  }
  // 试 /index.js
  for (const ext of ['.js', '.mjs']) {
    if (fs.existsSync(path.join(resolved, 'index' + ext))) {
      return path.join(resolved, 'index' + ext)
    }
  }
  return null
}

// ─── 主入口：构建依赖图 ─────────────────────────────────────

export function buildGraph(srcDir, options = {}) {
  const files = walkJsFiles(srcDir, options)
  if (files.length === 0) {
    return { nodes: [], edges: [], cycles: [], npmDeps: [], stats: { files: 0 } }
  }
  // 第一遍：读所有文件 + 提取 imports
  const fileImports = new Map()  // absPath → [{spec, kind, line}]
  for (const f of files) {
    let content
    try {
      const stat = fs.statSync(f)
      if (stat.size > MAX_FILE_SIZE) {
        fileImports.set(f, [])
        continue
      }
      content = fs.readFileSync(f, 'utf8')
    } catch (e) {
      fileImports.set(f, [])
      continue
    }
    fileImports.set(f, extractImports(content, f))
  }
  // 第二遍：建图
  const nodeSet = new Set(files)
  const edges = []
  const npmDeps = new Map()  // name → count
  for (const [from, imps] of fileImports) {
    for (const imp of imps) {
      if (imp.kind === 'npm') {
        const name = imp.spec.startsWith('@')
          ? imp.spec.split('/').slice(0, 2).join('/')
          : imp.spec.split('/')[0]
        npmDeps.set(name, (npmDeps.get(name) || 0) + 1)
        continue
      }
      if (imp.kind === 'builtin') continue
      if (imp.kind === 'unknown') continue
      const target = resolveImport(from, imp.spec)
      if (!target) continue
      if (!nodeSet.has(target)) continue
      edges.push({ from, to: target, spec: imp.spec, line: imp.line })
    }
  }
  // 检测循环
  const cycles = detectCycles(files, edges)
  return {
    nodes: files,
    edges,
    cycles,
    npmDeps: Array.from(npmDeps.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    stats: {
      files: files.length,
      edges: edges.length,
      npmDeps: npmDeps.size,
      cycles: cycles.length,
    },
  }
}

// ─── 循环依赖检测（DFS） ───────────────────────────────────

export function detectCycles(nodes, edges) {
  // 邻接表
  const adj = new Map()
  for (const n of nodes) adj.set(n, [])
  for (const e of edges) {
    const list = adj.get(e.from)
    if (list) list.push(e.to)
  }
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map()
  for (const n of nodes) color.set(n, WHITE)
  const cycles = []

  function dfs(node, path) {
    color.set(node, GRAY)
    const next = adj.get(node) || []
    for (const m of next) {
      const c = color.get(m)
      if (c === GRAY) {
        // 找到循环：m → ... → node → m
        const idx = path.indexOf(m)
        if (idx >= 0) {
          const cycle = path.slice(idx).concat([m])
          cycles.push(cycle)
        }
      } else if (c === WHITE) {
        dfs(m, [...path, m])
      }
    }
    color.set(node, BLACK)
  }

  for (const n of nodes) {
    if (color.get(n) === WHITE) {
      dfs(n, [n])
    }
  }
  // 去重（同一 cycle 可能从不同起点发现）
  const seen = new Set()
  const unique = []
  for (const c of cycles) {
    const key = c.slice(0, -1).sort().join('|')
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(c)
    }
  }
  return unique
}

// ─── 图查询辅助 ─────────────────────────────────────────────

export function getFanIn(edges, target) {
  return edges.filter(e => e.to === target).length
}

export function getFanOut(edges, source) {
  return edges.filter(e => e.from === source).length
}

export function getIncoming(edges, target) {
  return edges.filter(e => e.to === target)
}

export function getOutgoing(edges, source) {
  return edges.filter(e => e.from === source)
}

export {
  resolveImport,
  classifyImport,
  ESM_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_FILES,
  IGNORE_DIRS,
}
