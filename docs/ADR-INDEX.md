# ADR 索引（Architecture Decision Records）

按时间倒序记录 GINA 项目的关键架构决策。每个 ADR 包含：状态、背景、决策、后果、关联。

## 2026-09-07 · 自进化
- [ADR-015: GINA 自进化 5 项关键能力](ADR-015-Self-Evolution-5-Capabilities_2026-09-07.md) — A/B + 代码自修改 + 元学习 + 工具自创建 + 架构自进化 (199/199 测试 100% 完工)
- [ADR-002: 情绪是 meta-info，不进决策路径](ADR-002-Emotion-Is-MetaInfo_2026-08-31.md) — 9-07 推翻"只 joy 一个"，升级 5 维但仍严守 meta-info 隔离 (24/24 测试)

## 2026-09-02 · PLAN-P6 6 阶段
- [ADR-007: PLAN-P6 6 阶段全差距补齐](ADR-007-PLAN-P6-6-Phase-Reality-Connection_2026-09-02.md) — 大脑完整后现实连接优先（推翻 ADR-001 默认排序）
- [ADR-008+009: Phase 1 实时翻译 + VLM/OCR](ADR-008-009-Phase1-Translation-VLM-OCR_2026-09-02.md) — 翻译 + 图像理解
- [ADR-010: Phase 2 日历 + 邮件 + 任务](ADR-010-Phase2-Calendar-Mail-Tasks_2026-09-02.md) — 3 connector 一起做
- [ADR-011: Phase 3 主动 + 笔记同步](ADR-011-Phase3-Proactive-Notes-Sync_2026-09-02.md) — proactive-perception + Notion/Obsidian
- [ADR-012: Phase 4 IoT 智能家居](ADR-012-Phase4-IoT-Smart-Home_2026-09-02.md) — HomeKit + 米家
- [ADR-013: Phase 6 视频理解](ADR-013-Phase6-Video-Understanding_2026-09-02.md) — 视频元数据 + 关键帧 + 字幕
- [ADR-014: Phase 5 多设备](ADR-014-Phase5-Multi-Device_2026-09-02.md) — iOS/Android/watch/Wear OS

## 2026-09-01 · 大脑 + 安全
- [ADR-001: CATS-Net + 大脑架构战略](ADR-001-CATS-Net-Brain-Architecture_2026-09-01.md) — 9-01 最高优先级：先完整大脑
- [ADR-005: 沙箱默认关闭 = 老板有意设计](ADR-005-Sandbox-Default-Off_2026-09-01.md) — 推翻 immune 风险定性，本机自由 + 逃逸拦截
- [ADR-006: 工具沙箱逃逸检测](ADR-006-Tool-Sandbox-Escape-Detection_2026-09-01.md) — 强制拦 `../` `~` `/etc/` `~/.ssh`

## 2026-08-31 · 早期
- [ADR-003: 方向控制器 - 对话触发](ADR-003-Direction-Controller-Conversation-Trigger_2026-08-31.md) — 选 (c) 对话触发
- [ADR-004: 知识 ingestion 选完整 pipeline](ADR-004-Knowledge-Ingestion-Full-Pipeline_2026-08-31.md) — PDF/EPUB → 解析 → 拆分 → 蒸馏 → 知识图谱

## CI/CD + 监控
- [ADR-016: CI/CD Pipeline](ADR-016-CICD-Pipeline_2026-09-02.md) — ci.yml + build-mac + build-win
- ADR-017: 监控 + 外部文档 (commit `2a3a16f`)

## ADR 模板

```markdown
# ADR-XXX: 标题（YYYY-MM-DD）

## 状态
已采用 / 已采用 + 更新 / 已废弃 · 拍板人

## 背景
决策前的现状和矛盾

## 决策
具体拍板内容

## 后果
### 正面
### 负面

## 实现
关键文件 + 行数

## 关联
其他 ADR 链接

## 维护者
- @author
- 评审：gina-agent
- 最后更新：YYYY-MM-DD
```

## 维护
- 新增 ADR：复制模板，命名 `ADR-XXX-Topic_YYYY-MM-DD.md`
- 推翻 / 改判：直接编辑原文 + 在"状态"加更新说明
- 评审：所有新 ADR 必须过 gina-arch
