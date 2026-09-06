// tool-validator.js — 3 道安全门
//
// 定位：GINA 自创的工具必须通过 3 道门才能进 registry：
//   Gate 1: Schema 验证（tool-spec 验证） — 结构合法
//   Gate 2: 危险 API 黑名单（源码静态扫描）— 行为安全
//   Gate 3: 资源限制（超时 + 内存 + 调用频次）— 运行时安全
//
// 设计原则：
//   - 黑名单保守（宁可误杀不放过）：child_process / eval / Function / rm -rf / 私钥路径
//   - 白名单不强制（业务多样），但鼓励"无副作用 / 纯函数"工具
//   - 资源限制可由调用方配置

import { validateSpec, assessRisk } from './tool-spec.js'

// ─── 危险 API 黑名单 ───────────────────────────────────────

const DANGEROUS_PATTERNS = [
  // Node 内置危险 API
  { pattern: /\bchild_process\b/, reason: 'child_process is sandboxed separately' },
  { pattern: /\brequire\s*\(\s*['"]child_process['"]\s*\)/, reason: 'require child_process' },
  { pattern: /\beval\s*\(/, reason: 'eval() is forbidden in self-created tools' },
  { pattern: /\bnew\s+Function\s*\(/, reason: 'new Function() is forbidden' },
  { pattern: /\bimport\s*\(\s*['"]child_process['"]\s*\)/, reason: 'dynamic import child_process' },
  { pattern: /\bprocess\.binding\b/, reason: 'process.binding bypasses sandbox' },
  { pattern: /\bprocess\.dlopen\b/, reason: 'process.dlopen loads native modules' },
  // 文件系统暴力删除
  { pattern: /\brm\s+-rf?\s+\//, reason: 'rm -rf on absolute path forbidden' },
  { pattern: /\brm\s+-rf?\s+~/, reason: 'rm -rf on home forbidden' },
  { pattern: /\bfs\.rmSync\s*\(\s*['"]\/['"]/, reason: 'fs.rmSync on root forbidden' },
  { pattern: /\bfs\.unlinkSync\s*\(\s*['"]\/['"]/, reason: 'fs.unlinkSync on root forbidden' },
  // 网络外发敏感数据
  { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/i, reason: 'hardcoded API key' },
  { pattern: /password\s*[:=]\s*['"][^'"]+['"]/i, reason: 'hardcoded password' },
  { pattern: /secret\s*[:=]\s*['"][^'"]+['"]/i, reason: 'hardcoded secret' },
  { pattern: /token\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/, reason: 'hardcoded token' },
  // 私钥路径
  { pattern: /\.ssh\//, reason: '.ssh path forbidden' },
  { pattern: /\.aws\//, reason: '.aws path forbidden' },
  { pattern: /\.gnupg\//, reason: '.gnupg path forbidden' },
  { pattern: /\.netrc/, reason: '.netrc forbidden' },
  { pattern: /\/etc\/passwd/, reason: '/etc/passwd forbidden' },
  { pattern: /\/etc\/shadow/, reason: '/etc/shadow forbidden' },
]

const FORBIDDEN_NET_HOSTS = [
  /169\.254\./,            // link-local
  /127\.0\.0\.1/,           // loopback
  /localhost/i,
  /0\.0\.0\.0/,
  /10\.\d+\.\d+\.\d+/,      // private 10/8
  /192\.168\./,             // private 192.168/16
  /172\.(1[6-9]|2\d|3[01])\./, // private 172.16/12
]

// ─── Gate 1: Schema 验证 ───────────────────────────────────

export function gateSchema(spec) {
  try {
    validateSpec(spec)
    return { pass: true, reasons: [] }
  } catch (e) {
    return { pass: false, reasons: [`schema: ${e.message}`] }
  }
}

// ─── Gate 2: 危险 API 黑名单（源码静态扫描） ───────────────

export function gateSourceSafety(sourceCode, options = {}) {
  const reasons = []
  if (typeof sourceCode !== 'string') {
    return { pass: false, reasons: ['source must be string'] }
  }
  if (sourceCode.length > (options.maxSize || 64 * 1024)) {
    reasons.push(`source too large: ${sourceCode.length} > ${options.maxSize || 64 * 1024}`)
  }
  // 危险 API 扫描
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(sourceCode)) {
      reasons.push(reason)
    }
  }
  // 内网访问（可选）
  if (options.checkPrivateNetwork !== false) {
    for (const host of FORBIDDEN_NET_HOSTS) {
      if (host.test(sourceCode)) {
        reasons.push(`private network access forbidden: ${host}`)
        break
      }
    }
  }
  return { pass: reasons.length === 0, reasons }
}

// ─── Gate 3: 资源限制（声明式） ───────────────────────────

export function gateResourceLimits(spec, options = {}) {
  const reasons = []
  // 默认限制（可被 options 覆盖）
  const limits = {
    maxTimeoutMs: options.maxTimeoutMs || 30_000,
    maxMemoryMB: options.maxMemoryMB || 256,
    maxCpuMs: options.maxCpuMs || 5_000,
    maxInvocationsPerHour: options.maxInvocationsPerHour || 1000,
  }
  // 检查 spec 是否声明了资源限制
  if (!spec.resources) {
    // 不强制，但建议
    return { pass: true, reasons: [], limits, advisory: true }
  }
  const r = spec.resources
  if (typeof r.timeoutMs === 'number' && r.timeoutMs > limits.maxTimeoutMs) {
    reasons.push(`declared timeoutMs ${r.timeoutMs} > max ${limits.maxTimeoutMs}`)
  }
  if (typeof r.memoryMB === 'number' && r.memoryMB > limits.maxMemoryMB) {
    reasons.push(`declared memoryMB ${r.memoryMB} > max ${limits.maxMemoryMB}`)
  }
  if (typeof r.cpuMs === 'number' && r.cpuMs > limits.maxCpuMs) {
    reasons.push(`declared cpuMs ${r.cpuMs} > max ${limits.maxCpuMs}`)
  }
  if (typeof r.invocationsPerHour === 'number' && r.invocationsPerHour > limits.maxInvocationsPerHour) {
    reasons.push(`declared invocationsPerHour ${r.invocationsPerHour} > max ${limits.maxInvocationsPerHour}`)
  }
  return { pass: reasons.length === 0, reasons, limits, advisory: false }
}

// ─── 三门合一 ──────────────────────────────────────────────

export function validateAll(spec, sourceCode, options = {}) {
  const g1 = gateSchema(spec)
  const g2 = gateSourceSafety(sourceCode, options)
  const g3 = gateResourceLimits(spec, options)
  const allPass = g1.pass && g2.pass && g3.pass
  const risk = assessRisk(spec)
  return {
    pass: allPass,
    risk,
    gates: {
      schema: g1,
      sourceSafety: g2,
      resources: g3,
    },
    reasons: [
      ...g1.reasons,
      ...g2.reasons,
      ...g3.reasons,
    ],
  }
}

// ─── 灰度比例建议（基于风险） ──────────────────────────────

export function suggestCanaryPercent(spec, options = {}) {
  const risk = assessRisk(spec)
  // 风险 0-5: 100% 灰度（无副作用 + 简单）
  // 风险 5-10: 50% 灰度
  // 风险 10-15: 10% 灰度
  // 风险 15+: 1% 灰度
  const thresholds = options.thresholds || [
    { max: 5, percent: 100 },
    { max: 10, percent: 50 },
    { max: 15, percent: 10 },
    { max: Infinity, percent: 1 },
  ]
  for (const t of thresholds) {
    if (risk <= t.max) return { percent: t.percent, risk }
  }
  return { percent: 1, risk }
}

export {
  DANGEROUS_PATTERNS,
  FORBIDDEN_NET_HOSTS,
}
