// tool-generator.js — ToolSpec → 代码生成（LLM 注入）
//
// 定位：把 spec 转成可执行代码 + 测试代码。
//   - 不硬编码 LLM（由调用方注入 generateCode 避免绑死模型）
//   - 生成后自动跑三道安全门（spec 验证 + 危险 API 扫描 + 资源限制）
//   - 生成后自动跑测试（用 testCases 验证）
//
// 流程：
//   1. buildPrompt(spec) → 给 LLM 的 prompt
//   2. 调用 generateCode(prompt) → 拿到源码字符串
//   3. validateAll(spec, source) → 三道门
//   4. runTests(source, testCases, runner) → 跑测试
//   5. 返回 { source, testSource, validation, testResults, prompt }

import { validateSpec } from './tool-spec.js'
import { validateAll } from './tool-validator.js'

// ─── 常量 ───────────────────────────────────────────────────

const MAX_PROMPT_LEN = 8000
const MAX_SOURCE_LEN = 64 * 1024

// ─── Prompt 构建 ────────────────────────────────────────────

export function buildPrompt(spec) {
  validateSpec(spec)
  const lines = []
  lines.push(`Generate a JavaScript function for the following tool spec.\n`)
  lines.push(`Tool name: ${spec.name}`)
  lines.push(`Version: ${spec.version}`)
  lines.push(`Category: ${spec.category || 'custom'}`)
  lines.push(`Description: ${spec.description}`)
  lines.push(`\nSide effects (must honor): ${spec.sideEffects.join(', ')}`)
  lines.push(`\nInputs (JSON Schema-like):`)
  for (const inp of spec.inputs) {
    const req = inp.required ? '(required)' : '(optional)'
    const def = inp.default !== undefined ? `, default=${JSON.stringify(inp.default)}` : ''
    lines.push(`  - ${inp.name}: ${inp.type}${req}${def} — ${inp.description || ''}`)
  }
  lines.push(`\nOutput schema:`)
  lines.push(`  - ${spec.outputs.name}: ${spec.outputs.type} — ${spec.outputs.description || ''}`)
  if (spec.resources) {
    lines.push(`\nResource limits (must respect):`)
    if (spec.resources.timeoutMs) lines.push(`  - timeout: ${spec.resources.timeoutMs}ms`)
    if (spec.resources.memoryMB) lines.push(`  - memory: ${spec.resources.memoryMB}MB`)
    if (spec.resources.cpuMs) lines.push(`  - cpu: ${spec.resources.cpuMs}ms`)
  }
  lines.push(`\nTest cases (verify with these):`)
  for (const tc of spec.testCases) {
    lines.push(`  - ${tc.name}: args=${JSON.stringify(tc.args)} expect=${JSON.stringify(tc.expect)} ${tc.shouldThrow ? '[should throw]' : ''}`)
  }
  lines.push(`\nConstraints:`)
  lines.push(`  - Pure ESM (import/export) unless side effects say otherwise`)
  lines.push(`  - No child_process, no eval, no new Function, no rm -rf`)
  lines.push(`  - No hardcoded secrets/tokens`)
  lines.push(`  - No private network access (10/8, 192.168/16, 127.0.0.1)`)
  lines.push(`  - Throw on invalid input (do not return error objects)`)
  lines.push(`\nOutput format: ONLY the function source code (no markdown, no commentary).`)
  lines.push(`Use this signature: async function ${spec.name}(...args) { ... }`)
  lines.push(`Return the output schema's shape. Throw on errors.`)
  const prompt = lines.join('\n')
  if (prompt.length > MAX_PROMPT_LEN) {
    return prompt.slice(0, MAX_PROMPT_LEN) + '\n... [truncated]'
  }
  return prompt
}

// ─── 内部：解析 LLM 输出（剥 markdown 围栏） ───────────────

function stripCodeFences(s) {
  if (typeof s !== 'string') return ''
  let out = s.trim()
  // ```js ... ``` 或 ```javascript ... ```
  const fenceMatch = out.match(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```\s*$/i)
  if (fenceMatch) return fenceMatch[1].trim()
  // 兼容 ``` 在最后但没闭合
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:js|javascript)?\s*\n?/i, '')
    if (out.endsWith('```')) out = out.slice(0, -3)
    return out.trim()
  }
  return out
}

// ─── 主入口：生成 + 验证 + 测试 ───────────────────────────

//   options: { generateCode, testRunner, validateOptions }
//     generateCode(prompt: string) → string  (LLM)
//     testRunner(source, testCases) → {passed, failed, details}  (由调用方注入)
//     validateOptions: 传给 validateAll
//   返回: { spec, source, testSource, validation, testResults, prompt }
export async function generate(spec, options = {}) {
  validateSpec(spec)
  if (typeof options.generateCode !== 'function') {
    throw new Error('generate: options.generateCode must be function (LLM call)')
  }
  const prompt = buildPrompt(spec)
  const raw = await options.generateCode(prompt)
  const source = stripCodeFences(raw)
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('generate: LLM returned empty source')
  }
  if (source.length > MAX_SOURCE_LEN) {
    throw new Error(`generate: source too large: ${source.length} > ${MAX_SOURCE_LEN}`)
  }
  // 三道门
  const validation = validateAll(spec, source, options.validateOptions || {})
  if (!validation.pass) {
    return {
      spec,
      source,
      testSource: null,
      validation,
      testResults: null,
      prompt,
      failed: true,
    }
  }
  // 跑测试
  let testResults = null
  if (typeof options.testRunner === 'function') {
    try {
      testResults = await options.testRunner(source, spec.testCases, { spec })
    } catch (e) {
      testResults = { passed: 0, failed: spec.testCases.length, error: e.message }
    }
  } else {
    // 无 runner：跳过测试，但 mark skipped
    testResults = { passed: 0, failed: 0, skipped: spec.testCases.length }
  }
  return {
    spec,
    source,
    testSource: null,  // 暂不生成测试代码（testCases 已经能跑）
    validation,
    testResults,
    prompt,
    failed: testResults.failed > 0,
  }
}

// ─── 内部：剥 markdown fence（导出供测试） ─────────────────

export { stripCodeFences, MAX_PROMPT_LEN, MAX_SOURCE_LEN }
