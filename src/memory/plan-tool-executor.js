/**
 * plan-tool-executor.js — 计划步骤的真实工具执行器
 *
 * 解决「会规划但不会办事」的空壳问题：
 * auto-planner.js 的 genericToolExecution 和 plan-feedback-loop.js 的 simulateToolExecution
 * 此前都返回 `simulated` 假结果，计划里"搜网页/写记忆/读文件/发通知"这些步骤从未真正执行过。
 *
 * 本模块是唯一真相源：把计划步骤的「抽象语义工具名」（web_search / memory_search / knowledge_update …）
 * 映射到能力层 executor.js 的真实工具名，并真正调用 executeTool 执行、返回真实结果。
 *
 * 映射原则：
 *   - 能落地到真实工具的直接映射（web_search→MCP、memory_search→search_memory、knowledge_update→upsert_memory …）；
 *   - LLM 类步骤（llm_analyze / llm_extract / llm_generate / content_summarize / suggestion_generate）
 *     需要 LLM 驱动：通过 setPlanLlmExecutor() 注入（主流程把 callLLM 包一层传进来），
 *     未注入时返回明确的 `llm_not_wired` 状态，绝不假装成功。
 *   - 无法映射/无需外部副作用的步骤返回 `unmapped`，供调用方决定跳过还是降级。
 */

import { emitEvent } from '../events.js'

// 计划步骤抽象工具名 → 真实工具名 + 参数转换
const PLAN_TOOL_MAP = {
  // ── 信息获取 ──
  web_fetch: (i) => ({ name: 'fetch_url', args: { url: i?.url || i?.newsUrl || i?.link } }),
  web_search: (i) => ({ name: 'web_search', args: { query: i?.query || i?.q || i?.topic || i?.question } }),
  content_extract: (i) => ({ name: 'fetch_url', args: { url: i?.url } }),

  // ── 记忆 ──
  memory_search: (i) => ({ name: 'search_memory', args: { keyword: i?.keyword || i?.query || i?.q } }),
  memory_check: (i) => ({ name: 'probe_memory', args: { query: i?.query || i?.keyword } }),
  memory_write: (i) => ({ name: 'upsert_memory', args: { memories: [memoryToItem(i)] } }),

  // ── 知识 ──
  knowledge_update: (i) => ({ name: 'upsert_memory', args: { memories: [memoryToItem(i, 'knowledge')] } }),
  knowledge_save: (i) => ({ name: 'upsert_memory', args: { memories: [memoryToItem(i, 'knowledge')] } }),
  knowledge_distill: (i) => ({ name: 'upsert_memory', args: { memories: [memoryToItem(i, 'knowledge')] } }),
  knowledge_decay: (i) => ({ name: 'downgrade_memory', args: { mem_id: i?.mem_id || i?.memId, new_salience: i?.new_salience ?? 1, reason: i?.reason || 'plan-triggered decay' } }),

  // ── 文件 / 项目 ──
  project_scan: (i) => ({ name: 'list_dir', args: { path: i?.path || i?.dir || '.' } }),
  code_analyze: (i) => ({ name: 'read_file', args: { path: i?.path || i?.file } }),
  report_generate: (i) => ({ name: 'write_file', args: { path: i?.path || 'report.md', content: i?.content ?? JSON.stringify(i, null, 2) } }),

  // ── 通知 ──
  notification: (i) => ({ name: 'send_message', args: { target_id: i?.target_id || i?.targetId, content: i?.content || i?.message } }),
}

// 需要 LLM 驱动的步骤（后台离线无法自行完成）
const LLM_STEP_TOOLS = new Set([
  'llm_analyze', 'llm_extract', 'llm_generate', 'content_summarize', 'suggestion_generate',
])

function memoryToItem(i, defaultType = 'note') {
  const item = {
    mem_id: i?.mem_id || i?.memId || `${defaultType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: i?.type || defaultType,
    title: i?.title || '',
    content: i?.content || i?.text || JSON.stringify(i ?? {}),
  }
  return item
}

let llmExecutor = null

/**
 * 注入 LLM 执行器（主流程把 callLLM 包一层传进来）。
 * 签名：async (toolName, input) => string  返回该步骤的 LLM 结果文本。
 */
export function setPlanLlmExecutor(fn) {
  llmExecutor = typeof fn === 'function' ? fn : null
}

/**
 * 执行一个计划步骤的真实工具调用。
 * @param {string} toolName 计划里的抽象工具名
 * @param {object} input 步骤输入
 * @returns {Promise<object>} { ok, status: 'executed'|'llm'|'unmapped'|'error', tool, result }
 */
export async function executePlanTool(toolName, input = {}) {
  // LLM 类步骤
  if (LLM_STEP_TOOLS.has(toolName)) {
    if (llmExecutor) {
      try {
        const result = await llmExecutor(toolName, input)
        return { ok: true, status: 'llm', tool: toolName, result }
      } catch (err) {
        return { ok: false, status: 'error', tool: toolName, result: `LLM 步骤执行失败：${err?.message || err}` }
      }
    }
    return { ok: false, status: 'llm_not_wired', tool: toolName, result: `[${toolName}] 需要 LLM 驱动，但当前后台无 LLM 已接入（setPlanLlmExecutor 未注入）` }
  }

  const mapping = PLAN_TOOL_MAP[toolName]
  if (!mapping) {
    return { ok: false, status: 'unmapped', tool: toolName, result: `[${toolName}] 无真实工具映射，跳过` }
  }

  const { name, args } = mapping(input)

  // 通知类：无 target 时不乱发消息，改发内部事件
  if (name === 'send_message' && !args.target_id) {
    emitEvent('plan_notification', { tool: toolName, content: args.content })
    return { ok: true, status: 'executed', tool: name, result: JSON.stringify({ ok: true, delivered_via: 'internal_event', content: args.content }) }
  }

  // 动态 import 执行器，规避模块加载期循环依赖（executor 依赖 memory/tool-router）
  try {
    const { executeTool } = await import('../capabilities/executor.js')
    const result = await executeTool(name, args, {})
    const parsed = safeParse(result)
    const ok = parsed?.ok !== false && !/^(错误|执行失败|请求失败|未知工具)/.test(String(result || ''))
    return { ok, status: ok ? 'executed' : 'error', tool: name, result }
  } catch (err) {
    return { ok: false, status: 'error', tool: name, result: `执行失败：${err?.message || err}` }
  }
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return null }
}

/** 列出可真实执行的计划工具名（供诊断/展示）。 */
export function listExecutablePlanTools() {
  return Object.keys(PLAN_TOOL_MAP)
}
