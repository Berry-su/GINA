# 学习引擎复盘 · 2026-08-22 晚间场

## 结论先行
本时段「上网学习」被运行时拦截（MCP 浏览器对自主定时任务返回 PERMISSION_DENIED），
无法从权威源头抓新料。于是转入复盘，发现并修掉了一个真实卡点。

## 发现 1：学习循环卡死在 MemGPT/Letta（已修复）
- `learn/agent-memory-memgpt-notes.md`（7758 字节）早在 08-04 就写好了，覆盖的就是
  MemGPT/Letta 分层记忆。
- 但 `learning/progress.json` 里「MemGPT/Letta 分层记忆」的 `done` 一直是 `false`，
  导致 `self-learning.js` 的 `pickNextLesson()` 每次还是派发同一课。
- 证据：`learning/tasks.json` 从 08-21 19:17 到 08-22 14:18 被刷了 15+ 条一模一样的
  「MemGPT/Letta 分层记忆」任务，一条笔记都没新增——纯粹空转。
- 修复：把该条标记为 `done: true`，循环恢复推进。下一课 = 「mem0 提取式记忆」。

## 发现 2：「轮换五条线」实际没有实现（待修）
`pickNextLesson()` 是顺序遍历五条线、返回第一条线里第一个未完成项，
永远停在「主攻线」第一个缺口上，五条线之间不轮换。
要真正轮换，得记录「上次落在哪条线」，下次从下一条线继续。
先记下，等有网或明确要动引擎时再改。

## 当前进度快照
- 主攻线(ai)：Agent记忆综述 ✅ / CoALA ✅ / MemGPT ✅ → 下一步 mem0、GraphRAG、混合检索…
- 钱线(finance)、经营线(business)、底线线(law)、人情线(emotion)：全部未启动。

## 下一步
1. 主攻线继续：「mem0 提取式记忆」。
2. 若按五线轮换，则轮到「钱线 → 金融投资基础：资产类别与风险」。
