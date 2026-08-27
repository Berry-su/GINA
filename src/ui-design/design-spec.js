/**
 * ui-design/design-spec.js — Design Spec 契约（确定性）
 *
 * 定义「结构化设计描述」的 schema + 校验。Spec 只描述「结构 + 语义角色 + variant + tone」，
 * 不含具体像素颜色/字体 —— 颜色字体由 design-tokens 注入，渲染/代码生成时统一套 token。
 * 这样 Spec 生成不碰审美，审美被 token 锁死。
 */

import { checkSpec, ELEMENT_TYPES, TOKEN_SETS, MONOCHROME_HUD } from './design-tokens.js'

/**
 * 校验并规范化一个 Design Spec。
 * @param {object} spec
 * @returns {{ok:boolean, errors:string[], spec?:object}}
 */
export function validateSpec(spec) {
  const { ok, errors } = checkSpec(spec)
  if (!ok) return { ok: false, errors }

  const normalized = {
    name: String(spec.name ?? '未命名界面').slice(0, 80),
    tokenSet: TOKEN_SETS[spec.tokenSet] ? spec.tokenSet : MONOCHROME_HUD.id,
    layout: normalizeLayout(spec.layout),
    sections: (spec.sections ?? []).map(normalizeNode),
  }
  return { ok: true, errors: [], spec: normalized }
}

function normalizeLayout(layout = {}) {
  const columns = Number(layout.columns)
  return {
    type: layout.type === 'grid' ? 'grid' : 'stack',
    columns: Number.isInteger(columns) && columns >= 1 && columns <= 24 ? columns : 12,
    gap: layout.gap ?? 8,
    rows: Array.isArray(layout.rows) ? layout.rows : ['auto', '1fr', 'auto'],
  }
}

function normalizeNode(node = {}) {
  const out = {
    type: node.type,
    variant: node.variant,
    tone: node.tone,
    content: node.content,
    title: node.title,
    label: node.label,
    value: node.value,
    span: node.span,
    gap: node.gap,
    pad: node.pad,
    rows: node.rows,
    columns: node.columns,
    items: Array.isArray(node.items) ? node.items : undefined,
  }
  if (Array.isArray(node.children)) out.children = node.children.map(normalizeNode)
  // 去除 undefined 字段，保持输出干净
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

/**
 * 便捷构造器：创建一个最小合法的 Spec。
 * @returns {object}
 */
export function createEmptySpec(name = '未命名界面') {
  return {
    name,
    tokenSet: MONOCHROME_HUD.id,
    layout: { type: 'grid', columns: 12, gap: 8, rows: ['auto', '1fr', 'auto'] },
    sections: [],
  }
}

export { ELEMENT_TYPES }
