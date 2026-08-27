/**
 * 清理新闻注入的知识，重新注入测试
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

const GINA_HOME = process.env.GINA_HOME || path.join(os.homedir(), '.gina')
const KB_FILE = path.join(GINA_HOME, 'knowledge', 'knowledge-base.jsonl')

// 读取现有知识
let all = []
if (fs.existsSync(KB_FILE)) {
  const content = fs.readFileSync(KB_FILE, 'utf8').trim()
  if (content) {
    all = content.split('\n').map(line => JSON.parse(line)).filter(Boolean)
  }
}

console.log(`清理前: ${all.length} 条`)

// 保留非新闻知识，删除新闻注入的
const preserved = all.filter(k => !k.metadata?.newsItem)
const removed = all.length - preserved.length

fs.writeFileSync(KB_FILE, preserved.map(k => JSON.stringify(k)).join('\n'), 'utf8')
console.log(`删除新闻知识: ${removed} 条`)
console.log(`保留: ${preserved.length} 条`)
console.log('完成')