# GINA 用户指南（USER-GUIDE）

> 5 分钟上手 · 6 阶段功能导览 · 常见问题 · 故障排查 · 进阶

**适用版本**：GINA v2.1.601+（2026-09-02 6 阶段 PLAN-P6 完工）

---

## 0. 文档地图

| 我想... | 跳到 |
|---|---|
| 5 分钟内把 GINA 跑起来 | [§1 快速开始](#1-快速开始) |
| 了解 GINA 6 阶段都有啥功能 | [§2 核心功能](#2-核心功能) |
| 6 阶段某个具体问题 | [§3 常见问题](#3-常见问题) |
| 报错了 / 卡了 / 行为异常 | [§4 故障排查](#4-故障排查) |
| 想自己定制 / 改 prompt / 接 LLM | [§5 进阶](#5-进阶) |
| 完整安装（dmg / brew / 源码） | [`INSTALL.md`](./INSTALL.md) |
| 开发者贡献代码 / PR | [`DEVELOPER.md`](./DEVELOPER.md) |
| 设计文档 / 架构 / 路线图 | [`INDEX.md`](./INDEX.md) |

---

## 1. 快速开始

### 1.1 前置（5 分钟）

- **macOS**：10.15+（建议 13 Ventura+）
- **内存**：≥ 4 GB（建议 8 GB+，CATS-Net + 本地 embedding 内存敏感）
- **磁盘**：≥ 2 GB 可用（Electron + 8 大层 + CATS-Net + 数据）
- **网络**：首次安装需要联网（拉 LLM provider + 安装 npm 依赖）；运行期可完全离线

### 1.2 安装（30 秒）

**方式 1：直接下载 dmg（推荐普通用户）**

从 [Berry-su/GINA Releases](https://github.com/Berry-su/GINA/releases) 下载最新的 `Gina-x.y.z-arm64.dmg`（Apple Silicon）或 `Gina-x.y.z.dmg`（Intel），双击拖到 Applications 即可。

**方式 2：brew（推荐开发者）**

```bash
brew install --cask berry-su/tap/gina
```

**方式 3：源码（推荐二次开发）**

见 [`INSTALL.md` §2](./INSTALL.md#2-从源码安装)。

### 1.3 启动（10 秒）

- **macOS GUI**：从 Applications 双击 Gina 图标
- **CLI**：
  ```bash
  cd ~/Documents/BaiLongma-refactor-codebase
  pnpm start:backend   # 起后端（端口 3721）
  # 另开终端：
  pnpm start            # 起 Electron 桌面
  ```

首次启动会提示激活：
- 在浏览器打开 `http://127.0.0.1:3721/activation`
- 配置 LLM provider（DeepSeek / OpenAI / Anthropic / Qwen / Moonshot / Zhipu / 自定义 OpenAI 兼容）
- 配置完成即可对话

### 1.4 第一次对话（5 秒）

启动后，默认打开 Scene shell（Scene Protocol v1）。直接打字即可：

```
> 帮我看下今天的天气
> 把这个 PDF 转成 markdown
> 提醒我明天下午 3 点开会
```

### 1.5 监控（30 秒）

GINA 启动后会自动开本地监控 dashboard：

- 浏览器开 `http://127.0.0.1:3000/metrics`
- 看到：启动次数 / 模块调用热度 / 错误率 / P95 / 告警历史
- 仅本机访问（绑 127.0.0.1，不暴露外网）

如果不需要，关掉：

```bash
GINA_DASHBOARD_DISABLED=1 pnpm start
```

---

## 2. 核心功能

GINA = 一个有完整大脑架构的本地常驻 AI Agent。6 阶段 PLAN-P6（2026-09-02 完工）补齐了之前的所有差距。

### 2.1 6 阶段能力导览

| 阶段 | 模块 | 怎么用 |
|---|---|---|
| **P1 实时翻译 + VLM/OCR** | 6 语种实时翻译 / 看图 / OCR | "把这段话翻成英文" / "看看这张图" / "把这张扫描件识别成文字" |
| **P2 日历 + 邮件 + 任务** | Google Calendar / Gmail / Todoist / Outlook | "明天下午 3 点加个会" / "读我最新 3 封邮件" / "加个待办：买菜" |
| **P3 主动编排 + 笔记** | 主动开口 / Notion / Obsidian | 早上 GINA 主动提醒日程 / "同步到 Notion" / "读我 Obsidian 最新笔记" |
| **P4 智能家居 IoT** | HomeKit / 米家 / MQTT | "回家模式" 自动开灯开空调 / "锁门" / "看看客厅温度" |
| **P5 多设备同步** | iOS / watch / Android / Wear OS | 出门用手机继续问 / 手表上看提醒 / Wear OS 抬手问 |
| **P6 视频理解** | 视频摘要 / 关键帧提取 | "总结这个 30 分钟教程" / "找出第 12 分钟在讲什么" |

### 2.2 8 大层架构（核心）

| 层 | 名字 | 干啥 |
|---|---|---|
| **L0** | 意识循环 | 自适应节奏的主循环，看门狗 + 任务续跑 |
| **L1** | ACI 预判注入 | 1.5s 硬超时，三类预判（语义 / 模式 / 定时） |
| **L2** | 三层记忆 | SQLite + FTS5 trigram + 本地 embedding |
| **L3** | CATS-Net | 概念网络：ConceptNode + 激活扩散 + 冲突解决 |
| **L4** | 知识大脑 | 5 大领域（投资 / 交易 / 危机 / 编程 / 通用） |
| **L5** | 状态机 | FSM + HSM 嵌套，可视化迁移 |
| **L6** | 工具市场 + 工厂 | 100+ 工具 + 5 层免疫 |
| **L7** | 决策层 | 6 分析师 + 风控官 + 整合器，决策可解释 |

### 2.3 5 层免疫（安全）

每条工具调用都过 5 层免疫：

1. **白名单**：工具必须注册在 `TOOL_SCHEMAS`
2. **已装注册**：必须装在 `capabilities/marketplace/`
3. **运行时 AST 变异检测**：检查工具代码是否被改
4. **重启自检**：每次重启校验
5. **风控官审核**：6 分析师之一专职审核

### 2.4 决策可解释

每个决策都来自 6 分析师各 200 字理由 + 整合器权衡 + 完整审计链。在 UI 里点 "为什么？" 可以看完整推理。

### 2.5 Scene Protocol v1

Agent 不发命令只声明状态；`UI = f(scene)`。10+ 种 kind，幂等 `ui.set`。

### 2.6 Monochrome Precision HUD

单色 + 细线框 + 数字等宽字体，零 AI 廉价感。

---

## 3. 常见问题

> 12+ 常见问题，按主题分组。

### 3.1 启动 / 激活

#### Q：双击图标后无反应？

- 看 `~/Library/Logs/Gina/`（macOS）或 `~/.config/Gina/logs/`（Linux）
- 通常是端口 3721 被占，杀掉占用的进程

#### Q：激活页打开后空白？

- 检查 `http://127.0.0.1:3721/activation` 能否 ping 通
- 如果是 LAN 访问，用 `http://<lan-ip>:3721/activation`
- 不支持 HTTPS（除非配 TLS cert）

#### Q：激活码在哪？

- v2.1.601+ 是免费个人版，不需要激活码
- 之前的"激活"是配置 LLM provider（DeepSeek/OpenAI/...），不是输码

### 3.2 LLM 配置

#### Q：接哪个 LLM 最划算？

| Provider | 模型 | 性价比 | 适合场景 |
|---|---|---|---|
| **DeepSeek** | deepseek-v4-pro | ⭐⭐⭐⭐⭐ | 默认推荐（中文 + 代码 + 推理） |
| **OpenAI** | gpt-5.5 | ⭐⭐⭐⭐ | 英文场景 + 工具调用 |
| **Qwen** | qwen-turbo | ⭐⭐⭐⭐ | 国内 / 短对话 |
| **Moonshot** | kimi-k2.6 | ⭐⭐⭐⭐ | 长上下文（128k） |
| **Zhipu** | glm-5.1 | ⭐⭐⭐⭐ | 国内 + 中文 |
| **Anthropic** | claude-sonnet-4.5 | ⭐⭐⭐ | 复杂推理 |

#### Q：能不联网用纯本地 LLM 吗？

可以，但需要：

- Ollama / LMStudio 起本地 server
- 在 GINA 配置 custom provider（OpenAI 兼容接口）
- 推荐模型：qwen2.5-7b / llama-3.1-8b / mistral-nemo

### 3.3 工具 / 能力

#### Q：为什么 GINA 不接 ASR/TTS？

**GINA 已经接了**。具体见 `src/voice/`：

- **ASR 三套**：sherpa-onnx（工业级）+ Whisper 本地 Python（3300+ 行）+ macOS 原生 swift + cloud-asr
- **TTS 5 provider**：豆包 / MiniMax / OpenAI / ElevenLabs / 火山
- **情绪调制**：emotion-tts-modulator（情绪微调 TTS）
- **KWS 唤醒**：kws-model
- **UI 7 模块**：voice-core / wake / continuous / ptt / panel / orb.html / reply-coordinator = 1900 行

#### Q：为什么 GINA 不接 Notion / Obsidian？

**P3 阶段已经接了**。在 `src/connectors/notes-sync.js`。

#### Q：怎么接 HomeKit / 米家？

**P4 阶段已经接了**。在 `src/connectors/{homekit,mijia,mqtt}.js`。配置：

```bash
# HomeKit
export GINA_HOMEKIT_USERNAME="..."
export GINA_HOMEKIT_PASSWORD="..."

# 米家
export GINA_MIJIA_USERNAME="..."
export GINA_MIJIA_PASSWORD="..."

# MQTT
export GINA_MQTT_BROKER_URL="mqtt://..."
```

凭据走 macOS keychain，不写 `.env`。

### 3.4 性能

#### Q：GINA 占多少内存？

- 后端（无对话）：~500 MB
- 后端（有对话 + CATS-Net 激活）：~1.5 GB
- 加 Electron 桌面：~2 GB 总

#### Q：对话响应慢？

看 `http://127.0.0.1:3000/metrics` dashboard 的 P95。

- P95 > 1s → 大概率是 LLM provider 慢，换 provider 或本地
- 某模块 P95 > 1s → 看告警，模块名就是问题点
- SQLite 慢 → `data/jarvis.db` 太大，跑 `data/cleanup.sh`

### 3.5 监控

#### Q：dashboard 在哪？

`http://127.0.0.1:3000/metrics`（默认启动）。

#### Q：怎么关掉 dashboard？

```bash
GINA_DASHBOARD_DISABLED=1 pnpm start
```

#### Q：监控数据会上传吗？

**完全本地**。SQLite 写 `data/metrics.db`，JSON Lines 写 `data/logs/*.jsonl`，dashboard 仅 127.0.0.1。不接任何 SaaS 监控（Datadog/Sentry/...）。

---

## 4. 故障排查

> 5 大类故障 + 解决方案。详细见 [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)。

### 4.1 启动失败

| 症状 | 原因 | 解法 |
|---|---|---|
| 双击无反应 | 端口 3721 占 | `lsof -iTCP:3721 -sTCP:LISTEN` 找占用的进程，杀掉 |
| "缺少主进程" 错误 | electron 装失败 | `pnpm install --force` 重装 |
| "Cannot find module" | 依赖缺 | `pnpm install` + `pnpm approve-builds` |
| 启动后 5 秒闪退 | SQLite 锁 | 杀所有 node 进程后再启动 |

### 4.2 对话失败

| 症状 | 原因 | 解法 |
|---|---|---|
| "Provider not configured" | LLM 没配 | 激活页配置 provider |
| "All providers failed" | 网络/凭据问题 | 测 `curl <provider-url>` 能不能通 |
| 工具调用失败 | 5 层免疫拦了 | 看 `~/.gina/audit/` 找原因 |
| 中文乱码 | .env 没设编码 | `export LANG=zh_CN.UTF-8` |

### 4.3 性能差

| 症状 | 原因 | 解法 |
|---|---|---|
| 启动 > 10s | 知识数据太大 | `data/cleanup.sh` 删老数据 |
| 对话 > 5s | LLM 慢 | 换 provider / 换小模型 |
| 内存 > 4 GB | CATS-Net 节点太多 | `vacuum` SQLite + 删老 memory |

### 4.4 监控异常

| 症状 | 原因 | 解法 |
|---|---|---|
| dashboard 打不开 | 端口 3000 占 | 换端口 `GINA_DASHBOARD_PORT=3001` |
| 告警一直弹 | 阈值太低 | `src/monitoring/alert.js` 改 `DEFAULT_THRESHOLDS` |
| 日志文件超大 | rotation 没跑 | 看 `data/logs/` 是不是 < 50MB/文件 |

### 4.5 凭据问题

| 症状 | 原因 | 解法 |
|---|---|---|
| "keychain 拒绝访问" | macOS 权限 | 系统设置 → 隐私与安全 → 钥匙串 → 允许 Gina |
| "未配置 APPLE_ID" | OAuth 没跑 | 第一次启动会弹 OAuth 弹窗，确认 |
| Gmail 认证失败 | OAuth 过期 | 重新走 OAuth 流程 |

---

## 5. 进阶

### 5.1 自定义 system prompt

GINA 的 system prompt 在 `src/prompt.js`，由 9 个 block 拼装：

- identity（我是谁）
- knowledge（领域知识）
- 工具描述
- 当前 scene
- 注入的记忆
- ACI 预判
- 任务上下文
- 决策审计链
- emotional-state（**唯一**的 emotion 出口）

### 5.2 接自定义 LLM

```js
// src/config.js
registerProvider({
  name: 'my-llm',
  baseURL: 'https://my-llm.example.com/v1',
  apiKey: process.env.MY_LLM_API_KEY,  // 走 keychain
  defaultModel: 'my-llm-7b',
})
```

### 5.3 调监控阈值

```js
// src/monitoring/alert.js
const DEFAULT_THRESHOLDS = {
  error_rate: 0.05,        // 改这里
  p95_ms: 1000,            // 改这里
  startup_failures: 3,
  cooldown_ms: 5 * 60_000,
  min_calls_for_eval: 20,
}
```

### 5.4 跑回归测试

```bash
pnpm test
```

全套件 1000+ 测试，含 emotion-isolation 9/9（每 PR 必跑）。

### 5.5 调试

- **L1 ACI 注入决策**：`src/memory/injector.js:404` 打断点
- **CATS-Net 激活扩散**：`src/cats_net/spreadActivation.js` 打断点
- **6 分析师**：`src/analysts/team.js` 打断点
- **监控 metrics**：`data/metrics.db` 用 `sqlite3` CLI 看

---

## 6. 反馈

- **Bug**：[GitHub Issues](https://github.com/Berry-su/GINA/issues)
- **讨论**：[GitHub Discussions](https://github.com/Berry-su/GINA/discussions)
- **邮件**：[berry_su2023@foxmail.com](mailto:berry_su2023@foxmail.com)

---

**GINA = 一个有完整大脑的常驻智能体。**

*文档维护：gina-platform worker B 9-02 落地。下次更新见 [GitHub Releases](https://github.com/Berry-su/GINA/releases)。*
