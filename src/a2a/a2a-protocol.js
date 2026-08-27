/**
 * A2A (Agent-to-Agent) 协议实现
 * 
 * 实现 Agent 间的标准通信协议，支持：
 * - Agent Card 注册与发现
 * - JSON-RPC 2.0 任务分发
 * - 跨框架协作
 * - SSE 流式状态更新
 * 
 * 基于 A2A v1.0.0 规范实现
 */

import http from 'http'
import crypto from 'crypto'

const DEFAULT_PORT = 3001
const PROTOCOL_VERSION = '1.0.0'
const AGENT_CARD_PATH = '/.well-known/agent-card.json'

export class GinaA2AServer {
  constructor(options = {}) {
    this.agentCard = this.buildAgentCard(options.agentCard || {})
    this.taskHandlers = options.taskHandlers || {}
    this.tasks = new Map()  // taskId -> taskRecord
    this.server = null
    this.port = options.port || DEFAULT_PORT
    this.host = options.host || '0.0.0.0'
    this.isRunning = false
  }

  /**
   * 构建 Agent Card
   */
  buildAgentCard(customCard = {}) {
    return {
      name: customCard.name || 'Gina',
      description: customCard.description || '跨领域智能研究与决策 Agent',
      url: customCard.url || `http://localhost:${this.port}${AGENT_CARD_PATH}`,
      version: customCard.version || '2.0.0',
      protocolVersion: PROTOCOL_VERSION,
      skills: customCard.skills || [
        {
          id: 'knowledge_query',
          name: '知识查询',
          description: '跨领域知识检索与推理',
          input: { type: 'object', properties: { query: { type: 'string' } } },
          output: { type: 'object', properties: { results: { type: 'array' } } },
        },
        {
          id: 'research',
          name: '研究分析',
          description: '自动文献阅读、假设验证、理论形成',
          input: { type: 'object', properties: { topic: { type: 'string' } } },
          output: { type: 'object', properties: { report: { type: 'object' } } },
        },
        {
          id: 'decision',
          name: '决策分析',
          description: '多准则决策分析、伦理评估、可解释推理',
          input: { type: 'object' },
          output: { type: 'object' },
        },
        {
          id: 'emotion_analysis',
          name: '情感分析',
          description: '文本情感识别与情感强度评估',
          input: { type: 'object', properties: { text: { type: 'string' } } },
          output: { type: 'object', properties: { emotion: { type: 'string' } } },
        },
      ],
      capabilities: {
        streaming: true,
        pushNotifications: false,
        longTasks: true,
      },
      endpoints: {
        taskEndpoint: '/a2a/tasks',
        streamEndpoint: '/a2a/stream',
      },
    }
  }

  /**
   * 启动 A2A 服务器
   */
  async start() {
    if (this.isRunning) {
      console.warn('[Gina A2A] Server is already running')
      return
    }

    this.server = http.createServer((req, res) => this.handleRequest(req, res))
    
    await new Promise((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        this.isRunning = true
        console.log(`[Gina A2A] Server started on ${this.host}:${this.port}`)
        console.log(`[Gina A2A] Agent Card: http://localhost:${this.port}${AGENT_CARD_PATH}`)
        resolve()
      })
      this.server.on('error', reject)
    })

    return { port: this.port, host: this.host, agentCard: this.agentCard }
  }

  /**
   * 停止 A2A 服务器
   */
  async stop() {
    if (!this.isRunning) return
    
    await new Promise((resolve) => {
      this.server.close(() => {
        this.isRunning = false
        console.log('[Gina A2A] Server stopped')
        resolve()
      })
    })
  }

  /**
   * 处理 HTTP 请求
   */
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const method = req.method.toUpperCase()

    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    // OPTIONS 预检请求
    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      // Agent Card 端点
      if (url.pathname === AGENT_CARD_PATH) {
        this.handleAgentCard(res)
        return
      }

      // SSE 流式端点
      if (url.pathname.startsWith('/a2a/stream/')) {
        const taskId = url.pathname.replace('/a2a/stream/', '')
        this.handleStream(req, res, taskId)
        return
      }

      // JSON-RPC 2.0 端点
      if (url.pathname === '/a2a/tasks' && method === 'POST') {
        await this.handleJsonRpc(req, res)
        return
      }

      // 健康检查
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          status: 'healthy',
          agent: this.agentCard.name,
          version: this.agentCard.version,
          uptime: process.uptime(),
        }))
        return
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found', path: url.pathname }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }))
    }
  }

  /**
   * 返回 Agent Card
   */
  handleAgentCard(res) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(this.agentCard, null, 2))
  }

  /**
   * 处理 SSE 流式传输
   */
  handleStream(req, res, taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify({ error: 'Task not found' })}\n\n`)
      return
    }

    // 设置 SSE 头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    // 发送初始事件
    res.write(`data: ${JSON.stringify({ type: 'task_status', taskId, status: task.status })}\n\n`)

    // 如果任务已完成，发送最终状态并关闭
    if (task.status === 'completed' || task.status === 'failed') {
      res.write(`data: ${JSON.stringify({ 
        type: 'task_result', 
        taskId, 
        status: task.status,
        result: task.result 
      })}\n\n`)
      res.end()
      return
    }

    // 等待任务完成（简单实现：直接等待）
    const checkInterval = setInterval(() => {
      const currentTask = this.tasks.get(taskId)
      if (!currentTask) {
        clearInterval(checkInterval)
        res.end()
        return
      }

      if (currentTask.status === 'completed' || currentTask.status === 'failed') {
        res.write(`data: ${JSON.stringify({ 
          type: 'task_result', 
          taskId, 
          status: currentTask.status,
          result: currentTask.result 
        })}\n\n`)
        clearInterval(checkInterval)
        res.end()
      }
    }, 1000)

    // 客户端断开时清理
    req.on('close', () => {
      clearInterval(checkInterval)
    })
  }

  /**
   * 处理 JSON-RPC 2.0 请求
   */
  async handleJsonRpc(req, res) {
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    let request
    try {
      request = JSON.parse(body)
    } catch {
      this.sendJsonRpcError(res, null, -32700, 'Parse error')
      return
    }

    const { jsonrpc, method, params, id } = request

    if (jsonrpc !== '2.0') {
      this.sendJsonRpcError(res, id, -32600, 'Invalid Request: jsonrpc must be "2.0"')
      return
    }

    if (!method) {
      this.sendJsonRpcError(res, id, -32600, 'Invalid Request: method is required')
      return
    }

    try {
      const result = await this.routeMethod(method, params)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', result, id }))
    } catch (err) {
      const code = err.code || -32000
      this.sendJsonRpcError(res, id, code, err.message || 'Internal error')
    }
  }

  /**
   * 路由方法调用
   */
  async routeMethod(method, params) {
    switch (method) {
      case 'agent/card':
        return this.agentCard

      case 'task/send':
        return this.handleTaskSend(params)

      case 'task/get':
        return this.handleTaskGet(params)

      case 'task/cancel':
        return this.handleTaskCancel(params)

      case 'tasks/list':
        return this.handleTasksList(params)

      default:
        throw { code: -32601, message: `Method not found: ${method}` }
    }
  }

  /**
   * 处理任务发送
   */
  async handleTaskSend(params) {
    const taskId = params?.id || `task_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    const taskData = params?.task || params

    const task = {
      id: taskId,
      status: 'submitted',
      input: taskData?.input || taskData,
      output: null,
      artifacts: [],
      messages: [],
      metadata: taskData?.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.tasks.set(taskId, task)

    // 异步处理任务
    this.processTask(taskId).catch(err => {
      console.error(`[Gina A2A] Task ${taskId} failed:`, err.message)
      task.status = 'failed'
      task.error = err.message
      task.updatedAt = Date.now()
    })

    return {
      taskId,
      status: 'submitted',
      estimatedDuration: this.estimateDuration(task),
    }
  }

  /**
   * 处理任务查询
   */
  async handleTaskGet(params) {
    const taskId = params?.id || params?.taskId
    if (!taskId) {
      throw { code: -32602, message: 'Invalid params: taskId is required' }
    }

    const task = this.tasks.get(taskId)
    if (!task) {
      throw { code: -32001, message: `Task ${taskId} not found` }
    }

    return {
      taskId: task.id,
      status: task.status,
      input: task.input,
      output: task.output,
      artifacts: task.artifacts,
      messages: task.messages,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }
  }

  /**
   * 处理任务取消
   */
  async handleTaskCancel(params) {
    const taskId = params?.id || params?.taskId
    if (!taskId) {
      throw { code: -32602, message: 'Invalid params: taskId is required' }
    }

    const task = this.tasks.get(taskId)
    if (!task) {
      throw { code: -32001, message: `Task ${taskId} not found` }
    }

    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      return { taskId, status: task.status, message: 'Task is already in a terminal state' }
    }

    task.status = 'cancelled'
    task.cancelledAt = Date.now()
    task.updatedAt = Date.now()

    return { taskId, status: 'cancelled' }
  }

  /**
   * 处理任务列表
   */
  async handleTasksList(params) {
    const { status, limit = 20, offset = 0 } = params || {}
    let tasks = [...this.tasks.values()]

    if (status) {
      tasks = tasks.filter(t => t.status === status)
    }

    tasks.sort((a, b) => b.createdAt - a.createdAt)
    const total = tasks.length
    tasks = tasks.slice(offset, offset + limit)

    return {
      total,
      tasks: tasks.map(t => ({
        taskId: t.id,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    }
  }

  /**
   * 执行任务
   */
  async processTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) return

    task.status = 'working'
    task.updatedAt = Date.now()

    try {
      // 根据任务类型调用对应的处理器
      const taskType = this.inferTaskType(task.input)
      const handler = this.taskHandlers[taskType] || this.taskHandlers.default

      let result
      if (handler) {
        result = await handler(task.input, task.metadata)
      } else {
        result = await this.defaultTaskHandler(task.input, task.metadata)
      }

      task.output = result
      task.status = 'completed'
      task.completedAt = Date.now()
      task.updatedAt = Date.now()

      console.log(`[Gina A2A] Task ${taskId} completed successfully`)
    } catch (err) {
      task.status = 'failed'
      task.error = err.message || String(err)
      task.failedAt = Date.now()
      task.updatedAt = Date.now()
      console.error(`[Gina A2A] Task ${taskId} failed:`, err.message)
    }

    return task
  }

  /**
   * 推断任务类型
   */
  inferTaskType(input) {
    const text = typeof input === 'string' ? input.toLowerCase() : JSON.stringify(input || {}).toLowerCase()
    
    if (/search|query|find|information|检索|查询|搜索/.test(text)) return 'knowledge_query'
    if (/research|analyze|analysis|study|研究|分析|学习/.test(text)) return 'research'
    if (/decide|decision|evaluate|choose|决策|评估|选择/.test(text)) return 'decision'
    if (/emotion|sentiment|feeling|情感|情绪/.test(text)) return 'emotion_analysis'
    
    return 'default'
  }

  /**
   * 默认任务处理器
   */
  async defaultTaskHandler(input, metadata) {
    return {
      status: 'completed',
      processedBy: this.agentCard.name,
      inputReceived: true,
      output: {
        message: 'Task processed by Gina A2A default handler',
        summary: typeof input === 'string' ? input.slice(0, 200) : 'Structured input processed',
      },
      metadata: {
        processedAt: Date.now(),
        handler: 'default',
      },
    }
  }

  /**
   * 估算任务时长
   */
  estimateDuration(task) {
    const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input || {})
    const length = input.length
    
    if (length < 100) return 'seconds'
    if (length < 1000) return 'minutes'
    return 'hours'
  }

  /**
   * 发送 JSON-RPC 错误
   */
  sendJsonRpcError(res, id, code, message) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id,
    }))
  }

  /**
   * 获取服务器状态
   */
  getStatus() {
    const tasks = [...this.tasks.values()]
    return {
      isRunning: this.isRunning,
      port: this.port,
      agentCard: {
        name: this.agentCard.name,
        version: this.agentCard.version,
        skills: this.agentCard.skills.map(s => s.id),
      },
      tasks: {
        total: tasks.length,
        submitted: tasks.filter(t => t.status === 'submitted').length,
        working: tasks.filter(t => t.status === 'working').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        failed: tasks.filter(t => t.status === 'failed').length,
      },
    }
  }
}

/**
 * A2A 客户端 - 用于发现远程 Agent 并委托任务
 */
export class A2AClient {
  constructor(options = {}) {
    this.knownAgents = new Map()  // agentUrl -> agentCard
    this.timeout = options.timeout || 30000
  }

  /**
   * 发现远程 Agent
   */
  async discoverAgent(agentUrl) {
    try {
      const response = await fetch(`${agentUrl}${AGENT_CARD_PATH}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const agentCard = await response.json()
      this.knownAgents.set(agentUrl, agentCard)
      
      console.log(`[A2A Client] Discovered agent: ${agentCard.name} at ${agentUrl}`)
      return agentCard
    } catch (err) {
      console.warn(`[A2A Client] Failed to discover agent at ${agentUrl}: ${err.message}`)
      throw err
    }
  }

  /**
   * 获取已知 Agent 列表
   */
  listKnownAgents() {
    return [...this.knownAgents.entries()].map(([url, card]) => ({
      url,
      name: card.name,
      description: card.description,
      version: card.version,
      skills: card.skills?.map(s => s.id) || [],
    }))
  }

  /**
   * 检查 Agent 是否能处理某项技能
   */
  canHandleSkill(agentUrl, skillId) {
    const agent = this.knownAgents.get(agentUrl)
    if (!agent) return false
    return agent.skills?.some(s => s.id === skillId) || false
  }

  /**
   * 委托任务给远程 Agent
   */
  async delegateTask(agentUrl, taskInput, options = {}) {
    const agent = this.knownAgents.get(agentUrl)
    if (!agent) {
      await this.discoverAgent(agentUrl)
    }

    const taskId = `task_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    
    const response = await fetch(`${agentUrl}/a2a/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'task/send',
        params: {
          id: taskId,
          task: {
            input: taskInput,
            metadata: {
              delegatedBy: 'gina-client',
              ...options.metadata,
            },
          },
        },
        id: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result = await response.json()
    
    if (result.error) {
      throw new Error(result.error.message || 'Unknown error')
    }

    return {
      taskId: result.result?.taskId || taskId,
      status: result.result?.status || 'unknown',
      estimatedDuration: result.result?.estimatedDuration,
      agent: agent.name,
    }
  }

  /**
   * 查询远程任务状态
   */
  async getTaskStatus(agentUrl, taskId) {
    const response = await fetch(`${agentUrl}/a2a/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'task/get',
        params: { id: taskId },
        id: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result = await response.json()
    return result.result || result.error
  }

  /**
   * 协调多 Agent 任务
   */
  async coordinateTask(agentUrls, taskTemplate) {
    const results = {}
    const errors = []

    for (const agentUrl of agentUrls) {
      try {
        // 确保已发现该 Agent
        if (!this.knownAgents.has(agentUrl)) {
          await this.discoverAgent(agentUrl)
        }

        // 尝试委托任务
        const taskId = `${Date.now()}_${crypto.randomUUID().slice(0, 6)}`
        const result = await this.delegateTask(agentUrl, taskTemplate.input, {
          metadata: { taskId, ...taskTemplate.metadata },
        })

        results[agentUrl] = {
          agent: this.knownAgents.get(agentUrl)?.name || agentUrl,
          taskId: result.taskId,
          status: result.status,
        }
      } catch (err) {
        errors.push({
          agent: agentUrl,
          error: err.message,
        })
      }
    }

    return {
      coordinationId: `coord_${Date.now()}`,
      results,
      errors,
      totalAgents: agentUrls.length,
      successCount: Object.keys(results).length,
    }
  }
}

/**
 * 创建 A2A 系统的便捷函数
 */
export function createA2AServer(options = {}) {
  return new GinaA2AServer(options)
}

export function createA2AClient(options = {}) {
  return new A2AClient(options)
}
