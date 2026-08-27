---
name: bailongma-项目是-esm-项目-package
description: BaiLongMa 项目是 ESM 项目（package
version: 1.0.0
author: BaiLongma Agent
license: MIT
platforms: macos | linux
metadata:
  tags: [generated, reflection]
---

# bailongma-项目是-esm-项目-package

BaiLongMa 项目是 ESM 项目（package

## Prerequisites
- None

## 1. 操作步骤

BaiLongMa 项目是 ESM 项目（package.json type=module），但之前误判为 CommonJS 导致在 skill-generator.js 中混入 module.exports，引发 ReferenceError: module is not defined 崩溃。修复方法：第一，修改任何模块文件前必须先读 package.json 确认 type 字段；第二，ESM 项目中全部使用 import/export，禁止 require 和 module.exports；第三，入口文件 main.cjs 使用 .cjs 扩展名显式标记 CommonJS。
## Notes
- 自动生成自反思记录 ref-003，时间 2026-08-03T19:30:00+08:00