//import { insertBrainUiEvent } from './capabilities/db.js'

const sseClients = new Set()
const SSE_REPLAY_LIMIT = 600
const SSE_REPLAY_TTL_MS = 5 * 60 * 1000
const recentEvents = []
let nextEventId = 1

const BRAIN_UI_HISTORY_TYPES = new Set([
    'message_received',
    'tick',
    'scheduled_task',
    'scheduled_task_completed',
    'scheduled_task_retry',
    'scheduled_task_failed',
    'stream_start',
    'stream_end',
    'tool_preparing',
    'tool_executing',
    'tool_call',
    'response',
    'processing_preempted',
    'llm_retry',
    'message_dropped',
    'error',
    'protocol_violation',
])
let activeBrainUiPath = null

// Sticky events store
const stickyEvents = new Map() // eventType -> { data, timestamp }

function persistBrainUiEvent(type, data, ts) {
    if (type === 'message_received') {
        if (activeBrainUiPath === 'l2' || activeBrainUiPath === 'l3') {
            try {

            } catch (err) {
                console.warn('[brain‑ui‑history] preemption persist failed:', err.message || err)
            }
        }
        activeBrainUiPath = 'l1'
    }
}

// Emit an event to all SSE clients
export function emitEvent(type, data) {
    const event = {
        id: nextEventId++,
        type,
        data,
        timestamp: Date.now(),
    }

    // Store in recent events for replay
    recentEvents.push(event)
    if (recentEvents.length > SSE_REPLAY_LIMIT) {
        recentEvents.shift()
    }

    // Persist brain UI history events
    if (BRAIN_UI_HISTORY_TYPES.has(type)) {
        persistBrainUiEvent(type, data, event.timestamp)
    }

    // Send to all connected SSE clients
    for (const client of sseClients) {
        try {
            client.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
        } catch {
            // Client may have disconnected
        }
    }
}

// Set a sticky event that persists until cleared
export function setStickyEvent(type, data) {
    const event = {
        type,
        data,
        timestamp: Date.now(),
    }
    stickyEvents.set(type, event)
    emitEvent(type, data)
    return event
}

// Clear a sticky event
export function clearStickyEvent(type) {
    stickyEvents.delete(type)
    emitEvent(`${type}_cleared`, null)
}

// Get all sticky events
export function getStickyEvents() {
    return [...stickyEvents.values()]
}

// Get a specific sticky event
export function getStickyEvent(type) {
    return stickyEvents.get(type) || null
}

// Add SSE client
export function addSSEClient(client) {
    sseClients.add(client)
    // Replay recent events to new client
    for (const event of recentEvents) {
        try {
            client.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
        } catch {
            // Client may have disconnected
        }
    }
    // Send sticky events to new client
    for (const [type, event] of stickyEvents) {
        try {
            client.write(`event: ${type}\ndata: ${JSON.stringify(event.data)}\n\n`)
        } catch {
            // Client may have disconnected
        }
    }
}

// Remove SSE client
export function removeSSEClient(client) {
    sseClients.delete(client)
}

// Get recent events
export function getRecentEvents(limit = 50) {
    return recentEvents.slice(-limit)
}

// Get the latest event ID
export function getLatestEventId() {
    if (recentEvents.length === 0) return 0
    return recentEvents[recentEvents.length - 1].id
}

// Flush events since a given event ID
export function flushEventsSince(res, lastEventId = 0) {
    const events = recentEvents.filter(e => e.id > lastEventId)
    for (const event of events) {
        try {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
        } catch {
            // Response may have closed
        }
    }
    return events
}

// Flush all sticky events to a response
export function flushStickyEvents(res) {
    const events = [...stickyEvents.values()]
    for (const event of events) {
        try {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
        } catch {
            // Response may have closed
        }
    }
    return events
}
