/**
 * ui-design/spec-generator.js — 设计语言 + 需求 → Design Spec（P4，LLM）
 *
 * 让 LLM 在「设计系统强约束」内生成结构化 Design Spec。
 * 关键：prompt 里注入 token 集、允许的元素 type/variant、禁止清单 ——
 * LLM 只负责「理解需求 + 排布内容」，审美由 token 锁死，生成后再过 checkSpec 规则检查。
 *
 * 注入式设计：LLM 生成函数由调用方注入（复用 callLLM），未注入时返回明确错误。
 */

import { TOKEN_SETS, MONOCHROME_HUD, ELEMENT_TYPES, FORBIDDEN_PATTERNS } from './design-tokens.js'
import { validateSpec } from './design-spec.js'

function buildElementTypeHint() {
  return Object.entries(ELEMENT_TYPES)
    .map(([type, variants]) => `- ${type}: variant ∈ [${variants.join('|')}]`)
    .join('\n')
}

function buildForbiddenHint() {
  return FORBIDDEN_PATTERNS.map((f) => `- 禁止：${f.reason}`).join('\n')
}

function buildPrompt(language, requirement, tokens) {
  return `你是资深 UI 设计师，负责把需求排布成结构化界面描述（Design Spec）。

【设计系统（必须严格遵守，不得自由发挥）】
风格集：${tokens.label}
色板（只能从这里取色）：${JSON.stringify(tokens.palette)}
允许的元素类型与变体：
${buildElementTypeHint()}

【审美负面约束】
${buildForbiddenHint()}

【参考图设计语言（供你把握气质，但色板仍以上方 token 为准）】
${JSON.stringify(language, null, 2)}

【用户需求】
${requirement}

【输出要求】
1. 只输出 JSON，不要输出任何解释文字或 markdown 代码块围栏；
2. JSON 结构：{ "name": "界面名", "tokenSet": "${tokens.id}", "layout": {"type":"grid","columns":12,"gap":8,"rows":["auto","1fr","auto"]}, "sections": [ ... ] }；
3. sections 是界面区块数组，每个元素只允许 type/variant/tone/content/title/label/value/span/gap/pad/children/items 这些字段；
4. 间距 gap/pad 必须是 ${tokens.spacing.unit} 的整数倍；
5. 嵌套 children 不超过 3 层；
6. type 与 variant 都必须从上方的「允许的元素类型与变体」里**精确**取值：variant 只能填 variant 列表里列出的词，禁止自创、禁止把色板里的颜色名（textDim/textFaint/up/down/risk）当 variant；要淡化/强调文字请用 tone（dim/up/down/risk），不要改 variant；
7. 元素类型按语义选择：文字用 text，容器/面板用 panel，指标用 metric，状态用 status，表格用 table，列表用 list；当需求出现「能量球/核心球/发光球/球体」时**必须**用 type=sphere（value=高度像素，如 460）；出现「大脑/脑部/脑」时**必须**用 type=brain（value=尺寸像素，如 190）；出现「环形刻度/扫描线/HUD 环」时用 type=hud；list 的 items 用字符串数组或 {label:"..."}；
8. 内容要贴合用户需求，布局要合理（顶栏/主区/底栏）。`
}

/**
 * 生成 Design Spec（LLM 在约束内排布）。
 * @param {object} args
 * @param {object} args.language 参考图设计语言（extractDesignLanguage 的输出）
 * @param {string} args.requirement 用户需求描述
 * @param {string} [args.tokenSet] 目标 token 集（默认 monochrome-hud）
 * @param {(prompt:string)=>Promise<string>} [args.llmFn] 注入的 LLM 生成函数
 * @param {number} [args.maxRetries] 规则检查不过关时重生成次数（默认 2）
 * @returns {Promise<{ok:boolean, spec?:object, errors?:string[], attempts?:number}>}
 */
export async function generateSpec({ language, requirement, tokenSet = MONOCHROME_HUD.id, llmFn, maxRetries = 2 }) {
  if (typeof llmFn !== 'function') {
    return { ok: false, errors: ['未注入 LLM 生成函数（llmFn）'] }
  }
  if (!requirement?.trim()) {
    return { ok: false, errors: ['缺少用户需求 requirement'] }
  }

  const tokens = TOKEN_SETS[tokenSet] ?? MONOCHROME_HUD
  let prompt = buildPrompt(language ?? {}, requirement, tokens)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let raw
    try {
      raw = await llmFn(prompt)
    } catch (err) {
      return { ok: false, errors: [`LLM 生成失败：${err?.message || err}`] }
    }

    const parsed = parseSpecJson(raw)
    if (!parsed) {
      if (attempt < maxRetries) continue
      return { ok: false, errors: ['LLM 返回不是合法 JSON'], attempts: attempt + 1 }
    }

    // 强制套用目标 tokenSet
    parsed.tokenSet = tokens.id
    const { ok, errors, spec } = validateSpec(parsed)
    if (ok) return { ok: true, spec, attempts: attempt + 1 }

    if (attempt < maxRetries) {
      // 规则检查不过关：把错误回喂，让 LLM 修正后重生成
      prompt = buildPrompt(language, requirement, tokens)
        + `\n\n【上次生成被规则检查打回，错误如下，请修正后重新只输出 JSON】\n${errors.join('\n')}`
      continue
    }
    return { ok: false, errors, attempts: attempt + 1 }
  }

  return { ok: false, errors: ['生成失败'] }
}

/**
 * 解析 LLM 返回的 Spec JSON。
 * 单独导出便于单测。
 */
export function parseSpecJson(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { return null }
    }
    return null
  }
}
