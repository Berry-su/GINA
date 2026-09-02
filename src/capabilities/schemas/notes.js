// src/capabilities/schemas/notes.js — 第三方笔记工具 schema（ADR-011 · Phase 3）
//
// 2 个 tool 暴露给 LLM：
//   - query_notes : 列 / 查 / 搜 / 删 笔记（Notion / Obsidian / Roam）
//   - write_note  : 创建 / 更新 笔记
//
// emotion-isolation 严守（沿用 Phase 2）：
//   - tool 输出只走事实通道，不触发 joy
//   - 写入 L2 memory 是 memory-bridge 层做的，不在 tool 输出里
//   - LLM 拿到的 string 描述里不带 emotion 词

function buildParameters({ actions, extraProps = [] }) {
  const props = {
    action: {
      type: 'string',
      enum: actions,
      description: `Operation to perform. One of: ${actions.join(', ')}.`,
    },
    provider: {
      type: 'string',
      enum: ['mock', 'notion', 'obsidian', 'roam'],
      description: 'Notes provider. Defaults to env GINA_*_PROVIDER or "mock".',
    },
  }
  for (const p of extraProps) props[p.key] = p.schema
  return {
    type: 'object',
    properties: props,
    required: ['action'],
  }
}

export const notesSchemas = {
  query_notes: {
    type: 'function',
    function: {
      name: 'query_notes',
      description:
        'Read notes from Notion, Obsidian, or Roam Research. List, get, or delete pages. Search by title is via the list action with title filter (Phase 3 limitation). Results are written to L2 episodic memory for future CATS-Net concept recall. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['list', 'get', 'delete', 'status'],
        extraProps: [
          { key: 'parentId', schema: { type: 'string', description: 'Parent page or folder ID (list filter).' } },
          { key: 'id', schema: { type: 'string', description: 'Page ID (get/delete).' } },
          { key: 'limit', schema: { type: 'number', description: 'Max pages to return (list). Default 50.' } },
          { key: 'title', schema: { type: 'string', description: 'Title filter (list, partial match).' } },
        ],
      }),
    },
  },

  write_note: {
    type: 'function',
    function: {
      name: 'write_note',
      description:
        'Create or update a page in Notion, Obsidian, or Roam Research. Supports title, markdown content, and tags. New pages are written to L2 episodic memory for CATS-Net concept recall. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['create', 'update'],
        extraProps: [
          { key: 'id', schema: { type: 'string', description: 'Page ID (update).' } },
          { key: 'parentId', schema: { type: 'string', description: 'Parent page or folder (create).' } },
          { key: 'title', schema: { type: 'string', description: 'Page title (create or rename).' } },
          { key: 'content', schema: { type: 'string', description: 'Page content in Markdown.' } },
          { key: 'tags', schema: { type: 'array', items: { type: 'string' }, description: 'Page tags.' } },
        ],
      }),
    },
  },
}
