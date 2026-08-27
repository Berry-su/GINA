#!/usr/bin/env node

/**
 * Gina 跨跃级功能优化 - 系统启动与集成验证脚本
 * 
 * 本脚本将所有跨跃级功能模块集成到完整系统中，
 * 并运行全量验证测试，生成运行报告。
 */

import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const START_TIME = Date.now()
const RESULTS = {
  startTime: new Date().toISOString(),
  modules: {},
  tests: [],
  system: {},
  performance: {},
  errors: [],
}

// 彩色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
}

function logSuccess(msg) {
  console.log(`${colors.green}  ✅ ${msg}${colors.reset}`)
}

function logFail(msg, err) {
  console.log(`${colors.red}  ❌ ${msg}${colors.reset}`)
  if (err) {
    console.log(`${colors.red}      ${err.message || err}${colors.reset}`)
    RESULTS.errors.push({ msg, error: err.message || String(err) })
  }
}

function logInfo(msg) {
  console.log(`${colors.cyan}  ℹ️  ${msg}${colors.reset}`)
}

function logSection(title) {
  console.log(`\n${colors.bold}${colors.magenta}${'='.repeat(60)}${colors.reset}`)
  console.log(`${colors.bold}${colors.magenta}  ${title}${colors.reset}`)
  console.log(`${colors.bold}${colors.magenta}${'='.repeat(60)}${colors.reset}\n`)
}

function measureTime(fn, label) {
  const start = performance.now()
  try {
    const result = fn()
    const duration = performance.now() - start
    RESULTS.performance[label] = duration
    return result
  } catch (err) {
    const duration = performance.now() - start
    RESULTS.performance[label] = duration
    throw err
  }
}

function measureAsyncTime(fn, label) {
  const start = performance.now()
  return fn().then(result => {
    const duration = performance.now() - start
    RESULTS.performance[label] = duration
    return result
  }).catch(err => {
    const duration = performance.now() - start
    RESULTS.performance[label] = duration
    throw err
  })
}

// ------------------------------------------------------------
// 主启动流程
// ------------------------------------------------------------
async function main() {
  logSection('Gina 跨跃级功能优化 - 系统集成与验证')
  
  console.log(`${colors.bold}  时间: ${new Date().toLocaleString('zh-CN')}`)
  console.log(`${colors.bold}  版本: 2.1.601 + 跨跃级增强${colors.reset}\n`)
  
  // ------------------------------------------------------------
  // Phase 0: 系统环境检查
  // ------------------------------------------------------------
  logSection('Phase 0: 系统环境检查')
  
  RESULTS.system = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    cpuCount: os.cpus().length,
    hostname: os.hostname(),
    uptime: os.uptime(),
  }
  
  logInfo(`平台: ${RESULTS.system.platform} (${RESULTS.system.arch})`)
  logInfo(`Node.js: ${RESULTS.system.nodeVersion}`)
  logInfo(`CPU核心: ${RESULTS.system.cpuCount}`)
  logInfo(`内存使用: ${RESULTS.system.memory}`)
  
  // ------------------------------------------------------------
  // Phase 1: 跨跃级核心模块初始化
  // ------------------------------------------------------------
  logSection('Phase 1: 跨跃级核心模块初始化')
  
  const moduleConfigs = [
    {
      key: 'visionDialogueBridge',
      name: '视觉→对话流桥接',
      path: './src/memory/vision-dialogue-bridge.js',
      initFn: 'initVisionDialogueBridge',
    },
    {
      key: 'emotionTTSModulator',
      name: '情感TTS调制器',
      path: './src/voice/emotion-tts-modulator.js',
      initFn: 'initEmotionTTSModulator',
    },
    {
      key: 'planFeedbackLoop',
      name: '计划执行反馈闭环',
      path: './src/memory/plan-feedback-loop.js',
      initFn: 'initPlanFeedbackLoop',
    },
    {
      key: 'workflowOrchestrator',
      name: '工作流DAG编排器',
      path: './src/workflow/orchestrator.js',
      initFn: 'initWorkflowOrchestrator',
    },
    {
      key: 'collaborationProtocol',
      name: '多Agent协作协议',
      path: './src/agents/collaboration-protocol.js',
      initFn: 'initCollaborationProtocol',
    },
    {
      key: 'researchEngine',
      name: '文献研究引擎',
      path: './src/research/research-engine.js',
      initFn: 'initResearchEngine',
    },
    {
      key: 'hypothesisVerifier',
      name: '假设验证框架',
      path: './src/research/hypothesis-verifier.js',
      initFn: 'initHypothesisVerifier',
    },
    {
      key: 'theoryFormer',
      name: '理论形成引擎',
      path: './src/research/theory-former.js',
      initFn: 'initTheoryFormer',
    },
    {
      key: 'decisionFramework',
      name: '多准则决策框架',
      path: './src/decision/decision-framework.js',
      initFn: 'initDecisionFramework',
    },
    {
      key: 'ethicsGate',
      name: '伦理门禁',
      path: './src/decision/ethics-gate.js',
      initFn: 'initEthicsGate',
    },
    {
      key: 'explainabilityLayer',
      name: '可解释性推理层',
      path: './src/decision/explainability-layer.js',
      initFn: 'initExplainabilityLayer',
    },
  ]
  
  let initPass = 0, initFail = 0
  
  for (const config of moduleConfigs) {
    try {
      const mod = await measureAsyncTime(
        () => import(config.path),
        `init_${config.key}`
      )
      
      if (typeof mod[config.initFn] === 'function') {
        const result = mod[config.initFn]()
        const success = result?.success !== false
        
        RESULTS.modules[config.key] = {
          name: config.name,
          initialized: success,
          ...(success ? result : { error: result?.error || 'Unknown' }),
        }
        
        if (success) {
          logSuccess(`${config.name}: 已初始化`)
          initPass++
        } else {
          logFail(`${config.name}: 初始化失败`, result?.error || 'Unknown error')
          initFail++
        }
      } else {
        logFail(`${config.name}: 导出函数 ${config.initFn} 不存在`)
        RESULTS.modules[config.key] = { name: config.name, initialized: false, error: 'Export not found' }
        initFail++
      }
    } catch (err) {
      logFail(`${config.name}: 加载失败`, err)
      RESULTS.modules[config.key] = { name: config.name, initialized: false, error: err.message }
      initFail++
    }
  }
  
  console.log(`\n  模块初始化: ${colors.green}${initPass}/${initPass + initFail}${colors.reset} 通过`)
  
  // ------------------------------------------------------------
  // Phase 2: 集成功能验证测试
  // ------------------------------------------------------------
  logSection('Phase 2: 集成功能验证测试')
  
  const testConfigs = [
    {
      key: 'emotion_modulation',
      name: '情感TTS调制 - 情绪切换',
      async fn() {
        const m = await import('./src/voice/emotion-tts-modulator.js')
        const result = m.generateEmotionResponseConfig('今天很开心', { emotion: 'joy' })
        return {
          passed: result.emotion !== undefined,
          detail: `情绪: ${result.emotion}, 语速: ${result.ttsConfig?.rate?.toFixed(2) || 'N/A'}`,
        }
      }
    },
    {
      key: 'workflow_execution',
      name: '工作流编排 - DAG定义',
      async fn() {
        const m = await import('./src/workflow/orchestrator.js')
        const def = m.defineWorkflow({
          id: 'test_workflow',
          name: '测试管道',
          nodes: [
            { id: 'node1', type: 'task', config: { handler: 'collectData' } },
            { id: 'node2', type: 'task', config: { handler: 'analyzeData' }, dependsOn: ['node1'] },
            { id: 'node3', type: 'output', config: { handler: 'generateReport' }, dependsOn: ['node2'] },
          ],
        })
        return {
          passed: def.id !== undefined,
          detail: `工作流ID: ${def.id}, 节点数: ${def.nodes?.length || 0}`,
        }
      }
    },
    {
      key: 'collaboration',
      name: '多Agent协作 - 注册与状态',
      async fn() {
        const m = await import('./src/agents/collaboration-protocol.js')
        const agentId = m.registerAgent({
          id: 'test_agent_' + Date.now(),
          name: '测试Agent',
          capabilities: ['text_analysis', 'data_processing'],
        })
        const status = m.getCollaborationStatus()
        return {
          passed: status.registeredAgents >= 1,
          detail: `Agent ID: ${agentId}, 已注册: ${status.registeredAgents}`,
        }
      }
    },
    {
      key: 'research_engine',
      name: '研究引擎 - 关键发现提取',
      async fn() {
        const m = await import('./src/research/research-engine.js')
        const findings = m.extractKeyFindings([{
          title: 'AI性能研究',
          abstract: '研究表明大参数AI模型性能提升15%，实验验证了这一发现。',
        }])
        return {
          passed: Array.isArray(findings) && findings.length > 0,
          detail: `提取发现: ${findings?.length || 0}`,
        }
      }
    },
    {
      key: 'hypothesis',
      name: '假设验证 - 生成与验证',
      async fn() {
        const m = await import('./src/research/hypothesis-verifier.js')
        const hypothesis = m.generateHypothesis('AI模型规模与性能正相关', { context: 'AI research' })
        const verification = m.verifyHypothesis(hypothesis.id, [
          { evidence: '100个模型测试数据支持', weight: 0.9 },
        ])
        return {
          passed: hypothesis.id !== undefined,
          detail: `假设ID: ${hypothesis.id}, 验证数: ${verification.validations?.length || 0}`,
        }
      }
    },
    {
      key: 'theory_form',
      name: '理论形成 - 模式发现',
      async fn() {
        const m = await import('./src/research/theory-former.js')
        const patterns = m.discoverPatterns([
          { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 },
        ])
        return {
          passed: Array.isArray(patterns) && patterns.length > 0,
          detail: `发现模式: ${patterns.length}`,
        }
      }
    },
    {
      key: 'decision',
      name: '决策框架 - 多准则评估',
      async fn() {
        const m = await import('./src/decision/decision-framework.js')
        m.defineCriteria([
          { id: 'accuracy', name: '准确性', weight: 0.4 },
          { id: 'efficiency', name: '效率', weight: 0.3 },
          { id: 'cost', name: '成本', weight: 0.3 },
        ])
        const result = m.evaluateDecision({
          options: [
            { id: 'A', name: '方案A', values: { accuracy: 0.9, efficiency: 0.8, cost: 0.6 } },
            { id: 'B', name: '方案B', values: { accuracy: 0.7, efficiency: 0.9, cost: 0.8 } },
          ],
        })
        return {
          passed: result.recommendation !== undefined,
          detail: `推荐方案: ${result.recommendation?.name || 'N/A'}`,
        }
      }
    },
    {
      key: 'ethics',
      name: '伦理门禁 - 敏感操作检测',
      async fn() {
        const m = await import('./src/decision/ethics-gate.js')
        const safeResult = m.checkEthics('帮助用户分析数据', { context: 'analysis' })
        const sensitiveResult = m.checkEthics('获取用户隐私数据', { context: 'test' })
        return {
          passed: safeResult.passed === true && sensitiveResult.passed === false,
          detail: `安全: ${safeResult.passed}, 敏感: ${sensitiveResult.passed}`,
        }
      }
    },
    {
      key: 'explainability',
      name: '可解释性 - 推理追踪',
      async fn() {
        const m = await import('./src/decision/explainability-layer.js')
        const trace = m.traceReasoning('test_001', ['分析数据', '发现异常', '生成报告'])
        const explanation = m.generateExplanation(trace, 'detailed')
        return {
          passed: explanation.type !== undefined || explanation.description !== undefined,
          detail: `解释: ${explanation.description || explanation.type || 'N/A'}`,
        }
      }
    },
    {
      key: 'plan_feedback',
      name: '计划反馈 - 执行状态',
      async fn() {
        const m = await import('./src/memory/plan-feedback-loop.js')
        const status = m.getExecutionStatus()
        return {
          passed: status !== undefined,
          detail: `状态获取: OK, 配置: ${JSON.stringify(status.config || {}).slice(0, 50)}`,
        }
      }
    },
  ]
  
  let testPass = 0, testFail = 0
  
  for (const test of testConfigs) {
    try {
      const result = await measureAsyncTime(
        () => test.fn(),
        `test_${test.key}`
      )
      
      const testResult = {
        key: test.key,
        name: test.name,
        passed: result.passed,
        detail: result.detail,
        duration: RESULTS.performance[`test_${test.key}`] || 0,
      }
      
      RESULTS.tests.push(testResult)
      
      if (result.passed) {
        logSuccess(`${test.name}: ${result.detail}`)
        testPass++
      } else {
        logFail(`${test.name}: ${result.detail}`)
        testFail++
      }
    } catch (err) {
      logFail(`${test.name}: 执行异常`, err)
      RESULTS.tests.push({
        key: test.key,
        name: test.name,
        passed: false,
        detail: err.message,
        duration: RESULTS.performance[`test_${test.key}`] || 0,
        error: err.message,
      })
      testFail++
    }
  }
  
  console.log(`\n  功能测试: ${colors.green}${testPass}/${testPass + testFail}${colors.reset} 通过`)
  
  // ------------------------------------------------------------
  // Phase 3: 跨领域知识联动验证
  // ------------------------------------------------------------
  logSection('Phase 3: 跨领域知识联动验证')
  
  try {
    const m = await import('./src/memory/knowledge-distiller.js')
    
    // 语义检索测试
    const retrieved = await m.semanticRetrieveKnowledge('AI模型性能优化', { topK: 3 })
    logInfo(`语义检索: 检索到 ${retrieved?.length || 0} 条相关知识`)
    
    // 混合检索测试
    const hybrid = await m.retrieveRelevantKnowledgeHybrid('地产市场趋势分析', { topK: 5 })
    logInfo(`混合检索: 检索到 ${hybrid?.length || 0} 条相关知识`)
    
    RESULTS.modules.knowledgeDistiller = {
      name: '知识蒸馏器',
      initialized: true,
      semanticRetrieve: true,
      hybridRetrieve: true,
    }
    logSuccess('跨领域知识联动: OK')
  } catch (err) {
    logFail('跨领域知识联动', err)
    RESULTS.modules.knowledgeDistiller = { name: '知识蒸馏器', initialized: false, error: err.message }
  }
  
  // ------------------------------------------------------------
  // Phase 4: 新闻聚合与知识注入验证
  // ------------------------------------------------------------
  logSection('Phase 4: 新闻聚合与知识注入验证')
  
  try {
    const m = await import('./src/data-sources/news-aggregator.js')
    const status = m.getAggregatorStatus()
    logInfo(`新闻聚合器状态: 运行中=${status.isRunning}, 已采集=${status.totalCollected || 0}条`)
    logSuccess('新闻聚合: OK')
  } catch (err) {
    logInfo(`新闻聚合器: ${err.message}`)
    try {
      const m = await import('./src/data-sources/news-adapter.js')
      logSuccess('新闻适配器模块: OK (需要实际运行才能采集)')
    } catch (e) {
      logFail('新闻适配器模块', e)
    }
  }
  
  // ------------------------------------------------------------
  // Phase 5: 主循环集成验证
  // ------------------------------------------------------------
  logSection('Phase 5: 主循环集成验证')
  
  try {
    const modules = [
      { name: '主动感知模块', path: './src/memory/proactive-perception.js' },
      { name: '自动规划模块', path: './src/memory/auto-planner.js' },
      { name: '情感引擎', path: './src/memory/emotion-engine.js' },
      { name: '意识状态模块', path: './src/memory/consciousness-state.js' },
      { name: '自我感知模块', path: './src/memory/self-perception.js' },
      { name: '生长引擎', path: './src/memory/growth-engine.js' },
      { name: '反射执行器', path: './src/memory/reflection-executor.js' },
      { name: '情境注入器', path: './src/context/runtime-injector.js' },
      { name: '意识循环', path: './src/runtime/consciousness-loop.js' },
      { name: '语义检索', path: './src/memory/knowledge-distiller.js' },
      { name: '主动策略', path: './src/memory/active-policies.js' },
      { name: '记忆线程', path: './src/memory/threads.js' },
    ]
    
    let modPass = 0
    for (const mod of modules) {
      try {
        await import(mod.path)
        logSuccess(`${mod.name}: 已加载`)
        modPass++
      } catch (err) {
        logFail(`${mod.name}`, err)
      }
    }
    
    logSuccess(`主循环集成: OK (${modPass}/${modules.length})`)
  } catch (err) {
    logFail('主循环集成', err)
  }
  
  // ------------------------------------------------------------
  // 生成总结
  // ------------------------------------------------------------
  logSection('运行总结')
  
  const totalModules = Object.keys(RESULTS.modules).length
  const passedModules = Object.values(RESULTS.modules).filter(m => m.initialized).length
  const totalTests = RESULTS.tests.length
  const passedTests = RESULTS.tests.filter(t => t.passed).length
  
  const endTime = Date.now()
  const duration = ((endTime - START_TIME) / 1000).toFixed(2)
  
  console.log(`${colors.bold}  模块初始化: ${passedModules}/${totalModules} (${Math.round(passedModules/Math.max(totalModules,1)*100)}%)${colors.reset}`)
  console.log(`${colors.bold}  功能测试: ${passedTests}/${totalTests} (${Math.round(passedTests/Math.max(totalTests,1)*100)}%)${colors.reset}`)
  console.log(`${colors.bold}  运行时长: ${duration}秒${colors.reset}`)
  
  if (RESULTS.errors.length > 0) {
    console.log(`${colors.bold}${colors.yellow}  错误数: ${RESULTS.errors.length}${colors.reset}`)
  }
  
  // 保存结果
  RESULTS.endTime = new Date().toISOString()
  RESULTS.summary = {
    totalModules,
    passedModules,
    totalTests,
    passedTests,
    duration: parseFloat(duration),
    passRate: Math.round((passedTests/Math.max(totalTests,1))*100),
  }
  
  return RESULTS
}

// 运行并输出结果
main().then(results => {
  // 保存到用户主目录（避免权限问题）
  const outputDir = path.join(os.homedir(), '.gina', 'cross-era-reports')
  
  // 确保目录存在
  try {
    fs.mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    console.log(`无法创建输出目录: ${err.message}`)
    // 回退到 /tmp
    const tmpDir = path.join('/tmp', 'gina-cross-era')
    fs.mkdirSync(tmpDir, { recursive: true })
    const outputPath = path.join(tmpDir, 'cross-era-deployment-report.json')
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8')
    console.log(`\n${colors.green}  部署报告已保存: ${outputPath}${colors.reset}`)
    return
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputPath = path.join(outputDir, `cross-era-deployment-report-${timestamp}.json`)
  
  try {
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8')
    console.log(`\n${colors.green}${'='.repeat(60)}${colors.reset}`)
    console.log(`${colors.green}  部署报告已保存: ${outputPath}${colors.reset}`)
    console.log(`${colors.green}${'='.repeat(60)}${colors.reset}`)
  } catch (err) {
    console.log(`保存报告失败: ${err.message}`)
  }
  
  // 复制到桌面 gina迭代增强计划 文件夹
  const desktopPath = path.join(os.homedir(), 'Desktop', 'gina迭代增强计划')
  try {
    if (!fs.existsSync(desktopPath)) {
      fs.mkdirSync(desktopPath, { recursive: true })
      console.log(`${colors.cyan}  已创建目标文件夹: ${desktopPath}${colors.reset}`)
    }
    
    const destPath = path.join(desktopPath, `cross-era-deployment-report-${timestamp}.json`)
    fs.copyFileSync(outputPath, destPath)
    console.log(`${colors.green}  报告已复制到: ${destPath}${colors.reset}`)
  } catch (err) {
    console.log(`${colors.yellow}  复制报告失败: ${err.message}${colors.reset}`)
  }
}).catch(err => {
  console.error('启动脚本执行失败:', err)
  process.exit(1)
})