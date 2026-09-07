# ADR-014: Phase 5 多设备（2026-09-02）

## 状态
已采用 · 2026-09-02 完工

## 背景
PLAN-P6 第 5 阶段：GINA 老板多设备覆盖（iOS / Android / watch / Wear OS）。

## 决策
- iOS 优先（抢救版本）
- Apple Watch 跟 iOS 同步
- Android 起步（与 iOS 并行）
- Wear OS 支持基础通知

### 设备策略
- 数据同步：iCloud / Google Drive 双轨
- 推送：APNs / FCM 双轨
- 离线：本地优先 + 冲突合并

## 实现
- `gina-ui` 独立仓（9-02 23:19 老板拍板）
- 多个 commit（5d804cb iOS 抢救 + 28765f4 watch+iOS+Android+Wear OS）
- 110 文件 + 57 测试

## 后果
### 正面
- 老板出门能语音问 GINA
- 关键提醒不漏

### 负面
- 多端维护成本
- 苹果审核风险（移动端 app 上线推迟到 UI 完工后）

## 关联
- ADR-007 PLAN-P6（第 5 阶段）
- 9-02 23:19 排期：移动端 app 上线推迟到 UI 完工后

## 维护者
- @Berry.Su
- 评审：gina-coder / gina-platform
- commit: `5d804cb` + `28765f4`
- 最后更新：2026-09-07
