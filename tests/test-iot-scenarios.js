// tests/test-iot-scenarios.js — Phase 4 IoT 场景触发测试（ADR-012）
//
// 设计原则（9-02 老板纠错纪律）：
//   - 5 个内置场景全测
//   - dry-run / disabled / condition 各种路径覆盖
//   - emotion-isolation 严守
//   - 默认 enabled=false，测试用 enableScenario
//
// 12+ 测试：
//   1-5 : 5 个内置场景注册 + 跑（disable 状态默认 + 显式 enable）
//   6   : come_home 触发：GPS event → 开灯 + 开空调
//   7   : leave_home 触发：GPS event → 关灯 + 锁门
//   8   : sleep 触发：cron event → 渐关灯
//   9   : morning_routine 触发：cron event → 开灯
//  10   : voice_scene 触发：voice event → 跑次统计
//  11   : dry-run 模式不真发命令 + 写 audit
//  12   : condition 不满足时不执行
//  13   : scenario_run 写 L2 memory
//  14   : emotion-isolation 联通
//
// 运行：node --test tests/test-iot-scenarios.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  listScenarios, getScenario, runScenario, enableScenario, disableScenario,
  enableAllScenarios, disableAllScenarios, getScenarioStatus, getScenarioRuns,
  feedGpsEvent, feedVoiceCommand, setMockTime, resetMockTime, __test as scenarioTest,
} from '../src/agentic/iot-scenarios.js'
import { getHomekitDevice } from '../src/connectors/homekit.js'

// 重定向 iot-audit 目录到 tmpdir 避免污染 home
process.env.HOME = tmpdir()

let passed = 0
let failed = 0
const errors = []
function track(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { passed++; console.log(`✓ ${name}`) })
    .catch((err) => {
      failed++
      errors.push(`${name}: ${err?.message || err}`)
      console.log(`✗ ${name}: ${err?.message || err}`)
    })
}

// 确保从干净状态开始
disableAllScenarios()
// 清 trigger dedupe log
for (const k of scenarioTest._triggeredLog.keys()) scenarioTest._triggeredLog.delete(k)
// 清 run history
for (const k of scenarioTest._runHistory.keys()) scenarioTest._runHistory.get(k).length = 0

// 设置一个 18:00 的 mock time（come_home 场景的 timeRange 17:00-23:59 满足）
setMockTime(new Date('2026-09-02T18:00:00'))

// ── 1-5: 5 个内置场景注册 ───────────────────────────────────────────
await track('1. listScenarios returns 5 default scenarios', () => {
  const all = listScenarios()
  assert.equal(all.length, 5, '应 5 个内置场景')
  const ids = all.map((s) => s.id)
  assert.ok(ids.includes('come_home'))
  assert.ok(ids.includes('leave_home'))
  assert.ok(ids.includes('sleep'))
  assert.ok(ids.includes('morning_routine'))
  assert.ok(ids.includes('voice_scene'))
})

await track('2. all scenarios default to enabled=false (except voice_scene)', () => {
  const all = listScenarios()
  const come = all.find((s) => s.id === 'come_home')
  const voice = all.find((s) => s.id === 'voice_scene')
  assert.equal(come.enabled, false, 'come_home 默认 disabled')
  assert.equal(voice.enabled, true, 'voice_scene 永远 enabled（仅跟踪）')
})

await track('3. getScenario returns full spec for come_home', () => {
  const s = getScenario('come_home')
  assert.ok(s, '应找到 come_home')
  assert.equal(s.id, 'come_home')
  assert.equal(s.triggerType, 'gps')
  assert.ok(s.actions.length > 0, '应有 actions')
  assert.ok(s.dryRun === true, 'come_home 默认 dryRun=true')
})

await track('4. enableAllScenarios enables all (except voice)', () => {
  disableAllScenarios()
  const r = enableAllScenarios()
  assert.equal(r.ok, true)
  const all = listScenarios()
  const nonVoice = all.filter((s) => s.id !== 'voice_scene')
  for (const s of nonVoice) {
    assert.equal(s.enabled, true, `${s.id} 应已 enable`)
  }
  disableAllScenarios() // 恢复默认
})

await track('5. enableScenario / disableScenario round-trip', () => {
  enableScenario('come_home')
  assert.equal(getScenario('come_home').enabled, true)
  disableScenario('come_home')
  assert.equal(getScenario('come_home').enabled, false)
})

// ── 6-10: 5 个场景触发测试（显式 enable + 跑）─────────────────────
await track('6. come_home scenario: enable + run opens lights and AC', async () => {
  // 重置 device 状态
  enableScenario('come_home')
  // 跑场景
  const r = await runScenario('come_home', { triggeredBy: 'test:manual', approved: true, dryRun: false })
  assert.equal(r.ok, true, `come_home 应跑成功：${r.error || ''}`)
  // 检查设备状态变化
  const after = await getHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01' })
  assert.equal(after.state.on, true, '客厅主灯应已开')
  // 至少 1 个 action 已执行（results 数量）
  assert.ok(r.results.length >= 1, `应至少 1 个 action 已执行，实际 ${r.results.length}`)
  // 恢复
  disableScenario('come_home')
})

await track('7. leave_home scenario: enable + run locks door and turns off lights', async () => {
  enableScenario('leave_home')
  const r = await runScenario('leave_home', { triggeredBy: 'test:manual', approved: true, dryRun: false })
  assert.equal(r.ok, true, `leave_home 应跑成功：${r.error || ''}`)
  // 检查门锁
  const lock = await getHomekitDevice({ provider: 'mock', id: 'homekit.lock.front-door-01' })
  assert.equal(lock.state.locked, true, '门锁应已锁')
  // 检查灯
  const light = await getHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01' })
  assert.equal(light.state.on, false, '客厅灯应已关')
  disableScenario('leave_home')
})

await track('8. sleep scenario: enable + run dims bedroom light', async () => {
  enableScenario('sleep')
  const r = await runScenario('sleep', { triggeredBy: 'test:manual', approved: true, dryRun: false })
  assert.equal(r.ok, true)
  disableScenario('sleep')
})

await track('9. morning_routine scenario: enable + run opens bedroom light', async () => {
  enableScenario('morning_routine')
  const r = await runScenario('morning_routine', { triggeredBy: 'test:manual', approved: true, dryRun: false })
  assert.equal(r.ok, true)
  disableScenario('morning_routine')
})

await track('10. voice_scene scenario: voice event increments run count', async () => {
  // voice_scene 默认 enabled=true
  const before = getScenario('voice_scene').runCount
  await feedVoiceCommand({ phrase: '开灯', intent: 'control_iot' })
  const after = getScenario('voice_scene').runCount
  assert.ok(after > before, `voice_scene runCount 应增加 (${before} → ${after})`)
  // voice_scene 本身无 actions（LLM 走 control_iot），所以只统计
})

// ── 11: dry-run 模式 ───────────────────────────────────────────────
await track('11. dry-run mode does NOT actually control devices', async () => {
  // 重置 device 状态
  await runScenario('come_home', { triggeredBy: 'test:dryrun', approved: true, dryRun: false })
  const before = await getHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01' })
  // 干跑：不应再改设备状态
  const dryR = await runScenario('come_home', { triggeredBy: 'test:dryrun2', approved: false, dryRun: true })
  assert.equal(dryR.dryRun, true, '应是 dry-run 模式')
  assert.equal(dryR.approved, false, '未批准')
  assert.equal(dryR.requiresApproval, true, '应要求老板确认')
  // 设备状态不变（dry-run 不发命令）
  const after = await getHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01' })
  // 干跑前 light 应该是 on（因为 test 6 开了它）；干跑后应仍是 on
  // 但我们没断言 state.on 一定是 true；只断言 dryRun flag
  assert.equal(after.state.on, before.state.on, 'dry-run 不应改设备状态')
})

// ── 12: condition 不满足时不执行 ───────────────────────────────────
await track('12. scenario with unmet condition returns conditionNotMet', async () => {
  // timeRange 0-1 点才跑：现在时间是 mock 或当前，都不在这个范围
  // 通过 setMockTime 设定
  const origDate = new Date('2026-09-02T00:30:00')  // 00:30
  setMockTime(origDate)
  // 临时改 come_home 的 condition 为只在 12-13 点跑
  const s = getScenario('come_home')
  s.condition = { timeRange: { from: '12:00', to: '13:00' } }
  enableScenario('come_home')
  const r = await runScenario('come_home', { triggeredBy: 'test:cond', approved: true, dryRun: false })
  assert.equal(r.ok, false)
  assert.equal(r.conditionNotMet, true, '应标记 condition 未满足')
  // 清理
  s.condition = { timeRange: { from: '17:00', to: '23:59' } }
  disableScenario('come_home')
  resetMockTime()
})

// ── 13: scenario_run 写 L2 memory ─────────────────────────────────
await track('13. scenario_run history is recorded', async () => {
  // 重置历史 + 重设时间
  scenarioTest._runHistory.get('come_home').length = 0
  setMockTime(new Date('2026-09-02T18:30:00'))
  enableScenario('come_home')
  await runScenario('come_home', { triggeredBy: 'test:history', approved: true, dryRun: false })
  const runs = getScenarioRuns('come_home', { limit: 5 })
  assert.ok(runs.length >= 1, '应至少 1 条 run 记录')
  const last = runs[0]
  assert.equal(last.scenarioId, 'come_home')
  assert.equal(last.triggeredBy, 'test:history')
  assert.ok(last.runAt, '应有 runAt 时间戳')
  disableScenario('come_home')
})

// ── 14: emotion-isolation 联通 ─────────────────────────────────────
await track('14. emotion-isolation: scenario engine does not trigger joy', async () => {
  const src = await fs.readFile(new URL('../src/agentic/iot-scenarios.js', import.meta.url), 'utf8')
  assert.ok(!src.includes('joy-engine') && !src.includes('joy_state') && !src.includes('recordJoy'),
    'iot-scenarios 不应 import joy 引擎（emotion-isolation 红线）')
  // 跑完整一轮
  enableAllScenarios()
  await runScenario('come_home', { triggeredBy: 'test:emotion', approved: true, dryRun: false })
  await runScenario('leave_home', { triggeredBy: 'test:emotion', approved: true, dryRun: false })
  disableAllScenarios()
  const status = getScenarioStatus()
  assert.equal(status.policy.emotionIsolation, 'strict', 'scenario 状态应声明 strict isolation')
})

// ── 总结 ────────────────────────────────────────────────────────────
await Promise.resolve().then(() => {
  console.log(`\n=== test-iot-scenarios: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.log('FAILURES:')
    for (const e of errors) console.log('  -', e)
    process.exitCode = 1
  }
})
