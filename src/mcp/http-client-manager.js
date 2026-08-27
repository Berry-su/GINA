/**
 * HTTP MCP Client Manager - 管理远程 MCP 服务器连接
 * 
 * 扩展 Gina 现有的 MCP 客户端，新增 HTTP/HTTPS 传输协议支持，
 * 允许连接到远程托管的 MCP 服务器（如 GitHub MCP、Notion MCP 等）。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

const MAX_CONNECTIONS = 50
const RECONNECT_DELAY_MS = 5000
const MAX_RECONNECT_ATTEMPTS = 3

export class HttpMcpClientManager {
  constructor(options = {}) {
    this.connections = new Map()  // serverId -> connectionInfo
    this.reconnectTimers = new Map()  // serverId -> timer
    this.defaultTimeout = options.defaultTimeout || 60000
    this.maxConnections = options.maxConnections || MAX_CONNECTIONS
  }

  /**
   * 连接到远程 MCP 服务器
   */
  async connect(serverConfig) {
    const { id, url, name, headers = {}, timeoutMs } = serverConfig

    if (!id || !url) throw new Error('Server id and url are required')
    if (this.connections.size >= this.maxConnections) {
      throw new Error(`Max connections (${this.maxConnections}) reached`)
    }

    // 清理旧的重连定时器
    this.clearReconnectTimer(id)

    const connection = {
      id,
      config: serverConfig,
      client: null,
      transport: null,
      status: 'connecting',
      error: '',
      tools: [],
      connectedAt: null,
      reconnectAttempts: 0,
    }

    this.connections.set(id, connection)

    try {
      const client = new Client({ name: 'gina-http-client', version: '1.0.0' })
      const transport = new SSEClientTransport(new URL(url), {
        headers: {
          'User-Agent': 'Gina-Agent/1.0',
          ...headers,
        },
      })

      client.onerror = (err) => {
        connection.error = err?.message || String(err)
        connection.status = 'error'
      }

      client.onclose = () => {
        connection.status = 'disconnected'
        connection.connectedAt = null
        // 触发重连（如果不是主动关闭）
        if (!connection.intentionalClose) {
          this.scheduleReconnect(id)
        }
      }

      const connectTimeout = timeoutMs || this.defaultTimeout
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Connection timeout after ${connectTimeout}ms`)), connectTimeout)
        ),
      ])

      connection.client = client
      connection.transport = transport
      connection.status = 'connected'
      connection.connectedAt = Date.now()
      connection.reconnectAttempts = 0

      // 获取远程工具列表
      const tools = await this.fetchTools(client)
      connection.tools = tools

      console.log(`[Gina HTTP MCP] Connected to "${name || id}" (${tools.length} tools)`)
      return this.getConnectionStatus(id)
    } catch (err) {
      connection.error = err?.message || String(err)
      connection.status = 'error'
      console.warn(`[Gina HTTP MCP] Failed to connect to "${id}": ${connection.error}`)
      throw err
    }
  }

  /**
   * 断开连接
   */
  async disconnect(serverId) {
    const connection = this.connections.get(serverId)
    if (!connection) throw new Error(`Connection "${serverId}" not found`)

    this.clearReconnectTimer(serverId)
    connection.intentionalClose = true

    try {
      await connection.client?.close()
    } catch (err) {
      console.warn(`[Gina HTTP MCP] Error closing connection "${serverId}": ${err.message}`)
    }

    this.connections.delete(serverId)
    return { id: serverId, status: 'disconnected' }
  }

  /**
   * 获取所有连接的远程工具
   */
  async getAllTools() {
    const allTools = []
    for (const [serverId, connection] of this.connections) {
      if (connection.status === 'connected') {
        for (const tool of connection.tools) {
          allTools.push({
            ...tool,
            serverId,
            serverName: connection.config.name || serverId,
            transport: 'http',
          })
        }
      }
    }
    return allTools
  }

  /**
   * 调用远程工具
   */
  async callTool(serverId, toolName, args = {}) {
    const connection = this.connections.get(serverId)
    if (!connection || connection.status !== 'connected') {
      throw new Error(`Server "${serverId}" is not connected`)
    }

    const timeout = connection.config.timeoutMs || this.defaultTimeout
    
    try {
      const result = await Promise.race([
        connection.client.callTool({ name: toolName, arguments: args }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Tool call timeout after ${timeout}ms`)), timeout)
        ),
      ])

      return {
        ok: !result.isError,
        serverId,
        toolName,
        content: result.content || [],
        structuredContent: result.structuredContent,
      }
    } catch (err) {
      return {
        ok: false,
        serverId,
        toolName,
        error: err.message || String(err),
      }
    }
  }

  /**
   * 搜索可用工具
   */
  async searchTools(query = '') {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
    if (!terms.length) return await this.getAllTools()

    const allTools = await this.getAllTools()
    return allTools.filter(tool => {
      const haystack = `${tool.name} ${tool.description} ${tool.serverName}`.toLowerCase()
      return terms.some(term => haystack.includes(term))
    })
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(serverId) {
    const connection = this.connections.get(serverId)
    if (!connection) return null
    return {
      id: connection.id,
      name: connection.config.name || connection.id,
      url: connection.config.url,
      status: connection.status,
      error: connection.error,
      toolCount: connection.tools.length,
      connectedAt: connection.connectedAt,
      transport: 'http',
    }
  }

  /**
   * 获取所有连接状态
   */
  getStatus() {
    const servers = [...this.connections.values()].map(conn => ({
      id: conn.id,
      name: conn.config.name || conn.id,
      url: conn.config.url,
      status: conn.status,
      toolCount: conn.tools.length,
      error: conn.error,
      connectedAt: conn.connectedAt,
    }))

    return {
      totalConnections: this.connections.size,
      connectedCount: servers.filter(s => s.status === 'connected').length,
      servers,
    }
  }

  /**
   * 关闭所有连接
   */
  async shutdown() {
    const results = []
    for (const serverId of [...this.connections.keys()]) {
      try {
        const result = await this.disconnect(serverId)
        results.push(result)
      } catch (err) {
        results.push({ id: serverId, error: err.message })
      }
    }
    return results
  }

  /**
   * 从远程服务器获取工具列表
   */
  async fetchTools(client) {
    const tools = []
    let cursor

    do {
      const result = await client.listTools(cursor ? { cursor } : undefined)
      tools.push(...(result.tools || []))
      cursor = result.nextCursor
    } while (cursor)

    return tools
  }

  /**
   * 安排重连
   */
  scheduleReconnect(serverId) {
    this.clearReconnectTimer(serverId)
    const connection = this.connections.get(serverId)
    if (!connection) return

    if (connection.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[Gina HTTP MCP] Max reconnect attempts reached for "${serverId}"`)
      this.connections.delete(serverId)
      return
    }

    connection.reconnectAttempts++
    const delay = RECONNECT_DELAY_MS * Math.pow(2, connection.reconnectAttempts - 1)
    
    const timer = setTimeout(async () => {
      try {
        await this.connect(connection.config)
      } catch (err) {
        this.scheduleReconnect(serverId)
      }
    }, delay)

    this.reconnectTimers.set(serverId, timer)
  }

  /**
   * 清除重连定时器
   */
  clearReconnectTimer(serverId) {
    const timer = this.reconnectTimers.get(serverId)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(serverId)
    }
  }
}

/**
 * 预设的 MCP 服务器配置模板
 * 
 * 这些是常见的 MCP 服务器配置示例，可作为参考。
 */
export const presetMcpServers = {
  github: {
    id: 'github',
    name: 'GitHub MCP Server',
    url: 'https://mcp-server.github.com',
    description: 'GitHub 官方 MCP 服务器，提供仓库管理、Issue、PR 等工具',
    headers: {
      Authorization: 'Bearer <your-github-token>',
    },
  },
  notion: {
    id: 'notion',
    name: 'Notion MCP Server',
    url: 'https://mcp-server.notion.so',
    description: 'Notion MCP 服务器，提供页面读写、数据库操作等工具',
    headers: {
      Authorization: 'Bearer <your-notion-token>',
      'Notion-Version': '2022-06-28',
    },
  },
  slack: {
    id: 'slack',
    name: 'Slack MCP Server',
    url: 'https://mcp-server.slack.com',
    description: 'Slack MCP 服务器，提供消息发送、频道管理等工具',
    headers: {
      Authorization: 'Bearer <your-slack-token>',
    },
  },
  brave_search: {
    id: 'brave_search',
    name: 'Brave Search MCP',
    url: 'https://mcp-server.brave.com',
    description: 'Brave 搜索引擎 MCP 服务器，提供网络搜索工具',
    headers: {
      Accept: 'application/json',
    },
  },
}
