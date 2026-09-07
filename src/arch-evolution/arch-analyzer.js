// arch-analyzer.js — 找问题 + 提议重构
//
// 定位：把 metrics + graph 转成"可执行"的 proposal 列表。
// 每个 proposal 含：类型 / 目标文件 / 描述 / 风险等级 / 是否自动执行。
//
// proposal 类型：
//   - 'rename'         重命名（导出/导入同步）— 自动
//   - 'extract'        提取函数/类到新文件 — 自动
//   - 'move'           移动到正确层 — 自动
//   - 'split'          拆分超大文件 — 仅提议
//   - 'merge'          合并小文件 — 仅提议
//   - 'delete'         删除死代码 — 仅提议
//   - 'break_cycle'    打破循环依赖 — 仅提议
//   - 'add_layer'      添加层 — 仅提议

// ─── 提议生成 ──────────────────────────────────────────────

// 循环依赖提议
function cycleProposals(cycles) {
  return cycles.map(cycle => ({
    type: 'break_cycle',
    target: cycle[cycle.length - 1],   // 起点
    files: cycle,
    reason: `cycle: ${cycle.slice(0, -1).map(f => path.basename(f)).join(' → ')} → ${path.basename(cycle[0])}`,
    risk: 'high',
    autoApply: false,
    priority: 10,
  }))
}

// 超大文件提议
function oversizedProposals(metrics, limits) {
  return metrics.filter(m => m.isOversized).map(m => ({
    type: 'split',
    target: m.file,
    reason: `${m.totalLines} lines > limit ${limits.maxFileLines}`,
    risk: m.isCritical ? 'critical' : 'high',
    autoApply: false,
    priority: m.isCritical ? 9 : 7,
    suggestedSplit: `建议拆成 ≤${limits.maxFileLines} 行/文件`,
  }))
}

// 死代码提议
function deadCodeProposals(deadCode) {
  return deadCode.map(d => ({
    type: 'delete',
    target: d.file,
    reason: `fanIn=${d.fanIn} ≤ 1, lines=${d.totalLines} ≤ 50, exports=${d.exportCount} — 疑似死代码`,
    risk: 'medium',
    autoApply: false,
    priority: 4,
  }))
}

// 高扇出提议（模块依赖太多）
function highFanOutProposals(metrics, limits) {
  return metrics.filter(m => m.fanOut > limits.maxFanOut).map(m => ({
    type: 'extract',
    target: m.file,
    reason: `fanOut=${m.fanOut} > limit ${limits.maxFanOut} — 扇出过高，建议拆分关注点`,
    risk: 'medium',
    autoApply: false,
    priority: 5,
  }))
}

// 高复杂度提议
function highComplexityProposals(metrics) {
  return metrics.filter(m => m.cyclomatic > 30 || m.maxNesting > 7).map(m => ({
    type: 'split',
    target: m.file,
    reason: `cyclomatic=${m.cyclomatic}, nesting=${m.maxNesting} — 复杂度过高`,
    risk: 'medium',
    autoApply: false,
    priority: m.cyclomatic > 50 ? 6 : 4,
  }))
}

// ─── 主入口 ────────────────────────────────────────────────

export function analyze(graph, metrics, options = {}) {
  const proposals = []
  // 1) 循环（最高优先级）
  proposals.push(...cycleProposals(graph.cycles || []))
  // 2) 超大文件
  proposals.push(...oversizedProposals(metrics.nodes, metrics.limits))
  // 3) 死代码
  proposals.push(...deadCodeProposals(metrics.deadCode || []))
  // 4) 高扇出
  proposals.push(...highFanOutProposals(metrics.nodes, metrics.limits))
  // 5) 高复杂度
  proposals.push(...highComplexityProposals(metrics.nodes))
  // 6) 附加建议（来自 graph.cycles 但已在 1 处理）
  // 排序：priority desc
  proposals.sort((a, b) => b.priority - a.priority)
  return {
    proposals,
    summary: summarize(graph, metrics, proposals),
  }
}

function summarize(graph, metrics, proposals) {
  return {
    totalProposals: proposals.length,
    byType: countBy(proposals, 'type'),
    byRisk: countBy(proposals, 'risk'),
    autoApplyCount: proposals.filter(p => p.autoApply).length,
    cycles: (graph.cycles || []).length,
    oversized: (metrics.nodes || []).filter(n => n.isOversized).length,
    deadCode: (metrics.deadCode || []).length,
  }
}

function countBy(arr, key) {
  const out = {}
  for (const item of arr) {
    const v = item[key] || 'unknown'
    out[v] = (out[v] || 0) + 1
  }
  return out
}

import path from 'node:path'
export { path }
