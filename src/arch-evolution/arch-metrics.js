// arch-metrics.js — 架构健康指标
//
// 定位：把依赖图转成可操作的健康指标。
// 4 大维度：
//   1. 耦合度（fan-in / fan-out / instability）
//   2. 复杂度（per file：行数 / 函数数 / 嵌套 / cyclomatic）
//   3. Hot path（被依赖最多 + 行数多的"高价值核心模块"）
//   4. Dead code 候选（导出但无人用 + 行数过少）

import fs from 'node:fs'
import path from 'node:path'
import { getFanIn, getFanOut, getIncoming, getOutgoing } from './arch-graph.js'

// ─── 常量 ───────────────────────────────────────────────────

const DEFAULT_LIMITS = {
  maxFileLines: 1000,
  maxFileLinesCritical: 2000,
  maxFanOut: 30,
  maxFanIn: 100,
  minLinesForHotCandidate: 200,
  highFanIn: 50,            // 视为核心模块
  deadCodeMaxFanIn: 1,      // ≤1 引用 = 候选
  deadCodeMaxLines: 50,     // 且 ≤50 行 = 死代码
}

// ─── 单文件度量 ─────────────────────────────────────────────

export function fileMetrics(filePath, sourceText) {
  if (typeof sourceText !== 'string') {
    try {
      sourceText = fs.readFileSync(filePath, 'utf8')
    } catch (e) {
      return null
    }
  }
  const lines = sourceText.split('\n')
  const totalLines = lines.length
  const codeLines = lines.filter(l => {
    const t = l.trim()
    if (t.length === 0) return false
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return false
    return true
  }).length
  // 函数数：粗略统计
  const functionCount =
    (sourceText.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/gm) || []).length +
    (sourceText.match(/^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/gm) || []).length +
    (sourceText.match(/^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*\{/gm) || []).length
  // 类数
  const classCount = (sourceText.match(/^\s*(?:export\s+)?class\s+\w+/gm) || []).length
  // 导出数
  const exportCount =
    (sourceText.match(/^\s*export\s+(?:async\s+)?function\s+/gm) || []).length +
    (sourceText.match(/^\s*export\s+class\s+/gm) || []).length +
    (sourceText.match(/^\s*export\s+const\s+/gm) || []).length +
    (sourceText.match(/^\s*export\s+(?:default\s+)?\{/gm) || []).length
  // 最大嵌套深度（粗略：花括号配对）
  let maxNesting = 0
  let depth = 0
  for (const ch of sourceText) {
    if (ch === '{') {
      depth++
      if (depth > maxNesting) maxNesting = depth
    } else if (ch === '}') {
      depth--
    }
  }
  // cyclomatic：粗略 = if/for/while/case/catch/? 计数
  const cyclomatic =
    1 +
    (sourceText.match(/\bif\s*\(/g) || []).length +
    (sourceText.match(/\bfor\s*\(/g) || []).length +
    (sourceText.match(/\bwhile\s*\(/g) || []).length +
    (sourceText.match(/\bcase\s+/g) || []).length +
    (sourceText.match(/\bcatch\s*\(/g) || []).length +
    (sourceText.match(/\?[^.?]/g) || []).length
  return {
    file: filePath,
    totalLines,
    codeLines,
    functionCount,
    classCount,
    exportCount,
    maxNesting,
    cyclomatic,
  }
}

// ─── 节点度量（依赖图 + 单文件） ───────────────────────────

export function nodeMetrics(graph, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  const nodes = []
  for (const f of graph.nodes) {
    const fm = fileMetrics(f)
    if (!fm) continue
    const fanIn = getFanIn(graph.edges, f)
    const fanOut = getFanOut(graph.edges, f)
    // Instability = fanOut / (fanIn + fanOut)，0=稳定，1=不稳定
    const instability = (fanIn + fanOut) > 0 ? fanOut / (fanIn + fanOut) : 0
    nodes.push({
      file: f,
      totalLines: fm.totalLines,
      codeLines: fm.codeLines,
      functionCount: fm.functionCount,
      classCount: fm.classCount,
      exportCount: fm.exportCount,
      maxNesting: fm.maxNesting,
      cyclomatic: fm.cyclomatic,
      fanIn,
      fanOut,
      instability,
      isHot: fanIn >= limits.highFanIn && fm.totalLines >= limits.minLinesForHotCandidate,
      isCore: fanIn >= limits.highFanIn,
      isOversized: fm.totalLines > limits.maxFileLines,
      isCritical: fm.totalLines > limits.maxFileLinesCritical,
    })
  }
  return nodes
}

// ─── 死代码候选 ─────────────────────────────────────────────

export function deadCodeCandidates(nodeMetricsList, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  return nodeMetricsList.filter(n =>
    n.fanIn <= limits.deadCodeMaxFanIn &&
    n.totalLines <= limits.deadCodeMaxLines &&
    n.exportCount > 0
  )
}

// ─── Hot path 候选 ──────────────────────────────────────────

export function hotPathCandidates(nodeMetricsList, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  return nodeMetricsList
    .filter(n => n.fanIn >= limits.highFanIn || n.totalLines >= limits.minLinesForHotCandidate)
    .sort((a, b) => (b.fanIn * 100 + b.totalLines) - (a.fanIn * 100 + a.totalLines))
    .slice(0, options.top || 20)
}

// ─── 全局统计 ───────────────────────────────────────────────

export function globalStats(nodeMetricsList) {
  if (nodeMetricsList.length === 0) {
    return { files: 0, totalLines: 0, avgFanIn: 0, avgFanOut: 0, avgInstability: 0, hotFiles: 0, oversizedFiles: 0 }
  }
  const totalLines = nodeMetricsList.reduce((s, n) => s + n.totalLines, 0)
  const sumFanIn = nodeMetricsList.reduce((s, n) => s + n.fanIn, 0)
  const sumFanOut = nodeMetricsList.reduce((s, n) => s + n.fanOut, 0)
  const sumInstability = nodeMetricsList.reduce((s, n) => s + n.instability, 0)
  return {
    files: nodeMetricsList.length,
    totalLines,
    avgLines: Math.round(totalLines / nodeMetricsList.length),
    avgFanIn: (sumFanIn / nodeMetricsList.length).toFixed(2),
    avgFanOut: (sumFanOut / nodeMetricsList.length).toFixed(2),
    avgInstability: (sumInstability / nodeMetricsList.length).toFixed(2),
    hotFiles: nodeMetricsList.filter(n => n.isHot).length,
    coreFiles: nodeMetricsList.filter(n => n.isCore).length,
    oversizedFiles: nodeMetricsList.filter(n => n.isOversized).length,
    criticalFiles: nodeMetricsList.filter(n => n.isCritical).length,
  }
}

// ─── 主入口：所有指标 ───────────────────────────────────────

export function computeAll(graph, options = {}) {
  const nodes = nodeMetrics(graph, options)
  return {
    nodes,
    deadCode: deadCodeCandidates(nodes, options),
    hotPath: hotPathCandidates(nodes, options),
    global: globalStats(nodes),
    limits: { ...DEFAULT_LIMITS, ...(options.limits || {}) },
  }
}

export { DEFAULT_LIMITS, getIncoming, getOutgoing }
