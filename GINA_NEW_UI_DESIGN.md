# Gina 全新 UI 设计方案 · A-P2

> 主线项目 A · 阶段 P2 · 2026-08-28
> 目标：为 Gina（Electron 通用型 Agent）设计一套**顶级审美**、**面向融资演示**、且**不破坏现有核心**的新 UI。
>
> 建立基础：`Agent-驱动UI-设计方案.md`（UI=f(scene)）+ `SCENE-PROTOCOL.md`（v1 协议）+ `src/ui/scene-shell/`（已有渲染端雏形）+ `src/ui-design/design-tokens.js`（设计 token 系统）。

---

## 一、核心决策（一句话）

**在已有的声明式 `scene-shell` 之上，用 React + Vite 构建新壳 `apps/web`，替换 6584 行无组件化的老 `brain-ui`。** 核心零改动，重做的是"投影函数"，不是 Agent。

三条铁律（来自现有设计文档，必须遵守）：
1. core 里搜不到任何 CSS / 像素 / DOM / 动画。
2. UI 里搜不到任何业务逻辑。
3. 两端只通过「场景状态 + 用户意图」对话。

---

## 二、视觉语言（高级审美，已定稿）

### 2.1 设计方向：赛博霓虹 · 午夜实验室 · 数字灵魂舱
以 Gina 的形象设计语言为统一母题（银白 + 异色瞳 + 机能风），配合桌面端"窥见 AI 灵魂"的质感。

### 2.2 调色板（灵感来源：形象图 + 现有 HOLOGRAM_BLUE token）

| 用途 | 色值 | 说明 |
|------|------|------|
| 背景（bg） | `#05060a` | 午夜黑，带极淡蓝 |
| 表面（surface） | `rgba(12,20,34,0.72)` | 半透明面板 |
| 表面亮（surfaceAlt） | `rgba(16,28,48,0.85)` | 悬浮层 |
| 主描边（line） | `rgba(120,160,255,0.25)` | 细线，非发光 |
| 霓虹紫（accent） | `#9a6cff` | Gina 右眼紫 · 语义"思考/中心" |
| 霓虹青（accent2） | `#39e0ff` | Gina 左眼青（发光）· 语义"在线/活跃" |
| 银白文本（text） | `#e8edf6` | 主体文字 |
| 次级文本（textDim） | `#7a86a0` | 说明文字 |
| 微弱文本（textFaint） | `#3d465a` | 标签、装饰 |
| 危险（danger） | `#ff4d5e` | 错误 / 风险 |
| 成功（ok） | `#3ddc97` | 完成 / 健康 |

> ⚠️ 规避"廉价 AI 感"（沿用现有 `FORBIDDEN_PATTERNS`）：**禁用**大面积渐变、玻璃拟态(backdrop-blur)、青紫对角渐变 hype 风、大圆角卡片。霓虹只用**点缀**（一条线、一个光点、一处 glow），不做满屏发光。

### 2.3 字体
- 标题/标签：`system-ui`，字重 600，全大写 + 0.08em 字距（精密仪器感）
- 数值/数据：`ui-monospace, SFMono-Regular, Menlo, monospace`（等宽，终极数据感）
- 正文：`system-ui`，400

### 2.4 造型语言
- **切角（cut corner）+ 近零圆角**：拒绝大圆角卡片，保留"精密硬件"质感。
- 细 1px 描边 + 微弱内发光，分区用分割线（divider）而非大色块。
- 动效：`enter`/`exit`/`morph` 三段动画，缓动用 `cubic-bezier(0.16,1,0.3,1)`（高级缓动），共享元素转场（同一 id 跨帧追踪）。

---

## 三、信息架构（界面清单）

主窗（`apps/web` 单页应用），通过 WebSocket `/scene` 接收状态、按 `intent` 分区呈现。屏幕不是"固定模板"，而是 Agent 声明的 surface 的投影。

### 3.1 全局区域（Stage 舞台）

```
┌────────────────────────────────────────────────────────────┐
│  TopBar（顶栏）：品牌标识 · 连接状态点 · 时钟 · 系统状态      │
├────────────────────────────────────────────────────────────┤
│                                                             │
│              CENTRAL STAGE（中央舞台）                       │
│      = scene 的 confront / inform surface 作主投影           │
│      · 对话气泡流 · 决策卡 · 关键数值(metric) · 选择卡        │
│                                                             │
├────────────────────────────┬───────────────────────────────┤
│  LEFT RAIL（左栏）          │  RIGHT RAIL（右栏）            │
│  ambient 信息 · 记忆图      │ · 意识状态(心跳/波形)           │
│  · 热点/地球 · 任务清单      │ · 思维流(thought-stream)        │
│                            │ · 工具调用日志                 │
└────────────────────────────┴───────────────────────────────┘
          BOTTOM（输入区）：文本输入 · 语音按钮 · 快捷意向
```

### 3.2 Surface 分区（intent → 落位）

| intent | 落位 | 表现 |
|--------|------|------|
| `confront` | 中央舞台，居中放大 + 压暗背景 | 用户必须停下来看/做决策（choice 卡、聚焦对话） |
| `inform` | 中央舞台常规位 或 右栏 | 一般信息卡，常规入场 |
| `ambient` | 左栏 / 角落 | 微妙淡入、低饱和、呼吸感，不抢焦点 |

### 3.3 需要的 kind（扩充现有词汇表）

**内容 kind（核心，必须做）：** `text` `metric` `image` `media` `choice` `form` `progress`

**领域 kind（本产品特色，重点打磨）：**
- `consciousness`：意识循环可视化——心跳波形 + 状态徽标（idle/thinking/speaking/awakening）+ 能量核心
- `memory-graph`：记忆力导向图（D3），展现 Agent 记忆拓扑 + 检索高亮
- `thought-stream`：思维流（token 级流式大脑活动的电影化呈现，Gina 最惊艳的卖点）
- `tool-log`：工具调用时间线（Agent 正在"做什么"）
- `hotspot-earth`：3D 地球（three.js）+ 区域热点
- `person-card`：人脉卡片
- `pet`：**接入 Q版 Gina 3D 宠物**（项目 B 产出，作为角色化 UI 元素——项目 A 的 P4）

**排版原语（全部 v1 必备）：** `stack` `row` `col`

---

## 四、关键场景剧本（融资演示叙事线）

A-P3 实现时按"叙事"打磨，让融资演示有节奏、有高潮：

1. **启动觉醒（awakening）**：自检 progress → 意识循环上线 → 能量球点亮 → Q版 Gina 桌宠破屏而出（confront 高潮）。
2. **对话=灵魂注入**：用户提问 → thought-stream 字幕式滚动 → 思考中(thinking) → 回应落 card。
3. **主动出击（proactivity）**：Agent 主动推送 ambient 卡片（天气/日程/记忆关联），体现"数字生命"的自主性。
4. **决策时刻（confront）**：Agent 抛 choice 让用户拍板——体现"协作决策"而非"被指挥"。
5. **记忆回溯**：点击记忆图节点 → morph 展示该记忆的完整上下文 → 体现"有自我"。
6. **能力爆发**：展示工具调用（联网/分析/浏览器）tool-log 时间线 → 体现"通用能力"。

---

## 五、技术落地

### 5.1 新壳 `apps/web`（React + Vite）
- `GINA_UI_URL` 已预留（localhost:5173）。`main.cjs` 检测到它则加载新 UI。
- Vite dev 代理 `/scene`、`/api`、`/events` 到 `127.0.0.1:3721`。
- 纯投影、无业务逻辑；场景状态从 `/scene` 来，意图经 `sendIntent` 上行。

### 5.2 渲染层复用
- 直接复用 `scene-shell/client.js`（WS 握手/重连/间隙检测/resync）+ `shell.js`（diff/enter/exit/morph 调度），改造为 React 组件化。
- kinds 用 React 重写（每个 kind 一个组件，内聚 `enter/exit/morph` 动画）。
- 领域 kind（consciousness/thought-stream/memory-graph/hotspot-earth）新增，用 D3 + three.js。

### 5.3 与 `src/ui-design/` 管线衔接
- 用 `design-tokens.js` 定义本方案 token（新增 `GINA_CYBER` token 集），`checkSpec` 校验，`spec-codegen` 可生成基础 React 骨架——但**关键 kind 需要手工精雕**，因为电影级动画靠设计调出来，不是 LLM 拼的。

---

## 六、里程碑（A-P3 拆分）

| 子阶段 | 内容 | 验收 |
|--------|------|------|
| A-P3-1 | apps/web 脚手架 + WS 连 `/scene` + 最简投影 | 能收到 scene、渲染 text/metric |
| A-P3-2 | 排版原语 + 核心内容 kind（text/metric/image/choice/form/progress） | 长尾内容可渲染 |
| A-P3-3 | 领域 kind：consciousness / thought-stream / tool-log | 意识循环可视化上线 |
| A-P3-4 | memory-graph（D3）+ hotspot-earth（three.js） | 记忆拓扑 + 3D 地球 |
| A-P3-5 | 接入 Q版 Gina 3D 宠物（P4，依赖项目 B）+ 角色化联动 | 桌宠成为 UI 元素 |
| A-P3-6 | 融资演示模式：6 个剧本章节 + 性能打磨 | 完整演示叙事 |

---

## 七、风险与边界

- **不碰老 brain-ui**：新 UI 是另一个 shell，老 brain-ui 可并行保留，直至新壳稳定。
- **协议是根基**：只加 kind / intent.name / caps（向后兼容），不改既有字段语义。
- **动画质量是护城河**：kind 的三段动画必须人工精调，这是"电影级"与"模板感"的分水岭。

---

*导演只管换景，运镜交给 production。* —— 本方案遵循现有设计哲学落地。
