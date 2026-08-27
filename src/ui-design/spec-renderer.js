/**
 * ui-design/spec-renderer.js — 确定性渲染器（Spec → HTML 预览）
 *
 * 把 Design Spec 渲染成所见即所得的 HTML（内联 CSS + token 注入）。
 * 确定性：同一 Spec 永远产出完全一致的 HTML，无 AI 自由发挥。
 * 用途：预览（浏览器/预览面板），供用户确认后再走代码生成。
 */

import { validateSpec } from './design-spec.js'
import { TOKEN_SETS, MONOCHROME_HUD } from './design-tokens.js'

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 取 tone 对应的 token 颜色（无 tone 回退 text） */
function toneColor(t, tokens) {
  const key = tokens.tones[t] ?? 'text'
  return tokens.palette[key] ?? tokens.palette.text
}

/** 生成元素内联样式 */
function elementStyle(node, tokens) {
  const s = {}
  const p = tokens.palette
  const t = tokens.typography
  const b = tokens.border
  const sp = tokens.spacing

  const typo = t[node.variant] ?? t.body
  s.fontFamily = typo.family
  s.fontSize = `${typo.size}px`
  s.fontWeight = typo.weight ?? 400
  if (typo.uppercase) s.textTransform = 'uppercase'
  if (typo.letterSpacing) s.letterSpacing = typo.letterSpacing

  switch (node.type) {
    case 'text':
      s.color = node.color || (node.tone ? toneColor(node.tone, tokens) : p.text)
      break
    case 'panel':
      s.background = p.surface
      s.border = `${b.width}px solid ${p.line}`
      s.padding = `${node.pad ?? sp.pad}px`
      // 切角：用 clip-path 实现（非圆角，符合单色精密仪器风）
      s.clipPath = 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)'
      break
    case 'metric':
      s.color = toneColor(node.tone, tokens)
      break
    case 'button':
      s.border = `${b.width}px solid ${p.lineBright}`
      s.background = node.variant === 'primary' ? p.lineBright : 'transparent'
      s.color = node.variant === 'primary' ? p.bg : p.text
      s.padding = `6px ${sp.pad}px`
      s.textTransform = 'uppercase'
      s.letterSpacing = '0.06em'
      break
    case 'status':
      s.color = toneColor(node.tone, tokens)
      break
    case 'divider':
      s.height = `${b.width}px`
      s.background = p.line
      break
  }
  return s
}

function styleToCss(style) {
  return Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
    .join(';')
}

/** 渲染单个节点为 HTML 字符串 */
function renderNode(node, tokens) {
  const style = styleToCss(elementStyle(node, tokens))

  switch (node.type) {
    case 'text':
      return `<div style="${style}">${esc(node.content ?? '')}</div>`

    case 'divider':
      return `<div style="${style}"></div>`

    case 'metric': {
      const labelTypo = tokens.typography.label
      const labelStyle = styleToCss({
        fontFamily: labelTypo.family,
        fontSize: `${labelTypo.size}px`,
        fontWeight: labelTypo.weight ?? 500,
        textTransform: 'uppercase',
        letterSpacing: labelTypo.letterSpacing,
        color: tokens.palette.textDim,
      })
      const valueStyle = styleToCss({
        fontFamily: tokens.typography.value.fontFamily,
        fontSize: `${tokens.typography.value.size}px`,
        color: toneColor(node.tone, tokens),
      })
      return `<div style="${style}">
        <div style="${labelStyle}">${esc(node.label ?? '')}</div>
        <div style="${valueStyle}">${esc(node.value ?? '')}</div>
      </div>`
    }

    case 'button':
      return `<div style="${style}">${esc(node.content ?? node.label ?? '')}</div>`

    case 'status':
      return `<div style="${style}">● ${esc(node.content ?? '')}</div>`

    case 'panel': {
      const title = node.title
        ? `<div style="${styleToCss({
            fontFamily: tokens.typography.label.family,
            fontSize: `${tokens.typography.label.size}px`,
            textTransform: 'uppercase',
            letterSpacing: tokens.typography.label.letterSpacing,
            color: tokens.palette.textDim,
            marginBottom: `${tokens.spacing.gap}px`,
          })}">${esc(node.title)}</div>`
        : ''
      const children = (node.children ?? [])
        .map((c) => renderNode(c, tokens))
        .join(`<div style="height:${node.gap ?? tokens.spacing.gap}px"></div>`)
      return `<div style="${style}">${title}${children}</div>`
    }

    case 'table': {
      const rows = (node.items ?? []).map((row) => {
        const cells = (Array.isArray(row) ? row : [row])
          .map((c) => `<div style="flex:1;color:${tokens.palette.text};font-family:${tokens.typography.value.fontFamily};font-size:${tokens.typography.value.size}px">${esc(c)}</div>`)
          .join('')
        return `<div style="display:flex;gap:${tokens.spacing.gap}px;padding:${tokens.spacing.gap / 2}px 0;border-bottom:${tokens.border.width}px solid ${tokens.palette.line}">${cells}</div>`
      }).join('')
      return `<div style="${style}">${rows || ''}</div>`
    }

    case 'list': {
      const items = (node.items ?? []).map((it) => {
        const label = it?.label ?? it
        return `<div style="padding:${tokens.spacing.gap / 2}px 0;border-bottom:${tokens.border.width}px solid ${tokens.palette.line};color:${tokens.palette.text};font-size:${tokens.typography.body.size}px">${esc(label)}</div>`
      }).join('')
      return `<div style="${style}">${items || ''}</div>`
    }

    case 'sphere': {
      const glow = tokens.palette.glow ?? tokens.palette.line
      return `<div style="height:${node.value || 320}px;border:1px solid ${glow};border-radius:50%;box-shadow:0 0 30px ${glow};opacity:0.7;display:flex;align-items:center;justify-content:center;color:${tokens.palette.textDim};font-size:10px;letter-spacing:0.2em">● ENERGY CORE</div>`
    }

    case 'brain': {
      const glow = tokens.palette.glow ?? tokens.palette.line
      return `<div style="height:${node.value || 190}px;border:1px solid ${glow};border-radius:50%;box-shadow:0 0 24px ${glow};opacity:0.7;display:flex;align-items:center;justify-content:center;color:${tokens.palette.textDim};font-size:10px;letter-spacing:0.2em">● BRAIN</div>`
    }

    case 'hud':
      return `<div style="height:120px;border:1px solid ${tokens.palette.line};border-radius:50%;box-shadow:0 0 16px ${tokens.palette.glow ?? tokens.palette.line};opacity:0.55"></div>`

    default:
      return `<div style="${style}">${esc(node.content ?? '')}</div>`
  }
}

/**
 * 把 Design Spec 渲染成完整 HTML 文档（确定性）。
 * @param {object} spec
 * @returns {{ok:boolean, html?:string, errors?:string[]}}
 */
export function renderSpecToHtml(spec) {
  const { ok, errors, spec: normalized } = validateSpec(spec)
  if (!ok) return { ok: false, errors }

  const tokens = TOKEN_SETS[normalized.tokenSet] ?? MONOCHROME_HUD
  const p = tokens.palette
  const gridGap = normalized.layout.gap ?? tokens.spacing.gap

  const sections = normalized.sections.map((s) => renderNode(s, tokens)).join(`<div style="height:${gridGap}px"></div>`)

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(normalized.name)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:${p.bg}; color:${p.text}; font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; }
</style>
</head>
<body style="padding:${tokens.spacing.pad}px;min-height:100vh">
${sections}
</body>
</html>`

  return { ok: true, html }
}
