# ADR-004: 知识 ingestion 选完整 pipeline（2026-08-31）

## 状态
已采用 · 2026-08-31 老板拍板

## 背景
GINA 要"学会老板喂的所有知识"。老板喂的资料（PDF/EPUB/MD）怎么进 CATS-Net？3 个候选：
- (a) 简单存原文（CATS-Net 节点 = 文件路径 + 摘要）
- (b) 完整 pipeline（解析 → 拆分 → 蒸馏 → 知识图谱化 → CATS-Net 节点化）
- (c) LLM 一次性消化（不做结构化）

## 决策
**选 (b) 完整 pipeline**——PDF/EPUB/MD → 解析 → 章节拆分 → 蒸馏 → 知识图谱化 → CATS-Net 节点化。

### 理由
- (a) 太浅，老板喂的书籍不能被有效检索
- (c) 无法回溯，LLM 一次性消化丢失结构
- (b) 是唯一支持"知识图谱 + 多跳推理 + 时序激活"的方案

## 后果
### 正面
- `src/knowledge/` 落地（knowledge-distiller.js 58KB 最大模块）
- 老板的书 / 报告 / 文档能完整入库
- 知识图谱化让 CATS-Net 多跳查询可行

### 负面
- 实施工作量大
- 对 PDF/EPUB 解析质量有依赖
- 蒸馏质量依赖 LLM

## 关联
- ADR-001 CATS-Net：ingestion 喂入的节点是 CATS-Net 的一部分
- ADR-002 meta-info 隔离：ingestion 不读情绪

## 维护者
- @Berry.Su
- 评审：gina-arch
- 最后更新：2026-09-07
