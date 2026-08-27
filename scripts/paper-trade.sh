#!/bin/bash
# Gina 全天模拟交易 —— launchd 定时任务脚本（每天 09:25 启动，覆盖 09:30 建仓 / 11:30 午间日志 / 15:00 结算）
# 全程纸面成交（模拟盘，本金 1 万起、每日滚动复利），不向券商发真单；正式下单需用户授权。
set -u
REPO="/Users/ahs/Documents/BaiLongma-refactor-codebase"
LOG="$REPO/data/paper-trade.log"
NODE_BIN="/Users/ahs/.nvm/versions/node/v20.20.2/bin"

# 周末不交易（周六=6/周日=7）；节假日暂由 09:00 盘前是否产出候选兜底
DOW="$(date +%u)"
if [ "$DOW" -ge 6 ]; then
  exit 0
fi

# launchd 的 PATH 极小，补齐 node
export PATH="$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO" || exit 1

STAMP="$(date '+%F %H:%M:%S %Z')"
{
  echo "================ $STAMP Gina 全天模拟交易 ================"
  "$NODE_BIN/node" scripts/afternoon-paper-trade.mjs --watch 2>&1
  echo ""
} >> "$LOG"

exit 0