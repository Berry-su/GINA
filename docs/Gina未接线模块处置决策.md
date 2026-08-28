# Gina 未接线模块处置决策

> 结论基于对全部源码的接线关系核对。原则：**一律不删文件**；「接」必须低风险、不伤主流程；「留」是当前正确状态。

## 总览

| # | 模块 | 处置 | 性质 |
|---|---|---|---|
| 1 | subagents/orchestrator.js（母体调度器 P2） | 保留待用 | 未来生态 |
| 2 | subagents/device-adapter.js + device-protocols.js（P3） | 保留待用 | 未来生态 |
| 3 | a2a/a2a-protocol.js | 保留待用（未来多 agent 协作） | 未来能力 |
| 4 | mcp/http-client-manager.js（HTTP MCP） | 保留待用 | 增强，非必须 |
| 5 | voice/kws-model/（KWS 唤醒模型） | 保留待用 | 有意关闭 |
| 6 | voice/manager.js startVoiceServer（本地 Whisper） | 保留待用 | 有意关闭 |
| 7 | data-sources/news-prompt-block.js（新闻注入） | 可接（增强） | 低风险 |
| 8 | memory/vision-dialogue-bridge.js（视觉→对话注入） | 可接（增强） | 低风险 |

**结论：6 保留 + 2 可接 + 0 删除。**

---

## 逐个说明

### 1. `subagents/orchestrator.js`（母体-子 Agent 调度器）→ 保留待用
- 现状：写完，无主流程 import。
- 理由：它是「母体-子 Agent 生态」（智能家居/车机/机器狼）的调度核心，但**现在没有真实子 Agent 可调度**，接了是空转；且"何时派发子 Agent"是产品级决策，不是单纯技术接线。
- 不接不伤 gina，反而是对的。

### 2. `device-adapter.js` + `device-protocols.js`（Matter/CAN/ROS）→ 保留待用
- 理由：需要真实设备网关（Home Assistant / socketcand / rosbridge）才有意义，当前没有；属「具身子 Agent」未来生态。

### 3. `a2a/a2a-protocol.js` → 保留待用（未来多 agent 协作）
- 理由：gina 未来要做多 agent 协作，A2A 是标准的跨 Agent 通信协议，**需保留并预留接入空间**。当前暂不接（主流程已稳定，等协作需求明确时再接，避免无谓引入 3001 端口和网络面）。

### 4. `mcp/http-client-manager.js`（HTTP/SSE 远程 MCP）→ 保留待用
- 理由：当前主链路只用 stdio MCP，够用；接入需打通 config.js 的 transport 校验 + client-manager 的对账，改动面较大，收益是「支持远程 HTTP MCP」，非当前必需。

### 5. `voice/kws-model/`（KWS 唤醒模型）→ 保留待用
- 理由：**有意关闭**（8G 低配机 OOM 风险），不是遗漏。模型资产保留，等需要语音唤醒时再接加载器。

### 6. `voice/manager.js` 的 `startVoiceServer`（本地 Whisper）→ 保留待用
- 理由：同 #5，语音功能默认关闭省内存，有意为之。

### 7. `data-sources/news-prompt-block.js`（新闻注入）→ 可接（低风险增强）
- 现状：`getNewsPromptBlock` / `getNewsForContext` 未被调用。
- 可接价值：把已采集的新闻注入对话上下文，让 gina 更"知道当下"。
- 前置条件：新闻调度器需先跑起来（当前是 API 手动启动，非 main 自动）。
- 风险：低（纯注入函数），但要在 injector/context 正确挂点。

### 8. `memory/vision-dialogue-bridge.js`（视觉→对话注入）→ 可接（低风险增强）
- 现状：`initVisionDialogueBridge` 未启用。
- 可接价值：让 gina 能"截图/看图"后把描述自动注入对话。
- 前置条件：视觉系统依赖 macOS screencapture 权限 + vision API 槽。
- 风险：低-中（涉及权限 + 依赖 vision slot 配置）。

---

## 建议的下一步顺序

1. 先不动 #1-#6（保留待用是正确的，不接不伤 gina）。
2. 若要做增强，优先 #7（新闻注入，风险最低、价值直观），确认后再接。
3. #8（视觉注入）依赖权限和 vision 配置，放 #7 之后。
4. 所有「删除」动作继续冻结，等 gina 全闭环、你确认后再清。
