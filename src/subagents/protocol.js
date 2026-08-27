/**
 * subagents/protocol.js — Gina 子 Agent 汇报协议（纯数据结构，无副作用）
 *
 * 这是「母体-子Agent 统一协议」的地基（设计文档：
 * 05-设计文档/设计文档_母体子Agent统一协议与自有生态接入_2026-08-21.md）。
 *
 * 核心设计：
 *   - 设备 = 具身子 Agent：智能家居/车机/车载机器人/机器狼与软件子 Agent 共享同一套协议，
 *     区别只在 kind（software/device）与接入的物理协议（由设备适配层屏蔽）。
 *   - 事件生命周期对齐 AG-UI 的 RUN/STEP/TOOL_CALL/STATE 模型，但不追求线上格式兼容，
 *     只借它的类型集合作为 Gina 内部规范。
 *   - 本模块只定义「数据结构 + 校验 + 工厂」，不含任何 I/O、调度、聚合副作用。
 *     调度器（P2）、设备适配层（P3）都依赖这里定义的契约。
 *
 * 术语：
 *   SubAgentDef  子 Agent 的静态定义（身份 + 能力 + 动作 + 状态 schema + 风险）
 *   Task         母体下发的一次任务（goal + steps + params + 授权）
 *   Event        子 Agent 与母体之间唯一的交互单元（事件流）
 *   Aggregator   母体聚合多个子 Agent 结果的模式
 */

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

/** 子 Agent 类型 */
export const SUBAGENT_KINDS = Object.freeze({
  SOFTWARE: 'software',
  DEVICE: 'device',
})

/** 动作风险分级（决定授权链） */
export const RISK_LEVELS = Object.freeze({
  LOW: 'low',           // 读状态、开灯、调空调 → 可自动
  HIGH: 'high',         // 门锁、安防、机器狼移动/抓取 → 需用户确认
  CRITICAL: 'critical', // 车机行驶控制、机器狼带负载操作 → 双确认，绝无自动/批量批准
})

/**
 * 数据隐私级别（配合「本地大模型 + 云端 LLM 自由切换」）。
 * 携带该标记的数据在喂给 LLM 时据此路由：
 *   public  → 可进云端 LLM
 *   private → 默认仅走本地模型（家庭/位置/车况/健康等敏感数据），不进云端
 */
export const PRIVACY_LEVELS = Object.freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
})

/** 子 Agent 事件类型（对齐 AG-UI 生命周期） */
export const SUBAGENT_EVENTS = Object.freeze({
  // 运行生命周期
  RUN_STARTED: 'run_started',
  RUN_FINISHED: 'run_finished',       // 含 status: completed | failed | cancelled
  // 步骤
  STEP_STARTED: 'step_started',
  STEP_FINISHED: 'step_finished',
  // 动作（工具调用）
  TOOL_CALL_START: 'tool_call_start',
  TOOL_CALL_ARGS: 'tool_call_args',
  TOOL_CALL_END: 'tool_call_end',     // 含 ok / result / error
  // 状态
  STATE_SNAPSHOT: 'state_snapshot',   // 全量状态（注册时 / 周期心跳）
  STATE_DELTA: 'state_delta',         // 状态增量（状态变化时）
  // 文本产出
  TEXT_MESSAGE_CONTENT: 'text_message_content',
})

/** 任务状态 */
export const TASK_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
})

/** 母体聚合多子 Agent 结果的模式（复用 collaboration-protocol.js 的语义） */
export const AGGREGATION_MODES = Object.freeze({
  MASTER_SLAVE: 'master-slave', // 取主从指定 agent 的结果
  VOTING: 'voting',             // 多数派结果
  PEER_TO_PEER: 'peer-to-peer', // 合并所有成功结果
})

// ─────────────────────────────────────────────────────────────
// 校验
// ─────────────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * 校验子 Agent 静态定义。
 * @param {object} def
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateSubAgentDef(def) {
  const errors = []
  if (!def || typeof def !== 'object') return { ok: false, errors: ['def 必须是对象'] }
  if (!isNonEmptyString(def.id)) errors.push('id 必须是非空字符串')
  if (!Object.values(SUBAGENT_KINDS).includes(def.kind)) {
    errors.push(`kind 必须是 ${Object.values(SUBAGENT_KINDS).join('|')}`)
  }
  if (!isNonEmptyString(def.name)) errors.push('name 必须是非空字符串')
  if (def.capabilities !== undefined && !Array.isArray(def.capabilities)) {
    errors.push('capabilities 必须是数组')
  }
  if (def.actions !== undefined) {
    if (!Array.isArray(def.actions)) errors.push('actions 必须是数组')
    else {
      def.actions.forEach((a, i) => {
        if (!a || !isNonEmptyString(a.id)) errors.push(`actions[${i}].id 必须是非空字符串`)
        const risk = a.risk_level ?? a.riskLevel
        if (risk !== undefined && !Object.values(RISK_LEVELS).includes(risk)) {
          errors.push(`actions[${i}].risk_level 必须是 ${Object.values(RISK_LEVELS).join('|')}`)
        }
      })
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 校验母体下发的任务。
 * @param {object} task
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateTask(task) {
  const errors = []
  if (!task || typeof task !== 'object') return { ok: false, errors: ['task 必须是对象'] }
  if (!isNonEmptyString(task.id)) errors.push('id 必须是非空字符串')
  if (!isNonEmptyString(task.agent_id) && !isNonEmptyString(task.agentId)) {
    errors.push('agent_id 必须是非空字符串')
  }
  if (!isNonEmptyString(task.goal)) errors.push('goal 必须是非空字符串')
  if (task.status !== undefined && !Object.values(TASK_STATUS).includes(task.status)) {
    errors.push(`status 必须是 ${Object.values(TASK_STATUS).join('|')}`)
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 校验子 Agent 上报的事件。
 * @param {object} event
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateEvent(event) {
  const errors = []
  if (!event || typeof event !== 'object') return { ok: false, errors: ['event 必须是对象'] }
  if (!Object.values(SUBAGENT_EVENTS).includes(event.type)) {
    errors.push(`type 必须是 ${Object.values(SUBAGENT_EVENTS).join('|')}，收到 ${event.type}`)
  }
  // 状态类事件允许无 run_id（设备主动心跳上报，用 agent_id 定位）；
  // 其余事件（RUN/STEP/TOOL_CALL/TEXT）必须挂靠在某个 run 下。
  const isStateEvent = event.type === SUBAGENT_EVENTS.STATE_SNAPSHOT || event.type === SUBAGENT_EVENTS.STATE_DELTA
  if (!isStateEvent && !isNonEmptyString(event.run_id) && !isNonEmptyString(event.runId)) {
    errors.push('run_id 必须是非空字符串')
  }
  if (isStateEvent && !isNonEmptyString(event.agent_id) && !isNonEmptyString(event.agentId)) {
    errors.push('状态类事件必须提供 agent_id')
  }
  return { ok: errors.length === 0, errors }
}

// ─────────────────────────────────────────────────────────────
// 工厂
// ─────────────────────────────────────────────────────────────

/**
 * 定义子 Agent（软件或设备）。
 * @param {object} def
 * @returns {object} 规范化后的 SubAgentDef
 */
export function defineSubAgent(def = {}) {
  const normalized = {
    id: def.id,
    kind: def.kind ?? SUBAGENT_KINDS.SOFTWARE,
    name: def.name ?? def.id,
    description: def.description ?? '',
    capabilities: Array.isArray(def.capabilities) ? def.capabilities : [],
    actions: (def.actions ?? []).map((a) => ({
      id: a.id,
      description: a.description ?? '',
      risk_level: a.risk_level ?? a.riskLevel ?? RISK_LEVELS.LOW,
      input_schema: a.input_schema ?? a.inputSchema ?? null,
      output_schema: a.output_schema ?? a.outputSchema ?? null,
    })),
    state_schema: def.state_schema ?? def.stateSchema ?? [],
    metadata: def.metadata ?? {},
  }
  const { ok, errors } = validateSubAgentDef(normalized)
  if (!ok) throw new Error(`子 Agent 定义非法：${errors.join('; ')}`)
  return normalized
}

/**
 * 创建一次母体下发的任务。
 * @param {object} task
 * @returns {object} 规范化后的 Task
 */
export function createTask(task = {}) {
  const normalized = {
    id: task.id ?? `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agent_id: task.agent_id ?? task.agentId ?? '',
    goal: task.goal ?? '',
    steps: Array.isArray(task.steps) ? task.steps : [],
    params: task.params ?? {},
    deadline_ms: task.deadline_ms ?? task.deadlineMs ?? null,
    risk_level: task.risk_level ?? task.riskLevel ?? RISK_LEVELS.LOW,
    authorized: task.authorized === true, // 高风险任务必须先经用户授权（无自动批准）
    status: TASK_STATUS.SUBMITTED,
    created_at: Date.now(),
    metadata: task.metadata ?? {},
  }
  const { ok, errors } = validateTask(normalized)
  if (!ok) throw new Error(`任务非法：${errors.join('; ')}`)
  return normalized
}

/**
 * 构造一个子 Agent 事件（统一入口）。
 * @param {string} type  SUBAGENT_EVENTS 之一
 * @param {object} payload
 * @returns {object} 规范化后的 Event
 */
export function makeEvent(type, payload = {}) {
  const event = {
    type,
    run_id: payload.run_id ?? payload.runId ?? '',
    agent_id: payload.agent_id ?? payload.agentId ?? '',
    timestamp: payload.timestamp ?? Date.now(),
    data: payload.data ?? payload,
  }
  const { ok, errors } = validateEvent(event)
  if (!ok) throw new Error(`子 Agent 事件非法：${errors.join('; ')}`)
  return event
}

// 便捷事件工厂：把每个事件类型固定成语义清晰的函数，避免调用方拼错 type

export const events = {
  runStarted: (runId, agentId, data = {}) =>
    makeEvent(SUBAGENT_EVENTS.RUN_STARTED, { run_id: runId, agent_id: agentId, data }),

  runFinished: (runId, agentId, status, result = null) =>
    makeEvent(SUBAGENT_EVENTS.RUN_FINISHED, { run_id: runId, agent_id: agentId, data: { status, result } }),

  stepStarted: (runId, agentId, step = {}) =>
    makeEvent(SUBAGENT_EVENTS.STEP_STARTED, { run_id: runId, agent_id: agentId, data: step }),

  stepFinished: (runId, agentId, step = {}) =>
    makeEvent(SUBAGENT_EVENTS.STEP_FINISHED, { run_id: runId, agent_id: agentId, data: step }),

  toolCallStart: (runId, agentId, actionId) =>
    makeEvent(SUBAGENT_EVENTS.TOOL_CALL_START, { run_id: runId, agent_id: agentId, data: { action_id: actionId } }),

  toolCallArgs: (runId, agentId, actionId, args = {}) =>
    makeEvent(SUBAGENT_EVENTS.TOOL_CALL_ARGS, { run_id: runId, agent_id: agentId, data: { action_id: actionId, args } }),

  toolCallEnd: (runId, agentId, actionId, result = {}) =>
    makeEvent(SUBAGENT_EVENTS.TOOL_CALL_END, { run_id: runId, agent_id: agentId, data: { action_id: actionId, ...result } }),

  stateSnapshot: (runId, agentId, state = {}) =>
    makeEvent(SUBAGENT_EVENTS.STATE_SNAPSHOT, { run_id: runId, agent_id: agentId, data: state }),

  stateDelta: (runId, agentId, delta = {}) =>
    makeEvent(SUBAGENT_EVENTS.STATE_DELTA, { run_id: runId, agent_id: agentId, data: delta }),

  text: (runId, agentId, content) =>
    makeEvent(SUBAGENT_EVENTS.TEXT_MESSAGE_CONTENT, { run_id: runId, agent_id: agentId, data: { content } }),
}

// ─────────────────────────────────────────────────────────────
// 聚合结果结构（聚合算法在 P2 编排器实现，这里只定义结果形状）
// ─────────────────────────────────────────────────────────────

/**
 * 定义一次多子 Agent 聚合的期望（供 P2 编排器消费）。
 * @param {object} agg
 * @returns {object}
 */
export function defineAggregation(agg = {}) {
  return {
    mode: agg.mode ?? AGGREGATION_MODES.MASTER_SLAVE,
    task_id: agg.task_id ?? agg.taskId ?? '',
    agent_ids: Array.isArray(agg.agent_ids) ? agg.agent_ids : (Array.isArray(agg.agentIds) ? agg.agentIds : []),
    min_success: agg.min_success ?? agg.minSuccess ?? 1, // voting 模式下的多数门槛
  }
}

// ─────────────────────────────────────────────────────────────
// 风险 → 授权判定
// ─────────────────────────────────────────────────────────────

/**
 * 判断某风险级别的动作是否需要用户授权。
 * 延续三层授权链：low 可自动，high 需确认，critical 双确认（绝无自动/批量批准）。
 * @param {string} riskLevel
 * @returns {{needsAuth:boolean, doubleConfirm:boolean}}
 */
export function authRequirement(riskLevel) {
  switch (riskLevel) {
    case RISK_LEVELS.CRITICAL:
      return { needsAuth: true, doubleConfirm: true }
    case RISK_LEVELS.HIGH:
      return { needsAuth: true, doubleConfirm: false }
    case RISK_LEVELS.LOW:
    default:
      return { needsAuth: false, doubleConfirm: false }
  }
}
