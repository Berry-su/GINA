// src/learning/direction.js —— 方向控制器（direction controller）
//
// 设计哲学（2026-09-01 老板拍板 · C-4.2 · 选项 c）：
//   - 对话触发:「接下来你主攻 X」自动落 direction.js
//   - 正则优先 (5+ 表达覆盖), LLM 兜底
//   - 置信度门槛: > 0.85 落库 / 0.5-0.85 弹确认 / < 0.5 不动
//   - 持久化: data/direction.json (atomic write)
//   - 关联 ADR-003 §3.2

import fs from 'fs'
import path from 'path'
import { paths } from '../paths.js'

const DIRECTION_FILENAME = 'direction.json'

// 正则模式：5+ 表达覆盖日常用法
//   所有 pattern 捕获组 [1] = topic
//   关键词前用 `\s*` 允许 0+ 空白；后用 `(?:于|一下|一些)?\s*` 吸收介词
//   topic group 用 `[^\n。.!?？]{2,60}?` 懒拿 2-60 非标点字符（regex 上限与 set 一致）
//   末尾 `(?:[。.!?？\n]|$)` 用非捕获匹配强制 topic 后跟边界
const DIRECTION_PATTERNS = [
  // 1. 接下来 + 主攻/学/重点/专注/着力/发力 + (于|一下|一些)? + topic
  /接下来\s*(?:主攻|学|重点|专注|着力|发力)\s*(?:于|一下|一些)?\s*([^\n。.!?？]{2,60}?)(?:[。.!?？\n]|$)/i,
  // 2. 接下来你 + 主攻/学/重点/专注/着力 + (于|一下|一些)? + topic
  /接下来你\s*(?:主攻|学|重点|专注|着力|发力)\s*(?:于|一下|一些)?\s*([^\n。.!?？]{2,60}?)(?:[。.!?？\n]|$)/i,
  // 3. 你的方向/你的当前方向 + 是/改为/改成/换成 + topic
  /(?:你的|你的当前)?\s*方向\s*(?:是|改为|改成|换成)\s*([^\n。.!?？]{2,60}?)(?:[。.!?？\n]|$)/i,
  // 4. 最近 + 主攻/学/研究/发力/专攻 + (一下|一些)? + topic
  /最近\s*(?:主攻|学|研究|发力|专攻)\s*(?:一下|一些)?\s*([^\n。.!?？]{2,60}?)(?:[。.!?？\n]|$)/i,
  // 5. 从现在开始 + 主攻/学/重点/专注/发力/着力 + (于|一下|一些)? + topic
  /从现在开始\s*(?:主攻|学|重点|专注|发力|着力)\s*(?:于|一下|一些)?\s*([^\n。.!?？]{2,60}?)(?:[。.!?？\n]|$)/i,
]

const LLM_FALLBACK_PROMPT =
  '判断下面用户消息是否包含"设定学习方向"的意图。' +
  '如果是，提取方向主题（不超过 30 字）。' +
  '返回严格 JSON: { isDirection: boolean, topic: string|null, confidence: number(0-1) }。\n\n' +
  '消息: '

const MAX_TOPIC_LENGTH = 60
const MIN_TOPIC_LENGTH = 2

// 动作/介词开头：这些字符出现在 topic 开头通常意味着 regex 错位捕获，
// 应当从 topic 头部剥除
const TOPIC_BAD_STARTS = /^(?:主攻|学|重点|专注|着力|发力|于|一下|一些|了|着|的|在|是|让|去|来|做|研|发|专|改|换成|你)/i

function _default() { return null }

function _cleanTopic(raw) {
  if (!raw) return ''
  // 去尾部标点 + trim + 限长
  let s = String(raw).trim().replace(/[。.!?？\s,，;；:：]+$/, '').slice(0, MAX_TOPIC_LENGTH)
  // 剥离开头的动作/介词残留（最多剥 3 次防死循环）
  for (let i = 0; i < 3 && TOPIC_BAD_STARTS.test(s); i++) {
    s = s.replace(TOPIC_BAD_STARTS, '').trim()
  }
  return s
}

export class DirectionController {
  /**
   * @param {object} [opts]
   * @param {string} [opts.dataDir] data 目录（默认 paths.dataDir）
   * @param {object} [opts.llm] 可选 LLM 客户端 { chat({ system, user, temperature, responseFormat }) }
   */
  constructor({ dataDir = null, llm = null } = {}) {
    this.dataDir = dataDir || paths.dataDir
    this.file = path.join(this.dataDir, DIRECTION_FILENAME)
    this.llm = llm
    this._state = this._load()
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return _default()
      const raw = fs.readFileSync(this.file, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || !parsed.topic || typeof parsed.topic !== 'string') return _default()
      // 过期检查
      if (parsed.expiresAt && Number(parsed.expiresAt) < Date.now()) {
        // 静默清理
        try { this._writeRaw(null) } catch {}
        return _default()
      }
      return {
        topic: String(parsed.topic),
        since: Number(parsed.since) || Date.now(),
        setBy: parsed.setBy === 'agent' ? 'agent' : 'user',
        expiresAt: parsed.expiresAt ? Number(parsed.expiresAt) : null,
      }
    } catch {
      return _default()
    }
  }

  _writeRaw(state) {
    const dir = path.dirname(this.file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const payload = state ? JSON.stringify(state, null, 2) : '{}'
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, payload, 'utf-8')
    fs.renameSync(tmp, this.file)
  }

  _save() {
    try {
      this._writeRaw(this._state)
    } catch {
      // 静默失败
    }
  }

  /**
   * 正则检测（5+ 表达覆盖）
   * @param {string} message
   * @returns {object|null} { isDirection, topic, confidence, source, patternIndex }
   */
  detectRegex(message) {
    const text = String(message || '').trim()
    if (!text) return null
    for (let i = 0; i < DIRECTION_PATTERNS.length; i++) {
      const m = text.match(DIRECTION_PATTERNS[i])
      if (!m) continue
      // 所有 pattern 的捕获组 [1] = topic
      const topic = _cleanTopic(m[1])
      if (topic && topic.length >= MIN_TOPIC_LENGTH) {
        return {
          isDirection: true,
          topic,
          confidence: 0.95,
          source: 'regex',
          patternIndex: i,
        }
      }
    }
    return null
  }

  /**
   * LLM 兜底（异步，不阻塞主流程）
   * @param {string} message
   * @returns {Promise<object|null>}
   */
  async detectLLM(message) {
    if (!this.llm || typeof this.llm.chat !== 'function') return null
    try {
      const result = await this.llm.chat({
        system: LLM_FALLBACK_PROMPT,
        user: String(message || '').slice(0, 500),
        temperature: 0,
        responseFormat: 'json',
      })
      const text = typeof result === 'string' ? result : (result?.content || result?.text || '')
      const parsed = typeof result === 'object' && result !== null && !Array.isArray(result) && 'isDirection' in result
        ? result
        : (() => { try { return JSON.parse(text) } catch { return null } })()
      if (!parsed || !parsed.isDirection || !parsed.topic) return null
      const conf = Number(parsed.confidence || 0)
      return {
        isDirection: true,
        topic: _cleanTopic(parsed.topic),
        confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
        source: 'llm',
      }
    } catch {
      return null
    }
  }

  /**
   * 主入口：regex 优先 → LLM 兜底
   * @param {string} message
   * @returns {Promise<object|null>}
   */
  async detect(message) {
    const regexResult = this.detectRegex(message)
    if (regexResult) return regexResult
    return await this.detectLLM(message)
  }

  /**
   * 读当前方向
   * @returns {object|null} { topic, since, setBy, expiresAt } | null
   */
  get() {
    // 重新读盘（避免其他进程更新）
    this._state = this._load()
    return this._state ? { ...this._state } : null
  }

  /**
   * 设定方向
   * @param {object} opts
   * @param {string} opts.topic
   * @param {'user'|'agent'} [opts.setBy='user']
   * @param {number|null} [opts.expiresAt=null]
   * @returns {object|null}
   */
  set({ topic, setBy = 'user', expiresAt = null } = {}) {
    const cleaned = _cleanTopic(topic)
    if (!cleaned || cleaned.length < 2) return null
    this._state = {
      topic: cleaned,
      since: Date.now(),
      setBy: setBy === 'agent' ? 'agent' : 'user',
      expiresAt: expiresAt ? Number(expiresAt) : null,
    }
    this._save()
    return this.get()
  }

  /**
   * 清除方向
   * @returns {boolean}
   */
  clear() {
    this._state = null
    this._save()
    return true
  }

  /**
   * 注入 context 字符串
   * @returns {string} 空字符串表示无方向
   */
  injectFor() {
    if (!this._state) return ''
    const since = new Date(this._state.since).toISOString()
    const setByLabel = this._state.setBy === 'user' ? '用户' : 'agent 自学'
    const lines = [
      '## 当前学习方向 (direction · v1)',
      '',
      `- 方向: ${this._state.topic}`,
      `- 设定于: ${since} (${setByLabel})`,
      this._state.expiresAt
        ? `- 过期: ${new Date(this._state.expiresAt).toISOString()}`
        : '- 过期: 永久',
      '',
      '（影响: 知识注入优先级 / 反思深度 / 工具评分 — direction 领域工具成功率单独统计）',
    ]
    return lines.join('\n')
  }

  /**
   * 重置（仅测试用）
   */
  _reset() {
    this._state = null
    this._save()
  }
}

// 单例 helper
let _instance = null
export function getDirectionController(opts = {}) {
  if (!_instance) _instance = new DirectionController(opts)
  return _instance
}

export function resetDirectionControllerForTest() {
  _instance = null
}
