// CATS-Net 移植自检（Phase 1 smoke test）
import { CatsNet, ConceptNode, ConflictResolver, Serializer, MemoryProjection } from './index.js'

const brain = new CatsNet({ maxIterations: 50, timeoutMs: 3000 })

brain.addNode(new ConceptNode({ id: 'risk', name: '风险', type: 'abstract', attributes: { danger: 0.8 } }))
brain.addNode(new ConceptNode({ id: 'stop_loss', name: '止损', type: 'action', attributes: { urgency: 0.9 } }))
brain.getNode('risk').connect('stop_loss', 0.9, 'causal')

const r = brain.process({
  concepts: [
    { id: 'risk', weight: 1 },
    { id: 'volatility', name: '波动率', type: 'abstract', weight: 0.8 },
  ],
  episode: {
    label: '市场下跌应对',
    content: '评估风险并触发止损',
    concepts: ['risk', 'stop_loss'],
    strength: 0.9,
  },
})

console.log('CATS-NET_SELFTEST_OK')
console.log('nodes=' + brain.size)
console.log('activated=' + r.spread.activated.join(','))
console.log('conflicts_resolved=' + r.conflicts.resolved)
console.log('memory=' + (r.memory ? r.memory.id : 'none'))

brain.abort()
const aborted = brain.process({ concepts: [{ id: 'risk', weight: 1 }] })
console.log('aborted=' + aborted.aborted)