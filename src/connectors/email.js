// src/connectors/email.js — 邮件连接器抽象（ADR-010 · Phase 2）
//
// 设计目标：
//   老板说"我有什么未读"、"搜邮件里 X"、让 GINA 写/回邮件 → 跨 Gmail / Outlook / SMTP
//   统一 listEmails / searchEmails / getEmail / sendEmail / markRead。
//
// Provider 矩阵：
//   - gmail  : IMAP/SMTP（imapflow + nodemailer；OAuth2 password 走 XOAUTH2）
//   - outlook: IMAP/SMTP（同上；outlook.office365.com）
//   - smtp   : 纯发送通道（nodemailer；任意 SMTP 服务器；接收走 provider 自己的 IMAP）
//   - mock   : 内置 fake 收件箱（测试 + 缺 creds 默认）
//
// 统一接口（每个 provider 暴露 5 函数）：
//   listEmails({ folder?, limit?, unreadOnly? })   → Array<Email>
//   searchEmails({ query, limit? })                → Array<Email>
//   getEmail(id)                                    → Email (含 body)
//   sendEmail({ to, subject, body, cc?, bcc? })     → {ok, id, provider}
//   markRead(id, read=true)                         → {ok, id}
//
// Email 统一结构：
//   {
//     id, provider, folder, subject, from, to, cc?, bcc?,
//     date (ISO 8601), snippet, body?, bodyHtml?,
//     unread (bool), attachments? (Array<{filename, size, contentType}>)
//   }
//
// 凭证走 .env（GINA_GMAIL_* / GINA_OUTLOOK_IMAP_* / GINA_SMTP_*）
// emotion-isolation 严守：邮件数据只走事实通道，不触发 joy

import { config as appConfig } from '../config.js'

// ── Provider：mock（默认 / 测试 / 降级） ────────────────────────────────────
function makeMockProvider() {
  let counter = 1
  const inbox = []
  const sent = []

  function addInitialSample() {
    if (inbox.length > 0) return
    const samples = [
      {
        id: 'mock-em-1',
        provider: 'mock',
        folder: 'INBOX',
        subject: '项目进度同步（周会）',
        from: 'alice@example.com',
        to: 'me@example.com',
        date: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
        snippet: '本周我们完成 C-1 阶段，C-2 已启动 ...',
        body: '本周我们完成 C-1 阶段，C-2 已启动。请查收附件。',
        unread: true,
        attachments: [{ filename: 'weekly.pdf', size: 204800, contentType: 'application/pdf' }],
      },
      {
        id: 'mock-em-2',
        provider: 'mock',
        folder: 'INBOX',
        subject: '【重要】投资人 demo 时间确认',
        from: 'vc@example.com',
        to: 'me@example.com',
        date: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
        snippet: 'demo 安排在下周三 14:00 ...',
        body: 'demo 安排在下周三 14:00，请准备 GINA 完整版演示。',
        unread: true,
        attachments: [],
      },
    ]
    for (const s of samples) inbox.push(s)
  }

  addInitialSample()

  return {
    kind: 'mock',
    label: 'mock-email',
    listEmails: async ({ folder = 'INBOX', limit = 20, unreadOnly = false } = {}) => {
      const pool = folder === 'SENT' || folder === 'Sent' ? sent : inbox
      return pool
        .filter((e) => !unreadOnly || e.unread)
        .slice(0, limit)
        .map((e) => ({ ...e }))
    },
    searchEmails: async ({ query = '', limit = 20 } = {}) => {
      const q = String(query || '').toLowerCase()
      return [...inbox, ...sent]
        .filter((e) =>
          !q ||
          e.subject?.toLowerCase().includes(q) ||
          e.body?.toLowerCase().includes(q) ||
          e.from?.toLowerCase().includes(q),
        )
        .slice(0, limit)
        .map((e) => ({ ...e }))
    },
    getEmail: async (id) => {
      const found = [...inbox, ...sent].find((e) => e.id === id)
      if (!found) throw new Error(`mock email: id ${id} not found`)
      return { ...found }
    },
    sendEmail: async ({ to, subject, body, cc = [], bcc = [] }) => {
      const id = `mock-em-sent-${counter++}`
      const msg = {
        id,
        provider: 'mock',
        folder: 'SENT',
        subject: subject || '(无主题)',
        from: 'me@example.com',
        to: Array.isArray(to) ? to.join(',') : to,
        cc: Array.isArray(cc) ? cc.join(',') : cc,
        bcc: Array.isArray(bcc) ? bcc.join(',') : bcc,
        date: new Date().toISOString(),
        snippet: String(body || '').slice(0, 200),
        body: body || '',
        unread: false,
        attachments: [],
      }
      sent.push(msg)
      return { ok: true, id, provider: 'mock' }
    },
    markRead: async (id, read = true) => {
      const e = inbox.find((x) => x.id === id)
      if (!e) return { ok: false, id, error: 'not found' }
      e.unread = !read
      return { ok: true, id, unread: e.unread }
    },
  }
}

// ── Provider：IMAP/SMTP 通用（Gmail / Outlook 共用底层） ──────────────────
function makeImapProvider({ kind, imapHost, imapPort, smtpHost, smtpPort, credentials }) {
  // credentials: { user, password, accessToken? }
  // 真实生产应 lazy import imapflow/nodemailer；本层走动态 require
  async function imapClient() {
    let ImapFlow
    try {
      const mod = await import('imapflow')
      ImapFlow = mod.ImapFlow || mod.default
    } catch {
      throw new Error('imapflow package not installed; run: pnpm add imapflow')
    }
    return new ImapFlow({
      host: imapHost,
      port: imapPort || 993,
      secure: true,
      auth: credentials.accessToken
        ? { user: credentials.user, accessToken: credentials.accessToken }
        : { user: credentials.user, pass: credentials.password },
      logger: false,
    })
  }

  async function smtpTransport() {
    let nodemailer
    try {
      nodemailer = (await import('nodemailer')).default
    } catch {
      throw new Error('nodemailer package not installed; run: pnpm add nodemailer')
    }
    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort || 465,
      secure: (smtpPort || 465) === 465,
      auth: credentials.accessToken
        ? { type: 'OAuth2', user: credentials.user, accessToken: credentials.accessToken }
        : { user: credentials.user, pass: credentials.password },
    })
  }

  function parseAddress(addr) {
    if (!addr) return null
    const m = String(addr).match(/^(?:"?([^"]+)"?\s)?<([^>]+)>/)
    if (m) return { name: m[1] || null, email: m[2] }
    return { name: null, email: String(addr).trim() }
  }

  async function fetchMessageBody(client, uid) {
    // 简化：取 text + html 两种 part 的最新一份
    const msg = await client.fetchOne(String(uid), { source: true, envelope: true, bodyStructure: true }, { uid: true })
    if (!msg || !msg.source) return { body: '', bodyHtml: '' }
    const source = msg.source.toString('utf8')
    return { body: source, bodyHtml: '' }
  }

  return {
    kind,
    label: `${kind}-email`,
    listEmails: async function ({ folder = 'INBOX', limit = 20, unreadOnly = false } = {}) {
      const client = await imapClient()
      await client.connect()
      try {
        const lock = await client.getMailboxLock(folder)
        try {
          const status = await client.status(folder, { messages: true, unseen: true })
          const uids = await client.search(
            unreadOnly ? { seen: false } : { all: true },
            { uid: true },
          )
          const top = uids.slice(Math.max(0, uids.length - limit)).reverse()
          const fetched = []
          for (const uid of top) {
            const m = await client.fetchOne(String(uid), { envelope: true, flags: true, uid: true }, { uid: true })
            if (!m) continue
            fetched.push({
              id: String(uid),
              provider: kind,
              folder,
              subject: m.envelope?.subject || '(无主题)',
              from: m.envelope?.from?.[0] ? `${m.envelope.from[0].name || ''} <${m.envelope.from[0].address}>` : null,
              to: (m.envelope?.to || []).map((a) => `${a.name || ''} <${a.address}>`).join(', '),
              date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null,
              snippet: (m.envelope?.subject || '').slice(0, 200),
              unread: !m.flags?.has('\\Seen'),
            })
          }
          return fetched
        } finally {
          lock.release()
        }
      } finally {
        await client.logout().catch(() => {})
      }
    },
    searchEmails: async function ({ query = '', limit = 20 } = {}) {
      const client = await imapClient()
      await client.connect()
      try {
        const lock = await client.getMailboxLock('INBOX')
        try {
          const uids = await client.search({ text: String(query) }, { uid: true })
          const top = uids.slice(Math.max(0, uids.length - limit)).reverse()
          const fetched = []
          for (const uid of top) {
            const m = await client.fetchOne(String(uid), { envelope: true, uid: true }, { uid: true })
            if (!m) continue
            fetched.push({
              id: String(uid),
              provider: kind,
              folder: 'INBOX',
              subject: m.envelope?.subject || '',
              from: m.envelope?.from?.[0]?.address || null,
              to: (m.envelope?.to || []).map((a) => a.address).join(', '),
              date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null,
              snippet: (m.envelope?.subject || '').slice(0, 200),
              unread: true,
            })
          }
          return fetched
        } finally {
          lock.release()
        }
      } finally {
        await client.logout().catch(() => {})
      }
    },
    getEmail: async function (id) {
      const client = await imapClient()
      await client.connect()
      try {
        const lock = await client.getMailboxLock('INBOX')
        try {
          const source = await client.download(String(id), undefined, { uid: true })
          const text = source?.content ? source.content.toString('utf8') : ''
          // 简化：把整个 RFC822 文本作为 body 返回；不解析 MIME 详图
          return {
            id: String(id),
            provider: kind,
            folder: 'INBOX',
            subject: text.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || '(无主题)',
            from: text.match(/^From:\s*(.+)$/im)?.[1]?.trim() || null,
            to: text.match(/^To:\s*(.+)$/im)?.[1]?.trim() || null,
            date: text.match(/^Date:\s*(.+)$/im)?.[1]?.trim() || null,
            snippet: text.slice(0, 200),
            body: text,
            bodyHtml: '',
            unread: false,
          }
        } finally {
          lock.release()
        }
      } finally {
        await client.logout().catch(() => {})
      }
    },
    sendEmail: async function ({ to, subject, body, cc = [], bcc = [] } = {}) {
      const t = await smtpTransport()
      const info = await t.sendMail({
        from: credentials.user,
        to: Array.isArray(to) ? to.join(',') : to,
        cc: cc?.length ? cc.join(',') : undefined,
        bcc: bcc?.length ? bcc.join(',') : undefined,
        subject: subject || '(无主题)',
        text: body || '',
      })
      return { ok: true, id: info.messageId, provider: kind }
    },
    markRead: async function (id, read = true) {
      const client = await imapClient()
      await client.connect()
      try {
        const lock = await client.getMailboxLock('INBOX')
        try {
          if (read) await client.messageFlagsAdd(String(id), ['\\Seen'], { uid: true })
          else await client.messageFlagsRemove(String(id), ['\\Seen'], { uid: true })
          return { ok: true, id, provider: kind }
        } finally {
          lock.release()
        }
      } finally {
        await client.logout().catch(() => {})
      }
    },
  }
}

// ── Provider：纯 SMTP（无 IMAP，用于发件聚合） ─────────────────────────────
function makeSmtpOnlyProvider({ smtpHost, smtpPort, credentials }) {
  return {
    kind: 'smtp',
    label: 'smtp-only',
    listEmails: async () => {
      throw new Error('SMTP-only provider has no inbox; configure an IMAP provider to read')
    },
    searchEmails: async () => {
      throw new Error('SMTP-only provider has no inbox; configure an IMAP provider to read')
    },
    getEmail: async () => {
      throw new Error('SMTP-only provider has no inbox; configure an IMAP provider to read')
    },
    sendEmail: async ({ to, subject, body, cc = [], bcc = [] }) => {
      const nodemailer = (await import('nodemailer')).default
      const t = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort || 465,
        secure: (smtpPort || 465) === 465,
        auth: { user: credentials.user, pass: credentials.password },
      })
      const info = await t.sendMail({
        from: credentials.user,
        to: Array.isArray(to) ? to.join(',') : to,
        cc: cc?.length ? cc.join(',') : undefined,
        bcc: bcc?.length ? bcc.join(',') : undefined,
        subject: subject || '(无主题)',
        text: body || '',
      })
      return { ok: true, id: info.messageId, provider: 'smtp' }
    },
    markRead: async () => {
      throw new Error('SMTP-only provider has no inbox')
    },
  }
}

// ── 凭证读取（按 provider 拉 .env） ───────────────────────────────────────
function readEnvCredentials(provider) {
  if (provider === 'gmail') {
    return {
      user: process.env.GINA_GMAIL_USER,
      password: process.env.GINA_GMAIL_APP_PASSWORD, // app password（非账号密码）
      accessToken: process.env.GINA_GMAIL_ACCESS_TOKEN,
    }
  }
  if (provider === 'outlook') {
    return {
      user: process.env.GINA_OUTLOOK_IMAP_USER,
      password: process.env.GINA_OUTLOOK_IMAP_PASSWORD,
      accessToken: process.env.GINA_OUTLOOK_IMAP_ACCESS_TOKEN,
    }
  }
  if (provider === 'smtp') {
    return {
      user: process.env.GINA_SMTP_USER,
      password: process.env.GINA_SMTP_PASSWORD,
    }
  }
  return null
}

function credsLookComplete(provider, c) {
  if (!c) return false
  if (provider === 'gmail' || provider === 'outlook') {
    return Boolean(c.user && (c.password || c.accessToken))
  }
  if (provider === 'smtp') return Boolean(c.user && c.password)
  return false
}

const _providerCache = new Map()

export async function getEmailProvider(provider = null) {
  const requested = provider || process.env.GINA_EMAIL_PROVIDER || 'mock'
  if (_providerCache.has(requested)) return _providerCache.get(requested).provider

  let instance = null
  if (requested === 'mock') {
    instance = makeMockProvider()
  } else if (requested === 'gmail') {
    const creds = readEnvCredentials('gmail')
    if (!credsLookComplete('gmail', creds)) {
      console.warn('[email] Gmail creds incomplete; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeImapProvider({
        kind: 'gmail',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        credentials: creds,
      })
    }
  } else if (requested === 'outlook') {
    const creds = readEnvCredentials('outlook')
    if (!credsLookComplete('outlook', creds)) {
      console.warn('[email] Outlook creds incomplete; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeImapProvider({
        kind: 'outlook',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        credentials: creds,
      })
    }
  } else if (requested === 'smtp') {
    const creds = readEnvCredentials('smtp')
    if (!credsLookComplete('smtp', creds)) {
      console.warn('[email] SMTP creds incomplete; falling back to mock')
      instance = makeMockProvider()
    } else {
      instance = makeSmtpOnlyProvider({
        smtpHost: process.env.GINA_SMTP_HOST || 'smtp.gmail.com',
        smtpPort: Number(process.env.GINA_SMTP_PORT) || 465,
        credentials: creds,
      })
    }
  } else {
    throw new Error(`Unknown email provider: ${requested}`)
  }

  _providerCache.set(requested, { provider: instance, createdAt: Date.now() })
  return instance
}

// ── 统一对外 API ─────────────────────────────────────────────────────────
export async function listEmails({ provider = null, folder = 'INBOX', limit = 20, unreadOnly = false } = {}) {
  const p = await getEmailProvider(provider)
  return p.listEmails({ folder, limit, unreadOnly })
}

export async function searchEmails({ provider = null, query = '', limit = 20 } = {}) {
  const p = await getEmailProvider(provider)
  return p.searchEmails({ query, limit })
}

export async function getEmail({ provider = null, id } = {}) {
  const p = await getEmailProvider(provider)
  return p.getEmail(id)
}

export async function sendEmail({ provider = null, to, subject, body, cc = [], bcc = [] } = {}) {
  const p = await getEmailProvider(provider)
  return p.sendEmail({ to, subject, body, cc, bcc })
}

export async function markRead({ provider = null, id, read = true } = {}) {
  const p = await getEmailProvider(provider)
  return p.markRead(id, read)
}

export const EMAIL_PROVIDERS = [
  { id: 'mock', label: 'Mock（测试 / 降级）', default: true },
  { id: 'gmail', label: 'Gmail IMAP/SMTP', env: 'GINA_GMAIL_*' },
  { id: 'outlook', label: 'Outlook IMAP/SMTP', env: 'GINA_OUTLOOK_IMAP_*' },
  { id: 'smtp', label: '纯 SMTP 发送', env: 'GINA_SMTP_*' },
]

export function getEmailStatus() {
  return {
    providers: EMAIL_PROVIDERS,
    active: process.env.GINA_EMAIL_PROVIDER || 'mock',
    cached: [..._providerCache.keys()],
  }
}

export const __test = {
  _providerCache,
  makeMockProvider,
  readEnvCredentials,
  credsLookComplete,
}

void appConfig
