# GINA

> **一个有 8 大层架构、5 层免疫、决策可解释的常驻桌面 AI Agent。**
> 
> 不是聊天工具——是有自我感知、自我进化的常驻智能体。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Berry--su%2FGINA-181717)](https://github.com/Berry-su/GINA)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-10-FF8C00)](https://pnpm.io)

**6 阶段 PLAN-P6 100% 完工（2026-09-02）** + **CI/CD（ADR-016）+ 监控 + 外部文档（ADR-017）落地**

---

## 1. 一句话定位

GINA 是一个**有完整大脑架构的本地常驻 AI Agent**——基于 **8 大层** 架构（L0~L7），3 层记忆 + CATS-Net 概念网络 + 6 分析师 + 风控官 + 5 层免疫。目标是从「能跑」推到「**有完整大脑 + 能自我进化**」。

完整版 = 上线产品 = 融资 demo（2026-09-01 老板拍板 · 三者合一，同一份代码）。

## 2. 8 大层架构

| 层 | 名称 | 一句话 | 状态 |
|---|---|---|---|
| **L0** | 意识循环（Adaptive Tick）| 自适应节奏的主循环，看门狗 + 任务续跑 | ✅ |
| **L1** | ACI 预判注入 | 1.5s 硬超时，三类预判（语义 / 模式 / 定时）| ✅ |
| **L2** | 三层记忆 | SQLite + FTS5 trigram + 本地 embedding + 线索 + 焦点 | ✅ |
| **L3** | CATS-Net | 概念网络：ConceptNode + 激活扩散 + 时序 + 自学习 + 编辑 API | ✅ |
| **L4** | 知识大脑 | 5 大领域（投资 / 交易 / 危机 / 编程 / 通用）| ✅ |
| **L5** | 状态机 | FSM + HSM 嵌套，可视化迁移 | ✅ |
| **L6** | 工具市场 + 工厂 | 100+ 工具 + 5 层免疫（白名单 / 运行时 / 重启 / 人工）| ✅ |
| **L7** | 决策层 | 6 分析师 + 风控官 + 整合器，决策可解释 | ✅ |

## 3. 核心能力

### 3.1 8 大层基础设施

- **持续运行的主循环**：处理用户消息、后台消息、提醒、任务续跑和空闲心跳
- **3 层记忆 + 线索 + 焦点**：SQLite 持久化对话 / 事实 / 知识 / 用户画像 / 线程状态
- **ACI 预判注入**：每轮对话前自动选择相关记忆、最近对话、用户画像、工具结果、UI 信号、预取内容
- **多模型接入**：通过 OpenAI 兼容接口连接 Anthropic / DeepSeek / MiniMax / OpenAI / Qwen / Moonshot / Zhipu / 自定义
- **5 层免疫**：内置白名单 → 已装注册 → 运行时 AST 变异检测 → 重启自检 → 风控官审核
- **决策可解释**：6 分析师各 200 字理由 + 整合器权衡 + 完整审计链
- **场景协议 Scene Protocol v1**：Agent 不发命令只声明状态；`UI = f(scene)`
- **Monochrome Precision HUD**：单色 + 细线框 + 数字等宽字体，零 AI 感视觉规范
- **子 Agent 协议**：母体-子 P1-P4 协议 + 设备真实协议（Matter / CAN / ROS）+ 隐私路由
- **多端支持**：Electron 桌面 + 微信小程序 + 水晶商城双语网页 + 3D 桌宠

### 3.2 6 阶段 PLAN-P6 完工能力（2026-09-02）

| 阶段 | 模块 | 状态 | ADR |
|---|---|---|---|
| **P1** | 实时翻译（6 语种）+ VLM/OCR | ✅ | ADR-008 + ADR-009 |
| **P2** | 日历 / 邮件 / 任务 API | ✅ | ADR-010 |
| **P3** | 主动编排 + Notion / Obsidian 笔记同步 | ✅ | ADR-011 |
| **P4** | HomeKit / 米家 / MQTT 智能家居 | ✅ | ADR-012 |
| **P5** | iOS / watchOS / Android / Wear OS 多设备 | ✅ | ADR-014 + ADR-015 |
| **P6** | 视频理解（摘要 / 关键帧） | ✅ | ADR-013 |

### 3.3 监控 + 外部文档（ADR-016 + ADR-017，2026-09-03）

- **本地监控 dashboard**：`http://127.0.0.1:3000/metrics`（绑 127.0.0.1，不外发）
- **结构化日志**：`data/logs/gina-YYYY-MM-DD.jsonl`（30 天轮转）
- **告警**：错误率 > 5% / P95 > 1s / 启动失败 → macOS 系统通知
- **6 份外部文档**：[`docs/`](./docs/)（USER-GUIDE / INSTALL / FAQ / TROUBLESHOOTING / DEVELOPER / INDEX）

## 4. 项目结构

```text
electron/              Electron 主进程、预加载脚本和桌面窗口控制
src/index.js           Agent 主循环、调度、任务状态和启动流程
src/api.js             本地 HTTP 服务、SSE、WebSocket、设置和管理接口
src/llm.js             LLM 流式调用、工具调用执行和重试保护
src/config.js          Provider、模型、语音、社交、搜索和安全配置
src/db.js              SQLite 数据表、索引和持久化读写
src/memory/            3 层记忆 + 线索 + 焦点 + 召回
src/cats_net/          L3 概念网络（ConceptNode / 激活扩散 / 冲突解决）
src/knowledge/         L4 知识大脑（5 大领域）
src/state_machine/     L5 FSM + HSM 状态机
src/analysts/          L7 决策层（6 分析师 + 风控官 + 整合器）
src/immune/            L6 5 层免疫工程实现
src/capabilities/      L6 工具市场 + 工厂 + 工具可信度
src/subagents/         子 Agent 协议 P1-P4
src/mcp/               MCP 协议 + 工具注册
src/trading/           交易引擎（多市场策略 + 风险控制）
src/data_engine/       金融数据引擎（行情 + 新闻 + 异常扫描）
src/data_sources/      数据源（Tushare / RSS / 美股）
src/context/injector.js    L1 ACI 注入器
src/prompt.js          system prompt 构建
src/test-*.js          单元测试
src/ui/                Scene shell + Brain UI
src/ui-design/         Monochrome HUD tokens + spec 渲染
apps/web/              新 UI（React 18 + Vite + TS + AntD 5 + CSS Modules）
docs/                  设计文档
data/                  SQLite 数据库 + 知识数据
scripts/               工具脚本（build / prebuild / verify）
```

## 5. 快速开始

### 5.1 安装依赖

```bash
pnpm install
```

> 推荐 pnpm 10+（`npm install -g pnpm`）。如果 native build 失败：`pnpm approve-builds && pnpm rebuild`。

### 5.2 装子仓（CATS-Net 内核）

主仓通过 `file:` 软链引 `@berrysu/gina-core`，需要同级有 gina-cats-net 仓：

```bash
# 在主仓同级 clone 内核仓
cd ~/Documents
git clone https://github.com/Berry-su/gina-cats-net.git
cd gina-cats-net && pnpm install && pnpm test  # 验证 359 测试全过

# 回主仓
cd ../BaiLongma-refactor-codebase
ls node_modules/@berrysu/gina-core  # 应该是符号链接
```

### 5.3 启动后端

```bash
pnpm start:backend
# 或开发模式（自动重启）
pnpm dev
```

后端默认端口 `3721`，启动后浏览器开 `http://127.0.0.1:3721/activation` 配 LLM provider。

### 5.4 启动桌面

```bash
pnpm start
```

启动 Electron 桌面壳，自动连接本地后端。

### 5.5 监控 dashboard

启动后自动开 `http://127.0.0.1:3000/metrics`（绑 127.0.0.1，仅本机访问）。

不需要可以关掉：`GINA_DASHBOARD_DISABLED=1 pnpm start`。

### 5.6 跑测试（验证装对了）

```bash
pnpm test
```

应该看到 1000+ 测试全过（含 emotion-isolation 9/9 严守）。

### 5.7 构建打包

```bash
# macOS arm64 (Apple Silicon)
pnpm build:mac:arm64

# macOS x64 (Intel)
pnpm build:mac:x64

# Windows
pnpm build:win
```

## 6. 配置

`src/config.js` 集中管理：

- **LLM Provider**：OpenAI 兼容接口
- **语音**：ASR（云端）+ TTS（多种服务）
- **社交**：Discord / 微信 / 飞书
- **搜索 / 安全**

## 7. 文档

**用户文档**（6 份 · [目录索引](./docs/INDEX.md)）：

- [用户指南 (USER-GUIDE.md)](./docs/USER-GUIDE.md) — 5 分钟上手 + 6 阶段功能导览
- [安装指南 (INSTALL.md)](./docs/INSTALL.md) — macOS / Windows / Linux + 升级
- [常见问题 (FAQ.md)](./docs/FAQ.md) — 12+ 常见问题
- [故障排查 (TROUBLESHOOTING.md)](./docs/TROUBLESHOOTING.md) — 5 大类故障
- [开发者指南 (DEVELOPER.md)](./docs/DEVELOPER.md) — 7 agent / commit / 跑测试 / PR
- [文档目录 (INDEX.md)](./docs/INDEX.md) — 文档地图

**设计文档**：

- [完整大脑路线图](https://github.com/Berry-su/GINA/blob/main/docs/完整大脑路线图.md)
- [Monochrome Precision HUD 规范](docs/)
- [Scene Protocol v1](docs/)
- [ACI 理念文档](docs/ACI-理念文档.md)
- [Agent 驱动 UI 设计方案](docs/)
- [ADR 列表](https://github.com/Berry-su/GINA/tree/main/docs/) — 全部 ADR 索引

## 8. 7 人 Agent 团队

GINA 项目用 Mavis 编排 + 7 个 agent 团队协作开发：

| Agent | 角色 | 职责 |
|---|---|---|
| `gina-pm` | 产品经理 | 需求拆解、Roadmap、跨 agent 协调 |
| `gina-arch` | 架构师 | 8 大层一致性、ADR、跨层接口 |
| `gina-coder` | 编程 | 后端、git、CI |
| `gina-ui` | UI 设计 | Monochrome HUD、Scene Protocol、商城 UI |
| `gina-qa` | 质检 | 回归、Bug 复现、UI 走查 |
| `gina-platform` | 平台 SRE | 部署、CI/CD、监控、备份 |
| `gina-immune` | 安全 / 免疫 | 5 层免疫、工具可信度、协议安全 |

## 9. 致谢

GINA 站在巨人的肩膀上：

- **CATS-Net 概念网络**：来自 BaiLongma 项目的核心架构（已重构成 `gina-cats-net` 仓）
- **Scene Protocol v1** + **Monochrome Precision HUD**：GINA 原创的 Agent-UI 协议 + 视觉规范
- **5 层免疫 + 6 分析师**：GINA 原创的决策可解释框架
- **Anthropic / DeepSeek / OpenAI / Qwen / Moonshot / Zhipu**：LLM Provider
- **d3.js / better-sqlite3 / electron / openai / sharp / sherpa-onnx**：开源依赖
- **7 人 agent 团队**（Mavis 编排）：gina-pm / gina-arch / gina-coder / gina-ui / gina-qa / gina-platform / gina-immune

详细依赖：见 `package.json`。

## 10. License

**MIT License** — Copyright (c) 2026 Berry.Su

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

## 11. 相关仓库

- [Berry-su/GINA](https://github.com/Berry-su/GINA) — 主仓（Electron + 8 大层 + 6 阶段 PLAN-P6）
- [Berry-su/gina-cats-net](https://github.com/Berry-su/gina-cats-net) — CATS-Net 内核真理源（`@berrysu/gina-core`）
- [Berry-su/gina-ui](https://github.com/Berry-su/gina-ui) — 多设备 UI（iOS / watch / Android / Wear OS）
- [Berry-su/gina-mall](https://github.com/Berry-su/gina-mall) — 3D 桌宠 + 水晶商城

## 12. 监控 + 告警

启动后自动开启：

- **Dashboard**：`http://127.0.0.1:3000/metrics`（绑 127.0.0.1，仅本机访问）
- **结构化日志**：`data/logs/gina-YYYY-MM-DD.jsonl`（30 天轮转）
- **告警**：错误率 > 5% / P95 > 1s / 启动失败 → macOS 系统通知
- **不上传任何监控数据**：纯本地，零外发

不需要 dashboard：`GINA_DASHBOARD_DISABLED=1 pnpm start`

设计哲学详见 [ADR-017](https://github.com/Berry-su/GINA/blob/main/docs/ADR-017-监控与外部文档_2026-09-02.md)。

---

**GINA = 一个有完整大脑的常驻智能体。**
