// src/knowledge/ingestion/parsers/pdf.js —— PDF 解析器
//
// 依赖：pdf-parse (CJS)
// 策略：lazy import，避免主循环启动时拉 PDF native deps
// 输出：{ text, chapters: [{title, startLine, endLine}], pages, metadata }

import { promises as fs } from 'node:fs'

export const PARSER_NAME = 'pdf'

/**
 * 解析 PDF 文件
 * @param {string} path 文件路径
 * @param {object} [opts]
 * @param {number} [opts.maxPages] 限制页数（避免超大文件）
 * @returns {Promise<{text: string, pages: number, chapters: Array, metadata: object}>}
 */
export async function parsePdf(path, { maxPages = 2000 } = {}) {
  // lazy import: pdf-parse 自身有 debug 模式会在缺参数时跑测试 PDF
  // 用 named import 避免 main 副作用
  let pdfParse
  try {
    const mod = await import('pdf-parse/lib/pdf-parse.js')
    pdfParse = mod.default || mod
  } catch (err) {
    throw new Error(`pdf-parse not available: ${err?.message || err}. Run: pnpm add pdf-parse`)
  }

  const buf = await fs.readFile(path)
  const data = await pdfParse(buf, { max: maxPages })

  const text = String(data.text || '').replace(/\r\n/g, '\n').replace(/\f/g, '\n\n')
  const pages = data.numpages || 0
  const metadata = {
    info: data.info || {},
    pages,
  }

  // 简单章节检测：找 "Chapter X" / "第 X 章" / "## 标题" 模式
  const chapters = _detectChapters(text)

  return { text, pages, chapters, metadata }
}

function _detectChapters(text) {
  const chapters = []
  const lines = text.split('\n')
  const chapterRe = /^(#{1,3}\s+.+|第[一二三四五六七八九十百\d]+\s*[章节回]\s*[：:]?\s*[\u4e00-\u9fa5\w\s]*|Chapter\s+\d+|CHAPTER\s+[IVX]+)/i
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length < 200 && chapterRe.test(line)) {
      chapters.push({
        title: line.replace(/^#+\s*/, '').slice(0, 100),
        startLine: i,
        endLine: lines.length, // 临时占位
      })
    }
  }
  // 计算 endLine
  for (let i = 0; i < chapters.length; i++) {
    if (i + 1 < chapters.length) chapters[i].endLine = chapters[i + 1].startLine - 1
  }
  return chapters
}
