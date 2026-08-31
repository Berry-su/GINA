# pnpm 迁移验证报告 · 2026-09-01

> 落盘 ADR：`ADR-20260831-CATS-NET-软分层方案.md` §5 步骤 1-7
> 执行者：gina-coder
> 总耗时：~30 min（步骤 1-5 实际串行） + push 时间

---

## 1. 软链接验证（`ls -la node_modules/@berrysu/`）

```
$ ls -la /Users/ahs/Documents/BaiLongma-refactor-codebase/node_modules/@berrysu/
drwxr-xr-x@   3 ahs  staff     96 Sep  1 00:37 .
drwxr-xr-x  499 ahs  staff  15968 Sep  1 00:37 ..
lrwxr-xr-x@   1 ahs  staff    139 Sep  1 00:37 gina-core -> ../.pnpm/@berrysu+gina-core@file+..+..+Desktop+GINA+gina增加计划登记_4a56f4516a74b6b416cd2d2bf54f8430/node_modules/@berrysu/gina-core

$ pnpm list @berrysu/gina-core --depth=0
gina@2.1.601 /Users/ahs/Documents/BaiLongma-refactor-codebase
│
│   dependencies:
└── @berrysu/gina-core@file:../../Desktop/GINA/gina增加计划登记
```

✅ 软链接建立成功。9 个 export 子路径全部可达（`@berrysu/gina-core/{cats_net,analysts,state_machine,memory,mcp,data_engine,data_sources,trading,business}`）。

---

## 2. `pnpm test` 结果（9/9 通过）

| # | 模块 | 状态 |
|---|------|------|
| 1 | 决策引擎 + 可解释 + 进化 + CATS-Net + 分析师 + 金融引擎 | ✅ |
| 2 | 伦理门禁 initEthicsGate | ✅ |
| 3 | 工作流 DAG orchestrator | ✅ |
| 4 | MCP 协议 server（7 个工具） | ✅ |
| 5 | A2A 协议 server | ✅ |
| 6 | 状态机 StateMachine FSM | ✅ |
| 7 | 工具调度 MCPScheduler | ✅ |
| 8 | 三层记忆 + CATS-Net 投影 | ✅ |
| 9 | 知识图谱 | ✅ |

```
==============================================================
  启动集成验证汇总: 9/9 通过
==============================================================
```

⚠️ 已知 warning（迁移前已存在，**不归本任务**）：`better-sqlite3` 原生模块 NODE_MODULE_VERSION 130 vs Node 20 的 115 — 进化系统已优雅降级。修复路径：`pnpm rebuild better-sqlite3`（gina-platform 排期）。

---

## 3. 7 agent 启动 checklist 回执（system_prompt 加载确认）

`mavis agent get <name>` 全部 `ok: true`：

| # | agent | displayName | system_prompt 加载 | 主要职责摘要 |
|---|-------|-------------|-------------------|-------------|
| 1 | `gina-pm` | 产品经理 | ✅ | 需求池 + Roadmap + 跨 agent 协调 |
| 2 | `gina-arch` | 架构师 | ✅ | 8 大层一致性 + ADR + 跨层接口 |
| 3 | `gina-coder` | 编程 | ✅ | 后端 + 3D 桌宠 + git + CI/CD |
| 4 | `gina-ui` | UI设计 | ✅ | Monochrome Precision HUD + Scene Protocol + 3D 桌宠 + 水晶商城 |
| 5 | `gina-qa` | 质检 | ✅ | 回归 + code review + UI 走查 + 边界条件 |
| 6 | `gina-platform` | 平台工程 / SRE | ✅ | 部署 + CI/CD + 监控 + 备份 + 灾备 |
| 7 | `gina-immune` | 安全 / 免疫 | ✅ | 5 层免疫 + 工具可信度 + 协议安全 + 隐私路由 |

每个 agent 的 system_prompt 都包含项目背景（8 大层）、硬规则、协作接口、产出格式、反模式清单 —— **7 agent 团队全部就绪，pnpm 迁移未破坏任何 agent 启动上下文**。

---

## 4. 关键 commit hash

| 仓 | commit | 描述 |
|----|--------|------|
| `gina-cats-net` (Berry-su/gina-cats-net) | `d7128ac` | chore(gina-core): 重定位为 @berrysu/gina-core 内核包 |
| 主仓 (Berry-su/GINA) | `da2c404` | chore(pnpm): 启用 pnpm workspace + file: 软依赖 @berrysu/gina-core |
| 主仓（本报告） | `TBD` | docs: pnpm 迁移验证报告 |

---

## 5. 改动清单（仅配置层，无业务代码）

### gina-cats-net 仓
- `package.json`: 改写为 `@berrysu/gina-core` + 9 export 子路径 + private + publishConfig.restricted
- `src/business/index.js`: 新建（占位入口,原仓缺这个文件）

### 主仓
- `package.json`: + `packageManager: "pnpm@10.34.5"` + `workspaces: []` + `@berrysu/gina-core` 依赖 + 3 个 core:* 脚本
- `.npmrc`: 新建（auto-install-peers + 宽松 peer 依赖）
- `pnpm-workspace.yaml`: 新建（packages: ['.']）
- `pnpm-lock.yaml`: 新建（pnpm 自动生成,5415 行）
- `package-lock.json`: 删除（mavis-trash,可恢复）
- `scripts/check-core-comes-first.sh`: 新建（跨仓 commit 顺序轻量检查）

---

## 6. 遗留事项

1. **主仓 `src/cats_net/` 旧副本未清** —— 按 ADR §5 步骤 7，迁移完成 1 周后（W38）再清理
2. **pre-commit hook 是轻量提示版** —— 强拒版留给 gina-platform v2（`scripts/check-core-comes-first.sh` 已在）
3. **better-sqlite3 NODE_MODULE_VERSION 警告** —— 迁移前已存在,不在本任务 scope
4. **CI 中 `file:` 绝对路径问题** —— ADR R4:CI runner 路径布局与本机不同,需 gina-platform 改 `link:` 协议或 git URL
5. **gina-cats-net 仓独立 CI 未建** —— ADR R5:留给 gina-platform W37 排期
6. **.d.ts 类型未出** —— ADR §3.2.1 注:Phase Y 后期补

---

## 7. 下一步建议

1. **W37 第一波**:
   - gina-pm 启动 Y-01 (ACI 预判层增强) + Y-03 (L3 激活扩散层次)
   - gina-coder 准备从主仓 `src/cats_net/` 切到 `import { CatsNet } from '@berrysu/gina-core/cats_net'` 的渐进迁移（保留 fallback）
2. **W37 第二波**:
   - gina-platform 出 gina-cats-net 独立 CI（GitHub Actions: lint + test + 8 大层 selftest）
   - gina-platform 出主仓 CI 改造（`file:` 绝对路径 → `link:` 协议 或 git URL）
3. **W38 第三波**:
   - 主仓 `src/cats_net/` 旧副本清理（按 ADR §5 步骤 7 1 周 buffer）
   - gina-platform 升级 pre-commit hook 至强拒版
   - gina-coder 起草 ADR-2026-XX-XX-gina-core-0.1.0-发布

---

## 8. 命名规范合规性

- ✅ 任何文件不含 `xiaoyuanda` / `Bailongma` 标识
- ✅ git author = `Berry.Su <berry_su2023@foxmail.com>`
- ✅ npm 包名 = `@berrysu/gina-core`
- ✅ 主仓 productName / appId = `com.berrysu.gina`（保持）
- ✅ commit message 全部用中文写「为什么」不写「是什么」
