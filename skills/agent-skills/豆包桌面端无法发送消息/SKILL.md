---
name: 豆包桌面端无法发送消息
description: 豆包桌面端无法发送消息
version: 1.0.0
author: BaiLongma Agent
license: MIT
platforms: macos | linux
metadata:
  tags: [generated, reflection]
---

# 豆包桌面端无法发送消息

豆包桌面端无法发送消息

## Prerequisites
- None

## 1. 操作步骤

豆包桌面端无法发送消息。排查发现系统代理（HTTP/HTTPS）指向 127.0.0.1:7897，但 Clash Verge 进程未运行，端口无监听。修复方法：用 networksetup 关掉系统代理，让豆包直连。后续记住了这个故障模式以便快速诊断。
## Notes
- 自动生成自反思记录 ref-001，时间 2026-08-03T19:00:00+08:00