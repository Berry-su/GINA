/**
 * subagents/orchestrator.js — 母体调度器（P2）
 *
 * 统一到 protocol.js 契约的「母体-子Agent」调度核心。职责：
 *   1. 注册子 Agent（软件 + 设备）
 *   2. 下发任务（含风险授权门：low 可自动，high 需确认，critical 双确认）
 *   3. 接收子 Agent 事件流（RUN/STEP/TOOL_CALL/STATE/TEXT）
 *   4. 聚合多子 Agent 结果（master-slave / voting / peer-to-peer）
 *   5. 否决（母体/风控官一票否决，终止运行）
 *
 * 设计约束：
 *   - 纯逻辑层：不依赖 events.js / db.js / executor.js，只依赖 protocol.js 数据结构，
 *     便于单测，也便于后续接设备适配层或真实执行通道。
 *   - 事件订阅通过 subscribe() 注入，由调用方决定转发到 SSE / emitEvent / 日志。
 *   - 授权门是硬约束：high/critical 任务未授权一律拒绝，critical 还需 double_confirm。
 */

import {
  defineSubAgent,
  createTask,
  validateEvent,
  validateTask,
  authRequirement,
  RISK_LEVELS,
  TASK_STATUS,
  SUBAGENT_EVENTS,
  AGGREGATION_MODES,
} from './protocol.js'

// run 状态（内部，对应子 Agent 一次任务的生命周期）
const RUN_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
})

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class SubAgentOrchestrator {
  constructor() {
    /** @type {Map<string, object>} agent_id → SubAgentDef + 运行态 */
    this.agents = new Map()
    /** @type {Map<string, object>} run_id → run 记录 */
    this.runs = new Map()
    /** @type {Map<string, object>} group_id → 聚合组 */
    this.groups = new Map()
    /** @type {Set<Function>} 事件订阅者 */
    this._subscribers = new Set()
  }

  // ── 事件订阅 ──────────────────────────────────────────────
  subscribe(fn) {
    this._subscribers.add(fn)
    return () => this._subscribers.delete(fn)
  }

  _notify(type, payload) {
    for (const fn of this._subscribers) {
      try { fn(type, payload) } catch { /* 订阅者错误不阻断调度 */ }
    }
  }

  // ── 子 Agent 注册 ─────────────────────────────────────────
  /**
   * 注册子 Agent（软件或设备）。
   * @param {object} def 原始定义，经 defineSubAgent 规范化
   * @returns {object} 注册后的 SubAgentDef
   */
  registerAgent(def) {
    const normalized = defineSubAgent(def)
    if (this.agents.has(normalized.id)) {
      throw new Error(`子 Agent 已注册：${normalized.id}`)
    }
    const record = {
      ...normalized,
      status: 'idle', // idle | busy | offline
      last_heartbeat: Date.now(),
      registered_at: Date.now(),
    }
    this.agents.set(normalized.id, record)
    this._notify('agent_registered', { agent: normalized })
    return normalized
  }

  unregisterAgent(id) {
    const existed = this.agents.delete(id)
    if (existed) this._notify('agent_unregistered', { agent_id: id })
    return existed
  }

  getAgent(id) {
    return this.agents.get(id) ?? null
  }

  listAgents() {
    return [...this.agents.values()]
  }

  /** 心跳：标记在线（设备子 Agent 周期性调用） */
  heartbeat(id) {
    const agent = this.agents.get(id)
    if (!agent) return false
    agent.last_heartbeat = Date.now()
    if (agent.status === 'offline') {
      agent.status = 'idle'
      this._notify('agent_reconnected', { agent_id: id })
    }
    return true
  }

  // ── 任务下发（含授权门） ─────────────────────────────────
  /**
   * 下发任务给单个子 Agent。
   * 授权门：low 直接过；high 需 task.authorized；critical 需 authorized + double_confirm。
   * @param {object} taskInput
   * @param {{double_confirm?:boolean}} [options]
   * @returns {{ok:boolean, run?:object, reason?:string, needs_auth?:boolean}}
   */
  dispatch(taskInput, options = {}) {
    const task = createTask(taskInput)
    const agent = this.agents.get(task.agent_id)
    if (!agent) return { ok: false, reason: `未注册的子 Agent：${task.agent_id}` }

    const req = authRequirement(task.risk_level)
    if (req.needsAuth && !task.authorized) {
      return { ok: false, reason: 'needs_authorization', needs_auth: true }
    }
    if (req.doubleConfirm && !options.double_confirm) {
      return { ok: false, reason: 'needs_double_confirm', needs_auth: true }
    }

    const run = {
      run_id: newId('run'),
      agent_id: task.agent_id,
      task,
      status: RUN_STATUS.SUBMITTED,
      result: null,
      error: null,
      steps: [],
      action_log: [],
      latest_state: {},
      texts: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    this.runs.set(run.run_id, run)
    agent.status = 'busy'

    this._notify('run_dispatched', { run_id: run.run_id, agent_id: task.agent_id, task })
    return { ok: true, run }
  }

  /**
   * 把一个任务派发给多个子 Agent，形成一个聚合组（供多子 Agent 协作/投票）。
   * @param {object} taskInput 不含 agent_id（会为每个 agent 各建一个 task）
   * @param {string[]} agentIds
   * @param {{mode?:string, double_confirm?:boolean}} [options]
   * @returns {{ok:boolean, group?:object, reason?:string}}
   */
  dispatchMany(taskInput, agentIds, options = {}) {
    const mode = options.mode ?? AGGREGATION_MODES.MASTER_SLAVE
    const groupId = newId('grp')
    const runs = {}
    const dispatched = []

    for (const agentId of agentIds) {
      const r = this.dispatch({ ...taskInput, agent_id: agentId }, options)
      if (!r.ok) {
        // 部分失败：已成功派发的回滚取消
        for (const runId of Object.values(runs)) this._cancelRun(runId, 'group_dispatch_partial_failure')
        return { ok: false, reason: r.reason }
      }
      runs[agentId] = r.run.run_id
      dispatched.push(r.run)
    }

    const group = {
      group_id: groupId,
      mode,
      task_goal: taskInput.goal ?? '',
      agent_ids: agentIds.slice(),
      runs,
      status: RUN_STATUS.SUBMITTED,
      created_at: Date.now(),
    }
    this.groups.set(groupId, group)
    this._notify('group_dispatched', { group_id: groupId, mode, agent_ids: agentIds })
    return { ok: true, group }
  }

  _cancelRun(runId, reason) {
    const run = this.runs.get(runId)
    if (!run) return
    run.status = RUN_STATUS.CANCELLED
    run.error = reason
    run.updated_at = Date.now()
    const agent = this.agents.get(run.agent_id)
    if (agent?.status === 'busy') agent.status = 'idle'
  }

  // ── 事件接收 ─────────────────────────────────────────────
  /**
   * 接收一个子 Agent 事件，更新 run 状态。返回 { ok, reason? }。
   * @param {object} event
   */
  ingest(event) {
    const { ok, errors } = validateEvent(event)
    if (!ok) return { ok: false, reason: errors.join('; ') }

    // 状态类事件（设备主动心跳）无 run_id：只更新设备的最新状态，不改动任何 run。
    const isStateEvent = event.type === SUBAGENT_EVENTS.STATE_SNAPSHOT || event.type === SUBAGENT_EVENTS.STATE_DELTA
    if (isStateEvent && !event.run_id) {
      const agent = this.agents.get(event.agent_id)
      if (!agent) return { ok: false, reason: `未知 agent_id：${event.agent_id}` }
      if (event.type === SUBAGENT_EVENTS.STATE_SNAPSHOT) {
        agent.latest_state = { ...event.data }
      } else {
        agent.latest_state = { ...(agent.latest_state ?? {}), ...event.data }
      }
      agent.last_heartbeat = event.timestamp
      this._notify('agent_state', { agent_id: event.agent_id, state: agent.latest_state })
      return { ok: true }
    }

    const run = this.runs.get(event.run_id)
    if (!run) return { ok: false, reason: `未知 run_id：${event.run_id}` }

    switch (event.type) {
      case SUBAGENT_EVENTS.RUN_STARTED:
        run.status = RUN_STATUS.RUNNING
        break

      case SUBAGENT_EVENTS.STEP_STARTED:
      case SUBAGENT_EVENTS.STEP_FINISHED:
        run.steps.push({ type: event.type, data: event.data, at: event.timestamp })
        break

      case SUBAGENT_EVENTS.TOOL_CALL_START:
      case SUBAGENT_EVENTS.TOOL_CALL_ARGS:
      case SUBAGENT_EVENTS.TOOL_CALL_END:
        run.action_log.push({ type: event.type, data: event.data, at: event.timestamp })
        break

      case SUBAGENT_EVENTS.STATE_SNAPSHOT:
        run.latest_state = { ...event.data }
        break

      case SUBAGENT_EVENTS.STATE_DELTA:
        run.latest_state = { ...run.latest_state, ...event.data }
        break

      case SUBAGENT_EVENTS.TEXT_MESSAGE_CONTENT:
        run.texts.push({ content: event.data?.content ?? '', at: event.timestamp })
        break

      case SUBAGENT_EVENTS.RUN_FINISHED: {
        const status = event.data?.status
        run.status = status === 'completed' ? RUN_STATUS.COMPLETED
          : status === 'failed' ? RUN_STATUS.FAILED
          : RUN_STATUS.CANCELLED
        run.result = event.data?.result ?? null
        if (event.data?.error) run.error = event.data.error
        const agent = this.agents.get(run.agent_id)
        if (agent?.status === 'busy') agent.status = 'idle'
        break
      }

      default:
        break
    }

    run.updated_at = event.timestamp
    this._notify('run_event', { run_id: run.run_id, type: event.type })
    return { ok: true }
  }

  getRun(runId) {
    return this.runs.get(runId) ?? null
  }

  listRuns() {
    return [...this.runs.values()]
  }

  // ── 聚合 ─────────────────────────────────────────────────
  /**
   * 聚合一个 group 内所有子 Agent 的最终结果。
   * @param {string} groupId
   * @returns {{ok:boolean, result?:any, mode?:string, per_agent?:object, reason?:string}}
   */
  aggregate(groupId) {
    const group = this.groups.get(groupId)
    if (!group) return { ok: false, reason: `未知 group_id：${groupId}` }

    const perAgent = {}
    for (const [agentId, runId] of Object.entries(group.runs)) {
      const run = this.runs.get(runId)
      perAgent[agentId] = run
        ? { status: run.status, result: run.result, error: run.error }
        : { status: 'unknown', result: null }
    }

    const finished = Object.values(perAgent).filter(p => p.status === RUN_STATUS.COMPLETED)
    if (finished.length === 0) {
      return { ok: false, reason: '尚无任何子 Agent 完成', per_agent: perAgent }
    }

    let result
    switch (group.mode) {
      case AGGREGATION_MODES.MASTER_SLAVE:
        // 取第一个完成（按 agent_ids 顺序）的结果
        for (const agentId of group.agent_ids) {
          if (perAgent[agentId]?.status === RUN_STATUS.COMPLETED) {
            result = perAgent[agentId].result
            break
          }
        }
        break

      case AGGREGATION_MODES.VOTING:
        result = this._aggregateByVoting(finished.map(p => p.result))
        break

      case AGGREGATION_MODES.PEER_TO_PEER:
      default:
        result = finished.map(p => p.result)
        break
    }

    group.status = RUN_STATUS.COMPLETED
    group.result = result
    this._notify('group_aggregated', { group_id: groupId, mode: group.mode, per_agent: perAgent })
    return { ok: true, result, mode: group.mode, per_agent: perAgent }
  }

  /** 投票聚合：按结果 JSON 相等分组，取多数派；并列取先出现的 */
  _aggregateByVoting(results) {
    const groups = new Map()
    for (const r of results) {
      const key = JSON.stringify(r)
      if (!groups.has(key)) groups.set(key, { payload: r, count: 0 })
      groups.get(key).count += 1
    }
    const sorted = [...groups.values()].sort((a, b) => b.count - a.count)
    return sorted.length ? sorted[0].payload : null
  }

  // ── 否决 ─────────────────────────────────────────────────
  /**
   * 母体/风控官一票否决：终止某个 run 或整个 group。
   * @param {string} id run_id 或 group_id
   * @param {string} reason
   * @returns {{ok:boolean, vetoed?:string[]}}
   */
  veto(id, reason = 'vetoed') {
    if (this.runs.has(id)) {
      this._cancelRun(id, reason)
      this._notify('run_vetoed', { run_id: id, reason })
      return { ok: true, vetoed: [id] }
    }
    if (this.groups.has(id)) {
      const group = this.groups.get(id)
      const vetoed = []
      for (const runId of Object.values(group.runs)) {
        this._cancelRun(runId, reason)
        vetoed.push(runId)
      }
      group.status = RUN_STATUS.CANCELLED
      this._notify('group_vetoed', { group_id: id, reason, vetoed })
      return { ok: true, vetoed }
    }
    return { ok: false, reason: `未知 run_id 或 group_id：${id}` }
  }

  // ── 状态查询 ─────────────────────────────────────────────
  getStatus() {
    const agents = [...this.agents.values()]
    const runs = [...this.runs.values()]
    return {
      agents: {
        total: agents.length,
        idle: agents.filter(a => a.status === 'idle').length,
        busy: agents.filter(a => a.status === 'busy').length,
        offline: agents.filter(a => a.status === 'offline').length,
      },
      runs: {
        total: runs.length,
        submitted: runs.filter(r => r.status === RUN_STATUS.SUBMITTED).length,
        running: runs.filter(r => r.status === RUN_STATUS.RUNNING).length,
        completed: runs.filter(r => r.status === RUN_STATUS.COMPLETED).length,
        failed: runs.filter(r => r.status === RUN_STATUS.FAILED).length,
        cancelled: runs.filter(r => r.status === RUN_STATUS.CANCELLED).length,
      },
      groups: this.groups.size,
    }
  }
}

export { RUN_STATUS }
