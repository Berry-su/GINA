/**
 * subagents/device-adapter.js — 设备适配层（P3）
 *
 * 把物理设备协议（Matter/HomeKit/MQTT/CAN/ROS/云端 API）翻译成 Gina 子 Agent 协议。
 * 母体永远只和「子 Agent 协议」打交道，不知道下面是灯还是机器狼。
 *
 * 关键设计：
 *   - DeviceSubAgent 抽象基类：定义「连接 / 读状态 / 执行动作」三个设备侧原语，
 *     内部把设备操作翻译成 protocol.js 的事件流（STATE_SNAPSHOT / TOOL_CALL_* / STATE_DELTA）。
 *   - 隐私分级（配合「本地大模型 + 云端 LLM 自由切换」）：每个数据点可标 public / private，
 *     private 数据默认只进本地模型，不进云端 LLM。设备状态默认 private。
 *   - 只提供骨架 + 一个可跑通的内存模拟设备（MockLight），真实协议适配器按此基类逐个接。
 */

import {
  defineSubAgent,
  makeEvent,
  RISK_LEVELS,
  PRIVACY_LEVELS,
  SUBAGENT_EVENTS,
} from './protocol.js'

export { PRIVACY_LEVELS }

/**
 * 设备子 Agent 抽象基类。
 * 子类只需实现三个设备侧原语：_connect / _readState / _executeAction。
 * 事件流、隐私标记、run 关联全部由基类统一处理。
 *
 * 用法：
 *   const light = new MockLight({ id: 'light-01', name: '客厅灯' })
 *   light.onEvent((event) => orchestrator.ingest(event))
 *   await light.connect()
 *   await light.readState()
 *   await light.execute('set_on_off', { on: true })   // 低风险，可自动
 */
export class DeviceSubAgent {
  constructor({ id, name, description = '', capabilities = [], actions = [], state_schema = [], privacy = PRIVACY_LEVELS.PRIVATE, emit = null }) {
    this.def = defineSubAgent({
      id,
      kind: 'device',
      name,
      description,
      capabilities,
      actions,
      state_schema,
    })
    this.privacy = privacy
    this.connected = false
    this._emit = typeof emit === 'function' ? emit : null
    this._runId = null
  }

  /** 设置事件回调（把事件喂给 orchestrator.ingest）。 */
  onEvent(fn) {
    this._emit = typeof fn === 'function' ? fn : null
    return this
  }

  /** 关联当前 run（母体 dispatch 后调用，让事件带上 run_id）。 */
  bindRun(runId) {
    this._runId = runId
    return this
  }

  /** 发一个子 Agent 事件，自动带上 run_id / agent_id / 隐私标记。 */
  _send(type, data = {}) {
    if (!this._emit) return
    const event = makeEvent(type, {
      run_id: this._runId ?? '',
      agent_id: this.def.id,
      data: { ...data, _privacy: this.privacy },
    })
    try { this._emit(event) } catch { /* 事件回调错误不阻断设备操作 */ }
  }

  /** 上报全量状态。 */
  _snapshot(state) {
    this._send(SUBAGENT_EVENTS.STATE_SNAPSHOT, state)
  }

  /** 上报状态增量。 */
  _delta(delta) {
    this._send(SUBAGENT_EVENTS.STATE_DELTA, delta)
  }

  // ── 子类需实现的三个原语 ─────────────────────────────────

  /** @returns {Promise<boolean>} */
  async _connect() { throw new Error('DeviceSubAgent 子类必须实现 _connect()') }

  /** @returns {Promise<object>} 当前状态 */
  async _readState() { throw new Error('DeviceSubAgent 子类必须实现 _readState()') }

  /**
   * 执行一个动作。
   * @param {string} actionId
   * @param {object} args
   * @returns {Promise<object>} 执行结果
   */
  async _executeAction(actionId, args) { throw new Error('DeviceSubAgent 子类必须实现 _executeAction()') }

  // ── 基类公共方法 ─────────────────────────────────────────

  async connect() {
    await this._connect()
    this.connected = true
    return this
  }

  async disconnect() {
    this.connected = false
    return this
  }

  /** 读状态并上报 snapshot。 */
  async readState() {
    const state = await this._readState()
    this._snapshot(state)
    return state
  }

  /**
   * 执行动作并产出一条完整的 TOOL_CALL 事件链 + 状态增量。
   * 不在这里做授权判定——授权门在母体 orchestrator.dispatch 层。
   * @returns {Promise<{ok:boolean, result?:object, error?:string}>}
   */
  async execute(actionId, args = {}) {
    this._send(SUBAGENT_EVENTS.TOOL_CALL_START, { action_id: actionId })
    this._send(SUBAGENT_EVENTS.TOOL_CALL_ARGS, { action_id: actionId, args })
    try {
      const result = await this._executeAction(actionId, args)
      this._send(SUBAGENT_EVENTS.TOOL_CALL_END, { action_id: actionId, ok: true, result })
      // 动作后状态可能变化，补一次全量快照
      try { await this.readState() } catch { /* 读状态失败不阻断动作结果 */ }
      return { ok: true, result }
    } catch (err) {
      this._send(SUBAGENT_EVENTS.TOOL_CALL_END, { action_id: actionId, ok: false, error: err?.message || String(err) })
      return { ok: false, error: err?.message || String(err) }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 最小可跑适配器：内存模拟智能家居灯
// 真实设备适配器照此实现 _connect/_readState/_executeAction 即可。
// ─────────────────────────────────────────────────────────────

export class MockLight extends DeviceSubAgent {
  constructor({ id = 'light-01', name = '模拟灯', emit = null } = {}) {
    super({
      id,
      name,
      capabilities: ['on_off', 'brightness'],
      actions: [
        { id: 'set_on_off', description: '开关灯', risk_level: RISK_LEVELS.LOW, input_schema: { on: 'boolean' } },
        { id: 'set_brightness', description: '调亮度', risk_level: RISK_LEVELS.LOW, input_schema: { brightness: 'number' } },
      ],
      state_schema: ['on', 'brightness'],
      privacy: PRIVACY_LEVELS.PRIVATE,
      emit,
    })
    this.state = { on: false, brightness: 100 }
  }

  async _connect() {
    return true
  }

  async _readState() {
    return { ...this.state }
  }

  async _executeAction(actionId, args) {
    if (actionId === 'set_on_off') {
      this.state.on = args.on === true
      return { on: this.state.on }
    }
    if (actionId === 'set_brightness') {
      const b = Number(args.brightness)
      if (!Number.isFinite(b) || b < 0 || b > 100) throw new Error('brightness 需在 0-100 之间')
      this.state.brightness = b
      return { brightness: this.state.brightness }
    }
    throw new Error(`未知动作：${actionId}`)
  }
}

// ─────────────────────────────────────────────────────────────
// 真实设备适配器骨架（示例：通过 HTTP 云端 API 控制的智能插座）
// 用户填 baseUrl / 凭据后即可接入真实设备；控制逻辑与 MockLight 完全同构。
// ─────────────────────────────────────────────────────────────

export class HttpDeviceSubAgent extends DeviceSubAgent {
  constructor({ id, name, baseUrl, apiKey = '', actions = [], state_schema = [], emit = null } = {}) {
    super({ id, name, capabilities: [], actions, state_schema, privacy: PRIVACY_LEVELS.PRIVATE, emit })
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  async _connect() {
    const res = await fetch(`${this.baseUrl}/health`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`设备健康检查失败 HTTP ${res.status}`)
    return true
  }

  async _readState() {
    const res = await fetch(`${this.baseUrl}/state`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`读状态失败 HTTP ${res.status}`)
    return await res.json()
  }

  async _executeAction(actionId, args) {
    const res = await fetch(`${this.baseUrl}/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ action: actionId, args }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`执行动作失败 HTTP ${res.status}`)
    return await res.json()
  }
}
