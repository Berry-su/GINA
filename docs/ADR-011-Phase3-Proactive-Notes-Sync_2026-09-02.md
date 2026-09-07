# ADR-011: Phase 3 主动 + 笔记同步（2026-09-02）

## 状态
已采用 · 2026-09-02 完工

## 背景
PLAN-P6 第 3 阶段：GINA 主动感知（基于 proactive-perception.js 5 大感知维度）+ 第三方笔记同步（Notion / Obsidian）。

## 决策
2 个能力一起做：
- **主动感知增强**：环境信号 → 主动任务
- **笔记同步**：GINA 笔记 ↔ Notion / Obsidian 双向

### 主动感知硬约束
- 默认**不主动发消息**，只 emit 事件
- 老板说"别打扰"→ 降级到只 log
- 预判错时不重复同类型（去重 + 冷却）

## 实现
- `src/memory/proactive-perception.js`（661 行）
- `src/memory/auto-planner.js`（721 行）
- 笔记同步模块
- 多个 commit 推 origin

## 后果
### 正面
- 主动但不打扰
- 笔记跨平台可用
- 老板隐私（本地 Obsidian 优先）

### 负面
- 第三方 API 凭证管理复杂

## 关联
- ADR-007 PLAN-P6（第 3 阶段）
- ADR-002 情绪不接决策路径

## 维护者
- @Berry.Su
- 评审：gina-coder
- commit: `95f939d`
- 最后更新：2026-09-07
