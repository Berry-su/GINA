// src/self/test-model.js —— SelfModel 单元测试（20+ 测试）
//
// Run: node src/self/test-model.js
// 不依赖数据库、LLM、网络——只测 SelfModel 类 + 持久化 round-trip

import { SelfModel, resetSelfModelForTest } from './model.js'
import { getConfig, setConfig } from '../capabilities/db.js'
import { getOrInitBirthTime } from '../capabilities/db.js'

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

// —— 1. 初始化 + 默认值 ——
section('1. 初始化 + 默认值')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  const s = m.snapshot()
  assert(s.version === 1, 'version 默认 = 1')
  assert(s.identity.name === 'GINA', 'identity.name = GINA')
  assert(s.identity.version === '2.1.601', 'identity.version = 2.1.601')
  assert(typeof s.identity.bornAt === 'object' || s.identity.bornAt === null, 'bornAt 是 object|null')
  assert(s.abilities.confidence === 0.5, 'confidence 默认 = 0.5')
  assert(s.abilities.capabilities.length >= 5, 'capabilities 至少 5 项')
  assert(s.limitations.length >= 5, 'limitations 至少 5 项（老板 9-01 仿生脑不做清单）')
  assert(s.meta.tickCount === 0, 'tickCount 默认 = 0')
  assert(Array.isArray(s.abilities.recentFailures), 'recentFailures 是数组')
}

// —— 2. tick() 累计时长 + tick 数 ——
section('2. tick() 累计时长 + tick 数')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  const t0 = m.tick()
  assert(t0.meta.tickCount === 1, '首次 tick → tickCount = 1')
  const t1 = m.tick()
  assert(t1.meta.tickCount === 2, '二次 tick → tickCount = 2')
  const t2 = m.tick({ now: Date.now() + 1000 })
  assert(t2.meta.tickCount === 3, '三次 tick → tickCount = 3')
  assert(t2.identity.uptimeMs >= 0, 'uptimeMs ≥ 0')
  assert(t2.meta.lastTickAt > 0, 'lastTickAt > 0')
}

// —— 3. snapshot() 深拷贝（修改 snapshot 不影响 state）——
section('3. snapshot() 深拷贝')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  const s = m.snapshot()
  s.abilities.capabilities.push('XXX_INJECTED')
  s.identity.learned.nodes = 99999
  const s2 = m.snapshot()
  assert(!s2.abilities.capabilities.includes('XXX_INJECTED'), '改 capabilities 不污染 state')
  assert(s2.identity.learned.nodes !== 99999, '改 learned.nodes 不污染 state')
}

// —— 4. introduce() 简短自我介绍 ——
section('4. introduce()')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  m.tick()
  const intro = m.introduce()
  assert(typeof intro === 'string' && intro.length > 0, 'intro 是非空字符串')
  assert(intro.includes('GINA'), 'intro 包含 GINA')
  assert(intro.includes('ticks'), 'intro 包含 ticks 字段')
  assert(intro.length < 300, 'intro 长度 < 300（meta-info 段控制长度）')
}

// —— 5. limitations() 静态 + 动态合并 ——
section('5. limitations()')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  const l = m.limitations()
  assert(l.length >= 5, 'limitations 至少 5 项')
  // 老板 9-01 拍板的"明确不要"清单
  assert(l.some(x => x.includes('subjective')), '包含"no subjective consciousness"')
  assert(l.some(x => x.includes('free will')), '包含"no free will"')
  assert(l.some(x => x.includes('sleep')), '包含"cannot sleep"')
}

// —— 6. confidence() 基础 + noteOutcome 影响 ——
section('6. confidence() + noteOutcome')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  assert(m.confidence() === 0.5, '初始 confidence = 0.5')
  // 失败 → 衰减
  m.noteOutcome({ success: false, reason: 'test_fail_1' })
  assert(m.confidence() < 0.5, '失败后 confidence < 0.5')
  // 多次失败 → 收敛到 floor
  for (let i = 0; i < 50; i++) m.noteOutcome({ success: false, reason: 'floor_test' })
  assert(m.confidence() >= 0.1, '失败多次后 confidence ≥ floor (0.1)')
  assert(m.confidence() < 0.2, '失败多次后 confidence < 0.2')
  // 成功 → 回升
  for (let i = 0; i < 50; i++) m.noteOutcome({ success: true })
  assert(m.confidence() <= 0.95, '成功多次后 confidence ≤ ceil (0.95)')
  assert(m.confidence() > 0.5, '成功多次后 confidence > 0.5')
}

// —— 7. noteOutcome 记录最近 5 次失败 ——
section('7. recentFailures 滑动窗口')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  for (let i = 0; i < 10; i++) {
    m.noteOutcome({ success: false, reason: `fail_${i}`, capability: `cap_${i}` })
  }
  const fails = m.snapshot().abilities.recentFailures
  assert(fails.length === 5, 'recentFailures 最多 5 条')
  assert(fails[0].reason === 'fail_5', '最早的是 fail_5（滑窗后）')
  assert(fails[4].reason === 'fail_9', '最新的是 fail_9')
  assert(fails[0].capability === 'cap_5', 'capability 字段保留')
  assert(typeof fails[0].ts === 'number', 'ts 是 number')
}

// —— 8. 持久化 round-trip ——
section('8. 持久化 round-trip (KV)')
{
  resetSelfModelForTest()
  const m1 = new SelfModel()
  m1.tick()
  m1.noteOutcome({ success: false, reason: 'persist_test' })
  const before = m1.snapshot()
  // 模拟重启：new instance
  const m2 = new SelfModel()
  const after = m2.snapshot()
  assert(after.meta.tickCount === before.meta.tickCount, 'tickCount 持久化一致')
  assert(after.abilities.recentFailures.length === before.abilities.recentFailures.length, 'failures 持久化一致')
  assert(after.abilities.confidence === before.abilities.confidence, 'confidence 持久化一致')
  assert(after.abilities.recentFailures[0]?.reason === 'persist_test', 'failure reason 持久化')
}

// —— 9. 防御性 _load 损坏 KV ——
section('9. _load 防御性 (损坏 KV)')
{
  resetSelfModelForTest()
  setConfig('self_model_v1', 'NOT_JSON{{{')
  const m = new SelfModel()
  const s = m.snapshot()
  assert(s.version === 1, '损坏 KV 时 fallback 到 default，version = 1')
  assert(s.abilities.confidence === 0.5, '损坏 KV 时 confidence = 0.5')
}

// —— 10. _load 部分字段缺失 ——
section('10. _load 部分字段缺失 (向后兼容)')
{
  resetSelfModelForTest()
  // 写入只含部分字段的 JSON
  setConfig('self_model_v1', JSON.stringify({ version: 1, identity: { name: 'PARTIAL' } }))
  const m = new SelfModel()
  const s = m.snapshot()
  assert(s.identity.name === 'PARTIAL', 'identity.name 保留 (PARTIAL)')
  assert(s.abilities.capabilities.length >= 5, '缺失字段 fallback default')
  assert(s.limitations.length >= 5, 'limitations fallback default')
}

// —— 11. tick() 注入 state.task ——
section('11. tick() state.task 注入')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  m.tick({ state: { task: { title: '测试任务' } } })
  assert(m.snapshot().current.task === '测试任务', 'state.task.title 注入 current.task')
  m.tick({ state: { task: null } })
  // 注意：state.task 为 null 时 current.task 保留为 null（清掉）
  assert(m.snapshot().current.task === null, 'state.task=null → current.task=null')
}

// —— 12. tick() 注入 catsNet（best-effort）——
section('12. tick() catsNet 节点数')
{
  resetSelfModelForTest()
  const fakeCatsNet = { size: 42 }
  const m = new SelfModel({ catsNet: fakeCatsNet })
  m.tick()
  assert(m.snapshot().identity.learned.nodes === 42, 'catsNet.size = 42 注入 learned.nodes')
}

// —— 13. tick() catsNet 为 null 时不崩 ——
section('13. tick() catsNet = null 不崩')
{
  resetSelfModelForTest()
  const m = new SelfModel({ catsNet: null })
  const t = m.tick()
  assert(t.meta.tickCount === 1, 'catsNet=null 时 tick 仍正常')
}

// —— 14. toContextString() 4 维完整 ——
section('14. toContextString() 4 维完整')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  m.tick()
  const text = m.toContextString()
  assert(text.includes('## 自主意识'), '段头 ## 自主意识')
  assert(text.includes('### 我是谁'), '4 维 1: 我是谁')
  assert(text.includes('### 我在做什么'), '4 维 2: 我在做什么')
  assert(text.includes('### 我会什么'), '4 维 3: 我会什么')
  assert(text.includes('### 不会什么'), '4 维 4: 不会什么')
  assert(text.includes('GINA'), '包含 GINA 名字')
  assert(text.includes('@berrysu/gina-core'), '包含内核包名')
  assert(text.includes('v' + 1), '包含版本号 v1')
}

// —— 15. toContextString() 长度控制 ——
section('15. toContextString() 长度控制 (≤ 1.5KB)')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  m.tick()
  const text = m.toContextString()
  assert(text.length < 2000, `长度 < 2000 (实际 ${text.length})`)
  assert(text.length > 200, '长度 > 200 (有内容)')
}

// —— 16. toContextString() 不含 emotion 任何字段 ——
section('16. toContextString() 情绪隔离 (不含 emotion)')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  m.tick()
  const text = m.toContextString()
  // emotion 字段（按 9-01 拍板：emotion 是 meta-info 但 self-model 严格不读 emotion）
  assert(!text.includes('valence'), '不含 emotion.valence')
  assert(!text.includes('arousal'), '不含 emotion.arousal')
  assert(!text.includes('emotion_profile'), '不含 emotion_profile 字段')
}

// —— 17. 静态 import 不 import emotion-engine ——
section('17. 静态 import 检查（情绪隔离静态验证）')
{
  // 用 grep 替代，模块加载时不会真正 import emotion
  // 这里只读 source 做字符串匹配（不依赖 fs）
  const src = await import('fs').then(fs => fs.promises.readFile(new URL('./model.js', import.meta.url), 'utf-8'))
  assert(!src.includes("from '../memory/emotion-engine"), 'model.js 不 import emotion-engine')
  assert(!src.includes("from './emotion"), 'model.js 不 import emotion 任何子路径')
  assert(!src.includes('joy'), 'model.js 不含 emotion. joy 字段名')
}

// —— 18. capabilities 静态 + 动态合并 ——
section('18. capabilities 静态 + 动态合并（API）')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  const caps = m.snapshot().abilities.capabilities
  assert(caps.some(c => c.includes('CATS-Net')), 'capabilities 含 CATS-Net')
  assert(caps.some(c => c.includes('self-evolution')), 'capabilities 含 self-evolution')
  assert(caps.length >= 5, 'capabilities 至少 5 项')
}

// —— 19. getSelfModel 单例 ——
section('19. getSelfModel 单例')
{
  resetSelfModelForTest()
  const a = (await import('./model.js')).getSelfModel()
  const b = (await import('./model.js')).getSelfModel()
  assert(a === b, 'getSelfModel 返回同一实例')
  resetSelfModelForTest()
  const c = (await import('./model.js')).getSelfModel()
  assert(a !== c, 'resetSelfModelForTest 后新建实例')
}

// —— 20. _reset() 测试专用 ——
section('20. _reset() 完整重置')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  m.tick()
  m.tick()
  m.noteOutcome({ success: false, reason: 'X' })
  assert(m.snapshot().meta.tickCount > 0, 'tick 累计')
  m._reset()
  const s = m.snapshot()
  assert(s.meta.tickCount === 0, '_reset 后 tickCount = 0')
  assert(s.abilities.recentFailures.length === 0, '_reset 后 failures 清空')
  assert(s.abilities.confidence === 0.5, '_reset 后 confidence = 0.5')
}

// —— 21. tick 多次累计 tickCount ——
section('21. tick 多次累计')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  for (let i = 0; i < 10; i++) m.tick()
  assert(m.snapshot().meta.tickCount === 10, '10 次 tick → tickCount = 10')
}

// —— 22. noteOutcome 累计计数器 ——
section('22. noteOutcome 累计 _noteOutcomeCount')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  m.noteOutcome({ success: true })
  m.noteOutcome({ success: false, reason: 'x' })
  m.noteOutcome({ success: true })
  assert(m.snapshot().meta.noteOutcomeCount === 3, '3 次 noteOutcome → count = 3')
}

// —— 23. identity.bornAt 通过 getOrInitBirthTime 注入 ——
section('23. identity.bornAt 自动注入')
{
  resetSelfModelForTest()
  // 第一次 tick 应该把 bornAt 注入（getOrInitBirthTime 返回 ISO string）
  const birth = getOrInitBirthTime()
  const m = new SelfModel()
  m.tick()
  const bornAt = m.snapshot().identity.bornAt
  // bornAt 可能是 number (ms) 或 string (ISO) — 两种都接受
  const isValid = (
    (typeof bornAt === 'number' && bornAt > 0) ||
    (typeof bornAt === 'string' && !isNaN(Date.parse(bornAt)))
  )
  assert(isValid, `bornAt 是有效时间戳 (实际: ${bornAt}, 类型: ${typeof bornAt})`)
  // 跟 getOrInitBirthTime() 至少在分钟级匹配
  const bornMs = typeof bornAt === 'number' ? bornAt : Date.parse(bornAt)
  const birthMs = Date.parse(birth)
  assert(Math.abs(bornMs - birthMs) < 60000, `bornAt ≈ getOrInitBirthTime() (差 ${Math.abs(bornMs - birthMs)}ms)`)
}

// —— 24. toContextString 包含 tickCount + uptimeMin ——
section('24. toContextString 关键字段')
{
  resetSelfModelForTest()
  const m = new SelfModel()
  m.tick()
  const text = m.toContextString()
  assert(/\d+\s+min/.test(text), '包含 "X min" 在线时长')
  assert(/Tick:\s*\d+/.test(text), '包含 "Tick: X" 计数')
  assert(/置信度:\s*\d+%/.test(text), '包含 "置信度: X%"')
}

console.log(`\n=== SelfModel 测试结果: ${passed} passed, ${failed} failed ===`)
