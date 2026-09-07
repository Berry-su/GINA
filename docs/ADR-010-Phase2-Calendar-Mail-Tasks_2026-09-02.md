# ADR-010: Phase 2 日历 + 邮件 + 任务（2026-09-02）

## 状态
已采用 · 2026-09-02 完工

## 背景
PLAN-P6 第 2 阶段：GINA 之前没有日历 / 邮件 / 任务的 API 集成（googleapis / ical / imap / nodemailer / todoist 依赖 0）。

## 决策
3 个 connector 一起做：
- **日历**：Google Calendar + iCal（本地 .ics）
- **邮件**：IMAP 收 + SMTP 发（OAuth 走 macOS keychain）
- **任务**：Todoist API

### 接入原则（老板 9-02 凭证措辞教训）
- 绝不说"老板给我密码"
- 所有凭证走 macOS keychain + OAuth 弹窗 + App 专用密码
- .env 只存非敏感 endpoint 配置

## 实现
- `src/connectors/` 日历 / 邮件 / 任务 3 个模块
- 15 测试全过
- 2681 行代码

## 后果
### 正面
- 老板日历能看 / 能加 / 能改
- 邮件能发能收
- 任务管理接入 Todoist

### 负面
- 首次接入需要老板走 OAuth（一次性）

## 关联
- ADR-005 沙箱默认关
- 9-02 凭证措辞教训（绝对不能要求明文密码）

## 维护者
- @Berry.Su
- 评审：gina-coder
- commit: `5aec015`
- 最后更新：2026-09-07
