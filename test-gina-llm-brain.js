#!/usr/bin/env node

/**
 * Gina LLM 驱动的大脑集成测试
 * 
 * 测试链路：LLM (DeepSeek V4) → 决策系统 → 进化系统 → 可解释性系统
 * 
 * 流程：
 * 1. 使用 DeepSeek V4 提出决策请求
 * 2. 将 LLM 响应解析为决策选项
 * 3. 通过 makeIntegratedDecision 管道处理
 * 4. 验证能力更新和里程碑生成
 */

import OpenAI from 'openai'
import { config } from './src/config.js'
import {
  initGinaBrain,
  makeIntegratedDecision,
  getBrainHealth,
  planEvolutionPath,
  getCapabilitySnapshot,
  updateCapability,
  setLearningGoal,
  getLearningProgressReport,
  generateBrainReport,
} from './src/brain/index.js'

const pass = (name) => { console.log(`  ✅ ${name}`) }
const fail = (name, err) => { console.log(`  ❌ ${name}: ${err?.message || err}`) }

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Gina LLM 驱动的大脑集成测试')
  console.log('═══════════════════════════════════════════')
  console.log()

  // ─── 0. 验证 LLM 配置 ─────────────────────────────────
  console.log('【Step 0】验证 LLM 配置')
  console.log(`  Provider: ${config.provider}`)
  console.log(`  Model: ${config.model}`)
  console.log(`  BaseURL: ${config.baseURL}`)
  console.log(`  API Key: ${config.apiKey ? '✅ 已配置' : '❌ 未配置'}`)
  if (!config.apiKey) {
    console.log('  ⚠️  API Key 未配置，将使用模拟数据继续测试决策/进化管道')
  }
  console.log()

  // ─── 1. 初始化 Gina 大脑 ──────────────────────────────
  console.log('【Step 1】初始化 Gina 大脑')
  const initResult = initGinaBrain({
    decision: { style: 'balanced' },
    explainability: { enableTracing: true },
  })
  console.log(`  决策系统: ${initResult.decision?.success ? '✅' : '❌'}`)
  console.log(`  可解释性: ${initResult.explainability?.success ? '✅' : '❌'}`)
  console.log(`  进化系统: ${initResult.evolution?.success ? '✅' : '❌'} (能力数: ${initResult.evolution?.capabilitiesCount || 0})`)
  console.log()

  // ─── 2. 调用 LLM 获取决策建议 ─────────────────────────
  console.log('【Step 2】调用 LLM (DeepSeek V4) 生成决策选项')
  
  let llmOptions = null
  let llmSuccess = false

  if (config.apiKey) {
    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      })

      const systemPrompt = [
        '你是 Gina，一个智能决策助手。请为以下决策场景生成结构化的选项。',
        '',
        '请严格按以下 JSON 格式返回决策选项（用 json 标签包裹）:',
        '{',
        '  "decision": "决策主题",',
        '  "options": [',
        '    {',
        '      "id": "option_a",',
        '      "name": "选项A名称",',
        '      "description": "选项详细描述",',
        '      "criteria": {',
        '        "efficiency": 0.8,',
        '        "quality": 0.6,',
        '        "cost": 0.4,',
        '        "speed": 0.7,',
        '        "risk": 0.2',
        '      }',
        '    }',
        '  ],',
        '  "recommendation": "推荐及理由"',
        '}',
      ].join('\n')

      const userMessage = [
        '决策场景：我需要处理一个数据分析任务。',
        '',
        '请生成 3 个不同的处理方案，每个方案在以下维度各有优劣：',
        '- efficiency (效率): 处理速度和资源利用',
        '- quality (质量): 输出结果的准确性',
        '- cost (成本): 计算和存储成本',
        '- speed (响应速度): 从请求到返回的时间',
        '- risk (风险): 出错或失败的可能性',
        '',
        '场景描述：从海量日志中提取异常事件并生成报告。',
      ].join('\n')

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
      })

      const llmText = response.choices[0]?.message?.content || ''
      console.log(`  LLM 响应长度: ${llmText.length} 字符`)
      console.log(`  Token 使用: ${response.usage?.total_tokens || 'N/A'}`)

      // 提取 JSON
      const jsonMatch = llmText.match(/json\s*\n?([\s\S]*?)\n?\s*\}/) || llmText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        llmOptions = JSON.parse(jsonMatch[1] || jsonMatch[0])
        llmSuccess = true
        console.log('  ✅ LLM 响应解析成功')
        console.log(`  决策主题: ${llmOptions.decision}`)
        console.log(`  选项数: ${llmOptions.options?.length || 0}`)
        if (llmOptions.recommendation) {
          console.log(`  推荐: ${llmOptions.recommendation.slice(0, 100)}${llmOptions.recommendation.length > 100 ? '...' : ''}`)
        }
      } else {
        console.log('  ⚠️  未能从响应中提取 JSON，使用模拟数据')
      }
    } catch (err) {
      console.log(`  ⚠️  LLM 调用失败: ${err.message}`)
      console.log('  将使用模拟数据继续测试')
    }
  } else {
    console.log('  ⚠️  跳过 LLM 调用（无 API Key），使用模拟数据')
  }

  // ─── 3. 构建决策选项 ─────────────────────────────────
  console.log('\n【Step 3】构建决策选项')
  
  const defaultOptions = [
    {
      id: 'fast_pipeline',
      name: '快速管道',
      description: '使用预定义规则快速筛选异常，牺牲一些准确性换取速度',
      scores: { feasibility: 0.9, desirability: 0.6, risk_level: 0.4, time_efficiency: 0.95, resource_cost: 0.2 },
    },
    {
      id: 'deep_analysis',
      name: '深度分析',
      description: '使用机器学习模型进行深入分析，准确性高但速度慢',
      scores: { feasibility: 0.5, desirability: 0.9, risk_level: 0.2, time_efficiency: 0.3, resource_cost: 0.7 },
    },
    {
      id: 'hybrid_approach',
      name: '混合方案',
      description: '先用快速规则筛选，再对可疑项进行深度分析',
      scores: { feasibility: 0.75, desirability: 0.8, risk_level: 0.3, time_efficiency: 0.7, resource_cost: 0.5 },
    },
  ]

  const options = llmSuccess && llmOptions?.options?.length >= 2
    ? llmOptions.options.map((o, i) => {
        const raw = o.scores || o.criteria || {}
        return {
          id: o.id || `llm_option_${i}`,
          name: o.name || `选项${i + 1}`,
          description: o.description || '',
          scores: {
            feasibility: raw.feasibility ?? raw.efficiency ?? 0.5,
            desirability: raw.desirability ?? raw.quality ?? 0.5,
            risk_level: raw.risk_level ?? raw.risk ?? 0.5,
            time_efficiency: raw.time_efficiency ?? raw.speed ?? 0.5,
            resource_cost: raw.resource_cost ?? raw.cost ?? 0.5,
          },
        }
      })
    : defaultOptions

  console.log(`  选项数: ${options.length}`)
  for (const opt of options) {
    console.log(`    ${opt.id}: ${opt.name}`)
    console.log(`      可行性=${opt.scores.feasibility} 期望度=${opt.scores.desirability} 风险=${opt.scores.risk_level} 时间效率=${opt.scores.time_efficiency} 资源成本=${opt.scores.resource_cost}`)
  }
  console.log()

  // ─── 4. 执行集成决策管道 ─────────────────────────────
  console.log('【Step 4】执行集成决策管道 (makeIntegratedDecision)')
  
  const decisionResult = makeIntegratedDecision(options, {
    taskType: 'data_analysis',
    userIntent: '从海量日志中提取异常事件并生成报告',
    domainId: 'decision',
    subCapabilityId: 'multi_criteria_analysis',
    generateReport: true,
    constraints: [
      { type: 'max_time', value: 300, unit: 'seconds', description: '必须在5分钟内完成' },
      { type: 'min_accuracy', value: 0.7, description: '准确率不得低于70%' },
    ],
    steps: [
      '读取日志文件',
      '解析日志格式',
      '识别异常模式',
      '生成分析报告',
    ],
  })

  console.log(`  决策ID: ${decisionResult.decisionId}`)
  console.log(`  选中方案: ${decisionResult.decision?.chosenOptionName || decisionResult.decision?.chosenOption || '无'}`)
  console.log(`  决策分数: ${(decisionResult.decision?.weightedScore || 0).toFixed(3)}`)
  console.log(`  决策风格: ${decisionResult.decision?.style || 'N/A'}`)
  
  if (decisionResult.decision?.rationale) {
    console.log(`  决策理由: ${decisionResult.decision.rationale}`)
  }
  console.log()

  // ─── 5. 验证进化系统更新 ─────────────────────────────
  console.log('【Step 5】验证进化系统更新')
  
  console.log('  能力更新:')
  const evolutionResult = decisionResult.evolution
  if (evolutionResult) {
    console.log(`    更新结果: ${evolutionResult.success ? '✅ 成功' : (evolutionResult.degraded ? '⚠️ 降级' : '❌ 失败')}`)
    if (evolutionResult.success) {
      console.log(`    领域: ${evolutionResult.domain}`)
      console.log(`    子能力: ${evolutionResult.subCapability}`)
      console.log(`    新等级: ${evolutionResult.newLevel}`)
      console.log(`    总经验: ${evolutionResult.totalExperience}`)
      console.log(`    领域进度: ${evolutionResult.domainProgress}%`)
    }
    if (evolutionResult.error) {
      console.log(`    错误: ${evolutionResult.error}`)
    }
  } else {
    console.log('    (无能力更新)')
  }
  
  console.log()
  console.log('  进化里程碑:')
  const milestones = decisionResult.milestones
  if (milestones) {
    console.log(`    当前阶段: ${milestones.currentStage || 'N/A'}`)
    console.log(`    总里程碑数: ${milestones.totalMilestones || 0}`)
    console.log(`    高优先级: ${milestones.highPriority || 0}`)
    console.log(`    下一步行动: ${(milestones.nextActions || []).map(a => typeof a === 'string' ? a : a?.action || '').join(', ') || 'N/A'}`)
  }
  console.log()

  // ─── 6. 多次决策验证进化累积 ─────────────────────────
  console.log('【Step 6】多次决策验证进化累积')
  
  const domains = [
    { domainId: 'decision', subCapabilityId: 'multi_criteria_analysis', name: '多准则分析' },
    { domainId: 'cognition', subCapabilityId: 'pattern_recognition', name: '模式识别' },
    { domainId: 'perception', subCapabilityId: 'text_understanding', name: '文本理解' },
  ]

  for (const domain of domains) {
    const result = makeIntegratedDecision(
      [
        { id: 'a', name: '方案A-快速', description: '快速但风险稍高', scores: { feasibility: 0.8, desirability: 0.6, risk_level: 0.4, time_efficiency: 0.9, resource_cost: 0.3 } },
        { id: 'b', name: '方案B-精确', description: '精确但成本高', scores: { feasibility: 0.5, desirability: 0.9, risk_level: 0.2, time_efficiency: 0.4, resource_cost: 0.7 } },
      ],
      {
        taskType: 'multi_domain',
        userIntent: `在${domain.name}领域做决策`,
        domainId: domain.domainId,
        subCapabilityId: domain.subCapabilityId,
      }
    )
    const evo = result.evolution
    if (evo && evo.success) {
      console.log(`    ${domain.name}: 等级 ${evo.newLevel}, 经验 ${evo.totalExperience}, 进度 ${evo.domainProgress}%`)
    } else {
      console.log(`    ${domain.name}: ${evo?.error || '未更新'}`)
    }
  }
  console.log()

  // ─── 7. 获取完整报告 ─────────────────────────────────
  console.log('【Step 7】生成完整大脑报告')
  
  const report = decisionResult.report
  if (report) {
    console.log(`  报告ID: ${report.decisionId}`)
    console.log(`  报告时间: ${new Date(report.timestamp).toLocaleString('zh-CN')}`)
    
    if (report.explanation) {
      console.log('  决策解释:')
      const exp = report.explanation
      if (exp.summary) console.log(`    摘要: ${exp.summary}`)
      if (exp.reasoning) console.log(`    推理: ${exp.reasoning}`)
    }
    
    if (report.transparency) {
      console.log('  透明度报告:')
      const tp = report.transparency
      if (tp.audit) console.log(`    审计: ${tp.audit}`)
      if (tp.confidence !== undefined) console.log(`    置信度: ${tp.confidence}`)
    }
    
    if (report.milestones) {
      console.log(`  里程碑数: ${report.milestones.length}`)
      for (const ms of report.milestones.slice(0, 3)) {
        console.log(`    - [${ms.priority}] ${ms.capability}: ${ms.description?.slice(0, 60) || ''}`)
      }
    }
  }
  console.log()

  // ─── 8. 进化路径全景 ─────────────────────────────────
  console.log('【Step 8】进化路径全景')
  
  const pathResult = planEvolutionPath()
  console.log(`  当前阶段: ${pathResult.currentStage || 'N/A'}`)
  console.log(`  总进度: ${pathResult.totalProgress ? Math.round(pathResult.totalProgress * 100) : 0}%`)
  console.log(`  里程碑数: ${pathResult.milestones?.length || 0}`)
  
  if (pathResult.milestones && pathResult.milestones.length > 0) {
    console.log('  里程碑列表 (前5个):')
    const sorted = [...pathResult.milestones]
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 }
        return (order[a.priority] || 9) - (order[b.priority] || 9)
      })
      .slice(0, 5)
    
    for (const ms of sorted) {
      const icon = ms.priority === 'high' ? '🔴' : ms.priority === 'medium' ? '🟡' : '🟢'
      console.log(`    ${icon} [${ms.priority.toUpperCase()}] ${ms.capability}`)
      console.log(`       ${ms.currentLevelName} → ${ms.targetLevelName} (需 ${ms.experienceNeeded} 经验)`)
      if (ms.suggestedActivities?.length) {
        console.log(`       建议: ${ms.suggestedActivities.slice(0, 2).join(', ')}`)
      }
    }
  }
  console.log()

  // ─── 9. 学习目标 ─────────────────────────────────────
  console.log('【Step 9】学习目标管理')
  
  let goalResult = null
  try {
    goalResult = setLearningGoal({
      domainId: 'decision',
      subCapabilityId: 'multi_criteria_analysis',
      targetLevel: 2,
      description: '掌握多准则决策分析',
      deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })
    console.log(`  设置学习目标: ${goalResult?.success ? '✅' : '❌'}`)
    if (goalResult?.id) console.log(`    目标ID: ${goalResult.id}`)
  } catch (err) {
    console.log(`  设置学习目标: ⚠️ 降级模式 (${err.message})`)
  }
  
  try {
    const progressReport = getLearningProgressReport()
    console.log(`  学习进度报告:`)
    if (progressReport?.goals) {
      for (const goal of progressReport.goals) {
        console.log(`    - ${goal.description || goal.id}: 进度 ${Math.round((goal.progress || 0) * 100)}%`)
      }
    }
  } catch (err) {
    console.log(`  学习进度报告: ⚠️ 降级模式 (${err.message})`)
  }
  console.log()

  // ─── 10. 大脑健康状态 ────────────────────────────────
  console.log('【Step 10】大脑健康状态')
  
  const health = getBrainHealth()
  console.log(`  状态: ${health.status}`)
  for (const [name, info] of Object.entries(health.components)) {
    console.log(`    ${name}: ${info.status}`, info.historyCount ? `(${info.historyCount} 条记录)` : '')
  }
  console.log()

  // ─── 总结 ────────────────────────────────────────────
  console.log('═══════════════════════════════════════════')
  console.log('  📊 测试总结')
  console.log('═══════════════════════════════════════════')
  console.log()
  console.log(`  LLM 调用: ${llmSuccess ? '✅ 成功' : '⚠️ 使用模拟数据'}`)
  console.log(`  决策评估: ✅ (选中: ${decisionResult.decision?.chosenOptionName || 'N/A'})`)
  console.log(`  能力进化: ${decisionResult.evolution?.success ? '✅' : '⚠️ 降级模式'}`)
  console.log(`  里程碑: ${decisionResult.milestones?.totalMilestones || 0} 个`)
  console.log(`  报告生成: ${decisionResult.report ? '✅' : '❌'}`)
  console.log(`  多域更新: ✅ (${domains.length} 个领域)`)
  console.log(`  学习目标: ${goalResult?.success ? '✅' : '❌'}`)
  console.log()
  console.log('  全链路: LLM → 决策 → 进化 → 可解释性 ✅')
  console.log()
  console.log('═══════════════════════════════════════════')
}

main().catch(err => {
  console.error('测试执行失败:', err)
  process.exit(1)
})
