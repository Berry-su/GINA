// 个人数据源工具 schema：calendar_events / recent_emails / search_contacts
// 通过系统应用（macOS Calendar / Mail / Contacts）只读访问用户个人上下文。
export const personalSchemas = {
  calendar_events: {
    type: 'function',
    function: {
      name: 'calendar_events',
      description: 'Read the user\'s upcoming calendar events from the macOS Calendar app (read-only). Use this to answer questions about the user\'s schedule, remind them of upcoming events, or plan around their availability. Only available on macOS; requires user-granted Calendar permission.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'How many days ahead to look, from today. Default 7, max 31.',
            minimum: 1,
            maximum: 31,
          },
        },
        required: [],
      },
    },
  },

  recent_emails: {
    type: 'function',
    function: {
      name: 'recent_emails',
      description: 'Read the user\'s recent emails from the macOS Mail app (read-only). By default only returns subject/sender/date (no body) to protect privacy; set include_body=true only when the user explicitly asked for email content, and the body is truncated. Only available on macOS; requires user-granted Mail permission.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Max number of emails to return. Default 20, max 50.',
            minimum: 1,
            maximum: 50,
          },
          include_body: {
            type: 'boolean',
            description: 'Whether to include the email body (truncated to 2000 chars). Default false. Only set true when the user explicitly asked for content.',
          },
        },
        required: [],
      },
    },
  },

  search_contacts: {
    type: 'function',
    function: {
      name: 'search_contacts',
      description: 'Search the user\'s contacts from the macOS Contacts app (read-only) by name. Returns name and organization. Use this to look up a person the user mentions. Only available on macOS; requires user-granted Contacts permission.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Name (or partial name) to search for. Empty returns all contacts (capped).',
          },
          limit: {
            type: 'number',
            description: 'Max contacts to return. Default 20, max 100.',
            minimum: 1,
            maximum: 100,
          },
        },
        required: [],
      },
    },
  },
}
