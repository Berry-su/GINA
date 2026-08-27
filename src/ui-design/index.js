/**
 * ui-design/index.js — UI 设计生成能力统一入口
 *
 * 把五个模块串成完整管线：
 *   参考图 → 提取设计语言 → 生成 Spec → 规则检查 → 渲染预览 → 确认 → 生成代码
 *
 * 用法：
 *   const engine = createUiDesignEngine({ visionFn, llmFn })
 *   const preview = await engine.designFromReference({ imagePath, requirement })
 *   // preview.html 是预览，preview.spec 是结构化描述
 *   // 用户确认后：const code = engine.generateCode(preview.spec)
 */

import { extractDesignLanguage } from './design-language-extractor.js'
import { generateSpec } from './spec-generator.js'
import { validateSpec } from './design-spec.js'
import { renderSpecToHtml } from './spec-renderer.js'
import { generateCode } from './spec-codegen.js'
import { TOKEN_SETS, MONOCHROME_HUD } from './design-tokens.js'

export { TOKEN_SETS, MONOCHROME_HUD }
export { checkSpec, FORBIDDEN_PATTERNS, ELEMENT_TYPES } from './design-tokens.js'
export { validateSpec, createEmptySpec } from './design-spec.js'
export { renderSpecToHtml } from './spec-renderer.js'
export { generateCode } from './spec-codegen.js'
export { extractDesignLanguage, parseLanguage } from './design-language-extractor.js'
export { generateSpec, parseSpecJson } from './spec-generator.js'

/**
 * 创建 UI 设计引擎。
 * @param {object} deps
 * @param {(imagePath:string, prompt:string)=>Promise<string>} [deps.visionFn] 多模态视觉分析（参考图提取）
 * @param {(prompt:string)=>Promise<string>} [deps.llmFn] LLM 生成（Spec 排布）
 * @returns {object} engine
 */
export function createUiDesignEngine({ visionFn, llmFn } = {}) {
  return {
    /** 从参考图 + 需求生成设计（含预览 HTML 与 Spec）。 */
    async designFromReference({ imagePath, requirement, tokenSet = MONOCHROME_HUD.id }) {
      const extracted = await extractDesignLanguage({ imagePath, visionFn })
      if (!extracted.ok) return extracted

      const generated = await generateSpec({ language: extracted.language, requirement, tokenSet, llmFn })
      if (!generated.ok) return generated

      const rendered = renderSpecToHtml(generated.spec)
      if (!rendered.ok) return { ok: false, errors: rendered.errors }

      return {
        ok: true,
        language: extracted.language,
        spec: generated.spec,
        html: rendered.html,
      }
    },

    /** 从已有 Spec 生成预览。 */
    preview(spec) {
      return renderSpecToHtml(spec)
    },

    /** 从 Spec 生成 React + CSS Modules 代码。 */
    codegen(spec, options) {
      return generateCode(spec, options)
    },

    /** 只校验 Spec 合规性。 */
    validate(spec) {
      return validateSpec(spec)
    },

    /** 可用 token 集列表。 */
    listTokenSets() {
      return Object.values(TOKEN_SETS).map((t) => ({ id: t.id, label: t.label }))
    },
  }
}
