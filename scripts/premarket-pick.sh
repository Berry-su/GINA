#!/bin/bash
# Gina 盘前 pick —— launchd 定时任务脚本（每天 09:00 自动跑）
# 跑完整盘前选股 → 落到日志 → 弹 macOS 通知「今日最该打」。
set -u
REPO="/Users/ahs/Documents/BaiLongma-refactor-codebase"
LOG="$REPO/data/premarket-pick.log"
NODE_BIN="/Users/ahs/.nvm/versions/node/v20.20.2/bin"

# launchd 的 PATH 极小，这里补齐 node/python
export PATH="$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO" || exit 1

STAMP="$(date '+%F %H:%M:%S %Z')"

# 跑完整周期：收信息(6源) → 题材选时 → 高弹性小票 → 行情打分 → 下单(mock)
OUT="$("$NODE_BIN/node" scripts/start-trading.mjs --once 2>&1)"
{
  echo "================ $STAMP Gina 盘前 pick ================"
  echo "$OUT"
  echo ""
} >> "$LOG"

# 取「今日最该打」用于系统通知
TOP="$(printf '%s\n' "$OUT" | grep '今日最该打' | tail -n 1)"
if [ -z "$TOP" ]; then
  TOP="Gina 盘前 pick 已出，详见 $LOG"
fi
/usr/bin/osascript -e "display notification \"$TOP\" with title \"Gina 盘前 pick\"" >/dev/null 2>&1 || true

# 兜底：直接打开结果文件到屏幕（不依赖通知权限/勿扰模式，保证能看到）
/usr/bin/open -a TextEdit "$LOG" >/dev/null 2>&1 || /usr/bin/open "$LOG" >/dev/null 2>&1 || true

exit 0