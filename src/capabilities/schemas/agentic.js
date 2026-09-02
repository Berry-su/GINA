// src/capabilities/schemas/agentic.js — 主动 agentic 工具 schema（ADR-011 · Phase 3）
//
// 2 个 tool 暴露给 LLM：
//   - query_cron : 列 / 查 / 启 / 禁 cron
//   - run_cron   : 立即跑指定 cron（跳过 schedule）
//
// emotion-isolation 严守（沿用 Phase 2）：
//   - tool 输出只走事实通道（"X cron 在 Y 时间跑过，结果 Z"），不触发 joy
//   - 写入 L2 memory 是 memory-bridge 层做的，不在 tool 输出里
//   - LLM 拿到的 string 描述里不带 emotion 词

function buildParameters({ actions, extraProps = [] }) {
  const props = {
    action: {
      type: 'string',
      enum: actions,
      description: `Operation to perform. One of: ${actions.join(', ')}.`,
    },
  }
  for (const p of extraProps) props[p.key] = p.schema
  return {
    type: 'object',
    properties: props,
    required: ['action'],
  }
}

export const agenticSchemas = {
  query_cron: {
    type: 'function',
    function: {
      name: 'query_cron',
      description:
        'Inspect and control the GINA agentic cron orchestrator. List, enable, disable, or inspect scheduled jobs (morning briefing, evening summary, stock monitor, email summary, calendar conflict). All crons default to disabled. Cron results are written to L2 episodic memory for future CATS-Net concept recall. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['list', 'get', 'enable', 'disable', 'enable_all', 'disable_all', 'status'],
        extraProps: [
          { key: 'id', schema: { type: 'string', description: 'Cron job ID (get/enable/disable).' } },
        ],
      }),
    },
  },

  run_cron: {
    type: 'function',
    function: {
      name: 'run_cron',
      description:
        'Immediately execute a registered cron job by ID, bypassing its schedule. Use to test or trigger an out-of-band briefing/summary. The result is written to L2 episodic memory. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['run'],
        extraProps: [
          { key: 'id', schema: { type: 'string', description: 'Cron job ID to run (required).' } },
          { key: 'force', schema: { type: 'boolean', description: 'Skip idempotency check (run even if same minute already ran). Default false.' } },
        ],
      }),
    },
  },
}
