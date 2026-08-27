# MCP 工具调度模块（已迁移进主体）

Gina Agent 的 MCP 工具调度，实现工具注册、发现与动态调用（含超时/重试/熔断）。

> 迁入说明：本模块原位于新 Gina 的 `src/mcp/`，迁入主体时目录命名为 `src/tool-scheduler/`
> 以避让主体已有的 `src/mcp/`（Playwright/MCP 协议层）；类名与导出保持不变。

- `Tool`：工具定义（name/description/parameters/handler/tags）
- `ToolRegistry`：注册表（注册/发现/搜索/参数校验）
- `ToolInvoker`：调用器（单次超时 + 重试 + 熔断器 open→half-open→closed）
- `MCPScheduler`：主入口（安全机制 + 可选 memoryManager/catsNet 集成）

用法：

```js
import { MCPScheduler, Tool } from './index.js'

const scheduler = new MCPScheduler({ timeoutMs: 5000 })
scheduler.register(new Tool({
  name: 'get_price',
  description: '查询标的现价',
  parameters: { required: ['symbol'], properties: { symbol: { type: 'string' } } },
  handler: async (args) => ({ symbol: args.symbol, price: 100 }),
}))

const r = await scheduler.call('get_price', { symbol: 'AAPL' })
console.log(r.result) // { symbol: 'AAPL', price: 100 }
```