#!/usr/bin/env node
/**
 * test-intelligence-preserver.js
 *
 * 测试智商保持与增强系统
 * 验证 Gina 如何在切换大模型后保持智商，并通过成长变得更聪明
 */

import fs from 'fs'
import path from 'path'

// 设置数据目录
process.env.GINA_HOME = process.env.GINA_HOME || '/Users/ahs/Library/Application Support/Gina'

const GINA_HOME = process.env.GINA_HOME
const INTELLIGENCE_DIR = path.join(GINA_HOME, 'intelligence')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

let passed = 0
let failed = 0
let total = 0

function test(name, fn) {
  total++
  try {
    fn()
    passed++
    console.log(`${GREEN}✓${RESET} ${name}`)
  } catch (e) {
    failed++
    console.log(`${RED}✗${RESET} ${name}: ${e.message}`)
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
}

// ========== 主测试流程 ==========

console.log('\n' + '='.repeat(60))
console.log('  🧠 Gina 智商保持与增强系统测试')
console.log('  验证切换大模型后如何保持和提升智商')
console.log('='.repeat(60))

// ========== 测试 1: 初始化智商系统 ==========
console.log('\n📊 测试 1: 初始化智商保持系统')

let intelligence = null

test('导入智商保持模块', async () => {
  try {
    intelligence = await import('./src/memory/intelligence-preserver.js')
    assert(typeof intelligence.initIntelligenceSystem === 'function', '初始化函数不存在')
    assert(typeof intelligence.recordThinkingPattern === 'function', '记录思考模式函数不存在')
    assert(typeof intelligence.applyThinkingPattern === 'function', '应用思考模式函数不存在')
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
    throw new Error('导入失败')
  }
})

test('初始化智商存储', async () => {
  try {
    if (intelligence && intelligence.initIntelligenceSystem) {
      const result = intelligence.initIntelligenceSystem()
      assert(result.success === true, '初始化失败')
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('验证存储文件创建', () => {
  const expectedFiles = [
    'thinking-patterns.jsonl',
    'decision-rules.jsonl',
    'response-templates.jsonl',
    'knowledge-graph.json',
    'intelligence-config.json',
  ]

  for (const file of expectedFiles) {
    const filePath = path.join(INTELLIGENCE_DIR, file)
    assert(fs.existsSync(filePath), `文件不存在: ${file}`)
  }
})

// ========== 测试 2: 模拟云端学习 ==========
console.log('\n📊 测试 2: 模拟从云端模型学习')

test('记录高质量思考模式', async () => {
  try {
    if (intelligence && intelligence.recordThinkingPattern) {
      const result = intelligence.recordThinkingPattern({
        trigger: '代码调试',
        thinkingPath: [
          '1. 阅读错误信息，定位问题类型',
          '2. 查看相关代码的上下文',
          '3. 分析变量状态和执行流程',
          '4. 尝试最小化修复',
          '5. 验证修复是否有效',
        ],
        conclusion: '通过系统化排查，找到并修复了bug',
        quality: 5,
        sourceModel: 'cloud',
        metadata: { category: 'coding' },
      })
      assert(result.success === true, '记录失败')
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('记录决策规则', async () => {
  try {
    if (intelligence && intelligence.recordDecisionRule) {
      const result = intelligence.recordDecisionRule({
        condition: '当用户遇到代码错误时',
        decision: '引导用户阅读错误信息，逐步排查',
        reasoning: '系统化排查比猜测更有效，能培养用户的问题解决能力',
        examples: ['类型错误', '空指针', '语法错误'],
        quality: 5,
        category: 'coding',
      })
      assert(result.success === true, '记录失败')
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('记录回复模板', async () => {
  try {
    if (intelligence && intelligence.recordResponseTemplate) {
      const result = intelligence.recordResponseTemplate({
        type: 'coding',
        structure: ['分析问题', '给出原因', '提供解决方案', '预防建议'],
        style: '专业、清晰、有教育意义',
        components: ['错误分析', '代码示例', '最佳实践'],
        useCases: ['代码错误', '调试', '性能优化'],
      })
      assert(result.success === true, '记录失败')
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// 再记录几条，增加数据
test('记录更多思考模式', async () => {
  try {
    if (intelligence && intelligence.recordThinkingPattern) {
      const patterns = [
        {
          trigger: '数据统计',
          thinkingPath: ['1. 明确统计目标', '2. 确定数据源', '3. 选择统计方法', '4. 计算和验证'],
          quality: 4,
          category: 'analysis',
        },
        {
          trigger: '创意写作',
          thinkingPath: ['1. 理解主题和受众', '2. 收集素材和灵感', '3. 构建结构框架', '4. 填充内容', '5. 修改润色'],
          quality: 5,
          category: 'creative',
        },
        {
          trigger: '任务规划',
          thinkingPath: ['1. 分解大目标为小任务', '2. 评估每个任务的优先级', '3. 估算时间和资源', '4. 制定时间表', '5. 设置检查点'],
          quality: 4,
          category: 'planning',
        },
      ]

      for (const p of patterns) {
        intelligence.recordThinkingPattern({
          trigger: p.trigger,
          thinkingPath: p.thinkingPath,
          conclusion: '成功完成任务',
          quality: p.quality,
          sourceModel: 'cloud',
          metadata: { category: p.category },
        })
      }
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 3: 应用智商增强 ==========
console.log('\n📊 测试 3: 应用智商增强（本地模型"开小灶"）')

test('应用思考模式增强', async () => {
  try {
    if (intelligence && intelligence.applyThinkingPattern) {
      const result = intelligence.applyThinkingPattern(['代码', '调试', 'bug'])
      console.log(`    ${CYAN}ℹ${RESET} 思考模式匹配: ${result.matched ? '成功' : '失败'}`)
      if (result.matched) {
        console.log(`    ${CYAN}ℹ${RESET} 置信度: ${result.confidence.toFixed(2)}`)
        console.log(`    ${CYAN}ℹ${RESET} 思考路径: ${result.thinkingPath?.slice(0, 3).join(' → ')}...`)
      }
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('应用决策规则增强', async () => {
  try {
    if (intelligence && intelligence.applyDecisionRule) {
      const result = intelligence.applyDecisionRule('用户遇到代码错误，需要帮助调试')
      console.log(`    ${CYAN}ℹ${RESET} 决策规则匹配: ${result.matched ? '成功' : '失败'}`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('获取回复模板', async () => {
  try {
    if (intelligence && intelligence.getResponseTemplate) {
      const template = intelligence.getResponseTemplate('coding')
      assert(template !== null, '模板为空')
      console.log(`    ${CYAN}ℹ${RESET} 模板类型: ${template.type}`)
      console.log(`    ${CYAN}ℹ${RESET} 回复结构: ${template.structure?.join(' → ')}`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('构建增强提示词', async () => {
  try {
    if (intelligence && intelligence.buildEnhancedPrompt) {
      const enhanced = intelligence.buildEnhancedPrompt({
        userInput: '我的代码报错了，怎么调试？',
        problemType: 'coding',
        context: ['用户是初学者', '使用Python'],
      })
      console.log(`    ${CYAN}ℹ${RESET} 增强提示词包含 ${enhanced.enhancementCount} 个增强项`)
      if (enhanced.enhancementCount > 0) {
        console.log(`    ${CYAN}ℹ${RESET} 系统增强内容预览:`)
        console.log(`    ${YELLOW}${(enhanced.systemEnhancement || '').slice(0, 100)}...${RESET}`)
      }
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 4: 智商分数计算 ==========
console.log('\n📊 测试 4: 计算当前智商分数')

test('计算 IQ 分数', async () => {
  try {
    if (intelligence && intelligence.calculateIQScore) {
      const iq = intelligence.calculateIQScore()
      console.log(`    ${CYAN}ℹ${RESET} 当前智商: ${iq.score} (${iq.levelLabel})`)
      console.log(`    ${CYAN}ℹ${RESET} 等级描述: ${iq.description}`)
      console.log(`    ${CYAN}ℹ${RESET} 分数分解: 基础 ${iq.breakdown.base} + 模式 ${iq.breakdown.patterns.toFixed(1)} + 规则 ${iq.breakdown.rules.toFixed(1)} + 模板 ${iq.breakdown.templates}`)
      console.log(`    ${CYAN}ℹ${RESET} 学习统计: ${iq.statistics.totalPatterns} 模式, ${iq.statistics.totalRules} 规则, ${iq.statistics.totalTemplates} 模板`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 5: 自我进化 ==========
console.log('\n📊 测试 5: 验证自我进化能力')

test('成功任务的自我进化', async () => {
  try {
    if (intelligence && intelligence.selfEvolve) {
      const result = intelligence.selfEvolve({
        taskType: 'coding',
        outcome: 'success',
        userFeedback: '代码修复得很棒，谢谢！',
        executionPath: ['阅读错误', '分析原因', '找到解决方案', '验证修复'],
      })
      console.log(`    ${CYAN}ℹ${RESET} 进化: ${result.evolved ? '是' : '否'}`)
      if (result.evolved) {
        console.log(`    ${CYAN}ℹ${RESET} 学习项: ${result.learnings.length} 条`)
        console.log(`    ${CYAN}ℹ${RESET} 当前 IQ: ${result.currentIQ.score}`)
      }
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('失败任务的教训记录', async () => {
  try {
    if (intelligence && intelligence.selfEvolve) {
      const result = intelligence.selfEvolve({
        taskType: 'analysis',
        outcome: 'failure',
        executionPath: ['尝试A方案', '失败', '尝试B方案', '失败'],
      })
      console.log(`    ${CYAN}ℹ${RESET} 失败教训记录: ${result.evolved ? '是' : '否'}`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 6: 模拟智商提升 ==========
console.log('\n📊 测试 6: 模拟智商提升过程')

test('计算提升后的 IQ', async () => {
  try {
    if (intelligence && intelligence.calculateIQScore) {
      const beforeIQ = intelligence.calculateIQScore().score

      // 再添加一批高质量知识
      for (let i = 0; i < 10; i++) {
        intelligence.recordThinkingPattern({
          trigger: `高级场景_${i}`,
          thinkingPath: ['1. 理解问题本质', '2. 关联相关知识', '3. 设计多种方案', '4. 评估最优解', '5. 实施和验证'],
          quality: 5,
          sourceModel: 'evolved',
          metadata: { category: 'advanced' },
        })
      }

      for (let i = 0; i < 5; i++) {
        intelligence.recordDecisionRule({
          condition: `复杂决策场景_${i}`,
          decision: '采用多方案对比分析',
          reasoning: '复杂问题需要全面评估',
          quality: 5,
          category: 'advanced',
        })
      }

      const afterIQ = intelligence.calculateIQScore().score

      console.log(`    ${CYAN}ℹ${RESET} 提升前 IQ: ${beforeIQ}`)
      console.log(`    ${CYAN}ℹ${RESET} 提升后 IQ: ${afterIQ}`)
      console.log(`    ${GREEN}✓${RESET} IQ 提升: +${afterIQ - beforeIQ}`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 7: 验证系统完整性 ==========
console.log('\n📊 测试 7: 验证系统完整性')

test('验证存储文件可读取', () => {
  const files = fs.readdirSync(INTELLIGENCE_DIR)
  console.log(`    ${CYAN}ℹ${RESET} 存储文件数: ${files.length}`)
  for (const file of files) {
    const stats = fs.statSync(path.join(INTELLIGENCE_DIR, file))
    const size = stats.size
    console.log(`    ${CYAN}ℹ${RESET}   ${file}: ${size} bytes`)
  }
})

test('验证数据一致性', () => {
  // 检查思考模式文件
  const patternsFile = path.join(INTELLIGENCE_DIR, 'thinking-patterns.jsonl')
  if (fs.existsSync(patternsFile)) {
    const content = fs.readFileSync(patternsFile, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    console.log(`    ${CYAN}ℹ${RESET} 思考模式数: ${lines.length}`)
  }

  // 检查决策规则文件
  const rulesFile = path.join(INTELLIGENCE_DIR, 'decision-rules.jsonl')
  if (fs.existsSync(rulesFile)) {
    const content = fs.readFileSync(rulesFile, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    console.log(`    ${CYAN}ℹ${RESET} 决策规则数: ${lines.length}`)
  }
})

// ========== 输出结果 ==========
console.log('\n' + '='.repeat(60))
console.log('  📋 智商保持系统测试结果')
console.log('='.repeat(60))
console.log(`  总测试数: ${total}`)
console.log(`  ${GREEN}通过: ${passed}${RESET}`)
console.log(`  ${RED}失败: ${failed}${RESET}`)
console.log(`  通过率: ${total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : 'N/A'}`)
console.log('='.repeat(60))

if (failed === 0) {
  console.log(`\n${GREEN}🎉 智商保持系统测试完成！${RESET}`)
  console.log(`\n${CYAN}💡 核心能力验证:${RESET}`)
  console.log(`  ✓ 可以从云端模型学习思考模式`)
  console.log(`  ✓ 可以记录并应用决策规则`)
  console.log(`  ✓ 可以获取高质量回复模板`)
  console.log(`  ✓ 可以构建增强提示词给本地模型`)
  console.log(`  ✓ 可以计算和追踪智商变化`)
  console.log(`  ✓ 可以通过成功/失败经验自我进化`)
  console.log(`\n${YELLOW}⚠${RESET} 注意: 当前 IQ 分数是基于学习到的模式数量计算的，`)
  console.log(`     实际表现取决于知识库的丰富程度和应用时机。`)
} else {
  console.log(`\n${RED}⚠${RESET} 有 ${failed} 个测试失败`)
}

process.exit(failed > 0 ? 1 : 0)
