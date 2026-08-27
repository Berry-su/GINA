# MemGPT / Letta 分层记忆 —— 学习笔记

**日期**: 2026-08-04  
**来源**: arXiv:2310.08560《MemGPT: Towards LLMs as Operating Systems》(UC Berkeley, 2023)  
**后续框架**: Letta (lett.ai / letta.com)，MemGPT 的商业化演进

---

## 一、核心问题

LLM 的上下文窗口是固定长度的。扩展对话、长文档分析等场景中，窗口很快被撑爆。现有方案（滑动窗口、截断）直接丢失信息，Recurrent Memory Transformer 之类的方法又不够通用。

## 二、核心思想：虚拟上下文管理

灵感来自操作系统的**虚拟内存**——OS 通过在主存（RAM）和磁盘之间分页（paging），给应用程序「内存无限大」的错觉。

MemGPT 在 LLM 上下文层面复刻了这个设计：
- 让 LLM 自己管理「什么数据放在上下文里、什么数据挪到外部存储」
- 上下文快满时触发**系统告警 → LLM 自主决策 → 调用 function 做内存搬迁**
- 这就是 "LLM OS" 的概念

## 三、记忆架构（两级四区）

```
┌─────────────────────────────────────┐
│          MAIN CONTEXT (RAM)          │
│  ┌───────────────────────────────┐  │
│  │ System Instructions (只读)     │  │  ← 控制流、记忆使用说明
│  ├───────────────────────────────┤  │
│  │ Working Context (读写)        │  │  ← 用户关键事实/偏好/人格
│  ├───────────────────────────────┤  │
│  │ FIFO Queue (滚动消息历史)      │  │  ← 首个位置=被驱逐消息的递归摘要
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
          ↕ function calls (LLM 自主调用)
┌─────────────────────────────────────┐
│        EXTERNAL CONTEXT (DISK)       │
│  ┌───────────────────────────────┐  │
│  │ Recall Storage (消息数据库)    │  │  ← 全部历史消息，可检索
│  ├───────────────────────────────┤  │
│  │ Archival Storage (文档库)      │  │  ← embedding-based 检索
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 3.1 Main Context（主存 / prompt tokens）

- **System Instructions**: 静态只读。告诉 LLM 怎么用各个记忆层级、何时调用 function。
- **Working Context**: 固定大小的读写块。LLM 通过 function call 写入。在对话场景中存用户关键事实、偏好、人格设定——让 agent 跨会话保持一致性。
- **FIFO Queue**: 滚动消息历史。第一个槽位永远是一条**递归摘要**（之前被逐出队列的所有消息的压缩版）。这保证了即使旧消息被挤出窗口，其要点仍然可见。

### 3.2 External Context（外存 / 磁盘）

- **Recall Storage**: 完整消息数据库。LLM 可调用检索函数把历史消息捞回 FIFO Queue。
- **Archival Storage**: 文档级存储。使用 **embedding-based 检索**（向量相似度），支持海量文档的语义搜索。

### 3.3 Queue Manager（队列管理器）

- 新消息到达 → 追加到 FIFO Queue → 拼接 prompt tokens → 触发 LLM 推理
- 收发的所有消息写入 Recall Storage
- LLM 调用检索函数 → Queue Manager 把结果追加到 FIFO Queue 末尾

## 四、Letta 框架的演进

MemGPT 论文发表后，团队成立了 Letta 公司，将其发展为生产级框架：

- **Persistent State**: Agent 有持久化的 memory blocks，跨会话存活
- **Structured Memory**: 不再是纯文本 working context，而是结构化的 memory blocks（key-value、对话块、文档块等）
- **Multi-Agent**: 支持多个 agent 共享或隔离记忆
- **Tool Use**: 原生 function calling 扩展为通用 tool-use 框架
- **REST API + SDK**: 可以直接部署为记忆管理服务

核心不变的理念：**让 LLM 自己管理自己的记忆**。

## 五、对照白龙马系统差距分析

### 已有的（对齐 MemGPT 的部分）

| MemGPT 概念 | 白龙马对应 | 成熟度 |
|------------|-----------|-------|
| Recall Storage | 消息数据库 (conversations/messages) | ✅ 已有 |
| System Instructions | 系统提示词 + runtime context | ✅ 已有 |
| FIFO Queue 递归摘要 | conversation 摘要（会话锚点 anchor_session） | ✅ 已有 |
| 记忆持久化 | 记忆库 (FTS5) | ✅ 已有 |
| 会话恢复 | session_anchor 注入 | ✅ 已有 |

### 缺失的（需要补齐的部分）

| 缺失能力 | MemGPT/Letta 做法 | 白龙马差距 | 优先级 |
|---------|-----------------|----------|-------|
| **向量检索** | Archival Storage 用 embedding 做语义搜索 | 当前只有 FTS5 稀疏检索（关键词匹配），缺少稠密向量通道 | 🔴 高 |
| **LLM 自主记忆管理** | LLM 自己调用 function 决定记忆存取 | 当前是固定规则驱动的记忆检索（自动注入 + 手动 recall），缺少 LLM 主动管理 | 🔴 高 |
| **Working Context 结构化** | 固定大小的读写工作区 | 没有明确的工作记忆概念，context 混在一起 | 🟡 中 |
| **系统告警 → 自主决策闭环** | Context 快满时发 alert，LLM 决定搬迁 | 没有上下文容量监控和主动整理机制 | 🟡 中 |
| **Embedding-based 文档存储** | Archival Storage 向量检索 | learn/ 目录是文件系统，靠路径和关键词查找 | 🟡 中 |
| **记忆分层清晰化** | Main vs External 两级 + 各自子区 | 记忆类型有区分（fact/knowledge/procedure）但缺少层级化存取策略 | 🟢 低 |

### 具体落地建议

1. **向量检索通道**（最优先）：在现有 FTS5 基础上加一条 embedding 向量通道，做双路召回 + 融合重排。这直接对应 Archival Storage 的核心能力。

2. **LLM 自主记忆写入**：当前记忆写入靠代码规则（如「识别到新事实→写入」），可增加一条路径：LLM 在回复中可输出特殊标记/function call 表示「这个信息值得记住」，由系统执行写入。

3. **Working Context 概念**：在每轮 prompt 中划出一个「工作笔记」区块，允许 LLM 在跨轮对话中读写——不再每次重新注入。

4. **上下文容量监控**：统计当前 prompt token 用量，接近上限时触发压缩/检索决策链。

---

## 六、关键启发

MemGPT 最大的洞见不是「有多级记忆」，而是 **「把记忆管理的决策权交给 LLM 自己」**。

传统 RAG / 记忆系统是：**开发者写死规则**（什么时候检索、检索什么、怎么插入）。  
MemGPT 的做法是：**LLM 收到「内存快满了」的系统消息，自己决定把什么挪走、把什么捞回来。**

这需要：
- 模型够强（GPT-4 级别才玩得转这个自管理）
- 记忆操作的 function 接口设计得足够好
- 系统指令足够清晰

对于白龙马来说，这意味着我们不需要把架构推翻重来，而是在现有基础上增加两条新能力线：
- **向量检索线**（并行于 FTS5）
- **LLM 自主记忆管理线**（让 agent 可以调用记忆存取工具）
