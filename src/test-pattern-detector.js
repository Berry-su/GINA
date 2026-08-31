// PatternDetector 单元测试
// Run: node src/test-pattern-detector.js
//
// 覆盖:
//   规则轨 4 个(/get /show /create /delete)
//   频率轨 3 个(1 / 2 / 3+ 次触发)
//   边界 3 个(空输入 / 大小写归一化 / 窗口过期 prune)
//   行为 1 个(规则 + 频率并发时规则优先)

import { PatternDetector } from './context/pattern-detector.js'

let failed = 0
function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

// 固定 now,便于构造"过去 1h / 2h 前"的测试场景
function fixedNow(base) {
  let t = base
  return () => t++
}

// —— 规则轨 ——
{
  const det = new PatternDetector()
  const r1 = det.detect('/get weather')
  assert(r1.source === 'rule' && r1.pattern === '/get' && r1.confidence >= 0.9,
    '规则轨: /get 触发, source=rule, confidence >= 0.9')

  const r2 = det.detect('/show news')
  assert(r2.source === 'rule' && r2.pattern === '/show' && r2.confidence >= 0.9,
    '规则轨: /show 触发, source=rule')

  const r3 = det.detect('/create note hello')
  assert(r3.source === 'rule' && r3.pattern === '/create' && r3.confidence >= 0.9,
    '规则轨: /create 触发, source=rule')

  const r4 = det.detect('/delete task 42')
  assert(r4.source === 'rule' && r4.pattern === '/delete' && r4.confidence >= 0.9,
    '规则轨: /delete 触发, source=rule')
}

// —— 频率轨 ——
{
  // 注入可控时钟:0, 1, 2, ...(秒)
  let t = 0
  const det = new PatternDetector({ windowMs: 60_000, threshold: 3, now: () => ++t })

  // 自然语言非命令前缀 → 走频率轨
  const r0 = det.detect('今天天气怎么样')
  assert(r0.source === 'none' && r0.pattern === null,
    '频率轨: 0 次命中 → source=none')

  // 模拟主循环在 LLM 成功调用工具后回调 recordHit
  det.recordHit('查询天气')
  const r1 = det.detect('今天天气怎么样')
  assert(r1.source === 'none',
    '频率轨: 1 次命中 → 仍 source=none(低于 threshold)')

  det.recordHit('查询天气')
  const r2 = det.detect('今天天气怎么样')
  assert(r2.source === 'none',
    '频率轨: 2 次命中 → 仍 source=none')

  det.recordHit('查询天气')
  const r3 = det.detect('今天天气怎么样')
  assert(r3.source === 'frequency' && r3.pattern === '查询天气' && r3.count === 3 && r3.confidence >= 0.5,
    '频率轨: 3 次命中 → source=frequency, confidence >= 0.5')

  // 多加 2 次 → confidence 应该继续上升
  det.recordHit('查询天气')
  det.recordHit('查询天气')
  const r5 = det.detect('今天天气怎么样')
  assert(r5.source === 'frequency' && r5.count === 5 && r5.confidence > r3.confidence,
    '频率轨: 5 次命中 → confidence > 3 次(confidence 随命中单调上升)')

  // 不同 pattern 互不干扰
  det.recordHit('打开笔记')
  const rMix = det.detect('随便聊聊')
  assert(rMix.source === 'frequency' && rMix.pattern === '查询天气' && rMix.count === 5,
    '频率轨: 多 pattern 并存时,高命中 pattern 胜出(查询天气 5 vs 笔记 1)')
}

// —— 边界 ——
{
  // 1) 空输入 / null
  const det1 = new PatternDetector()
  const rEmpty = det1.detect('')
  assert(rEmpty.source === 'none' && rEmpty.pattern === null,
    '边界: 空字符串 → source=none')

  const rNull = det1.detect(null)
  assert(rNull.source === 'none' && rNull.pattern === null,
    '边界: null 输入 → source=none 不抛')

  // 2) 大小写 + 标点归一化
  const det2 = new PatternDetector({ windowMs: 60_000, threshold: 3, now: (() => { let t = 0; return () => ++t })() })
  det2.recordHit('查询天气')
  det2.recordHit('查询天气.')
  det2.recordHit('  查询天气  ')
  const rNorm = det2.detect('今天天气')
  assert(rNorm.source === 'frequency' && rNorm.count === 3,
    '边界: 大小写/前后空格/句末标点 → 归一为同一 pattern')

  // 3) 窗口过期 → prune 掉
  const base = 1_000_000
  let fakeNow = base
  const det3 = new PatternDetector({ windowMs: 60_000, threshold: 3, now: () => fakeNow })
  det3.recordHit('老旧模式', base - 120_000) // 2 分钟前,已超出 60s 窗口
  det3.recordHit('老旧模式', base - 90_000)  // 1.5 分钟前,已超出
  det3.recordHit('老旧模式', base - 30_000)  // 30s 前,在窗口内
  const rOld = det3.detect('随便')
  // 窗口内只剩 1 次 < threshold 3 → 应为 none
  assert(rOld.source === 'none',
    '边界: 窗口外命中被 prune,触发数重算')
  // 显式验证 snapshot 真的清掉了
  const snap = det3.snapshot()
  assert(snap['老旧模式'] === 1,
    '边界: snapshot 显示窗口内仅 1 次(其余 2 次被 prune)')
}

// —— 行为:规则轨 vs 频率轨优先级 ——
{
  let t = 0
  const det = new PatternDetector({ windowMs: 60_000, threshold: 3, now: () => ++t })
  // 先累积一个高频"查天气"
  for (let i = 0; i < 5; i++) det.recordHit('查天气')
  // 用户发了一条以 /get 开头的命令
  const r = det.detect('/get weather')
  assert(r.source === 'rule' && r.pattern === '/get',
    '行为: 即使频率轨有高命中 pattern,规则轨前缀仍优先匹配')
}

if (failed === 0) {
  console.log('\nAll pattern-detector tests passed.')
} else {
  console.error(`\n${failed} test(s) failed.`)
}
