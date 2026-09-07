# ADR-012: Phase 4 IoT 智能家居（2026-09-02）

## 状态
已采用 · 2026-09-02 完工

## 背景
PLAN-P6 第 4 阶段：GINA 接入智能家居 IoT（HomeKit / 米家 / 其他平台）。

## 决策
- 优先 HomeKit（macOS 原生）
- 备选米家（云端 API）
- 控制走本地 sandbox（避免云端中断影响）
- 状态查询走云端（最新数据）

### 集成策略
- `src/iot/` 模块
- 复用 proactive-perception 主动任务
- 不主动开灯/关门（必须老板显式命令）

## 实现
- `src/iot/` IoT 模块
- `src/capabilities/tools/iot.js` tool 实现
- commit `756aabb`（IoT，已推）

## 后果
### 正面
- 老板能语音/对话控制灯 / 空调 / 锁
- 主动提醒（"窗户没关 + 天气预报雨"）

### 负面
- 多个 IoT 平台维护成本
- 安全风险（必须显式确认）

## 关联
- ADR-007 PLAN-P6（第 4 阶段）
- ADR-005 沙箱默认关

## 维护者
- @Berry.Su
- 评审：gina-coder
- commit: `756aabb`
- 最后更新：2026-09-07
