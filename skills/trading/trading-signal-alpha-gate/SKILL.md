---
name: trading-signal-alpha-gate
description: 下单前用真实历史数据验证信号前瞻收益（alpha 门），无正向超额不放大仓位
version: 1.0.0
author: BaiLongma Agent
license: MIT
platforms: macos | linux
metadata:
  tags: [trading, alpha, risk-control]
---

# trading-signal-alpha-gate

下单前用真实历史数据验证信号前瞻收益（alpha 门），无正向超额不放大仓位

## Prerequisites
- 分析师团队已激活
- 风控官可一票否决

## 1. 触发条件

买入信号事后前瞻 5 日超额 = N/A；仅当显著为正且样本充足时才视为有效 alpha
## 2. 执行动作

用 node scripts/backtest-astock.mjs 回测；信号无正向 alpha 时保持观望/低仓，只有 alpha 验证通过才提高买入频率
## Notes
- 来源回测：真实数据 000001.SH 20200101~20231231 [Tushare]
- 代价：避免把噪声当信号、避免追高被套