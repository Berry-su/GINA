/**
 * ui-design/design-tokens.js — 设计系统（确定性）
 *
 * 把「高级审美」固化成可执行、可验证的数据：token + 禁止清单 + 规则检查。
 * 这是整个 UI 设计生成能力的地基 —— LLM 只负责「理解参考图 + 排布内容」，
 * 审美由本模块的 token + 规则锁死，杜绝「AI 感」廉价设计（渐变/发光/玻璃拟态/紫色全息）。
 *
 * 用户可换风格 = 换一套 token 集。本文件内置 Monochrome Precision HUD（用户已拍板定稿）。
 */

// ─────────────────────────────────────────────────────────────
// Token 集
// ─────────────────────────────────────────────────────────────

export const MONOCHROME_HUD = Object.freeze({
  id: 'monochrome-hud',
  label: '单色精密仪器',
  palette: {
    bg: '#050506',
    surface: '#0a0a0b',
    surfaceAlt: '#0f0f10',
    line: '#2a2a2c',
    lineBright: '#3a3a3c',
    text: '#e6e6e6',
    textDim: '#8a8a8e',
    textFaint: '#555558',
    up: '#e5484d',     // 涨红（A 股语义）
    down: '#46a758',   // 跌绿
    risk: '#ff3b30',   // 风控
    neutral: '#8a8a8e',
  },
  typography: {
    label: { uppercase: true, letterSpacing: '0.08em', size: 11, weight: 500, family: 'ui-sans-serif, system-ui' },
    value: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 14, weight: 400 },
    title: { uppercase: true, letterSpacing: '0.04em', size: 16, weight: 600, family: 'ui-sans-serif, system-ui' },
    body: { size: 13, weight: 400, family: 'ui-sans-serif, system-ui' },
  },
  border: { width: 1, corner: 'cut', radius: 0 },  // 切角 + 零圆角，拒绝大圆角卡片
  spacing: { unit: 8, gap: 8, pad: 12 },
  // 语义色映射（component 里的 tone → 实际颜色）
  tones: {
    neutral: 'text',
    up: 'up',
    down: 'down',
    risk: 'risk',
    dim: 'textDim',
  },
})

// 内置 token 集注册表（用户后续可加自己的风格）
export const HOLOGRAM_BLUE = Object.freeze({
  id: 'hologram-blue',
  label: '蓝色全息 · 钢铁侠贾维斯',
  palette: {
    bg: '#000000',
    surface: 'rgba(10, 30, 60, 0.35)',
    surfaceAlt: 'rgba(15, 45, 90, 0.40)',
    line: 'rgba(90, 170, 255, 0.40)',
    lineBright: 'rgba(130, 200, 255, 0.80)',
    text: '#dbe9ff',
    textDim: '#6f96c4',
    textFaint: '#33507a',
    up: '#e5484d',
    down: '#46a758',
    risk: '#ff3b30',
    neutral: '#6f96c4',
    glow: '#3b9dff',
    glowLight: '#8fc9ff',
  },
  typography: {
    label: { uppercase: true, letterSpacing: '0.18em', size: 11, weight: 500, family: 'ui-sans-serif, system-ui' },
    value: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 14, weight: 400 },
    title: { uppercase: true, letterSpacing: '0.06em', size: 16, weight: 600, family: 'ui-sans-serif, system-ui' },
    body: { size: 13, weight: 400, family: 'ui-sans-serif, system-ui' },
  },
  border: { width: 1, corner: 'cut', radius: 0 },
  spacing: { unit: 8, gap: 8, pad: 12 },
  tones: { neutral: 'text', up: 'up', down: 'down', risk: 'risk', dim: 'textDim' },
})

export const TOKEN_SETS = Object.freeze({
  [MONOCHROME_HUD.id]: MONOCHROME_HUD,
  [HOLOGRAM_BLUE.id]: HOLOGRAM_BLUE,
})

// ─────────────────────────────────────────────────────────────
// 禁止清单（审美的负面约束）
// ─────────────────────────────────────────────────────────────

export const FORBIDDEN_PATTERNS = Object.freeze([
  { re: /gradient|linear-gradient|radial-gradient/i, reason: '渐变' },
  { re: /glassmorphism|backdrop-filter|backdrop-blur|glass/i, reason: '玻璃拟态' },
  { re: /cyan.*purple|purple.*cyan|青紫/i, reason: '紫色全息/AI 感' },
  { re: /border-radius:\s*(?:[2-9]\d|\d{3,})px/, reason: '大圆角卡片' },
  { re: /emoji|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, reason: 'emoji 图标' },
])

export const FORBIDDEN_COLORS = Object.freeze([
  '#7c3aed', '#8b5cf6', '#a855f7', '#c084fc', '#d946ef', '#22d3ee', '#06b6d4', '#67e8f9', // 紫/青/品红（AI 感重灾区）
])

// ─────────────────────────────────────────────────────────────
// 组件变体（Spec 里允许出现的 type + variant，未注册即违规）
// ─────────────────────────────────────────────────────────────

export const ELEMENT_TYPES = Object.freeze({
  text: ['label', 'value', 'title', 'body'],
  panel: ['default', 'metric', 'table'],
  metric: ['neutral', 'up', 'down', 'risk'],
  button: ['primary', 'ghost'],
  table: ['default'],
  divider: ['default'],
  status: ['default'],
  list: ['default'],
  sphere: ['default'],   // 3D 能量球（蓝色发光全息，value=height 像素）
  brain: ['default'],    // 3D 全息大脑（value=size 像素）
  hud: ['default'],      // HUD 装饰（环形刻度/扫描线）
})

// ─────────────────────────────────────────────────────────────
// 规则检查（审美兜底）
// ─────────────────────────────────────────────────────────────

function isSpacingValid(value, unit) {
  return Number.isInteger(Number(value)) && Number(value) % unit === 0
}

/**
 * 检查一个 Design Spec 是否合规（确定性）。
 * @param {object} spec
 * @param {object} [tokens] 目标 token 集（默认 monochrome-hud）
 * @returns {{ok:boolean, errors:string[]}}
 */
export function checkSpec(spec, tokens = MONOCHROME_HUD) {
  const errors = []
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec 必须是对象'] }
  if (!spec.sections || !Array.isArray(spec.sections) || spec.sections.length === 0) {
    errors.push('spec.sections 必须是非空数组')
  }

  const tokenSet = TOKEN_SETS[spec.tokenSet ?? MONOCHROME_HUD.id] ?? MONOCHROME_HUD
  const unit = tokenSet.spacing.unit

  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object') return
    if (depth > 3) errors.push(`嵌套层级过深（>3）：${node.type ?? '?'}`)

    // type/variant 必须注册
    const variants = ELEMENT_TYPES[node.type]
    if (!variants) {
      errors.push(`未注册的元素类型：${node.type ?? '(缺失)'}`)
    } else if (node.variant && !variants.includes(node.variant)) {
      errors.push(`type=${node.type} 下未注册的 variant：${node.variant}`)
    }

    // tone 必须映射
    if (node.tone && !(node.tone in tokenSet.tones)) {
      errors.push(`未注册的 tone：${node.tone}`)
    }

    // 间距是栅格整数倍
    if (node.gap !== undefined && !isSpacingValid(node.gap, unit)) {
      errors.push(`gap=${node.gap} 不是 ${unit}pt 栅格整数倍`)
    }
    if (node.pad !== undefined && !isSpacingValid(node.pad, unit)) {
      errors.push(`pad=${node.pad} 不是 ${unit}pt 栅格整数倍`)
    }

    // 禁止颜色
    if (typeof node.color === 'string') {
      for (const c of FORBIDDEN_COLORS) {
        if (node.color.toLowerCase() === c) errors.push(`禁用颜色：${c}`)
      }
    }
    // 禁止模式（扫描样式片段）
    const styleText = [node.style, node.css, node.content, node.title].filter(s => typeof s === 'string').join(' ')
    for (const f of FORBIDDEN_PATTERNS) {
      if (f.re.test(styleText)) errors.push(`禁止模式「${f.reason}」`)
    }

    // 递归子节点
    for (const child of (node.children ?? [])) walk(child, depth + 1)
  }

  for (const section of (spec.sections ?? [])) walk(section, 0)

  return { ok: errors.length === 0, errors: [...new Set(errors)] }
}
