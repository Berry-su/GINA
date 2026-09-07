# GINA UI 重新设计工作流

**版本**：v0.2（9-07 20:13，老板拍板 6 步 skill 工作流）
**目标**：推翻 72K 旧 UI → 按纪律重做 → UI 完工 → 开源面世
**范围**：GINA 项目主仓 `src/ui/` 重做（私仓，9-07 14:54 老板拍 UI 完工后 public）

---

## 0. 顶层纪律（红线 / 一次拍板终身执行）

| # | 规则 | 出处 |
|---|---|---|
| 🔴 | **任何动作前必须问，老板同意才动** | 9-07 01:46 翻身纪律 |
| 🔴 | **不出残次品 / 简化版 / "先出个给你看"** | 9-07 01:46 教训 |
| 🔴 | **不默认紫罗兰色**（色板老板拍） | 9-07 凌晨 否决 |
| 🔴 | **不默认中心元素**（能量球是开放选项） | 9-03 v1/v2 被否 |
| 🔴 | **设计阶段绝对不动 `src/ui/`** | 9-03 06:10 流程 |
| 🔴 | **不双轨并行**（设计 vs 迁移） | 9-03 06:10 老板拍 |
| 🔴 | **不平行派 worker 出图猜** | 9-07 5 轮全否教训 |
| 🔴 | **GitHub 私仓 → UI 完工后 public** | 9-07 14:54 |
| 🔴 | **官网 / 移动 app / 融资材料 = UI 完工后** | 9-02 23:19 |
| 🔴 | **em-dash 0 容忍**（— 全 ban） | design-taste-frontend v2 §9.G |

---

## 1. 工具栈：6 个 skill 工作流（老板 9-07 20:13 拍板）

**全部已装到 `/Users/ahs/.minimax/skills/`，Mavis 全部能识别。**

### 6 步角色（按老板列的编号 + 实际触发顺序）

| # | Skill | 角色 | 触发时机 | 输出 |
|---|---|---|---|---|
| 1 | **ui-ux-pro-max** | 开局定方向 | Phase 0 → Phase 1 | 3 套设计系统（pattern / style / 色板 / 字体 / UX 规则） |
| 2 | **design-taste-frontend** | 落地页视觉审美 | Phase 2-3 出 mock | 落地页 / 品牌页 / 作品集 mock（**反 slop** 哲学） |
| 3 | **interface-design** | 产品页面 + 记性好 | Phase 3-5 产品页 | Linear / Vercel / Stripe / Apple 级产品页 + 状态管理 |
| 4 | **impeccable** | 做完检查 | Phase 3 / Phase 5 每次完成 | em-dash / slop / a11y / WCAG / 性能 全 audit |
| **5** | **finesse-brief** | **先写 workbench spec** | **Phase 0 必做** | `.workbench/spec.md`（11 种结构、hook、cold-start、模块） |
| **6** | **finesse-ui** | **按 spec 生成有层级有质感的页面** | **Phase 1-5** | 控制台 / 工作台 / dashboard（**AI-workbench layer 完美匹配 GINA**） |

### 6 步工作流触发顺序（**修正老板列号**）

> **finesse-brief (#5) 必须在所有 UI 之前**——它定义"这是什么"，没 brief 写代码就是空中楼阁。
> **impeccable (#4) 在最后审计**——不是中段。

```
Phase 0（方向）   1 ui-ux-pro-max    → 3 套设计系统候选
                  5 finesse-brief    → .workbench/spec.md（产品定义）
                  老板拍 1 套设计系统 + 1 个 brief
        ↓
Phase 1（参考图）  老板发 5-10 张参考 + 关键词
                  search.py 推设计系统
        ↓
Phase 2（草图）    2 design-taste-frontend → 落地页 mock（landing / brand / portfolio）
                  6 finesse-ui           → 控制台 mock（console / dashboard / wizard）
                  老板选 1 套
        ↓
Phase 3（高保真）  3 interface-design    → 产品页 + 多状态 + 记忆
                  老板完全敲定（"可以开始迁移"）
        ↓
Phase 4（设计系统） design tokens + 组件库
        ↓
Phase 5（迁移）    1 个功能 1 个 commit
                  4 impeccable         → 每次完成全 audit（em-dash / slop / a11y / WCAG）
        ↓
Phase 6（开源）    旧 UI 删 + 全套 627 测试 + GitHub private → public
                  4 impeccable         → 终审
```

### 6 个 skill 各自的强项

| Skill | 强项 | GINA 怎么用 |
|---|---|---|
| **ui-ux-pro-max** | 84 风格 / 192 色板 / 22 栈 / 99 UX 规则 + `search.py` 推理引擎 | Phase 0 输入方向词 → 3 套设计系统 |
| **design-taste-frontend** | 反 AI slop + 3 dial（VARIANCE / MOTION / DENSITY）+ 14 节 pre-flight | Phase 2 落地页 / 品牌页 |
| **interface-design** | Linear / Vercel / Stripe / Apple 级产品 UI craft | Phase 3-5 产品页 / dashboard |
| **impeccable** | award-winning design director 视角 + 全维度 audit | Phase 3 / 5 / 6 审计 |
| **finesse-brief** | Workbench Architect，11 种结构（cycle / ledger / state / runbook / feed / care / operation / pipeline / registry / console / monitor）| Phase 0 必做——定义"这是什么" |
| **finesse-ui** | 多 register（brand / product / workflow / commerce / h5）+ AI-workbench layer（run stream / 9 跑状态 / stop / approval / cost receipt）| Phase 1-5 控制台 / 工作台 / dashboard |

### 跟 GINA 627 测试套件的契合

GINA 现在有 627 测试，**finesse-ui 的 AI-workbench layer 几乎一对一匹配**：

- **run stream** ↔ `src/perception/`（地理 / 天气 / 实时视野 / 情绪 / 台风）
- **9 跑状态** ↔ `src/anticipation/`（预判 / 主动 / 控制器）
- **in-stream approval cards** ↔ `src/analyst/`（A/B 测试 / 元学习 / 代码自修改 gate）
- **cost receipt** ↔ `src/memory/importance-decay.js` + `evolution-gate.js`（重要性 + 防垃圾两道门）
- **resident stop control** ↔ `src/self-modify/`（编辑器回滚 + git revert）
- **5 维情绪** ↔ `src/emotion/emotion-state.js`（**仅 meta-info 显示，不进决策路径**）

finesse-ui 的设计模式跟 GINA 现有架构**几乎不需重写逻辑，只重写 UI 呈现**。

---

## 2. 阶段门（**不串行不动**）

### **Phase 0：方向定义**

| 项 | 说明 |
|---|---|
| 目标 | (a) 敲定 3 个根本问题：**给谁看 / 第一秒感受 / 调性**；(b) `finesse-brief` 写 `.workbench/spec.md` |
| 工具 | 文字对话 + ui-ux-pro-max + finesse-brief |
| 产出 | `docs/UI-DECISIONS.md` + `.workbench/spec.md` |
| 门 | 老板书面 GO（设计系统 + brief 都拍） |

### **Phase 1：参考图收集**

| 项 | 说明 |
|---|---|
| 目标 | 老板发 5-10 张认可的参考图 + `search.py` 推 3 套候选设计系统 |
| 工具 | 老板截图 / mcode-tools / browser / search.py |
| 产出 | `docs/ui-redesign/REFERENCES.md` + 3 套设计系统对比 |
| 门 | 老板敲定 1 套设计系统 + 5-10 张参考 |

### **Phase 2：静态草图（多方向对比）**

| 项 | 说明 |
|---|---|
| 目标 | 2-4 个**完全不同的方向**对比（mock A/B/C/D） |
| 工具 | design-taste-frontend（落地页）+ finesse-ui（控制台） + browser 截图 |
| 产出 | `docs/ui-redesign/MOCKUPS-v1/mock-A.html` ... mock-D.html + 截图 |
| 门 | 老板敲定 1 个方向 |

### **Phase 3：高保真原型**

| 项 | 说明 |
|---|---|
| 目标 | 完整 HTML，包含**所有界面 + 所有状态**（空 / 加载 / 错误 / 满 / 移动端） |
| 工具 | interface-design（产品页 craft）+ finesse-ui（控制台 AI-workbench layer） + browser 截图 |
| 产出 | `docs/ui-redesign/PROTOTYPE-v1/` + impeccable 初审 |
| 门 | 老板**完全敲定**（原话："可以开始迁移"）+ impeccable 审计过 |

### **Phase 4：设计系统沉淀**

| 项 | 说明 |
|---|---|
| 目标 | design tokens + 组件库文档 + `src/ui-v2/` 脚手架（**暂不启用**） |
| 工具 | Mavis 写 docs + search.py 验证 |
| 产出 | `docs/ui-redesign/DESIGN-SYSTEM.md` + `src/ui-v2/tokens.css`（不引入） |
| 门 | 老板敲定 |

### **Phase 5：迁移（1 个功能 1 个功能）**

| 项 | 说明 |
|---|---|
| 目标 | 从 `src/ui/` 逐个功能迁到 `src/ui-v2/`，迁完从 `src/ui/` 删 |
| 工具 | Mavis 写代码 + 627 测试 + browser 自测 + impeccable 审计 |
| 产出 | 每个功能 1 个 commit + 测试 100% pass + impeccable pass |
| 门 | **每个功能老板签字 + impeccable 通过才开下一个**（不批量） |

### **Phase 6：回归 + 开源面世**

| 项 | 说明 |
|---|---|
| 目标 | `src/ui/` 删空 + 全套 627 测试过 + GitHub private → public |
| 工具 | 全套测试 + impeccable 终审 + 老板亲自试 |
| 产出 | 旧 UI 删除 + 1 个 release commit + GitHub public |
| 门 | **老板亲自签收** |

---

## 3. 沟通协议

每阶段交付物必有：
1. **产出物路径**（老板可查）
2. **决策点**（GO / NO GO / 选 X / 改 Y）
3. **依据**（引用 ui-ux-pro-max 哪条规则、finesse-brief 哪个 spec 段、impeccable 哪条 audit、老板哪条决定）

Mavis **不自动推进阶段**。老板 GO 才动。

---

## 4. 反模式清单（终身禁）

- ❌ "先出个版给你看"
- ❌ mcode-tools 5 张图让老板挑（**改成**：ui-ux-pro-max 推 3 套设计系统 + finesse-brief 写 spec，**我自己**对每套做评估，老板只选 1 套）
- ❌ 默认紫罗兰 / 默认能量球 / 默认任何风格
- ❌ 跳过阶段门
- ❌ 设计阶段改 `src/ui/`
- ❌ 批量迁移（必须 1 个功能 1 个签收 + impeccable 审计）
- ❌ **em-dash**（— 全 ban，design-taste-frontend §9.G）
- ❌ **Inter 默认**（design-taste-frontend §4.1）
- ❌ **3 段 zigzag 重复**（design-taste-frontend §4.7）
- ❌ **3 个等宽 feature cards**（design-taste-frontend §4.7）
- ❌ **div 假截图**（design-taste-frontend §4.8）
- ❌ **"V0.6 / BETA" 标在 hero**（design-taste-frontend §9.F）
- ❌ **scroll cue 文字**（design-taste-frontend §9.F）
- ❌ **decoration 文字条**（design-taste-frontend §9.F）
- ❌ **"Quietly in use at" 假谦卑**（design-taste-frontend §9.F）

---

## 5. 跟其他决策的联动

- ✅ **9-07 17:22 老板纠错"检测台风不是地方性"** → 新 UI 不要再带"汕尾"等老板城市硬编码
- ✅ **9-02 23:19 排期** → UI 完工才动官网/app/融资材料
- ✅ **emotion-isolation（ADR-002）** → 新 UI 集成 emotion 模块时**不进决策路径**，只 meta-info 显示
- ✅ **9-07 14:54 私仓** → UI 完工才 public
- ✅ **凭证措辞纪律（9-02）** → 接 Figma/Linear 等外部服务不向老板要明文密码
- ✅ **9-07 20:13 6 skill 工作流** → 本文档 §1

---

## 6. 度量

| 阶段 | 至少要回答 |
|---|---|
| Phase 0 | GINA 给谁看 / 第一秒让人感受什么 / 调性你拍 + .workbench/spec.md 11 段齐全 |
| Phase 2 | 每个 mock 用了哪个 design system / 哪个参考图 / 偏离了老板哪条决定为什么 |
| Phase 3 | 所有界面 / 所有状态 / 移动端 / 暗色 / 无障碍 / impeccable 初审过 |
| Phase 5 | 1 个功能 1 个 commit + 测试 + 老板签字 + impeccable 审计 |
| Phase 6 | 旧 UI 删 + 全套测试 + impeccable 终审 + GitHub public + 老板签收 |

---

## 7. 当前 TODO

- [ ] **老板回答 Phase 0 三问**（一次性）
- [ ] Mavis 用 `finesse-brief` 写 `.workbench/spec.md`（11 段：purpose / subject / hook / cold-start / first screen / modules / entities / MVP / visual / revenue / handoff）
- [ ] Mavis 用 `ui-ux-pro-max search.py` 推 3 套设计系统
- [ ] 老板 GO 进入 Phase 1

---

## 8. 文件落地

- 本工作流：`docs/UI-REDESIGN-WORKFLOW.md`
- 阶段产出物目录：`docs/ui-redesign/`（未来按 Phase 创建子目录）
- 决定记录：`docs/UI-DECISIONS.md`
- 产品 spec：`.workbench/spec.md`（finesse-brief 输出）
- 未来代码脚手架：`src/ui-v2/`（**Phase 4 才创建**）

---

## 9. 变更日志

| 版本 | 日期 | 改动 |
|---|---|---|
| v0.1 | 9-07 19:35 | 初稿（角色 + 阶段门） |
| v0.2 | 9-07 20:13 | 老板拍板 6 个 skill 工作流，替换 §1 工具栈；增加 skill 跟 GINA 627 测试的契合映射；增加 §1.1 触发顺序修正（finesse-brief 必须在所有 UI 之前）|
