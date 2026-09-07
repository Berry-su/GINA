# ADR-015: GINA 自进化 5 项关键能力（2026-09-07）

## 状态
**已采用 + 100% 完工** · 2026-09-07 老板拍板 + 全部 commit

## 背景
9-07 02:01 老板明确拍板：**GINA 真实自进化必须包含 5 项**。老板原话："只有加上这几个，gina 的自进化才真的真的自进化"。

## 决策
5 项关键能力（按依赖顺序）：

1. **A/B 测试框架** — 验证新旧版本
2. **代码自修改** — GINA 改自己源码
3. **元学习** — GINA 学"怎么学得更好"（learning to learn）
4. **工具自创建** — GINA 生成新工具/能力
5. **架构自进化** — GINA 重构 8 大层 / CATS-Net 拓扑

## 实现（5 commit 链：444f65f → c1d623b → 860fecb）

### 1. A/B 测试框架（`src/experiments/` 5 文件）
- Welch's t-test + 95% CI + SHA-256 稳定分流 + forced variant
- SQLite 3 表 (experiments/assignments/metrics)
- **38/38 测试**

### 2. 代码自修改框架（`src/self-modify/` 5 文件）
- analyzer 找低效段（size/complexity/missing-tests）
- editor unified diff + backup + syntax check + test + 自动回滚
- safety-checker 3 道门
- **49/49 测试**

### 3. 元学习（`src/meta-learning/` 6 文件）
- bandit.js UCB1 策略选择
- reflection.js 自适应深度 1-3 层
- trigger.js 主动/被动 90/10
- planner.js 单步/多步 70/30
- meta-controller.js 编排器
- **38/38 测试**

### 4. 工具自创建补强（`src/tool-self-create/` 6 文件）
- tool-spec.js ToolSpec 数据结构
- tool-validator.js 3 道门（schema + 危险 API + 资源限制）
- tool-registry.js 版本化 + 灰度（1%→100%）
- tool-generator.js LLM 注入
- tool-evolution.js 元学习驱动
- **45/45 测试**

### 5. 架构自进化（`src/arch-evolution/` 6 文件）
- arch-graph.js 依赖图
- arch-metrics.js 健康指标
- arch-analyzer.js 找问题
- arch-rewriter.js 执行安全改动
- arch-controller.js 编排器
- **29/29 测试**

**总计：199/199 自进化测试 + npm test 8/8**

## 闭环
```
失败 → reflection → bandit 更新 → A/B 验证 → 选 best → code-modify → 验证 → 反思 → meta 升级
                                                                       ↓
                                                              tool-self-create (新工具)
                                                                       ↓
                                                              arch-evolution (架构审计)
```

## 后果
### 正面
- 2026-09-07 自进化 5 项 100% 完工（commit 链 444f65f → c1d623b → 860fecb）
- 闭环：失败→reflection→bandit→A/B→code-modify→验证→meta 升级
- 老板翻身唯一机会（9-07 01:46 拍板）核心支撑

### 负面
- 5 项全套 = ~6000 行新代码
- 5 commit 全部 push 网络遇到 GitHub HTTPS 端口 443 间歇性超时

## 关联
- ADR-001 CATS-Net 大脑架构（5 项是大脑的"自升级"能力）
- ADR-002 情绪不接决策路径（验证 5 项都不读情绪）
- ADR-007 PLAN-P6（5 项是 6 阶段完工后的下一步深化）

## 维护者
- @Berry.Su
- 评审：gina-arch
- 最后更新：2026-09-07
