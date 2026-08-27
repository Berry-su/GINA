/**
 * ui-design/spec-codegen.js — 代码生成（Spec → React + CSS Modules）
 *
 * 把 Design Spec 确定性生成 React 18 + CSS Modules 代码，匹配 apps/web 技术栈
 * （React + Vite + TS + CSS Modules）。确定性：同一 Spec 产出完全一致的代码。
 *
 * 产出结构：
 *   - 组件 .tsx（用语义化 JSX）
 *   - 组件 .module.css（token 注入的变量 + 类）
 *   - 一个汇总 index.ts（可选）
 */

import { validateSpec } from './design-spec.js'
import { TOKEN_SETS, MONOCHROME_HUD } from './design-tokens.js'

function cssVarName(s) {
  return String(s ?? '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'x'
}

function toPascal(s) {
  return String(s ?? 'Screen')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Screen'
}

function escJs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
}

/** 生成 token 的 CSS 变量块 */
function tokenCssVars(tokens) {
  const p = tokens.palette
  return Object.entries(p).map(([k, v]) => `  --c-${k}: ${v};`).join('\n')
}

/** 元素 → className（复用同一套 CSS 类） */
function nodeClass(node) {
  return `node-${node.type}${node.variant ? `-${node.variant}` : ''}`
}

/** 生成某个节点的 JSX（含 key） */
function renderJsx(node, depth = 0) {
  const indent = '  '.repeat(depth)
  const cls = nodeClass(node)

  switch (node.type) {
    case 'text':
      return `${indent}<span className={styles.${cls}}>{'${escJs(node.content)}'}</span>`

    case 'divider':
      return `${indent}<div className={styles.${cls}} />`

    case 'metric':
      return `${indent}<div className={styles.${cls}} data-tone="${node.tone ?? 'neutral'}">\n${indent}  <span className={styles.metricLabel}>{'${escJs(node.label)}'}</span>\n${indent}  <span className={styles.metricValue}>{'${escJs(node.value)}'}</span>\n${indent}</div>`

    case 'button':
      return `${indent}<button className={styles.${cls}}>{'${escJs(node.content ?? node.label)}'}</button>`

    case 'status':
      return `${indent}<span className={styles.${cls}} data-tone="${node.tone ?? 'neutral'}">● {'${escJs(node.content)}'}</span>`

    case 'panel': {
      const title = node.title ? `${indent}  <div className={styles.panelTitle}>{'${escJs(node.title)}'}</div>\n` : ''
      const children = (node.children ?? []).map((c) => renderJsx(c, depth + 1)).join('\n')
      return `${indent}<section className={styles.${cls}}>\n${title}${children}\n${indent}</section>`
    }

    case 'table': {
      const rows = (node.items ?? []).map((row, i) => {
        const cells = (Array.isArray(row) ? row : [row])
          .map((c) => `${indent}    <span className={styles.tableCell} key={${i}}>{'${escJs(c)}'}</span>`)
          .join('\n')
        return `${indent}  <div className={styles.tableRow} key={${i}}>\n${cells}\n${indent}  </div>`
      }).join('\n')
      return `${indent}<div className={styles.${cls}}>\n${rows}\n${indent}</div>`
    }

    case 'list': {
      const items = (node.items ?? []).map((it, i) => {
        const label = it && typeof it === 'object'
          ? (it.label ?? it.name ?? it.title ?? it.value ?? it.text ?? JSON.stringify(it))
          : it
        return `${indent}  <div className={styles.listItem} key={${i}}>{'${escJs(label)}'}</div>`
      }).join('\n')
      return `${indent}<div className={styles.${cls}}>\n${items}\n${indent}</div>`
    }

    case 'sphere':
      return `${indent}<SphereCore height={${Number(node.value) || 460}} />`

    case 'brain':
      return `${indent}<BrainHolo size={${Number(node.value) || 190}} />`

    case 'hud':
      return `${indent}<div className={styles.node-hud-default} />`

    default:
      return `${indent}<div className={styles.${cls}}>{'${escJs(node.content)}'}</div>`
  }
}

/** 生成 .module.css 内容 */
function generateCss(tokens) {
  const p = tokens.palette
  const t = tokens.typography
  const b = tokens.border
  const sp = tokens.spacing

  const labelCss = `font-size:${t.label.size}px;text-transform:uppercase;letter-spacing:${t.label.letterSpacing};color:var(--c-textDim);`
  const valueCss = `font-family:${t.value.fontFamily};font-size:${t.value.size}px;`

  return `/* 自动生成：由 Design Spec 确定性产出（token 集：${tokens.label}） */
:root {
${tokenCssVars(tokens)}
}

.root {
  background: var(--c-bg);
  color: var(--c-text);
  min-height: 100vh;
  padding: ${sp.pad}px;
  display: flex;
  flex-direction: column;
  gap: ${sp.gap}px;
  font-family: ${t.body.family};
}

/* ── 文本 ── */
.node-text-label { ${labelCss} }
.node-text-value { ${valueCss} color:var(--c-text); }
.node-text-title { ${labelCss} font-size:${t.title.size}px;color:var(--c-text); }
.node-text-body { font-size:${t.body.size}px;color:var(--c-text); }

/* ── 面板（切角，无圆角） ── */
.node-panel-default,
.node-panel-metric,
.node-panel-table {
  background: var(--c-surface);
  border: ${b.width}px solid var(--c-line);
  padding: ${sp.pad}px;
  clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%);
}
.panelTitle { ${labelCss} margin-bottom:${sp.gap}px; }

/* ── metric ── */
.node-metric-neutral, .node-metric-up, .node-metric-down, .node-metric-risk {
  display:flex;flex-direction:column;gap:4px;
}
.metricLabel { ${labelCss} }
.metricValue { ${valueCss} }
.node-metric-neutral .metricValue { color:var(--c-neutral); }
.node-metric-up .metricValue { color:var(--c-up); }
.node-metric-down .metricValue { color:var(--c-down); }
.node-metric-risk .metricValue { color:var(--c-risk); }

/* ── status ── */
.node-status-default { font-size:${t.label.size}px;text-transform:uppercase;letter-spacing:${t.label.letterSpacing}; }
.node-status-default[data-tone="up"] { color:var(--c-up); }
.node-status-default[data-tone="down"] { color:var(--c-down); }
.node-status-default[data-tone="risk"] { color:var(--c-risk); }
.node-status-default[data-tone="neutral"] { color:var(--c-neutral); }

/* ── button ── */
.node-button-primary, .node-button-ghost {
  border:${b.width}px solid var(--c-lineBright);
  padding:6px ${sp.pad}px;text-transform:uppercase;letter-spacing:0.06em;cursor:pointer;
  background:transparent;color:var(--c-text);
}
.node-button-primary { background:var(--c-lineBright);color:var(--c-bg); }

/* ── divider ── */
.node-divider-default { height:${b.width}px;background:var(--c-line); }

/* ── table ── */
.tableRow { display:flex;gap:${sp.gap}px;padding:${sp.gap / 2}px 0;border-bottom:${b.width}px solid var(--c-line); }
.tableCell { flex:1;${valueCss} color:var(--c-text); }

/* ── list ── */
.listItem { padding:${sp.gap / 2}px 0;border-bottom:${b.width}px solid var(--c-line);font-size:${t.body.size}px;color:var(--c-text); }

/* ── hud ── */
.node-hud-default {
  height:120px;
  border:${b.width}px solid var(--c-line);
  border-radius:50%;
  box-shadow:0 0 16px var(--c-glow, var(--c-lineBright));
  opacity:0.55;
}
`
}

/** 判断 spec 树里是否出现某类型（用于按需 import 3D 组件） */
function usesType(spec, type) {
  const walk = (nodes) => nodes.some((n) => n.type === type || (Array.isArray(n.children) && walk(n.children)))
  return walk(spec.sections ?? [])
}

/** 生成 .tsx 内容 */
function generateTsx(spec, componentName) {
  const sections = (spec.sections ?? []).map((s) => renderJsx(s, 2)).join('\n')
  const hasSphere = usesType(spec, 'sphere')
  const hasBrain = usesType(spec, 'brain')
  const imports = [
    `import styles from './${componentName}.module.css'`,
    hasSphere ? `import { SphereCore } from '../components/SphereCore'` : '',
    hasBrain ? `import { BrainHolo } from '../components/BrainHolo'` : '',
  ].filter(Boolean).join('\n')

  return `${imports}

/**
 * ${spec.name}（由 Design Spec 确定性生成）
 * 风格：${TOKEN_SETS[spec.tokenSet]?.label ?? spec.tokenSet}
 */
export default function ${componentName}() {
  return (
    <div className={styles.root}>
${sections}
    </div>
  )
}
`
}

/**
 * 把 Design Spec 生成 React + CSS Modules 代码（确定性）。
 * @param {object} spec
 * @param {{componentName?: string}} [options]
 * @returns {{ok:boolean, files?:object, errors?:string[]}}
 */
export function generateCode(spec, { componentName } = {}) {
  const { ok, errors, spec: normalized } = validateSpec(spec)
  if (!ok) return { ok: false, errors }

  const tokens = TOKEN_SETS[normalized.tokenSet] ?? MONOCHROME_HUD
  const name = componentName || toPascal(normalized.name)

  return {
    ok: true,
    files: {
      [`${name}.tsx`]: generateTsx(normalized, name),
      [`${name}.module.css`]: generateCss(tokens),
    },
    componentName: name,
  }
}
