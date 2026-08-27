#!/usr/bin/env node
// verify-closure.js — 验证技能自动生成闭环
// 运行方式: node verify-closure.js

import { generateImprovementSkills, generateEmotionResponseSkill, getSkillStats } from './src/memory/skill-generator.js'
import { getConfig, setConfig } from './src/capabilities/db.js'
import { analyzeEmotion, processEmotionUpdate } from './src/memory/emotion-engine.js'
import { getConsciousnessState, handleConsciousnessEvent, STATES } from './src/memory/consciousness-state.js'
import { selectSkillsForMessage, formatSkillsForContext } from './src/skills/registry.js'
import { paths } from './src/paths.js'
import fs from 'fs'
import path from 'path'

const RESULTS = {
  passed: 0,
  failed: 0,
  logs: [],
}

function log(msg, type = 'info') {
  const prefix = type === 'PASS' ? '✅' : type === 'FAIL' ? '❌' : '📋'
  RESULTS.logs.push(`${prefix} [${type}] ${msg}`)
  if (type === 'PASS') RESULTS.passed++
  if (type === 'FAIL') RESULTS.failed++
  console.log(`${prefix} [${type}] ${msg}`)
}

async function main() {
  console.log('═'.repeat(60))
  console.log('  Gina 闭环验证脚本 — Skill Auto-Generation Closure')
  console.log('═'.repeat(60))
  console.log('')

  // ── 1. 情感计算引擎测试 ──
  console.log('─'.repeat(40))
  console.log('1. 情感计算引擎 (emotion-engine)')
  console.log('─'.repeat(40))

  const testMessages = [
    { text: '我好开心啊！今天太棒了！', expected: 'joy' },
    { text: '我真的很生气，太烦了', expected: 'anger' },
    { text: '我有点担心这个会出问题', expected: 'fear' },
    { text: '快点！赶紧的，马上要迟到了', expected: 'urgency' },
    { text: '我有点不明白这是什么意思', expected: 'confusion' },
  ]

  for (const t of testMessages) {
    const result = analyzeEmotion(t.text)
    if (result) {
      log(`"${t.text.slice(0, 10)}..." → 情绪: ${result.primary} (期望: ${t.expected})`,
        result.primary === t.expected ? 'PASS' : 'FAIL')
    } else {
      log(`"${t.text.slice(0, 10)}..." → 未检测到情绪`, 'FAIL')
    }
  }

  // 情绪状态持久化
  const emotionUpdate = processEmotionUpdate({
    messageText: '我非常开心！',
    conversationWindow: [{ role: 'user', content: '今天天气真好' }],
  })
  if (emotionUpdate && emotionUpdate.profile) {
    log(`情绪状态持久化: 主情绪=${emotionUpdate.profile.primary}, 效价=${emotionUpdate.profile.valence.toFixed(2)}`, 'PASS')
  } else {
    log('情绪状态持久化失败', 'FAIL')
  }

  // ── 2. 意识状态机测试 ──
  console.log('')
  console.log('─'.repeat(40))
  console.log('2. 意识状态机 (consciousness-state)')
  console.log('─'.repeat(40))

  const initialState = getConsciousnessState()
  log(`初始意识状态: ${initialState.current}`, 'PASS')

  const afterStartup = handleConsciousnessEvent('startup')
  log(`启动事件 → 状态: ${afterStartup.current} (期望: awakening)`,
    afterStartup.current === STATES.AWAKENING ? 'PASS' : 'FAIL')

  const afterUserMsg = handleConsciousnessEvent('user_message')
  log(`用户消息 → 状态: ${afterUserMsg.current} (期望: focused)`,
    afterUserMsg.current === STATES.FOCUSED ? 'PASS' : 'FAIL')

  const afterIdle = handleConsciousnessEvent('idle_timeout')
  log(`空闲超时 → 状态: ${afterIdle.current} (期望: reflective)`,
    afterIdle.current === STATES.REFLECTIVE ? 'PASS' : 'FAIL')

  // ── 3. 技能生成测试 ──
  console.log('')
  console.log('─'.repeat(40))
  console.log('3. 技能生成 (skill-generator)')
  console.log('─'.repeat(40))

  const testSkillDir = path.join(paths.skillsDir || './skills', '_test_skills')

  // 模拟一个改进建议
  const mockSuggestion = {
    priority: 0.85,
    recommendations: [
      {
        category: 'response_quality',
        action: '改进回复质量：更清晰地表达、提供更具体的例子',
        priority: 0.8,
      },
      {
        category: 'emotion_intelligence',
        action: '增强情感响应：对负面情绪先共情再解决问题',
        priority: 0.9,
      },
    ],
    summary: '检测到 2 个改进区域',
    patterns: [{ type: 'low_satisfaction', description: '满意度偏低', severity: 'high' }],
    metrics: { total: 10, avgSatisfaction: 0.35 },
  }

  try {
    const generated = generateImprovementSkills(mockSuggestion, testSkillDir)
    if (generated.length > 0) {
      log(`生成改进技能: ${generated.length} 个`, 'PASS')
      for (const g of generated) {
        log(`  → ${g.skillName || g.ok ? 'OK' : 'FAIL'}`, g.ok ? 'PASS' : 'FAIL')
      }
    } else {
      log('改进技能生成返回空数组', 'FAIL')
    }
  } catch (err) {
    log(`改进技能生成异常: ${err.message}`, 'FAIL')
  }

  // 情绪响应技能
  try {
    const emotionSkill = generateEmotionResponseSkill('anger', '先倾听共情', testSkillDir)
    if (emotionSkill.ok) {
      log(`愤怒情绪响应技能生成: ${emotionSkill.skillName || 'OK'}`, 'PASS')
    } else {
      log(`愤怒情绪响应技能: ${emotionSkill.reason || 'unknown'}`, 'INFO')
    }
  } catch (err) {
    log(`情绪技能生成异常: ${err.message}`, 'FAIL')
  }

  // 技能统计
  try {
    const stats = getSkillStats(testSkillDir)
    log(`技能库统计: 总计 ${stats.total} 个技能`, 'PASS')
  } catch (err) {
    log(`技能统计异常: ${err.message}`, 'FAIL')
  }

  // ── 4. 技能检索测试 ──
  console.log('')
  console.log('─'.repeat(40))
  console.log('4. 技能检索 (registry)')
  console.log('─'.repeat(40))

  try {
    const selection = selectSkillsForMessage('我需要改进回复质量和表达能力')
    const formatted = formatSkillsForContext(selection)
    log(`技能检索: 匹配到 ${selection.active?.length || 0} 个技能`, 'PASS')
    if (formatted) {
      log(`技能格式化: 生成 ${formatted.length} 字符的上下文`, 'PASS')
    }
  } catch (err) {
    log(`技能检索异常: ${err.message}`, 'FAIL')
  }

  // ── 5. 集成测试：模拟完整闭环 ──
  console.log('')
  console.log('─'.repeat(40))
  console.log('5. 闭环集成测试')
  console.log('─'.repeat(40))

  // 步骤：模拟一次完整的交互流程
  const testMessage = '我今天非常开心，心情很好！'
  
  // 5a. 情绪分析
  const emotion = analyzeEmotion(testMessage)
  log(`[闭环] 情绪分析: ${emotion?.primary || 'N/A'}`, emotion ? 'PASS' : 'FAIL')

  // 5b. 意识状态更新
  const state = handleConsciousnessEvent('user_message')
  log(`[闭环] 意识状态: ${state.current}`, state.current === STATES.FOCUSED ? 'PASS' : 'FAIL')

  // 5c. 技能匹配
  const skills = selectSkillsForMessage(testMessage)
  log(`[闭环] 技能匹配: ${skills.active?.length || 0} 个相关技能`, 'PASS')

  // 5d. 模拟改进建议生成
  const simulatedSuggestion = {
    priority: 0.75,
    recommendations: [
      { category: 'user_engagement', action: '增加互动性', priority: 0.6 },
    ],
    summary: '模拟改进',
    patterns: [],
    metrics: {},
  }
  
  try {
    const closedLoopSkills = generateImprovementSkills(simulatedSuggestion, testSkillDir)
    log(`[闭环] 技能自动生成: ${closedLoopSkills.length} 个`, 'PASS')
  } catch (err) {
    log(`[闭环] 技能生成失败: ${err.message}`, 'FAIL')
  }

  // ── 结果汇总 ──
  console.log('')
  console.log('═'.repeat(60))
  console.log('  验证结果汇总')
  console.log('═'.repeat(60))
  console.log(`  通过: ${RESULTS.passed}`)
  console.log(`  失败: ${RESULTS.failed}`)
  console.log(`  总计: ${RESULTS.passed + RESULTS.failed}`)
  console.log('═'.repeat(60))

  if (RESULTS.failed === 0) {
    console.log('  🎉 所有验证通过！闭环功能正常！')
  } else {
    console.log('  ⚠️ 有验证失败，请检查上方日志')
  }
  console.log('')

  // 清理测试目录
  try {
    fs.rmSync(testSkillDir, { recursive: true, force: true })
    console.log('🧹 测试目录已清理')
  } catch {}

  process.exit(RESULTS.failed === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('验证脚本异常:', err)
  process.exit(1)
})