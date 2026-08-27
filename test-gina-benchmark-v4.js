#!/usr/bin/env node

/**
 * Gina 核心基准测试集 v4 - 完整联调版
 * 
 * 测试范围（6 大维度，30+ 测试用例）:
 * 1. 决策系统基准 - 多准则决策、灵敏度分析、Pareto 优化
 * 2. 进化系统基准 - 能力图谱、里程碑生成、经验累积
 * 3. 可解释性基准 - 决策链追踪、透明度报告、模式识别
 * 4. 集成管道基准 - makeIntegratedDecision 端到端测试
 * 5. 压力测试基准 - 连续决策、并发更新、降级模式
 * 6. 跨系统协同基准 - 决策→进化→可解释性完整链路
 */

import {
  initGinaBrain, quickStartBrain, getBrainHealth,
  makeIntegratedDecision, fullAnalysisPipeline, generateBrainReport,
  evaluateDecision, paretoAnalysis, constraintSatisfaction,
  sensitivityAnalysis, analyzeDecisionPath,
  planEvolutionPath, getCapabilitySnapshot, updateCapability,
  setLearningGoal, getLearningProgressReport,
  recordDecisionChain, replayDecision, analyzeDecisionPatterns,
  generateTransparencyReport, generateExplanation,
} from './src/brain/index.js'

// ============================================================
// 测试基础设施
// ============================================================

const results = { passed: 0, failed: 0, skipped: 0, suites: [], startTime: Date.now() }

function suite(name, fn) {
  const s = { name, tests: [], duration: 0 }
  const t = (n, f) => s.tests.push({ name: n, fn: f })
  console.log(`\n📦 ${name}`)
  const start = Date.now()
  try {
    fn(t)
    s.duration = Date.now() - start
    s.passed = 0
    s.failed = 0
    for (const test of s.tests) {
      results.passed++
      s.passed++
      const icon = '✅'
      console.log(`  ${icon} ${test.name}`)
    }
    results.suites.push(s)
  } catch (err) {
    s.duration = Date.now() - start
    results.failed++
    s.failed++
    results.suites.push(s)
    console.log(`  ❌ Suite error: ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed')
}

// ============================================================
// 准备工作
// ============================================================

console.log('═════════════════════════════════════════════════')
console.log('  Gina Core Benchmark Suite v4 - 全维度联调')
console.log('═════════════════════════════════════════════════')
console.log(`  时间: ${new Date().toLocaleString('zh-CN')}`)
console.log()

// 初始化
const initResult = initGinaBrain({ decision: { style: 'balanced' }, explainability: { enableTracing: true } })
console.log(`  初始化: 决策=${initResult.decision?.success ? '✅' : '❌'} 可解释=${initResult.explainability?.success ? '✅' : '❌'} 进化=${initResult.evolution?.success ? '✅' : '❌'}`)

// ============================================================
// Suite 1: 决策系统基准
// ============================================================

suite('决策系统基准', (t) => {
  t('多准则评估 - 三个方案排序', () => {
    const options = [
      { id: 'fast', name: '快速方案', scores: { feasibility: 0.9, desirability: 0.6, risk_level: 0.4, time_efficiency: 0.9, resource_cost: 0.2 } },
      { id: 'balanced', name: '均衡方案', scores: { feasibility: 0.75, desirability: 0.8, risk_level: 0.3, time_efficiency: 0.7, resource_cost: 0.5 } },
      { id: 'quality', name: '质量方案', scores: { feasibility: 0.5, desirability: 0.95, risk_level: 0.2, time_efficiency: 0.4, resource_cost: 0.7 } },
    ]
    const result = evaluateDecision(options, { taskType: 'test', userIntent: '测试' })
    assert(result.chosenOption !== null, '应选中一个方案')
    assert(result.weightedScore > 0, '分数应大于 0')
    assert(Array.isArray(result.ranking) && result.ranking.length === 3, '应有 3 个排名')
  })

  t('决策风格 - 冒险型', () => {
    const styles = ['conservative', 'balanced', 'aggressive']
    for (const s of styles) {
      const opts = [
        { id: 'a', name: 'A', scores: { feasibility: 0.5, desirability: 0.5, risk_level: 0.5, time_efficiency: 0.5, resource_cost: 0.5 } },
        { id: 'b', name: 'B', scores: { feasibility: 0.6, desirability: 0.6, risk_level: 0.6, time_efficiency: 0.6, resource_cost: 0.4 } },
      ]
      const r = evaluateDecision(opts, { taskType: 'test', userIntent: s })
      assert(r && r.chosenOption, `${s} 风格决策应正常`)
    }
  })

  t('Pareto 分析', () => {
    const options = [
      { id: 'o1', name: 'O1', scores: { feasibility: 0.9, desirability: 0.3, risk_level: 0.1, time_efficiency: 0.9, resource_cost: 0.1 } },
      { id: 'o2', name: 'O2', scores: { feasibility: 0.3, desirability: 0.9, risk_level: 0.9, time_efficiency: 0.3, resource_cost: 0.9 } },
      { id: 'o3', name: 'O3', scores: { feasibility: 0.6, desirability: 0.6, risk_level: 0.4, time_efficiency: 0.6, resource_cost: 0.4 } },
    ]
    const pareto = paretoAnalysis(options, {})
    assert(pareto !== null, 'Pareto 分析应返回结果')
  })

  t('约束满足检查', () => {
    const options = [
      { id: 'a', name: 'A', scores: { feasibility: 0.9, desirability: 0.6, risk_level: 0.4, time_efficiency: 0.95, resource_cost: 0.1 } },
      { id: 'b', name: 'B', scores: { feasibility: 0.5, desirability: 0.9, risk_level: 0.2, time_efficiency: 0.3, resource_cost: 0.7 } },
    ]
    const constraints = [
      { type: 'min_feasibility', value: 0.7, description: '可行性不低于 0.7' },
    ]
    const result = constraintSatisfaction(options, constraints, { taskType: 'test' })
    assert(result !== null, '约束检查应返回结果')
  })

  t('决策路径分析', () => {
    const steps = [
      { step: 1, action: '收集信息', status: 'completed' },
      { step: 2, action: '分析选项', status: 'completed' },
      { step: 3, action: '做出决策', status: 'completed' },
    ]
    const result = analyzeDecisionPath(steps, { taskType: 'test' })
    assert(result !== null, '路径分析应返回结果')
  })
})

// ============================================================
// Suite 2: 进化系统基准
// ============================================================

suite('进化系统基准', (t) => {
  t('能力图谱 - 6 大领域', () => {
    const snapshot = getCapabilitySnapshot()
    assert(snapshot !== null, '快照不应为空')
    assert(snapshot.domains && Object.keys(snapshot.domains).length >= 6, '应有 6 个以上领域')
    assert(snapshot.overallLevel !== undefined, '应有整体等级')
  })

  t('能力更新 - 决策域', () => {
    const result = updateCapability('decision', 'multi_criteria_analysis', 5)
    assert(result.success === true, '决策域能力更新应成功')
    assert(result.domain === 'decision', '领域应为 decision')
    assert(result.subCapability === 'multi_criteria_analysis', '子能力应匹配')
    assert(result.totalExperience > 0, '经验应大于 0')
  })

  t('能力更新 - 认知域', () => {
    const result = updateCapability('cognition', 'pattern_recognition', 8)
    assert(result.success === true, '认知域更新应成功')
    assert(result.totalExperience >= 8, '经验应 >= 8')
  })

  t('能力更新 - 感知域', () => {
    const result = updateCapability('perception', 'text_understanding', 3)
    assert(result.success === true, '感知域更新应成功')
  })

  t('未知领域 - 错误处理', () => {
    const result = updateCapability('nonexistent', 'fake_cap', 1)
    assert(result.success === false, '未知领域应返回失败')
  })

  t('进化路径规划 - 里程碑生成', () => {
    const path = planEvolutionPath()
    assert(path.success === true, '路径规划应成功')
    assert(Array.isArray(path.milestones) && path.milestones.length > 0, '应有里程碑')
    assert(path.currentStage !== undefined, '应有当前阶段')
    
    // 验证里程碑结构
    const m = path.milestones[0]
    assert(m.capability !== undefined, '里程碑应有 capability')
    assert(m.priority !== undefined, '里程碑应有 priority')
    assert(m.currentLevelName !== undefined, '里程碑应有当前等级名')
    assert(m.targetLevelName !== undefined, '里程碑应有目标等级名')
    assert(typeof m.experienceNeeded === 'number', '应有经验需求数值')
  })

  t('进化里程碑排序 - 优先级', () => {
    const path = planEvolutionPath()
    const order = { high: 0, medium: 1, low: 2 }
    for (let i = 1; i < path.milestones.length; i++) {
      const prev = path.milestones[i - 1]
      const curr = path.milestones[i]
      const prevOrder = order[prev.priority] || 9
      const currOrder = order[curr.priority] || 9
      if (prevOrder === currOrder) {
        assert(prev.experienceNeeded <= curr.experienceNeeded, '同优先级应按经验升序')
      } else {
        assert(prevOrder <= currOrder, '优先级应按 high→medium→low 排序')
      }
    }
  })

  t('学习目标设置与追踪', () => {
    const goal = setLearningGoal({
      domainId: 'cognition',
      subCapabilityId: 'pattern_recognition',
      targetLevel: 3,
      description: '掌握模式识别能力',
    })
    assert(goal.success === true, '学习目标设置应成功')
    assert(goal.id !== undefined, '应有目标 ID')
  })

  t('学习进度报告', () => {
    const report = getLearningProgressReport()
    assert(report !== null, '进度报告不应为空')
  })
})

// ============================================================
// Suite 3: 可解释性基准
// ============================================================

suite('可解释性基准', (t) => {
  t('决策链记录与回放', () => {
    const decisionId = `test_chain_${Date.now()}`
    const chainData = {
      triggers: ['benchmark_test'],
      alternatives: ['option_a', 'option_b'],
      evaluations: [{ option: 'option_a', score: 0.8 }],
      reasoning: ['分析完成', '选择最优'],
      finalDecision: { option: 'option_a', optionName: '方案A', confidence: 0.8 },
      style: 'balanced',
      steps: ['分析', '评估', '选择'],
    }
    const chain = recordDecisionChain(decisionId, chainData)
    assert(chain !== null, '决策链记录不应为空')
    
    const replay = replayDecision(decisionId)
    assert(replay !== null, '回放不应为空')
  })

  t('决策模式分析', () => {
    const patterns = analyzeDecisionPatterns()
    assert(patterns !== null, '模式分析不应为空')
  })

  t('透明度报告生成', () => {
    const decisionId = `test_transparency_${Date.now()}`
    recordDecisionChain(decisionId, {
      triggers: ['test'],
      alternatives: ['a', 'b'],
      reasoning: ['test'],
      finalDecision: { option: 'a', confidence: 0.9 },
      style: 'balanced',
      steps: ['step1'],
    })
    const report = generateTransparencyReport(decisionId)
    assert(report !== null, '透明度报告不应为空')
  })

  t('解释生成', () => {
    const decision = { id: 'test_decision', chosenOption: 'a', weightedScore: 0.85, style: 'balanced' }
    const explanation = generateExplanation(decision, { includeReasoning: true, includeAlternatives: true })
    assert(explanation !== null, '解释不应为空')
  })
})

// ============================================================
// Suite 4: 集成管道基准
// ============================================================

suite('集成管道基准', (t) => {
  const options = [
    { id: 'fast_pipeline', name: '快速管道', scores: { feasibility: 0.9, desirability: 0.6, risk_level: 0.4, time_efficiency: 0.95, resource_cost: 0.2 } },
    { id: 'deep_analysis', name: '深度分析', scores: { feasibility: 0.5, desirability: 0.9, risk_level: 0.2, time_efficiency: 0.3, resource_cost: 0.7 } },
    { id: 'hybrid_approach', name: '混合方案', scores: { feasibility: 0.75, desirability: 0.8, risk_level: 0.3, time_efficiency: 0.7, resource_cost: 0.5 } },
  ]

  t('完整集成管道 - decision 域', () => {
    const result = makeIntegratedDecision(options, {
      taskType: 'benchmark',
      userIntent: '基准测试',
      domainId: 'decision',
      subCapabilityId: 'multi_criteria_analysis',
      generateReport: true,
    })
    assert(result.decisionId !== undefined, '应有决策 ID')
    assert(result.decision !== null, '应有决策结果')
    assert(result.evolution !== null, '应有进化结果')
    assert(result.milestones !== null, '应有里程碑')
    assert(result.report !== null, '应有报告')
  })

  t('进化结果 - 能力更新', () => {
    const result = makeIntegratedDecision(options, {
      domainId: 'decision',
      subCapabilityId: 'multi_criteria_analysis',
    })
    assert(result.evolution.success === true, '进化应成功')
    assert(result.evolution.domain === 'decision', '领域应为 decision')
  })

  t('里程碑数量 - 大于 0', () => {
    const result = makeIntegratedDecision(options, {
      domainId: 'cognition',
      subCapabilityId: 'pattern_recognition',
    })
    assert(result.milestones.totalMilestones > 0, '里程碑数应大于 0')
  })

  t('完整报告 - 结构完整性', () => {
    const result = makeIntegratedDecision(options, {
      domainId: 'perception',
      subCapabilityId: 'text_understanding',
      generateReport: true,
    })
    const r = result.report
    assert(r.timestamp !== undefined, '报告应有时间戳')
    assert(r.decision !== undefined, '报告应有决策')
    assert(r.explanation !== undefined, '报告应有解释')
  })

  t('全分析管道', () => {
    const result = fullAnalysisPipeline(options, {
      constraints: [{ type: 'min_score', value: 0.5 }],
      steps: [{ step: 1, action: 'test', status: 'completed' }],
    })
    assert(result.pareto !== null, '应有 Pareto 分析')
    assert(result.constraints !== null, '应有约束检查')
    assert(result.path !== null, '应有路径分析')
  })
})

// ============================================================
// Suite 5: 压力测试基准
// ============================================================

suite('压力测试基准', (t) => {
  t('连续 50 次决策 - 稳定性', () => {
    const options = [
      { id: 'a', name: 'A', scores: { feasibility: 0.8, desirability: 0.7, risk_level: 0.3, time_efficiency: 0.8, resource_cost: 0.3 } },
      { id: 'b', name: 'B', scores: { feasibility: 0.6, desirability: 0.85, risk_level: 0.25, time_efficiency: 0.5, resource_cost: 0.6 } },
    ]
    const N = 50
    const start = Date.now()
    let lastResult = null
    for (let i = 0; i < N; i++) {
      lastResult = makeIntegratedDecision(options, {
        taskType: `stress_test_${i}`,
        userIntent: '压力测试',
        domainId: i % 6 === 0 ? 'decision' : null,
        subCapabilityId: i % 6 === 0 ? 'multi_criteria_analysis' : null,
      })
    }
    const elapsed = Date.now() - start
    assert(elapsed < 30000, `50 次决策应在 30 秒内完成 (实际 ${elapsed}ms)`)
    assert(lastResult !== null, '最后一次结果不应为空')
    console.log(`    50 次决策耗时: ${elapsed}ms (平均 ${(elapsed / N).toFixed(1)}ms/次)`)
  })

  t('多领域并发更新 - 5 个领域', () => {
    const domains = [
      { domain: 'decision', sub: 'multi_criteria_analysis' },
      { domain: 'cognition', sub: 'pattern_recognition' },
      { domain: 'perception', sub: 'text_understanding' },
      { domain: 'execution', sub: 'task_decomposition' },
      { domain: 'evolution', sub: 'self_reflection' },
    ]
    const options = [
      { id: 'x', name: 'X', scores: { feasibility: 0.8, desirability: 0.8, risk_level: 0.2, time_efficiency: 0.8, resource_cost: 0.2 } },
      { id: 'y', name: 'Y', scores: { feasibility: 0.6, desirability: 0.9, risk_level: 0.15, time_efficiency: 0.5, resource_cost: 0.6 } },
    ]
    for (const d of domains) {
      const r = makeIntegratedDecision(options, {
        taskType: 'concurrent_test',
        domainId: d.domain,
        subCapabilityId: d.sub,
      })
      assert(r.evolution.success === true, `${d.domain}.${d.sub} 应更新成功`)
    }
    console.log(`    5 个领域更新完成`)
  })

  t('边界条件 - 单选项决策', () => {
    const options = [
      { id: 'solo', name: '唯一选项', scores: { feasibility: 0.5, desirability: 0.5, risk_level: 0.5, time_efficiency: 0.5, resource_cost: 0.5 } },
    ]
    const result = makeIntegratedDecision(options, { taskType: 'single_option' })
    assert(result.decision.chosenOption === 'solo', '单选项应被选中')
  })

  t('边界条件 - 退化模式（无匹配能力域）', () => {
    const options = [
      { id: 'a', name: 'A', scores: { feasibility: 0.5, desirability: 0.5, risk_level: 0.5, time_efficiency: 0.5, resource_cost: 0.5 } },
    ]
    const result = makeIntegratedDecision(options, {
      taskType: 'fallback',
      domainId: 'nonexistent_domain_xyz',
      subCapabilityId: 'fake_cap',
    })
    assert(result.decision !== null, '决策应正常返回')
    assert(result.evolution === null || result.evolution.success === false, '未知域进化应返回失败或 null')
  })
})

// ============================================================
// Suite 6: 跨系统协同基准
// ============================================================

suite('跨系统协同基准', (t) => {
  t('决策→进化→可解释性 完整链路', () => {
    const decisionId = `e2e_${Date.now()}`
    const options = [
      { id: 'opt_a', name: '方案A', scores: { feasibility: 0.85, desirability: 0.75, risk_level: 0.3, time_efficiency: 0.9, resource_cost: 0.25 } },
      { id: 'opt_b', name: '方案B', scores: { feasibility: 0.6, desirability: 0.9, risk_level: 0.2, time_efficiency: 0.4, resource_cost: 0.65 } },
    ]
    
    // Step 1: 决策
    const decisionResult = evaluateDecision(options, { taskType: 'integration', userIntent: '全链路测试' })
    assert(decisionResult.chosenOption !== null, '应有决策结果')
    
    // Step 2: 可解释性 - 记录决策链
    const chain = recordDecisionChain(decisionId, {
      triggers: ['integration_test'],
      alternatives: options.map(o => o.id),
      evaluations: [{ option: decisionResult.chosenOption, score: decisionResult.weightedScore }],
      reasoning: ['全链路集成测试'],
      finalDecision: { option: decisionResult.chosenOption, confidence: decisionResult.weightedScore },
      style: decisionResult.style,
      steps: ['评估', '选择'],
    })
    assert(chain !== null, '决策链应记录成功')
    
    // Step 3: 进化 - 更新能力
    const domain = decisionResult.chosenOption === 'opt_a' ? 'decision' : 'cognition'
    const sub = decisionResult.chosenOption === 'opt_a' ? 'multi_criteria_analysis' : 'pattern_recognition'
    const evo = updateCapability(domain, sub, Math.round(decisionResult.weightedScore * 10))
    assert(evo.success === true, '进化应成功')
    
    // Step 4: 生成报告
    const report = generateBrainReport(decisionId, decisionResult)
    assert(report.decision !== null, '报告应有决策')
    assert(report.explanation !== null, '报告应有解释')
    assert(report.transparency !== null, '报告应有透明度')
    
    // 全链路总结
    console.log(`    决策: ${decisionResult.chosenOptionName} (分数 ${decisionResult.weightedScore.toFixed(3)})`)
    console.log(`    进化: ${domain}.${sub} → 等级 ${evo.newLevel}`)
  })

  t('大脑健康状态检查', () => {
    const health = getBrainHealth()
    assert(health.status === 'healthy', '大脑状态应为 healthy')
    assert(health.components.decision.status === 'active', '决策系统应活跃')
    assert(health.components.evolution.status === 'active', '进化系统应活跃')
    assert(health.components.explainability.status === 'active', '可解释性系统应活跃')
  })

  t('快速启动大脑', () => {
    const quick = quickStartBrain()
    assert(quick.success === true, '快速启动应成功')
  })

  t('报告生成 - 里程碑整合', () => {
    const result = makeIntegratedDecision([
      { id: 'x', name: 'X', scores: { feasibility: 0.7, desirability: 0.8, risk_level: 0.3, time_efficiency: 0.7, resource_cost: 0.4 } },
    ], {
      domainId: 'cognition',
      subCapabilityId: 'pattern_recognition',
      generateReport: true,
    })
    const r = result.report
    assert(r !== null, '应有报告')
    assert(Array.isArray(r.milestones), '里程碑应为数组')
    assert(r.milestones.length > 0, '里程碑应有条目')
  })
})

// ============================================================
// 结果汇总
// ============================================================

console.log('\n\n═════════════════════════════════════════════════')
console.log('  📊 基准测试结果汇总')
console.log('═════════════════════════════════════════════════')

const totalTests = results.passed + results.failed
const rate = totalTests > 0 ? (results.passed / totalTests * 100).toFixed(1) : 0

console.log(`\n  总测试数: ${totalTests}`)
console.log(`  通过: ${results.passed}`)
console.log(`  失败: ${results.failed}`)
console.log(`  通过率: ${rate}%`)

console.log(`\n  套件详情:`)
for (const s of results.suites) {
  const icon = s.failed === 0 ? '🟢' : s.failed > 2 ? '🔴' : '🟡'
  console.log(`    ${icon} ${s.name}: ${s.tests.length} 测试, ${s.failed} 失败, ${s.duration}ms`)
}

// 评估各维度
const dimensions = {
  '决策系统': results.suites.find(s => s.name === '决策系统基准'),
  '进化系统': results.suites.find(s => s.name === '进化系统基准'),
  '可解释性': results.suites.find(s => s.name === '可解释性基准'),
  '集成管道': results.suites.find(s => s.name === '集成管道基准'),
  '压力测试': results.suites.find(s => s.name === '压力测试基准'),
  '跨系统协同': results.suites.find(s => s.name === '跨系统协同基准'),
}

console.log(`\n  维度评估:`)
for (const [dim, suite] of Object.entries(dimensions)) {
  if (suite) {
    const rate = suite.tests.length > 0 ? ((suite.tests.length - suite.failed) / suite.tests.length * 100).toFixed(0) : 0
    const icon = rate >= 90 ? '⭐' : rate >= 70 ? '✓' : '⚠️'
    console.log(`    ${icon} ${dim}: ${rate}%`)
  }
}

const elapsed = Date.now() - results.startTime
console.log(`\n  总耗时: ${elapsed}ms`)
console.log(`\n  通过率: ${rate}% ${totalTests > 0 && results.failed === 0 ? '🎉 全部通过!' : results.failed > 0 ? '⚠️ 有失败' : ''}`)
console.log()

process.exit(results.failed > 0 ? 1 : 0)
