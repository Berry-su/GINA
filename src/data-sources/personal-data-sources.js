/**
 * personal-data-sources.js — 个人数据源适配器（日历 / 邮件 / 通讯录）
 *
 * 贾维斯式助手与普通 Agent 的关键差别之一：能读用户的个人上下文（日程、邮件、联系人）。
 * 此前 data-sources/ 只有新闻，个人维度是空白。本模块补齐三类只读数据源：
 *
 *   - 日历  : 今天/未来 N 天的日程事件（标题、开始/结束、地点）
 *   - 邮件  : 最近 N 封邮件的主题/发件人/日期（只读，不读正文，避免隐私外泄）
 *   - 通讯录: 按姓名搜索联系人（姓名、公司、电话、邮箱）
 *
 * 实现：macOS 通过 osascript（AppleScript）访问系统 Calendar / Mail / Contacts 应用；
 *       非 macOS 或未授权时返回明确的 `unavailable` 状态，绝不抛错中断调用方。
 * 隐私：全部只读；邮件默认只取主题/发件人/日期，正文需显式 includeBody=true 才取（且截断）。
 */

import { execSync } from 'child_process'

const IS_MAC = process.platform === 'darwin'

function runAppleScript(script) {
  if (!IS_MAC) return null
  try {
    return execSync(`osascript -e ${JSON.stringify(script)}`, {
      timeout: 8000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

/** 把 AppleScript 返回的制表符分隔行解析成对象数组。 */
function parseTSV(raw, fields) {
  if (!raw) return []
  return raw
    .split('\n')
    .map((line) => line.split('\t').map((s) => s.trim()))
    .filter((cells) => cells.length >= fields.length && cells.some(Boolean))
    .map((cells) => {
      const obj = {}
      fields.forEach((f, i) => { obj[f] = cells[i] ?? '' })
      return obj
    })
}

/**
 * 获取日历事件。
 * @param {{days?: number, maxEvents?: number}} [options]
 * @returns {Promise<{available:boolean, events:Array, error?:string}>}
 */
export async function fetchCalendarEvents({ days = 7, maxEvents = 50 } = {}) {
  if (!IS_MAC) {
    return { available: false, events: [], error: 'only macOS is supported' }
  }
  const endDate = new Date(Date.now() + days * 24 * 3600 * 1000)
  const script = `
    tell application "Calendar"
      set out to ""
      set now to current date
      set stop to now + (${days} * days)
      set seen to 0
      repeat with cal in calendars
        try
          set evs to (every event of cal whose start date ≥ now and start date ≤ stop)
          repeat with e in evs
            if seen ≥ ${maxEvents} then exit repeat
            set out to out & (summary of e) & tab & (start date of e as string) & tab & (end date of e as string) & tab & (location of e) & linefeed
            set seen to seen + 1
          end repeat
        end try
      end repeat
      return out
    end tell
  `
  const raw = runAppleScript(script)
  if (raw === null) {
    return { available: false, events: [], error: 'Calendar access denied or unavailable' }
  }
  const events = parseTSV(raw, ['title', 'start', 'end', 'location'])
    .slice(0, maxEvents)
    .map((e) => ({ ...e, start: new Date(e.start).getTime() || null, end: new Date(e.end).getTime() || null }))
    .filter((e) => e.start)
    .sort((a, b) => a.start - b.start)
  return { available: true, events }
}

/**
 * 获取最近邮件（默认只取主题/发件人/日期，不读正文）。
 * @param {{limit?: number, includeBody?: boolean}} [options]
 */
export async function fetchRecentEmails({ limit = 20, includeBody = false } = {}) {
  if (!IS_MAC) {
    return { available: false, emails: [], error: 'only macOS is supported' }
  }
  const bodyLine = includeBody
    ? 'set out to out & (subject of m) & tab & (sender of m) & tab & (date received of m as string) & tab & (content of m) & linefeed'
    : 'set out to out & (subject of m) & tab & (sender of m) & tab & (date received of m as string) & linefeed'
  const script = `
    tell application "Mail"
      set out to ""
      set ms to (messages of inbox whose date received > (current date) - (7 * days))
      set seen to 0
      repeat with m in ms
        if seen ≥ ${limit} then exit repeat
        ${bodyLine}
        set seen to seen + 1
      end repeat
      return out
    end tell
  `
  const raw = runAppleScript(script)
  if (raw === null) {
    return { available: false, emails: [], error: 'Mail access denied or unavailable' }
  }
  const fields = includeBody ? ['subject', 'sender', 'date', 'body'] : ['subject', 'sender', 'date']
  const emails = parseTSV(raw, fields).slice(0, limit).map((m) => ({
    ...m,
    date: new Date(m.date).getTime() || null,
    body: m.body ? String(m.body).slice(0, 2000) : undefined,
  }))
  return { available: true, emails }
}

/**
 * 按姓名搜索联系人。
 * @param {{query?: string, limit?: number}} [options]
 */
export async function searchContacts({ query = '', limit = 20 } = {}) {
  if (!IS_MAC) {
    return { available: false, contacts: [], error: 'only macOS is supported' }
  }
  const nameFilter = query
    ? `whose name contains "${String(query).replace(/"/g, '\\"')}"`
    : ''
  const script = `
    tell application "Contacts"
      set out to ""
      set peopleList to ${nameFilter ? `(every person ${nameFilter})` : '(every person)'}
      set seen to 0
      repeat with p in peopleList
        if seen ≥ ${limit} then exit repeat
        set pname to (name of p as string)
        set porg to ""
        try
          set porg to (organization of p as string)
        end try
        set out to out & pname & tab & porg & linefeed
        set seen to seen + 1
      end repeat
      return out
    end tell
  `
  const raw = runAppleScript(script)
  if (raw === null) {
    return { available: false, contacts: [], error: 'Contacts access denied or unavailable' }
  }
  const contacts = parseTSV(raw, ['name', 'organization']).slice(0, limit)
  return { available: true, contacts }
}

/** 汇总三类个人数据源的状态（供脑健康检查/诊断）。 */
export function getPersonalDataSourcesStatus() {
  return {
    calendar: IS_MAC,
    email: IS_MAC,
    contacts: IS_MAC,
    platform: process.platform,
    note: IS_MAC ? '通过系统应用只读访问，首次可能需在系统隐私设置授权' : '仅 macOS 支持',
  }
}
