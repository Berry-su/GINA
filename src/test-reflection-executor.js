import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

let failed = 0
function assert(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`)
  } else {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempUserDir = fs.mkdtempSync(path.join(repoRoot, 'sandbox', 'reflection-test-'))
process.env.GINA_USER_DIR = tempUserDir
process.env.USERPROFILE = tempUserDir
process.env.HOME = tempUserDir

try {
  const db = await import('./capabilities/db.js')
  const evo = await import('./memory/self-evolution.js')
  const ref = await import('./memory/reflection-executor.js')

  db.getDB()
  await evo.resetSelfEvolutionState()
  await ref.resetReflectionState()

  const initialState = await ref.getReflectionState()
  assert(initialState.reflections.length === 0, 'reflection state starts empty')

  const r1 = await ref.recordReflection({
    outcome: 'success',
    note: 'File edit verified after patch.',
    source: 'file-work',
    metrics: { satisfaction: 4, error_rate: 0 },
  })
  assert(r1?.reflections?.length === 1, 'reflection records a success outcome')

  await ref.recordReflection({
    outcome: 'failure',
    note: 'Reported success before running the test.',
    source: 'file-work',
  })
  await ref.recordReflection({
    outcome: 'neutral',
    note: 'Routine question answered.',
    source: 'chat',
  })

  const state = await ref.getReflectionState()
  assert(state.reflections.length === 3, 'three reflections accumulated')
  assert(state.last_reflection_at !== null, 'reflection timestamp is recorded')

  // 改进建议应进入进化流水线：能被识别为可沉淀记忆，并计入 total_events
  const improvementMemId = `policy_self_improvement_${Date.now()}`
  db.upsertMemoryByMemId({
    mem_id: improvementMemId,
    type: 'policy',
    title: 'Self-improvement from reflection',
    content: 'Placeholder improvement policy for pipeline test.',
    tags: ['kind:policy', 'source:self_reflection', 'domain:self_evolution'],
    salience: 4,
    timestamp: new Date().toISOString(),
  })
  const learned = evo.recordSelfEvolutionFromMemories([{ mem_id: improvementMemId }])
  assert(learned.length === 1, 'improvement policy memory is actionable by self-evolution')
  assert(learned[0]?.kind === 'policy', 'improvement memory kind is policy')
  assert(evo.getSelfEvolutionState().total_events === 1, 'improvement memory increments total_events')
} catch (err) {
  failed++
  process.exitCode = 1
  console.error(`FAIL: unexpected error: ${err.stack || err.message}`)
} finally {
  try { fs.rmSync(tempUserDir, { recursive: true, force: true }) } catch {}
}

console.log(failed === 0 ? '\nAll reflection-executor tests passed' : `\n${failed} reflection-executor test(s) failed`)
process.exit(failed === 0 ? 0 : 1)
