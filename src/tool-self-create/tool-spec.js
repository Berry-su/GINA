// tool-spec.js — ToolSpec 数据结构 + 验证
//
// 定位：GINA 生成的"工具"必须有严格的规格描述，让：
//   - 验证器能检查（危险 API / 资源限制 / 副作用）
//   - 生成器能写代码（spec → code）
//   - 注册表能登记（versioning + canary）
//   - 测试能跑（testCases + assertions）
//   - 用户能信任（description + sideEffects 显式声明）
//
// ToolSpec 字段：
//   - name: string              工具名（小写 + 下划线），全局唯一
//   - version: string           semver (1.0.0)
//   - description: string       用户能读的功能描述（<= 280 字）
//   - category: string          分类（comms/filesystem/media/...）
//   - inputs: Schema[]          入参（JSON Schema 风格但简化）
//   - outputs: Schema           出参
//   - sideEffects: string[]     副作用声明（fs_write / net_call / shell_exec / ui_modify / state_read / none）
//   - testCases: TestCase[]    内置测试用例
//   - tags: string[]           用于检索
//   - estimatedComplexity: 1-10  复杂度（影响灰度策略）
//   - createdAt: ISO string
//
// Schema 简化：
//   { name, type: 'string'|'number'|'boolean'|'object'|'array', required: bool, description, default?, items? (for array) }

import crypto from 'node:crypto'

// ─── 常量 ───────────────────────────────────────────────────

const VALID_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array'])
const VALID_SIDE_EFFECTS = new Set([
  'none', 'fs_read', 'fs_write', 'net_call', 'shell_exec',
  'ui_modify', 'state_read', 'state_write', 'broadcast',
])
const NAME_REGEX = /^[a-z][a-z0-9_]{2,63}$/
const VERSION_REGEX = /^\d+\.\d+\.\d+$/
const MAX_NAME_LEN = 64
const MAX_DESCRIPTION_LEN = 280
const MAX_INPUTS = 16
const MAX_TEST_CASES = 64
const MAX_SIDE_EFFECTS = 8
const MAX_TAGS = 16
const MAX_TAG_LEN = 32

// ─── Schema 验证 ────────────────────────────────────────────

export function validateSchema(schema, where = 'schema') {
  if (!schema || typeof schema !== 'object') {
    throw new Error(`${where} must be an object`)
  }
  if (typeof schema.name !== 'string' || schema.name.length === 0) {
    throw new Error(`${where}.name must be non-empty string`)
  }
  if (!VALID_TYPES.has(schema.type)) {
    throw new Error(`${where}.type must be one of ${[...VALID_TYPES].join('|')}, got ${schema.type}`)
  }
  if (schema.type === 'array' && !schema.items) {
    throw new Error(`${where}.items required when type=array`)
  }
  if (schema.type === 'array' && schema.items) {
    validateSchema(schema.items, `${where}.items`)
  }
  if (schema.description != null && typeof schema.description !== 'string') {
    throw new Error(`${where}.description must be string`)
  }
  if (schema.required != null && typeof schema.required !== 'boolean') {
    throw new Error(`${where}.required must be boolean`)
  }
  if (schema.default !== undefined) {
    // type-check default
    if (schema.type === 'string' && typeof schema.default !== 'string') {
      throw new Error(`${where}.default must be string for type=string`)
    }
    if (schema.type === 'number' && typeof schema.default !== 'number') {
      throw new Error(`${where}.default must be number for type=number`)
    }
    if (schema.type === 'boolean' && typeof schema.default !== 'boolean') {
      throw new Error(`${where}.default must be boolean for type=boolean`)
    }
  }
  return schema
}

// ─── TestCase 验证 ──────────────────────────────────────────

export function validateTestCase(tc, where = 'testCase') {
  if (!tc || typeof tc !== 'object') {
    throw new Error(`${where} must be an object`)
  }
  if (typeof tc.name !== 'string' || tc.name.length === 0) {
    throw new Error(`${where}.name required`)
  }
  if (!Array.isArray(tc.args)) {
    throw new Error(`${where}.args must be an array`)
  }
  if (tc.expect !== undefined && typeof tc.expect !== 'object' && typeof tc.expect !== 'string' && typeof tc.expect !== 'number' && typeof tc.expect !== 'boolean') {
    throw new Error(`${where}.expect must be object/primitive (not function/undefined)`)
  }
  if (tc.shouldThrow != null && typeof tc.shouldThrow !== 'boolean') {
    throw new Error(`${where}.shouldThrow must be boolean`)
  }
  if (tc.timeoutMs != null && (typeof tc.timeoutMs !== 'number' || tc.timeoutMs < 0)) {
    throw new Error(`${where}.timeoutMs must be non-negative number`)
  }
  return tc
}

// ─── ToolSpec 主验证 ────────────────────────────────────────

export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('spec must be an object')
  }
  // name
  if (typeof spec.name !== 'string' || !NAME_REGEX.test(spec.name)) {
    throw new Error(`spec.name must match ${NAME_REGEX}, got ${JSON.stringify(spec.name)}`)
  }
  if (spec.name.length > MAX_NAME_LEN) {
    throw new Error(`spec.name too long (${spec.name.length} > ${MAX_NAME_LEN})`)
  }
  // version
  if (typeof spec.version !== 'string' || !VERSION_REGEX.test(spec.version)) {
    throw new Error(`spec.version must be semver X.Y.Z, got ${JSON.stringify(spec.version)}`)
  }
  // description
  if (typeof spec.description !== 'string' || spec.description.length === 0) {
    throw new Error('spec.description required')
  }
  if (spec.description.length > MAX_DESCRIPTION_LEN) {
    throw new Error(`spec.description too long (${spec.description.length} > ${MAX_DESCRIPTION_LEN})`)
  }
  // category
  if (spec.category != null && typeof spec.category !== 'string') {
    throw new Error('spec.category must be string')
  }
  // inputs
  if (!Array.isArray(spec.inputs)) {
    throw new Error('spec.inputs must be an array')
  }
  if (spec.inputs.length > MAX_INPUTS) {
    throw new Error(`spec.inputs too many (${spec.inputs.length} > ${MAX_INPUTS})`)
  }
  const inputNames = new Set()
  for (let i = 0; i < spec.inputs.length; i++) {
    const s = spec.inputs[i]
    validateSchema(s, `spec.inputs[${i}]`)
    if (inputNames.has(s.name)) {
      throw new Error(`spec.inputs[${i}].name duplicate: ${s.name}`)
    }
    inputNames.add(s.name)
  }
  // outputs
  if (!spec.outputs || typeof spec.outputs !== 'object') {
    throw new Error('spec.outputs required')
  }
  validateSchema(spec.outputs, 'spec.outputs')
  // sideEffects
  if (!Array.isArray(spec.sideEffects)) {
    throw new Error('spec.sideEffects must be array')
  }
  if (spec.sideEffects.length > MAX_SIDE_EFFECTS) {
    throw new Error(`spec.sideEffects too many (${spec.sideEffects.length} > ${MAX_SIDE_EFFECTS})`)
  }
  for (const e of spec.sideEffects) {
    if (!VALID_SIDE_EFFECTS.has(e)) {
      throw new Error(`spec.sideEffects has invalid: ${e} (valid: ${[...VALID_SIDE_EFFECTS].join('|')})`)
    }
  }
  // 必须显式声明副作用（不能空数组假装无副作用）
  if (spec.sideEffects.length === 0) {
    throw new Error('spec.sideEffects must explicitly include "none" if no side effects, or actual effects')
  }
  // testCases
  if (!Array.isArray(spec.testCases)) {
    throw new Error('spec.testCases must be array')
  }
  if (spec.testCases.length > MAX_TEST_CASES) {
    throw new Error(`spec.testCases too many (${spec.testCases.length} > ${MAX_TEST_CASES})`)
  }
  if (spec.testCases.length === 0) {
    throw new Error('spec.testCases must have at least 1 case (proves the tool works)')
  }
  for (let i = 0; i < spec.testCases.length; i++) {
    validateTestCase(spec.testCases[i], `spec.testCases[${i}]`)
  }
  // tags
  if (spec.tags != null) {
    if (!Array.isArray(spec.tags)) {
      throw new Error('spec.tags must be array')
    }
    if (spec.tags.length > MAX_TAGS) {
      throw new Error(`spec.tags too many`)
    }
    for (const t of spec.tags) {
      if (typeof t !== 'string' || t.length === 0 || t.length > MAX_TAG_LEN) {
        throw new Error(`spec.tag invalid: must be 1-${MAX_TAG_LEN} chars`)
      }
    }
  }
  // estimatedComplexity
  if (spec.estimatedComplexity != null) {
    const c = spec.estimatedComplexity
    if (typeof c !== 'number' || c < 1 || c > 10 || !Number.isInteger(c)) {
      throw new Error('spec.estimatedComplexity must be integer 1-10')
    }
  }
  return spec
}

// ─── Spec 工厂 ──────────────────────────────────────────────

export function createSpec(partial = {}) {
  const spec = {
    name: partial.name,
    version: partial.version || '1.0.0',
    description: partial.description || '',
    category: partial.category || 'custom',
    inputs: Array.isArray(partial.inputs) ? partial.inputs : [],
    outputs: partial.outputs || { name: 'result', type: 'object', description: 'output' },
    sideEffects: Array.isArray(partial.sideEffects) ? partial.sideEffects : ['none'],
    testCases: Array.isArray(partial.testCases) ? partial.testCases : [],
    tags: Array.isArray(partial.tags) ? partial.tags : [],
    estimatedComplexity: typeof partial.estimatedComplexity === 'number' ? partial.estimatedComplexity : 5,
    createdAt: new Date().toISOString(),
    ...partial,
  }
  return spec
}

// ─── 哈希 + diff（用于版本比较 + 内容寻址） ─────────────────

export function specHash(spec) {
  // 稳定哈希：基于规范化 JSON（key 排序）
  const normalized = JSON.stringify(spec, Object.keys(spec).sort())
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export function isCompatibleVersion(v1, v2) {
  // 同 major 视为兼容
  const m1 = v1.split('.').map(Number)
  const m2 = v2.split('.').map(Number)
  if (m1.length !== 3 || m2.length !== 3) return false
  return m1[0] === m2[0]
}

// ─── 风险评估（用于决定灰度比例） ──────────────────────────

export function assessRisk(spec) {
  let score = 0
  // 副作用权重
  const se = new Set(spec.sideEffects)
  if (se.has('shell_exec')) score += 5
  if (se.has('fs_write')) score += 3
  if (se.has('net_call')) score += 2
  if (se.has('state_write')) score += 2
  if (se.has('ui_modify')) score += 1
  // 复杂度权重
  score += spec.estimatedComplexity || 5
  // 入参越多越复杂
  score += spec.inputs.length * 0.5
  // 分类权重（filesystem/shell/comms 高风险）
  const highRiskCategories = new Set(['shell', 'filesystem', 'comms', 'exec', 'system'])
  if (highRiskCategories.has(spec.category)) score += 2
  return score
}

export {
  NAME_REGEX,
  VERSION_REGEX,
  VALID_TYPES,
  VALID_SIDE_EFFECTS,
  MAX_NAME_LEN,
  MAX_DESCRIPTION_LEN,
}
