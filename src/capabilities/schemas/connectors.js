// src/capabilities/schemas/connectors.js — 连接器工具 schema（ADR-010 · Phase 2）
//
// 3 个 tool 暴露给 LLM：
//   - query_calendar : 查 / 创建 / 更新 / 删除 日历事件
//   - query_email    : 读 / 搜 / 发 / 标记已读 邮件
//   - query_tasks    : 列 / 创建 / 完成 / 删除 任务
//
// 统一参数约定：
//   - action: 'list' | 'query' | 'create' | 'update' | 'delete' | 'complete' | 'send' | 'mark_read' | 'get'
//   - provider: 可选；缺省走环境变量 / mock
//   - 字段语义跨 provider 统一（calendar/event/email/task 结构对齐 connector 模块）
//
// emotion-isolation 严守：
//   - tool 输出只走事实通道（"X 邮件来自 Y 主题 Z"），不触发 joy
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
      enum: ['mock', 'google', 'icloud', 'outlook', 'gmail', 'smtp', 'reminders', 'things', 'todoist'],
      description: 'Connector provider. Defaults to env GINA_*_PROVIDER or "mock".',
    },
  }
  for (const p of extraProps) props[p.key] = p.schema
  return {
    type: 'object',
    properties: props,
    required: ['action'],
  }
}

export const connectorsSchemas = {
  query_calendar: {
    type: 'function',
    function: {
      name: 'query_calendar',
      description:
        'Access the user\'s calendar events across Google / iCloud / Outlook / mock providers. Read or write events. Results are written to L2 episodic memory (auto-decay) for future CATS-Net concept recall. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['list_calendars', 'query', 'create', 'update', 'delete'],
        extraProps: [
          { key: 'calendarId', schema: { type: 'string', description: 'Calendar ID. Defaults to "primary".' } },
          { key: 'rangeStart', schema: { type: 'string', description: 'ISO 8601 lower bound.' } },
          { key: 'rangeEnd', schema: { type: 'string', description: 'ISO 8601 upper bound.' } },
          { key: 'eventId', schema: { type: 'string', description: 'Event ID (update/delete).' } },
          { key: 'title', schema: { type: 'string', description: 'Event title (create/update).' } },
          { key: 'description', schema: { type: 'string', description: 'Event description.' } },
          { key: 'location', schema: { type: 'string', description: 'Event location.' } },
          { key: 'start', schema: { type: 'string', description: 'Event start (ISO 8601).' } },
          { key: 'end', schema: { type: 'string', description: 'Event end (ISO 8601).' } },
          { key: 'allDay', schema: { type: 'boolean', description: 'All-day event flag.' } },
          { key: 'attendees', schema: { type: 'array', items: { type: 'object' }, description: 'Array of {email, name}.' } },
          { key: 'limit', schema: { type: 'number', description: 'Max events to return (query). Default 50.' } },
        ],
      }),
    },
  },

  query_email: {
    type: 'function',
    function: {
      name: 'query_email',
      description:
        'Access the user\'s email across Gmail / Outlook / SMTP / mock providers. Read, search, send, or mark-as-read. Read results are written to L2 episodic memory for concept recall. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['list', 'search', 'get', 'send', 'mark_read'],
        extraProps: [
          { key: 'folder', schema: { type: 'string', description: 'Mailbox folder. Default "INBOX".' } },
          { key: 'limit', schema: { type: 'number', description: 'Max emails to return. Default 20.' } },
          { key: 'unreadOnly', schema: { type: 'boolean', description: 'Only return unread emails (list).' } },
          { key: 'query', schema: { type: 'string', description: 'Search query string.' } },
          { key: 'emailId', schema: { type: 'string', description: 'Email ID (get/mark_read).' } },
          { key: 'read', schema: { type: 'boolean', description: 'Read flag (mark_read). Default true.' } },
          { key: 'to', schema: { type: 'string', description: 'Recipient(s) for send. Comma-separated.' } },
          { key: 'cc', schema: { type: 'string', description: 'CC recipients.' } },
          { key: 'bcc', schema: { type: 'string', description: 'BCC recipients.' } },
          { key: 'subject', schema: { type: 'string', description: 'Email subject (send).' } },
          { key: 'body', schema: { type: 'string', description: 'Email body (send). Plain text.' } },
        ],
      }),
    },
  },

  query_tasks: {
    type: 'function',
    function: {
      name: 'query_tasks',
      description:
        'Access the user\'s tasks across Apple Reminders / Things 3 / Todoist / mock providers. List, create, complete, update, or delete. Results are written to L2 episodic memory. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: buildParameters({
        actions: ['list_lists', 'list', 'create', 'update', 'complete', 'delete'],
        extraProps: [
          { key: 'listId', schema: { type: 'string', description: 'Task list / project ID.' } },
          { key: 'includeCompleted', schema: { type: 'boolean', description: 'Include completed tasks. Default false.' } },
          { key: 'limit', schema: { type: 'number', description: 'Max tasks to return. Default 50.' } },
          { key: 'taskId', schema: { type: 'string', description: 'Task ID (update/complete/delete).' } },
          { key: 'title', schema: { type: 'string', description: 'Task title (create/update).' } },
          { key: 'notes', schema: { type: 'string', description: 'Task notes.' } },
          { key: 'dueDate', schema: { type: 'string', description: 'Task due date (ISO 8601).' } },
          { key: 'priority', schema: { type: 'number', description: 'Priority 1-4 (1=highest).' } },
          { key: 'tags', schema: { type: 'array', items: { type: 'string' }, description: 'Task labels / tags.' } },
          { key: 'completed', schema: { type: 'boolean', description: 'Completion flag (update/complete).' } },
        ],
      }),
    },
  },
}
