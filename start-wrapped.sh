#!/bin/bash
cd /Users/ahs/Documents/BaiLongma-refactor-codebase
echo "[wrapper] $(date '+%Y-%m-%d %H:%M:%S') Bailongma starting..."
while true; do
  npx electron .
  EXIT_CODE=$?
  echo "[wrapper] $(date '+%Y-%m-%d %H:%M:%S') Bailongma exited (code=$EXIT_CODE). Restarting in 1s..."
  sleep 1
done
