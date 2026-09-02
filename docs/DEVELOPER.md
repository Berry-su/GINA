# GINA 开发者指南（DEVELOPER.md）

> 仓结构 · 7 agent 团队 · commit 规范 · 跑测试 · 提 PR 流程

**适用对象**：想贡献 GINA 代码的开发者

---

## 0. 文档地图

| 我想... | 跳到 |
|---|---|
| 快速看懂仓结构 | [§1 仓结构](#1-仓结构) |
| 了解 7 agent 团队 | [§2 7-agent-团队](#2-7-agent-团队) |
| 写 commit | [§3 commit 规范](#3-commit-规范) |
| 跑测试 | [§4 跑测试](#4-跑测试) |
| 提 PR | [§5 PR 流程](#5-pr-流程) |
| 接新 LLM provider | [§6 添加 LLM provider](#6-添加-llm-provider) |
| 接新工具 | [§7 添加工具](#7-添加工具) |
| 加新 layer / 模块 | [§8 添加模块](#8-添加模块) |
| 完整开发环境 | [§9 开发环境](#9-开发环境) |

---

## 1. 仓结构

### 1.1 3 仓拓扑

GINA 用 CATS-Net 软分层（ADR-001）+ pnpm workspace，3 仓分离：

```
Berry-su/GINA              ← 主仓（Electron + 8 大层 + 业务）
Berry-su/gina-cats-net     ← CATS-Net 内核真理源（@berrysu/gina-core）
Berry-su/gina-ui           ← 多设备 UI（iOS / watch / Android / Wear OS）
Berry-su/gina-mall         ← 商城（周边业务）
```

主仓通过 `file:` 软链引 `@berrysu/gina-core`：

```json
// ~/Documents/BaiLongma-refactor-codebase/package.json
{
  "dependencies": {
    "@berrysu/gina-core": "file:../gina-cats-net"
  }
}
```

`pnpm install` 后 `node_modules/@berrysu/gina-core` 是符号链接。

### 1.2 主仓目录树

```
~/Documents/BaiLongma-refactor-codebase/
├── electron/              # Electron 主进程 + 预加载 + 窗口控制
├── src/                   # 业务代码
│   ├── index.js           # Agent 主循环
│   ├── api.js             # HTTP API
│   ├── llm.js             # LLM 调用
│   ├── config.js          # 配置
│   ├── db.js              # SQLite
│   ├── memory/            # L2 三层记忆
│   ├── cats_net/          # L3 (import from @berrysu/gina-core)
│   ├── knowledge/         # L4 知识大脑
│   ├── state_machine/     # L5
│   ├── analysts/          # L7
│   ├── immune/            # 5 层免疫
│   ├── capabilities/      # L6 工具市场
│   ├── subagents/         # 子 Agent 协议
│   ├── mcp/               # MCP 协议
│   ├── monitoring/        # ADR-017 全局监控
│   ├── self/              # C-4 self-model
│   ├── emotion/           # C-4 joy emotion
│   ├── learning/          # C-4 direction + reflection
│   ├── experience/        # C-4 experience library
│   ├── i18n/              # P1 翻译
│   ├── multimodal/        # P1 VLM/OCR
│   ├── connectors/        # P2 + P4 日历/邮件/任务/IoT
│   ├── agentic/           # P3 主动编排
│   ├── brain/             # C-3 整合层
│   └── *.test.js          # 单元测试
├── tests/                 # 跨模块测试
├── data/                  # SQLite + 知识 + 日志
├── docs/                  # 用户文档
├── .github/workflows/     # CI/CD
├── scripts/               # 构建脚本
├── package.json
├── pnpm-lock.yaml
└── tsconfig.json
```

### 1.3 关键约定

- **ESM only**：`"type": "module"`，所有 `.js` 都是 ESM
- **Node ≥ 18**（建议 20 LTS）
- **pnpm ≥ 9**（建议 10.34.5）
- **emotion-isolation 严守**：joy emotion 永远不进决策路径（每 PR 必跑 `pnpm test:joy-isolation`）
- **不破 6 阶段 PLAN-P6 既有 commit**：只加新 commit
- **8 大层 0-7 编号**：L0 意识循环 → L7 决策层
- **监控数据全本地**：不上传任何 metrics/log/alert

---

## 2. 7 agent 团队

GINA 项目用 Mavis 编排 + 7 agent 团队协作开发。每个 agent 有自己的角色和职责。

| Agent | 角色 | 负责 |
|---|---|---|
| **gina-pm** | 产品经理 | 需求池、Roadmap、跨 agent 协调 |
| **gina-arch** | 架构师 | 8 大层一致性、ADR、跨层接口 |
| **gina-coder** | 编程 | 后端、git、CI |
| **gina-ui** | UI 设计 | Monochrome HUD、Scene Protocol、商城 UI |
| **gina-qa** | 质检 | 回归测试、emotion-isolation、跨层一致性、UI 走查 |
| **gina-platform** | SRE | pnpm workspace 迁移、CI/CD、launchd 常驻、监控备份 |
| **gina-immune** | 安全 / 免疫 | 5 层免疫、工具可信度、隐私路由、协议安全 |

详细见 `~/Desktop/gina迭代增强计划/04-团队/团队总览.md`。

### 2.1 跨 agent 工作流

```
需求（gina-pm）
    ↓
ADR（gina-arch）
    ↓
实现（gina-coder）
    ↓
    ├─► UI（gina-ui）
    └─► 测试（gina-qa）
    ↓
CI/CD + 监控（gina-platform）
    ↓
安全审核（gina-immune）
    ↓
合并 main
```

### 2.2 agent 之间怎么沟通

- **不动 owner 的文件**：每个文件有明确的 agent owner
- **跨 agent 改动**走 ADR 评审
- **commit 标注 agent**：`agent: gina-coder` 在 commit body

---

## 3. commit 规范

### 3.1 format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 3.2 type

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `docs` | 文档 |
| `refactor` | 重构（不改行为） |
| `perf` | 性能 |
| `test` | 测试 |
| `chore` | 构建/工具/依赖 |
| `revert` | 回滚 |

### 3.3 scope

| scope | 含义 |
|---|---|
| `core` | CATS-Net 内核 |
| `brain` | 8 大层整合 |
| `monitoring` | 监控 |
| `i18n` | 翻译 |
| `multimodal` | VLM/OCR |
| `connectors` | 外部 API |
| `agentic` | 主动编排 |
| `iot` | 智能家居 |
| `video` | 视频理解 |
| `ui` | UI |
| `ui-react` | 新 React UI |
| `voice` | 语音 |
| `db` | 数据库 |
| `ci` | CI/CD |
| `tests` | 测试 |
| `deps` | 依赖 |

### 3.4 subject

- **50 字符以内**
- **首字母小写**（除专有名词）
- **不加点号**
- **祈使句**

### 3.5 body

- 72 字符换行
- 解释 **why** 不是 what
- 引用 issue / ADR

### 3.6 footer

- `Refs: ADR-XXX`
- `Closes: #123`
- `Agent: gina-coder`
- `Tests: <test names>`

### 3.7 author

**必须**用 `Berry.Su <berry_su2023@foxmail.com>`：

```bash
git config user.name "Berry.Su"
git config user.email "berry_su2023@foxmail.com"

# 或单次：
git commit --author="Berry.Su <berry_su2023@foxmail.com>" -m "..."
```

### 3.8 示例

```bash
git commit --author="Berry.Su <berry_su2023@foxmail.com>" -m "feat(monitoring): 全局监控 + 外部文档 (ADR-017)

- src/monitoring/{metrics,logger,alert,dashboard}.js 5 文件 ~1100 行
- 数据全本地 (data/metrics.db + data/logs/*.jsonl)
- dashboard 绑 127.0.0.1:3000 (d3.js 实时图)
- docs/{USER-GUIDE,INSTALL,FAQ,TROUBLESHOOTING,DEVELOPER,INDEX}.md ~30KB

Refs: ADR-017
Closes: #监控 + 外部文档
Agent: gina-platform
Tests: tests/test-monitoring.js (9/9) + tests/test-docs.test.js (5/5)"
```

---

## 4. 跑测试

### 4.1 全套

```bash
cd ~/Documents/BaiLongma-refactor-codebase
pnpm test
```

应该看到 1000+ 测试全过（含 emotion-isolation 9/9）。

### 4.2 单个测试

```bash
# 单个文件
node --test tests/test-monitoring.js

# 单个套件
node src/self/test-model.js

# 跑指定 case
node --test --test-name-pattern="T1" tests/test-monitoring.js
```

### 4.3 必跑测试（每 PR）

| 测试 | 命令 | 期望 |
|---|---|---|
| **emotion-isolation 9/9** | `pnpm test:joy-isolation` | 9/9 pass（每 PR 必跑）|
| **cats-net-selftest** | `pnpm exec node tests/cats-net-selftest.js` | 226/226 |
| **verify-startup** | `pnpm exec node scripts/verify-startup.mjs` | 9/9 |
| **self-model** | `pnpm test:self-model` | 80 |
| **direction** | `pnpm test:direction` | 88 |
| **c4-integration** | `pnpm test:c4` | 47 |
| **experience** | `pnpm test:experience` | 22 |
| **ingestion** | `pnpm test:ingestion` | 32 |
| **direction-weighting** | `pnpm exec node --test tests/test-direction-weighting.js` | 41/41 |
| **r11-reflection** | `pnpm exec node --test tests/test-r11-reflection.js` | 4/4 |
| **translate** | `pnpm exec node --test tests/test-translate.js` | 18/18 |
| **vlm-ocr** | `pnpm exec node --test tests/test-vlm-ocr.js` | 5/5 |
| **connectors** | `pnpm exec node --test tests/test-connectors.js` | 15/15 |
| **iot** | `pnpm exec node --test tests/test-iot.js` | 15/15 |
| **iot-scenarios** | `pnpm exec node --test tests/test-iot-scenarios.js` | 14/14 |
| **video** | `pnpm exec node --test tests/test-video.js` | 8/8 |
| **video-summarizer** | `pnpm exec node --test tests/test-video-summarizer.js` | 4/4 |
| **ci-yaml** | `pnpm exec node --test tests/test-ci-yaml.test.js` | 8/8 |
| **monitoring** | `pnpm exec node --test tests/test-monitoring.js` | 9/9 |
| **docs** | `pnpm exec node --test tests/test-docs.test.js` | 5/5 |

### 4.4 调试模式

```bash
# 单线程 + 详细输出
node --test --test-reporter=spec tests/test-monitoring.js

# 内存跟踪
node --expose-gc --test tests/test-monitoring.js

# Inspector（断点）
node --inspect-brk --test tests/test-monitoring.js
# 然后用 Chrome DevTools 连接 chrome://inspect
```

### 4.5 性能基准

```bash
# 性能对比（不写文件）
node --test --test-reporter=spec --test-name-pattern="perf" tests/

# 跑全 P95 报告
node scripts/perf-report.mjs  # 自建脚本
```

---

## 5. PR 流程

### 5.1 准备

```bash
# 1. 从 main 拉最新
git checkout main
git pull origin main

# 2. 建分支（命名：<type>/<scope>-<short-desc>）
git checkout -b feat/monitoring-global
# 或
git checkout -b fix/emotion-isolation-leak

# 3. 改代码

# 4. 跑测试
pnpm test
# 必须 0 失败 + emotion-isolation 9/9
```

### 5.2 commit + push

```bash
git add .
git commit --author="Berry.Su <berry_su2023@foxmail.com>" -m "feat(monitoring): ..."
git push origin feat/monitoring-global
```

### 5.3 开 PR

1. 去 [GitHub PR 页](https://github.com/Berry-su/GINA/pulls)
2. "New pull request"
3. base: `main` ← compare: `feat/monitoring-global`
4. 标题 + 描述（用 PR template）
5. 关联 issue / ADR
6. 等 CI 跑过

### 5.4 PR template

```markdown
## 改了什么

- 加 / 改 / 删

## 为什么

- 关联 issue: #xxx
- 关联 ADR: ADR-xxx

## 测试

- [ ] pnpm test 全过
- [ ] emotion-isolation 9/9
- [ ] 新加的测试全过

## 截图 / 录屏

（如果 UI 改动）

## Checklist

- [ ] commit author = Berry.Su
- [ ] 没破 6 阶段 PLAN-P6 既有 commit
- [ ] 没破 emotion-isolation
- [ ] 没破跨层一致性
- [ ] docs 同步（如果改了用户能看见的东西）
```

### 5.5 review 流程

- gina-coder 提 PR
- gina-qa 自动跑测试（CI）
- gina-arch 看 ADR 一致性
- gina-immune 看安全影响
- 老板拍板 merge

### 5.6 merge 后

- 关 issue
- 更新 CHANGELOG（如有）
- 在任务看板打勾

---

## 6. 添加 LLM provider

### 6.1 简单 provider（OpenAI 兼容）

```js
// src/providers/my-provider.js
import OpenAI from 'openai'
import { config } from '../config.js'

export const MY_PROVIDER = 'my-provider'

export class MyProvider {
  constructor(opts = {}) {
    this.client = new OpenAI({
      baseURL: opts.baseURL || 'https://api.example.com/v1',
      apiKey: opts.apiKey || process.env.MY_PROVIDER_API_KEY,
    })
    this.model = opts.model || 'my-model'
  }

  async chat({ messages, tools, signal }) {
    return await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      signal,
    })
  }
}
```

### 6.2 注册

```js
// src/providers/registry.js
import { MyProvider, MY_PROVIDER } from './my-provider.js'

registerProvider({
  name: MY_PROVIDER,
  factory: (opts) => new MyProvider(opts),
})
```

### 6.3 加测试

```js
// tests/test-my-provider.js
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('MyProvider chat', async () => {
  // mock client
  // 测 chat 流式 / 非流式 / 工具调用
})
```

---

## 7. 添加工具

### 7.1 简单工具

```js
// src/capabilities/tools/my-tool.js
export default {
  name: 'my_tool',
  description: '做某事',
  category: 'data',
  securityLevel: 1,  // 1=普通, 2=敏感, 3=危险
  schema: {
    type: 'object',
    properties: {
      arg1: { type: 'string', description: '参数 1' },
    },
    required: ['arg1'],
  },
  execute: async ({ arg1, context }) => {
    // 业务实现
    return {
      success: true,
      result: `处理 ${arg1}`,
    }
  },
}
```

### 7.2 注册

```js
// src/capabilities/builtin-tools.js
import myTool from './tools/my-tool.js'

export const TOOL_SCHEMAS = [
  // ...其他
  myTool,
]
```

### 7.3 emotion 隔离

**工具调用永远不要传 emotion 字段**：

```js
// ❌ 错
execute: async ({ arg1, joy, mood }) => { ... }

// ✅ 对
execute: async ({ arg1, context }) => {
  // context.reflectionHook 反映性能 / 成功率，不含 emotion
}
```

测试时会跑 `pnpm test:joy-isolation` 验证。

### 7.4 加测试

```js
// tests/test-my-tool.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import myTool from '../src/capabilities/tools/my-tool.js'

test('my_tool 正常路径', async () => {
  const r = await myTool.execute({ arg1: 'test', context: {} })
  assert.equal(r.success, true)
})

test('my_tool 异常路径', async () => {
  await assert.rejects(() => myTool.execute({ arg1: '', context: {} }))
})
```

---

## 8. 添加模块

### 8.1 流程

1. **写 ADR**（`~/Desktop/gina迭代增强计划/03-架构决策/ADR-XXX-*.md`）
2. **gina-arch 评审**
3. **gina-coder 实现**
4. **加测试**
5. **CI 通过**
6. **gina-immune 审核**（如果涉及安全）

### 8.2 ADR 模板

```markdown
# ADR-XXX · <title> · <date>

| 字段 | 值 |
|---|---|
| 编号 | ADR-XXX |
| 状态 | proposed → accepted |
| 作者 | gina-arch / gina-coder |
| 上游 | (什么驱动) |
| 下游 | (被什么依赖) |

## 0. 背景与驱动
## 1. 目标
## 2. 非目标
## 3. 架构总览
## 4. 关键决策
## 5. 实施清单
## 6. 风险与缓解
## 7. 验收清单
## 8. 不做清单
## 9. 状态表
## 10. 变更记录
## 11. 关联文档
```

### 8.3 模块命名

- `src/<module>/` 一个目录
- `<module>-state.js` 状态
- `<module>-engine.js` 引擎
- `<module>-api.js` 暴露 API
- `test-<module>.js` 测试

### 8.4 跨层接口

新模块如果要 hook 进 CATS-Net / 8 大层：

1. 看 `src/brain/integration/_base.js` 拿接口契约
2. 实现 `init()` / `process()` / `teardown()`
3. 注册到 `src/brain/integration/init.js`
4. 写跨层一致性测试

---

## 9. 开发环境

### 9.1 推荐

- **macOS 14+**（Apple Silicon 优先）
- **Node 20 LTS**（`nvm install 20 && nvm use 20`）
- **pnpm 10.x**（`npm install -g pnpm`）
- **VS Code** + 推荐扩展：
  - ESLint
  - Prettier
  - Node.js Extension Pack
  - SQLite Viewer

### 9.2 配置

```bash
# .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "files.associations": {
    "*.md": "markdown"
  }
}
```

### 9.3 调试

```bash
# 1. 后端（不启动 Electron）
pnpm start:backend

# 2. 后端 + watch
pnpm dev

# 3. Inspector
node --inspect-brk --env-file=.env src/index.js
# Chrome DevTools → chrome://inspect

# 4. 内存 / CPU profile
node --prof src/index.js
# 跑一会儿后 Ctrl+C
node --prof-process isolate-*.log > processed.txt
```

### 9.4 推荐工具

- **`sqlite3` CLI**：`sqlite3 data/jarvis.db ".tables"`
- **`jq`**：处理 JSON Lines
- **`fzf`**：模糊找文件
- **`tig`**：git log 可视化
- **`pnpm dlx`**：跑临时 CLI

---

## 10. 贡献者公约

- **尊重他人**：所有评论必须 professional
- **说"为什么"**：代码改动解释 why 而不是 what
- **小步快跑**：PR 不超过 500 行（超过拆）
- **不破 6 阶段**：不在既有 commit 上 force push
- **emotion 隔离**：永远不把 joy 塞进决策路径
- **不外发监控**：永远不接 SaaS 监控
- **不外发凭据**：永远走 macOS keychain / OAuth

---

*DEVELOPER 维护：gina-platform worker B 9-02 落地 · 7 agent 团队 + 完整开发流程 · 下次更新见 [GitHub Releases](https://github.com/Berry-su/GINA/releases)*
