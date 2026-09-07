// arch-controller.js — 架构自进化编排器
//
// 定位：把 graph → metrics → analyze → rewriter 串成 GINA 周期审计主回路。
// 重要：默认 dryRun，所有改动先给报告，老板拍板才真改。
//
// 流程：
//   1. buildGraph(srcDir)
//   2. computeAll(graph)
//   3. analyze(graph, metrics)
//   4. applyProposals(proposals, { dryRun: true })  — 默认不真改
//   5. 报告 + 等待老板确认 → 老板拍 apply 后再 dryRun: false
//
// 集成 meta-learning：把每次 audit 结果喂 bandit 决策"下次重点扫哪类问题"。

import { buildGraph } from './arch-graph.js'
import { computeAll } from './arch-metrics.js'
import { analyze } from './arch-analyzer.js'
import { applyProposals } from './arch-rewriter.js'

// ─── 状态 ───────────────────────────────────────────────────

export function defaultControllerState() {
  return {
    version: 1,
    audits: [],   // [{ at, srcDir, summary, applied, dryRun }]
  }
}

export function loadControllerState(statePath) {
  // 简化：不持久化
  return defaultControllerState()
}

export function saveControllerState() {
  // 留接口
}

// ─── 主入口 ────────────────────────────────────────────────

// 跑一次架构审计
//   options: { srcDir, dryRun, applyTypes, limits, baseDir, runTests }
//   返回: { audit, proposals, results }
export async function runArchAudit(options = {}) {
  const srcDir = options.srcDir || '.'
  const dryRun = options.dryRun !== false   // default true
  const applyTypes = options.applyTypes || null   // null = 全部 dryRun
  const limits = options.limits || {}
  const baseDir = options.baseDir || srcDir
  const state = options.state || defaultControllerState()
  const startedAt = Date.now()
  // 1) graph
  const graph = buildGraph(srcDir, options)
  // 2) metrics
  const metrics = computeAll(graph, { limits })
  // 3) analyze
  const analysis = analyze(graph, metrics, { limits })
  // 4) filter
  const proposals = filterProposals(analysis.proposals, { applyTypes, dryRun })
  // 5) apply (dryRun 优先)
  const results = applyProposals(proposals, { dryRun, baseDir })
  // 6) build audit
  const audit = {
    at: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    srcDir,
    dryRun,
    graph: graph.stats,
    metrics: metrics.global,
    analysis: analysis.summary,
    proposals: proposals.length,
    autoApply: proposals.filter(p => p.autoApply).length,
    applied: results.applied,
    skipped: results.skipped,
    failed: results.failed,
  }
  state.audits.push(audit)
  if (state.audits.length > 64) state.audits = state.audits.slice(-64)
  return {
    audit,
    graph,
    metrics,
    analysis,
    proposals,
    results,
  }
}

// 过滤 proposals：根据 applyTypes + dryRun
function filterProposals(proposals, options) {
  let list = proposals
  if (options.applyTypes && Array.isArray(options.applyTypes)) {
    const set = new Set(options.applyTypes)
    list = list.filter(p => set.has(p.type))
  }
  if (options.dryRun) {
    // dryRun 模式：保留所有用于预览，但 autoApply 标志仍生效
  }
  return list
}

// ─── 报告生成（人读） ──────────────────────────────────────

export function buildReport(auditResult, options = {}) {
  const { audit, graph, metrics, analysis, proposals, results } = auditResult
  const lines = []
  lines.push(`# GINA 架构审计报告`)
  lines.push('')
  lines.push(`- 时间: ${audit.at}`)
  lines.push(`- 模式: ${audit.dryRun ? 'DRY RUN（不改代码）' : 'APPLY（真改）'}`)
  lines.push(`- 耗时: ${audit.durationMs}ms`)
  lines.push('')
  lines.push(`## 全局统计`)
  lines.push(`- 文件数: ${graph.stats.files}`)
  lines.push(`- 边数: ${graph.stats.edges}`)
  lines.push(`- 循环依赖: ${graph.stats.cycles}`)
  lines.push(`- npm 依赖: ${graph.stats.npmDeps}`)
  lines.push(`- 超大文件: ${metrics.global.oversizedFiles || 0}`)
  lines.push(`- 核心模块 (high fan-in): ${metrics.global.coreFiles || 0}`)
  lines.push(`- 死代码候选: ${metrics.deadCode.length}`)
  lines.push(`- 总行数: ${metrics.global.totalLines || 0}`)
  lines.push('')
  lines.push(`## 问题汇总`)
  lines.push(`- 总提案: ${analysis.summary.totalProposals}`)
  lines.push(`- 按类型: ${JSON.stringify(analysis.summary.byType)}`)
  lines.push(`- 按风险: ${JSON.stringify(analysis.summary.byRisk)}`)
  lines.push(`- 可自动执行: ${analysis.summary.autoApplyCount}`)
  lines.push('')
  lines.push(`## Top 10 提案`)
  for (const p of proposals.slice(0, 10)) {
    const target = p.target ? p.target.split('/').slice(-1)[0] : (p.files ? `${p.files.length} files` : '?')
    lines.push(`- [${p.priority}] ${p.type}: ${target} (${p.risk})`)
    lines.push(`    ${p.reason}`)
  }
  if (audit.dryRun) {
    lines.push('')
    lines.push(`## DRY RUN — 未实际修改任何文件`)
    lines.push(`要真改请设置 dryRun: false（生产环境慎用，建议先在分支验证）`)
  }
  return lines.join('\n')
}

// ─── 概览（dashboard） ──────────────────────────────────────

export function getArchOverview(auditResult) {
  if (!auditResult) return { ok: false, reason: 'no audit result' }
  const { audit, metrics, analysis } = auditResult
  return {
    at: audit.at,
    dryRun: audit.dryRun,
    durationMs: audit.durationMs,
    files: audit.graph.files,
    cycles: audit.graph.cycles,
    proposals: audit.proposals,
    autoApply: audit.autoApply,
    oversized: metrics.global.oversizedFiles,
    deadCode: metrics.deadCode.length,
    byRisk: analysis.summary.byRisk,
  }
}

export function resetForTest() {
  return defaultControllerState()
}
