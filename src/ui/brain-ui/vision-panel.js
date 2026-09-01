// vision-panel.js — VLM/OCR UI 面板（ADR-009 · PLAN-P6 §Phase 1）
//
// 拖图上传 + 看图回复 + OCR 文字提取
// 跟 translate-panel.js / person-card-panel.js 风格一致
//
// 重要约束（C-4.3 红线）：
//   - 不触发 joy 任何字段
//   - 不 import joy-state
//   - VLM/OCR 输出只进文本流

const OCR_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'fr', 'es']
const LANGUAGE_LABELS = {
  zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español',
}

export const createVisionPanel = () => `
<div class="vision-panel" id="vision-panel" aria-live="polite">
  <div class="vp-card">
    <div class="vp-header">
      <div class="vp-title">图像理解 (VLM + OCR)</div>
      <button class="vp-exit-btn" id="vp-exit-btn" type="button" aria-label="关闭" title="关闭">×</button>
    </div>
    <div class="vp-upload-row">
      <label class="vp-upload-label">
        <input type="file" id="vp-file" accept="image/png,image/jpeg,image/gif,image/webp" class="vp-file" />
        <span class="vp-upload-btn">选择图片</span>
      </label>
      <input type="text" id="vp-path" class="vp-path" placeholder="或粘贴图片绝对路径…" />
    </div>
    <div class="vp-prompt-row">
      <label class="vp-label">
        <span>Prompt (VLM)</span>
        <input type="text" id="vp-prompt" class="vp-prompt" placeholder="这张图是什么？" value="这张图是什么？" />
      </label>
      <label class="vp-label vp-label-lang">
        <span>OCR 语种</span>
        <select id="vp-ocr-lang" class="vp-select">
          ${OCR_LANGUAGES.map(l => `<option value="${l}" ${l === 'en' ? 'selected' : ''}>${LANGUAGE_LABELS[l]}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="vp-body">
      <div class="vp-col">
        <div class="vp-col-title">预览</div>
        <div id="vp-preview" class="vp-preview">（无图片）</div>
      </div>
      <div class="vp-col">
        <div class="vp-col-title">结果 <span id="vp-provider-badge" class="vp-badge">—</span></div>
        <div id="vp-result" class="vp-result" aria-live="polite">结果会在这里出现…</div>
      </div>
    </div>
    <div class="vp-footer">
      <button id="vp-see" class="vp-btn-primary" type="button">看图 (VLM)</button>
      <button id="vp-ocr" class="vp-btn" type="button">识字 (OCR)</button>
      <button id="vp-clear" class="vp-btn" type="button">清空</button>
      <span id="vp-status" class="vp-status">就绪</span>
      <span id="vp-cache" class="vp-cache" title="VLM/OCR 缓存命中率">缓存 0/0</span>
    </div>
  </div>
</div>
`

export function initVisionPanel({ getApiBase = () => '', authToken = null } = {}) {
  const panel = document.getElementById('vision-panel')
  if (!panel) return null
  const fileEl = document.getElementById('vp-file')
  const pathEl = document.getElementById('vp-path')
  const promptEl = document.getElementById('vp-prompt')
  const ocrLangEl = document.getElementById('vp-ocr-lang')
  const previewEl = document.getElementById('vp-preview')
  const resultEl = document.getElementById('vp-result')
  const providerBadge = document.getElementById('vp-provider-badge')
  const statusEl = document.getElementById('vp-status')
  const cacheEl = document.getElementById('vp-cache')
  const seeBtn = document.getElementById('vp-see')
  const ocrBtn = document.getElementById('vp-ocr')
  const clearBtn = document.getElementById('vp-clear')
  const exitBtn = document.getElementById('vp-exit-btn')

  let currentImagePath = null

  function setStatus(text) { if (statusEl) statusEl.textContent = text }
  function setCache(hits, total) { if (cacheEl) cacheEl.textContent = `缓存 ${hits}/${total}` }

  async function refreshCache() {
    try {
      const resp = await fetch(`${getApiBase()}/vision/multimodal-status`, {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
      })
      const data = await resp.json()
      if (data?.ok) {
        const vlmTotal = (data.vlm?.cache?.hits || 0) + (data.vlm?.cache?.misses || 0)
        const ocrTotal = (data.ocr?.cache?.hits || 0) + (data.ocr?.cache?.misses || 0)
        setCache((data.vlm?.cache?.hits || 0) + (data.ocr?.cache?.hits || 0), vlmTotal + ocrTotal)
      }
    } catch {}
  }

  fileEl?.addEventListener('change', (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    currentImagePath = file.path  // Electron 暴露 fs path
    if (pathEl) pathEl.value = file.path
    if (previewEl) {
      const url = URL.createObjectURL(file)
      previewEl.innerHTML = `<img src="${url}" alt="preview" class="vp-img" />`
    }
  })

  pathEl?.addEventListener('change', () => {
    if (pathEl?.value) {
      currentImagePath = pathEl.value
      if (previewEl) {
        previewEl.innerHTML = `<div class="vp-path-display">${pathEl.value}</div>`
      }
    }
  })

  async function doSee() {
    if (!currentImagePath) { setStatus('请先选择图片'); return }
    const prompt = promptEl?.value || '这张图是什么？'
    setStatus('VLM 识别中…')
    try {
      const resp = await fetch(`${getApiBase()}/vision/see`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ imagePath: currentImagePath, prompt }),
      })
      const data = await resp.json()
      if (!data?.ok) throw new Error(data?.error || 'VLM 失败')
      if (resultEl) resultEl.textContent = data.text
      if (providerBadge) providerBadge.textContent = `${data.provider}${data.cached ? ' (cached)' : ''}`
      setStatus(data.cached ? '命中缓存' : '完成')
    } catch (err) {
      setStatus(`错误: ${err?.message || err}`)
    }
    refreshCache()
  }

  async function doOCR() {
    if (!currentImagePath) { setStatus('请先选择图片'); return }
    const language = ocrLangEl?.value || 'en'
    setStatus('OCR 提取中…')
    try {
      const resp = await fetch(`${getApiBase()}/vision/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ imagePath: currentImagePath, language }),
      })
      const data = await resp.json()
      if (!data?.ok) throw new Error(data?.error || 'OCR 失败')
      if (resultEl) resultEl.textContent = data.text
      if (providerBadge) providerBadge.textContent = `${data.provider}${data.cached ? ' (cached)' : ''}`
      setStatus(data.cached ? '命中缓存' : '完成')
    } catch (err) {
      setStatus(`错误: ${err?.message || err}`)
    }
    refreshCache()
  }

  seeBtn?.addEventListener('click', doSee)
  ocrBtn?.addEventListener('click', doOCR)
  clearBtn?.addEventListener('click', () => {
    if (fileEl) fileEl.value = ''
    if (pathEl) pathEl.value = ''
    if (previewEl) previewEl.innerHTML = '（无图片）'
    if (resultEl) resultEl.textContent = '结果会在这里出现…'
    if (providerBadge) providerBadge.textContent = '—'
    currentImagePath = null
    setStatus('就绪')
  })
  exitBtn?.addEventListener('click', () => {
    panel.style.display = 'none'
  })

  refreshCache()
  return { panel, doSee, doOCR, refreshCache, setStatus, getCurrentImagePath: () => currentImagePath }
}

export default { createVisionPanel, initVisionPanel }
