# GINA API 参考（API Reference）

> 主仓 `~/Documents/BaiLongma-refactor-codebase/` = `Berry-su/GINA`
> 最后更新：2026-09-07
> 范围：自进化 5 项 + 多维情绪 + 主动预判等核心模块的公开 API

---

## 📚 目录

- [src/emotion/ — 情绪系统](#srccemotion--情绪系统)
- [src/anticipation/ — 主动预判](#srcanticipation--主动预判)
- [src/experiments/ — A/B 测试](#srcexperiments--ab-测试)
- [src/self-modify/ — 代码自修改](#srcself-modify--代码自修改)
- [src/meta-learning/ — 元学习](#srcmeta-learning--元学习)
- [src/tool-self-create/ — 工具自创建](#srctool-self-create--工具自创建)
- [src/arch-evolution/ — 架构自进化](#srcarch-evolution--架构自进化)
- [src/memory/ — 记忆系统](#srcmemory--记忆系统-精选)

---

## src/emotion/ — 情绪系统

### `EmotionState` (5 维内部情绪)

```js
import { EmotionState, getEmotionState, DIMENSIONS, DIMENSION_IDS } from './src/emotion/index.js'

const state = new EmotionState()
// 或单例
const s = getEmotionState()

// 5 维
//   satisfaction  — 满足度（与 joy-state 同步）
//   curiosity     — 好奇心
//   confidence    — 自信度
//   engagement    — 投入度
//   fatigue       — 疲劳度

// 调整（+amount 必须 ≤ MAX_JUMP = 0.3）
s.bump({ dimension: 'curiosity', amount: 0.2, reason: 'new_domain' })
s.bump({ dimension: 'confidence', amount: -0.1, reason: 'prediction_wrong' })

// 疲劳度更新（特殊：累积/衰减）
s.updateFatigue({ now: Date.now(), isActive: true, idleMinutes: 0 })

// 主循环 tick
s.tick()  // 应用衰减

// 读取
s.get('curiosity')              // 单维度当前值
s.snapshot()                    // 5 维全部快照（深拷贝）
s.injectFor()                   // 唯一对外渲染：meta-info 段字符串
```

### `JoyState` (1 维，向后兼容)

```js
import { JoyState, getJoyState } from './src/emotion/joy-state.js'

const joy = getJoyState()
joy.bump({ amount: 0.2, reason: 'task_success' })
joy.get()                       // 当前值
joy.injectFor()                 // 唯一渲染出口
```

### 隔离保证（ADR-002 老板 9-07 拍板）

```js
// ❌ 任何 tool/decision 拿不到 emotion 值
// ✅ 唯一出口：injectFor() 注入 context 字符串
// 静态扫描: emotion-state.js 0 个 tool/decision/analyst/router import
// snapshot 是纯数据，不暴露方法
```

### DIMENSIONS 详细

| ID | 中文 | 上升触发 | 下降触发 |
|---|---|---|---|
| satisfaction | 满足度 | task_success, goal_reached | task_failure, rejection |
| curiosity | 好奇心 | unknown_domain, novel_question | knowledge_mastered |
| confidence | 自信度 | prediction_correct, user_trust_signal | prediction_wrong, user_correction |
| engagement | 投入度 | task_difficulty_match | task_too_easy, task_too_hard |
| fatigue | 疲劳度 | continuous_work, high_complexity | rest, sleep_period |

---

## src/anticipation/ — 主动预判

### `predict()` — 预判 top-K 候选意图

```js
import { predict, INTENT_TYPES } from './src/anticipation/index.js'

const result = predict({
  conversationHistory: [
    '讨论 CATS-Net 架构',
    'CATS-Net 时序激活',
    '继续说 CATS-Net',
  ],
  focusContext: { depth: 2, topic: 'CATS-Net', keywords: ['cats-net', '时序', '激活'] },
  timePattern: { activeHours: [9, 10, 14, 15, 16, 20, 21] },
  externalEmotion: { valence: 0.5, arousal: 0.5, primary: 'joy' },  // 外部情绪（emotion-engine 输出）
  knowledgeGaps: ['GINA 时序激活', 'CATS-Net 衰减'],
  topK: 3,
})
// result.intents = [
//   { type: 'continue_topic', confidence: 0.65, reason: '...', signals: [...] },
//   { type: 'follow_up_question', confidence: 0.32, ... },
// ]
// result.signals = { recentMessage, recentQuestion, focusStack, timePattern, emotionContext, knowledgeGap, historyPattern }
// result.context = { historyLength, focusDepth, timePatternActive, emotionSafe, knowledgeGapCount }
```

### `suggest()` — 决定是否建议

```js
import { suggest, defaultSuggesterState } from './src/anticipation/index.js'

const state = defaultSuggesterState({ cooldownMs: 30 * 60 * 1000 })
an.setSilent(state, false)  // 老板没要求静默

const r = suggest({
  prediction: result,
  state,
  userActivity: { online: true, screenLocked: false },
  now: Date.now(),
})
// r = {
//   shouldSuggest: true/false,
//   intent: topIntent,
//   reason: '...',
//   suggestType: 'emit' | 'log' | 'silent',
//   hash: '...',
// }
```

### `runAnticipation()` — 一站式预判 + 建议 + emit

```js
import { runAnticipation, defaultSuggesterState } from './src/anticipation/index.js'

const r = runAnticipation({
  conversationHistory, focusContext, timePattern, externalEmotion, knowledgeGaps,
  userActivity: { online: true, screenLocked: false },
  suggesterState: defaultSuggesterState(),
  eventEmitter: { emit: (name, payload) => console.log(name, payload) },
  eventName: 'anticipation:suggested',  // default
})
// r = { prediction, suggestion, emitted }
```

### INTENT_TYPES

```js
CONTINUE_TOPIC         = 'continue_topic'           // 继续当前话题
FOLLOW_UP_QUESTION     = 'follow_up_question'       // 追问细节
SWITCH_TOPIC           = 'switch_topic'             // 切换话题
TASK_EXEC              = 'task_execution'           // 任务执行
INFORMATION_LOOKUP     = 'information_lookup'       // 查信息
REFLECTION             = 'reflection'               // 反思/复盘
STATUS_CHECK           = 'status_check'             // 状态查询
CREATIVE               = 'creative'                 // 创意/想法
UNKNOWN                = 'unknown'
```

### 硬约束（老板 9-07 纪律）

```js
// 默认不主动发消息
// confidence < 0.5: silent
// 0.5 ≤ confidence < 0.65: log only
// confidence ≥ 0.65: emit 'anticipation:suggested' 事件（仍由主循环决定）
// silent 模式 / 离线 / 锁屏 → 完全关闭
// 30 分钟内同内容不重复（SHA-256 dedup + cooldown）
// 焦虑用户（valence < -0.4 || arousal > 0.8）→ emotionContext = 0
```

---

## src/experiments/ — A/B 测试

### 注册实验

```js
import { registerExperiment, assignVariant, recordMetric, getResult, getOverview } from './src/experiments/index.js'

// 1. 注册
registerExperiment({
  name: 'ui_color_v1',
  variants: ['control', 'treatment'],
  trafficSplit: { control: 0.5, treatment: 0.5 },
  description: '测试新主色',
})

// 2. 分配用户（sticky）
const variant = assignVariant({ expName: 'ui_color_v1', userId: 'user_123' })

// 3. 记录指标
recordMetric({
  expName: 'ui_color_v1',
  userId: 'user_123',
  metricName: 'satisfaction',
  value: 0.85,
})

// 4. 分析结果
const result = getResult('ui_color_v1', 'satisfaction')
// result = { experiment, metric, nPerVariant, summary, baseline, comparisons, winner, sampleSizeNeeded }
```

### 控制实验

```js
import { stopExperiment, resumeExperiment, deleteExperiment } from './src/experiments/index.js'

stopExperiment('ui_color_v1')        // 暂停
resumeExperiment('ui_color_v1')      // 恢复
deleteExperiment('ui_color_v1')      // 删除（含级联指标）
```

---

## src/self-modify/ — 代码自修改

### `analyzeCodebase()` — 找低效段

```js
import { analyzeCodebase, pickTopCandidates } from './src/self-modify/index.js'

const all = analyzeCodebase({
  repoRoot: '/abs/path',
  srcDir: 'src',
  minScore: 0,
})
// all = [{ file, scores: { size, complexity, missingTests, ... }, totalScore, reason }]

const top = pickTopCandidates({ repoRoot, srcDir: 'src', n: 5, minScore: 0 })
```

### `applyEditSafely()` — 安全改代码

```js
import { applyEditSafely, parsePatch, applyPatch, restoreBackup } from './src/self-modify/index.js'

// 解析 unified diff
const hunks = parsePatch(diffText)
// 应用并自动测试 + 回滚
const result = applyEditSafely({
  filePath: '/abs/path/src/foo.js',
  hunks,
  runTests: true,
  testCommand: 'node --test tests/test-foo.js',
})
// result = { success, syntaxOk, testsOk, backup, applied }
```

### `runAllChecks()` — 3 道安全门

```js
import { runAllChecks } from './src/self-modify/index.js'

const r = runAllChecks({
  filePath: '/abs/path/src/foo.js',
  hunks,
  testCommand: 'npm test',
})
// r = { pass, syntax, tests, diffSize, reasons: [] }
```

### `commitIfPasses()` — 自动 commit

```js
import { commitIfPasses, isGitRepo, getHeadCommit, gitRevert } from './src/self-modify/index.js'

if (!isGitRepo(repoRoot)) throw new Error('not a git repo')
const result = commitIfPasses({
  repoRoot,
  files: ['src/foo.js'],
  message: 'refactor: extract function X',
  runAllChecks: true,
})
if (!result.success) gitRevert(repoRoot, result.commitHash)
```

---

## src/meta-learning/ — 元学习

### `select()` — UCB1 策略选择

```js
import { select, update, getOverview } from './src/meta-learning/index.js'

const r = select(['strategy_a', 'strategy_b', 'strategy_c'], { state })
// r = { armId, score, state }
banditUpdate('strategy_a', 0.8, { state })  // reward ∈ [-1, 1]
```

### `decideDepth()` — 反思深度 1-3

```js
import { decideDepth, recordUsage, buildPrompt } from './src/meta-learning/index.js'

const r = decideDepth({
  signal: 0.8,           // 0-1 失败强度
  severity: 0.5,         // 或显式传
  criticality: 0.3,
  state: reflectionState,
  now: Date.now(),
})
// r = { depth, target, signal, reason, budgetRemaining, budgetUsed, forced }
// depth ∈ {1, 2, 3}
const prompt = buildPrompt({ depth: r.depth, event, context, recentReflections })
```

### `decide()` (trigger) — 主动/被动 90/10

```js
import { decide, defaultTriggerState } from './src/meta-learning/index.js'

const r = decide({
  signals: { failure: 0.8, feedback: 0.5, emotion: 0.3 },
  state: triggerState,
})
// r = { mode: 'active' | 'passive' | 'skip', reason, signal, currentActiveRatio, quotaRemaining }
```

### `decide()` (planner) — 单步/多步 70/30

```js
import { decide as plannerDecide } from './src/meta-learning/index.js'

const r = plannerDecide({
  arm: { id: 'x', type: 'curriculum', uncertainty: 0.8 },
  context: { costBudget: 0.5 },
})
// r = { mode: 'single' | 'multi', steps, reason, currentSingleRatio }
```

### `runMetaLearningCycle()` — 编排器

```js
import { runMetaLearningCycle } from './src/meta-learning/index.js'

const r = await runMetaLearningCycle({
  signals: { failure: 0.8 },
  candidates: ['lesson_a', 'lesson_b'],
  executeArm: async (armId, plan) => ({ success: true }),
  paths: {
    trigger: '/tmp/tr.json',
    planner: '/tmp/pl.json',
    reflection: '/tmp/rf.json',
    bandit: '/tmp/bd.json',
    controller: '/tmp/ct.json',
  },
  ab: abFrameworkInstance,        // 可选
  abExpName: 'meta_test',
})
// r = { skipped, mode, armId, plan, executeResult, outcome, reward, reflection, cycleLog }
```

---

## src/tool-self-create/ — 工具自创建

### `generate()` — ToolSpec → 代码

```js
import { generate, buildPrompt } from './src/tool-self-create/index.js'

const spec = {
  name: 'parse_csv',
  version: '1.0.0',
  description: 'Parse CSV string to JSON array',
  category: 'data',
  inputs: [{ name: 'csv', type: 'string', required: true }],
  outputs: { name: 'rows', type: 'array' },
  sideEffects: ['none'],
  testCases: [
    { name: 'simple', args: ['a,b\n1,2'], expect: [{ a: '1', b: '2' }] },
  ],
}

const r = await generate(spec, {
  generateCode: async (prompt) => await callLLM(prompt),  // LLM 注入
  testRunner: async (source, testCases) => runTests(source, testCases),
})
// r = { spec, source, validation, testResults, prompt, failed }
```

### `validateAll()` — 3 道门

```js
import { validateAll } from './src/tool-self-create/index.js'

const r = validateAll(spec, sourceCode)
// r = { pass, risk, gates: { schema, sourceSafety, resources }, reasons: [] }
```

### `register()` — 动态注册 + 灰度

```js
import { register, advanceCanary, rollback, listTools } from './src/tool-self-create/index.js'

const reg = defaultRegistry()
register(reg, {
  spec,
  source,
  status: 'canary',
  canaryPercent: 1,
})
// 灰度阶梯：1% → 5% → 25% → 50% → 100% → stable
advanceCanary(reg, 'parse_csv', { calls: 100, errors: 1 })  // → 5%
// 失败立即回滚
rollback(reg, 'parse_csv', { reason: 'error rate spiked' })
```

### `evaluate()` — 元学习驱动决策

```js
import { evaluate } from './src/tool-self-create/index.js'

const proposals = evaluate({
  registry,                     // 工具注册表
  state,                        // failure 状态
  intent: { category: 'shell', toolHint: 'new_helper' },
})
// proposals = [{ action: 'create', suggestedSpec, priority, ... }, ...]
```

---

## src/arch-evolution/ — 架构自进化

### `runArchAudit()` — 架构审计

```js
import { runArchAudit, buildReport, getArchOverview } from './src/arch-evolution/index.js'

const r = await runArchAudit({
  srcDir: '/abs/path/src',
  dryRun: true,                  // 默认 true
  applyTypes: ['rename'],        // null = 全部
  limits: {
    maxFileLines: 1000,
    maxFanOut: 30,
  },
})
// r = { audit, graph, metrics, analysis, proposals, results }

const report = buildReport(r)
// Markdown 报告

const ov = getArchOverview(r)
// Dashboard 数据
```

### `buildGraph()` — 依赖图

```js
import { buildGraph, detectCycles, getFanIn, getFanOut } from './src/arch-evolution/index.js'

const g = buildGraph('/abs/path/src')
// g = { nodes, edges, cycles, npmDeps, stats }
g.cycles                          // [[a, b, a], ...]
getFanIn(g.edges, '/abs/path/src/foo.js')    // 多少文件 import 它
getFanOut(g.edges, '/abs/path/src/foo.js')   // 它 import 多少文件
```

### `applyProposal()` — 安全改动

```js
import { applyProposal, applyProposals } from './src/arch-evolution/index.js'

// 单个
const r = applyProposal({
  type: 'rename',
  from: '/abs/path/src/old.js',
  to: '/abs/path/src/new.js',
  autoApply: true,
}, { baseDir: '/abs/path', dryRun: false })
// r = { applied, filesChanged, renamed, backup }

// 批量
const batch = applyProposals([p1, p2, p3], { dryRun: true })
```

### 架构规则（可配置）

```js
{
  maxFileLines: 1000,           // 单文件 ≤1000 行
  maxFileLinesCritical: 2000,
  maxFanOut: 30,                 // 扇出 ≤30
  maxFanIn: 100,
  highFanIn: 50,                 // 核心模块（fanIn > 50）
  deadCodeMaxFanIn: 1,           // 死代码 fanIn ≤ 1
  deadCodeMaxLines: 50,
  minLinesForHotCandidate: 200,
}
```

### Proposal 类型

| type | autoApply | 说明 |
|---|---|---|
| `rename` | ✅ | 重命名（自动同步 import） |
| `move` | ✅ | 移动到正确层 |
| `extract` | ❌ | 提取函数/类（仅 plan） |
| `split` | ❌ | 拆分超大文件 |
| `merge` | ❌ | 合并小文件 |
| `delete` | ❌ | 删除死代码 |
| `break_cycle` | ❌ | 打破循环依赖 |
| `add_layer` | ❌ | 添加新层 |

---

## src/memory/ — 记忆系统（精选）

> 完整 API 见 `src/memory/` 内各模块的 JSDoc 注释。

### `self-evolution.js` — 自学习引擎

```js
import { runLearningCycle, markLessonDone, DIRECTIONS } from './src/memory/self-learning.js'

// v1: 按课表学
const r = runLearningCycle({ learnDir, getReflections: () => [] })
// r = { done, task: { lineId, lineName, lesson, gaps, source, createdAt } }
```

### `emotion-engine.js` — 12 维外部情绪识别

```js
import { analyzeEmotion, processEmotionUpdate, getEmotionSnapshot } from './src/memory/emotion-engine.js'

const emotion = analyzeEmotion(text)
// emotion = { primary, valence, arousal, confidence, signals }
```

### `proactive-perception.js` — 主动感知

```js
import { initProactivePerception, startProactivePolling } from './src/memory/proactive-perception.js'

initProactivePerception({ enabled: true, pollingIntervalMs: 60000 })
startProactivePolling()
```

### `auto-planner.js` — 任务自动规划

```js
import { generatePlanFromTrigger, getActivePlans, cancelPlan } from './src/memory/auto-planner.js'

const plan = generatePlanFromTrigger({
  trigger: 'news_important',
  context: { news: '...' },
})
```

### `strategy-optimizer.js` — 策略优化

```js
import { getCurrentStrategies, optimizeStrategy } from './src/memory/strategy-optimizer.js'

const strategies = getCurrentStrategies()
// 6 大类：TOOL_SELECTION / RESPONSE_TONE / KNOWLEDGE_RETRIEVAL / ERROR_RECOVERY / TIMING / PROACTIVITY
```

---

## 错误处理约定

| 类型 | 行为 |
|---|---|
| 验证失败 | 抛 `Error` with message |
| 持久化失败 | 静默 + console.warn（不阻塞主流程） |
| 外部 API 失败 | retry 3 次后 throw |
| LLM 注入失败 | throw（不静默，因为是用户责任） |

## 配置 / 路径

- DB: `${GINA_USER_DIR}/data/jarvis.db`
- Sandbox: `${GINA_USER_DIR}/sandbox/`
- 备份: `${GINA_USER_DIR}/arch-backup-${timestamp}/`

## 维护

- 文档更新：每次自进化模块变更必须同步更新本文档
- 版本：跟随主仓 `package.json` version
- 反馈：开 issue 标 `docs:api-reference`
