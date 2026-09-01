/**
 * CATS-Net 3D 概念图 · Monochrome Precision HUD 视图
 *
 * 选型(骨架版,所有决策可逆):
 *   - three.js 0.170 (importmap CDN,后续可降级到 vendored)
 *   - 自写 3D 力导向(避免引入 d3-force-3d,行数差不多但零外部依赖)
 *   - 节点:细线框球(SphereGeometry + WireframeGeometry),大小 = activation
 *   - 边:LineSegments(causal 实线 / association 虚线 / hierarchical 点线)
 *   - 文字:Sprite + canvas texture(等宽字体)
 *   - 拖拽 / 缩放 / 暂停 / 层次过滤 / 激活阈值 / 节点 hover 详情
 *
 * 严格 Monochrome Precision:
 *   - 配色:仅 #050506 / #0a0a0b / #2a2a2c / #8a8a8e / #e6e6e6 五档灰阶
 *   - 严禁:渐变 / 玻璃拟态 / 发光 / 紫青色 / emoji
 *   - 切角:0 圆角,1px 边
 *
 * Scene Protocol 边界:本文件只做 f(scene),scene = { nodes, edges, layers } 纯数据,
 * 不向 backend 写任何东西,只读 /api/cats-net/graph(后续接入)。
 */

import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────
// 配色 token(Monochrome Precision HUD · 与 design-tokens.js 严格一致)
// ─────────────────────────────────────────────────────────────

const COLOR = Object.freeze({
  bg:          0x050506,
  surface:     0x0a0a0b,
  line:        0x2a2a2c,
  lineBright:  0x3a3a3c,
  text:        0xe6e6e6,
  textDim:     0x8a8a8e,
  textFaint:   0x555558,
  // 节点按层次分三档灰阶
  nodeAbstract:0xc8c8c8,
  nodeSemantic:0xa0a0a0,
  nodeEpisodic:0x707070,
})

const LEVEL_NODE_COLOR = Object.freeze({
  abstract: COLOR.nodeAbstract,
  semantic: COLOR.nodeSemantic,
  episodic: COLOR.nodeEpisodic,
})

// ─────────────────────────────────────────────────────────────
// 力导向参数(集中常量,便于调参)
// ─────────────────────────────────────────────────────────────

const FORCE = Object.freeze({
  repulsion:   220,   // 库仑斥力常数
  springLen:   18,    // 弹簧自然长度
  springK:     0.05,  // 弹簧劲度
  centerPull:  0.012, // 向中心回归
  damping:     0.86,  // 速度阻尼
  maxSpeed:    1.2,   // 限速防爆
  minDist:     6,     // 斥力最小距离(防 NaN)
  massScale:   0.6,   // 节点质量 = 1 + activation*massScale
})

const VIEW = Object.freeze({
  camDist:     80,
  camDistMin:  30,
  camDistMax:  200,
  rotSpeed:    0.0018,    // 自由旋转角速度
  rotXLimit:   Math.PI / 2.2,
  rotSpeedDecay: 0.94,
  nodeMinR:    1.2,
  nodeMaxR:    5.5,
})

// ─────────────────────────────────────────────────────────────
// 模拟数据(骨架阶段,后续替换为 /api/cats-net/graph)
// ─────────────────────────────────────────────────────────────

import { MOCK_CONCEPTS, MOCK_EDGES, computeLayerStats } from './mock-data.js'

// ─────────────────────────────────────────────────────────────
// 节点文字 sprite(等宽字体,canvas 一次性画贴图)
// ─────────────────────────────────────────────────────────────

function makeLabelSprite(text, dim = false) {
  const dpr = 2
  const fontSize = 22
  const padding = 8
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`
  const w = Math.ceil(ctx.measureText(text).width) + padding * 2
  const h = fontSize + padding * 2
  canvas.width = w * dpr
  canvas.height = h * dpr
  const c = canvas.getContext('2d')
  c.scale(dpr, dpr)
  c.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`
  c.textBaseline = 'middle'
  c.textAlign = 'center'
  c.fillStyle = dim ? '#8a8a8e' : '#e6e6e6'
  c.fillText(text, w / 2, h / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 4
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  const scale = 0.18
  sprite.scale.set(w * scale, h * scale, 1)
  return sprite
}

// ─────────────────────────────────────────────────────────────
// 单条边的线段(causal 实线 / association 虚线 / hierarchical 点线)
// 用 LineDashedMaterial 需要 computeLineDistances,这里直接用 Line + 灰阶颜色区分
// ─────────────────────────────────────────────────────────────

function makeEdgeLine(src, tgt, meta) {
  const geom = new THREE.BufferGeometry()
  const positions = new Float32Array([src.x, src.y, src.z, tgt.x, tgt.y, tgt.z])
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  // 边宽按 weight 缩放(0.4 ~ 1.6),底色一律灰阶,无 highlight
  const w = 0.4 + meta.weight * 1.2
  let mat
  if (meta.type === 'causal') {
    // 实线:稍亮(因果是主信号)
    mat = new THREE.LineBasicMaterial({ color: COLOR.textDim, linewidth: w, transparent: true, opacity: 0.7 })
  } else if (meta.type === 'hierarchical') {
    // 点线用 LineDashedMaterial,但需要 computeLineDistances
    mat = new THREE.LineDashedMaterial({ color: COLOR.lineBright, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.55 })
  } else {
    // association:虚线
    mat = new THREE.LineDashedMaterial({ color: COLOR.line, dashSize: 0.6, gapSize: 0.6, transparent: true, opacity: 0.5 })
  }
  const line = new THREE.Line(geom, mat)
  if (mat.isLineDashedMaterial) line.computeLineDistances()
  return line
}

// ─────────────────────────────────────────────────────────────
// 主类:渲染 + 力导向 + 交互
// ─────────────────────────────────────────────────────────────

export class CATSNetView {
  constructor(canvas, hud) {
    this.canvas = canvas
    this.hud = hud
    this.scene = null
    this.camera = null
    this.renderer = null
    this.group = null
    this.nodes = []      // { id, name, level, activation, position:Vector3, velocity:Vector3, mesh, label, baseR }
    this.edges = []      // { line, src, tgt, meta }
    this.index = new Map() // id -> node
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()

    this.rotX = -0.2
    this.rotY = 0
    this.velX = 0
    this.velY = 0
    this.camDist = VIEW.camDist
    this.isDragging = false
    this.prevPointer = { x: 0, y: 0 }
    this.hoverId = null
    this.selectedId = null

    this.minActivation = 0
    this.levelFilter = 'all' // all | abstract | semantic | episodic

    this.paused = false
    this.animFrame = null
    this._bound = []
  }

  async init(rawData) {
    this._setupRenderer()
    this._setupScene()
    this._setupEvents()
    this.setData(rawData ?? { nodes: MOCK_CONCEPTS, edges: MOCK_EDGES })
    this._animate()
  }

  // ── 渲染器 + 场景 ─────────────────────────────────────────

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power', // 与 hotspot-earth.js 一致,装饰场景不唤醒独显
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.renderer.setClearColor(COLOR.bg, 1)
  }

  _setupScene() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(COLOR.bg)
    this.scene.fog = new THREE.FogExp2(COLOR.bg, 0.012)
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500)
    this.camera.position.set(0, 0, this.camDist)
    this.camera.lookAt(0, 0, 0)
    this.group = new THREE.Group()
    this.scene.add(this.group)

    // 极细网格地面(20x20,1px 边),用 LineSegments 画
    const gridSize = 60
    const gridDiv = 20
    const step = gridSize / gridDiv
    const gridPts = []
    for (let i = 0; i <= gridDiv; i++) {
      const v = -gridSize / 2 + i * step
      gridPts.push(-gridSize / 2, -30, v, gridSize / 2, -30, v)
      gridPts.push(v, -30, -gridSize / 2, v, -30, gridSize / 2)
    }
    const gridGeom = new THREE.BufferGeometry()
    gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3))
    const gridMat = new THREE.LineBasicMaterial({ color: COLOR.line, transparent: true, opacity: 0.35 })
    const grid = new THREE.LineSegments(gridGeom, gridMat)
    this.scene.add(grid)
  }

  // ── 数据驱动:节点 + 边 ───────────────────────────────────

  setData({ nodes, edges }) {
    // 清空旧
    while (this.group.children.length) {
      const c = this.group.children.pop()
      c.geometry?.dispose()
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose())
        else c.material.dispose()
      }
    }
    this.nodes = []
    this.edges = []
    this.index.clear()

    // 球面均匀分布初始位置(避免力导向从中心炸开)
    const N = nodes.length
    nodes.forEach((n, i) => {
      const phi = Math.acos(1 - 2 * (i + 0.5) / N)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i
      const r = 26
      const position = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      )
      const velocity = new THREE.Vector3(0, 0, 0)

      const baseR = VIEW.nodeMinR + n.activation * (VIEW.nodeMaxR - VIEW.nodeMinR)
      const color = LEVEL_NODE_COLOR[n.level] ?? COLOR.textDim
      const sphereGeom = new THREE.SphereGeometry(baseR, 16, 12)
      const wireGeom = new THREE.WireframeGeometry(sphereGeom)
      const wireMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
      const mesh = new THREE.LineSegments(wireGeom, wireMat)
      mesh.position.copy(position)

      const label = makeLabelSprite(n.name, true)
      label.position.copy(position)
      label.position.y -= baseR + 3

      this.group.add(mesh)
      this.group.add(label)

      const node = { ...n, position, velocity, mesh, label, baseR, _filterAlpha: 1 }
      this.nodes.push(node)
      this.index.set(n.id, node)
    })

    // 边(去重:双向只画一次,按 id 字典序取 source)
    const seen = new Set()
    for (const e of edges) {
      const a = this.index.get(e.source)
      const b = this.index.get(e.target)
      if (!a || !b) continue
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const line = makeEdgeLine(a, b, e)
      this.group.add(line)
      this.edges.push({ line, src: a, tgt: b, meta: e, _filterAlpha: 1 })
    }
    this._updateHudStats()
  }

  // ── HUD 联动:stats / 过滤 ───────────────────────────────

  setLevelFilter(level) {
    this.levelFilter = level
    this._applyFilter()
  }

  setMinActivation(v) {
    this.minActivation = v
    this._applyFilter()
  }

  _applyFilter() {
    let visibleNodes = 0
    let totalActivation = 0
    const hiddenIds = new Set()
    for (const n of this.nodes) {
      const okLevel = this.levelFilter === 'all' || n.level === this.levelFilter
      const okAct = n.activation >= this.minActivation
      const visible = okLevel && okAct
      n._filterAlpha = visible ? 1 : 0
      n.mesh.visible = visible
      n.label.visible = visible
      if (visible) {
        visibleNodes++
        totalActivation += n.activation
      } else {
        hiddenIds.add(n.id)
      }
    }
    for (const e of this.edges) {
      const visible = !hiddenIds.has(e.src.id) && !hiddenIds.has(e.tgt.id)
      e.line.visible = visible
      e._filterAlpha = visible ? 1 : 0
    }
    this._updateHudStats(visibleNodes, totalActivation)
  }

  _updateHudStats(visibleNodeCount, totalActivation) {
    if (!this.hud) return
    const N = this.nodes.length
    const E = this.edges.length
    const visN = visibleNodeCount ?? N
    const visAct = totalActivation ?? this.nodes.reduce((s, n) => s + n.activation, 0)
    this.hud.statNodes.textContent = `${String(visN).padStart(2, '0')} / ${N}`
    this.hud.statEdges.textContent = `${String(E).padStart(2, '0')}`
    this.hud.statActivation.textContent = visAct.toFixed(2)
  }

  // ── 力导向(每帧跑) ──────────────────────────────────────

  _stepForces() {
    const rep = FORCE.repulsion
    const k = FORCE.springK
    const L0 = FORCE.springLen
    const cp = FORCE.centerPull
    const damp = FORCE.damping
    const minD = FORCE.minDist
    const maxV = FORCE.maxSpeed

    // 1) 节点间斥力(O(n²),n ≤ ~200 没事)
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i]
      if (a.mesh.visible === false) continue
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j]
        if (b.mesh.visible === false) continue
        const dx = a.position.x - b.position.x
        const dy = a.position.y - b.position.y
        const dz = a.position.z - b.position.z
        let d2 = dx * dx + dy * dy + dz * dz
        if (d2 < minD * minD) d2 = minD * minD
        const d = Math.sqrt(d2)
        const f = rep / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        const fz = (dz / d) * f
        a.velocity.x += fx
        a.velocity.y += fy
        a.velocity.z += fz
        b.velocity.x -= fx
        b.velocity.y -= fy
        b.velocity.z -= fz
      }
    }

    // 2) 边弹簧(只拉,目标长度按 weight 缩放)
    for (const e of this.edges) {
      if (e.line.visible === false) continue
      const a = e.src, b = e.tgt
      const dx = b.position.x - a.position.x
      const dy = b.position.y - a.position.y
      const dz = b.position.z - a.position.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001
      const target = L0 * (0.6 + (1 - e.meta.weight) * 0.8) // weight 越大越近
      const diff = d - target
      const f = k * diff
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      const fz = (dz / d) * f
      a.velocity.x += fx
      a.velocity.y += fy
      a.velocity.z += fz
      b.velocity.x -= fx
      b.velocity.y -= fy
      b.velocity.z -= fz
    }

    // 3) 中心回归 + 阻尼 + 积分
    for (const n of this.nodes) {
      if (n.mesh.visible === false) continue
      n.velocity.x -= n.position.x * cp
      n.velocity.y -= n.position.y * cp
      n.velocity.z -= n.position.z * cp
      n.velocity.x *= damp
      n.velocity.y *= damp
      n.velocity.z *= damp
      // 限速
      const v = Math.hypot(n.velocity.x, n.velocity.y, n.velocity.z)
      if (v > maxV) {
        const s = maxV / v
        n.velocity.x *= s
        n.velocity.y *= s
        n.velocity.z *= s
      }
      n.position.x += n.velocity.x
      n.position.y += n.velocity.y
      n.position.z += n.velocity.z
      n.mesh.position.copy(n.position)
      n.label.position.set(n.position.x, n.position.y - n.baseR - 3, n.position.z)
    }

    // 4) 边几何更新
    for (const e of this.edges) {
      if (e.line.visible === false) continue
      const pos = e.line.geometry.attributes.position
      pos.array[0] = e.src.position.x
      pos.array[1] = e.src.position.y
      pos.array[2] = e.src.position.z
      pos.array[3] = e.tgt.position.x
      pos.array[4] = e.tgt.position.y
      pos.array[5] = e.tgt.position.z
      pos.needsUpdate = true
    }
  }

  // ── 相机(自由旋转 + 缩放) ──────────────────────────────

  _applyCameraRotation(dt) {
    if (!this.isDragging) {
      this.rotY += VIEW.rotSpeed * dt
      this.velY *= VIEW.rotSpeedDecay
      this.velX *= VIEW.rotSpeedDecay
    }
    this.group.rotation.x = this.rotX
    this.group.rotation.y = this.rotY
  }

  // ── 主循环 ──────────────────────────────────────────────

  _animate = () => {
    this.animFrame = requestAnimationFrame(this._animate)
    if (this.paused) return
    const dt = 0.016
    this._stepForces()
    this._applyCameraRotation(dt)
    this._updateHover()
    this.renderer.render(this.scene, this.camera)
  }

  // ── 鼠标交互:拖拽 / 缩放 / hover ───────────────────────

  _setupEvents() {
    const onDown = (e) => {
      this.isDragging = true
      const p = this._pointer(e)
      this.prevPointer = { x: p.x, y: p.y }
      this.velX = 0
      this.velY = 0
    }
    const onMove = (e) => {
      const p = this._pointer(e)
      this.pointer.set(p.x, p.y)
      if (this.isDragging) {
        const dx = p.x - this.prevPointer.x
        const dy = p.y - this.prevPointer.y
        this.rotY += dx * 0.005
        this.rotX += dy * 0.005
        this.rotX = Math.max(-VIEW.rotXLimit, Math.min(VIEW.rotXLimit, this.rotX))
        this.velY = dx * 0.002
        this.velX = dy * 0.002
        this.prevPointer = { x: p.x, y: p.y }
      }
    }
    const onUp = () => { this.isDragging = false }
    const onWheel = (e) => {
      e.preventDefault()
      this.camDist += e.deltaY * 0.05
      this.camDist = Math.max(VIEW.camDistMin, Math.min(VIEW.camDistMax, this.camDist))
      this.camera.position.set(0, 0, this.camDist)
      this.camera.lookAt(0, 0, 0)
    }
    const onClick = (e) => {
      if (!this._didDrag) this._handleClick(e)
    }
    const onResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false)
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
    }
    const onVis = () => { this.paused = document.hidden }

    const c = this.canvas
    c.addEventListener('mousedown', onDown)
    c.addEventListener('mousemove', onMove)
    c.addEventListener('mouseleave', onUp)
    c.addEventListener('mouseup', onUp)
    c.addEventListener('wheel', onWheel, { passive: false })
    c.addEventListener('click', onClick)
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVis)
    // 触摸
    c.addEventListener('touchstart', (e) => { if (e.touches[0]) onDown(e.touches[0]) }, { passive: true })
    c.addEventListener('touchmove', (e) => { if (e.touches[0]) onMove(e.touches[0]) }, { passive: true })
    c.addEventListener('touchend', onUp)

    this._bound = [
      ['mousedown', onDown], ['mousemove', onMove], ['mouseup', onUp], ['mouseleave', onUp],
      ['wheel', onWheel], ['click', onClick], ['resize', onResize], ['visibilitychange', onVis],
    ]
  }

  _pointer(e) {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  _updateHover() {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const meshes = this.nodes.filter((n) => n.mesh.visible).map((n) => n.mesh)
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (hits.length > 0) {
      const hit = hits[0].object
      const node = this.nodes.find((n) => n.mesh === hit)
      if (node && this.hoverId !== node.id) {
        this.hoverId = node.id
        this._showHover(node)
        this.canvas.style.cursor = 'pointer'
      }
    } else if (this.hoverId !== null) {
      this.hoverId = null
      this._hideHover()
      this.canvas.style.cursor = 'grab'
    }
  }

  _showHover(node) {
    if (!this.hud) return
    this.hud.detail.style.display = 'block'
    this.hud.detailName.textContent = node.name
    this.hud.detailMeta.innerHTML = [
      `<span>${node.level.toUpperCase()}</span>`,
      `<span>·</span>`,
      `<span>${node.type}</span>`,
      `<span>·</span>`,
      `<span>act ${node.activation.toFixed(2)}</span>`,
      `<span>·</span>`,
      `<span>conf ${node.confidence.toFixed(2)}</span>`,
    ].join(' ')
  }

  _hideHover() {
    if (!this.hud) return
    this.hud.detail.style.display = 'none'
  }

  _handleClick(e) {
    const p = this._pointer(e)
    this.pointer.set(p.x, p.y)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const meshes = this.nodes.filter((n) => n.mesh.visible).map((n) => n.mesh)
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (hits.length > 0) {
      const hit = hits[0].object
      const node = this.nodes.find((n) => n.mesh === hit)
      if (node) this._emitIntent('select', node)
    } else {
      this._emitIntent('background', null)
    }
  }

  _emitIntent(name, node) {
    // 严格 Scene Protocol:UI 不直接调 backend,只把意图通过 callback 上行
    if (typeof this.onIntent === 'function') {
      this.onIntent({ name, surface: 'cats-net', data: node ? { id: node.id, name: node.name, level: node.level } : null, ts: Date.now() })
    }
  }

  // ── 公开控制 ─────────────────────────────────────────────

  pause() { this.paused = true }
  resume() { this.paused = false }
  dispose() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame)
    for (const [ev, fn] of this._bound) {
      if (ev === 'resize') window.removeEventListener(ev, fn)
      else if (ev === 'visibilitychange') document.removeEventListener(ev, fn)
      else this.canvas.removeEventListener(ev, fn)
    }
    this.renderer.dispose()
  }
}
