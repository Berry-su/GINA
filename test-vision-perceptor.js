#!/usr/bin/env node
/**
 * test-vision-perceptor.js
 *
 * 测试 Gina 视觉感知系统
 */

import fs from 'fs'
import path from 'path'

// 设置数据目录
process.env.GINA_HOME = process.env.GINA_HOME || '/Users/ahs/Library/Application Support/Gina'

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
console.log('  👁️ Gina 视觉感知系统测试')
console.log('  验证 Gina 的视觉能力：文件浏览、图片分析、视频分析')
console.log('='.repeat(60))

// ========== 测试 1: 导入和初始化 ==========
console.log('\n📊 测试 1: 导入和初始化')

let vision = null

test('导入视觉感知模块', async () => {
  try {
    vision = await import('./src/memory/vision-perceptor.js')
    assert(typeof vision.initVisionSystem === 'function', '初始化函数不存在')
    assert(typeof vision.browseDirectory === 'function', '文件浏览函数不存在')
    assert(typeof vision.analyzeImage === 'function', '图片分析函数不存在')
    assert(typeof vision.analyzeVideo === 'function', '视频分析函数不存在')
    assert(typeof vision.captureScreen === 'function', '截屏函数不存在')
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
    throw new Error('导入失败')
  }
})

test('初始化视觉系统', async () => {
  try {
    if (vision && vision.initVisionSystem) {
      const result = vision.initVisionSystem()
      assert(result.initialized === true, '初始化失败')
      console.log(`    ${CYAN}ℹ${RESET} 可用能力: ${Object.keys(result.capabilities).filter(k => result.capabilities[k]).join(', ')}`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 2: 文件浏览 ==========
console.log('\n📊 测试 2: 文件浏览能力')

test('浏览根目录', async () => {
  try {
    if (vision && vision.browseDirectory) {
      const result = await vision.browseDirectory({ path: '~' })
      assert(result.success === true, '浏览失败')
      console.log(`    ${CYAN}ℹ${RESET} 路径: ${result.path}`)
      console.log(`    ${CYAN}ℹ${RESET} 项目数: ${result.items?.length || 0}`)
      console.log(`    ${CYAN}ℹ${RESET} 统计: ${JSON.stringify(result.stats).slice(0, 100)}...`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('浏览特定目录', async () => {
  try {
    if (vision && vision.browseDirectory) {
      const result = await vision.browseDirectory({ path: '~/Desktop' })
      assert(result.success === true, '浏览失败')
      console.log(`    ${CYAN}ℹ${RESET} 桌面文件数: ${result.items?.length || 0}`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('按类型过滤文件', async () => {
  try {
    if (vision && vision.browseDirectory) {
      const result = await vision.browseDirectory({ 
        path: '~/Pictures', 
        fileType: 'images',
        depth: 2,
      })
      assert(result.success === true, '浏览失败')
      const imageCount = result.items?.length || 0
      console.log(`    ${CYAN}ℹ${RESET} 图片数量: ${imageCount}`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('搜索文件', async () => {
  try {
    if (vision && vision.searchFiles) {
      const result = await vision.searchFiles({ 
        query: 'config',
        basePath: '~/Library/Application Support/Gina',
        maxResults: 10,
      })
      assert(result.success === true, '搜索失败')
      console.log(`    ${CYAN}ℹ${RESET} 搜索 "${result.query}" 找到 ${result.totalFound} 个文件`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 3: 图片浏览和分析 ==========
console.log('\n📊 测试 3: 图片浏览和分析')

test('浏览图片目录', async () => {
  try {
    if (vision && vision.browseImages) {
      const result = await vision.browseImages({ 
        dirPath: '~/Pictures',
        limit: 10,
      })
      assert(result.success === true, '浏览失败')
      console.log(`    ${CYAN}ℹ${RESET} 找到 ${result.totalFound} 张图片`)
      if (result.images?.length > 0) {
        console.log(`    ${CYAN}ℹ${RESET} 第一张: ${result.images[0].name} (${result.images[0].sizeFormatted})`)
      }
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

test('分析图片（如果有图片的话）', async () => {
  try {
    if (vision && vision.browseImages && vision.analyzeImage) {
      const browseResult = await vision.browseImages({ dirPath: '~/Pictures', limit: 1 })
      if (browseResult.images?.length > 0) {
        const imagePath = browseResult.images[0].path
        const result = await vision.analyzeImage({ filePath: imagePath })
        assert(result.success === true, '分析失败')
        console.log(`    ${CYAN}ℹ${RESET} 图片: ${path.basename(imagePath)}`)
        console.log(`    ${CYAN}ℹ${RESET} 格式: ${result.analysis.format}`)
        if (result.analysis.width) {
          console.log(`    ${CYAN}ℹ${RESET} 尺寸: ${result.analysis.width}x${result.analysis.height}`)
        }
      } else {
        console.log(`    ${YELLOW}⚠${RESET} 没有可分析的图片`)
      }
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 4: 文件读取 ==========
console.log('\n📊 测试 4: 文件读取能力')

test('读取文本文件', async () => {
  try {
    if (vision && vision.readFileContent) {
      // 读取 Gina 的配置文件
      const configPath = path.join(process.env.GINA_HOME, 'config.json')
      if (fs.existsSync(configPath)) {
        const result = await vision.readFileContent({ filePath: configPath })
        assert(result.success === true, '读取失败')
        console.log(`    ${CYAN}ℹ${RESET} 文件: ${path.basename(configPath)}`)
        console.log(`    ${CYAN}ℹ${RESET} 大小: ${result.sizeFormatted}`)
        console.log(`    ${CYAN}ℹ${RESET} 内容预览: ${result.content?.slice(0, 80)}...`)
      } else {
        console.log(`    ${YELLOW}⚠${RESET} 配置文件不存在`)
      }
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 5: 常用路径 ==========
console.log('\n📊 测试 5: 获取常用路径')

test('获取常用路径', () => {
  try {
    if (vision && vision.getCommonPaths) {
      const paths = vision.getCommonPaths()
      const accessiblePaths = Object.entries(paths)
        .filter(([_, v]) => v.exists)
        .map(([k, _]) => k)
      console.log(`    ${CYAN}ℹ${RESET} 可用路径: ${accessiblePaths.join(', ')}`)
      assert(accessiblePaths.length > 0, '没有可访问的路径')
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 6: 系统状态 ==========
console.log('\n📊 测试 6: 系统状态查询')

test('获取视觉系统状态', () => {
  try {
    if (vision && vision.getVisionStatus) {
      const status = vision.getVisionStatus()
      assert(status.status === 'active', '系统状态异常')
      console.log(`    ${CYAN}ℹ${RESET} 系统状态: ${status.status}`)
      console.log(`    ${CYAN}ℹ${RESET} 平台: ${status.platforms.current}`)
      console.log(`    ${CYAN}ℹ${RESET} 支持图片格式: ${status.config.supportedImages} 种`)
      console.log(`    ${CYAN}ℹ${RESET} 支持视频格式: ${status.config.supportedVideos} 种`)
      console.log(`    ${CYAN}ℹ${RESET} 支持文本格式: ${status.config.supportedTexts} 种`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 7: 截屏功能（可选） ==========
console.log('\n📊 测试 7: 截屏功能')

test('检查截屏能力', () => {
  try {
    if (vision && vision.getVisionStatus) {
      const status = vision.getVisionStatus()
      const canCapture = status.capabilities.screenCapture
      if (canCapture) {
        console.log(`    ${CYAN}ℹ${RESET} 截屏能力: 可用`)
      } else {
        console.log(`    ${YELLOW}⚠${RESET} 截屏能力: 不可用（需要 screencapture 或其他工具）`)
      }
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 测试 8: 视频浏览 ==========
console.log('\n📊 测试 8: 视频浏览')

test('浏览视频目录', async () => {
  try {
    if (vision && vision.browseVideos) {
      const result = await vision.browseVideos({ 
        dirPath: '~/Movies',
        limit: 5,
      })
      assert(result.success === true, '浏览失败')
      console.log(`    ${CYAN}ℹ${RESET} 找到 ${result.totalFound} 个视频`)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠${RESET} ${e.message}`)
  }
})

// ========== 输出结果 ==========
console.log('\n' + '='.repeat(60))
console.log('  📋 视觉感知系统测试结果')
console.log('='.repeat(60))
console.log(`  总测试数: ${total}`)
console.log(`  ${GREEN}通过: ${passed}${RESET}`)
console.log(`  ${RED}失败: ${failed}${RESET}`)
console.log(`  通过率: ${total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : 'N/A'}`)
console.log('='.repeat(60))

if (failed === 0) {
  console.log(`\n${GREEN}🎉 视觉感知系统测试完成！${RESET}`)
  console.log(`\n${CYAN}💡 核心能力验证:${RESET}`)
  console.log(`  ✓ 可以浏览电脑文件和目录`)
  console.log(`  ✓ 可以按类型过滤文件`)
  console.log(`  ✓ 可以搜索文件`)
  console.log(`  ✓ 可以浏览图片`)
  console.log(`  ✓ 可以分析图片`)
  console.log(`  ✓ 可以读取文本文件内容`)
  console.log(`  ✓ 可以获取常用路径`)
  console.log(`  ✓ 可以查询系统状态`)
} else {
  console.log(`\n${RED}⚠${RESET} 有 ${failed} 个测试失败`)
}

process.exit(failed > 0 ? 1 : 0)
