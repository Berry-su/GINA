# GINA 常见问题（FAQ.md）

> 12+ 常见问题，按主题分组。找不到答案去 [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)。

**最后更新**：2026-09-02 6 阶段 PLAN-P6 完工 + 监控 + 外部文档落地

---

## 0. 文档地图

| 主题 | 跳到 |
|---|---|
| 启动 / 激活 | [§1](#1-启动--激活) |
| LLM 配置 | [§2](#2-llm-配置) |
| 工具 / 能力 | [§3](#3-工具--能力) |
| 性能 / 资源 | [§4](#4-性能--资源) |
| 监控 / 告警 | [§5](#5-监控--告警) |
| 安全 / 凭据 | [§6](#6-安全--凭据) |
| 多设备同步 | [§7](#7-多设备同步) |
| 故障 / Bug | [§8](#8-故障--bug) |

---

## 1. 启动 / 激活

### Q1.1：双击图标无反应？

**答**：

- 看 `~/Library/Logs/Gina/`（macOS）/ `%APPDATA%\Gina\logs\`（Windows）
- 90% 是端口 3721 被占：`lsof -iTCP:3721 -sTCP:LISTEN -P` 找占用的进程
- 如果日志报 "Cannot find module" → 跑 `pnpm install --force`
- 如果日志报 "Permission denied" → `chmod -R u+w ~/Documents/BaiLongma-refactor-codebase`

### Q1.2：激活页打开后空白？

**答**：

- 检查 `http://127.0.0.1:3721/activation` 能否 ping 通
- 如果 LAN 访问，用 `http://<lan-ip>:3721/activation`
- **v2.1.601+ 是免费版，不需要输激活码**——所谓"激活"是配置 LLM provider
- 如果浏览器弹 SSL 警告，**别点"高级"**——GINA 默认 HTTP，警告是浏览器误报

### Q1.3：GINA 启动后 5 秒闪退？

**答**：

- 99% 是 SQLite 锁：杀所有 node 进程再启动
  ```bash
  pkill -f "node.*src/index.js"
  sleep 2
  pnpm start
  ```
- 1% 是 better-sqlite3 native build 失败：`pnpm rebuild better-sqlite3`

### Q1.4：可以多账号同时登录吗？

**答**：目前 v2.1.601+ 是单租户设计（老板的私人助理）。多账号需要 L7 决策层 + 隐私路由升级，**未来路线图**。

---

## 2. LLM 配置

### Q2.1：接哪个 LLM 最划算？

**答**：

| Provider | 模型 | 性价比 | 推荐场景 |
|---|---|---|---|
| **DeepSeek** | deepseek-v4-pro | ⭐⭐⭐⭐⭐ | 默认推荐（中文 + 代码 + 推理） |
| **OpenAI** | gpt-5.5 | ⭐⭐⭐⭐ | 英文 + 工具调用 |
| **Qwen** | qwen-turbo | ⭐⭐⭐⭐ | 国内 / 短对话 |
| **Moonshot** | kimi-k2.6 | ⭐⭐⭐⭐ | 长上下文（128k） |
| **Zhipu** | glm-5.1 | ⭐⭐⭐⭐ | 国内 + 中文 |
| **Anthropic** | claude-sonnet-4.5 | ⭐⭐⭐ | 复杂推理 |

如果用 DeepSeek 充值：<https://platform.deepseek.com/topup>

### Q2.2：能不联网用纯本地 LLM 吗？

**答**：可以，但有限制。

- 起本地 server（Ollama / LMStudio / vLLM）
- 在 GINA 配 custom OpenAI 兼容 provider
- 推荐模型：qwen2.5-7b（中文）/ llama-3.1-8b（英文）/ mistral-nemo（多语）
- 本地模型在工具调用 + CATS-Net 推理上比云端慢 2-3x

### Q2.3：GINA 调用 LLM 一次多少钱？

**答**（按 DeepSeek 价）：

- 平均一次对话：~2000 input + 800 output tokens
- DeepSeek 价：¥1/M input + ¥2/M output
- 一次对话：~¥0.0036
- 一天 50 次对话：~¥0.18
- 一个月：~¥5.4

比 ChatGPT Plus 便宜 10x。

### Q2.4：API key 怎么配？

**答**：**走 macOS keychain**，不写 `.env`。

```bash
# 方式 1：macOS 钥匙串（推荐）
security add-generic-password -a "gina" -s "deepseek" -w "<your-key>"

# 方式 2：临时 .env（不推荐，权限大）
echo "DEEPSEEK_API_KEY=sk-xxx" > .env
chmod 600 .env
```

GINA 启动时会自动从 keychain 读。

### Q2.5：GINA 怎么选 LLM provider？

**答**（自动策略）：

- 优先用上次成功的 provider
- 如果失败 3 次，依次 fallback：DeepSeek → OpenAI → Qwen → Moonshot → Zhipu
- 自定义：改 `src/llm.js` 的 `getProviderFallbacks()`

---

## 3. 工具 / 能力

### Q3.1：为什么 GINA "不接" ASR/TTS？

**答**：**GINA 已经接了**。之前 9-02 02:23 我凭印象说错，被老板纠正。具体见 `src/voice/`：

- **ASR 三套**：sherpa-onnx（工业级）/ Whisper 本地 Python（3300+ 行）/ macOS 原生 swift / cloud-asr
- **TTS 5 provider**：豆包 / MiniMax / OpenAI / ElevenLabs / 火山
- **情绪调制**：emotion-tts-modulator（情绪微调 TTS）
- **KWS 唤醒**：kws-model
- **UI 7 模块**：voice-core / wake / continuous / ptt / panel / orb.html / reply-coordinator = 1900 行

### Q3.2：为什么 GINA "不接" Notion / Obsidian？

**答**：**P3 阶段已经接了**。在 `src/connectors/notes-sync.js`。

```bash
# Notion
export GINA_NOTION_TOKEN="secret_xxx"  # 走 keychain

# Obsidian（本地 vault）
export GINA_OBSIDIAN_VAULT_PATH="~/Documents/ObsidianVault"
```

### Q3.3：怎么接 HomeKit / 米家？

**答**：**P4 阶段已经接了**。在 `src/connectors/{homekit,mijia,mqtt}.js`。

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

### Q3.4：怎么接 IoT 设备（不 HomeKit / 米家）？

**答**：走 MQTT 通用协议。任何支持 MQTT 的设备（ESP32 / 自建 broker）都能接：

```bash
# 通用 MQTT
export GINA_MQTT_BROKER_URL="mqtt://broker.example.com:1883"
export GINA_MQTT_USERNAME="..."
export GINA_MQTT_PASSWORD="..."
```

详细见 [`USER-GUIDE.md` §2.1](./USER-GUIDE.md#21-6-阶段能力导览)。

### Q3.5：能加自定义工具吗？

**答**：可以。GINA 的工具市场 + 工厂支持热插拔：

```js
// src/capabilities/my-tool.js
export default {
  name: 'my_tool',
  description: '做某事',
  schema: {
    type: 'object',
    properties: { arg1: { type: 'string' } },
  },
  execute: async ({ arg1 }) => {
    // 实现
    return { success: true, result: '...' }
  },
}
```

注册到 `src/capabilities/builtin-tools.js`。

### Q3.6：为什么某次工具调用被拒绝？

**答**：5 层免疫之一拦了：

1. **白名单**：工具没注册到 `TOOL_SCHEMAS`
2. **已装注册**：没装到 `capabilities/marketplace/`
3. **运行时 AST 检测**：代码被改
4. **重启自检**：上次重启没通过
5. **风控官审核**：6 分析师之一否决

看 `~/.gina/audit/` 找具体哪层拦了。

---

## 4. 性能 / 资源

### Q4.1：GINA 占多少内存？

**答**：

- 后端（无对话）：~500 MB
- 后端（有对话 + CATS-Net 激活）：~1.5 GB
- 加 Electron 桌面：~2 GB 总

如果 > 4 GB，看 [TROUBLESHOOTING.md §3](./TROUBLESHOOTING.md#3-性能调优)。

### Q4.2：对话响应慢？

**答**（按概率）：

1. **LLM provider 慢**（80%）：换 provider / 换小模型
2. **CATS-Net 节点太多**（15%）：`data/cleanup.sh` 删老 memory
3. **SQLite 锁**（3%）：杀所有 node 进程再启动
4. **本地 LLM 慢**（2%）：升级 GPU / 换大模型

看 `http://127.0.0.1:3000/metrics` 的 P95 列定位。

### Q4.3：磁盘占多少？

**答**：

- 主 DB（jarvis.db）：~50-200 MB（看你对话量）
- 监控 DB（metrics.db）：~10-50 MB
- 日志（data/logs/）：~30 MB（30 天轮转）
- 知识数据（data/gina-knowledge-brain.json）：~5 MB
- **总计**：~100-300 MB

### Q4.4：怎么清缓存？

**答**：

```bash
# 清对话记忆（保留知识）
sqlite3 data/jarvis.db "DELETE FROM conversations WHERE ts < strftime('%s','now','-30 day') * 1000"

# 清 CATS-Net 老节点
sqlite3 data/jarvis.db "DELETE FROM cats_net_nodes WHERE last_active < strftime('%s','now','-90 day') * 1000"

# VACUUM 回收空间
sqlite3 data/jarvis.db "VACUUM"
```

**警告**：清之前备份 `data/jarvis.db`。

### Q4.5：能跑在 4 GB 内存的 Mac 上吗？

**答**：可以，但慢。建议 8 GB+。

- 4 GB：能跑，但加载知识数据时可能 swap
- 8 GB：流畅
- 16 GB+：跑本地 LLM 也 OK

---

## 5. 监控 / 告警

### Q5.1：dashboard 在哪？

**答**：`http://127.0.0.1:3000/metrics`（默认启动）。

### Q5.2：怎么关掉 dashboard？

**答**：

```bash
GINA_DASHBOARD_DISABLED=1 pnpm start
```

### Q5.3：监控数据会上传吗？

**答**：**完全本地**。SQLite 写 `data/metrics.db`，JSON Lines 写 `data/logs/*.jsonl`，dashboard 仅 127.0.0.1。**不接任何 SaaS 监控**（Datadog / Sentry / LogRocket / New Relic）。

### Q5.4：告警怎么配？

**答**：改 `src/monitoring/alert.js` 的 `DEFAULT_THRESHOLDS`：

```js
const DEFAULT_THRESHOLDS = {
  error_rate: 0.05,        // 错误率 > 5% 告警
  p95_ms: 1000,            // P95 > 1s 告警
  startup_failures: 3,     // 连续 3 次启动失败告警
  cooldown_ms: 5 * 60_000, // 同类告警 5 分钟内不重复
  min_calls_for_eval: 20,  // 至少 20 次调用才评估错误率
}
```

告警走 macOS 系统通知（osascript），不外发。

### Q5.5：怎么看历史启动？

**答**：dashboard 启动历史 tab，或：

```bash
sqlite3 data/metrics.db "SELECT * FROM startups ORDER BY ts DESC LIMIT 20"
```

### Q5.6：能接 Slack / 邮件告警吗？

**答**：**当前版本不支持**。GINA 监控设计哲学是完全本地（不上传任何数据）。如果以后要接，得 gina-arch 拍板（影响安全模型）。

---

## 6. 安全 / 凭据

### Q6.1：API key 怎么存？

**答**：**macOS keychain**（推荐），不写 `.env`。

```bash
# macOS keychain
security add-generic-password -a "gina" -s "deepseek" -w "<your-key>"

# 或
security add-generic-password -a "gina" -s "openai" -w "<your-key>"
```

GINA 启动时自动读 keychain。

### Q6.2：.env 文件怎么用？

**答**：.env 只存**非敏感 endpoint**：

```bash
# .env (NOT secret, 提交到 git 也行)
DEEPSEEK_BASE_URL=https://api.deepseek.com
OPENAI_BASE_URL=https://api.openai.com/v1
QWEN_BASE_URL=https://dashscope.aliyuncs.com/api/v1
GINA_PORT=3721
GINA_LOG_LEVEL=info
```

**不要**把 API key 写 .env——加 `.env` 到 `.gitignore`。

### Q6.3：钥匙串拒绝访问怎么办？

**答**：

1. 系统设置 → 隐私与安全 → 钥匙串
2. 找到 Gina，点 "始终允许"
3. 重启 Gina

### Q6.4：GINA 会读我电脑上的什么文件？

**答**（透明披露）：

- `~/Documents/BaiLongma-refactor-codebase/`：GINA 自己的数据（不外发）
- `~/.gina/`：用户配置 + 缓存
- 用户显式给的文件（拖入 / 打开 / 引用）
- 工具调用显式访问的路径（如 `read_file(path)`）

**不会**：自动扫描整个硬盘、上传任何文件、记录其他应用的截图。

### Q6.5：GINA 5 层免疫具体怎么工作？

**答**（每条工具调用都过）：

1. **白名单**：工具必须注册在 `TOOL_SCHEMAS`
2. **已装注册**：必须装在 `capabilities/marketplace/`
3. **运行时 AST 变异检测**：检查工具代码是否被改
4. **重启自检**：每次重启校验
5. **风控官审核**：6 分析师之一专职审核

任意一层失败 → 拒绝执行 + 写 audit。

---

## 7. 多设备同步

### Q7.1：怎么用 iPhone / iPad 同步？

**答**：P5 阶段完工，但需要：

1. iOS TestFlight：等老板申请 Apple Developer ID（老板拍板后）
2. 装 iOS app（URL 等老板拍）
3. 配 GINA 局域网 token：`http://<gina-host>:3721/sync?token=...`

详见 [gina-ui 仓 README](https://github.com/Berry-su/gina-ui)。

### Q7.2：怎么用 Apple Watch？

**答**：watchOS 10+。同上，需要 TestFlight。

### Q7.3：怎么用 Android？

**答**：Android 12+。通过 Google Play 内部测试通道（老板拍板后开放）。

### Q7.4：Wear OS 呢？

**答**：Wear OS 4+。同上。

### Q7.5：能用 HarmonyOS / 小米澎湃 / 三星 One UI 吗？

**答**：当前版本仅 iOS / watchOS / Android / Wear OS。其他平台等 P5 后续阶段。

---

## 8. 故障 / Bug

### Q8.1：怎么报 Bug？

**答**：[GitHub Issues](https://github.com/Berry-su/GINA/issues)，提供：

- GINA 版本（`pnpm run version`）
- 操作系统（macOS 14.2 / Windows 11 23H2 / ...）
- 复现步骤
- 期望 / 实际
- 截图 / 日志（`~/Library/Logs/Gina/`）

### Q8.2：怎么提 Feature Request？

**答**：[GitHub Discussions · Ideas](https://github.com/Berry-su/GINA/discussions/categories/ideas)。

### Q8.3：怎么贡献代码？

**答**：见 [`DEVELOPER.md`](./DEVELOPER.md) §5。

### Q8.4：怎么回滚到上一版本？

**答**：

```bash
# dmg
brew uninstall --cask gina
# 装旧版
brew install berry-su/tap/gina@2.1.600

# 源码
cd ~/Documents/BaiLongma-refactor-codebase
git log --oneline  # 找上一个版本 commit
git checkout <commit>
pnpm install
```

### Q8.5：GINA 是开源的吗？

**答**：**MIT License**。代码：<https://github.com/Berry-su/GINA>。欢迎 fork + PR。

---

## 9. 没找到答案？

- 完整文档目录：[`INDEX.md`](./INDEX.md)
- 故障排查：[`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)
- 安装：[`INSTALL.md`](./INSTALL.md)
- 设计文档：见 `~/Desktop/gina迭代增强计划/03-架构决策/`
- 邮件：berry_su2023@foxmail.com

---

*FAQ 维护：gina-platform worker B 9-02 落地 · 12+ 问题 · 下次更新见 [GitHub Releases](https://github.com/Berry-su/GINA/releases)*
