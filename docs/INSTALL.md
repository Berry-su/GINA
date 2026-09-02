# GINA 安装指南（INSTALL.md）

> 完整安装：macOS / Windows / Linux 实验 · 升级 · 卸载

**适用版本**：GINA v2.1.601+（2026-09-02）

---

## 0. 文档地图

| 我想... | 跳到 |
|---|---|
| macOS 装机（普通用户） | [§1 macOS](#1-macos) |
| macOS 源码（开发者） | [§2 从源码安装](#2-从源码安装) |
| Windows | [§3 Windows](#3-windows) |
| Linux 实验 | [§4 Linux 实验性支持](#4-linux-实验性支持) |
| 升级到最新 | [§5 升级](#5-升级) |
| 卸载 | [§6 卸载](#6-卸载) |
| 故障排查 | [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) |

---

## 1. macOS

### 1.1 前置

- **OS**：10.15+ (Catalina)，建议 13 Ventura+
- **架构**：arm64 (Apple Silicon) / x64 (Intel)
- **磁盘**：≥ 2 GB 可用
- **内存**：≥ 4 GB（建议 8 GB+）
- **首次安装需联网**

### 1.2 方式 A：下载 dmg（推荐普通用户）

1. 去 [Releases](https://github.com/Berry-su/GINA/releases) 下载最新 dmg：
   - Apple Silicon：`Gina-x.y.z-arm64.dmg`
   - Intel：`Gina-x.y.z.dmg`
2. 双击 dmg → 把 Gina 拖到 Applications
3. 首次启动：右键 → 打开（绕过 Gatekeeper）
4. 完成

### 1.3 方式 B：Homebrew（推荐开发者）

```bash
brew tap berry-su/tap
brew install --cask gina
```

或一行流：

```bash
brew install --cask berry-su/tap/gina
```

### 1.4 方式 C：从源码（推荐二次开发）

见 [§2 从源码安装](#2-从源码安装)。

### 1.5 首次启动

1. 启动 Gina（双击或 `open /Applications/Gina.app`）
2. 浏览器自动打开 `http://127.0.0.1:3721/activation`
3. 配 LLM provider（推荐 DeepSeek / OpenAI / Qwen）
4. 完事

---

## 2. 从源码安装

> 适合开发者 + 二次定制。macOS / Windows / Linux 通吃。

### 2.1 前置

- **Node.js**：≥ 18（建议 20 LTS）
- **pnpm**：≥ 9（建议 10.34.5）
- **git**：≥ 2.30
- **macOS**：Xcode CLI tools（`xcode-select --install`）
- **Windows**：Visual Studio Build Tools（含 C++ workload）+ Python 3
- **Linux**：build-essential + Python 3 + libnss3 + libatk1.0-0 + libgtk-3-0

### 2.2 拉代码

```bash
git clone https://github.com/Berry-su/GINA.git ~/Documents/BaiLongma-refactor-codebase
cd ~/Documents/BaiLongma-refactor-codebase
```

### 2.3 装依赖

```bash
pnpm install
```

如果 `better-sqlite3` / `electron` / `sharp` 等 native build 失败：

```bash
pnpm approve-builds
pnpm rebuild
```

### 2.4 装子仓（CATS-Net 内核）

主仓通过 `file:` 软链引 `@berrysu/gina-core`（CATS-Net 内核真理源）：

```bash
# 在 gina-cats-net 仓（同级目录）
cd ../gina-cats-net
pnpm install
pnpm test  # 验证内核 359 测试全过

# 回主仓
cd ../BaiLongma-refactor-codebase
ls node_modules/@berrysu/gina-core  # 应该是符号链接
```

### 2.5 启动

```bash
# 后端
pnpm start:backend

# 另开终端：桌面
pnpm start
```

### 2.6 跑测试（验证装对了）

```bash
pnpm test
```

应该看到 1000+ 测试全过（含 emotion-isolation 9/9）。

### 2.7 跑 dashboard（可选）

`pnpm start:backend` 后浏览器开 `http://127.0.0.1:3000/metrics`。

---

## 3. Windows

### 3.1 前置

- **OS**：Windows 10+（建议 Windows 11 22H2+）
- **架构**：x64（不支持 ARM）
- **磁盘**：≥ 2 GB
- **内存**：≥ 4 GB

### 3.2 装 Node + pnpm

```powershell
# 用 winget（Win 11 自带）
winget install OpenJS.NodeJS.LTS
winget install pnpm

# 或用 nvm-windows
nvm install 20
nvm use 20
npm install -g pnpm
```

### 3.3 装 Visual Studio Build Tools

下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选：

- "Desktop development with C++"
- "Windows 10/11 SDK"

### 3.4 拉代码 + 装依赖

```powershell
git clone https://github.com/Berry-su/GINA.git C:\Users\<you>\Documents\BaiLongma-refactor-codebase
cd C:\Users\<you>\Documents\BaiLongma-refactor-codebase
pnpm install
pnpm approve-builds
pnpm rebuild
```

### 3.5 启动

```powershell
# 后端（PowerShell）
$env:GINA_USER_DIR="$HOME\Documents\BaiLongma-refactor-codebase"
pnpm start:backend

# 另开 PowerShell：桌面
pnpm start
```

### 3.6 跑测试

```powershell
pnpm test
```

### 3.7 已知 Windows 限制

- **macOS 系统通知不可用**：alert 走 BurntToast PowerShell（需要 `Install-Module BurntToast`）
- **iOS / watch 端不适用**：P5 多设备仅 macOS 侧有效
- **路径分隔符**：`process.platform === 'win32'` 分支已处理

---

## 4. Linux 实验性支持

> 警告：Linux 支持是实验性的。生产用 macOS / Windows。

### 4.1 前置（Ubuntu 22.04+）

```bash
sudo apt update
sudo apt install -y \
  build-essential python3 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libgtk-3-0 libgbm1 libasound2 libxss1 libgconf-2-4 libxtst6 \
  xvfb libsecret-1-0
```

### 4.2 Node + pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g pnpm
```

### 4.3 拉代码 + 装

```bash
git clone https://github.com/Berry-su/GINA.git ~/Documents/BaiLongma-refactor-codebase
cd ~/Documents/BaiLongma-refactor-codebase
pnpm install
pnpm approve-builds
pnpm rebuild
```

### 4.4 启动

```bash
pnpm start:backend
# 桌面（需要 X server / Xvfb）
pnpm start
```

### 4.5 已知 Linux 限制

- **系统通知**：`notify-send` 兜底（无 macOS osascript 弹窗体验）
- **键盘快捷键**：Electron 跨平台 OK
- **沙箱**：默认全开（macOS / Windows 同等安全等级）

---

## 5. 升级

### 5.1 dmg 装的升级

1. 退出 Gina（菜单栏 Gina → Quit）
2. 下载新 dmg
3. 双击覆盖 Applications 里的 Gina
4. 启动

数据保留在 `~/Documents/BaiLongma-refactor-codebase/data/`，**不会丢**。

### 5.2 brew 装的升级

```bash
brew upgrade --cask gina
```

### 5.3 源码升级

```bash
cd ~/Documents/BaiLongma-refactor-codebase
git pull origin main
pnpm install
pnpm approve-builds
pnpm rebuild
pnpm test  # 验证升级 OK
```

### 5.4 跨大版本升级

- v2.0 → v2.1：自动迁移（SQLite 兼容）
- v1.x → v2.0：**需要卸载 + 重装**（数据库 schema 不兼容）

---

## 6. 卸载

### 6.1 dmg / brew 装

```bash
# brew
brew uninstall --cask gina

# 或手动
rm -rf /Applications/Gina.app
```

### 6.2 源码

```bash
# 退出 Gina
pkill -f "node.*src/index.js"

# 删代码
rm -rf ~/Documents/BaiLongma-refactor-codebase

# 删用户数据
rm -rf ~/.gina
rm -rf ~/Library/Application\ Support/Gina  # macOS
rm -rf ~/Library/Logs/Gina  # macOS
```

### 6.3 清干净（开发者）

```bash
# 删所有 node_modules
rm -rf ~/Documents/BaiLongma-refactor-codebase/node_modules

# 删 pnpm store
pnpm store prune
```

---

## 7. 安装后必读

- [USER-GUIDE.md](./USER-GUIDE.md)：5 分钟上手
- [FAQ.md](./FAQ.md)：12+ 常见问题
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)：故障排查
- [DEVELOPER.md](./DEVELOPER.md)：开发者贡献

---

*GINA v2.1.601+ · 安装文档 9-02 落地 · 维护：gina-platform worker B*
