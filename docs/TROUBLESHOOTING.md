# GINA 故障排查（TROUBLESHOOTING.md）

> 5 大类故障 + 解决方案。从常见到罕见排列。

**适用版本**：GINA v2.1.601+（2026-09-02）

---

## 0. 文档地图

| 故障类别 | 跳到 |
|---|---|
| 启动 / 激活 | [§1](#1-启动失败) |
| 对话 / 工具调用 | [§2](#2-对话失败) |
| 性能 / 资源 | [§3](#3-性能调优) |
| 沙箱 / 安全 | [§4](#4-沙箱与安全) |
| 网络 / 凭据 | [§5](#5-网络与凭据) |
| 监控 / 告警 | [§6](#6-监控与告警) |
| 罕见问题 | [§7](#7-罕见问题) |

---

## 1. 启动失败

### 1.1 双击图标无反应

**症状**：双击 Gina.app 无反应，无错误弹窗。

**排查**：

```bash
# 1. 看 macOS 控制台
log show --predicate 'process == "Gina"' --info --last 5m

# 2. 手动起（看具体错）
/Applications/Gina.app/Contents/MacOS/Gina
```

**常见原因 + 解法**：

| 原因 | 解法 |
|---|---|
| 端口 3721 占 | `lsof -iTCP:3721 -sTCP:LISTEN -P` 找占用的，杀掉 |
| 权限不够 | `chmod -R u+w ~/Documents/BaiLongma-refactor-codebase` |
| better-sqlite3 加载失败 | `pnpm rebuild better-sqlite3` |
| 主进程脚本权限 | `chmod +x /Applications/Gina.app/Contents/MacOS/Gina` |

### 1.2 启动后 5 秒闪退

**症状**：Gina 启动后立即退出，无错误弹窗。

**排查**：

```bash
# 1. SQLite 锁（最常见）
pkill -f "node.*src/index.js"
sleep 2
ls -la data/jarvis.db*  # 看有没有 -wal / -shm
rm -f data/jarvis.db-wal data/jarvis.db-shm

# 2. 看堆栈
node --inspect-brk src/index.js  # 调试器连上去
```

**常见原因**：

- **SQLite 锁**：99%。杀进程后启动。
- **磁盘满**：`df -h ~/Documents/BaiLongma-refactor-codebase`
- **Node 版本不匹配**：要 ≥ 18

### 1.3 激活页打不开

**症状**：浏览器开 `http://127.0.0.1:3721/activation` 显示"无法连接"。

**排查**：

```bash
# 1. 端口监听
lsof -iTCP:3721 -sTCP:LISTEN -P

# 2. 防火墙（macOS）
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
# 如果 firewall 开，临时关：
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off

# 3. 进程真起了吗
ps aux | grep "src/index.js" | grep -v grep
```

**解法**：

- 端口被占：杀掉占的进程
- 防火墙拦：放行 Gina
- 进程没起：看 `~/Library/Logs/Gina/` 找原因

### 1.4 "Cannot find module" 错误

**症状**：启动日志报 `Cannot find module '@berrysu/gina-core'`。

**排查**：

```bash
# 1. 软链是不是断了
ls -la node_modules/@berrysu/gina-core

# 2. 内核仓是不是齐
ls ../gina-cats-net/  # gina-cats-net 仓要在同级目录

# 3. 重装
pnpm install --force
```

**解法**：

- 软链断：`rm -rf node_modules/@berrysu && pnpm install`
- 内核仓缺：clone gina-cats-net 仓到同级目录

---

## 2. 对话失败

### 2.1 "Provider not configured"

**症状**：第一次对话报这个错。

**解法**：

1. 浏览器开 `http://127.0.0.1:3721/activation`
2. 配 LLM provider（DeepSeek / OpenAI / Qwen / ...）
3. 配 API key（走 macOS keychain）
4. 保存 + 重启 Gina

### 2.2 "All providers failed"

**症状**：配了 provider 但所有调用失败。

**排查**：

```bash
# 1. 测 provider 通不通
curl -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"hi"}]}'

# 2. 看 metrics dashboard 错误详情
open http://127.0.0.1:3000/metrics
```

**常见原因**：

- **API key 错**：从 provider 后台重置
- **余额不足**：充值
- **网络问题**：测 `curl <provider-url>` 能不能通
- **地区限制**：换 provider（如 OpenAI → DeepSeek）

### 2.3 工具调用失败

**症状**：GINA 说"无法执行" / 工具返回错误。

**排查**：

```bash
# 1. 看 audit 日志
ls ~/.gina/audit/
cat ~/.gina/audit/latest.jsonl  # JSON Lines

# 2. 看是 5 层免疫哪层拦
grep "BLOCKED_BY" ~/.gina/audit/latest.jsonl | tail -5
```

**5 层免疫拦截**：

| 拦截层 | 原因 | 解法 |
|---|---|---|
| 白名单 | 工具没注册 | 加到 `TOOL_SCHEMAS` |
| 已装注册 | 没装到 `capabilities/marketplace/` | 装或链接 |
| 运行时 AST | 代码被改 | 重新安装 |
| 重启自检 | 上次重启没通过 | 跑 `pnpm test` 验证 |
| 风控官审核 | 6 分析师之一否决 | 看 `audit/latest.jsonl` |

### 2.4 中文乱码

**症状**：GINA 输出乱码。

**解法**：

```bash
# macOS / Linux
export LANG=zh_CN.UTF-8
export LC_ALL=zh_CN.UTF-8

# Windows PowerShell
chcp 65001
$env:LANG="zh_CN.UTF-8"
```

---

## 3. 性能调优

### 3.1 启动慢

**症状**：Gina 启动 > 10s。

**排查**：

```bash
# 1. 看启动 metrics
sqlite3 data/metrics.db "SELECT * FROM startups ORDER BY ts DESC LIMIT 5"

# 2. 看哪个模块慢
sqlite3 data/metrics.db "SELECT module, p95_ms FROM module_stats ORDER BY p95_ms DESC LIMIT 10"
```

**常见原因 + 解法**：

| 原因 | 解法 |
|---|---|
| 知识数据太大 | 跑 `data/cleanup.sh` |
| CATS-Net 节点太多 | 删老节点（见 FAQ §4.4）|
| SQLite 没 VACUUM | `sqlite3 data/jarvis.db "VACUUM"` |
| 第一次启动（建索引） | 第二次启动会快很多 |

### 3.2 对话响应慢

**症状**：从输入到 GINA 回复 > 5s。

**排查**：

```bash
# 看 P95
sqlite3 data/metrics.db "SELECT module, p95_ms FROM module_stats ORDER BY p95_ms DESC LIMIT 10"
```

**优化路径**：

1. **P95 > 3s**：换 LLM provider
2. **P95 1-3s**：可能是 LLM 慢 + 工具调用累加
3. **P95 < 1s**：是 LLM 慢，换小模型 / 本地
4. **injector P95 高**：调小 `MEMORY_LIMIT` 或 `TOOL_LIMIT`（`src/config.js`）

### 3.3 内存 > 4 GB

**症状**：Gina 内存持续增长，最终 > 4 GB。

**排查**：

```bash
# 看 heap
node --expose-gc -e "
  setInterval(() => {
    if (global.gc) global.gc()
    const m = process.memoryUsage()
    console.log(JSON.stringify(m))
  }, 5000)
"
```

**优化**：

```bash
# 1. 清老 memory
sqlite3 data/jarvis.db "DELETE FROM conversations WHERE ts < strftime('%s','now','-30 day') * 1000"
sqlite3 data/jarvis.db "DELETE FROM cats_net_nodes WHERE last_active < strftime('%s','now','-90 day') * 1000"
sqlite3 data/jarvis.db "VACUUM"

# 2. 调小上下文
# src/config.js
CONTEXT_MESSAGE_LIMIT_MAX: 40 → 20
CONTEXT_TOOL_LIMIT: 5 → 3
```

### 3.4 磁盘占太多

**症状**：`data/` > 1 GB。

**排查**：

```bash
du -sh data/*  # 看每个子目录多大
```

**清理**：

```bash
# 老日志（30 天前）
find data/logs/ -mtime +30 -delete

# 老 memory
sqlite3 data/jarvis.db "DELETE FROM conversations WHERE ts < strftime('%s','now','-60 day') * 1000"

# 老 CATS-Net
sqlite3 data/jarvis.db "DELETE FROM cats_net_nodes WHERE last_active < strftime('%s','now','-90 day') * 1000"

# VACUUM
sqlite3 data/jarvis.db "VACUUM"
```

---

## 4. 沙箱与安全

### 4.1 沙箱默认是关的吗？

**答**：**是老板故意打开的**（不是 bug）。

- `config.security.fileSandbox / execSandbox / browserPrivateNetwork` 默认 false
- 原因：GINA 是 7×24 本地智能助理，需要完整访问本机
- **2026-09-01 老板拍板**：维持现状（不拦）
- 9-01 immune 加的"逃逸检测"（不依赖沙箱开关，强制拦 `../` `~` `/etc/` `~/.ssh`）保留

### 4.2 read_file / exec_command 怎么拦恶意路径？

**逃逸检测**（即便沙箱关也拦）：

- `../` `..\` 父目录访问
- `~` 用户主目录
- `/etc/` `/var/` `/usr/` `/bin/` `/sbin/`
- `~/.ssh/` `~/.aws/` `~/.gnupg/`

如果想加更严格的沙箱，参考 [ADR-001 §3.2](https://github.com/Berry-su/GINA/blob/main/docs/)。

### 4.3 5 层免疫拦了某个工具

**解法**：

1. 看 `~/.gina/audit/latest.jsonl` 找具体层
2. 临时绕过（不推荐）：编辑 `src/immune/layer-N.js` 加白名单
3. 永久解：改 ADR 拍板后修改

### 4.4 风控官频繁否决

**症状**：6 分析师之一频繁 veto，工具调用成功率 < 80%。

**解法**：

```bash
# 看哪个分析师否决最多
sqlite3 data/jarvis.db "SELECT analyst, COUNT(*) FROM risk_veto_log GROUP BY analyst"

# 调权重（src/analysts/team.js）
# 或调整否决阈值
```

---

## 5. 网络与凭据

### 5.1 "keychain 拒绝访问"

**症状**：GINA 读 API key 时报 `OSStatus error -25291` 或类似。

**解法**：

1. 系统设置 → 隐私与安全 → 钥匙串
2. 找到 Gina（或 gina 进程）→ 选"始终允许"
3. 重启 Gina

### 5.2 OAuth 弹窗没出来

**症状**：第一次接 Gmail / Notion 等，OAuth 弹窗没出来。

**解法**：

```bash
# 1. 看日志
cat ~/Library/Logs/Gina/oauth.log

# 2. 手动开 OAuth URL
# 通常是 http://127.0.0.1:3721/oauth/<provider>/start
open http://127.0.0.1:3721/oauth/gmail/start
```

### 5.3 SSL / HTTPS 警告

**症状**：浏览器弹"您的连接不是私密连接"。

**原因**：GINA 默认 HTTP。**这是预期的**——本地服务，不上 TLS。

如果想加 TLS（LAN 部署）：

```bash
export GINA_TLS_CERT="$(cat /path/to/cert.pem)"
export GINA_TLS_KEY="$(cat /path/to/key.pem)"
```

**不要**在生产环境用自签证书，会被浏览器拒。

### 5.4 LAN 访问不通

**症状**：手机 / 平板访问 `http://<gina-host>:3721` 不通。

**排查**：

```bash
# 1. macOS 防火墙
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /Applications/Gina.app/Contents/MacOS/Gina
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblock /Applications/Gina.app/Contents/MacOS/Gina

# 2. LAN token
curl http://<gina-host>:3721/ping  # 看能不能通
curl -H "X-LAN-Token: <token>" http://<gina-host>:3721/api/status

# 3. 路由器隔离（家用 WiFi）
# 部分家用路由器会隔离客户端——关 AP isolation
```

---

## 6. 监控与告警

### 6.1 dashboard 打不开

**症状**：浏览器开 `http://127.0.0.1:3000/metrics` 显示"无法连接"。

**排查**：

```bash
# 1. 端口
lsof -iTCP:3000 -sTCP:LISTEN -P

# 2. 进程
ps aux | grep "dashboard" | grep -v grep

# 3. 日志
grep "monitoring" ~/Library/Logs/Gina/gina-$(date +%Y-%m-%d).jsonl | head -20
```

**解法**：

- **dashboard 没启动**：`GINA_DASHBOARD_DISABLED=0 pnpm start`（默认就是开）
- **端口被占**：换端口 `GINA_DASHBOARD_PORT=3001 pnpm start`
- **dashboard 启动失败**：`src/monitoring/dashboard.js` 报错，看 `audit/`

### 6.2 告警一直弹

**症状**：macOS 通知中心一直弹 GINA Alert。

**解法**：

```bash
# 1. 临时关：拒收 GINA 通知
# 系统设置 → 通知 → Gina → 关

# 2. 改阈值（src/monitoring/alert.js）
# DEFAULT_THRESHOLDS.error_rate = 0.05 → 0.10
# DEFAULT_THRESHOLDS.p95_ms = 1000 → 3000

# 3. cooldown 已经 5 分钟了，5 分钟内不重复
# 如果 5 分钟后还弹：cooldown 逻辑坏了，看 src/monitoring/alert.js:_shouldNotify
```

### 6.3 监控数据太大

**症状**：`data/metrics.db` > 1 GB，`data/logs/` > 500 MB。

**解法**：

```bash
# 1. 清 metrics 老数据
sqlite3 data/metrics.db "DELETE FROM module_calls WHERE ts < strftime('%s','now','-30 day') * 1000"
sqlite3 data/metrics.db "VACUUM"

# 2. 清老日志（应该 30 天轮转自动清，但有时漏了）
find data/logs/ -mtime +30 -delete

# 3. 调小日志保留（src/monitoring/logger.js）
# LOG_RETENTION_DAYS: 30 → 7
```

### 6.4 监控数据显示乱

**症状**：dashboard 上数据明显错（启动次数 -1 / 错误率 > 1 / ...）。

**解法**：

```bash
# 1. 重建 stats（强制 refresh）
sqlite3 data/metrics.db "DELETE FROM module_stats"
# 重启 GINA，会自动重算

# 2. 如果还不 OK，删 metrics.db 重来
rm data/metrics.db
# 重启 GINA
```

---

## 7. 罕见问题

### 7.1 Electron 启动后白屏

**症状**：Electron 窗口打开但完全白。

**排查**：

```bash
# 1. Electron 进程在不在
ps aux | grep "Gina Helper" | grep -v grep

# 2. 渲染进程日志
# macOS: ~/Library/Logs/Gina/renderer.log
# Windows: %APPDATA%\Gina\logs\renderer.log
```

**解法**：

- **GPU 加速问题**：加 `--disable-gpu` 启动参数
- **资源加载失败**：清 `~/Library/Application Support/Gina/Cache/`

### 7.2 数据库 schema 不兼容

**症状**：升级后启动报 `SQLITE_ERROR: no such column: ...`。

**原因**：跨大版本升级（v1.x → v2.x）。

**解法**：

```bash
# 1. 备份
cp data/jarvis.db data/jarvis.db.bak

# 2. 跑 migration
pnpm run migrate

# 3. 不行就清
rm data/jarvis.db
# 重新初始化
```

### 7.3 P95 异常飙升

**症状**：dashboard 上某模块 P95 从 100ms 突然变 5000ms+。

**排查**：

```bash
# 看 P95 飙升是哪个时间点
sqlite3 data/metrics.db "SELECT * FROM module_stats WHERE module = '<module>' ORDER BY updated_at DESC LIMIT 20"
```

**常见原因**：

- **LLM provider 慢**：临时切到其他 provider
- **大文件处理**：P6 视频理解阶段
- **某个工具在等网络**：看 audit/ 找卡点

### 7.4 完全不知道哪里错

**终极方案**：

```bash
# 1. 开 debug 日志
export GINA_LOG_LEVEL=debug
pnpm start:backend 2>&1 | tee /tmp/gina-debug.log

# 2. 复现问题

# 3. 看完整日志
cat /tmp/gina-debug.log | grep -i error
```

如果还是没线索：

1. [GitHub Issues](https://github.com/Berry-su/GINA/issues) 报 Bug
2. 附上：版本 / 操作系统 / 复现步骤 / 完整日志 / `pnpm test` 输出
3. 等回复

---

*故障排查 维护：gina-platform worker B 9-02 落地 · 30+ 场景 · 下次更新见 [GitHub Releases](https://github.com/Berry-su/GINA/releases)*
