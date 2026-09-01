// src/learning/test-direction.js —— DirectionController 单元测试（20+ 测试）
//
// Run: node src/learning/test-direction.js
// 不依赖 LLM（除 LLM 兜底测试用 fake）——只测 DirectionController 类

import fs from 'fs'
import os from 'os'
import path from 'path'
import { DirectionController, resetDirectionControllerForTest } from './direction.js'

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

// 测试用临时目录
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'direction-test-'))
}

// —— 1. 初始化（无 direction.json）返回 null ——
section('1. 初始化无 direction.json')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  assert(d.get() === null, 'get() = null')
  assert(d.injectFor() === '', 'injectFor() = ""')
}

// —— 2. detectRegex 5+ 表达覆盖 ——
section('2. detectRegex 5+ 表达覆盖')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const cases = [
    { msg: '接下来你主攻 CATS-Net 大脑架构', expect: 'CATS-Net 大脑架构' },
    { msg: '接下来重点学一下港股知识', expect: '港股知识' },
    { msg: '你的方向是金融数据分析', expect: '金融数据分析' },
    { msg: '你的方向改为 3D 桌宠', expect: '3D 桌宠' },
    { msg: '最近主攻 self-evolution', expect: 'self-evolution' },
    { msg: '从现在开始专注 投资领域', expect: '投资领域' },
    { msg: '接下来着力于 大脑架构', expect: '大脑架构' },
  ]
  for (const c of cases) {
    const r = d.detectRegex(c.msg)
    assert(r !== null, `regex 命中: ${c.msg}`)
    assert(r && r.topic === c.expect, `topic = ${c.expect} (实际: ${r?.topic})`)
    assert(r && r.confidence === 0.95, 'confidence = 0.95')
    assert(r && r.source === 'regex', 'source = regex')
  }
}

// —— 3. detectRegex 5 个 pattern 全部覆盖 ——
section('3. 5 个 pattern 全部覆盖')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const r1 = d.detectRegex('接下来你主攻 X1')  // pattern 1
  const r2 = d.detectRegex('接下来重点 X2')    // pattern 0
  const r3 = d.detectRegex('你的方向是 X3')     // pattern 2
  const r4 = d.detectRegex('最近主攻 X4')       // pattern 3
  const r5 = d.detectRegex('从现在开始专注 X5') // pattern 4
  assert(r1 && r1.patternIndex === 1, 'pattern 1 命中')
  assert(r2 && r2.patternIndex === 0, 'pattern 0 命中')
  assert(r3 && r3.patternIndex === 2, 'pattern 2 命中')
  assert(r4 && r4.patternIndex === 3, 'pattern 3 命中')
  assert(r5 && r5.patternIndex === 4, 'pattern 4 命中')
}

// —— 4. detectRegex 误命中保护 ——
section('4. detectRegex 误命中保护')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const negatives = [
    '今天天气不错',
    '你好',
    '帮我写个 Python 函数',
    '什么是 CATS-Net',
    '你叫什么',
    '',
    null,
  ]
  for (const msg of negatives) {
    const r = d.detectRegex(msg)
    assert(r === null, `不命中: ${JSON.stringify(msg)}`)
  }
}

// —— 5. detectRegex topic 截断 + 清理 ——
section('5. detectRegex topic 清理')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const r = d.detectRegex('接下来你主攻 港股知识。')
  assert(r && r.topic === '港股知识', `去尾标点: ${r?.topic}`)
  // topic 限长：regex 懒拿 60 字符（与 set 时 60 上限一致）
  const longTopic = 'A'.repeat(50)
  const r2 = d.detectRegex(`接下来你主攻 ${longTopic}`)
  assert(r2 && r2.topic.length === 50, `topic regex 懒拿 50 字 (实际: ${r2?.topic.length})`)
}

// —— 6. set / get round-trip ——
section('6. set / get round-trip')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const r = d.set({ topic: 'CATS-Net 大脑', setBy: 'user' })
  assert(r && r.topic === 'CATS-Net 大脑', 'set 后 get 拿到')
  assert(r && r.setBy === 'user', 'setBy = user')
  assert(typeof r?.since === 'number' && r.since > 0, 'since > 0')
  // 读盘模拟重启
  const d2 = new DirectionController({ dataDir: tmp })
  const g = d2.get()
  assert(g && g.topic === 'CATS-Net 大脑', '新实例 get 持久化值')
}

// —— 7. set by agent ——
section('7. set setBy=agent')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const r = d.set({ topic: 'autonomous learning', setBy: 'agent' })
  assert(r && r.setBy === 'agent', 'setBy=agent 生效')
}

// —— 8. set 拒绝空 / 太短 topic ——
section('8. set 拒绝无效 topic')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  assert(d.set({ topic: '' }) === null, '空 topic 拒绝')
  assert(d.set({ topic: 'A' }) === null, '1 字符 topic 拒绝（< 2）')
  assert(d.set({}) === null, '无 topic 拒绝')
  assert(d.set({ topic: null }) === null, 'null topic 拒绝')
}

// —— 9. clear() ——
section('9. clear()')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  d.set({ topic: 'XX' })
  assert(d.get() !== null, 'set 后 get 不为 null')
  d.clear()
  assert(d.get() === null, 'clear 后 get = null')
  // 持久化
  const d2 = new DirectionController({ dataDir: tmp })
  assert(d2.get() === null, 'clear 持久化生效')
}

// —— 10. injectFor 格式 ——
section('10. injectFor() 格式')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  d.set({ topic: 'CATS-Net 大脑架构', setBy: 'user' })
  const text = d.injectFor()
  assert(text.includes('## 当前学习方向'), '段头 ## 当前学习方向')
  assert(text.includes('CATS-Net 大脑架构'), '含方向 topic')
  assert(text.includes('用户'), 'setBy=user → "用户"')
  assert(text.includes('永久'), '默认过期 = 永久')
}

// —— 11. injectFor 过期时间格式 ——
section('11. injectFor() 过期时间')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const exp = Date.now() + 86400000
  d.set({ topic: 'XX', expiresAt: exp })
  const text = d.injectFor()
  assert(text.includes('过期:'), '包含 "过期:"')
  assert(!text.includes('永久'), '有 expiresAt 时不含"永久"')
}

// —— 12. injectFor setBy=agent ——
section('12. injectFor() setBy=agent')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  d.set({ topic: 'XX', setBy: 'agent' })
  const text = d.injectFor()
  assert(text.includes('agent 自学'), 'setBy=agent → "agent 自学"')
}

// —— 13. 过期自动清理 ——
section('13. 过期自动清理')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  // 写入一个已过期的方向
  d.set({ topic: 'EXPIRED', expiresAt: Date.now() - 1000 })
  // 重新加载应自动清理
  const d2 = new DirectionController({ dataDir: tmp })
  assert(d2.get() === null, '已过期方向自动清理')
}

// —— 14. 持久化 atomic write 不留 .tmp ——
section('14. atomic write 清理 .tmp')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  d.set({ topic: 'XX' })
  d.set({ topic: 'YY' })
  // 不应有 .tmp 残留
  const files = fs.readdirSync(tmp)
  assert(!files.some(f => f.endsWith('.tmp')), '无 .tmp 残留')
  assert(files.includes('direction.json'), '有 direction.json')
}

// —— 15. 损坏文件 fallback null ——
section('15. 损坏文件 fallback null')
{
  const tmp = makeTmpDir()
  fs.writeFileSync(path.join(tmp, 'direction.json'), 'NOT_JSON{{{', 'utf-8')
  const d = new DirectionController({ dataDir: tmp })
  assert(d.get() === null, '损坏 JSON → get = null')
}

// —— 16. 缺字段文件 fallback null ——
section('16. 缺字段文件 fallback null')
{
  const tmp = makeTmpDir()
  fs.writeFileSync(path.join(tmp, 'direction.json'), JSON.stringify({}), 'utf-8')
  const d = new DirectionController({ dataDir: tmp })
  assert(d.get() === null, '{} → get = null')
  fs.writeFileSync(path.join(tmp, 'direction.json'), JSON.stringify({ topic: '' }), 'utf-8')
  const d2 = new DirectionController({ dataDir: tmp })
  assert(d2.get() === null, '空 topic → get = null')
}

// —— 17. detectLLM fake ——
section('17. detectLLM (fake llm)')
{
  const tmp = makeTmpDir()
  const fakeLLM = {
    chat: async ({ system, user }) => {
      return JSON.stringify({ isDirection: true, topic: 'LLM 判别主题', confidence: 0.9 })
    }
  }
  const d = new DirectionController({ dataDir: tmp, llm: fakeLLM })
  const r = await d.detectLLM('我要开始学 X')
  assert(r && r.topic === 'LLM 判别主题', 'fake LLM 返回 topic')
  assert(r && r.confidence === 0.9, 'confidence = 0.9')
  assert(r && r.source === 'llm', 'source = llm')
}

// —— 18. detectLLM confidence 边界 ——
section('18. detectLLM 置信度边界')
{
  const tmp = makeTmpDir()
  const cases = [
    { conf: 0.95, expectPass: true },
    { conf: 0.85, expectPass: true },
    { conf: 0.5, expectPass: true },   // < 0.85 是落库门槛
    { conf: 0.1, expectPass: true },
    { conf: 0, expectPass: true },
  ]
  for (const c of cases) {
    const fakeLLM = {
      chat: async () => JSON.stringify({ isDirection: true, topic: 'T', confidence: c.conf })
    }
    const d = new DirectionController({ dataDir: tmp, llm: fakeLLM })
    const r = await d.detectLLM('test')
    assert(r && r.confidence === c.conf, `confidence ${c.conf} 透传`)
  }
}

// —— 19. detectLLM isDirection=false ——
section('19. detectLLM isDirection=false')
{
  const tmp = makeTmpDir()
  const fakeLLM = {
    chat: async () => JSON.stringify({ isDirection: false, topic: null, confidence: 0.1 })
  }
  const d = new DirectionController({ dataDir: tmp, llm: fakeLLM })
  const r = await d.detectLLM('test')
  assert(r === null, 'isDirection=false → null')
}

// —— 20. detectLLM 无 llm helper ——
section('20. detectLLM 无 llm')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const r = await d.detectLLM('test')
  assert(r === null, 'llm=null 时 detectLLM = null')
}

// —— 21. detect() regex 优先 ——
section('21. detect() regex 优先 (LLM 不被调)')
{
  const tmp = makeTmpDir()
  let llmCalled = false
  const fakeLLM = {
    chat: async () => { llmCalled = true; return JSON.stringify({ isDirection: true, topic: 'X', confidence: 0.9 }) }
  }
  const d = new DirectionController({ dataDir: tmp, llm: fakeLLM })
  const r = await d.detect('接下来你主攻 CATS-Net 大脑架构')
  assert(r && r.source === 'regex', 'regex 命中时 source=regex')
  assert(!llmCalled, 'regex 命中时 LLM 不被调')
}

// —— 22. detect() LLM 兜底 ——
section('22. detect() LLM 兜底 (regex 不命中)')
{
  const tmp = makeTmpDir()
  const fakeLLM = {
    chat: async () => JSON.stringify({ isDirection: true, topic: 'LLM 主题', confidence: 0.92 })
  }
  const d = new DirectionController({ dataDir: tmp, llm: fakeLLM })
  const r = await d.detect('今天天气不错')
  assert(r && r.source === 'llm', 'regex 不命中时 source=llm')
  assert(r && r.topic === 'LLM 主题', 'LLM 主题透传')
}

// —— 23. getDirectionController 单例 ——
section('23. getDirectionController 单例')
{
  resetDirectionControllerForTest()
  const { getDirectionController } = await import('./direction.js')
  const a = getDirectionController()
  const b = getDirectionController()
  assert(a === b, 'getDirectionController 返回同一实例')
}

// —— 24. 静态 import 不含 emotion ——
section('24. 情绪隔离 (direction.js 不 import emotion)')
{
  const src = await import('fs').then(fs => fs.promises.readFile(new URL('./direction.js', import.meta.url), 'utf-8'))
  assert(!src.includes('emotion'), 'direction.js 不含 emotion 字符串')
  assert(!src.includes('joy'), 'direction.js 不含 joy 字符串')
}

// —— 25. injectFor 空字符串（无方向）不进 prompt ——
section('25. injectFor 空字符串（无方向时）')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const text = d.injectFor()
  assert(text === '', '无方向时 injectFor = ""（不渲染段）')
}

// —— 26. topic 60 字截断（边界）——
section('26. topic 60 字截断')
{
  const tmp = makeTmpDir()
  const d = new DirectionController({ dataDir: tmp })
  const long = 'A'.repeat(100)
  d.set({ topic: long })
  const g = d.get()
  assert(g && g.topic.length === 60, `set 限长 60 (实际: ${g?.topic.length})`)
}

console.log(`\n=== DirectionController 测试结果: ${passed} passed, ${failed} failed ===`)
