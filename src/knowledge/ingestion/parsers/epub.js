// src/knowledge/ingestion/parsers/epub.js —— EPUB 解析器
//
// 依赖：epub (CJS)
// 策略：lazy import，EPUB 自带章节结构，无需自己检测
// 输出：{ text, chapters: [{title, content, startLine, endLine}], metadata }

import { promises as fs } from 'node:fs'

export const PARSER_NAME = 'epub'

/**
 * 解析 EPUB 文件
 * @param {string} path 文件路径
 * @returns {Promise<{text: string, chapters: Array, metadata: object}>}
 */
export async function parseEpub(path) {
  // lazy import
  let EPub
  try {
    const mod = await import('epub')
    EPub = mod.default || mod
  } catch (err) {
    throw new Error(`epub not available: ${err?.message || err}. Run: pnpm add epub`)
  }

  return new Promise((resolve, reject) => {
    const epub = new EPub(path)

    epub.on('error', (err) => reject(new Error(`epub parse failed: ${err?.message || err}`)))

    epub.on('end', async () => {
      try {
        const chapterPromises = []
        for (const ch of epub.flow || []) {
          chapterPromises.push(_readChapter(epub, ch.id))
        }
        const chapterTexts = await Promise.all(chapterPromises)
        const chapters = []
        const allLines = []
        let lineOffset = 0
        for (let i = 0; i < chapterTexts.length; i++) {
          const ch = chapterTexts[i]
          const title = epub.flow[i]?.title?.['#text'] || epub.flow[i]?.title || `Chapter ${i + 1}`
          const lines = ch.text.split('\n')
          chapters.push({
            title: String(title).slice(0, 200),
            startLine: lineOffset,
            endLine: lineOffset + lines.length - 1,
          })
          allLines.push(...lines)
          lineOffset += lines.length
        }
        const text = allLines.join('\n').replace(/\r\n/g, '\n')
        const metadata = {
          title: epub.metadata?.title || '',
          creator: epub.metadata?.creator || '',
          language: epub.metadata?.language || '',
          chapterCount: chapters.length,
        }
        resolve({ text, chapters, metadata })
      } catch (err) {
        reject(err)
      }
    })

    epub.parse()
  })
}

function _readChapter(epub, id) {
  return new Promise((resolve, reject) => {
    epub.getChapter(id, (err, text) => {
      if (err) reject(err)
      else resolve({ text: _stripHtml(String(text || '')) })
    })
  })
}

function _stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
