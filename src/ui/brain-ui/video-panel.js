// video-panel.js — 视频理解 UI 面板（ADR-013 · PLAN-P6 §Phase 6 完工）
//
// 视频上传/URL 粘贴 + 处理进度条 + 关键事件时间轴 + 章节分段 + 摘要
// 跟 vision-panel.js / translate-panel.js / hotspot-panel.js 风格一致
//
// 重要约束（C-4.3 红线）：
//   - 不触发 joy 任何字段
//   - 不 import joy-state
//   - 视频处理输出只进文本流

const OCR_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'fr', 'es']
const LANGUAGE_LABELS = {
  zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español',
}

export const createVideoPanel = () => `
<div class="video-panel" id="video-panel" aria-live="polite">
  <div class="vp-card">
    <div class="vp-header">
      <div class="vp-title">视频理解 (Phase 6 完工)</div>
      <button class="vp-exit-btn" id="videop-exit-btn" type="button" aria-label="关闭" title="关闭">×</button>
    </div>
    <div class="vp-source-row">
      <label class="vp-source-label">
        <span>视频源</span>
        <select id="videop-source-kind" class="vp-select">
          <option value="local">本地文件</option>
          <option value="url">公开网 URL</option>
          <option value="m3u8">HLS 流</option>
        </select>
      </label>
      <input type="text" id="videop-source" class="vp-path" placeholder="本地路径 / https://... / https://...m3u8" />
      <button id="videop-detect" class="vp-btn" type="button">检测源</button>
    </div>
    <div class="vp-source-info" id="videop-source-info">未选择源</div>
    <div class="vp-options-row">
      <label class="vp-label">
        <span>Provider</span>
        <select id="videop-provider" class="vp-select">
          <option value="mock" selected>Mock (测试)</option>
          <option value="vlm-gpt4v">GPT-4o-vision (Phase 1)</option>
          <option value="vlm-qwen">Qwen-VL 本地</option>
        </select>
      </label>
      <label class="vp-label">
        <span>帧间隔 (秒)</span>
        <input type="number" id="videop-interval" class="vp-input-num" value="30" min="1" max="300" />
      </label>
      <label class="vp-label">
        <span>最大帧数</span>
        <input type="number" id="videop-maxframes" class="vp-input-num" value="20" min="1" max="100" />
      </label>
      <label class="vp-label">
        <span>音频</span>
        <input type="checkbox" id="videop-audio" checked />
      </label>
    </div>
    <div class="vp-progress-row" id="videop-progress-row" style="display:none">
      <div class="vp-progress-bar"><div id="videop-progress-fill" class="vp-progress-fill"></div></div>
      <span id="videop-stage" class="vp-stage">就绪</span>
    </div>
    <div class="vp-tabs">
      <button class="vp-tab vp-tab-active" data-tab="summary">摘要</button>
      <button class="vp-tab" data-tab="events">关键事件</button>
      <button class="vp-tab" data-tab="chapters">章节</button>
      <button class="vp-tab" data-tab="transcript">字幕</button>
    </div>
    <div class="vp-body">
      <div class="vp-pane vp-pane-active" data-pane="summary">
        <div id="videop-summary" class="vp-summary">视频摘要会在这里出现…</div>
      </div>
      <div class="vp-pane" data-pane="events">
        <div id="videop-events" class="vp-events">（处理后显示关键事件时间轴）</div>
      </div>
      <div class="vp-pane" data-pane="chapters">
        <div id="videop-chapters" class="vp-chapters">（处理后显示章节分段）</div>
      </div>
      <div class="vp-pane" data-pane="transcript">
        <div id="videop-transcript" class="vp-transcript">（处理后显示字幕）</div>
      </div>
    </div>
    <div class="vp-footer">
      <button id="videop-summarize" class="vp-btn-primary" type="button">理解视频</button>
      <button id="videop-probe" class="vp-btn" type="button">仅探查</button>
      <button id="videop-clear" class="vp-btn" type="button">清空</button>
      <span id="videop-status" class="vp-status">就绪</span>
      <span id="videop-cache" class="vp-cache" title="视频帧缓存命中率">缓存 0/0</span>
    </div>
  </div>
</div>
`

export function initVideoPanel({ getApiBase = () => '', authToken = null } = {}) {
  const panel = document.getElementById('video-panel')
  if (!panel) return null

  const $ = (id) => document.getElementById(id)
  const sourceKindEl = $('videop-source-kind')
  const sourceEl = $('videop-source')
  const detectBtn = $('videop-detect')
  const sourceInfoEl = $('videop-source-info')
  const providerEl = $('videop-provider')
  const intervalEl = $('videop-interval')
  const maxFramesEl = $('videop-maxframes')
  const audioEl = $('videop-audio')
  const progressRowEl = $('videop-progress-row')
  const progressFillEl = $('videop-progress-fill')
  const stageEl = $('videop-stage')
  const summaryEl = $('videop-summary')
  const eventsEl = $('videop-events')
  const chaptersEl = $('videop-chapters')
  const transcriptEl = $('videop-transcript')
  const summarizeBtn = $('videop-summarize')
  const probeBtn = $('videop-probe')
  const clearBtn = $('videop-clear')
  const statusEl = $('videop-status')
  const cacheEl = $('videop-cache')
  const exitBtn = $('videop-exit-btn')

  // ── tabs ──
  const tabs = panel.querySelectorAll('.vp-tab')
  const panes = panel.querySelectorAll('.vp-pane')
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('vp-tab-active'))
      panes.forEach((p) => p.classList.remove('vp-pane-active'))
      t.classList.add('vp-tab-active')
      const target = t.getAttribute('data-tab')
      const pane = panel.querySelector(`[data-pane="${target}"]`)
      if (pane) pane.classList.add('vp-pane-active')
    })
  })

  function setStatus(text) { if (statusEl) statusEl.textContent = text }
  function setProgress(p, stage) {
    if (progressRowEl) progressRowEl.style.display = 'block'
    if (progressFillEl) progressFillEl.style.width = `${Math.max(0, Math.min(1, p)) * 100}%`
    if (stageEl && stage) stageEl.textContent = stage
  }
  function setCache(hits, total) { if (cacheEl) cacheEl.textContent = `缓存 ${hits}/${total}` }

  async function refreshStatus() {
    try {
      const resp = await fetch(`${getApiBase()}/video/status`, {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
      })
      const data = await resp.json()
      if (data?.ok) {
        const c = data.cache || {}
        setCache(c.hits || 0, (c.hits || 0) + (c.misses || 0))
      }
    } catch {}
  }

  async function detectSource() {
    const src = sourceEl?.value?.trim()
    if (!src) { setStatus('请输入源'); return }
    try {
      const resp = await fetch(`${getApiBase()}/video/detect-source`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ source: src }),
      })
      const data = await resp.json()
      if (data?.ok) {
        const d = data.detected
        sourceInfoEl.textContent = `✓ 类型: ${d.kind}${d.platform ? ` · 平台: ${d.platformLabel || d.platform}` : ''}${d.exists === false ? ' (⚠ 本地文件不存在)' : ''}`
        setStatus('源检测完成')
      } else {
        sourceInfoEl.textContent = `✗ ${data?.error || '检测失败'}`
        setStatus('源检测失败')
      }
    } catch (err) {
      setStatus(`错误: ${err?.message || err}`)
    }
  }

  async function doProbe() {
    const src = sourceEl?.value?.trim()
    if (!src) { setStatus('请输入源'); return }
    setStatus('探查中…')
    try {
      const resp = await fetch(`${getApiBase()}/video/probe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ source: src }),
      })
      const data = await resp.json()
      if (data?.ok) {
        const dur = data.durationSec ? `${data.durationSec.toFixed(1)}s` : 'N/A'
        const res = data.video ? `${data.video.width}x${data.video.height} @ ${data.video.fps || '?'}fps` : 'N/A'
        sourceInfoEl.textContent = `✓ 时长: ${dur} · 分辨率: ${res} · 编码: ${data.video?.codec || 'N/A'}`
        setStatus('探查完成')
      } else {
        sourceInfoEl.textContent = `✗ ${data?.error || '探查失败'}`
        setStatus('探查失败')
      }
    } catch (err) {
      setStatus(`错误: ${err?.message || err}`)
    }
  }

  async function doSummarize() {
    const src = sourceEl?.value?.trim()
    if (!src) { setStatus('请输入源'); return }
    setStatus('处理中…')
    setProgress(0, '启动')
    try {
      const resp = await fetch(`${getApiBase()}/video/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          source: src,
          provider: providerEl?.value || 'mock',
          frameIntervalSec: parseInt(intervalEl?.value || '30', 10),
          maxFrames: parseInt(maxFramesEl?.value || '20', 10),
          includeAudio: audioEl?.checked !== false,
        }),
      })
      const data = await resp.json()
      if (!data?.ok) throw new Error(data?.error || '处理失败')

      // 渲染结果
      if (summaryEl) summaryEl.textContent = data.summary?.summary || '（无摘要）'
      if (eventsEl) {
        const evs = data.keyEvents || []
        eventsEl.innerHTML = evs.length === 0 ? '（无关键事件）' : evs.map((e) =>
          `<div class="vp-event"><span class="vp-event-time">${e.time || '??:??'}</span><span class="vp-event-desc">${e.description || ''}</span></div>`
        ).join('')
      }
      if (chaptersEl) {
        const chs = data.chapters || []
        chaptersEl.innerHTML = chs.length === 0 ? '（无章节）' : chs.map((c) =>
          `<div class="vp-chapter"><span class="vp-chapter-time">${c.startFormatted || ''} - ${c.endFormatted || ''}</span><span class="vp-chapter-title">${c.title || ''}</span></div>`
        ).join('')
      }
      if (transcriptEl) {
        const tr = data.transcript
        transcriptEl.textContent = tr?.text || tr?.segments?.map(s => `[${s.start}s] ${s.text}`).join('\n') || '（无字幕）'
      }
      setProgress(1, '完成')
      setStatus(data.cached ? '完成 (cached)' : '完成')
    } catch (err) {
      setStatus(`错误: ${err?.message || err}`)
      setProgress(0, '失败')
    }
    refreshStatus()
  }

  detectBtn?.addEventListener('click', detectSource)
  summarizeBtn?.addEventListener('click', doSummarize)
  probeBtn?.addEventListener('click', doProbe)
  clearBtn?.addEventListener('click', () => {
    if (sourceEl) sourceEl.value = ''
    if (sourceInfoEl) sourceInfoEl.textContent = '未选择源'
    if (summaryEl) summaryEl.textContent = '视频摘要会在这里出现…'
    if (eventsEl) eventsEl.innerHTML = '（处理后显示关键事件时间轴）'
    if (chaptersEl) chaptersEl.innerHTML = '（处理后显示章节分段）'
    if (transcriptEl) transcriptEl.textContent = '（处理后显示字幕）'
    if (progressRowEl) progressRowEl.style.display = 'none'
    setStatus('就绪')
  })
  exitBtn?.addEventListener('click', () => { panel.style.display = 'none' })

  refreshStatus()
  return { panel, doSummarize, doProbe, detectSource, refreshStatus }
}

export default { createVideoPanel, initVideoPanel }
