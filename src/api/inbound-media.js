import fs from 'fs'
import { markdownImage, persistChatMediaDataUrl } from '../chat-media.js'

const MAX_INBOUND_CHAT_MEDIA = 8

// ── MIME type helpers ──────────────────────────────────────────────────────
const IMAGE_MIME_RE = /^image\//
const DOC_MIME_SET = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
])

function isImageMime(mime) { return IMAGE_MIME_RE.test(String(mime || '').split(';')[0].trim()) }
function isDocMime(mime) { return DOC_MIME_SET.has(String(mime || '').split(';')[0].trim().toLowerCase()) }

function mimeFromDataUrl(dataUrl = '') {
  const m = String(dataUrl).match(/^data:([^;,]+)/i)
  return m ? m[1].toLowerCase() : ''
}

// ── Document text extraction ────────────────────────────────────────────────
async function extractDocText(filePath, mime) {
  const clean = String(mime || '').split(';')[0].trim().toLowerCase()
  try {
    if (clean === 'application/pdf') {
      const pdfParse = (await import('pdf-parse')).default
      const buf = fs.readFileSync(filePath)
      const data = await pdfParse(buf)
      return { text: data.text, pages: data.numpages }
    }
    if (clean === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = (await import('mammoth')).default
      const result = await mammoth.extractRawText({ path: filePath })
      return { text: result.value }
    }
    if (clean === 'application/vnd.ms-excel' || clean === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const XLSX = (await import('xlsx')).default
      const wb = XLSX.readFile(filePath)
      const texts = []
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name]
        const csv = XLSX.utils.sheet_to_csv(sheet)
        if (csv.trim()) texts.push(`--- Sheet: ${name} ---\n${csv}`)
      }
      return { text: texts.join('\n\n') }
    }
    if (clean === 'text/plain' || clean === 'text/csv') {
      const text = fs.readFileSync(filePath, 'utf-8')
      return { text }
    }
  } catch (err) {
    console.warn(`[inbound-media] doc extraction failed for ${mime}:`, err?.message || err)
  }
  return null
}

// ── Collect attachments from request body ──────────────────────────────────
function collectInboundChatMedia(body = {}) {
  const out = []
  const push = (item, fallbackAlt = 'attachment') => {
    if (!item) return
    if (typeof item === 'string') {
      out.push({ dataUrl: item, alt: fallbackAlt })
      return
    }
    if (typeof item !== 'object') return
    const dataUrl = item.dataUrl || item.data_url || item.url || item.src || item.image || ''
    if (!dataUrl) return
    out.push({
      dataUrl: String(dataUrl),
      alt: item.alt || item.name || item.filename || fallbackAlt,
      name: item.name || item.filename || item.alt || '',
    })
  }

  if (Array.isArray(body.attachments)) {
    for (const item of body.attachments) push(item, 'attachment')
  }
  if (Array.isArray(body.images)) {
    for (const item of body.images) push(item, 'image')
  }
  push(body.image_data_url || body.imageDataUrl || body.image, 'image')
  push(body.screenshot_data_url || body.screenshotDataUrl || body.screenshot, 'system screenshot')

  // Accept all MIME types — no longer filter to images only
  return out.slice(0, MAX_INBOUND_CHAT_MEDIA)
}

// ── Main export: process all inbound media ─────────────────────────────────
export async function appendInboundChatMediaMarkdown(content = '', body = {}) {
  const media = []
  const images = []    // for multimodal: { dataUrl, mime }
  const docTexts = []

  for (const item of collectInboundChatMedia(body)) {
    try {
      const stored = persistChatMediaDataUrl(item.dataUrl)
      const mime = stored.mime || mimeFromDataUrl(item.dataUrl)
      const base = { ...stored, alt: item.alt || 'attachment', name: item.name || item.alt || stored.filename }

      if (isImageMime(mime)) {
        // Image: markdown link for text models + data URL for multimodal
        media.push({ ...base, markdown: markdownImage(stored.url, item.alt || 'image') })
        images.push({ dataUrl: item.dataUrl, mime })
      } else if (isDocMime(mime)) {
        // Document: show filename + extracted text
        const extLabel = (stored.filename || '').split('.').pop()?.toUpperCase() || 'FILE'
        const extracted = await extractDocText(stored.path, mime)
        media.push({
          ...base,
          markdown: `📄 **${item.alt || stored.filename}** (${extLabel}${extracted?.pages ? `, ${extracted.pages}页` : ''})`,
          extractedText: extracted?.text || '',
        })
        if (extracted?.text) {
          const label = item.alt || stored.filename || 'document'
          docTexts.push(`[文件内容: ${label}]\n${extracted.text}`)
        }
      } else {
        // Other files (video, zip, etc.): just show filename
        const extLabel = (stored.filename || '').split('.').pop()?.toUpperCase() || 'FILE'
        media.push({
          ...base,
          markdown: `📎 **${item.alt || stored.filename}** (${extLabel})`,
        })
      }
    } catch (err) {
      console.warn('[message] inbound chat media ignored:', err?.message || err)
    }
  }

  if (media.length === 0) return { content, media, images: [] }

  const mediaMarkdown = media.map(item => item.markdown).join('\n')
  const docBlock = docTexts.length > 0 ? '\n\n' + docTexts.join('\n\n---\n\n') : ''
  const enhancedContent = `${mediaMarkdown}\n\n${content.trim()}${docBlock}`.trim()

  return { content: enhancedContent, media, images }
}
