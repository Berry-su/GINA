// Gina 人型桌面宠物 —— three.js 程序化建模 + 待机动画 + 接 gina 大脑
// 通过 /vendor/three/three.module.js 加载 three（由后端 static 路由提供）
// 通过 /events SSE 订阅 gina 事件，驱动表情；通过 /message 发起对话。

import * as THREE from '/vendor/three/three.module.js'

const canvas = document.getElementById('pet')
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setClearColor(0x000000, 0)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
camera.position.set(0, 1.25, 4.6)
camera.lookAt(0, 0.8, 0)

// ─── 灯光：半球光打底、方向光做主光、轮廓光提层次（单色克制的金属质感） ───
scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a30, 0.9))
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
keyLight.position.set(3, 5, 4)
scene.add(keyLight)
const rimLight = new THREE.DirectionalLight(0xffffff, 1.1)
rimLight.position.set(-4, 2, -3)
scene.add(rimLight)

// ─── 材质（单色 HUD 风：近黑机身 + 亮灰脸 + 一点低饱和红点缀） ───
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x303038, roughness: 0.5, metalness: 0.15 })
const faceMat = new THREE.MeshStandardMaterial({ color: 0xececf2, roughness: 0.35, metalness: 0.05 })
const hairMat = new THREE.MeshStandardMaterial({ color: 0x18181d, roughness: 0.6, metalness: 0.1 })
const accentMat = new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.35, metalness: 0.2, emissive: 0x5a0000, emissiveIntensity: 0.7 })
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 1.0 })
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.2 })

const gina = new THREE.Group()
scene.add(gina)

// ─── 头部组（头 + 头发 + 刘海 + 眼睛 + 嘴，整体点头/歪头一起动） ───
const headGroup = new THREE.Group()
headGroup.position.y = 1.58
gina.add(headGroup)

const head = new THREE.Mesh(new THREE.SphereGeometry(0.56, 64, 64), faceMat)
headGroup.add(head)

const hair = new THREE.Mesh(
  new THREE.SphereGeometry(0.575, 64, 64, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hairMat,
)
hair.position.y = 0.04
headGroup.add(hair)

const fringe = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 64, 64, 0, Math.PI * 2, 0, Math.PI * 0.28),
  hairMat,
)
fringe.position.set(0, 0.2, 0.12)
headGroup.add(fringe)

// 眼睛（返回瞳孔引用，供表情调整视线）
function makeEye(side) {
  const g = new THREE.Group()
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 24), eyeMat)
  g.add(white)
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 16), pupilMat)
  pupil.position.z = 0.065
  g.add(pupil)
  g.position.set(side * 0.2, 0.08, 0.49)
  headGroup.add(g)
  return { group: g, pupil }
}
const eyeL = makeEye(-1)
const eyeR = makeEye(1)

// 嘴（双形态：微笑 / 说话张口）
const mouthSmile = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 24, Math.PI), pupilMat)
mouthSmile.position.set(0, -0.14, 0.49)
mouthSmile.rotation.z = Math.PI
headGroup.add(mouthSmile)

const mouthTalk = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), pupilMat)
mouthTalk.position.set(0, -0.15, 0.48)
mouthTalk.visible = false
headGroup.add(mouthTalk)

// ─── 身体（胶囊躯干） ───
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.62, 8, 32), bodyMat)
body.position.y = 0.72
gina.add(body)

// 胸口能量核心
const core = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 24), accentMat)
core.position.set(0, 0.82, 0.36)
gina.add(core)

// ─── 手臂 ───
function makeArm(side) {
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.125, 0.72, 6, 24), bodyMat)
  arm.position.set(side * 0.54, 0.82, 0)
  arm.rotation.z = side * 0.18
  gina.add(arm)
  return arm
}
const armL = makeArm(-1)
const armR = makeArm(1)

// ─── 腿 ───
function makeLeg(side) {
  const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 6, 24), bodyMat)
  leg.position.set(side * 0.21, 0.14, 0)
  gina.add(leg)
  return leg
}
makeLeg(-1)
makeLeg(1)

// ─── 表情状态（idle / thinking / speaking） ───
let moodState = 'idle'
let moodTimer = null

function setMood(state) {
  moodState = state
  if (moodTimer) clearTimeout(moodTimer)
  if (state !== 'idle') {
    // 兜底：若 gina 事件中断，30s 后自动回到待机
    moodTimer = setTimeout(() => { moodState = 'idle' }, 30000)
  }
}

// ─── SSE 接 gina 大脑 ───
let replyBuffer = ''
const bubble = document.getElementById('bubble')

function showBubble(text) {
  const t = String(text || '').trim()
  if (!t) return
  bubble.textContent = t
  bubble.style.display = 'block'
  clearTimeout(bubble._hide)
  bubble._hide = setTimeout(() => { bubble.style.display = 'none' }, 9000)
}

function handleEvent(msg) {
  const type = msg?.type
  const data = msg?.data || {}
  if (type === 'stream_start') {
    setMood('thinking')
    replyBuffer = ''
  } else if (type === 'stream_chunk' && data.mode === 'text') {
    setMood('speaking')
    replyBuffer += data.text || ''
  } else if (type === 'stream_end') {
    showBubble(replyBuffer)
    setMood('idle')
    replyBuffer = ''
  } else if (type === 'message') {
    showBubble(data.content)
    setMood('idle')
  }
}

function connectBrain() {
  try {
    const es = new EventSource('/events?client_id=pet')
    es.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      handleEvent(msg)
    }
  } catch (err) {
    console.warn('[pet] 连接 gina 事件流失败:', err?.message || err)
  }
}

// ─── 对话交互 ───
const talkBtn = document.getElementById('talk-btn')
const inputWrap = document.getElementById('input-wrap')
const input = document.getElementById('input')

talkBtn.addEventListener('click', () => {
  inputWrap.style.display = 'block'
  input.focus()
})

async function sendMessage(text) {
  const content = String(text || '').trim()
  if (!content) return
  try {
    await fetch('/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_id: 'pet', content, channel: 'pet' }),
    })
  } catch (err) {
    console.warn('[pet] 发送失败:', err?.message || err)
  }
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = input.value
    input.value = ''
    inputWrap.style.display = 'none'
    sendMessage(text)
  } else if (e.key === 'Escape') {
    input.value = ''
    inputWrap.style.display = 'none'
  }
})

// ─── 尺寸适配 ───
function resize() {
  const w = canvas.clientWidth || window.innerWidth
  const h = canvas.clientHeight || window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// ─── 动画 ───
const clock = new THREE.Clock()

function animate() {
  requestAnimationFrame(animate)
  const t = clock.getElapsedTime()

  // 呼吸（整体纵向轻微起伏）
  const breathe = 1 + Math.sin(t * 2.3) * 0.016
  gina.scale.set(1, breathe, 1)

  // 待机轻微摇摆（左右 + 微微侧倾）
  gina.rotation.y = Math.sin(t * 0.5) * 0.06
  gina.rotation.z = Math.sin(t * 0.7) * 0.02

  // 眨眼：约每 3.4 秒一次，快速闭合
  const cyc = t % 3.4
  const blink = cyc < 0.14 ? Math.sin((cyc / 0.14) * Math.PI) : 1
  const blinkScale = Math.max(0.05, blink)
  eyeL.group.scale.set(1, blinkScale, 1)
  eyeR.group.scale.set(1, blinkScale, 1)

  // 手臂轻微摆动
  armL.rotation.z = -0.18 + Math.sin(t * 1.1) * 0.03
  armR.rotation.z = 0.18 - Math.sin(t * 1.1) * 0.03

  // ── 表情 ──
  if (moodState === 'speaking') {
    // 快速点头 + 张嘴说话
    headGroup.position.y = 1.58 + Math.sin(t * 9) * 0.03
    headGroup.rotation.z = 0
    mouthSmile.visible = false
    mouthTalk.visible = true
    mouthTalk.scale.set(1, 0.6 + Math.sin(t * 9) * 0.4, 1)
    core.material.emissiveIntensity = 0.6 + Math.sin(t * 9) * 0.4
    eyeL.pupil.position.y = 0
    eyeR.pupil.position.y = 0
  } else if (moodState === 'thinking') {
    // 歪头思考 + 视线向上
    headGroup.position.y = 1.58
    headGroup.rotation.z = Math.sin(t * 1.6) * 0.08
    mouthSmile.visible = true
    mouthTalk.visible = false
    core.material.emissiveIntensity = 0.4 + Math.sin(t * 3) * 0.2
    eyeL.pupil.position.y = 0.03
    eyeR.pupil.position.y = 0.03
  } else {
    // 待机：正视 + 微笑 + 核心缓慢呼吸
    headGroup.position.y = 1.58
    headGroup.rotation.z = 0
    mouthSmile.visible = true
    mouthTalk.visible = false
    core.material.emissiveIntensity = 0.5 + Math.sin(t * 2.3) * 0.25
    eyeL.pupil.position.y = 0
    eyeR.pupil.position.y = 0
  }

  renderer.render(scene, camera)
}
animate()

connectBrain()
