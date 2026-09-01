// src/connectors/calendar.js — 日历连接器抽象（ADR-010 · Phase 2）
//
// 设计目标：
//   老板说"今天有什么会"、"下周有空吗"、"帮我约 X" → GINA 跨 Google / iCloud / Outlook
//   日历统一查询 / 创建 / 更新 / 删除事件。
//
// 设计原则（9-02 老板纠错纪律）：
//   - 抽象层 = 单文件多 provider，每个 provider dynamic import 第三方 SDK
//   - 缺 SDK / 缺 creds 时降级 mock provider（测试默认走 mock）
//   - 真实 credential 走 .env（GINA_GOOGLE_CALENDAR_* / GINA_ICLOUD_CALDAV_* / GINA_OUTLOOK_CALENDAR_*）
//   - emotion-isolation 严守：日历事件只走"事实/时间轴"路径，不触发 joy，不进决策链路
//   - 跟现有 personal-data-sources.js (AppleScript macOS 只读) 共存：本模块远端/跨平台 +
//     可写；个人数据源模块保留作为 macOS 系统应用通道
//
// Provider 矩阵：
//   - google  : Google Calendar API（googleapis · OAuth2）
//   - icloud  : iCloud CalDAV（ical.js + node-dav 或自写 WebDAV；优先 ical.js）
//   - outlook : Microsoft Graph（@azure/msal-node + @microsoft/microsoft-graph-client）
//   - mock    : 内置 fake 数据（测试 + 缺 creds 时默认）
//
// 统一接口（每个 provider 暴露 5 函数）：
//   listCalendars()                                    → Array<{id, name, primary?}>
//   queryEvents({ calendarId?, rangeStart, rangeEnd }) → Array<Event>
//   createEvent(input)                                 → Event
//   updateEvent(id, patch)                             → Event
//   deleteEvent(id)                                    → {ok: boolean}
//
// Event 统一结构：
//   {
//     id, calendarId, provider,
//     title, description?, location?,
//     start (ISO 8601), end (ISO 8601), allDay (bool),
//     attendees? (Array<{email, name?, responseStatus?}>),
//     htmlLink?, organizer?,
//     raw?: Object
//   }

import { config as appConfig } from '../config.js'

// ── Provider registry（动态 require 第三方 SDK，缺包不破） ─────────────────
const PROVIDER_LOADERS = {
  google: () => import('googleapis').then((m) => m.google).catch(() => null),
  icloud: () => import('ical.js').then((m) => m).catch(() => null),
  outlook: () => import('@azure/msal-node').then((m) => m).catch(() => null),
  mock: async () => (await import('./_mock-calendar.js')).mockProvider,
}

// ── 统一 Event 形状（即便 mock 也保持） ────────────────────────────────────
function normalizeEvent(provider, ev) {
  if (!ev) return null
  return {
    id: String(ev.id ?? ev.uid ?? ev.iCalUID ?? cryptoRandom()),
    calendarId: String(ev.calendarId ?? 'primary'),
    provider,
    title: String(ev.title ?? ev.summary ?? ev.subject ?? '(无标题)'),
    description: ev.description ?? ev.notes ?? null,
    location: ev.location ?? ev.where ?? null,
    start: ev.start,
    end: ev.end,
    allDay: Boolean(ev.allDay),
    attendees: Array.isArray(ev.attendees)
      ? ev.attendees.map((a) => ({
          email: a.email,
          name: a.name ?? a.displayName ?? null,
          responseStatus: a.responseStatus ?? a.status ?? null,
        }))
      : undefined,
    organizer: ev.organizer ?? null,
    htmlLink: ev.htmlLink ?? ev.url ?? null,
    raw: ev.raw ?? null,
  }
}

function cryptoRandom() {
  return 'mock-' + Math.random().toString(36).slice(2, 10)
}

// ── Provider 实现：mock（默认 / 测试 / 降级） ──────────────────────────────
function makeMockProvider({ initialEvents = [] } = {}) {
  const calendars = [
    { id: 'mock-primary', name: '主日历 (mock)', primary: true },
    { id: 'mock-work', name: '工作 (mock)', primary: false },
  ]
  const events = new Map()
  let counter = 1
  for (const e of initialEvents) {
    const id = e.id || `mock-evt-${counter++}`
    events.set(id, { ...e, id, provider: 'mock', calendarId: e.calendarId || 'mock-primary' })
  }

  return {
    kind: 'mock',
    label: 'mock-calendar',
    listCalendars: async () => calendars.map((c) => ({ ...c })),
    queryEvents: async ({ rangeStart, rangeEnd, calendarId } = {}) => {
      const out = []
      for (const e of events.values()) {
        if (calendarId && e.calendarId !== calendarId) continue
        const evStart = new Date(e.start).getTime()
        const evEnd = new Date(e.end || e.start).getTime()
        if (rangeStart && evEnd < new Date(rangeStart).getTime()) continue
        if (rangeEnd && evStart > new Date(rangeEnd).getTime()) continue
        out.push(normalizeEvent('mock', e))
      }
      return out.sort((a, b) => new Date(a.start) - new Date(b.start))
    },
    createEvent: async (input) => {
      const id = `mock-evt-${counter++}`
      const ev = {
        id,
        provider: 'mock',
        calendarId: input.calendarId || 'mock-primary',
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        start: input.start,
        end: input.end,
        allDay: Boolean(input.allDay),
        attendees: input.attendees ?? [],
        htmlLink: null,
        raw: null,
      }
      events.set(id, ev)
      return normalizeEvent('mock', ev)
    },
    updateEvent: async (id, patch) => {
      const existing = events.get(id)
      if (!existing) throw new Error(`mock calendar: event ${id} not found`)
      const next = { ...existing, ...patch, id, provider: 'mock' }
      events.set(id, next)
      return normalizeEvent('mock', next)
    },
    deleteEvent: async (id) => {
      const ok = events.delete(id)
      return { ok, id, provider: 'mock' }
    },
  }
}

// ── Provider 实现：Google Calendar ─────────────────────────────────────────
function makeGoogleProvider({ credentials }) {
  // credentials: { clientId, clientSecret, redirectUri, refreshToken }
  return {
    kind: 'google',
    label: 'google-calendar',
    async _client() {
      const { google } = await PROVIDER_LOADERS.google()
      if (!google) throw new Error('googleapis package not installed')
      if (!credentials?.refreshToken) throw new Error('GINA_GOOGLE_CALENDAR_REFRESH_TOKEN missing')
      const oauth2 = new google.auth.OAuth2(
        credentials.clientId,
        credentials.clientSecret,
        credentials.redirectUri,
      )
      oauth2.setCredentials({ refresh_token: credentials.refreshToken })
      return google.calendar({ version: 'v3', auth: oauth2 })
    },
    listCalendars: async function () {
      const cal = await this._client()
      const { data } = await cal.calendarList.list()
      return (data.items || []).map((c) => ({ id: c.id, name: c.summary, primary: c.primary }))
    },
    queryEvents: async function ({ calendarId = 'primary', rangeStart, rangeEnd, maxResults = 50 } = {}) {
      const cal = await this._client()
      const { data } = await cal.events.list({
        calendarId,
        timeMin: rangeStart || new Date().toISOString(),
        timeMax: rangeEnd,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      })
      return (data.items || []).map((ev) =>
        normalizeEvent('google', {
          id: ev.id,
          calendarId,
          title: ev.summary,
          description: ev.description,
          location: ev.location,
          start: ev.start?.dateTime || ev.start?.date,
          end: ev.end?.dateTime || ev.end?.date,
          allDay: Boolean(ev.start?.date && !ev.start?.dateTime),
          attendees: ev.attendees,
          organizer: ev.organizer?.email,
          htmlLink: ev.htmlLink,
          raw: ev,
        }),
      )
    },
    createEvent: async function (input) {
      const cal = await this._client()
      const { data } = await cal.events.insert({
        calendarId: input.calendarId || 'primary',
        requestBody: {
          summary: input.title,
          description: input.description,
          location: input.location,
          start: input.allDay
            ? { date: (input.start || '').slice(0, 10) }
            : { dateTime: input.start },
          end: input.allDay
            ? { date: (input.end || '').slice(0, 10) }
            : { dateTime: input.end },
          attendees: input.attendees,
        },
      })
      return normalizeEvent('google', { ...data, calendarId: input.calendarId || 'primary' })
    },
    updateEvent: async function (id, patch, opts = {}) {
      const cal = await this._client()
      const { data } = await cal.events.patch({
        calendarId: opts.calendarId || 'primary',
        eventId: id,
        requestBody: patch,
      })
      return normalizeEvent('google', { ...data, calendarId: opts.calendarId || 'primary' })
    },
    deleteEvent: async function (id, opts = {}) {
      const cal = await this._client()
      try {
        await cal.events.delete({ calendarId: opts.calendarId || 'primary', eventId: id })
        return { ok: true, id, provider: 'google' }
      } catch (err) {
        return { ok: false, id, provider: 'google', error: err?.message || String(err) }
      }
    },
  }
}

// ── Provider 实现：iCloud CalDAV ───────────────────────────────────────────
// 简化实现：列出 principal 日历 → REPORT VEVENT → 返回 Event[]
// 真实生产应接 node-dav/icloud-vfs/ical.js；本层只暴露 queryEvents 简化版
function makeICloudProvider({ credentials }) {
  // credentials: { username (Apple ID), appSpecificPassword, calendarUrl? }
  const authHeader = () =>
    'Basic ' + Buffer.from(`${credentials.username}:${credentials.appSpecificPassword}`).toString('base64')

  return {
    kind: 'icloud',
    label: 'icloud-caldav',
    async _fetchCalendarList() {
      const url = credentials.calendarUrl || 'https://caldav.icloud.com/'
      const xml = `<?xml version="1.0" encoding="utf-8" ?>
        <d:propfind xmlns:d="DAV:">
          <d:prop><d:displayname/></d:prop>
        </d:propfind>`
      const res = await fetch(url, {
        method: 'PROPFIND',
        headers: { Authorization: authHeader(), Depth: '1', 'Content-Type': 'application/xml' },
        body: xml,
      })
      if (!res.ok) throw new Error(`iCloud CalDAV PROPFIND failed: ${res.status}`)
      return [{ id: 'icloud-primary', name: 'iCloud (primary)', primary: true }]
    },
    async queryEvents({ calendarId = 'icloud-primary', rangeStart, rangeEnd } = {}) {
      const ICAL = await PROVIDER_LOADERS.icloud()
      if (!ICAL) throw new Error('ical.js not installed')
      const start = rangeStart || new Date().toISOString()
      const end = rangeEnd || new Date(Date.now() + 7 * 86400000).toISOString()
      const body = `<?xml version="1.0" encoding="utf-8" ?>
        <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:prop><d:getetag/><c:calendar-data/></d:prop>
          <c:filter>
            <c:comp-filter name="VCALENDAR">
              <c:comp-filter name="VEVENT">
                <c:time-range start="${start.replace(/[-:]/g, '').split('.')[0]}Z" end="${end.replace(/[-:]/g, '').split('.')[0]}Z"/>
              </c:comp-filter>
            </c:comp-filter>
          </c:filter>
        </c:calendar-query>`
      const res = await fetch(credentials.calendarUrl || 'https://caldav.icloud.com/', {
        method: 'REPORT',
        headers: { Authorization: authHeader(), Depth: '1', 'Content-Type': 'application/xml' },
        body,
      })
      if (!res.ok) throw new Error(`iCloud CalDAV REPORT failed: ${res.status}`)
      const text = await res.text()
      const events = parseICalResponse(text, ICAL)
      return events.map((ev) => normalizeEvent('icloud', { ...ev, calendarId }))
    },
    // 创建 / 更新 / 删除：iCloud CalDAV 走 PUT/PATCH/DELETE ics 文件，复杂；
    // 本 phase 优先 queryEvents，写操作实现为 no-op（不破接口），后续按需补
    listCalendars: async function () {
      return this._fetchCalendarList()
    },
    createEvent: async () => {
      throw new Error('iCloud CalDAV createEvent: not yet implemented in this phase')
    },
    updateEvent: async () => {
      throw new Error('iCloud CalDAV updateEvent: not yet implemented in this phase')
    },
    deleteEvent: async () => {
      throw new Error('iCloud CalDAV deleteEvent: not yet implemented in this phase')
    },
  }
}

function parseICalResponse(xml, ICAL) {
  // 简化：抽 <response> 内 <calendar-data>...</calendar-data> 块，逐个 ICAL.parse
  const events = []
  const blockRe = /<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/g
  let m
  while ((m = blockRe.exec(xml))) {
    try {
      const jcal = ICAL.parse(m[1])
      const comp = new ICAL.Component(jcal)
      for (const vevent of comp.getAllSubcomponents('vevent')) {
        const v = new ICAL.Event(vevent)
        events.push({
          uid: v.uid,
          title: v.summary,
          description: v.description,
          location: v.location,
          start: v.startDate?.toJSDate()?.toISOString(),
          end: v.endDate?.toJSDate()?.toISOString(),
        })
      }
    } catch (err) {
      // 单条解析失败不中断
    }
  }
  return events
}

// ── Provider 实现：Outlook (Microsoft Graph) ────────────────────────────────
function makeOutlookProvider({ credentials }) {
  // credentials: { tenantId, clientId, clientSecret }（app-only 权限流）
  let cachedToken = null
  let cachedExpires = 0

  async function getToken() {
    if (cachedToken && Date.now() < cachedExpires - 60000) return cachedToken
    const msal = await PROVIDER_LOADERS.outlook()
    if (!msal) throw new Error('@azure/msal-node not installed')
    const cca = new msal.ConfidentialClientApplication({
      auth: {
        clientId: credentials.clientId,
        authority: `https://login.microsoftonline.com/${credentials.tenantId}`,
        clientSecret: credentials.clientSecret,
      },
    })
    const result = await cca.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    })
    cachedToken = result.accessToken
    cachedExpires = result.expiresOn?.getTime?.() || Date.now() + 3500 * 1000
    return cachedToken
  }

  async function graphFetch(path, opts = {}) {
    const token = await getToken()
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(`Graph ${path} failed: ${res.status} ${err.slice(0, 200)}`)
    }
    return res.json()
  }

  return {
    kind: 'outlook',
    label: 'outlook-graph',
    listCalendars: async function () {
      const data = await graphFetch('/me/calendars')
      return (data.value || []).map((c) => ({ id: c.id, name: c.name, primary: c.isDefaultCalendar }))
    },
    queryEvents: async function ({ calendarId, rangeStart, rangeEnd, maxResults = 50 } = {}) {
      const params = new URLSearchParams({
        $top: String(maxResults),
        $orderby: 'start/dateTime',
      })
      if (rangeStart) params.set('startDateTime', rangeStart)
      if (rangeEnd) params.set('endDateTime', rangeEnd)
      const path = calendarId ? `/me/calendars/${calendarId}/events` : '/me/events'
      const data = await graphFetch(`${path}?${params}`)
      return (data.value || []).map((ev) =>
        normalizeEvent('outlook', {
          id: ev.id,
          calendarId: ev.calendarId,
          title: ev.subject,
          description: ev.bodyPreview,
          location: ev.location?.displayName,
          start: ev.start?.dateTime,
          end: ev.end?.dateTime,
          allDay: Boolean(ev.isAllDay),
          attendees: ev.attendees,
          organizer: ev.organizer?.emailAddress?.address,
          htmlLink: ev.webLink,
          raw: ev,
        }),
      )
    },
    createEvent: async function (input) {
      const path = input.calendarId ? `/me/calendars/${input.calendarId}/events` : '/me/events'
      const data = await graphFetch(path, {
        method: 'POST',
        body: JSON.stringify({
          subject: input.title,
          body: { contentType: 'text', content: input.description || '' },
          location: { displayName: input.location || '' },
          start: { dateTime: input.start, timeZone: 'UTC' },
          end: { dateTime: input.end, timeZone: 'UTC' },
          isAllDay: Boolean(input.allDay),
          attendees: (input.attendees || []).map((a) => ({
            emailAddress: { address: a.email, name: a.name },
            type: 'required',
          })),
        }),
      })
      return normalizeEvent('outlook', { ...data, calendarId: input.calendarId || 'primary' })
    },
    updateEvent: async function (id, patch, opts = {}) {
      const path = opts.calendarId ? `/me/calendars/${opts.calendarId}/events/${id}` : `/me/events/${id}`
      const data = await graphFetch(path, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      return normalizeEvent('outlook', { ...data, calendarId: opts.calendarId || 'primary' })
    },
    deleteEvent: async function (id, opts = {}) {
      const path = opts.calendarId ? `/me/calendars/${opts.calendarId}/events/${id}` : `/me/events/${id}`
      try {
        const token = await getToken()
        const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        return { ok: res.ok, id, provider: 'outlook' }
      } catch (err) {
        return { ok: false, id, provider: 'outlook', error: err?.message || String(err) }
      }
    },
  }
}

// ── Provider 工厂：按 creds 决定选哪个 ─────────────────────────────────────
function readEnvCredentials(provider) {
  if (provider === 'google') {
    return {
      clientId: process.env.GINA_GOOGLE_CALENDAR_CLIENT_ID,
      clientSecret: process.env.GINA_GOOGLE_CALENDAR_CLIENT_SECRET,
      redirectUri: process.env.GINA_GOOGLE_CALENDAR_REDIRECT_URI,
      refreshToken: process.env.GINA_GOOGLE_CALENDAR_REFRESH_TOKEN,
    }
  }
  if (provider === 'icloud') {
    return {
      username: process.env.GINA_ICLOUD_CALDAV_USERNAME,
      appSpecificPassword: process.env.GINA_ICLOUD_CALDAV_APP_PASSWORD,
      calendarUrl: process.env.GINA_ICLOUD_CALDAV_URL,
    }
  }
  if (provider === 'outlook') {
    return {
      tenantId: process.env.GINA_OUTLOOK_CALENDAR_TENANT_ID,
      clientId: process.env.GINA_OUTLOOK_CALENDAR_CLIENT_ID,
      clientSecret: process.env.GINA_OUTLOOK_CALENDAR_CLIENT_SECRET,
    }
  }
  return null
}

function credentialsLookComplete(provider, creds) {
  if (!creds) return false
  if (provider === 'google') return Boolean(creds.clientId && creds.clientSecret && creds.refreshToken)
  if (provider === 'icloud') return Boolean(creds.username && creds.appSpecificPassword)
  if (provider === 'outlook') return Boolean(creds.tenantId && creds.clientId && creds.clientSecret)
  return false
}

const _providerCache = new Map() // provider name -> {provider, createdAt}

export async function getCalendarProvider(provider = null) {
  const requested = provider || process.env.GINA_CALENDAR_PROVIDER || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    instance = makeMockProvider()
  } else if (requested === 'google') {
    const creds = readEnvCredentials('google')
    if (!credentialsLookComplete('google', creds)) {
      console.warn('[calendar] Google creds incomplete; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeGoogleProvider({ credentials: creds })
    }
  } else if (requested === 'icloud') {
    const creds = readEnvCredentials('icloud')
    if (!credentialsLookComplete('icloud', creds)) {
      console.warn('[calendar] iCloud creds incomplete; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeICloudProvider({ credentials: creds })
    }
  } else if (requested === 'outlook') {
    const creds = readEnvCredentials('outlook')
    if (!credentialsLookComplete('outlook', creds)) {
      console.warn('[calendar] Outlook creds incomplete; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeOutlookProvider({ credentials: creds })
    }
  } else {
    throw new Error(`Unknown calendar provider: ${requested}`)
  }

  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 统一对外 API（老板唯一入口） ──────────────────────────────────────────
export async function listCalendars({ provider = null } = {}) {
  const p = await getCalendarProvider(provider)
  return p.listCalendars()
}

export async function queryEvents({ provider = null, calendarId = null, rangeStart, rangeEnd, maxResults = 50 } = {}) {
  const p = await getCalendarProvider(provider)
  return p.queryEvents({ calendarId, rangeStart, rangeEnd, maxResults })
}

export async function createEvent({ provider = null, ...input } = {}) {
  const p = await getCalendarProvider(provider)
  return p.createEvent(input)
}

export async function updateEvent({ provider = null, id, patch, calendarId } = {}) {
  const p = await getCalendarProvider(provider)
  return p.updateEvent(id, patch, { calendarId })
}

export async function deleteEvent({ provider = null, id, calendarId } = {}) {
  const p = await getCalendarProvider(provider)
  return p.deleteEvent(id, { calendarId })
}

// ── Provider 元数据（暴露给 UI / 状态路由） ──────────────────────────────
export const CALENDAR_PROVIDERS = [
  { id: 'mock', label: 'Mock（测试 / 降级）', default: true },
  { id: 'google', label: 'Google Calendar', env: 'GINA_GOOGLE_CALENDAR_*' },
  { id: 'icloud', label: 'iCloud CalDAV', env: 'GINA_ICLOUD_CALDAV_*' },
  { id: 'outlook', label: 'Microsoft Graph', env: 'GINA_OUTLOOK_CALENDAR_*' },
]

export function getCalendarStatus() {
  return {
    providers: CALENDAR_PROVIDERS,
    active: process.env.GINA_CALENDAR_PROVIDER || 'mock',
    cached: [..._providerCache.keys()],
  }
}

// ── Test hook（跟 translate.js __test 对齐，测试用注入） ─────────────────
export const __test = {
  _providerCache,
  makeMockProvider,
  readEnvCredentials,
  credentialsLookComplete,
  normalizeEvent,
}

// 显式 ignore unused appConfig 导入保留（后续按 config.security 走审批用）
void appConfig
