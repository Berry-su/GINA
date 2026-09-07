# ADR-005: 沙箱默认关闭 = 老板有意设计（2026-09-01）

## 状态
**已采用 + 9-01 immune 关键事实纠错** · 2026-09-01 老板拍板

## 背景
GINA 是 7×24 本地智能助理。9-01 immune agent 报告"沙箱默认关 = 严重安全风险"，老板立刻纠正：这是有意设计，不是 bug。

## 决策
`config.security.fileSandbox / execSandbox / browserPrivateNetwork` 默认 `false` = **老板故意打开**，不是 bug。

### 理由
- GINA 需要完整访问本机：读 `~/Documents/BaiLongma-refactor-codebase/`、写文件、跑命令、查天气 / 行情
- GINA 是用户的 7×24 智能助理，**本机自由访问是核心能力**
- 沙箱全开 = 削弱核心能力，不值得

### 平衡点
- 沙箱边界本身（a/b/c 选项）等老板拍板 → **答案就是 (a) 维持现状**
- immune 9-01 加的"逃逸检测"（不依赖沙箱开关，强制拦 `../` `~` `/etc/` `~/.ssh`）是**合理的额外保护**——保留
- 这是个**平衡点**：本机自由访问 + 明显恶意意图拦截

## 后果
### 正面
- GINA 有完整本机访问能力
- 老板不需为每次本地操作授权

### 负面
- 9-01 发现的 `read_file('../package.json')` 沙箱逃逸**已在 escape detection 中拦截**
- `exec_command` 父目录访问**已在 escape detection 中拦截**
- 任何工具调用都必须经过 escape detection（这是 9-01 immune 加的安全层）

## 实现
- `src/capabilities/sandbox.js`：SENSITIVE_RELATIVE_SEGMENTS + SENSITIVE_ABSOLUTE_PREFIXES 逃逸检测
- `config.security.*` 默认值

## 关联
- ADR-006 工具沙箱真漏洞修复（immune 9-01）
- 推翻：9-01 immune 的"严重安全风险"定性

## 维护者
- @Berry.Su
- 评审：gina-immune
- 最后更新：2026-09-07
