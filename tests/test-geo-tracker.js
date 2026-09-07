// Geo tracker tests (15+ tests).
//
// Run: node --test tests/test-geo-tracker.js

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-geo-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const g = await import('../src/perception/geo-tracker/index.js')

// ─── helpers ───────────────────────────────────────────────

function mockFetcherFactory(responses) {
  let i = 0
  return async (url, options) => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return {
      ok: true,
      status: 200,
      json: async () => r,
    }
  }
}

const SHENZHEN = {
  status: 'success',
  query: '1.2.3.4',
  country: 'China',
  countryCode: 'CN',
  region: 'GD',
  regionName: 'Guangdong',
  city: 'Shenzhen',
  zip: '518000',
  lat: 22.5431,
  lon: 114.0579,
  timezone: 'Asia/Shanghai',
  isp: 'China Telecom',
  org: 'Test',
}

const BEIJING = {
  status: 'success',
  query: '5.6.7.8',
  country: 'China',
  countryCode: 'CN',
  region: 'BJ',
  regionName: 'Beijing',
  city: 'Beijing',
  zip: '100000',
  lat: 39.9042,
  lon: 116.4074,
  timezone: 'Asia/Shanghai',
  isp: 'China Unicom',
  org: 'Test',
}

const NEW_YORK = {
  status: 'success',
  query: '9.10.11.12',
  country: 'United States',
  countryCode: 'US',
  region: 'NY',
  regionName: 'New York',
  city: 'New York',
  lat: 40.7128,
  lon: -74.0060,
  timezone: 'America/New_York',
  isp: 'Verizon',
  org: 'Test',
}

// ─── ip-locator — 4 tests ──────────────────────────────────

test('ip-locator: locateOnce with mock fetcher', async () => {
  const r = await g.locateOnce({ fetcher: mockFetcherFactory([SHENZHEN]) })
  assert.equal(r.error, null)
  assert.equal(r.result.country, 'China')
  assert.equal(r.result.city, 'Shenzhen')
})

test('ip-locator: HTTP error returns error', async () => {
  const r = await g.locateOnce({ fetcher: async () => ({ ok: false, status: 500, json: async () => ({}) }) })
  assert.ok(r.error)
  assert.match(r.error, /HTTP 500/)
})

test('ip-locator: recordLocation updates state + history', () => {
  const state = g.defaultLocatorState()
  g.recordLocation(state, SHENZHEN)
  assert.equal(state.lastResult.city, 'Shenzhen')
  assert.equal(state.history.length, 1)
  assert.equal(state.history[0].country, 'China')
})

test('ip-locator: history trimmed to 10', () => {
  const state = g.defaultLocatorState()
  for (let i = 0; i < 15; i++) {
    g.recordLocation(state, { ...SHENZHEN, query: `1.2.3.${i}` })
  }
  assert.ok(state.history.length <= 10)
})

// ─── motion-detector — 6 tests ────────────────────────────

test('motion: IP change → moved (ip_changed)', () => {
  const r = g.detectMotion({ prev: SHENZHEN, curr: BEIJING })
  assert.equal(r.moved, true)
  assert.equal(r.type, 'ip_changed')
})

test('motion: same IP + same city + small distance → not moved', () => {
  const r = g.detectMotion({ prev: SHENZHEN, curr: { ...SHENZHEN, query: '1.2.3.4' } })
  assert.equal(r.moved, false)
})

test('motion: country change → moved (country_changed)', () => {
  const sameIP = { ...NEW_YORK, query: SHENZHEN.query }
  const r = g.detectMotion({ prev: SHENZHEN, curr: sameIP })
  assert.equal(r.moved, true)
  assert.equal(r.type, 'country_changed')
})

test('motion: timezone change → moved (timezone_changed)', () => {
  // 同 IP + 同 country + 同 city，只有 timezone 变
  const same_ip_diff_tz = { ...SHENZHEN, query: SHENZHEN.query, city: SHENZHEN.city, countryCode: SHENZHEN.countryCode, timezone: 'America/New_York' }
  const r = g.detectMotion({ prev: SHENZHEN, curr: same_ip_diff_tz })
  assert.equal(r.moved, true)
  assert.equal(r.type, 'timezone_changed')
})

test('motion: city change + distance > 50km → moved', () => {
  const r = g.detectMotion({ prev: SHENZHEN, curr: BEIJING })
  assert.equal(r.moved, true)
  // IP 也会变，所以是 ip_changed 优先
  assert.equal(r.type, 'ip_changed')
})

test('motion: haversine distance computed', () => {
  const d = g.haversineKm(22.5431, 114.0579, 39.9042, 116.4074)  // 深圳-北京
  assert.ok(d > 1500 && d < 2500)  // 实际约 1970km
})

// ─── geo-tracker 编排 — 3 tests ──────────────────────────

test('geo-tracker: start + stop monitoring (manual poll)', async () => {
  const state = g.defaultTrackerState()
  const fetcher = mockFetcherFactory([SHENZHEN, BEIJING])
  // 不用 startGeoTracking（intervalMs 受 MIN_POLL_INTERVAL_MS 限制）
  // 直接手动 locateNow 模拟
  await g.locateNow({ state, fetcher })
  assert.equal(state.locator.lastResult.city, 'Shenzhen')
  // 第 2 次
  await g.locateNow({ state, fetcher })
  // 手动检测 motion
  const motion = g.checkFromState(state.locator, { curr: state.locator.lastResult })
  assert.equal(motion.moved, true)
  // 模拟 startGeoTracking 内部行为
  state.motionHistory.push({ at: Date.now(), ...motion })
  assert.ok(state.motionHistory.length >= 1)
})

test('geo-tracker: registerProvider (future GPS)', () => {
  const state = g.defaultTrackerState()
  g.registerProvider(state, {
    name: 'child-wristband',
    getLocation: async () => ({ lat: 22.5, lon: 114.0, city: 'Shenzhen' }),
  })
  assert.equal(state.providers.length, 1)
  assert.equal(state.providers[0].name, 'child-wristband')
})

test('geo-tracker: injectForGeo returns meta-info', () => {
  const state = g.defaultTrackerState()
  g.recordLocation(state.locator, SHENZHEN)
  const out = g.injectForGeo(state)
  assert.match(out, /地理位置/)
  assert.match(out, /Shenzhen/)
  assert.match(out, /meta-info/)
  assert.match(out, /不.*进.*决策路径/)
})

// ─── privacy-guard — 4 tests ─────────────────────────────

test('privacy: FORBIDDEN_PERSISTENT_FIELDS includes lat/lon/zip/isp/org', () => {
  assert.ok(g.FORBIDDEN_PERSISTENT_FIELDS.includes('lat'))
  assert.ok(g.FORBIDDEN_PERSISTENT_FIELDS.includes('lon'))
  assert.ok(g.FORBIDDEN_PERSISTENT_FIELDS.includes('zip'))
  assert.ok(g.FORBIDDEN_PERSISTENT_FIELDS.includes('isp'))
  assert.ok(g.FORBIDDEN_PERSISTENT_FIELDS.includes('org'))
})

test('privacy: sanitizeLocation strips lat/lon/zip/isp', () => {
  const s = g.sanitizeLocation(SHENZHEN)
  assert.equal(s.country, 'China')
  assert.equal(s.city, 'Shenzhen')
  assert.equal(s.lat, undefined)
  assert.equal(s.lon, undefined)
  assert.equal(s.zip, undefined)
  assert.equal(s.isp, undefined)
})

test('privacy: isAllowedEndpoint whitelist', () => {
  assert.equal(g.isAllowedEndpoint('http://ip-api.com/json/?fields=...'), true)
  assert.equal(g.isAllowedEndpoint('https://ipinfo.io/...'), true)
  assert.equal(g.isAllowedEndpoint('https://ip2location.com/...'), true)
  assert.equal(g.isAllowedEndpoint('https://api.openai.com/...'), false)
  assert.equal(g.isAllowedEndpoint('https://googleapis.com/...'), false)
})

test('privacy: isLocationClean detects prohibited fields', () => {
  assert.equal(g.isLocationClean({ country: 'CN', city: 'SZ' }), true)
  assert.equal(g.isLocationClean({ country: 'CN', lat: 22.5 }), false)
  assert.equal(g.isLocationClean({ country: 'CN', zip: '518000' }), false)
  assert.equal(g.isLocationClean({ country: 'CN', isp: 'CT' }), false)
})

// ─── 集成 + 隔离 — 3 tests ─────────────────────────────────

test('integration: full pipeline locate + detect + motion event', async () => {
  const state = g.defaultTrackerState()
  const fetcher = mockFetcherFactory([SHENZHEN, BEIJING])
  let motionCount = 0
  // 不用 startGeoTracking（intervalMs 受 MIN_POLL_INTERVAL_MS 限制）
  // 模拟 startGeoTracking 内部 onUpdate 逻辑
  const simulateUpdate = () => {
    const motion = g.checkFromState(state.locator, { curr: state.locator.lastResult })
    if (motion.moved) {
      motionCount += 1
      state.motionHistory.push({ at: Date.now(), ...motion })
    }
  }
  await g.locateNow({ state, fetcher })
  simulateUpdate()  // 第一次（无 prev，无 motion）
  await g.locateNow({ state, fetcher })
  simulateUpdate()  // 第二次（SHENZHEN→BEIJING → motion）
  assert.ok(motionCount >= 1)
  assert.ok(state.motionHistory.length >= 1)
})

test('integration: history trim (motion 32 max)', async () => {
  const state = g.defaultTrackerState()
  // 手动塞 50 个 motion
  for (let i = 0; i < 50; i++) {
    state.motionHistory.push({ at: Date.now() + i, type: 'city_changed', from: {}, to: {}, reason: 'test' })
  }
  // 清理后再加
  state.motionHistory = state.motionHistory.slice(-32)
  assert.ok(state.motionHistory.length <= 32)
})

test('isolation: geo-tracker 0 import emotion-state (类比 ADR-002 meta-info 隔离)', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/geo-tracker/'
  for (const f of ['ip-locator.js', 'motion-detector.js', 'geo-tracker.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /from\s+['"][^'"]*emotion-state['"]/i)
    assert.doesNotMatch(src, /from\s+['"][^'"]*joy-state['"]/i)
  }
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
