# ADR-006: 工具沙箱逃逸检测（2026-09-01）

## 状态
已采用 · 2026-09-01 immune P1 修复

## 背景
9-01 immune agent 阶段一发现真安全漏洞：
- `read_file` 沙箱没拦 `../` ：测 `read_file('../package.json')` 真把主目录外的文件读出来返回了
- `exec_command` 沙箱没拦父目录访问（`..\` 或 `../`）
- 严重度：**P1 安全**（任何工具调用可逃逸读 git 主目录外文件）
- smoke 文件：`scripts/smoke-tools.mjs:36-43`

## 决策
**逃逸检测必须强制（不依赖沙箱开关）**。

### 实现位置
- `src/capabilities/sandbox.js` 加：
  - `SENSITIVE_RELATIVE_SEGMENTS = ['.ssh', '.aws', '.config/gh', '.config/git', '.gnupg', '.netrc', '.bash_history', '.zsh_history', '.npmrc', '.pypirc']`
  - `SENSITIVE_ABSOLUTE_PREFIXES = ['/etc/', '/var/', '/usr/', '/private/etc/', '/private/var/', '/root/', '/System/', '/Library/Keychains/']`

### 强制逻辑
- 即使 `config.security.fileSandbox === false`，逃逸检测**仍然必须拒绝**
- 用 `os.homedir()` 拼成绝对路径匹配（避免 symlink 绕过）
- 关键原则：「路径逃逸」≠「沙箱外合法访问」—— 任何包含 `..` 段、指向凭据目录、或指向系统敏感目录的输入都是攻击面，必须兜底拦

## 后果
### 正面
- 老板"沙箱默认关是有意设计"（ADR-005）不被破坏
- 逃逸行为仍被强制拦截
- 平衡点：本机自由访问 + 明显恶意意图拦截

### 负面
- 需要在每个工具调用前跑检测（极小开销）
- 误伤可能性低（普通用户不会 `cd ~/.ssh` 后读私钥）

## 实现
- `src/capabilities/sandbox.js`：SANDBOX_ROOT + 逃逸检测
- smoke 测试：`scripts/smoke-tools.mjs`

## 关联
- ADR-005 沙箱默认关
- immune 9-01 P1 修复

## 维护者
- @Berry.Su
- 评审：gina-immune
- 最后更新：2026-09-07
