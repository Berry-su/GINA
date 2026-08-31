# GINA

> **一个有 8 大层架构、5 层免疫、决策可解释的常驻桌面 AI Agent。**
> 
> 不是聊天工具——是有自我感知、自我进化的常驻智能体。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Berry--su%2FGINA-181717)](https://github.com/Berry-su/GINA)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933)](package.json)

---

## 1. 一句话定位

GINA 是一个**有完整大脑架构的本地常驻 AI Agent**——基于 **8 大层** 架构（L0~L7），3 层记忆 + CATS-Net 概念网络 + 6 分析师 + 风控官 + 5 层免疫。目标是从「能跑」推到「**有完整大脑 + 能自我进化**」。

## 2. 8 大层架构

| 层 | 名称 | 一句话 | 状态 |
|---|---|---|---|
| **L0** | 意识循环（Adaptive Tick）| 自适应节奏的主循环，看门狗 + 任务续跑 | ✅ |
| **L1** | ACI 预判注入 | 1.5s 硬超时，三类预判（语义 / 模式 / 定时）| ✅ |
| **L2** | 三层记忆 | SQLite + FTS5 trigram + 本地 embedding + 线索 + 焦点 | ✅ |
| **L3** | CATS-Net | 概念网络：ConceptNode + 激活扩散 + 冲突解决 | ✅ |
| **L4** | 知识大脑 | 5 大领域（投资 / 交易 / 危机 / 编程 / 通用）| ✅ |
| **L5** | 状态机 | FSM + HSM 嵌套，可视化迁移 | ✅ |
| **L6** | 工具市场 + 工厂 | 100+ 工具 + 5 层免疫（白名单 / 运行时 / 重启 / 人工）| ✅ |
| **L7** | 决策层 | 6 分析师 + 风控官 + 整合器，决策可解释 | ✅ |

## 3. 核心能力

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
npm install
```

### 5.2 启动后端

```bash
npm run start:backend
# 或开发模式（自动重启）
npm run dev
```

后端默认端口 `3721`。

### 5.3 启动桌面

```bash
npm start
```

启动 Electron 桌面壳，自动连接本地后端。

### 5.4 构建打包

```bash
# macOS arm64
npm run build:mac:arm64

# Windows
npm run build:win
```

## 6. 配置

`src/config.js` 集中管理：

- **LLM Provider**：OpenAI 兼容接口
- **语音**：ASR（云端）+ TTS（多种服务）
- **社交**：Discord / 微信 / 飞书
- **搜索 / 安全**

## 7. 文档

- [完整大脑路线图](https://github.com/Berry-su/GINA/blob/main/docs/完整大脑路线图.md)
- [Monochrome Precision HUD 规范](docs/)
- [Scene Protocol v1](docs/)
- [ACI 理念文档](docs/ACI-理念文档.md)
- [Agent 驱动 UI 设计方案](docs/)

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

## 9. License

**MIT License** — Copyright (c) 2026 Berry.Su

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

## 10. 相关仓库

- [Berry-su/GINA](https://github.com/Berry-su/GINA) — 主仓（Electron + 8 大层）
- [Berry-su/gina-cats-net](https://github.com/Berry-su/gina-cats-net) — CATS-Net 独立研发仓（已合并）
- [Berry-su/gina-mall](https://github.com/Berry-su/gina-mall) — 3D 桌宠 + 水晶商城

---

**GINA = 一个有完整大脑的常驻智能体。**
