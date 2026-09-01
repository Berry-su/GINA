# CATS-Net 3D 概念图 · 骨架

> Monochrome Precision HUD 风格的 CATS-Net 概念球可视化骨架(半天内交付,只做骨架 + 选型 + 模拟数据,未接真实 backend)。

## 路径

| 文件 | 作用 |
|------|------|
| `cats-net.html` (顶层) | 入口 HTML,集成 canvas + HUD chrome + 控件 |
| `src/ui/cats-net/cats-net.js` | 主类 `CATSNetView`(渲染 + 力导向 + 交互) |
| `src/ui/cats-net/cats-net.css` | 辅助 CSS(Monochrome Precision 规范) |
| `src/ui/cats-net/mock-data.js` | 10 概念 + 15 边模拟数据,与 backend `getConceptSphereData()` 同构 |
| `src/api/routes/static.js` | 加 3 个路由:`/cats-net` + `/cats-net.html` + `/src/ui/cats-net/*` 资源 |
| `src/paths.js` | 加 2 个常量:`catsNetHtml` + `catsNetAssetRoot` |

## 启动

dev 模式:
```bash
pnpm dev          # 启动后端 3721
# 浏览器打开
http://127.0.0.1:3721/cats-net
```

## 选型(对比 Mavis 推荐)

| 选项 | 选择 | 理由 |
|------|------|------|
| **3D 库** | three.js 0.170 (importmap CDN) | 已有 vendored 副本 + hologram-core-demo 实战;React 仓不存在,three-forcegraph 不可用 |
| **力导向** | **自写**(O(n²) 库仑斥力 + 弹簧 + 中心回归) | d3-force-3d 未 vendored,n ≤ 200 完全够用,行数差不多但零外部依赖 |
| **节点** | `WireframeGeometry(SphereGeometry)` + `LineBasicMaterial` | 严格 Mono:线框 + 灰阶,无 emissive / 无 glow |
| **边** | `Line` + `LineBasicMaterial` / `LineDashedMaterial` | causal 实线 / hierarchical 点线 / association 虚线,按 weight 控透明度 |
| **文字** | `Sprite` + canvas texture | 等宽字体一次画贴图,无 HTML overlay 风险 |
| **拖拽/缩放** | 自写(参考 hotspot-earth.js) | 类骨架 + rotX 锁 ±π/2.2 + 惯性衰减 + 触屏三件套 |
| **暂停** | `paused` 标记 + `visibilitychange` 联动 | 防止隐藏时 GPU 空转(注释里说"装饰场景不唤醒独显") |

## UI 控件(全部硬约束 Monochrome)

- **顶栏**:TITLE + 层次过滤 4 按钮(all/abstract/semantic/episodic) + 激活阈值滑块 0-1 step 0.05
- **侧栏**:节点详情(hover/click 显示,name + level + type + activation + confidence)
- **底部**:NODES(visible/total)/ EDGES / TOTAL ACTIVATION / FILTER / CAMERA 实时
- **图例**:causal / association / hierarchical 三种边类型(右下)
- **回 brain-ui 按钮**:左上角

## 严格遵守

- **配色**:仅 #050506 / #0a0a0b / #2a2a2c / #8a8a8e / #e6e6e6 + 节点三档灰阶(#c8c8c8 / #a0a0a0 / #707070)
- **切角**:所有面板 `clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)`
- **圆角**:**0**(禁止 `border-radius: 2px+`,design-tokens.js 的 FORBIDDEN_PATTERNS 死线)
- **字体**:数字 / 标签用 `ui-monospace, SFMono-Regular, Menlo`,正文用 `ui-sans-serif, system-ui`
- **禁项**:无 gradient / 无 backdrop-filter / 无 box-shadow 发光 / 无紫青 / 无 emoji
- **Scene Protocol 边界**:本视图只读 `scene = { nodes, edges, layers }` 纯数据,无任何 backend 写入;交互走 `_emitIntent` callback 上行,不在本视图内发命令

## API 列表(给 gina-coder)

backend 需暴露:
```
GET /api/cats-net/graph?level=episodic|semantic|abstract&minActivation=0.3
→ { nodes, edges, layers }
```
完全复用 `ConceptNode.getConceptSphereData()` 的输出 schema,前端零改动。

可选:走 Scene Protocol(`ws://127.0.0.1:3721/scene`,kind=`cats-net-graph`)实时推送激活值变化,前端需扩展 `setData` 为 `updateActivation(id, value)`。

## 已知偏差(待老板拍板)

1. **概念层次 = 3 层**(`episodic` / `semantic` / `abstract`),任务里说 L0/L1/L2/L3 4 层;以 backend 现状为准,UI 已经按 3 层落
2. **cockpit 整合**:现有 `main-hud.html` 还是青蓝冷色调(全息风),未做 Monochrome 重做;新页面强制 Mono,两者视觉断层需要老板拍板:
   - (a) 把 cockpit 也整体重做 Mono(工作量 +0.5 天)
   - (b) 接受 cockpit 冷色 + CATS-Net 单色并存(差异化,但跨页跳会有割裂感)
   - (c) 给 cockpit 跟 cats-net 做转场动画过渡(最优但最慢)
3. **importmap CDN 模式**:离线启动会失败;`hotspot-earth.js` 有完整三段 fallback(local → CDN → unpkg),后续可平移过来
4. **力导向规模**:当前 O(n²) 在 n ≤ 200 时流畅;若 CATS-Net 节点爆炸到 1000+,需改 Barnes-Hut 四叉树(半天工作量)
5. **Scene Protocol 接入**:`_emitIntent` 暂只 console.log,需接 WS → core
