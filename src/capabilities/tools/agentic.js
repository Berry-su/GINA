// src/capabilities/tools/agentic.js — 主动 agentic 工具执行器（ADR-011 · Phase 3）
//
// LLM 调 query_cron / run_cron 时走这里。
// 逻辑：
//   1. 解析 args.action
//   2. 调 cron-orchestrator 公开 API
//   3. 返回结构化 string 给 LLM
//
// emotion-isolation 严守（沿用 Phase 2）：
//   - tool 输出不含 emotion 词
//   - cron 跑完自动 ingestCronRuns（memory-bridge 层），不触发 joy
//   - 推送走 pushMessage 是主对话的事，不在 tool 输出里

import {
  listCrons, getCron, enableCron, disableCron, enableAllCrons, disableAllCrons,
  runCron, getOrchestratorStatus,
} from '../../agentic/cron-orchestrator.js'

function toolJson(obj) { return JSON.stringify(obj, null, 2) }

// ── query_cron 执行器 ──────────────────────────────────────────────────
export async function execQueryCron(args = {}, context = {}) {
  const action = args.action
  if (!action) return '错误：未提供 action（list/get/enable/disable/enable_all/disable_all/status）'

  if (action === 'list') {
    const crons = listCrons()
    return toolJson({ ok: true, action, count: crons.length, crons })
  }

  if (action === 'get') {
    if (!args.id) return '错误：get 需要 id'
    const c = getCron(args.id)
    if (!c) return `错误：cron "${args.id}" 不存在`
    return toolJson({ ok: true, action, cron: c })
  }

  if (action === 'enable') {
    if (!args.id) return '错误：enable 需要 id'
    const r = enableCron(args.id)
    if (!r.ok) return `错误：${r.error}`
    return toolJson({ ok: true, action, id: r.id, enabled: r.enabled, nextRun: r.nextRun })
  }

  if (action === 'disable') {
    if (!args.id) return '错误：disable 需要 id'
    const r = disableCron(args.id)
    if (!r.ok) return `错误：${r.error}`
    return toolJson({ ok: true, action, id: r.id, enabled: r.enabled })
  }

  if (action === 'enable_all') {
    const r = enableAllCrons()
    return toolJson({ ok: true, action, enabled: r.enabled })
  }

  if (action === 'disable_all') {
    const r = disableAllCrons()
    return toolJson({ ok: true, action, disabled: r.disabled })
  }

  if (action === 'status') {
    const status = getOrchestratorStatus()
    return toolJson({ ok: true, action, ...status })
  }

  return `错误：未知 action "${action}"`
}

// ── run_cron 执行器 ────────────────────────────────────────────────────
export async function execRunCron(args = {}, context = {}) {
  const action = args.action || 'run'
  if (action !== 'run') return `错误：run_cron 仅支持 run action（不是 "${action}"）`
  if (!args.id) return '错误：run 需要 id'

  const r = await runCron(args.id, { triggeredBy: 'llm', force: Boolean(args.force) })
  if (!r.ok) {
    return toolJson({ ok: false, action, id: args.id, error: r.error || r.summary })
  }
  return toolJson({ ok: true, action, ...r })
}
