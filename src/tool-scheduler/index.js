/**
 * MCP 工具调度模块 —— 统一导出入口
 *
 * 提供工具定义、注册/发现、动态调用（超时/重试/熔断）与调度主类，
 * 供上层业务模块引用。依赖方向单向 mcp → cats_net / memory（构造注入，可选）。
 *
 * 说明：本模块迁入主体时目录命名为 src/tool-scheduler/（避让主体已有的 src/mcp，
 * 后者是 Playwright/MCP 协议层），类名与导出保持不变。
 */

export { Tool, ToolRegistry, validateArguments } from './tool-registry.js'
export { ToolInvoker, BREAKER_STATE } from './tool-invoker.js'
export { MCPScheduler } from './mcp-scheduler.js'