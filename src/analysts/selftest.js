// 分析师团队移植自检（Phase 3 smoke，纯逻辑，不触数据库）
import { createMockSnapshot } from './market-snapshot.js'
import { createAnalystTeam } from './analyst-team.js'
import { Integrator } from './integrator.js'

const int = new Integrator({ team: createAnalystTeam(null) })

function run(name, scenario) {
  const rec = int.integrate(createMockSnapshot({ scenario }))
  console.log(`${name} → ${rec.label}(${rec.action}) 看多${rec.bullish}/看空${rec.bearish}/观望${rec.neutral} 否决=${rec.vetoed}`)
}

run('bullish', 'bullish')
run('bearish', 'bearish')
run('divergent', 'divergent')
run('crisis', 'crisis')

// 授权闸门
const buy = int.integrate(createMockSnapshot({ scenario: 'bullish' }))
console.log('granted前信号=' + int.getSignal().action)
int.approve()
console.log('granted后信号=' + int.getSignal().action)

console.log('ANALYSTS_SELFTEST_OK')