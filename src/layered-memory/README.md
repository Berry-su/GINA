# 记忆系统模块（已迁移进主体）

Gina Agent 的三层记忆系统，实现「工作记忆 / 短期记忆 / 长期记忆」分层与巩固流水线，
并委托 CATS-Net 抽象空间完成语义投影。

> 迁入说明：本模块原位于新 Gina 的 `src/memory/`，迁入主体时目录命名为 `src/layered-memory/`
> 以避让主体已有的 `src/memory/`（记忆子系统）；类名与导出保持不变。

- 工作记忆：小容量、快速遗忘，保存当前任务上下文
- 短期记忆：中等容量/遗忘，保存近期情节
- 长期记忆：大容量、慢遗忘，保存巩固后的知识（含抽象空间链接）
- 编排器 MemoryManager：跨层检索、巩固、持久化、紧急终止

用法：

```js
import { MemoryManager } from './index.js'
import { CatsNet } from '../cats_net/index.js'

const brain = new CatsNet()
const memory = new MemoryManager({ catsNet: brain })

memory.addObservation({ content: '市场下跌', concepts: ['market_drop'], importance: 1 })
memory.shiftToShortTerm()
memory.consolidate({ minStrength: 0.6 })
```