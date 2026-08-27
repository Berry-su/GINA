/**
 * Gina MCP Server 启动脚本
 * 
 * 启动 Gina MCP Server，使其暴露为 MCP 协议服务。
 * 支持通过 stdio 传输协议与 MCP 客户端（如 MCP Inspector）交互。
 */

import { createGinaMcpServer, ginaHandlers } from './src/mcp/gina-mcp-server.js'

async function main() {
  console.log('========================================')
  console.log('  Gina MCP Server Starting...')
  console.log('========================================')
  
  // 创建 Gina MCP Server 实例
  const server = createGinaMcpServer({
    name: 'gina-agent',
    version: '2.0.0',
    handlers: ginaHandlers,
    capabilities: {
      knowledge: true,
      research: true,
      decision: true,
      emotion: true,
      planning: true,
    }
  })
  
  // 启动服务器
  const result = await server.start()
  
  console.log(`\n✅ Gina MCP Server 已启动`)
  console.log(`   已注册 ${result.tools.length} 个 MCP Tools:`)
  result.tools.forEach(tool => {
    console.log(`   - ${tool.name}`)
  })
  
  // 优雅退出处理
  process.on('SIGINT', async () => {
    console.log('\n🔄 Graceful shutdown...')
    await server.stop()
    process.exit(0)
  })
  
  process.on('SIGTERM', async () => {
    console.log('\n🔄 Graceful shutdown...')
    await server.stop()
    process.exit(0)
  })
  
  // 保持进程运行
  console.log('\n⏳ Server running. Press Ctrl+C to stop.')
  await new Promise(() => {})
}

main().catch(err => {
  console.error('❌ Server failed to start:', err)
  process.exit(1)
})
