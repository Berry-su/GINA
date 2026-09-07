// evolution-gate.js — 防垃圾进化两道门
//
// 定位：现有 confidence + verifyKnowledge 只过滤置信度低的知识，但没有"两道门"：
//   第 1 道（Gate 1 - 垃圾过滤）：confidence 太低 / 重要性太低 / 短时间高频出现 → 拒入池
//   第 2 道（Gate 2 - 危险拦截）：涉及删除/修改/外发/rm-rf 等破坏性操作 → 必须人确认
//
// 自进化 5 项（自进化 5 项 commit 444f65f→c1d623b→860fecb）共用这两个门。
// meta-learning.runMetaLearningCycle() / arch-evolution.applyProposal() /
// tool-self-create.register() 都过 evolution-gate。
//
// 硬约束（老板 9-07 翻身唯一机会 + 零妥协）：
//   - 默认 safe（所有操作先过门）
//   - 第 2 道永远要人确认（dryRun 也不行）
//   - 失败立即拒绝 + 详细原因（不静默吞）

// ─── 常量 ───────────────────────────────────────────────────

// Gate 1 阈值
const MIN_CONFIDENCE = 0.5
const MIN_IMPORTANCE = 0.2
const MIN_OBSERVATIONS = 3
const MIN_TIME_SPAN_MS = 60 * 1000  // 至少 1 分钟的观察窗口

// 危险操作关键词（Gate 2 拦截）
const DANGEROUS_OPERATION_KEYWORDS = [
  'rm -rf',
  'rm -fr',
  'rm -f /',
  'delete-all',
  'drop-table',
  'drop-database',
  'truncate',
  'git push --force',
  'git push -f',
  'git reset --hard',
  'git clean -fd',
  'npm uninstall',
  'format',
  'wipe',
  'kill -9',
  'sudo',
  'chmod 777',
  'curl ... | bash',  // curl | sh 是远程代码执行
  'wget ... | bash',
  'ssh-keygen',
  'passwd',
  'mkfs',
  'dd if=',
  '> /dev/sd',
]

// 高敏感路径（Gate 2 拦截）
const SENSITIVE_PATH_PATTERNS = [
  /\.ssh\//,
  /\.aws\//,
  /\.gnupg\//,
  /\.netrc/,
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /\.gina\//,
  /\.config\/git/,
  /\/System\//,
  /\/usr\//,
]

// 网络外发敏感操作（Gate 2 拦截）
const SENSITIVE_NET_OPERATION_KEYWORDS = [
  'http_post_credentials',
  'http_post_password',
  'http_post_token',
  'http_post_api_key',
  'http_post_secret',
  'fetch-and-execute',
  'fetch and execute',
  'curl | bash',
  'wget | bash',
  'curl | sh',
  'wget | sh',
]

// 全部危险模式（按类别）
const DANGEROUS_PATTERNS = [
  { category: 'shell', patterns: DANGEROUS_OPERATION_KEYWORDS },
  { category: 'path', patterns: SENSITIVE_PATH_PATTERNS },
  { category: 'network', patterns: SENSITIVE_NET_OPERATION_KEYWORDS },
]

// Gate 2 需要人确认的操作类型
const HUMAN_REQUIRED_CATEGORIES = new Set(['shell', 'path', 'network'])

// ─── 内部工具 ───────────────────────────────────────────────

function clamp01(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function isEmpty(s) {
  return !s || (typeof s === 'string' && s.trim().length === 0)
}

// 从 candidate 提取 confidence
function extractConfidence(c) {
  if (!c || typeof c !== 'object') return 0
  if (typeof c.confidence === 'number') return clamp01(c.confidence)
  if (typeof c.metadata?.confidence === 'number') return clamp01(c.metadata.confidence)
  return 0
}

// 从 candidate 提取 importance
function extractImportance(c) {
  if (!c || typeof c !== 'object') return 0
  if (typeof c.importance === 'number') return clamp01(c.importance)
  if (typeof c.metadata?.importance === 'number') return clamp01(c.metadata.importance)
  return 0
}

// 从 candidate 提取所有需要扫描的字符串
function extractScanable(c) {
  const fields = []
  if (typeof c.description === 'string') fields.push(c.description)
  if (typeof c.action === 'string') fields.push(c.action)
  if (typeof c.command === 'string') fields.push(c.command)
  if (typeof c.code === 'string') fields.push(c.code)
  if (typeof c.file === 'string') fields.push(c.file)
  if (typeof c.path === 'string') fields.push(c.path)
  if (typeof c.url === 'string') fields.push(c.url)
  if (typeof c.tool === 'string') fields.push(c.tool)
  if (typeof c.metadata?.action === 'string') fields.push(c.metadata.action)
  if (Array.isArray(c.tags)) fields.push(...c.tags.filter(t => typeof t === 'string'))
  return fields.join('\n')
}

// 匹配危险模式
function matchDangerousPatterns(text) {
  if (isEmpty(text)) return []
  const matches = []
  for (const { category, patterns } of DANGEROUS_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern instanceof RegExp) {
        if (pattern.test(text)) {
          matches.push({ category, pattern: pattern.toString(), text: text.match(pattern)?.[0] || '' })
        }
      } else if (typeof pattern === 'string') {
        if (text.includes(pattern)) {
          matches.push({ category, pattern, text: pattern })
        }
      }
    }
  }
  return matches
}

// ─── Gate 1: 垃圾过滤 ──────────────────────────────────────

// 第 1 道：垃圾过滤
//   拒绝条件（任一）：
//     - confidence < MIN_CONFIDENCE (0.5)
//     - importance < MIN_IMPORTANCE (0.2)
//     - 缺少元数据关键字段（name/description/source）
//     - observations < MIN_OBSERVATIONS (3)
//     - 时间跨度 < MIN_TIME_SPAN_MS (1 分钟)
export function gate1GarbageFilter(candidate, options = {}) {
  const reasons = []
  const confidence = extractConfidence(candidate)
  const importance = extractImportance(candidate)
  if (confidence < MIN_CONFIDENCE) {
    reasons.push(`confidence ${confidence.toFixed(2)} < ${MIN_CONFIDENCE}`)
  }
  if (importance < MIN_IMPORTANCE) {
    reasons.push(`importance ${importance.toFixed(2)} < ${MIN_IMPORTANCE}`)
  }
  // 元数据关键字段
  if (isEmpty(candidate?.name) && isEmpty(candidate?.description) && isEmpty(candidate?.action)) {
    reasons.push('missing required fields: name/description/action')
  }
  // 来源（必须有 source 或 trigger 标识是哪儿来的）
  if (isEmpty(candidate?.source) && isEmpty(candidate?.trigger)) {
    reasons.push('missing source/trigger (where did this come from?)')
  }
  // 观察次数（仅在显式提供时检查，避免误拒）
  const hasObs = options.observations != null || candidate?.observations != null || candidate?.useCount != null
  if (hasObs) {
    const obs = options.observations != null ? options.observations : (candidate?.observations || candidate?.useCount || 0)
    if (typeof obs === 'number' && obs < MIN_OBSERVATIONS) {
      reasons.push(`observations ${obs} < ${MIN_OBSERVATIONS}`)
    }
  }
  // 时间跨度（仅在显式提供时检查）
  const hasTs = options.timeSpanMs != null || candidate?.timeSpanMs != null
  if (hasTs) {
    const ts = options.timeSpanMs != null ? options.timeSpanMs : (candidate?.timeSpanMs || 0)
    if (typeof ts === 'number' && ts > 0 && ts < MIN_TIME_SPAN_MS) {
      reasons.push(`time span ${ts}ms < ${MIN_TIME_SPAN_MS}ms (too short window)`)
    }
  }
  return {
    pass: reasons.length === 0,
    reasons,
    confidence,
    importance,
  }
}

// ─── Gate 2: 危险操作拦截 ──────────────────────────────────

// 第 2 道：危险操作拦截
//   危险操作 → 必须人确认（不自动通过）
export function gate2DangerousOps(candidate, options = {}) {
  const reasons = []
  const scanable = extractScanable(candidate)
  const matches = matchDangerousPatterns(scanable)
  if (matches.length > 0) {
    for (const m of matches) {
      reasons.push(`dangerous ${m.category} pattern detected: ${m.text}`)
    }
  }
  return {
    pass: reasons.length === 0,
    humanRequired: matches.length > 0 && matches.some(m => HUMAN_REQUIRED_CATEGORIES.has(m.category)),
    matches,
    reasons,
  }
}

// ─── 两道门合一 ────────────────────────────────────────────

// 通过两道门检查
//   options: { observations, timeSpanMs, humanApproved: bool }
//   返回: {
//     pass, blocked, humanRequired,
//     gate1, gate2,
//     reasons: [...],
//     finalDecision: 'approved' | 'rejected_garbage' | 'rejected_dangerous' | 'awaiting_human'
//   }
export function checkEvolutionGate(candidate, options = {}) {
  const gate1 = gate1GarbageFilter(candidate, options)
  const gate2 = gate2DangerousOps(candidate, options)
  const allReasons = [...gate1.reasons, ...gate2.reasons]
  // 决策树
  if (!gate1.pass) {
    return {
      pass: false,
      blocked: true,
      humanRequired: false,
      gate1,
      gate2,
      reasons: allReasons,
      finalDecision: 'rejected_garbage',
    }
  }
  if (!gate2.pass) {
    if (gate2.humanRequired) {
      if (options.humanApproved === true) {
        return {
          pass: true,
          blocked: false,
          humanRequired: true,
          gate1,
          gate2,
          reasons: allReasons,
          finalDecision: 'approved',
          note: 'human-approved dangerous operation',
        }
      }
      return {
        pass: false,
        blocked: true,
        humanRequired: true,
        gate1,
        gate2,
        reasons: allReasons,
        finalDecision: 'awaiting_human',
      }
    }
    return {
      pass: false,
      blocked: true,
      humanRequired: false,
      gate1,
      gate2,
      reasons: allReasons,
      finalDecision: 'rejected_dangerous',
    }
  }
  return {
    pass: true,
    blocked: false,
    humanRequired: false,
    gate1,
    gate2,
    reasons: [],
    finalDecision: 'approved',
  }
}

// ─── 批量 ──────────────────────────────────────────────────

// 批量检查（用于自进化 5 项的批处理）
//   options: { humanApprovedFor: Set<idx> }
//   返回: { approved, awaitingHuman, rejected, results }
export function batchCheckEvolutionGate(candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : []
  const approved = []
  const awaitingHuman = []
  const rejected = []
  const results = []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const humanApproved = options.humanApprovedFor instanceof Set
      ? options.humanApprovedFor.has(i)
      : false
    const r = checkEvolutionGate(c, { ...options, humanApproved })
    results.push({ index: i, candidate: c, result: r })
    if (r.finalDecision === 'approved') approved.push({ index: i, candidate: c })
    else if (r.finalDecision === 'awaiting_human') awaitingHuman.push({ index: i, candidate: c, result: r })
    else rejected.push({ index: i, candidate: c, result: r })
  }
  return {
    total: list.length,
    approved,
    awaitingHuman,
    rejected,
    results,
    stats: {
      approved: approved.length,
      awaitingHuman: awaitingHuman.length,
      rejected: rejected.length,
    },
  }
}

export {
  MIN_CONFIDENCE,
  MIN_IMPORTANCE,
  MIN_OBSERVATIONS,
  MIN_TIME_SPAN_MS,
  DANGEROUS_OPERATION_KEYWORDS,
  SENSITIVE_PATH_PATTERNS,
  SENSITIVE_NET_OPERATION_KEYWORDS,
  DANGEROUS_PATTERNS,
  HUMAN_REQUIRED_CATEGORIES,
}
