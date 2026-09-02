// src/connectors/_mock-iot.js — IoT 三家 provider 的 mock 工厂（ADR-012 · Phase 4）
//
// 共享 mock 实现：3 个 provider 都用同一份"假智能家居"基础设施，
// 但 devices 列表不同（避免重名 ID 跨 provider 冲突）。
//
// 暴露：
//   - homekitMockProvider  : 5 个假设备（light × 2 + ac + lock + sensor）
//   - mijiaMockProvider    : 5 个假设备（light + outlet + vacuum + curtain + sensor）
//   - mqttMockProvider     : 3 个假设备（DIY 灯 + 温感 + relay）

import { makeHomekitMockProvider } from './homekit.js'

// ── HomeKit mock：5 设备 ───────────────────────────────────────────────
const homekitSeedDevices = [
  { id: 'homekit.light.living-room-01', name: '客厅主灯', type: 'light', room: '客厅', roomId: 'room-living', homeId: 'home-default', capabilities: ['on_off', 'brightness', 'color_temp'], state: { on: false, brightness: 80, colorTemp: 4000, online: true } },
  { id: 'homekit.light.bedroom-01',    name: '卧室灯',   type: 'light', room: '卧室', roomId: 'room-bedroom', homeId: 'home-default', capabilities: ['on_off', 'brightness'], state: { on: false, brightness: 60, online: true } },
  { id: 'homekit.ac.bedroom-01',       name: '卧室空调', type: 'ac',    room: '卧室', roomId: 'room-bedroom', homeId: 'home-default', capabilities: ['on_off', 'set_temperature', 'set_fan_speed'], state: { on: false, temperature: 24, raw: { mode: 'cool' }, online: true } },
  { id: 'homekit.lock.front-door-01',  name: '前门门锁', type: 'lock',  room: '客厅', roomId: 'room-living', homeId: 'home-default', capabilities: ['lock'], state: { locked: true, battery: 87, online: true } },
  { id: 'homekit.sensor.living-room-01', name: '客厅温湿度', type: 'sensor', room: '客厅', roomId: 'room-living', homeId: 'home-default', capabilities: [], state: { temperature: 22, humidity: 55, battery: 92, online: true } },
]
export function homekitMockProvider() {
  return makeHomekitMockProvider({ initialDevices: homekitSeedDevices })
}

// ── 米家 mock：5 设备 ──────────────────────────────────────────────────
function makeMijiaMockProvider({ initialDevices = [] } = {}) {
  const rooms = [
    { id: 'room-living', name: '客厅' },
    { id: 'room-bedroom', name: '卧室' },
    { id: 'room-kitchen', name: '厨房' },
  ]
  const homes = [{ id: 'home-default', name: '我的家' }]

  const defaultDevices = [
    {
      id: 'mijia.light.yeeling-01',
      name: 'Yeelight 客厅彩灯',
      type: 'light',
      room: '客厅',
      roomId: 'room-living',
      homeId: 'home-default',
      capabilities: ['on_off', 'brightness', 'color'],
      state: { on: false, brightness: 75, color: '#FFAA00', online: true },
    },
    {
      id: 'mijia.outlet.kitchen-01',
      name: '厨房插座',
      type: 'outlet',
      room: '厨房',
      roomId: 'room-kitchen',
      homeId: 'home-default',
      capabilities: ['on_off'],
      state: { on: true, power: 12.5, online: true }, // 12.5W 当前功耗
    },
    {
      id: 'mijia.vacuum.living-room-01',
      name: '扫地机器人',
      type: 'vacuum',
      room: '客厅',
      roomId: 'room-living',
      homeId: 'home-default',
      capabilities: ['pause', 'resume'],
      state: { on: false, battery: 78, online: true, raw: { status: 'docked' } },
    },
    {
      id: 'mijia.curtain.bedroom-01',
      name: '卧室窗帘',
      type: 'curtain',
      room: '卧室',
      roomId: 'room-bedroom',
      homeId: 'home-default',
      capabilities: ['pause', 'resume'],
      state: { on: false, raw: { position: 50, targetPosition: 50 }, online: true }, // 50% 开
    },
    {
      id: 'mijia.sensor.bedroom-01',
      name: '卧室空气',
      type: 'sensor',
      room: '卧室',
      roomId: 'room-bedroom',
      homeId: 'home-default',
      capabilities: [],
      state: { temperature: 23, humidity: 50, battery: 88, online: true, raw: { pm25: 12 } },
    },
  ]

  const devices = new Map()
  let counter = 1
  for (const d of [...defaultDevices, ...initialDevices]) {
    const id = d.id || `mijia.dev-${counter++}`
    devices.set(id, { ...d, id, lastUpdated: d.lastUpdated || new Date().toISOString() })
  }
  const eventHandlers = new Set()
  function emit(event) {
    for (const h of eventHandlers) {
      try { h(event) } catch { /* single handler failure does not block */ }
    }
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

  return {
    kind: 'mock',
    label: 'mijia-mock',
    listRooms: async () => rooms.map((r) => ({ ...r })),
    listDevices: async ({ room, type } = {}) => {
      const out = []
      for (const d of devices.values()) {
        if (room && d.room !== room) continue
        if (type && d.type !== type) continue
        out.push({
          id: d.id, provider: 'mijia', name: d.name, type: d.type, room: d.room,
          roomId: d.roomId, homeId: d.homeId, capabilities: d.capabilities,
          state: {
            on: d.state.on !== undefined ? d.state.on : null,
            brightness: d.state.brightness ?? null,
            color: d.state.color ?? null,
            temperature: d.state.temperature ?? null,
            humidity: d.state.humidity ?? null,
            battery: d.state.battery ?? null,
            power: d.state.power ?? null,
            online: d.state.online !== false,
            raw: d.state.raw || null,
          },
          controllable: d.controllable !== false,
          lastUpdated: d.lastUpdated,
          raw: d.raw || null,
        })
      }
      return out
    },
    getDevice: async (id) => {
      const d = devices.get(id)
      if (!d) return null
      // 内联 listDevices 逻辑（避免 this 上下文问题）
      return {
        id: d.id, provider: 'mijia', name: d.name, type: d.type, room: d.room,
        roomId: d.roomId, homeId: d.homeId, capabilities: d.capabilities,
        state: {
          on: d.state.on !== undefined ? d.state.on : null,
          brightness: d.state.brightness ?? null,
          color: d.state.color ?? null,
          temperature: d.state.temperature ?? null,
          humidity: d.state.humidity ?? null,
          battery: d.state.battery ?? null,
          power: d.state.power ?? null,
          online: d.state.online !== false,
          raw: d.state.raw || null,
        },
        controllable: d.controllable !== false,
        lastUpdated: d.lastUpdated,
        raw: d.raw || null,
      }
    },
    controlDevice: async (id, action, params = {}) => {
      const d = devices.get(id)
      if (!d) return { ok: false, error: `device ${id} not found`, provider: 'mijia' }
      if (d.controllable === false) return { ok: false, error: `device ${id} not controllable`, provider: 'mijia' }
      if (action === 'on_off') {
        d.state.on = Boolean(params.on)
      } else if (action === 'set_brightness') {
        d.state.brightness = clamp(Number(params.brightness) || 0, 0, 100)
        if (d.state.brightness > 0) d.state.on = true
      } else if (action === 'set_color') {
        d.state.color = String(params.hex || '#FFFFFF')
      } else if (action === 'pause' || action === 'resume') {
        d.state.raw = { ...(d.state.raw || {}), status: action === 'pause' ? 'paused' : 'running' }
        d.state.on = action === 'resume'
      } else {
        return { ok: false, error: `unknown action ${action}`, provider: 'mijia' }
      }
      d.lastUpdated = new Date().toISOString()
      emit({ type: 'device_state_changed', deviceId: id, state: { ...d.state }, at: d.lastUpdated })
      return { ok: true, state: { ...d.state }, provider: 'mijia' }
    },
    subscribe: async (eventHandler) => {
      eventHandlers.add(eventHandler)
      return () => eventHandlers.delete(eventHandler)
    },
    getStatus: async () => ({
      ok: true,
      provider: 'mijia-mock',
      deviceCount: devices.size,
      homeCount: homes.length,
      lastUpdate: new Date().toISOString(),
    }),
    __test: { devices, eventHandlers, emit },
  }
}
export function mijiaMockProvider() {
  return makeMijiaMockProvider()
}

// ── MQTT mock：3 设备 + device shadow 同步 ────────────────────────────
function makeMqttMockProvider({ initialDevices = [] } = {}) {
  const defaultDevices = [
    {
      id: 'mqtt.diy.light-01',
      name: 'ESP32 DIY 灯',
      type: 'light',
      room: '工作室',
      roomId: 'room-office',
      homeId: 'mqtt-broker',
      capabilities: ['on_off', 'set_brightness'],
      state: { on: false, brightness: 50, online: true },
    },
    {
      id: 'mqtt.diy.sensor-01',
      name: 'DHT22 温湿度',
      type: 'sensor',
      room: '工作室',
      roomId: 'room-office',
      homeId: 'mqtt-broker',
      capabilities: [],
      state: { temperature: 21, humidity: 48, online: true, battery: 100 },
    },
    {
      id: 'mqtt.diy.relay-01',
      name: '继电器 01',
      type: 'switch',
      room: '工作室',
      roomId: 'room-office',
      homeId: 'mqtt-broker',
      capabilities: ['on_off'],
      state: { on: false, online: true },
    },
  ]
  const devices = new Map()
  let counter = 1
  for (const d of [...defaultDevices, ...initialDevices]) {
    const id = d.id || `mqtt.dev-${counter++}`
    devices.set(id, { ...d, id, lastUpdated: d.lastUpdated || new Date().toISOString() })
  }
  const eventHandlers = new Set()
  function emit(event) {
    for (const h of eventHandlers) {
      try { h(event) } catch { /* ignore */ }
    }
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

  return {
    kind: 'mock',
    label: 'mqtt-mock',
    listRooms: async () => [{ id: 'room-office', name: '工作室' }],
    listDevices: async ({ room, type } = {}) => {
      const out = []
      for (const d of devices.values()) {
        if (room && d.room !== room) continue
        if (type && d.type !== type) continue
        out.push({
          id: d.id, provider: 'mqtt', name: d.name, type: d.type, room: d.room,
          roomId: d.roomId, homeId: d.homeId, capabilities: d.capabilities,
          state: {
            on: d.state.on !== undefined ? d.state.on : null,
            brightness: d.state.brightness ?? null,
            temperature: d.state.temperature ?? null,
            humidity: d.state.humidity ?? null,
            battery: d.state.battery ?? null,
            online: d.state.online !== false,
            raw: d.state.raw || null,
          },
          controllable: d.controllable !== false,
          lastUpdated: d.lastUpdated,
          raw: d.raw || null,
        })
      }
      return out
    },
    getDevice: async (id) => {
      const d = devices.get(id)
      if (!d) return null
      return {
        id: d.id, provider: 'mqtt', name: d.name, type: d.type, room: d.room,
        roomId: d.roomId, homeId: d.homeId, capabilities: d.capabilities,
        state: {
          on: d.state.on !== undefined ? d.state.on : null,
          brightness: d.state.brightness ?? null,
          temperature: d.state.temperature ?? null,
          humidity: d.state.humidity ?? null,
          battery: d.state.battery ?? null,
          online: d.state.online !== false,
          raw: d.state.raw || null,
        },
        controllable: d.controllable !== false,
        lastUpdated: d.lastUpdated,
        raw: d.raw || null,
      }
    },
    controlDevice: async (id, action, params = {}) => {
      const d = devices.get(id)
      if (!d) return { ok: false, error: `device ${id} not found`, provider: 'mqtt' }
      if (d.controllable === false) return { ok: false, error: `device ${id} not controllable`, provider: 'mqtt' }
      if (action === 'on_off') {
        d.state.on = Boolean(params.on)
      } else if (action === 'set_brightness') {
        d.state.brightness = clamp(Number(params.brightness) || 0, 0, 100)
        if (d.state.brightness > 0) d.state.on = true
      } else {
        return { ok: false, error: `unknown action ${action}`, provider: 'mqtt' }
      }
      d.lastUpdated = new Date().toISOString()
      // MQTT device shadow：先 update shadow，再模拟 publish
      emit({ type: 'mqtt_publish', deviceId: id, topic: `gina/devices/${id}/state`, payload: { ...d.state }, at: d.lastUpdated })
      emit({ type: 'device_state_changed', deviceId: id, state: { ...d.state }, at: d.lastUpdated })
      return { ok: true, state: { ...d.state }, provider: 'mqtt' }
    },
    subscribe: async (eventHandler) => {
      eventHandlers.add(eventHandler)
      return () => eventHandlers.delete(eventHandler)
    },
    getStatus: async () => ({
      ok: true,
      provider: 'mqtt-mock',
      deviceCount: devices.size,
      brokerUrl: 'mock://broker:1883',
      lastUpdate: new Date().toISOString(),
    }),
    __test: { devices, eventHandlers, emit },
  }
}
export function mqttMockProvider() {
  return makeMqttMockProvider()
}
