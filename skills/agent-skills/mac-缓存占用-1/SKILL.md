---
name: mac-缓存占用-1
description: Mac 缓存占用 1
version: 1.0.0
author: BaiLongma Agent
license: MIT
platforms: macos | linux
metadata:
  tags: [generated, reflection]
---

# mac-缓存占用-1

Mac 缓存占用 1

## Prerequisites
- None

## 1. 操作步骤

Mac 缓存占用 1.3G，用户要求设置自动清理。第一，编写清理脚本 cache-clean.sh 放到 ~/.local/bin/；第二，清理目录包括 ~/Library/Caches/ms-playwright、node-gyp、pip、typescript 以及 ~/.npm/_cacache；第三，编写 launchd plist 放到 ~/Library/LaunchAgents/；第四，设置 StartCalendarInterval 为每天 3:00 和 15:00；第五，launchctl bootstrap 加载任务。
## Notes
- 自动生成自反思记录 ref-002，时间 2026-08-03T19:15:00+08:00