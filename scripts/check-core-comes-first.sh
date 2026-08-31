#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# check-core-comes-first.sh —— 主仓 commit 顺序检查（轻量版）
#
# 规则（ADR-20260831-CATS-NET-软分层方案 §4.2）：
#   主仓代码引用 @berrysu/gina-core/* 时,对应的 gina-cats-net 仓 commit
#   必须早于本仓 commit,否则 CI 红。
#
# 本脚本是「commit message 提示」版（不强拒）—— 检测到本次 commit
# 改动 import @berrysu/gina-core 时,提醒开发者确认 gina-cats-net 已 commit。
#
# 后续 gina-platform 排期做严格 pre-commit hook (v2 强拒版)。
# ─────────────────────────────────────────────────────────────────────

set -e

# 1. 检测本次 commit 改动是否引用 @berrysu/gina-core
changed_files=$(git diff --cached --name-only)
gina_core_refs=$(echo "$changed_files" | xargs -I {} grep -l "@berrysu/gina-core" "{}" 2>/dev/null | grep -v "package.json" | grep -v "package-lock" || true)

if [ -z "$gina_core_refs" ]; then
  exit 0
fi

# 2. 检测到引用,提示开发者
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  ⚠️  GINA-CORE 跨仓顺序检查（轻量版）                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "  本次 commit 引用了 @berrysu/gina-core:"
echo "$gina_core_refs" | sed 's/^/    · /'
echo ""
echo "  强约束（ADR §4.2）："
echo "    1. 内核改动必须先 commit + push 到 gina-cats-net 仓"
echo "    2. 主仓消费 @berrysu/gina-core 必须后 commit"
echo ""
echo "  请确认:"
echo "    cd ~/Desktop/GINA/gina增加计划登记 && git log --oneline -3"
echo "    对应 commit 早于本次主仓 commit"
echo ""

# 3. 读 gina-cats-net 仓 HEAD commit 时间,主仓未提交所以只做提示
cats_net_path="${GINA_CATS_NET_PATH:-/Users/ahs/Desktop/GINA/gina增加计划登记}"
if [ -d "$cats_net_path/.git" ]; then
  cats_net_head=$(git -C "$cats_net_path" log -1 --format='%h %s' 2>/dev/null || echo "(gina-cats-net 仓无 commit)")
  echo "  gina-cats-net HEAD: $cats_net_head"
  echo ""
fi

echo "  确认无误可继续 commit（不阻断,只是提示）"
echo ""
exit 0
