# Gina 完整架构与闭环梳理

> 本文档由对 gina 主仓库（`/Users/ahs/Documents/BaiLongma-refactor-codebase`）全部核心源码的系统通读整理而成，用于后续 git 搭建、代码归纳整理、多 Agent 协作的架构地基。

---

## 一、项目全景

gina 存在三代代码，当前开发主体是「Gina 完整版」：

| 代号 | 路径 | 技术栈 | 状态 |
|---|---|---|---|
| 白龙马（前身） | `/Users/ahs/bailongma/` | Python FastAPI | 前身框架，已停 |
| Gina 完整版（主体） | `/Users/ahs/Documents/BaiLongma-refactor-codebase/` | Node/Electron ESM v2.1.601 | **当前主力** |
| 新 Gina（CATS-Net） | `Desktop/GINA/Gina整合备份_2026-08-19/gina增加计划登记/` | Node CATS-Net | 已并入主体 |

主体仓库关键目录：

- `src/` —— 后端核心（大脑/记忆/LLM/交易/工具/MCP/子Agent 等）
- `electron/` —— Electron 主进程（窗口/托盘/启动）
- `data/` —— 数据库（jarvis.db / bailongma.db）与运行时数据
- `scripts/` —— 各类脚本（交易流水线、数据抓取、回测等）
- `llm/deepseek.json` —— LLM 配置（主模型 deepseek-v4-pro）
- `skills/` —— Agent Skills（SKILL.md）
- `apps/`（新 UI 已移除备份至 `.ui-backup-20260827/`）

---

## 二、核心架构：两条闭环 + 一个认知内核

gina 本质上是「两套并行闭环」叠加在「一个认知内核」上：

### 闭环 A：通用大脑主线（每轮对话）

```
用户消息 → pushMessage → queue（user/background 双队列）
  → consciousness-loop onTick → runTurn（index.js）
    → runInjector（记忆召回 + 策略 + 工具 + 自我感知 + 情感 + 意识 + 技能 注入）
    → buildSystemPrompt + selectContextSections(门控) + buildContextBlock
    → callLLM（≤100 轮工具循环，含 nudge/熔断/去重/slow ack/find_tool）
      → executeTool（权限策略 → 内置 switch / 已安装工具 / MCP 工具）
        → send_message → delivery（写库 → SSE → 社交派发）
  → 回合结束：enqueueTurnForRecognition（记忆写入）+ noteTurnReflection（反思）
```

### 闭环 B：金融大脑支线（交易）

```
DataEngine.collectOnce（新闻/行情/财报/资金流 并行抓取 + 归一化去重）
  → SnapshotBuilder.buildSnapshots（宏观面 + 恐慌贪婪 + 五面快照）
    → AnalystTeam.analyze（5 分析师 + 风控官）
      → Integrator.integrate（分歧处理 + 授权门，authorized=false）
        → 授权 approve() → getSignal() → BrokerAdapter.placeOrder(authorized=true)
  → 复盘蒸馏（reflect-daily-picks → trading-skill-generator）
```

**权限链（硬约束）**：分析师分析 → Gina 整合 → 用户拍板 → 才可下单；风控官一票否决（level≥2 降仓、level≥3 暂停）。

### 底层认知内核：CATS-Net

概念抽象空间（concept-node）→ 激活扩散 → 冲突消解（conflict-resolver）→ 记忆投影（memory-projection）→ 序列化持久化（serializer）。被 `brain/index.js` 单例持有，供分析师/交易/知识顾问共享。

---

## 三、主数据流（一句话链路）

```
入站(/message/社交/TUI/Scene WS) → pushMessage → 双队列 → onTick → runTurn
  → Injector(召回注入) → callLLM(工具循环) → executeTool → delivery(写库+SSE+社交)
  → recognizer(记忆写入) → reflection(反思) → skill/knowledge 蒸馏 → 下轮再注入
```

启动顺序（`src/index.js`）：模块级采集（系统信息/桌面/软件/天气/热点/Agent/工具/MCP）→ `main()`：`startAPI`（HTTP/WS 监听 3721）→ 社交连接器 → 成长引擎/主动感知/自动规划 → 知识播种 → `initGinaBrain` → TUI → `startConsciousnessLoop`（未激活则等 onActivated 回调拉起）。

---

## 四、子系统速查表

| 子系统 | 关键入口 | 职责 | 是否接主流程 |
|---|---|---|---|
| 记忆系统 `src/memory` | `runInjector` / `runRecognizerBatch` / `startConsolidationLoop` / `recordReflection` / `growth-engine` | 写入→召回→注入→巩固→反思→蒸馏 | ✅ 核心 |
| 大脑门面 `src/brain` | `initGinaBrain` / `makeIntegratedDecision` / `getBrainHealth` | 决策+进化+可解释+CATS-Net+金融引擎 | ✅ |
| 决策 `src/decision` | `evaluateDecision` / `traceReasoning` / `checkEthics` | MCDA + 可解释 + 道德门 | ✅（金融支线） |
| CATS-Net `src/cats_net` | `CatsNet.process` / `projectMemory` / `retrieveMemory` | 概念抽象空间 | ✅ |
| 上下文 `src/context` | `runRuntimeInjector` / `selectContextSections` | 上下文采集 + 相关度门控 | ✅ |
| 主循环 `src/index.js` | `runTurn` / `main` | 每轮大脑核心 | ✅ |
| LLM `src/llm.js` | `callLLM` | 工具循环 + 隐私路由 + 协议兜底 | ✅ |
| 工具执行 `src/capabilities` | `executeTool` / `manage_tool_factory` / `marketplace` | 内置/已装/MCP/API能力槽 | ✅ |
| MCP 客户端 `src/mcp` | `startMcpClients` / `executeMcpTool` | stdio MCP + 内置 Playwright | ✅（仅 stdio） |
| 技能 `src/skills` | `loadSkills` / `selectSkillsForMessage` / `formatSkillsForContext` | SKILL.md 加载/选择/注入 | ✅ |
| 分析师 `src/analysts` | `createAnalystTeam` / `Integrator.integrate` / `RiskOfficer.analyze` | 5 分析师 + 风控官 + 整合 | ✅（交易） |
| 金融数据引擎 `src/finance-data-engine` | `DataEngine.collectOnce` / `SnapshotBuilder` | 采集 + 快照 | ✅（交易） |
| 金融数据源 `src/finance-data-sources` | `Tushare*/Yahoo*/Alpaca*/RssNews/Broker` | 真实数据源 | ✅（交易） |
| 场景协议 `src/scene` | `SceneStore` / `handleSceneConnection` | Agent 驱动 UI | ✅ |
| 社交 `src/social` | `startSocialConnectors` / `dispatchSocialMessage` | Discord/飞书/微信 | ✅ |
| 语音 `src/voice` | `createCloudASRSession` / `streamTTS` / `startVoiceServer` | ASR/TTS/KWS | ⚠️ 部分 |
| 数据源 `src/data-sources` | `fetchCalendarEvents` / `aggregateNews` | 日历/邮件/通讯录/新闻 | ⚠️ 部分 |
| 视觉 `src/memory/vision-perceptor` | `analyzeImage` / `captureScreen` | 截图/图片识别 | ⚠️ 部分 |
| 子Agent `src/subagents` | `SubAgentOrchestrator` / `routeFor` / `createDeviceAdapter` | 母体调度/隐私路由/设备 | ⚠️ 部分 |
| A2A `src/a2a` | `GinaA2AServer` / `A2AClient` | 跨 Agent 协议 | ❌ 未接 |

---

## 五、关键发现：已实现但未接线的模块

这些是「代码写了、逻辑自洽，但没有接进主流程」的半成品，是"看似闭环其实没闭环"的根源：

1. **`subagents/orchestrator.js`** —— 母体-子 Agent 调度器（P2），无主流程 import。
2. **`subagents/device-adapter.js` + `device-protocols.js`** —— 设备适配 Matter/CAN/ROS（P3），无主流程 import。
3. **`a2a/a2a-protocol.js`** —— A2A 协议（JSON-RPC2.0 + SSE），独立自洽，未接。
4. **`mcp/http-client-manager.js`** —— HTTP/SSE 远程 MCP，独立实现，主链路只用 stdio，`config.js` 也只接受 stdio。
5. **`voice/kws-model/`** —— KWS 唤醒模型资产存在，但**没有任何代码加载它**。
6. **`voice/manager.js` 的 `startVoiceServer`** —— 本地 Whisper 服务，未自动启动。
7. **`data-sources/news-prompt-block.js`** —— 新闻上下文注入（`getNewsPromptBlock`），未被调用。
8. **`memory/vision-dialogue-bridge.js`** —— 视觉→对话自动注入（`initVisionDialogueBridge`），未启用。

---

## 六、风险点与注意事项

1. **命名冲突**：`src/subagents/orchestrator.js`（母体调度器）与 `src/workflow/orchestrator.js`（工作流 DAG 编排器）同名，职责完全不同。
2. **两套记忆系统并存**：`src/memory`（主体，接主循环）与 `src/layered-memory`（三层记忆，独立，未接主循环）并存，`src/memory-hub` 是给分析师共享的统一记忆。
3. **大量 `.bak` 文件**：`src/index.js.bak*`、`injector.js.bak*`、`reflection-executor.js.bak` 等历史备份散落，需在整理时清理/归档。
4. **无 git**：整个主体仓库没有 `.git`，这是协作和版本控制的当务之急。
5. **数据库文件在 `data/`**：jarvis.db / bailongma.db 及 `-shm`/`-wal` 等运行时文件，git 化时必须 ignore。

---

## 七、整理建议（供后续确认后执行）

1. **先建 git + .gitignore**（排除 `node_modules/`、`data/*.db`、`*.log`、`.ui-backup-*`、`.bak` 等）。
2. **清理 `.bak` 文件**与旧备份目录（`.backup_*`、`.test-deps` 等）。
3. **标记未接线模块**（第五节的 8 处），决定「接上 / 删除 / 保留待用」。
4. **统一命名**，消除 `orchestrator` 二义性。
5. **梳理 `data/` 数据文件**与 `scripts/` 脚本，纳入版本管理策略。
