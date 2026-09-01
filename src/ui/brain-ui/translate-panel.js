// translate-panel.js — 实时翻译 UI 面板（ADR-008 · PLAN-P6 §Phase 1）
//
// 6 语种切换 + 输入框 + 输出框 + 流式字幕
// 跟 voice-panel.js / person-card-panel.js 风格一致
//
// 重要约束（C-4.3 红线）：
//   - 不触发 joy 任何字段
//   - 不 import joy-state
//   - 翻译只输出文字，进文本流

const SUPPORTED_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'fr', 'es']
const LANGUAGE_LABELS = {
  zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español',
}

export const createTranslatePanel = () => `
<div class="translate-panel" id="translate-panel" aria-live="polite">
  <div class="tp-card">
    <div class="tp-header">
      <div class="tp-title">实时翻译</div>
      <button class="tp-exit-btn" id="tp-exit-btn" type="button" aria-label="关闭" title="关闭">×</button>
    </div>
    <div class="tp-lang-row">
      <label class="tp-label">
        <span>从</span>
        <select id="tp-from" class="tp-select">
          <option value="auto">自动检测</option>
          ${SUPPORTED_LANGUAGES.map(l => `<option value="${l}">${LANGUAGE_LABELS[l]}</option>`).join('')}
        </select>
      </label>
      <button id="tp-swap" class="tp-swap" type="button" title="交换源/目标">⇄</button>
      <label class="tp-label">
        <span>到</span>
        <select id="tp-to" class="tp-select">
          ${SUPPORTED_LANGUAGES.map(l => `<option value="${l}" ${l === 'en' ? 'selected' : ''}>${LANGUAGE_LABELS[l]}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="tp-body">
      <div class="tp-col">
        <div class="tp-col-title">原文</div>
        <textarea id="tp-input" class="tp-textarea" placeholder="输入或粘贴要翻译的文本…"></textarea>
      </div>
      <div class="tp-col">
        <div class="tp-col-title">译文 <span id="tp-provider-badge" class="tp-badge">—</span></div>
        <div id="tp-output" class="tp-output" aria-live="polite">译文会在这里出现…</div>
      </div>
    </div>
    <div class="tp-footer">
      <button id="tp-translate" class="tp-btn-primary" type="button">翻译</button>
      <button id="tp-stream" class="tp-btn" type="button">流式</button>
      <button id="tp-clear" class="tp-btn" type="button">清空</button>
      <span id="tp-status" class="tp-status">就绪</span>
      <span id="tp-memory" class="tp-mem" title="翻译记忆命中率">命中 0/0</span>
    </div>
  </div>
</div>
`

// ── 行为层：挂载到 DOM 后的初始化 ────────────────────────────────────────
export function initTranslatePanel({ getApiBase = () => '', authToken = null } = {}) {
  const panel = document.getElementById('translate-panel')
  if (!panel) return null
  const fromEl = document.getElementById('tp-from')
  const toEl = document.getElementById('tp-to')
  const inputEl = document.getElementById('tp-input')
  const outputEl = document.getElementById('tp-output')
  const providerBadge = document.getElementById('tp-provider-badge')
  const statusEl = document.getElementById('tp-status')
  const memEl = document.getElementById('tp-memory')
  const translateBtn = document.getElementById('tp-translate')
  const streamBtn = document.getElementById('tp-stream')
  const clearBtn = document.getElementById('tp-clear')
  const swapBtn = document.getElementById('tp-swap')
  const exitBtn = document.getElementById('tp-exit-btn')

  function setStatus(text) { if (statusEl) statusEl.textContent = text }
  function setMemory(hits, total) { if (memEl) memEl.textContent = `命中 ${hits}/${total}` }

  async function refreshMemory() {
    try {
      const resp = await fetch(`${getApiBase()}/translate/status`, {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
      })
      const data = await resp.json()
      if (data?.ok && data.memory) {
        setMemory(data.memory.hits, data.memory.hits + data.memory.misses)
      }
    } catch {}
  }

  async function doTranslate(stream = false) {
    const text = inputEl?.value?.trim()
    if (!text) { setStatus('请输入文本'); return }
    const from = fromEl?.value || 'auto'
    const to = toEl?.value || 'en'
    setStatus(stream ? '流式中…' : '翻译中…')
    if (outputEl) outputEl.textContent = ''

    try {
      if (stream) {
        const resp = await fetch(`${getApiBase()}/translate/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ text, from, to }),
        })
        if (!resp.body) throw new Error('流式响应无 body')
        const reader = resp.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          // SSE: data: {...}\n\n
          const events = buf.split('\n\n')
          buf = events.pop() || ''
          for (const ev of events) {
            const line = ev.trim()
            if (!line.startsWith('data:')) continue
            try {
              const payload = JSON.parse(line.slice(5).trim())
              if (outputEl) {
                outputEl.textContent += payload.text
                if (providerBadge) providerBadge.textContent = payload.provider
              }
            } catch {}
          }
        }
        setStatus('流式完成')
      } else {
        const resp = await fetch(`${getApiBase()}/translate/text`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ text, from, to }),
        })
        const data = await resp.json()
        if (!data?.ok) throw new Error(data?.error || '翻译失败')
        if (outputEl) outputEl.textContent = data.text
        if (providerBadge) providerBadge.textContent = data.provider
        setStatus(data.cached ? '命中记忆' : '完成')
      }
    } catch (err) {
      setStatus(`错误: ${err?.message || err}`)
    }
    refreshMemory()
  }

  translateBtn?.addEventListener('click', () => doTranslate(false))
  streamBtn?.addEventListener('click', () => doTranslate(true))
  clearBtn?.addEventListener('click', () => {
    if (inputEl) inputEl.value = ''
    if (outputEl) outputEl.textContent = '译文会在这里出现…'
    setStatus('就绪')
  })
  swapBtn?.addEventListener('click', () => {
    if (!fromEl || !toEl) return
    if (fromEl.value === 'auto') return  // 自动检测不能 swap
    const a = fromEl.value, b = toEl.value
    fromEl.value = b
    toEl.value = a
  })
  exitBtn?.addEventListener('click', () => {
    panel.style.display = 'none'
  })

  refreshMemory()
  return { panel, doTranslate, refreshMemory, setStatus }
}

export default { createTranslatePanel, initTranslatePanel }
