# ADR-008+009: Phase 1 实时翻译 + VLM/OCR（2026-09-02）

## 状态
已采用 · 2026-09-02 完工

## 背景
PLAN-P6 第 1 阶段：补齐实时翻译（老板海外业务需要）+ VLM/OCR（GINA 当前只有文档解析没图像内容理解）。

## 决策
### ADR-008: 实时翻译
- 多语言支持（中英为核心，可扩）
- 实时：流式输出（不阻塞对话）
- 双向：老板说中文 → GINA 回复英文；老板说英文 → GINA 回复中文
- 质量：保留专业术语（金融/法律/工程）
- 速度：每句 < 200ms 延迟

### ADR-009: VLM/OCR
- VLM（Vision-Language Model）：图像内容理解
- OCR：图片内文字提取
- 集成到 conversation（老板发图 → GINA 理解）
- 支持格式：JPG/PNG/PDF/screenshot

## 实现
- `src/i18n/` 实时翻译模块
- `src/multimodal/` VLM/OCR 模块
- 23 测试全过

## 后果
### 正面
- 老板海外业务沟通无障碍
- 图像理解（不是只能 OCR 文字）
- 对接 Hugging Face + 多个 cloud VLM provider

### 负面
- 翻译质量依赖 LLM（不是专用翻译模型）
- VLM 算力成本高

## 关联
- ADR-007 PLAN-P6 路线图（第 1 阶段）

## 维护者
- @Berry.Su
- 评审：gina-coder
- commit: `6ca2aa3` (1798 行 + 23 测试)
- 最后更新：2026-09-07
