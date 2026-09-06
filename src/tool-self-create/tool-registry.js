// tool-registry.js — 动态工具注册表 + 版本化 + 灰度
//
// 定位：GINA 自创的工具必须有"出生证 + 升级证 + 退场证"。
//   - 注册：v1 创建时 status='canary', canaryPercent=1%，等数据后再扩
//   - 灰度：5% → 25% → 50% → 100% (基于 A/B 测试结果 + 错误率)
//   - 回滚：任意时刻可 rollback 到 previousVersion
//
// 存储：JSON 文件 + 内存索引（生产环境可换 SQLite，不影响 API）
// 并发：单进程安全（meta-controller 单线程）

import fs from 'node:fs'
import path from 'node:path'
import { validateSpec, specHash, isCompatibleVersion } from './tool-spec.js'

// ─── 常量 ───────────────────────────────────────────────────

const VALID_STATUSES = new Set(['canary', 'stable', 'deprecated', 'disabled'])
const DEFAULT_CANARY_PERCENTS = [1, 5, 25, 50, 100]   // 灰度阶梯
const DEFAULT_CANARY_MIN_CALLS = 100                   // 每阶梯最少调用次数
const DEFAULT_CANARY_MAX_ERROR_RATE = 0.05             // 升级门槛错误率
const MAX_VERSIONS_PER_TOOL = 16
const MAX_TOOLS = 1024
const MAX_LOG = 256

// ─── 状态 ───────────────────────────────────────────────────

export function defaultRegistry() {
  return {
    version: 1,
    tools: {},          // name -> { versions: { v1: {spec, source, status, canaryPercent, ...} }, currentVersion, previousVersion }
    log: [],            // [{at, action, toolName, version, ...}]
  }
}

export function loadRegistry(statePath) {
  if (!statePath) return defaultRegistry()
  try {
    if (!fs.existsSync(statePath)) return defaultRegistry()
    const raw = fs.readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.tools !== 'object') {
      throw new Error('registry malformed')
    }
    if (Object.keys(parsed.tools).length > MAX_TOOLS) {
      throw new Error(`registry too many tools: ${Object.keys(parsed.tools).length} > ${MAX_TOOLS}`)
    }
    return {
      ...defaultRegistry(),
      ...parsed,
      log: Array.isArray(parsed.log) ? parsed.log : [],
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[tool-registry] load failed, rebuilding:', e.message)
    }
    return defaultRegistry()
  }
}

export function saveRegistry(registry, statePath) {
  if (!statePath) return
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const tmp = statePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8')
  fs.renameSync(tmp, statePath)
}

// ─── 内部工具 ───────────────────────────────────────────────

function trimLog(registry, max = MAX_LOG) {
  if (registry.log.length <= max) return
  registry.log = registry.log.slice(-max)
}

function appendLog(registry, entry) {
  registry.log.push({ at: new Date().toISOString(), ...entry })
  trimLog(registry)
}

function getTool(registry, name) {
  return registry.tools[name] || null
}

function ensureTool(registry, name) {
  if (!registry.tools[name]) {
    registry.tools[name] = {
      name,
      createdAt: new Date().toISOString(),
      versions: {},
      currentVersion: null,
      previousVersion: null,
    }
  }
  return registry.tools[name]
}

// ─── 注册（核心入口） ──────────────────────────────────────

// 注册新工具或新版本。
//   options: { spec, source, status='canary', canaryPercent=1, previousVersion?, replace? }
//   返回: { name, version, status, hash }
export function register(registry, options = {}) {
  const spec = options.spec
  const source = options.source
  // spec 必过验证
  validateSpec(spec)
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('register: source must be non-empty string')
  }
  const tool = ensureTool(registry, spec.name)
  // 版本数限制
  if (!tool.versions[spec.version]) {
    const versionCount = Object.keys(tool.versions).length
    if (versionCount >= MAX_VERSIONS_PER_TOOL) {
      throw new Error(`too many versions for ${spec.name}: ${versionCount} >= ${MAX_VERSIONS_PER_TOOL}`)
    }
  }
  // 同版本重复注册：禁止（避免静默覆盖）
  if (tool.versions[spec.version] && !options.replace) {
    throw new Error(`${spec.name}@${spec.version} already registered; use replace=true to overwrite`)
  }
  const status = options.status || 'canary'
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`status must be one of ${[...VALID_STATUSES].join('|')}`)
  }
  const canaryPercent = typeof options.canaryPercent === 'number' ? options.canaryPercent : 1
  if (canaryPercent < 0 || canaryPercent > 100) {
    throw new Error('canaryPercent must be 0-100')
  }
  // 兼容旧版本检查
  if (tool.currentVersion && options.previousVersion) {
    if (!isCompatibleVersion(tool.currentVersion, spec.version) && options.previousVersion !== tool.currentVersion) {
      throw new Error(`version ${spec.version} breaks compat with current ${tool.currentVersion}; specify previousVersion=${tool.currentVersion} to acknowledge`)
    }
  }
  const hash = specHash(spec)
  // 写入
  tool.versions[spec.version] = {
    spec,
    source,
    status,
    canaryPercent,
    hash,
    registeredAt: new Date().toISOString(),
    stats: { calls: 0, errors: 0, lastError: null, lastCallAt: null },
  }
  // 更新 current / previous
  if (status === 'stable' || !tool.currentVersion) {
    tool.previousVersion = tool.currentVersion
    tool.currentVersion = spec.version
  }
  appendLog(registry, { action: 'register', toolName: spec.name, version: spec.version, status, canaryPercent })
  return { name: spec.name, version: spec.version, status, canaryPercent, hash }
}

// ─── 灰度推进 ──────────────────────────────────────────────

// 推进 canary 阶梯：1 → 5 → 25 → 50 → 100。
//   options: { calls, errors, force }
//   当 calls >= minCalls && errorRate <= maxErrorRate 时升级。
export function advanceCanary(registry, name, options = {}) {
  const tool = getTool(registry, name)
  if (!tool) throw new Error(`tool ${name} not found`)
  const current = tool.versions[tool.currentVersion]
  if (!current) throw new Error(`current version not set for ${name}`)
  if (current.status !== 'canary') {
    return { advanced: false, reason: `status is ${current.status}, not canary` }
  }
  const calls = options.calls != null ? options.calls : current.stats.calls
  const errors = options.errors != null ? options.errors : current.stats.errors
  const minCalls = options.minCalls || DEFAULT_CANARY_MIN_CALLS
  const maxErrorRate = options.maxErrorRate || DEFAULT_CANARY_MAX_ERROR_RATE
  const ladder = options.ladder || DEFAULT_CANARY_PERCENTS
  if (calls < minCalls) {
    return { advanced: false, reason: `not enough calls (${calls} < ${minCalls})` }
  }
  const errorRate = calls > 0 ? errors / calls : 0
  if (errorRate > maxErrorRate) {
    return { advanced: false, reason: `error rate ${errorRate.toFixed(3)} > max ${maxErrorRate}` }
  }
  // 找下一阶
  const idx = ladder.indexOf(current.canaryPercent)
  if (idx < 0) {
    return { advanced: false, reason: `current canary ${current.canaryPercent} not in ladder` }
  }
  if (idx >= ladder.length - 1) {
    // 已在顶端 → 升 stable
    current.status = 'stable'
    appendLog(registry, { action: 'promote-stable', toolName: name, version: tool.currentVersion })
    return { advanced: true, status: 'stable', canaryPercent: 100 }
  }
  const nextPercent = ladder[idx + 1]
  current.canaryPercent = nextPercent
  appendLog(registry, { action: 'canary-advance', toolName: name, version: tool.currentVersion, canaryPercent: nextPercent })
  return { advanced: true, canaryPercent: nextPercent }
}

// ─── 回滚 ──────────────────────────────────────────────────

export function rollback(registry, name, options = {}) {
  const tool = getTool(registry, name)
  if (!tool) throw new Error(`tool ${name} not found`)
  if (!tool.previousVersion) {
    return { rolled: false, reason: 'no previous version' }
  }
  const target = tool.versions[tool.previousVersion]
  if (!target) {
    return { rolled: false, reason: `previous version ${tool.previousVersion} not found` }
  }
  const oldCurrent = tool.currentVersion
  tool.currentVersion = tool.previousVersion
  tool.previousVersion = oldCurrent
  // 标记旧版本为 deprecated
  if (options.deprecateOld !== false && tool.versions[oldCurrent]) {
    tool.versions[oldCurrent].status = 'deprecated'
  }
  appendLog(registry, { action: 'rollback', toolName: name, from: oldCurrent, to: tool.currentVersion, reason: options.reason || null })
  return { rolled: true, current: tool.currentVersion, previous: tool.previousVersion }
}

// ─── 弃用 / 禁用 ───────────────────────────────────────────

export function deprecate(registry, name, options = {}) {
  const tool = getTool(registry, name)
  if (!tool) throw new Error(`tool ${name} not found`)
  if (tool.currentVersion && tool.versions[tool.currentVersion]) {
    tool.versions[tool.currentVersion].status = 'deprecated'
  }
  appendLog(registry, { action: 'deprecate', toolName: name, reason: options.reason || null })
  return { deprecated: true, name }
}

export function disable(registry, name, options = {}) {
  const tool = getTool(registry, name)
  if (!tool) throw new Error(`tool ${name} not found`)
  if (tool.currentVersion && tool.versions[tool.currentVersion]) {
    tool.versions[tool.currentVersion].status = 'disabled'
  }
  appendLog(registry, { action: 'disable', toolName: name, reason: options.reason || null })
  return { disabled: true, name }
}

// ─── 查询 ──────────────────────────────────────────────────

export function get(registry, name) {
  const tool = getTool(registry, name)
  if (!tool || !tool.currentVersion) return null
  const v = tool.versions[tool.currentVersion]
  return {
    name,
    version: tool.currentVersion,
    spec: v.spec,
    source: v.source,
    status: v.status,
    canaryPercent: v.canaryPercent,
    stats: v.stats,
    hash: v.hash,
  }
}

export function getVersion(registry, name, version) {
  const tool = getTool(registry, name)
  if (!tool || !tool.versions[version]) return null
  const v = tool.versions[version]
  return {
    name,
    version,
    spec: v.spec,
    source: v.source,
    status: v.status,
    canaryPercent: v.canaryPercent,
    stats: v.stats,
    hash: v.hash,
  }
}

// 决定某个调用是否应被 canary 路由命中
//   options: { userId, rand? }   rand 是 [0,1) 随机数，不传则用 Math.random
export function shouldRoute(name, options = {}) {
  // 调用方传入 registry；这里只根据 canaryPercent 决策
  // 实际 router 在调用方
  return null  // placeholder; real router is separate
}

export function listTools(registry, options = {}) {
  const filter = options.status || null
  const rows = []
  for (const [name, tool] of Object.entries(registry.tools)) {
    if (!tool.currentVersion) continue
    const v = tool.versions[tool.currentVersion]
    if (filter && v.status !== filter) continue
    rows.push({
      name,
      version: tool.currentVersion,
      status: v.status,
      canaryPercent: v.canaryPercent,
      calls: v.stats.calls,
      errors: v.stats.errors,
      lastCallAt: v.stats.lastCallAt,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

// ─── 统计更新 ──────────────────────────────────────────────

export function recordCall(registry, name, options = {}) {
  const tool = getTool(registry, name)
  if (!tool) return null
  const v = tool.versions[tool.currentVersion]
  if (!v) return null
  v.stats.calls += 1
  v.stats.lastCallAt = new Date().toISOString()
  if (options.error === true) {
    v.stats.errors += 1
    v.stats.lastError = options.errorMessage || 'unknown'
  }
  return v.stats
}

export function resetForTest() {
  return defaultRegistry()
}

export {
  DEFAULT_CANARY_PERCENTS,
  DEFAULT_CANARY_MIN_CALLS,
  DEFAULT_CANARY_MAX_ERROR_RATE,
  VALID_STATUSES,
}
