# GINA 文档目录（INDEX.md）

> 文档地图 · 主题索引 · 按角色 / 按状态分类 · 维护者

**最后更新**：2026-09-02 · 6 阶段 PLAN-P6 100% 完工 + 监控 + 外部文档落地

---

## 0. 文档地图

| 文档 | 用途 | 受众 |
|---|---|---|
| [README.md](../README.md) | 项目主入口 | 所有人 |
| [USER-GUIDE.md](./USER-GUIDE.md) | 5 分钟上手 + 6 阶段功能导览 | 终端用户 |
| [INSTALL.md](./INSTALL.md) | 完整安装（macOS/Windows/Linux/源码） | 想装机的人 |
| [FAQ.md](./FAQ.md) | 12+ 常见问题 | 所有人 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 5 大类故障 + 解法 | 出问题时 |
| [DEVELOPER.md](./DEVELOPER.md) | 仓结构 / 7 agent / commit / PR | 开发者 |
| [INDEX.md](./INDEX.md) | 本文件 — 文档目录 | 找文档时 |

---

## 1. 快速链接

### 1.1 我是终端用户

1. [README.md §5 快速开始](../README.md#5-快速开始) — 5 分钟装好
2. [USER-GUIDE.md §1 快速开始](./USER-GUIDE.md#1-快速开始) — 第一次对话
3. [USER-GUIDE.md §2 核心功能](./USER-GUIDE.md#2-核心功能) — 6 阶段都有啥
4. [FAQ.md](./FAQ.md) — 12+ 常见问题
5. [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — 出问题

### 1.2 我是开发者

1. [DEVELOPER.md §1 仓结构](./DEVELOPER.md#1-仓结构)
2. [DEVELOPER.md §3 commit 规范](./DEVELOPER.md#3-commit-规范)
3. [DEVELOPER.md §4 跑测试](./DEVELOPER.md#4-跑测试)
4. [DEVELOPER.md §5 PR 流程](./DEVELOPER.md#5-pr-流程)
5. [DEVELOPER.md §6 添加 LLM provider](./DEVELOPER.md#6-添加-llm-provider) / [§7 添加工具](./DEVELOPER.md#7-添加工具) / [§8 添加模块](./DEVELOPER.md#8-添加模块)

### 1.3 我是 gina-arch / ADR 评审

- 全部 ADR：`~/Desktop/gina迭代增强计划/03-架构决策/`
- 当前活跃：ADR-017（监控 + 外部文档）

### 1.4 我想了解 8 大层架构

- [README.md §2 8 大层架构](../README.md#2-8-大层架构)
- [USER-GUIDE.md §2.2 8 大层架构（核心）](./USER-GUIDE.md#22-8-大层架构核心)
- 完整大脑路线图：`~/Desktop/gina迭代增强计划/05-设计文档/GINA完整大脑路线图_2026-08-29.md`

### 1.5 我想了解 CATS-Net

- [README.md §2 L3 CATS-Net](../README.md#2-8-大层架构)
- ADR-001（CATS-Net 软分层）：`~/Desktop/gina迭代增强计划/03-架构决策/ADR-001-CATS-Net-软分层与pnpm迁移_2026-09-01.md`
- ADR-002（CATS-Net 自我完善）：`~/Desktop/gina迭代增强计划/03-架构决策/ADR-002-CATS-Net-自我完善_2026-09-01.md`
- ADR-005（8 大层进 CATS-Net）：`~/Desktop/gina迭代增强计划/03-架构决策/ADR-005-8大层进CATS-Net_2026-09-01.md`

### 1.6 我想了解 6 阶段 PLAN-P6

- PLAN：`~/Desktop/gina迭代增强计划/03-架构决策/PLAN-6阶段全差距补齐_2026-09-02.md`
- 总览：`~/Desktop/gina迭代增强计划/03-架构决策/PLAN-P6-6阶段完工总览_2026-09-02.md`
- 阶段 ADR：
  - P1：ADR-008（翻译）+ ADR-009（VLM/OCR）
  - P2：ADR-010（日历+邮件+任务）
  - P3：ADR-011（主动编排+笔记）
  - P4：ADR-012（IoT）
  - P5：ADR-014（iOS/watch）+ ADR-015（Android/Wear OS）
  - P6：ADR-013（视频）

---

## 2. 主题地图

### 2.1 架构

- **8 大层**：L0 意识循环 / L1 ACI / L2 记忆 / L3 CATS-Net / L4 知识 / L5 状态机 / L6 工具 / L7 决策
- **5 层免疫**：白名单 / 已装注册 / 运行时 AST / 重启自检 / 风控官
- **Scene Protocol v1**：`Agent 不发命令只声明状态；UI = f(scene)`
- **Monochrome HUD**：单色 + 细线框 + 等宽字体
- **emotion-isolation**：joy emotion 永远不进决策路径
- **CATS-Net**：ConceptNode + 激活扩散 + 时序衰减 + 自学习 + 编辑 API

### 2.2 6 阶段 PLAN-P6

| 阶段 | 模块 | ADR |
|---|---|---|
| P1 | 翻译 / VLM / OCR | ADR-008 + ADR-009 |
| P2 | 日历 / 邮件 / 任务 | ADR-010 |
| P3 | 主动编排 / Notion / Obsidian | ADR-011 |
| P4 | HomeKit / 米家 / MQTT | ADR-012 |
| P5 | iOS / watch / Android / Wear OS | ADR-014 + ADR-015 |
| P6 | 视频理解 | ADR-013 |

### 2.3 跨阶段基础设施

- **CATS-Net 软分层**（ADR-001）：主仓 / 内核仓 / UI 仓 3 仓拓扑
- **CATS-Net 自我完善**（ADR-002）：层次激活 / 时序 / 自学习 / 编辑 API
- **8 大层进 CATS-Net**（ADR-005）：所有层都通过 CATS-Net 整合
- **新基础设施**（ADR-003 + ADR-004）：self-model / direction / joy / ingestion / experience
- **CI/CD**（ADR-016）：3 仓 × 多平台 GitHub Actions
- **监控 + 外部文档**（ADR-017）：本地 metrics + alert + log + dashboard + 6 份文档

### 2.4 安全 / 凭据

- **沙箱默认关**（老板 9-01 拍板）：GINA 7×24 本地助理需要完整本机访问
- **逃逸检测**（immune 9-01）：`../` `~` `/etc/` `~/.ssh` 强制拦
- **凭据走 keychain**：API key / OAuth 都不写 `.env`
- **5 层免疫**：每条工具调用都过 5 层
- **emotion-isolation**：每 PR 必跑 9 断言

### 2.5 性能

- **P95 全局 < 200ms**（目标，余量 1500x）
- **异步批量 metrics 写**（30s flush）
- **SQLite WAL + NORMAL sync**
- **CATS-Net 滑动窗口**（最近 200 次 P95）

---

## 3. 按角色

### 3.1 终端用户

- [README.md](../README.md)
- [USER-GUIDE.md](./USER-GUIDE.md)
- [INSTALL.md](./INSTALL.md)
- [FAQ.md](./FAQ.md)
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

### 3.2 开发者

- [DEVELOPER.md](./DEVELOPER.md)
- [README.md §4 项目结构](../README.md#4-项目结构)
- ADR 文件夹
- 任务看板：`~/Desktop/项目工作台/任务看板-Gina.md`

### 3.3 gina-arch（架构师）

- 全部 ADR
- 8 大层 ADR-001 到 ADR-007
- 评审记录（待补）

### 3.4 gina-coder（编程）

- [DEVELOPER.md](./DEVELOPER.md)
- 仓代码
- 测试套件

### 3.5 gina-ui（UI）

- [DEVELOPER.md §9 开发环境](./DEVELOPER.md#9-开发环境)
- Scene Protocol v1 spec（`~/Desktop/gina迭代增强计划/05-设计文档/`）
- Monochrome HUD spec

### 3.6 gina-qa（质检）

- [DEVELOPER.md §4 跑测试](./DEVELOPER.md#4-跑测试)
- emotion-isolation 9/9 必跑
- 跨层一致性 20/20 必跑

### 3.7 gina-platform（SRE）

- ADR-016（CI/CD）
- ADR-017（监控）
- 部署文档（待补）

### 3.8 gina-immune（安全）

- 5 层免疫
- 沙箱配置
- 凭据管理

---

## 4. 按状态

### 4.1 已完成（2026-09-02）

✅ 6 阶段 PLAN-P6 100% 完工
✅ 8 大层 + CATS-Net + 5 层免疫
✅ CI/CD（3 仓 × 多平台）
✅ 监控（metrics / logger / alert / dashboard）
✅ 6 份外部文档（本仓库）

### 4.2 进行中

🔄 gina-arch 评审 ADR-016 / 017（等 token 恢复）
🔄 老板配 secrets（GitHub Settings）
🔄 老板配 dashboard 端口

### 4.3 待办（老板拍板后）

⏳ 移动端 app 上线（App Store / Google Play）— **UI 完工后**
⏳ GINA 官网搭建 — **UI 完工后**
⏳ 融资材料制作 — **UI 完工后**

### 4.4 未来路线图

⏳ C-2.7 阶段二（最早 9-08）
⏳ ADR-003 / 004 / 005 评审
⏳ 多租户升级（v3.0）

---

## 5. 维护者

| 角色 | 负责人 |
|---|---|
| 项目所有者 | Berry.Su（berry_su2023@foxmail.com）|
| 7 agent 团队 | gina-pm / gina-arch / gina-coder / gina-ui / gina-qa / gina-platform / gina-immune |
| 文档维护 | gina-platform worker |
| ADR 评审 | gina-arch |
| 拍板 | 老板（Berry.Su）|

---

## 6. 贡献

- 文档 Bug：[GitHub Issues](https://github.com/Berry-su/GINA/issues)
- 文档建议：[GitHub Discussions · Docs](https://github.com/Berry-su/GINA/discussions/categories/docs)
- 邮件：berry_su2023@foxmail.com

---

*INDEX 维护：gina-platform worker B 9-02 落地 · 文档目录索引 · 下次更新见 [GitHub Releases](https://github.com/Berry-su/GINA/releases)*
