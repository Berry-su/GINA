// src/knowledge/ingestion/parsers/md.js —— Markdown 解析器（自带）
//
// 策略：按 # / ## / ### 标题切章节
// 输出：{ text, chapters: [{title, startLine, endLine}], metadata }

import { promises as fs } from 'node:fs'

export const PARSER_NAME = 'md'

/**
 * 解析 Markdown 文件
 * @param {string} path 文件路径
 * @returns {Promise<{text: string, chapters: Array, metadata: object}>}
 */
export async function parseMd(path) {
  const raw = await fs.readFile(path, 'utf-8')
  const text = raw.replace(/\r\n/g, '\n')
  const chapters = _detectChapters(text)
  return {
    text,
    chapters,
    metadata: {
      lineCount: text.split('\n').length,
      charCount: text.length,
    },
  }
}

/**
 * 解析 Markdown 文本（不读文件）
 * @param {string} text
 * @returns {Promise<{text: string, chapters: Array, metadata: object}>}
 */
export async function parseMdText(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n')
  return {
    text: normalized,
    chapters: _detectChapters(normalized),
    metadata: {
      lineCount: normalized.split('\n').length,
      charCount: normalized.length,
    },
  }
}

function _detectChapters(text) {
  const lines = text.split('\n')
  const chapters = []
  const headingRe = /^(#{1,3})\s+(.+)$/
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe)
    if (m) {
      chapters.push({
        title: m[2].trim().slice(0, 200),
        level: m[1].length,
        startLine: i,
        endLine: lines.length,
      })
    }
  }
  for (let i = 0; i < chapters.length; i++) {
    if (i + 1 < chapters.length) chapters[i].endLine = chapters[i + 1].startLine - 1
  }
  return chapters
}
