// Weather monitor tests (25+ tests).
//
// Run: node --test tests/test-weather-monitor.js

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-weather-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const w = await import('../src/perception/weather-monitor/index.js')

// ─── helpers ───────────────────────────────────────────────

function makeWttr(overrides = {}) {
  return {
    source: 'wttr.in',
    fetchedAt: Date.now(),
    location: 'Shenzhen',
    current: {
      temp: 25,
      feelsLike: 26,
      humidity: 60,
      windSpeed: 10,
      weather: 'sunny',
      precip: 0,
    },
    forecast: [
      { date: '2026-09-07', max: 30, min: 22, weather: 'sunny', precip: 0, rainChance: 10 },
    ],
    ...overrides,
  }
}

function makeNMCAlerts(alerts) {
  return Array.isArray(alerts) ? alerts : []
}

// ─── weather-fetcher — 4 tests ────────────────────────────

test('fetcher: fetchWttr with mock fetcher', async () => {
  const mockWttrData = {
    current_condition: [{
      temp_C: '25',
      FeelsLikeC: '26',
      humidity: '60',
      windspeedKmph: '10',
      weatherDesc: [{ value: 'Sunny' }],
      lang_zh: [{ value: '晴' }],
      precipMM: '0',
    }],
    weather: [{ date: '2026-09-07', maxtempC: '30', mintempC: '22', hourly: [{ time: '300', lang_zh: [{ value: '晴' }], precipMM: '0', chanceofrain: '10' }] }],
  }
  const fetcher = async () => ({ ok: true, status: 200, json: async () => mockWttrData })
  const r = await w.fetchWttr('Shenzhen', { fetcher })
  assert.equal(r.error, null)
  assert.equal(r.normalized.current.temp, 25)
  assert.equal(r.normalized.current.weather, '晴')
})

test('fetcher: fetchWttr with HTTP error', async () => {
  const fetcher = async () => ({ ok: false, status: 500, json: async () => ({}) })
  const r = await w.fetchWttr('Shenzhen', { fetcher })
  assert.ok(r.error)
  assert.match(r.error, /HTTP 500/)
})

test('fetcher: normalizeNMCAlerts detects 7 types', () => {
  const data = [
    { id: '1', title: '暴雨橙色预警', level: 'orange', region: '深圳', publishedAt: '2026-09-07' },
    { id: '2', title: '雷电黄色预警', level: 'yellow', region: '深圳', publishedAt: '2026-09-07' },
    { id: '3', title: '冰雹预警', level: 'red', region: '深圳', publishedAt: '2026-09-07' },
    { id: '4', title: '台风蓝色预警', level: 'blue', region: '南海', publishedAt: '2026-09-07' },
    { id: '5', title: '高温红色预警', level: 'red', region: '深圳', publishedAt: '2026-09-07' },
    { id: '6', title: '寒潮蓝色预警', level: 'blue', region: '深圳', publishedAt: '2026-09-07' },
    { id: '7', title: '大风橙色预警', level: 'orange', region: '深圳', publishedAt: '2026-09-07' },
  ]
  const alerts = w.normalizeNMCAlerts(data)
  assert.equal(alerts.length, 7)
  const types = new Set(alerts.map(a => a.type))
  assert.ok(types.has('rainstorm'))
  assert.ok(types.has('thunderstorm'))
  assert.ok(types.has('hail'))
  assert.ok(types.has('typhoon'))
  assert.ok(types.has('high_temp'))
  assert.ok(types.has('cold_wave'))
  assert.ok(types.has('wind'))
})

test('fetcher: fetchOnce multi-source', async () => {
  const mockWttr = {
    current_condition: [{ temp_C: '25', weatherDesc: [{ value: 'Sunny' }] }],
    weather: [],
  }
  const fetcher = async (url) => {
    if (url.includes('wttr.in')) {
      return { ok: true, status: 200, json: async () => mockWttr }
    }
    return { ok: true, status: 200, json: async () => [] }
  }
  const r = await w.fetchOnce({ location: 'Shenzhen', nmcUrl: 'https://example.com/alerts', fetcher })
  assert.ok(r.wttr)
  assert.ok(Array.isArray(r.nmc))
})

// ─── extreme-detector — 12 tests ─────────────────────────

test('detector: 7 types defined', () => {
  assert.equal(w.EXTREME_TYPES.length, 7)
  for (const t of ['high_temp', 'low_temp', 'cold_wave', 'rainstorm', 'thunderstorm', 'hail', 'wind']) {
    assert.ok(w.EXTREME_TYPES.includes(t))
  }
})

test('high_temp: 35°C → warning', () => {
  const wttr = makeWttr({ current: { temp: 35, windSpeed: 5, precip: 0 } })
  const r = w.detectAll({ wttr, location: 'Shenzhen' })
  const a = r.alerts.find(x => x.type === 'high_temp')
  assert.ok(a)
  assert.equal(a.severity, 'warning')
})

test('high_temp: 40°C → extreme', () => {
  const wttr = makeWttr({ current: { temp: 41, windSpeed: 5, precip: 0 } })
  const r = w.detectAll({ wttr, location: 'Shenzhen' })
  const a = r.alerts.find(x => x.type === 'high_temp')
  assert.ok(a)
  assert.equal(a.severity, 'extreme')
})

test('low_temp: -5°C → severe', () => {
  const wttr = makeWttr({ current: { temp: -5, windSpeed: 5, precip: 0 } })
  const r = w.detectAll({ wttr, location: 'Beijing' })
  const a = r.alerts.find(x => x.type === 'low_temp')
  assert.ok(a)
  assert.equal(a.severity, 'severe')
})

test('low_temp: -15°C → extreme', () => {
  const wttr = makeWttr({ current: { temp: -15, windSpeed: 5, precip: 0 } })
  const r = w.detectAll({ wttr, location: 'Harbin' })
  const a = r.alerts.find(x => x.type === 'low_temp')
  assert.ok(a)
  assert.equal(a.severity, 'extreme')
})

test('cold_wave: 24h drop >= 10°C', () => {
  const r = w.detectColdWave(20, 8)  // 20 → 8 = 12°C 降
  assert.ok(r)
  assert.equal(r.severity, 'severe')
})

test('rainstorm: 24h precip >= 50mm', () => {
  const wttr = makeWttr({ forecast: [{ precip: 75, weather: 'rainstorm' }], current: { temp: 22, precip: 0 } })
  const r = w.detectAll({ wttr })
  const a = r.alerts.find(x => x.type === 'rainstorm')
  assert.ok(a)
  assert.equal(a.severity, 'severe')
})

test('rainstorm: 1h precip >= 16mm', () => {
  const wttr = makeWttr({ current: { temp: 22, precip: 20, windSpeed: 5 }, forecast: [] })
  const r = w.detectAll({ wttr })
  const a = r.alerts.find(x => x.type === 'rainstorm')
  assert.ok(a)
})

test('thunderstorm: from NMC alert', () => {
  const nmc = [{ id: '1', type: 'thunderstorm', level: 'yellow', region: '深圳', title: '雷电预警', content: '本地有雷电' }]
  const r = w.detectAll({ nmcAlerts: nmc, location: 'Shenzhen' })
  const a = r.alerts.find(x => x.type === 'thunderstorm')
  assert.ok(a)
})

test('hail: from NMC alert', () => {
  const nmc = [{ id: '2', type: 'hail', level: 'red', region: '深圳', title: '冰雹预警', content: '本地有冰雹' }]
  const r = w.detectAll({ nmcAlerts: nmc })
  const a = r.alerts.find(x => x.type === 'hail')
  assert.ok(a)
  assert.equal(a.severity, 'severe')
})

test('wind: >= 17 m/s → warning', () => {
  const wttr = makeWttr({ current: { temp: 20, windSpeed: 65, precip: 0 } })  // 65 km/h = 18 m/s
  const r = w.detectAll({ wttr })
  const a = r.alerts.find(x => x.type === 'wind')
  assert.ok(a)
})

test('wind: >= 24 m/s → severe', () => {
  const wttr = makeWttr({ current: { temp: 20, windSpeed: 95, precip: 0 } })  // 95 km/h = 26 m/s
  const r = w.detectAll({ wttr })
  const a = r.alerts.find(x => x.type === 'wind')
  assert.ok(a)
  assert.equal(a.severity, 'severe')
})

test('detector: safe when no extreme', () => {
  const wttr = makeWttr({ current: { temp: 22, windSpeed: 5, precip: 0 }, forecast: [{ precip: 0, weather: 'sunny' }] })
  const r = w.detectAll({ wttr, nmcAlerts: [] })
  assert.equal(r.safe, true)
  assert.equal(r.alerts.length, 0)
})

// ─── weather-monitor 编排 — 3 tests ────────────────────

test('monitor: detectOnce manual', async () => {
  const state = w.defaultMonitorState()
  const fetcher = async (url) => {
    if (url.includes('wttr.in')) {
      return { ok: true, status: 200, json: async () => ({ current_condition: [{ temp_C: '36', weatherDesc: [{ value: 'Hot' }] }], weather: [] }) }
    }
    return { ok: true, status: 200, json: async () => [] }
  }
  let alerted = []
  const r = await w.detectOnce({ state, location: 'Shenzhen', fetcher, onAlert: (a) => alerted.push(a) })
  assert.ok(r.alerts.find(a => a.type === 'high_temp'))
  assert.ok(alerted.length >= 1)
})

test('monitor: dedup within 30 min', async () => {
  const state = w.defaultMonitorState({ dedupMs: 60000 })
  const fetcher = async (url) => {
    if (url.includes('wttr.in')) {
      return { ok: true, status: 200, json: async () => ({ current_condition: [{ temp_C: '36', weatherDesc: [{ value: 'Hot' }] }], weather: [] }) }
    }
    return { ok: true, status: 200, json: async () => [] }
  }
  let alerted = []
  // 第 1 次：触发
  await w.detectOnce({ state, location: 'Shenzhen', fetcher, onAlert: (a) => alerted.push(a) })
  // 第 2 次（同条件）：dedup 不重复 emit
  await w.detectOnce({ state, location: 'Shenzhen', fetcher, onAlert: (a) => alerted.push(a) })
  assert.equal(alerted.length, 1)
})

test('monitor: injectForWeather returns meta-info', async () => {
  const state = w.defaultMonitorState()
  const fetcher = async (url) => {
    if (url.includes('wttr.in')) {
      return { ok: true, status: 200, json: async () => ({ current_condition: [{ temp_C: '36', weatherDesc: [{ value: 'Hot' }] }], weather: [] }) }
    }
    return { ok: true, status: 200, json: async () => [] }
  }
  await w.detectOnce({ state, location: 'Shenzhen', fetcher })
  const out = w.injectForWeather(state)
  assert.match(out, /极端天气/)
  assert.match(out, /meta-info/)
  assert.match(out, /不.*进.*决策路径/)
})

// ─── privacy-guard — 3 tests ─────────────────────────────

test('privacy: ALLOWED_WEATHER_ENDPOINTS whitelist', () => {
  assert.equal(w.isAllowedWeatherEndpoint('https://wttr.in/Shenzhen'), true)
  assert.equal(w.isAllowedWeatherEndpoint('https://api.caiyunapp.com/v2.5/...'), true)
  assert.equal(w.isAllowedWeatherEndpoint('https://restapi.amap.com/v3/weather'), true)
  assert.equal(w.isAllowedWeatherEndpoint('https://data.cma.cn/...'), true)
  assert.equal(w.isAllowedWeatherEndpoint('https://api.openai.com/...'), false)
  assert.equal(w.isAllowedWeatherEndpoint('https://googleapis.com/...'), false)
})

test('privacy: sanitizeAlert strips lat/lon', () => {
  const a = { type: 'high_temp', temp: 36, lat: 22.5, lon: 114.0, isp: 'CT' }
  const s = w.sanitizeAlert(a)
  assert.equal(s.temp, 36)
  assert.equal(s.lat, undefined)
  assert.equal(s.lon, undefined)
  assert.equal(s.isp, undefined)
})

test('privacy: isAlertClean detects prohibited fields', () => {
  assert.equal(w.isAlertClean({ type: 'high_temp', temp: 36 }), true)
  assert.equal(w.isAlertClean({ type: 'high_temp', lat: 22.5 }), false)
  assert.equal(w.isAlertClean({ type: 'high_temp', isp: 'CT' }), false)
})

// ─── 集成 + 隔离 — 3 tests ─────────────────────────────────

test('integration: full pipeline fetch + detect + alert + dedup', async () => {
  const state = w.defaultMonitorState({ dedupMs: 60000 })
  const fetcher = async (url) => {
    if (url.includes('wttr.in')) {
      return { ok: true, status: 200, json: async () => ({ current_condition: [{ temp_C: '37', weatherDesc: [{ value: 'Hot' }] }], weather: [] }) }
    }
    return { ok: true, status: 200, json: async () => [
      { id: '1', title: '高温橙色预警', level: 'orange', region: '深圳', publishedAt: '2026-09-07' }
    ] }
  }
  let alerts = []
  const r1 = await w.detectOnce({ state, location: 'Shenzhen', nmcUrl: 'https://data.cma.cn/alerts', fetcher, onAlert: (a) => alerts.push(a) })
  // 应该有 high_temp + NMC 解析后的 high_temp（2 个同类型会被 dedup）
  const r2 = await w.detectOnce({ state, location: 'Shenzhen', nmcUrl: 'https://data.cma.cn/alerts', fetcher, onAlert: (a) => alerts.push(a) })
  // 第 2 次同条件应该 dedup
  const highTempAlerts = alerts.filter(a => a.type === 'high_temp')
  assert.ok(highTempAlerts.length >= 1)  // 至少 1 次触发
  assert.ok(highTempAlerts.length <= 2)  // dedup 不会无限累加
})

test('isolation: weather-monitor 0 import emotion-state (类比 ADR-002 meta-info)', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/weather-monitor/'
  for (const f of ['weather-fetcher.js', 'extreme-detector.js', 'weather-monitor.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /from\s+['"][^'"]*emotion-state['"]/i)
    assert.doesNotMatch(src, /from\s+['"][^'"]*joy-state['"]/i)
  }
})

test('isolation: weather-monitor 0 调用云端 AI API (只用天气 API 白名单)', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/weather-monitor/'
  for (const f of ['weather-fetcher.js', 'extreme-detector.js', 'weather-monitor.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    // 不调云端 AI
    assert.doesNotMatch(src, /api\.openai\.com/, `${f} must not call OpenAI`)
    assert.doesNotMatch(src, /api\.anthropic\.com/, `${f} must not call Anthropic`)
    assert.doesNotMatch(src, /googleapis\.com/, `${f} must not call Google APIs`)
  }
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
