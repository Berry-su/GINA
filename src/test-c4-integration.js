// src/test-c4-integration.js —— C-4 集成测试（buildContextBlock + SelfModel + Direction 串起来）
//
// Run: node src/test-c4-integration.js
// 验证：注入位置正确 / 情绪隔离 / 段格式 / 与 emotion 共存
// C-4.3（2026-09-01 续篇）：emotional-state 段位置 + 隔离

import { buildContextBlock } from './prompt.js'
import { SelfModel, resetSelfModelForTest } from './self/model.js'
import { DirectionController } from './learning/direction.js'
import { JoyState, resetJoyStateForTest } from './emotion/joy-state.js'
import fs from 'fs'
import os from 'os'
import path from 'path'

let passed = 0
let failed = 0
function assert(cond, label) {
  if (cond) {
    console.log(`[ok] ${label}`)
    passed++
  } else {
    console.error(`[FAIL] ${label}`)
    failed++
    process.exitCode = 1
  }
}
function section(name) { console.log(`\n--- ${name} ---`) }

// —— 1. buildContextBlock 接收 selfModel + currentDirection ——
section('1. buildContextBlock 接收 selfModel + currentDirection')
{
  const ctx = buildContextBlock({
    selfModel: { text: '## 自主意识 (self-model · v1)\n### 我是谁\n- 名字: GINA' },
    currentDirection: '## 当前学习方向 (direction · v1)\n- 方向: CATS-Net 大脑',
  })
  assert(ctx.includes('<self-model>'), '包含 <self-model> 段')
  assert(ctx.includes('</self-model>'), '包含 </self-model> 闭合')
  assert(ctx.includes('<current-direction>'), '包含 <current-direction> 段')
  assert(ctx.includes('</current-direction>'), '包含 </current-direction> 闭合')
  assert(ctx.includes('## 自主意识'), 'selfModel.text 注入')
  assert(ctx.includes('## 当前学习方向'), 'currentDirection 注入')
}

// —— 2. 注入位置：self-snapshot → self-model → current-direction → self-perception ——
section('2. 注入位置（meta-info 段顺序）')
{
  const ctx = buildContextBlock({
    selfSnapshot: { snapshotText: '你刚才在用简洁直接的语气' },
    selfModel: { text: '## 自主意识' },
    currentDirection: '## 当前学习方向',
    selfPerception: { perceptionText: '你感知到镜像污染', boundaryState: 'normal' },
  })
  const iSnap = ctx.indexOf('<self-snapshot>')
  const iModel = ctx.indexOf('<self-model>')
  const iDir = ctx.indexOf('<current-direction>')
  const iPer = ctx.indexOf('<self-perception>')
  assert(iSnap > 0, 'self-snapshot 存在')
  assert(iModel > iSnap, 'self-model 在 self-snapshot 之后')
  assert(iDir > iModel, 'current-direction 在 self-model 之后')
  assert(iPer > iDir, 'self-perception 在 current-direction 之后')
}

// —— 3. 空值不渲染段（presence gate）——
section('3. 空值不渲染段')
{
  const ctx1 = buildContextBlock({ selfModel: null, currentDirection: null })
  assert(!ctx1.includes('<self-model>'), 'selfModel=null → 不渲染')
  assert(!ctx1.includes('<current-direction>'), 'currentDirection=null → 不渲染')

  const ctx2 = buildContextBlock({ selfModel: {}, currentDirection: '' })
  assert(!ctx2.includes('<self-model>'), 'selfModel={} → 不渲染')
  assert(!ctx2.includes('<current-direction>'), 'currentDirection="" → 不渲染')
}

// —— 4. SelfModel.toContextString 串到 buildContextBlock 完整流程 ——
section('4. SelfModel.toContextString 端到端')
{
  resetSelfModelForTest()
  const sm = new SelfModel()
  sm.tick()
  const text = sm.toContextString()
  const ctx = buildContextBlock({ selfModel: { text } })
  assert(ctx.includes('## 自主意识'), 'selfModel.text 进入 ctx')
  assert(ctx.includes('### 我是谁'), '4 维 1')
  assert(ctx.includes('### 我在做什么'), '4 维 2')
  assert(ctx.includes('### 我会什么'), '4 维 3')
  assert(ctx.includes('### 不会什么'), '4 维 4')
}

// —— 5. DirectionController.injectFor 端到端 ——
section('5. DirectionController.injectFor 端到端')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4-int-'))
  const d = new DirectionController({ dataDir: tmp })
  d.set({ topic: 'CATS-Net 大脑架构' })
  const text = d.injectFor()
  const ctx = buildContextBlock({ currentDirection: text })
  assert(ctx.includes('CATS-Net 大脑架构'), 'direction topic 注入')
  assert(ctx.includes('<current-direction>'), '段渲染')
}

// —— 6. emotion + self-model 共存（情绪隔离证明）——
section('6. emotion + self-model 共存（情绪隔离）')
{
  // emotion 不在 buildContextBlock 当前 API 里（emotion 是 emotionPerception 注入的 emotionProfile，
  // 不通过 meta-info 段路径）。但 self-model 不能因为 emotion 字段而变化。
  const ctx1 = buildContextBlock({
    selfModel: { text: '## 自主意识' },
    emotionProfile: { primary: 'joy', valence: 0.8 },
  })
  const ctx2 = buildContextBlock({
    selfModel: { text: '## 自主意识' },
    // emotionProfile 不传
  })
  // selfModel 段在两种情况下应该完全一致
  const m1 = ctx1.match(/<self-model>[\s\S]*?<\/self-model>/)?.[0]
  const m2 = ctx2.match(/<self-model>[\s\S]*?<\/self-model>/)?.[0]
  assert(m1 === m2, 'selfModel 段不受 emotionProfile 影响')
}

// —— 7. section-gate 兼容新字段（measure-only）——
section('7. section-gate 兼容 selfModel + currentDirection')
{
  const { selectContextSections } = await import('./context/section-gate.js')
  const result = selectContextSections({
    selfModel: { text: '## 自主意识' },
    currentDirection: '## 当前学习方向',
  }, { referenceFrame: '你好' })
  const audit = result.audit || []
  const auditMap = Object.fromEntries(audit.map(a => [a.section, a]))
  assert(auditMap['self-model']?.enforce === false, 'self-model 是 measure-only')
  assert(auditMap['current-direction']?.enforce === false, 'current-direction 是 measure-only')
  assert(auditMap['self-model']?.dropped === false, 'self-model 不被剔除')
  assert(auditMap['current-direction']?.dropped === false, 'current-direction 不被剔除')
}

// —— 8. 不破现有 self-snapshot 段（向后兼容）——
section('8. 向后兼容：现有 self-snapshot 段不破')
{
  const ctx = buildContextBlock({
    selfSnapshot: { snapshotText: '你刚才在用简洁直接的语气，多用列表' },
    selfModel: { text: '## 自主意识' },
    currentDirection: '## 当前学习方向',
  })
  // 现有 self-perception / self-snapshot 行为不变
  assert(ctx.includes('<self-snapshot>'), 'self-snapshot 段保留')
  assert(ctx.includes('你刚才在用简洁直接的语气'), 'self-snapshot 内容保留')
  // 新段不污染 self-snapshot
  const snapBlock = ctx.match(/<self-snapshot>[\s\S]*?<\/self-snapshot>/)?.[0]
  assert(snapBlock && !snapBlock.includes('## 自主意识'), 'self-snapshot 段不含 self-model 内容')
}

// —— 9. 不含 emotion 字段（meta-info 段隔离）——
section('9. meta-info 段不混入 emotion 字段')
{
  const ctx = buildContextBlock({
    selfModel: { text: '## 自主意识' },
    currentDirection: '## 当前学习方向',
  })
  // self-model 段不应包含 emotion 任何字段
  const modelBlock = ctx.match(/<self-model>[\s\S]*?<\/self-model>/)?.[0]
  assert(modelBlock && !modelBlock.includes('valence'), 'self-model 不含 valence')
  assert(modelBlock && !modelBlock.includes('arousal'), 'self-model 不含 arousal')
  assert(modelBlock && !modelBlock.includes('emotion'), 'self-model 不含 emotion')
  // current-direction 段也不应含 emotion
  const dirBlock = ctx.match(/<current-direction>[\s\S]*?<\/current-direction>/)?.[0]
  assert(dirBlock && !dirBlock.includes('emotion'), 'current-direction 不含 emotion')
  assert(dirBlock && !dirBlock.includes('valence'), 'current-direction 不含 valence')
}

// —— 10. SelfModel tick + buildContextBlock 集成 ——
section('10. SelfModel tick + buildContextBlock')
{
  resetSelfModelForTest()
  const sm = new SelfModel()
  sm.tick({ state: { task: { title: 'C-4 集成测试' } } })
  sm.noteOutcome({ success: false, reason: 'integration_test' })
  const text = sm.toContextString()
  const ctx = buildContextBlock({ selfModel: { text } })
  // 当前 task 注入
  assert(ctx.includes('C-4 集成测试'), 'tick state.task 注入 self-model')
  // 置信度受失败影响
  const modelBlock = ctx.match(/<self-model>[\s\S]*?<\/self-model>/)?.[0]
  assert(modelBlock && modelBlock.includes('置信度: 4'), '置信度 < 50% (失败一次: 0.5*0.9=0.45 → 45%)')
}

console.log(`\n=== C-4 集成测试结果: ${passed} passed, ${failed} failed ===`)

// —— 11. C-4.3 emotional-state 段位置 ——
// 顺序：self-snapshot → self-model → emotional-state → current-direction → self-perception
section('11. C-4.3 emotional-state 段位置（紧跟 self-model 之后）')
{
  resetJoyStateForTest()
  const joy = new JoyState()
  joy.bump({ amount: 0.15, reason: 'integration_test' })
  const ctx = buildContextBlock({
    selfSnapshot: { snapshotText: '你刚才在用简洁直接的语气' },
    selfModel: { text: '## 自主意识' },
    emotionalState: joy.injectFor(),
    currentDirection: '## 当前学习方向',
    selfPerception: { perceptionText: '你感知到镜像污染', boundaryState: 'normal' },
  })
  // 段存在
  assert(ctx.includes('<emotional-state>'), '包含 <emotional-state> 段')
  assert(ctx.includes('</emotional-state>'), '包含 </emotional-state> 闭合')
  assert(ctx.includes('joy:'), 'emotionalState 含 joy: 字段')
  // 位置：self-model 之后、current-direction 之前
  const modelIdx = ctx.indexOf('</self-model>')
  const emotionIdx = ctx.indexOf('<emotional-state>')
  const dirIdx = ctx.indexOf('<current-direction>')
  assert(modelIdx > 0 && emotionIdx > modelIdx, 'emotional-state 在 self-model 之后')
  assert(emotionIdx > 0 && dirIdx > emotionIdx, 'emotional-state 在 current-direction 之前')
}

// —— 12. C-4.3 emotional-state 不混入 self-model / current-direction 段 ——
section('12. C-4.3 emotional-state 段内不混入其他情绪词')
{
  resetJoyStateForTest()
  const joy = new JoyState()
  const ctx = buildContextBlock({
    selfModel: { text: '## 自主意识' },
    emotionalState: joy.injectFor(),
    currentDirection: '## 当前学习方向',
  })
  const emotionBlock = ctx.match(/<emotional-state>[\s\S]*?<\/emotional-state>/)?.[0]
  assert(emotionBlock && !emotionBlock.includes('anger'), 'emotional-state 不含 anger')
  assert(emotionBlock && !emotionBlock.includes('fear'), 'emotional-state 不含 fear')
  assert(emotionBlock && !emotionBlock.includes('sadness'), 'emotional-state 不含 sadness')
  assert(emotionBlock && !emotionBlock.includes('valence'), 'emotional-state 不含 valence')
  assert(emotionBlock && !emotionBlock.includes('arousal'), 'emotional-state 不含 arousal')
  // self-model 段也不应有 emotional-state 内容
  const modelBlock = ctx.match(/<self-model>[\s\S]*?<\/self-model>/)?.[0]
  assert(modelBlock && !modelBlock.includes('joy:'), 'self-model 不含 joy: 字段')
}

console.log(`\n=== C-4 集成测试结果: ${passed} passed, ${failed} failed ===`)
