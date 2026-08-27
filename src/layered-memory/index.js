/**
 * 记忆系统 —— 统一导出入口
 *
 * 提供三层记忆（工作/短期/长期）与编排器，供上层业务模块引用。
 * 与 CATS-Net 的对接通过 MemoryManager 构造注入 catsNet 实例完成（依赖方向 memory → cats_net）。
 *
 * 说明：本模块迁入主体时目录命名为 src/layered-memory/（避让主体已有的 src/memory
 * 记忆子系统），类名与导出保持不变。
 */

export { WorkingMemory } from './working-memory.js'
export { ShortTermMemory } from './short-term-memory.js'
export { LongTermMemory } from './long-term-memory.js'
export { MemoryManager, MEMORY_FORMAT, MEMORY_VERSION } from './memory-manager.js'