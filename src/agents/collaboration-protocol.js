import { emitEvent } from '../events.js'

// ── 多智能体协作协议模块 ──────────────────────────────────────────────────────
// 提供 Agent 能力通告、任务分发（主从/点对点/投票）、发现注册、
// 结果聚合、会话管理及事件通信等核心协作能力。
// ───────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, AgentRegistration>} 已注册的 Agent 注册表 */
const agentRegistry = new Map()

/** @type {Map<string, CollaborationSession>} 活跃协作会话表 */
const activeSessions = new Map()

/** @type {Map<string, TaskResult[]>} 按任务 ID 聚合的结果缓存 */
const resultAggregates = new Map()

/** @type {Map<string, Function[]>} 事件订阅者表，key 为事件类型 */
const eventSubscribers = new Map()

/** @type {boolean} 协议模块是否已初始化 */
let protocolInitialized = false

// ── 数据结构定义 ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AgentRegistration
 * @property {string} id                  - Agent 唯一标识
 * @property {string} name                - Agent 显示名称
 * @property {string[]} capabilities      - 能力标签列表（如 ['code', 'search', 'vision']）
 * @property {Object}  metadata           - 附加元数据（版本、模型等）
 * @property {string}  status             - 当前状态：'idle' | 'busy' | 'offline'
 * @property {number}  registeredAt       - 注册时间戳（毫秒）
 * @property {number}  lastHeartbeat      - 最后心跳时间戳（毫秒）
 */

/**
 * @typedef {Object} CollaborationSession
 * @property {string} id                  - 会话唯一标识
 * @property {string} taskId              - 关联任务 ID
 * @property {string} protocol            - 协议类型：'master-slave' | 'peer-to-peer' | 'voting'
 * @property {string} initiatorId         - 发起方 Agent ID
 * @property {string[]} participants      - 参与方 Agent ID 列表
 * @property {Map<string, any>} results   - 各参与方的执行结果
 * @property {string} status              - 会话状态：'active' | 'completed' | 'failed' | 'aborted'
 * @property {number} createdAt          - 会话创建时间戳
 * @property {number} updatedAt          - 会话最后更新时间戳
 */

/**
 * @typedef {Object} TaskResult
 * @property {string} taskId              - 任务 ID
 * @property {string} agentId             - 执行 Agent ID
 * @property {any}    payload             - 执行结果数据
 * @property {boolean} success            - 是否成功
 * @property {number} timestamp           - 结果提交时间戳
 */

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 生成唯一 ID（时间戳 + 随机数） */
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 深拷贝简单对象（避免 structuredClone 兼容问题） */
function shallowClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  return Array.isArray(obj) ? [...obj] : { ...obj }
}

/** 检查 Agent 是否在线（心跳超时 > 30s 视为离线） */
function isAgentOnline(reg) {
  if (!reg) return false
  return reg.status !== 'offline' && (Date.now() - reg.lastHeartbeat) < 30_000
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

/**
 * 初始化协作协议模块
 * 负责注册全局事件订阅、启动心跳检测定时器。
 * @returns {Promise<{success: boolean, message: string}>} 初始化结果
 */
export async function initCollaborationProtocol() {
  if (protocolInitialized) {
    return { success: true, message: '协作协议已初始化' }
  }

  // 注册内置事件类型订阅
  registerInternalEvents()

  // 启动心跳检查定时器（每 15 秒扫描一次离线 Agent）
  setInterval(() => {
    const now = Date.now()
    for (const [id, reg] of agentRegistry) {
      if (reg.status !== 'offline' && (now - reg.lastHeartbeat) > 30_000) {
        reg.status = 'offline'
        emitEvent('agent_offline', { agentId: id, reason: 'heartbeat_timeout' })
      }
    }
  }, 15_000)

  protocolInitialized = true
  emitEvent('collaboration_protocol_initialized', { timestamp: Date.now() })

  return { success: true, message: '协作协议初始化完成' }
}

// ── Agent 发现与注册 ─────────────────────────────────────────────────────────

/**
 * 注册一个 Agent 到协作网络
 * @param {Object}  params
 * @param {string}  params.id              - Agent 唯一标识
 * @param {string}  params.name            - Agent 名称
 * @param {string[]} params.capabilities   - 能力标签列表
 * @param {Object}  [params.metadata={}]   - 附加元数据
 * @returns {AgentRegistration} 注册后的 Agent 信息
 */
export function registerAgent({ id, name, capabilities, metadata = {} }) {
  if (!id || !name) {
    throw new Error('注册 Agent 需要提供 id 和 name')
  }

  const now = Date.now()
  const registration = {
    id,
    name,
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    metadata,
    status: 'idle',
    registeredAt: now,
    lastHeartbeat: now,
  }

  agentRegistry.set(id, registration)
  emitEvent('agent_registered', { agent: shallowClone(registration) })

  return registration
}

/**
 * 注销一个 Agent
 * @param {string} agentId - 要注销的 Agent ID
 * @returns {boolean} 是否成功注销
 */
export function unregisterAgent(agentId) {
  const existed = agentRegistry.delete(agentId)
  if (existed) {
    emitEvent('agent_unregistered', { agentId })
  }
  return existed
}

/**
 * 刷新 Agent 心跳（保持在线状态）
 * @param {string} agentId - Agent ID
 */
function heartbeat(agentId) {
  const reg = agentRegistry.get(agentId)
  if (reg) {
    reg.lastHeartbeat = Date.now()
    if (reg.status === 'offline') {
      reg.status = 'idle'
      emitEvent('agent_reconnected', { agentId })
    }
  }
}

// ── 能力通告 ─────────────────────────────────────────────────────────────────

/**
 * 通告 Agent 的能力变更
 * 当 Agent 能力发生变化（如插件加载、模型切换）时，
 * 通过事件广播通知协作网络中的其他 Agent。
 *
 * @param {string}   agentId                  - 目标 Agent ID
 * @param {string[]} capabilities             - 更新后的能力列表
 * @param {Object}   [extra={}]               - 附加通告数据
 * @returns {{success: boolean, broadcastId: string}} 通告结果
 */
export function advertiseCapabilities(agentId, capabilities, extra = {}) {
  const reg = agentRegistry.get(agentId)
  if (!reg) {
    throw new Error(`Agent ${agentId} 未注册，无法通告能力`)
  }

  reg.capabilities = Array.isArray(capabilities) ? capabilities : []
  heartbeat(agentId)

  const broadcastId = generateId('cap')
  const payload = {
    broadcastId,
    agentId,
    agentName: reg.name,
    capabilities: [...reg.capabilities],
    metadata: { ...reg.metadata, ...extra },
    timestamp: Date.now(),
  }

  // 广播能力变更事件
  emitEvent('capabilities_advertised', payload)
  dispatchToSubscribers('capabilities_advertised', payload)

  return { success: true, broadcastId }
}

/**
 * 查找具备指定能力的在线 Agent 列表
 * @param {string[]} requiredCaps - 所需能力标签（AND 匹配）
 * @returns {AgentRegistration[]} 匹配的 Agent 数组
 */
function findAgentsByCapabilities(requiredCaps) {
  if (!requiredCaps || requiredCaps.length === 0) {
    return [...agentRegistry.values()].filter(isAgentOnline)
  }
  return [...agentRegistry.values()].filter(reg => {
    if (!isAgentOnline(reg)) return false
    return requiredCaps.every(cap => reg.capabilities.includes(cap))
  })
}

// ── 任务分发协议 ─────────────────────────────────────────────────────────────

/**
 * 分发任务到协作网络
 * 支持三种协议模式：
 *   - master-slave：主从模式，由发起方指定执行 Agent
 *   - peer-to-peer：点对点模式，广播到所有匹配 Agent
 *   - voting：投票模式，多个 Agent 执行后按投票规则聚合
 *
 * @param {Object}   params
 * @param {string}   params.taskId              - 任务唯一标识
 * @param {string}   params.taskType            - 任务类型（如 'code_review', 'data_analysis'）
 * @param {string}   params.protocol            - 分发协议：'master-slave' | 'peer-to-peer' | 'voting'
 * @param {string}   params.initiatorId         - 发起方 Agent ID
 * @param {string[]} [params.targetAgentIds]    - 目标 Agent ID 列表（master-slave 模式必填）
 * @param {string[]} [params.requiredCaps]      - 所需能力标签（peer-to-peer 模式使用）
 * @param {any}      params.payload             - 任务载荷数据
 * @param {Object}   [params.options={}]        - 附加选项（超时、重试等）
 * @returns {CollaborationSession} 创建的协作会话
 */
export function distributeTask({
  taskId,
  taskType,
  protocol,
  initiatorId,
  targetAgentIds,
  requiredCaps,
  payload,
  options = {},
}) {
  if (!taskId || !protocol || !initiatorId) {
    throw new Error('分发任务需要 taskId、protocol 和 initiatorId')
  }

  // ── 确定参与方 ────────────────────────────────────────────────────────────
  let participants = []

  switch (protocol) {
    case 'master-slave':
      if (!targetAgentIds || targetAgentIds.length === 0) {
        throw new Error('master-slave 协议需要指定 targetAgentIds')
      }
      participants = targetAgentIds.filter(id => agentRegistry.has(id))
      break

    case 'peer-to-peer':
      participants = findAgentsByCapabilities(requiredCaps).map(reg => reg.id)
      break

    case 'voting':
      const voters = findAgentsByCapabilities(requiredCaps)
      // 投票模式至少需要 2 个 Agent，不足则回退到所有在线 Agent
      participants = voters.length >= 2
        ? voters.map(reg => reg.id)
        : [...agentRegistry.values()].filter(isAgentOnline).map(reg => reg.id)
      break

    default:
      throw new Error(`未知的协作协议: ${protocol}`)
  }

  if (participants.length === 0) {
    throw new Error(`未找到符合条件的 Agent，无法分发任务 ${taskId}`)
  }

  // ── 创建协作会话 ──────────────────────────────────────────────────────────
  const now = Date.now()
  /** @type {CollaborationSession} */
  const session = {
    id: generateId('sess'),
    taskId,
    protocol,
    initiatorId,
    participants,
    results: new Map(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  activeSessions.set(session.id, session)

  // ── 标记参与方为忙碌状态 ──────────────────────────────────────────────────
  for (const pid of participants) {
    const reg = agentRegistry.get(pid)
    if (reg) reg.status = 'busy'
  }

  // ── 广播任务分发事件 ──────────────────────────────────────────────────────
  const dispatchEvent = {
    sessionId: session.id,
    taskId,
    taskType,
    protocol,
    initiatorId,
    participants,
    payload: shallowClone(payload),
    options: shallowClone(options),
    timestamp: now,
  }

  emitEvent('task_distributed', dispatchEvent)
  dispatchToSubscribers('task_distributed', dispatchEvent)

  // ── 设置超时自动失败 ──────────────────────────────────────────────────────
  const timeoutMs = options.timeoutMs || 60_000
  setTimeout(() => {
    if (session.status === 'active') {
      session.status = 'failed'
      session.updatedAt = Date.now()
      emitEvent('session_timeout', { sessionId: session.id, taskId })
      cleanupSessionAgents(session)
    }
  }, timeoutMs)

  return session
}

// ── 结果聚合 ─────────────────────────────────────────────────────────────────

/**
 * 提交任务执行结果
 * @param {string}  sessionId - 协作会话 ID
 * @param {string}  agentId   - 提交结果的 Agent ID
 * @param {any}     payload   - 执行结果数据
 * @param {boolean} [success=true] - 是否成功
 * @returns {TaskResult} 提交的结果记录
 */
function submitTaskResult(sessionId, agentId, payload, success = true) {
  const session = activeSessions.get(sessionId)
  if (!session) {
    throw new Error(`会话 ${sessionId} 不存在`)
  }

  const result = {
    taskId: session.taskId,
    agentId,
    payload,
    success,
    timestamp: Date.now(),
  }

  session.results.set(agentId, result)
  session.updatedAt = result.timestamp

  // 缓存到全局聚合表
  if (!resultAggregates.has(session.taskId)) {
    resultAggregates.set(session.taskId, [])
  }
  resultAggregates.get(session.taskId).push(result)

  // 恢复 Agent 状态
  const reg = agentRegistry.get(agentId)
  if (reg && reg.status === 'busy') {
    reg.status = 'idle'
  }

  emitEvent('task_result_submitted', {
    sessionId,
    agentId,
    success,
    hasAllResults: session.results.size >= session.participants.length,
    submittedCount: session.results.size,
    totalCount: session.participants.length,
  })

  // 检查是否所有参与方都提交了结果
  if (session.results.size >= session.participants.length) {
    finalizeSession(session)
  }

  return result
}

/**
 * 完成会话，聚合所有参与方的结果并确定最终结论
 * @param {CollaborationSession} session - 协作会话
 */
function finalizeSession(session) {
  const results = [...session.results.values()]

  // 根据协议类型选择聚合策略
  let finalResult
  let finalStatus = 'completed'

  switch (session.protocol) {
    case 'master-slave':
      // 主从：取第一个成功结果
      const masterResult = results.find(r => r.success) || results[0]
      finalResult = masterResult.payload
      finalStatus = masterResult.success ? 'completed' : 'failed'
      break

    case 'peer-to-peer':
      // 点对点：合并所有成功结果
      const successful = results.filter(r => r.success)
      finalResult = successful.map(r => r.payload)
      finalStatus = successful.length > 0 ? 'completed' : 'failed'
      break

    case 'voting':
      // 投票：按 payload 相等性分组，取多数
      finalResult = aggregateByVoting(results)
      finalStatus = 'completed'
      break
  }

  session.status = finalStatus
  session.updatedAt = Date.now()

  emitEvent('session_completed', {
    sessionId: session.id,
    taskId: session.taskId,
    protocol: session.protocol,
    finalResult,
    participantCount: session.participants.length,
    successCount: results.filter(r => r.success).length,
    failCount: results.filter(r => !r.success).length,
    timestamp: session.updatedAt,
  })

  dispatchToSubscribers('session_completed', {
    sessionId: session.id,
    finalResult,
  })

  cleanupSessionAgents(session)
}

/**
 * 投票聚合策略：按结果内容分组，返回多数派结果
 * @param {TaskResult[]} results - 参与方提交的结果列表
 * @returns {any} 多数派结果
 */
function aggregateByVoting(results) {
  const groups = new Map()
  for (const r of results) {
    const key = JSON.stringify(r.payload)
    if (!groups.has(key)) {
      groups.set(key, { payload: r.payload, count: 0, successCount: 0 })
    }
    const group = groups.get(key)
    group.count++
    if (r.success) group.successCount++
  }

  // 优先按成功数排序，其次按总数
  const sorted = [...groups.values()].sort((a, b) => {
    if (b.successCount !== a.successCount) return b.successCount - a.successCount
    return b.count - a.count
  })

  return sorted.length > 0 ? sorted[0].payload : null
}

/**
 * 清理会话中参与方的忙碌状态
 * @param {CollaborationSession} session
 */
function cleanupSessionAgents(session) {
  for (const pid of session.participants) {
    const reg = agentRegistry.get(pid)
    if (reg && reg.status === 'busy') {
      reg.status = 'idle'
    }
  }
}

// ── 协作状态查询 ─────────────────────────────────────────────────────────────

/**
 * 获取当前协作协议的整体状态
 * @returns {Object} 协作状态快照
 */
export function getCollaborationStatus() {
  const agents = [...agentRegistry.values()]
  const sessions = [...activeSessions.values()]

  return {
    timestamp: Date.now(),
    registeredAgents: agents.length, // 兼容字段
    agents: {
      total: agents.length,
      online: agents.filter(isAgentOnline).length,
      busy: agents.filter(a => a.status === 'busy').length,
      offline: agents.filter(a => a.status === 'offline').length,
      list: agents.map(a => ({
        id: a.id,
        name: a.name,
        status: a.status,
        capabilities: a.capabilities,
        lastHeartbeat: a.lastHeartbeat,
      })),
    },
    sessions: {
      total: sessions.length,
      active: sessions.filter(s => s.status === 'active').length,
      completed: sessions.filter(s => s.status === 'completed').length,
      failed: sessions.filter(s => s.status === 'failed').length,
    },
    resultAggregates: resultAggregates.size,
  }
}

/**
 * 列出所有活跃协作会话
 * @param {Object}  [filter={}] - 过滤条件
 * @param {string}  [filter.status]    - 按状态过滤
 * @param {string}  [filter.protocol]  - 按协议过滤
 * @param {string}  [filter.initiatorId] - 按发起方过滤
 * @returns {CollaborationSession[]} 会话列表
 */
export function listActiveSessions(filter = {}) {
  let sessions = [...activeSessions.values()]

  if (filter.status) {
    sessions = sessions.filter(s => s.status === filter.status)
  }
  if (filter.protocol) {
    sessions = sessions.filter(s => s.protocol === filter.protocol)
  }
  if (filter.initiatorId) {
    sessions = sessions.filter(s => s.initiatorId === filter.initiatorId)
  }

  return sessions.map(s => ({
    id: s.id,
    taskId: s.taskId,
    protocol: s.protocol,
    initiatorId: s.initiatorId,
    participants: [...s.participants],
    status: s.status,
    submittedResults: s.results.size,
    totalParticipants: s.participants.length,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }))
}

// ── 冲突解决 ─────────────────────────────────────────────────────────────────

/**
 * 解决 Agent 之间的任务冲突
 * 当多个 Agent 尝试访问同一资源或处理同一任务时，
 * 根据优先级、能力匹配度和负载选择最优 Agent。
 *
 * @param {Object}   params
 * @param {string}   params.resourceId         - 冲突资源或任务 ID
 * @param {string[]} params.candidateAgentIds  - 候选 Agent ID 列表
 * @param {string}   [params.strategy='capability-first'] - 解决策略：
 *   - 'capability-first'  : 优先选择能力匹配度高的 Agent
 *   - 'least-loaded'      : 优先选择负载最低的 Agent
 *   - 'priority'          : 按 Agent 元数据中的 priority 字段排序
 *   - 'round-robin'       : 轮询选择（基于资源 ID 哈希）
 * @param {string[]} [params.requiredCaps]     - 所需能力（capability-first 策略使用）
 * @returns {{selectedAgentId: string, reason: string, score: number}} 解决结果
 */
export function resolveConflict({
  resourceId,
  candidateAgentIds,
  strategy = 'capability-first',
  requiredCaps = [],
}) {
  if (!candidateAgentIds || candidateAgentIds.length === 0) {
    throw new Error('冲突解决需要候选 Agent 列表')
  }

  const candidates = candidateAgentIds
    .map(id => agentRegistry.get(id))
    .filter(Boolean)

  if (candidates.length === 0) {
    throw new Error('没有找到有效的候选 Agent')
  }

  let ranked

  switch (strategy) {
    case 'capability-first':
      ranked = candidates
        .map(reg => {
          const matchedCaps = reg.capabilities.filter(c => requiredCaps.includes(c))
          const score = requiredCaps.length > 0
            ? matchedCaps.length / requiredCaps.length
            : 0.5
          return { reg, score }
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          // 能力匹配相同时，优先选空闲 Agent
          const aBusy = a.reg.status === 'busy' ? 1 : 0
          const bBusy = b.reg.status === 'busy' ? 1 : 0
          return aBusy - bBusy
        })
      break

    case 'least-loaded':
      ranked = candidates
        .map(reg => ({
          reg,
          score: reg.status === 'busy' ? 0 : 1,
        }))
        .sort((a, b) => b.score - a.score)
      break

    case 'priority':
      ranked = candidates
        .map(reg => ({
          reg,
          score: (reg.metadata?.priority) || 0,
        }))
        .sort((a, b) => b.score - a.score)
      break

    case 'round-robin':
      const hash = hashString(resourceId || Date.now().toString())
      const index = hash % candidates.length
      ranked = candidates
        .map((reg, i) => ({ reg, score: i === index ? 1 : 0 }))
        .sort((a, b) => b.score - a.score)
      break

    default:
      ranked = candidates.map(reg => ({ reg, score: 0.5 }))
  }

  const winner = ranked[0]
  emitEvent('conflict_resolved', {
    resourceId,
    strategy,
    selectedAgentId: winner.reg.id,
    score: winner.score,
    candidates: candidates.map(c => c.id),
    timestamp: Date.now(),
  })

  return {
    selectedAgentId: winner.reg.id,
    reason: `策略 ${strategy}：评分 ${winner.score.toFixed(2)}`,
    score: winner.score,
  }
}

/** 简单字符串哈希（用于 round-robin 策略） */
function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

// ── 事件订阅机制 ─────────────────────────────────────────────────────────────

/**
 * 订阅协作事件
 * @param {string}   eventType - 事件类型
 * @param {Function} handler   - 事件处理函数 (payload => void)
 * @returns {Function} 取消订阅函数
 */
function subscribe(eventType, handler) {
  if (!eventSubscribers.has(eventType)) {
    eventSubscribers.set(eventType, new Set())
  }
  eventSubscribers.get(eventType).add(handler)

  // 返回取消订阅函数
  return () => {
    const set = eventSubscribers.get(eventType)
    if (set) set.delete(handler)
  }
}

/**
 * 向指定事件类型的订阅者分发数据
 * @param {string} eventType - 事件类型
 * @param {any}    payload   - 事件载荷
 */
function dispatchToSubscribers(eventType, payload) {
  const handlers = eventSubscribers.get(eventType)
  if (!handlers) return

  for (const handler of handlers) {
    try {
      handler(payload)
    } catch (err) {
      console.warn(`[协作协议] 事件处理器错误 (${eventType}):`, err.message)
    }
  }
}

/**
 * 注册内置事件订阅（用于跨 Agent 通信的事件桥接）
 */
function registerInternalEvents() {
  // Agent 离线事件 → 通知活跃会话
  subscribe('agent_offline', ({ agentId }) => {
    for (const [sessionId, session] of activeSessions) {
      if (session.status === 'active' && session.participants.includes(agentId)) {
        emitEvent('session_participant_offline', {
          sessionId,
          offlineAgentId: agentId,
          remainingParticipants: session.participants.filter(p => p !== agentId),
        })
      }
    }
  })

  // 新 Agent 注册 → 通知现有 Agent
  subscribe('agent_registered', ({ agent }) => {
    emitEvent('peer_discovered', {
      agentId: agent.id,
      agentName: agent.name,
      capabilities: agent.capabilities,
      timestamp: Date.now(),
    })
  })

  // 能力通告 → 更新能力索引
  subscribe('capabilities_advertised', (payload) => {
    const reg = agentRegistry.get(payload.agentId)
    if (reg && payload.capabilities) {
      reg.capabilities = payload.capabilities
    }
  })
}

// ── Agent 间事件通信 ──────────────────────────────────────────────────────────

/**
 * 向指定 Agent 发送消息（通过事件总线）
 * @param {string}  senderId   - 发送方 Agent ID
 * @param {string}  receiverId - 接收方 Agent ID
 * @param {string}  messageType - 消息类型（如 'request', 'response', 'notification'）
 * @param {any}     payload    - 消息载荷
 */
function sendAgentMessage(senderId, receiverId, messageType, payload) {
  const msg = {
    id: generateId('msg'),
    senderId,
    receiverId,
    messageType,
    payload,
    timestamp: Date.now(),
  }

  emitEvent('agent_message', msg)
  dispatchToSubscribers(`agent_message:${receiverId}`, msg)
}

/**
 * 广播消息到所有在线 Agent
 * @param {string} senderId   - 发送方 Agent ID
 * @param {string} messageType - 消息类型
 * @param {any}    payload    - 消息载荷
 */
function broadcastAgentMessage(senderId, messageType, payload) {
  const recipients = [...agentRegistry.values()]
    .filter(isAgentOnline)
    .map(reg => reg.id)

  for (const rid of recipients) {
    if (rid !== senderId) {
      sendAgentMessage(senderId, rid, messageType, payload)
    }
  }
}