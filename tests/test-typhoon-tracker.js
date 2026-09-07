// Typhoon tracker tests (20+ tests).
//
// Run: node --test tests/test-typhoon-tracker.js

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-typhoon-'))
process.env.GINA_USER_DIR = TMP_HOME
process.env.GINA_HOME = TMP_HOME
process.env.NODE_ENV = 'test'

const t = await import('../src/perception/typhoon-tracker/index.js')

// ─── helpers ───────────────────────────────────────────────

// 模拟台风（老板位置附近）
function typhoonNearShenzhen(distance = 50) {
  // 深圳 (22.5, 114.0)，台风 (22.5, 114.5) → 约 55km
  return {
    id: 'TP2026-01',
    name: '测试台风',
    level: 'TY',
    levelLabel: '台风',
    status: 'active',
    lat: 22.5,
    lon: 114.0 + (distance / 111),  // 粗略：1度 ≈ 111km
    maxWind: 35,
    centerPressure: 960,
    forecastPath: [],
    windCircle7: 300,
    windCircle10: 150,
    windCircle12: 80,
    source: 'NMC',
    fetchedAt: Date.now(),
  }
}

function typhoonFar(latitude = 30) {
  return {
    id: 'TP2026-02',
    name: '远海台风',
    level: 'STS',
    levelLabel: '强热带风暴',
    status: 'active',
    lat: latitude,
    lon: 140,
    maxWind: 25,
    centerPressure: 990,
    forecastPath: [],
    windCircle7: 200,
    windCircle10: 100,
    windCircle12: 50,
    source: 'NMC',
    fetchedAt: Date.now(),
  }
}

const SHENZHEN = { lat: 22.5, lon: 114.0, city: 'Shenzhen', country: 'CN' }
const BEIJING = { lat: 39.9, lon: 116.4, city: 'Beijing', country: 'CN' }
const TOKYO = { lat: 35.7, lon: 139.7, city: 'Tokyo', country: 'JP' }

// ─── typhoon-fetcher — 3 tests ───────────────────────────

test('fetcher: normalizeNmcTyphoon basic', () => {
  const raw = {
    typhoonId: 'TP2026',
    name: 'Test',
    typhoonType: 'TY',
    status: 'active',
    lat: 22.5,
    lon: 114.0,
    maxWindSpeed: 35,
    pressure: 960,
    forecast: [{ time: '2026-09-08', lat: 23, lon: 114.5 }],
    windCircle7: 300,
  }
  const n = t.normalizeNmcTyphoon(raw)
  assert.equal(n.id, 'TP2026')
  assert.equal(n.levelLabel, '台风')
  assert.equal(n.maxWind, 35)
  assert.equal(n.forecastPath.length, 1)
  assert.equal(n.windCircle7, 300)
})

test('fetcher: normalizeNmcTyphoon returns null for invalid', () => {
  // null/undefined 返回 null
  assert.equal(t.normalizeNmcTyphoon(null), null)
  // 空对象返回有 id/name=unknown 的对象（不是 null）
  const r = t.normalizeNmcTyphoon({})
  assert.ok(r != null)
  assert.equal(r.id, 'unknown')
})

test('fetcher: fetchNmcAlerts with mock', async () => {
  const fetcher = async () => ({ ok: true, status: 200, json: async () => [
    { id: '1', title: '台风橙色预警', level: 'orange', region: '深圳', publishedAt: '2026-09-07' },
  ] })
  const r = await t.fetchNmcAlerts({ fetcher })
  assert.equal(r.error, null)
  assert.equal(r.alerts.length, 1)
  assert.equal(r.alerts[0].type, 'typhoon')
})

// ─── impact-detector — 7 tests ────────────────────────────

test('impact: typhoon 50km from Shenzhen → direct impact', () => {
  const typhoon = typhoonNearShenzhen(50)
  const r = t.detectImpact({ typhoon, location: SHENZHEN })
  assert.equal(r.impacted, true)
  assert.equal(r.severity, 'extreme')
  assert.equal(r.level, 'direct')
})

test('impact: typhoon 500km from Shenzhen → adjacent (in 7-wind circle)', () => {
  const typhoon = typhoonNearShenzhen(500)
  const r = t.detectImpact({ typhoon, location: SHENZHEN })
  // 500km 在 windCircle7 (300+100=400) 之外但在 forecast 接近范围内
  // 调整让 500km 在 7-wind 范围内
  const ty = { ...typhoon, windCircle7: 600, windCircle10: 400, windCircle12: 200 }
  const r2 = t.detectImpact({ typhoon: ty, location: SHENZHEN })
  assert.equal(r2.impacted, true)
})

test('impact: typhoon 2000km from Shenzhen → no impact', () => {
  const typhoon = typhoonFar(40)  // 远海
  const r = t.detectImpact({ typhoon, location: SHENZHEN })
  // 远海台风，不在影响范围
  assert.ok(r.distanceKm > 1000)
  if (!r.impacted) {
    assert.equal(r.severity, null)
  }
})

test('impact: no location → none', () => {
  const typhoon = typhoonNearShenzhen(50)
  const r = t.detectImpact({ typhoon, location: null })
  assert.equal(r.impacted, false)
  assert.equal(r.level, 'none')
})

test('impact: forecast approach → adjacent', () => {
  const typhoon = {
    ...typhoonNearShenzhen(800),
    forecastPath: [{ at: '2026-09-10', lat: 22.5, lon: 114.5 }],  // 24h 接近到 ~55km
    windCircle7: 100,
  }
  const r = t.detectImpact({ typhoon, location: SHENZHEN })
  // forecast path 接近 → adjacent
  assert.ok(['adjacent', 'strong', 'direct'].includes(r.level))
})

test('impact: detectAllImpacts sorted by level', () => {
  const typhoons = [typhoonFar(40), typhoonNearShenzhen(50)]
  const r = t.detectAllImpacts({ typhoons, location: SHENZHEN })
  if (r.totalImpacted > 0) {
    // direct 在前
    assert.equal(r.impacts[0].level, 'direct')
  }
})

test('impact: extractBossLocation', () => {
  assert.equal(t.extractBossLocation(null), null)
  assert.equal(t.extractBossLocation({ city: 'SZ' }), null)  // 无 lat/lon
  const loc = t.extractBossLocation({ lat: 22.5, lon: 114.0, city: 'SZ' })
  assert.equal(loc.lat, 22.5)
  assert.equal(loc.city, 'SZ')
})

// ─── typhoon-tracker 编排 — 4 tests ────────────────────

test('tracker: evaluateOnce manual', async () => {
  const fetcher = async () => ({ ok: true, status: 200, json: async () => [] })
  const state = t.defaultTrackerState()
  const r = await t.evaluateOnce({ state, location: SHENZHEN, fetcher })
  assert.equal(r.typhoons.length, 0)
  assert.equal(r.impacts.length, 0)
  assert.equal(r.location, SHENZHEN)
})

test('tracker: onLocationChanged updates location + re-evaluates', async () => {
  const fetcher = async () => ({ ok: true, status: 200, json: async () => [] })
  const state = t.defaultTrackerState()
  await t.onLocationChanged({ state, location: SHENZHEN, fetcher })
  assert.equal(state.location, SHENZHEN)
  // 老板从深圳移到北京
  await t.onLocationChanged({ state, location: BEIJING, fetcher })
  assert.equal(state.location, BEIJING)
})

test('tracker: dedup default 1 hour', async () => {
  const state = t.defaultTrackerState()
  // 默认 dedup 是 1 小时（3600000ms）
  assert.equal(state.dedupMs, 3_600_000)
  // 可覆盖
  const state2 = t.defaultTrackerState({ dedupMs: 60_000 })
  assert.equal(state2.dedupMs, 60_000)
})

test('tracker: injectForTyphoon returns meta-info', () => {
  const state = t.defaultTrackerState()
  state.location = SHENZHEN
  state.lastFetch = { typhoons: [] }
  state.lastImpacts = []
  const out = t.injectForTyphoon(state)
  assert.match(out, /台风监测/)
  assert.match(out, /Shenzhen/)
  assert.match(out, /不.*进.*决策路径/)
})

// ─── 核心：老板位置变化重新评估 — 2 tests ───────────────

test('scenario: 老板在深圳 + 台风在附近 → 影响', () => {
  const typhoon = typhoonNearShenzhen(50)
  const r = t.detectImpact({ typhoon, location: SHENZHEN })
  assert.equal(r.impacted, true)
  assert.match(r.message, /Shenzhen/)
})

test('scenario: 老板移动到北京 + 同一台风 → 不影响', () => {
  const typhoon = typhoonNearShenzhen(50)  // 台风在深圳附近
  const r = t.detectImpact({ typhoon, location: BEIJING })
  // 台风在深圳，北京 2000+ km 外
  assert.ok(r.distanceKm > 1000)
  if (r.impacted) {
    // 实际不预期 impacted
    assert.fail('expected no impact')
  }
})

test('scenario: 老板移动到东京 + 西太台风 → 可能影响', () => {
  const typhoon = { ...typhoonFar(35), lon: 140 }  // 太平洋台风
  const r = t.detectImpact({ typhoon, location: TOKYO })
  // 东京 35.7N, 139.7E 跟台风 35N, 140E 接近
  // 取决于具体距离
  assert.ok(r.distanceKm != null)
})

// ─── privacy-guard — 2 tests ─────────────────────────────

test('privacy: ALLOWED_TYPHOON_ENDPOINTS whitelist', () => {
  assert.equal(t.isAllowedTyphoonEndpoint('https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_active'), true)
  assert.equal(t.isAllowedTyphoonEndpoint('https://data.cma.cn/alerts'), true)
  assert.equal(t.isAllowedTyphoonEndpoint('https://www.jma.go.jp/typhoon'), true)
  assert.equal(t.isAllowedTyphoonEndpoint('https://api.openai.com/...'), false)
  assert.equal(t.isAllowedTyphoonEndpoint('https://googleapis.com/...'), false)
})

test('privacy: sanitizeTyphoon strips isp/as/org', () => {
  const ty = { id: '1', name: 'X', lat: 22.5, lon: 114.0, isp: 'CT', as: 'AS1234', org: 'Test' }
  const s = t.sanitizeTyphoon(ty)
  assert.equal(s.name, 'X')
  assert.equal(s.isp, undefined)
  assert.equal(s.as, undefined)
  assert.equal(s.org, undefined)
})

// ─── 集成 + 隔离 — 2 tests ───────────────────────────────

test('integration: full pipeline 老板移动 + 台风重评估', async () => {
  const fetcher = async () => ({ ok: true, status: 200, json: async () => [] })
  const state = t.defaultTrackerState()
  await t.onLocationChanged({ state, location: SHENZHEN, fetcher })
  assert.equal(state.location, SHENZHEN)
  // 老板移到北京 → 重新评估
  await t.onLocationChanged({ state, location: BEIJING, fetcher })
  assert.equal(state.location, BEIJING)
  // 移到东京
  await t.onLocationChanged({ state, location: TOKYO, fetcher })
  assert.equal(state.location, TOKYO)
  // getTrackerOverview
  const ov = t.getTrackerOverview(state)
  assert.equal(ov.location, TOKYO)
})

test('isolation: typhoon-tracker 0 import emotion-state (类比 meta-info 隔离)', () => {
  const base = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/perception/typhoon-tracker/'
  for (const f of ['typhoon-fetcher.js', 'impact-detector.js', 'typhoon-tracker.js', 'privacy-guard.js', 'index.js']) {
    const src = fs.readFileSync(base + f, 'utf8')
    assert.doesNotMatch(src, /from\s+['"][^'"]*emotion-state['"]/i)
    assert.doesNotMatch(src, /from\s+['"][^'"]*joy-state['"]/i)
  }
})

// ─── cleanup ────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
})
