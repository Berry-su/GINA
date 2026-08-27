/**
 * ui-design/design-language-extractor.js — 参考图 → 设计语言（P4，LLM）
 *
 * 用多模态模型从参考图提取「设计语言」：色板 / 排版 / 间距 / 组件形态 / 风格关键词。
 * 提取结果不是最终 Spec，而是「这张图长什么样」的结构化描述，后续 spec-generator 据此排布内容。
 *
 * 采用注入式设计：视觉分析函数由调用方注入（复用能力层 analyze_image 或本地视觉模型）。
 * 未注入时返回明确错误，不抛异常 —— 这样本模块保持纯逻辑可测，接线放 P5。
 */

const EXTRACT_PROMPT = `你是资深 UI 设计师。请分析这张参考图，提取它的「设计语言」，严格按以下 JSON 格式返回（不要输出 JSON 以外的任何内容）：

{
  "styleKeywords": ["3-6 个风格关键词，如 单色/精密仪器/极简/高对比"],
  "palette": { "background": "#hex", "surface": "#hex", "text": "#hex", "accent": "#hex 或 null" },
  "typography": { "labelStyle": "大写/小写/等宽/常规", "numericStyle": "等宽/常规", "density": "紧凑/宽松" },
  "spacing": { "unit": 8, "feel": "紧凑/适中/宽松" },
  "componentMorphology": "面板形态描述，如 直角切角/细线框/无阴影",
  "mood": "整体气质一句话"
}

规则：
1. 只描述你看到的客观特征，不要美化、不要脑补没见过的东西；
2. 如果图片是单色精密仪器风，labelStyle 应体现「大写 + 宽字距 + 小字号」，numericStyle 应为「等宽」；
3. 不要输出渐变色/发光/玻璃拟态这类「AI 感」描述，除非图中确实如此（即使如此也要在 styleKeywords 里标注为需规避）。`

/**
 * 从参考图提取设计语言。
 * @param {object} args
 * @param {string} args.imagePath 参考图路径（或 data url）
 * @param {(imagePath:string, prompt:string)=>Promise<string>} [args.visionFn] 注入的视觉分析函数
 * @returns {Promise<{ok:boolean, language?:object, error?:string}>}
 */
export async function extractDesignLanguage({ imagePath, visionFn }) {
  if (!imagePath) return { ok: false, error: '缺少参考图 imagePath' }
  if (typeof visionFn !== 'function') {
    return { ok: false, error: '未注入视觉分析函数（visionFn）' }
  }

  let raw
  try {
    raw = await visionFn(imagePath, EXTRACT_PROMPT)
  } catch (err) {
    return { ok: false, error: `视觉分析失败：${err?.message || err}` }
  }

  return parseLanguage(raw)
}

/**
 * 解析 LLM 返回的设计语言（提取 JSON）。
 * 单独导出便于单测。
 * @param {string} raw
 * @returns {{ok:boolean, language?:object, error?:string}}
 */
export function parseLanguage(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: '视觉模型返回空' }
  // 去掉可能的 markdown 代码块围栏
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned)
    return { ok: true, language: normalizeLanguage(parsed) }
  } catch {
    // 尝试截取第一个 { 到最后一个 }
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return { ok: true, language: normalizeLanguage(JSON.parse(cleaned.slice(start, end + 1))) }
      } catch { /* fallthrough */ }
    }
    return { ok: false, error: '视觉模型返回不是合法 JSON' }
  }
}

function normalizeLanguage(l) {
  return {
    styleKeywords: Array.isArray(l?.styleKeywords) ? l.styleKeywords.slice(0, 6) : [],
    palette: {
      background: l?.palette?.background ?? null,
      surface: l?.palette?.surface ?? null,
      text: l?.palette?.text ?? null,
      accent: l?.palette?.accent ?? null,
    },
    typography: {
      labelStyle: l?.typography?.labelStyle ?? '',
      numericStyle: l?.typography?.numericStyle ?? '',
      density: l?.typography?.density ?? '',
    },
    spacing: { unit: Number(l?.spacing?.unit) || 8, feel: l?.spacing?.feel ?? '' },
    componentMorphology: l?.componentMorphology ?? '',
    mood: l?.mood ?? '',
  }
}
