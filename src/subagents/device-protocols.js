/**
 * subagents/device-protocols.js — 真实物理协议适配器（Matter / CAN / ROS）
 *
 * 每个适配器都继承 device-adapter.js 的 DeviceSubAgent，把具体物理协议翻译成
 * Gina 子 Agent 协议事件流。母体永远只与「子 Agent 协议」打交道，不知道底层
 * 是 Matter 灯、CAN 车机还是 ROS 机器狼。
 *
 * 实现策略：统一通过「本地网桥 / 网关」接入，而非直接驱动物理总线 ——
 *   - Matter → Home Assistant / Matter bridge 的 REST 端点
 *   - CAN    → socketcand 或自定义 TCP→CAN 网关
 *   - ROS    → rosbridge_server 的 WebSocket（默认 ws://127.0.0.1:9090）
 * 这样无需引入 matter.js / rosnodejs 等原生依赖，也无需真实硬件即可跑通
 * 连接 / 读状态 / 执行动作三个设备侧原语；接真时只需替换 baseUrl/host/topic。
 *
 * 设备状态默认 private（隐私硬约束：家庭/车况/机器人位姿等敏感数据不进云端 LLM）。
 */

import net from 'node:net'
import { WebSocket } from 'ws'
import { DeviceSubAgent } from './device-adapter.js'
import { RISK_LEVELS, PRIVACY_LEVELS } from './protocol.js'

export const DEVICE_PROTOCOLS = Object.freeze({
  MATTER: 'matter',
  CAN: 'can',
  ROS: 'ros',
})

/** 统一请求头（Bearer 鉴权，供 Matter 类 HTTP 网桥使用）。 */
function bearerHeaders(token = '') {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

// ─────────────────────────────────────────────────────────────
// Matter（智能家居，经 Matter bridge / Home Assistant REST 网关）
// ─────────────────────────────────────────────────────────────

export class MatterDeviceSubAgent extends DeviceSubAgent {
  constructor({ id, name, baseUrl, token = '', deviceId = '', emit = null } = {}) {
    super({
      id,
      name,
      capabilities: ['on_off', 'level'],
      actions: [
        { id: 'set_on_off', description: '开关设备', risk_level: RISK_LEVELS.LOW, input_schema: { on: 'boolean' } },
        { id: 'set_level', description: '设置等级（亮度/温度/开度）', risk_level: RISK_LEVELS.LOW, input_schema: { level: 'number' } },
      ],
      state_schema: ['on', 'level'],
      privacy: PRIVACY_LEVELS.PRIVATE,
      emit,
    })
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '')
    this.token = token
    this.deviceId = deviceId
  }

  async _connect() {
    if (!this.baseUrl) throw new Error('Matter 适配器需要 baseUrl（bridge/Home Assistant 地址）')
    const res = await fetch(`${this.baseUrl}/devices/${this.deviceId}`, {
      headers: bearerHeaders(this.token),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`Matter 网关健康检查失败 HTTP ${res.status}`)
    return true
  }

  async _readState() {
    const res = await fetch(`${this.baseUrl}/devices/${this.deviceId}/state`, {
      headers: bearerHeaders(this.token),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`读 Matter 状态失败 HTTP ${res.status}`)
    return await res.json()
  }

  async _executeAction(actionId, args) {
    const res = await fetch(`${this.baseUrl}/devices/${this.deviceId}/command`, {
      method: 'POST',
      headers: bearerHeaders(this.token),
      body: JSON.stringify({ action: actionId, args }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`执行 Matter 动作失败 HTTP ${res.status}`)
    return await res.json()
  }
}

// ─────────────────────────────────────────────────────────────
// CAN（车机 / 车载总线，经 socketcand 或 TCP→CAN 网关）
// ─────────────────────────────────────────────────────────────

/** 解析网桥文本帧：支持 socketcand 的 "< iface 123#DEADBEEF" 与裸 "123#AABB" 两种。 */
function parseCanFrame(line = '') {
  const s = String(line).trim()
  if (!s) return null
  const m = s.match(/([\da-fA-F]{1,8})#([\da-fA-F]{0,16})/)
  if (!m) return { raw: s }
  return { id: parseInt(m[1], 16), data: m[2] ? Buffer.from(m[2], 'hex') : Buffer.alloc(0) }
}

function encodeCanFrame(args = {}) {
  const id = Number(args.id ?? 0)
  if (!Number.isInteger(id) || id < 0 || id > 0x1fffffff) throw new Error('CAN 仲裁 id 需为 0-0x1FFFFFFF 的整数')
  const data = args.data ?? args.bytes ?? ''
  const hex = Buffer.isBuffer(data) ? data.toString('hex') : String(data).replace(/\s/g, '')
  if (!/^[\da-fA-F]*$/.test(hex) || hex.length > 16) throw new Error('CAN data 需为 ≤8 字节的十六进制')
  return `${id.toString(16).toUpperCase()}#${hex.toUpperCase()}`
}

export class CanDeviceSubAgent extends DeviceSubAgent {
  constructor({ id, name, host, port = 29536, emit = null } = {}) {
    super({
      id,
      name,
      capabilities: ['can_frame'],
      actions: [
        { id: 'send_frame', description: '发送 CAN 帧', risk_level: RISK_LEVELS.HIGH, input_schema: { id: 'number', data: 'hex' } },
      ],
      state_schema: ['last_frame'],
      privacy: PRIVACY_LEVELS.PRIVATE,
      emit,
    })
    this.host = host
    this.port = port
    this.socket = null
    this.lastFrame = null
  }

  async _connect() {
    if (!this.host) throw new Error('CAN 适配器需要 host（TCP→CAN 网桥地址）')
    await new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port })
      s.setEncoding('utf8')
      s.once('connect', () => { this.socket = s; resolve(true) })
      s.once('error', reject)
      s.on('data', (chunk) => {
        for (const line of chunk.split(/\r?\n/)) {
          const frame = parseCanFrame(line)
          if (frame) this.lastFrame = frame
        }
      })
    })
    return true
  }

  async _readState() {
    return { last_frame: this.lastFrame }
  }

  async _executeAction(actionId, args) {
    if (actionId !== 'send_frame') throw new Error(`未知动作：${actionId}`)
    const frame = encodeCanFrame(args)
    await new Promise((resolve, reject) => {
      this.socket.write(`${frame}\n`, (err) => (err ? reject(err) : resolve()))
    })
    return { sent: frame }
  }

  async disconnect() {
    try { this.socket?.destroy() } catch {}
    return super.disconnect()
  }
}

// ─────────────────────────────────────────────────────────────
// ROS 2（车载机器人 / 机器狼，经 rosbridge WebSocket）
// ─────────────────────────────────────────────────────────────

export class RosDeviceSubAgent extends DeviceSubAgent {
  constructor({
    id, name,
    url = 'ws://127.0.0.1:9090',
    stateTopic = null,      // 订阅状态话题（读状态）
    msgType = 'std_msgs/msg/String',
    actionTopic = null,     // 发布动作话题（执行动作）
    service = null,         // 若提供，则动作走 call_service
    emit = null,
  } = {}) {
    super({
      id,
      name,
      capabilities: ['ros_publish', 'ros_service'],
      actions: [
        { id: 'execute', description: '发布动作 / 调用 ROS 服务', risk_level: RISK_LEVELS.HIGH, input_schema: { msg: 'object' } },
      ],
      state_schema: ['latest'],
      privacy: PRIVACY_LEVELS.PRIVATE,
      emit,
    })
    this.url = url
    this.stateTopic = stateTopic
    this.msgType = msgType
    this.actionTopic = actionTopic
    this.service = service
    this.ws = null
    this.latest = null
    this._pending = new Map()
    this._seq = 0
  }

  _sendRos(obj) {
    this.ws?.send(JSON.stringify(obj))
  }

  async _connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      ws.on('open', () => {
        this.ws = ws
        if (this.stateTopic) {
          this._sendRos({ op: 'subscribe', topic: this.stateTopic, type: this.msgType })
        }
        resolve(true)
      })
      ws.on('error', reject)
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.op === 'publish' && msg.topic === this.stateTopic) this.latest = msg.msg
        } catch { /* 忽略非 JSON 帧 */ }
      })
    })
    return true
  }

  async _readState() {
    return { topic: this.stateTopic, latest: this.latest }
  }

  async _executeAction(actionId, args) {
    if (actionId !== 'execute') throw new Error(`未知动作：${actionId}`)
    if (this.service) {
      this._sendRos({ op: 'call_service', service: this.service, args: args?.msg ?? args ?? {} })
      return { called_service: this.service }
    }
    const topic = this.actionTopic || this.stateTopic
    if (!topic) throw new Error('ROS 适配器需提供 actionTopic 或 service 才能执行动作')
    this._sendRos({ op: 'publish', topic, msg: args?.msg ?? args ?? {} })
    return { published: topic }
  }

  async disconnect() {
    try { this.ws?.close() } catch {}
    return super.disconnect()
  }
}

// ─────────────────────────────────────────────────────────────
// 工厂：按协议名构建适配器
// ─────────────────────────────────────────────────────────────

export function createDeviceAdapter(kind, options = {}) {
  switch (kind) {
    case DEVICE_PROTOCOLS.MATTER:
      return new MatterDeviceSubAgent(options)
    case DEVICE_PROTOCOLS.CAN:
      return new CanDeviceSubAgent(options)
    case DEVICE_PROTOCOLS.ROS:
      return new RosDeviceSubAgent(options)
    default:
      throw new Error(`未知设备协议：${kind}（支持 matter / can / ros）`)
  }
}
