---
name: 豆包桌面端故障排查
description: 诊断并修复豆包桌面端无法发送消息的故障
version: 1.0.0
author: BaiLongma Agent
license: MIT
platforms: macos | linux
metadata:
  tags: [macos, troubleshooting, proxy, doubao]
---

# 豆包桌面端故障排查

诊断并修复豆包桌面端无法发送消息的故障

## Prerequisites
- None

## 1. 检查豆包进程

```bash
ps aux | grep doubao
```

## 2. 如无进程则启动

```bash
open -a Doubao
```

## 3. 检查系统代理状态

```bash
scutil --proxy
```

## 4. 关闭代理或启动 Clash Verge

```bash
networksetup -setwebproxystate "Wi-Fi" off && networksetup -setsecurewebproxystate "Wi-Fi" off
```
