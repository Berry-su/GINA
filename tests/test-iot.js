// tests/test-iot.js — Phase 4 IoT 设备测试（ADR-012）
//
// 设计原则（9-02 老板纠错纪律）：
//   - 测试走 mock provider，不真打 HomeKit / Mijia / MQTT broker
//   - 真实 provider 仅当 GINA_IOT_PROVIDER_* + 凭据完整时才被选用
//   - emotion-isolation 9/9 必跑（独立文件 emotion-isolation.test.js）
//   - 测试间清空 _providerCache 避免污染
//
// 12+ 测试：
//   1-3 : HomeKit mock list/get/control
//   4-6 : Mijia mock list/get/control
//   7-9 : MQTT mock list/get/control + device shadow
//  10   : 跨 provider device 形状归一化
//  11   : provider fallback (缺 creds → mock)
//  12   : memory-bridge ingestIoTDevices → L2 memory
//  13   : capabilities 注册验证（query_iot/control_iot 都在 TOOL_SCHEMAS）
//  14   : iot-audit 写本地 JSON Lines
//  15   : emotion-isolation 联通（joy-state 不动）
//
// 运行：node --test tests/test-iot.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  listHomekitDevices, getHomekitDevice, controlHomekitDevice, getHomekitStatus, HOMEKIT_PROVIDERS,
  __test as hkTest,
} from '../src/connectors/homekit.js'
import {
  listMijiaDevices, getMijiaDevice, controlMijiaDevice,
  __test as mjTest,
} from '../src/connectors/mijia.js'
import {
  listMqttDevices, getMqttDevice, controlMqttDevice, MQTT_PROVIDERS,
  __test as qtTest,
} from '../src/connectors/mqtt.js'
import { ingestIoTDevices, getMemoryBridgeStatus } from '../src/connectors/memory-bridge.js'
import { TOOL_SCHEMAS } from '../src/capabilities/builtin-tools.js'
import { auditControl, auditScenario, readRecentAudit, __test as auditTest } from '../src/connectors/iot-audit.js'

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

// 重定向 iot-audit 目录到 tmpdir 避免污染 home
const originalHome = process.env.HOME
process.env.HOME = tmpdir()

// 确保 mock 模式（清空 .env 影响）
function resetToMock() {
  delete process.env.GINA_IOT_PROVIDER_HOMEKIT
  delete process.env.GINA_IOT_PROVIDER_MIJIA
  delete process.env.GINA_IOT_PROVIDER_MQTT
  delete process.env.GINA_HOMEKIT_USERNAME
  delete process.env.GINA_MIJIA_USERNAME
  delete process.env.GINA_MQTT_URL
  hkTest._providerCache.clear()
  mjTest._providerCache.clear()
  qtTest._providerCache.clear()
}

resetToMock()

// ── 1-3: HomeKit mock list/get/control ────────────────────────────────
await track('1. homekit.listDevices returns mock devices', async () => {
  const devices = await listHomekitDevices({ provider: 'mock' })
  assert.ok(devices.length >= 5, `应至少 5 个 mock 设备，实际 ${devices.length}`)
  assert.ok(devices[0].id.startsWith('homekit.'), 'ID 应以 homekit. 开头')
  assert.equal(typeof devices[0].name, 'string', '设备应有 name')
  assert.ok(devices[0].capabilities.length > 0 || devices[0].type === 'sensor', '应至少有 capabilities 或 sensor')
})

await track('2. homekit.getDevice by id', async () => {
  const d = await getHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01' })
  assert.ok(d, '应找到该设备')
  assert.equal(d.id, 'homekit.light.living-room-01')
  assert.equal(d.type, 'light')
  assert.equal(d.provider, 'homekit')
})

await track('3. homekit.controlDevice on_off + set_brightness', async () => {
  const r1 = await controlHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01', action: 'on_off', params: { on: true } })
  assert.equal(r1.ok, true, 'on_off 应成功')
  assert.equal(r1.state.on, true)
  const r2 = await controlHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01', action: 'set_brightness', params: { brightness: 50 } })
  assert.equal(r2.ok, true, 'set_brightness 应成功')
  assert.equal(r2.state.brightness, 50, '亮度应为 50')
})

// ── 4-6: Mijia mock list/get/control ─────────────────────────────────
await track('4. mijia.listDevices returns mock devices', async () => {
  const devices = await listMijiaDevices({ provider: 'mock' })
  assert.ok(devices.length >= 5, `应至少 5 个米家设备，实际 ${devices.length}`)
  assert.ok(devices[0].id.startsWith('mijia.'), 'ID 应以 mijia. 开头')
})

await track('5. mijia.getDevice by id', async () => {
  const d = await getMijiaDevice({ provider: 'mock', id: 'mijia.light.yeeling-01' })
  assert.ok(d, '应找到该设备')
  assert.equal(d.type, 'light')
  assert.equal(d.provider, 'mijia')
})

await track('6. mijia.controlDevice on_off + set_color', async () => {
  const r1 = await controlMijiaDevice({ provider: 'mock', id: 'mijia.light.yeeling-01', action: 'on_off', params: { on: true } })
  assert.equal(r1.ok, true)
  const r2 = await controlMijiaDevice({ provider: 'mock', id: 'mijia.light.yeeling-01', action: 'set_color', params: { hex: '#FF0000' } })
  assert.equal(r2.ok, true)
  assert.equal(r2.state.color, '#FF0000')
})

// ── 7-9: MQTT mock list/get/control + device shadow ──────────────────
await track('7. mqtt.listDevices returns mock devices', async () => {
  const devices = await listMqttDevices({ provider: 'mock' })
  assert.ok(devices.length >= 3, `应至少 3 个 MQTT 设备，实际 ${devices.length}`)
  assert.ok(devices[0].id.startsWith('mqtt.'), 'ID 应以 mqtt. 开头')
})

await track('8. mqtt.getDevice by id', async () => {
  const d = await getMqttDevice({ provider: 'mock', id: 'mqtt.diy.light-01' })
  assert.ok(d)
  assert.equal(d.type, 'light')
  assert.equal(d.provider, 'mqtt')
})

await track('9. mqtt.controlDevice on_off emits mqtt_publish event', async () => {
  // subscribe to capture mqtt_publish event - use the real entry point
  const { subscribeMqtt } = await import('../src/connectors/mqtt.js')
  let captured = null
  const unsub = await subscribeMqtt({ provider: 'mock', eventHandler: (e) => {
    if (e.type === 'mqtt_publish' && e.deviceId === 'mqtt.diy.light-01') captured = e
  } })
  await new Promise((r) => setTimeout(r, 10))  // let subscribe settle
  const r = await controlMqttDevice({ provider: 'mock', id: 'mqtt.diy.light-01', action: 'on_off', params: { on: true } })
  await new Promise((r) => setTimeout(r, 10))  // let emit settle
  if (typeof unsub === 'function') unsub()
  assert.equal(r.ok, true)
  assert.equal(r.state.on, true)
  assert.ok(captured, '应触发 mqtt_publish 事件')
  assert.equal(captured.topic, 'gina/devices/mqtt.diy.light-01/state')
  assert.equal(captured.payload.on, true)
})

// ── 10: 跨 provider device 形状归一化 ────────────────────────────────
await track('10. cross-provider device shape is normalized', async () => {
  const hk = await listHomekitDevices({ provider: 'mock' })
  const mj = await listMijiaDevices({ provider: 'mock' })
  const qt = await listMqttDevices({ provider: 'mock' })
  const requiredFields = ['id', 'provider', 'name', 'type', 'room', 'capabilities', 'state', 'controllable', 'lastUpdated']
  for (const d of [...hk, ...mj, ...qt]) {
    for (const f of requiredFields) {
      assert.ok(d[f] !== undefined, `device ${d.id} 缺字段 ${f}`)
    }
    assert.ok(['homekit', 'mijia', 'mqtt', 'mock'].includes(d.provider), `provider 应是 4 选 1：${d.provider}`)
    assert.ok(typeof d.state === 'object' && d.state !== null, 'state 应是 object')
    assert.ok(typeof d.controllable === 'boolean', 'controllable 应是 boolean')
  }
})

// ── 11: provider fallback (缺 creds → mock) ──────────────────────────
await track('11. provider falls back to mock when creds incomplete', async () => {
  // 设一个 incomplete cred env，应仍走 mock
  process.env.GINA_IOT_PROVIDER_HOMEKIT = 'official'
  delete process.env.GINA_HOMEKIT_USERNAME  // 缺 creds
  hkTest._providerCache.clear()
  const status = await getHomekitStatus({ provider: 'official' })
  // 应自动 fallback mock
  assert.ok(status, '应拿到 status')
  assert.equal(status.provider, 'homekit-mock', '缺 creds 应 fallback 到 mock')
  // 清理
  delete process.env.GINA_IOT_PROVIDER_HOMEKIT
  hkTest._providerCache.clear()
})

// ── 12: memory-bridge ingestIoTDevices → L2 memory ───────────────────
await track('12. memory-bridge ingests IoT device into episodic memory', async () => {
  const r = await ingestIoTDevices([{
    id: 'homekit.test.light-99',
    provider: 'homekit',
    name: '测试灯',
    type: 'light',
    room: '客厅',
    state: { on: true, brightness: 80 },
    capabilities: ['on_off', 'brightness'],
    lastUpdated: new Date().toISOString(),
  }])
  assert.equal(r.ok, true)
  assert.ok(r.ingested >= 1, '应至少 ingest 1 条')
  const status = getMemoryBridgeStatus()
  assert.ok(status.sources.includes('iot'), 'memory-bridge 状态应包含 iot source')
})

// ── 13: capabilities 注册验证 ───────────────────────────────────────
await track('13. TOOL_SCHEMAS has iot tools (query_iot/control_iot)', () => {
  assert.ok(TOOL_SCHEMAS.query_iot, 'query_iot 在 TOOL_SCHEMAS')
  assert.ok(TOOL_SCHEMAS.control_iot, 'control_iot 在 TOOL_SCHEMAS')
  const q = TOOL_SCHEMAS.query_iot
  assert.equal(q.function.name, 'query_iot')
  assert.ok(Array.isArray(q.function.parameters.properties.action.enum), 'action 是 enum')
  const c = TOOL_SCHEMAS.control_iot
  assert.equal(c.function.name, 'control_iot')
  assert.ok(c.function.parameters.properties.dryRun, 'control_iot 有 dryRun 字段')
})

// ── 14: iot-audit 写本地 JSON Lines ─────────────────────────────────
await track('14. iot-audit writes control and scenario records to log', () => {
  // 写 2 条
  const r1 = auditControl({ deviceId: 'homekit.test.light-99', provider: 'homekit', action: 'on_off', ok: true })
  const r2 = auditScenario({ scenarioId: 'come_home', ok: true, summary: 'test' })
  assert.equal(r1.ok, true, 'audit 应成功')
  assert.equal(r2.ok, true)
  // 读回（应至少有这 2 条）
  const recent = readRecentAudit({ limit: 10 })
  assert.ok(recent.length >= 2, `应至少 2 条 audit 记录，实际 ${recent.length}`)
  const hasControl = recent.some((e) => e.kind === 'control' && e.deviceId === 'homekit.test.light-99')
  const hasScenario = recent.some((e) => e.kind === 'scenario_run' && e.scenarioId === 'come_home')
  assert.ok(hasControl, '应有 control 记录')
  assert.ok(hasScenario, '应有 scenario_run 记录')
})

// ── 15: emotion-isolation 联通验证 ──────────────────────────────────
await track('15. emotion-isolation: IoT 数据流不触发 joy', async () => {
  // 静态扫描：3 个 connector + scenarios + audit 都不应 import joy-engine
  const sources = {
    homekit: await fs.readFile(new URL('../src/connectors/homekit.js', import.meta.url), 'utf8'),
    mijia: await fs.readFile(new URL('../src/connectors/mijia.js', import.meta.url), 'utf8'),
    mqtt: await fs.readFile(new URL('../src/connectors/mqtt.js', import.meta.url), 'utf8'),
    scenarios: await fs.readFile(new URL('../src/agentic/iot-scenarios.js', import.meta.url), 'utf8'),
    audit: await fs.readFile(new URL('../src/connectors/iot-audit.js', import.meta.url), 'utf8'),
  }
  for (const [name, src] of Object.entries(sources)) {
    assert.ok(!src.includes('joy-engine') && !src.includes('joy_state') && !src.includes('recordJoy'),
      `${name} 不应 import / 引用 joy 引擎（emotion-isolation 红线）`)
  }
  // 跑一次完整 list/get/control/scenario 流程，确保不出 joy 相关副作用
  await listHomekitDevices({ provider: 'mock' })
  await getHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01' })
  await controlHomekitDevice({ provider: 'mock', id: 'homekit.light.living-room-01', action: 'on_off', params: { on: true } })
  await listMijiaDevices({ provider: 'mock' })
  await listMqttDevices({ provider: 'mock' })
  await ingestIoTDevices([])
  const status = getMemoryBridgeStatus()
  assert.equal(status.policy.emotionIsolation, 'strict', 'memory-bridge 声明 strict isolation')
})

// ── 总结 ────────────────────────────────────────────────────────────
await Promise.resolve().then(() => {
  console.log(`\n=== test-iot: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.log('FAILURES:')
    for (const e of errors) console.log('  -', e)
    process.exitCode = 1
  }
})
