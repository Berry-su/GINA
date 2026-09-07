# ADR-002: 情绪是 meta-info，不进决策路径（2026-08-31）

## 状态
**已采用** · 2026-08-31 老板拍板（最初版） → 2026-09-07 老板拍板"多维但仍不接决策路径"（更新）

## 背景
GINA 的情绪系统面临一个根本问题：情绪要不要进决策路径？进 = 模拟人（更"活"），不进 = 更可控（不失控）。

## 决策
**情绪（emotion）= meta-info 层，tool/决策调用链路上读不到 emotion。**

### 2026-08-31 原始决策
- 维度：只 joy 一个
- 范围：0-1 浮点
- 隔离：严格不进 tool schema / system prompt 决策指令 / analyst 评分 / 风控官判定
- 唯一注入出口：buildContextBlock 的 `<emotional-state>` 段

### 2026-09-07 推翻（部分）
老板推翻"只 joy 一个"决策，升级为 **5 维内部情绪**：
- satisfaction（满足度，与原 joy 同步）
- curiosity（好奇心）
- confidence（自信度）
- engagement（投入度）
- fatigue（疲劳度）

但**仍严守 meta-info 隔离**（老板原话："不要可以影响判断和决策"）：
- 情绪值只读出口：仅 `EmotionState.injectFor()` 渲染到对话/日志
- 任何 tool/decision 函数拿不到 emotion 值
- 写只能由 emotion-state 内部规则触发

## 后果
### 正面
- 隔离保证由 `tests/test-emotion-state.js` 4 个 isolation 测试在 CI 中验证
- 静态扫描：`emotion-state.js` 0 个 tool/decision/analyst/router import
- snapshot 是纯数据，不暴露方法
- injectFor 输出显式声明 "meta-info, 不进决策路径"

### 负面
- 失去了"用情绪影响回应风格"的灵活性（但这是有意的取舍）

## 实现
- `src/emotion/joy-state.js`（保留，1 维向后兼容）
- `src/emotion/emotion-state.js`（5 维，9-07 新增）
- `src/emotion/index.js`（barrel）
- `tests/test-emotion-state.js`（24/24 测试 + 4 个 isolation 测试）

## 关联
- ADR-001 CATS-Net 大脑架构：情绪是 8 大层 emotion 层的一部分
- ADR-015 自进化 5 项：元学习决策不读 emotion（验证隔离）

## 维护者
- @Berry.Su
- 评审：gina-arch
- 最后更新：2026-09-07
