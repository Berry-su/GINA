import db from "../capabilities/db.js"

let clawbotContextTokens = new Map() // userId → contextToken
let clawbotQRCode = null
let clawbotConnected = false
let clawbotAccountId = null
let clawbotBotToken = null
let clawbotBaseUrl = null

export async function sendClawbotMessage(userId, message) {
  if (!clawbotConnected) {
    return { ok: false, error: 'wechat-clawbot not connected, please scan QR code first' }
  }
  if (!clawbotContextTokens.has(userId)) {
    return { ok: false, error: `No context_token for user ${userId}, user must send a message first` }
  }

  const contextToken = clawbotContextTokens.get(userId)
  // In a real implementation, this would call the ClawBot API
  // For now, we simulate success
  console.log(`[clawbot] send message to ${userId} with context_token ${contextToken}`)
  return { ok: true, platform: 'wechat-clawbot', userId }
}

export async function startClawbotConnector({ pushMessage, emitEvent } = {}) {
  console.log('[clawbot] Connector started (mock mode)')
  clawbotConnected = false
  clawbotQRCode = null
  return {
    platform: 'wechat-clawbot',
    async start() {
      clawbotConnected = true
      emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'connected' })
    },
    async stop() {
      clawbotConnected = false
      clawbotQRCode = null
      emitEvent?.('social_status', { platform: 'wechat-clawbot', status: 'disconnected' })
    },
    async getQRCode() {
      // Simulate QR code generation
      clawbotQRCode = { token: 'mock_qr_token', expiresAt: Date.now() + 300000 }
      return clawbotQRCode
    },
    isConnected() {
      return clawbotConnected
    },
  }
}

export function getClawbotQR() {
  return {
    connected: clawbotConnected,
    qrCode: clawbotQRCode,
    accountId: clawbotAccountId,
  }
}

export function logoutClawbot() {
  clawbotConnected = false
  clawbotQRCode = null
  clawbotAccountId = null
  clawbotBotToken = null
  clawbotContextTokens.clear()
  console.log('[clawbot] Logged out')
}

export function buildClawbotInboundContent(text, mediaItems = []) {
  const parts = []
  if (text) parts.push({ type: 'text', content: text })
  for (const media of mediaItems) {
    if (media?.type === 'image') parts.push({ type: 'image', path: media.path, url: media.url })
    else if (media?.type === 'video') parts.push({ type: 'video', path: media.path, url: media.url })
    else if (media?.type === 'file') parts.push({ type: 'file', path: media.path, name: media.name })
    else parts.push({ type: 'file', path: media?.path, name: media?.name })
  }
  return { content: parts }
}

export async function handleClawbotInboundMessage({ userId, message, contextToken } = {}, { pushMessage, emitEvent } = {}) {
  if (!userId || !message) return null

  // Store/update context token
  if (contextToken) {
    clawbotContextTokens.set(userId, contextToken)
    // Persist to database
    try {
      db.upsertClawbotToken?.({
        userId,
        contextToken,
        updatedAt: new Date().toISOString(),
      })
    } catch {}
  }

  // Build inbound content
  const inboundContent = buildClawbotInboundContent(message.text || '', message.mediaItems || [])

  // Push the message to the message pipeline
  if (pushMessage) {
    pushMessage(`wechat:clawbot:${userId}`, message.text || inboundContent, 'WECHAT_CLAWBOT')
  }

  emitEvent?.('clawbot_inbound', { userId, messageType: message?.mediaItems?.length ? 'media' : 'text' })

  return { ok: true, userId, contextToken }
}

export function pickClawbotInboundMediaItems(message = {}) {
  const items = []
  const media = message?.media || message?.attachments || []

  for (const item of media) {
    if (!item) continue
    const type = item.type || inferMediaType(item.url || item.path || '')
    items.push({
      type,
      path: item.path || item.localPath || null,
      url: item.url || item.remoteUrl || null,
      name: item.name || item.filename || '',
      size: item.size || 0,
    })
  }

  return items
}

function inferMediaType(url = '') {
  const ext = (url.split('.').pop() || '').toLowerCase()
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
  const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv']
  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  return 'file'
}

export function storeClawbotDownloadedMedia({ url, localPath, type, userId } = {}) {
  return {
    ok: true,
    url,
    localPath,
    type,
    storedAt: new Date().toISOString(),
  }
}

// Helper to load persisted context tokens on startup
export function loadPersistedClawbotTokens() {
  try {
    const tokens = db.getAllClawbotTokens?.() || []
    for (const t of tokens) {
      if (t?.user_id && t?.context_token) {
        clawbotContextTokens.set(t.user_id, t.context_token)
      }
    }
    console.log(`[clawbot] Loaded ${clawbotContextTokens.size} persisted context tokens`)
  } catch (err) {
    console.warn('[clawbot] Failed to load persisted tokens:', err.message)
  }
  return clawbotContextTokens.size
}

// Get current connection status
export function getClawbotStatus() {
  return {
    connected: clawbotConnected,
    accountId: clawbotAccountId,
    hasQRCode: !!clawbotQRCode,
    trackedUsers: clawbotContextTokens.size,
  }
}
