/**
 * vision-dialogue-bridge.js — 视觉→对话流桥接
 *
 * 核心理念：让 Gina "看到" 并用自然语言描述她看到的东西。
 * 将视觉感知系统的分析结果无缝注入到对话上下文中。
 *
 * 功能：
 *   1. 截图分析 → 对话描述
 *   2. 图片上传 → 内容理解
 *   3. 文件浏览 → 上下文注入
 *   4. 视觉记忆 → 长期知识
 */

import { 
  initVisionSystem, 
  captureScreen, 
  analyzeImage, 
  browseDirectory, 
  readFileContent,
  searchFiles,
  VISION_SYSTEM
} from './vision-perceptor.js'
import { emitEvent } from '../events.js'

let initialized = false
let visionContextCache = new Map()
let lastCapture = null

/**
 * 初始化视觉对话桥接
 */
export function initVisionDialogueBridge() {
  if (initialized) return { initialized: true }
  
  const vision = initVisionSystem()
  initialized = true
  
  console.log('[视觉对话桥] 已启动, 能力:', JSON.stringify(vision.capabilities))
  
  return {
    initialized: true,
    capabilities: vision.capabilities,
  }
}

/**
 * 捕获屏幕并生成对话描述
 */
export async function captureAndDescribe(options = {}) {
  const {
    includeOCR = true,
    maxDescriptionLength = 500,
    saveToMemory = true,
  } = options
  
  try {
    const captureResult = await captureScreen({
      captureCursor: false,
      captureMouseClicks: false,
    })
    
    if (!captureResult?.success) {
      return {
        success: false,
        error: '屏幕捕获失败',
        capabilities: getVisionStatus().capabilities,
      }
    }
    
    const description = generateScreenDescription(captureResult, {
      includeOCR,
      maxLength: maxDescriptionLength,
    })
    
    const result = {
      success: true,
      type: 'screen_capture',
      description,
      fileInfo: captureResult.fileInfo,
      timestamp: Date.now(),
    }
    
    lastCapture = result
    
    if (saveToMemory) {
      emitEvent('vision_captured', {
        type: 'screen',
        description,
        source: 'vision-dialogue-bridge',
        timestamp: result.timestamp,
      })
    }
    
    return result
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 分析图片并生成对话描述
 */
export async function analyzeAndDescribeImage(imagePath, options = {}) {
  const {
    extractText = true,
    detectObjects = true,
    maxDescriptionLength = 500,
  } = options
  
  try {
    const analysis = await analyzeImage(imagePath, {
      extractText,
      detectObjects,
      generateDescription: true,
    })
    
    if (!analysis?.success) {
      return { success: false, error: analysis?.error || '图片分析失败' }
    }
    
    const description = generateImageDescription(analysis, maxDescriptionLength)
    
    const result = {
      success: true,
      type: 'image_analysis',
      description,
      analysis: {
        objects: analysis.objects || [],
        text: analysis.text || '',
        metadata: analysis.metadata || {},
      },
      timestamp: Date.now(),
    }
    
    emitEvent('vision_analyzed', {
      type: 'image',
      description,
      objects: analysis.objects?.length || 0,
      hasText: !!(analysis.text && analysis.text.length > 0),
      timestamp: result.timestamp,
    })
    
    return result
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 浏览目录并生成上下文描述
 */
export async function browseAndDescribe(folderPath, options = {}) {
  const {
    depth = 1,
    maxFiles = 20,
    includeContent = false,
  } = options
  
  try {
    const browseResult = await browseDirectory({
      path: folderPath,
      depth,
      maxItems: maxFiles,
      includeContent,
    })
    
    if (!browseResult?.success) {
      return { success: false, error: browseResult?.error || '目录浏览失败' }
    }
    
    const description = generateDirectoryDescription(browseResult, folderPath)
    
    return {
      success: true,
      type: 'directory_browse',
      description,
      itemsCount: browseResult.items?.length || 0,
      path: folderPath,
      timestamp: Date.now(),
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 读取文件并生成上下文
 */
export async function readFileAndDescribe(filePath, options = {}) {
  const { maxChars = 2000 } = options
  
  try {
    const content = await readFileContent(filePath, { maxChars })
    
    if (!content?.success) {
      return { success: false, error: content?.error || '文件读取失败' }
    }
    
    const description = generateFileDescription(content, filePath)
    
    return {
      success: true,
      type: 'file_read',
      description,
      fileType: content.type,
      contentLength: content.content?.length || 0,
      timestamp: Date.now(),
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 搜索文件并生成上下文
 */
export async function searchAndDescribe(query, options = {}) {
  const { maxResults = 10, includePreview = true } = options
  
  try {
    const results = await searchFiles({ query, maxResults, includePreview })
    
    if (!results?.success) {
      return { success: false, error: results?.error || '文件搜索失败' }
    }
    
    const description = generateSearchDescription(results, query)
    
    return {
      success: true,
      type: 'file_search',
      description,
      resultsCount: results.items?.length || 0,
      query,
      timestamp: Date.now(),
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 将视觉描述注入对话上下文
 */
export function injectVisionContext(message, visionResult) {
  if (!visionResult?.description) return message
  
  const contextBlock = `
[视觉上下文]
类型: ${visionResult.type}
描述: ${visionResult.description}
${visionResult.fileInfo ? `文件: ${visionResult.fileInfo.path}` : ''}
${visionResult.analysis?.objects?.length ? `检测到物体: ${visionResult.analysis.objects.join(', ')}` : ''}
${visionResult.analysis?.text ? `识别文字: ${visionResult.analysis.text.slice(0, 200)}` : ''}
时间: ${new Date(visionResult.timestamp).toLocaleString()}
[/视觉上下文]

`
  
  const visionCacheKey = `vision_${visionResult.timestamp}`
  visionContextCache.set(visionCacheKey, visionResult.description)
  
  return contextBlock + message
}

/**
 * 生成屏幕描述
 */
function generateScreenDescription(captureResult, options = {}) {
  const parts = []
  
  parts.push('这是一张屏幕截图的分析。')
  
  if (captureResult.fileInfo) {
    const { width, height } = captureResult.fileInfo
    if (width && height) {
      parts.push(`屏幕尺寸: ${width}x${height}。`)
    }
  }
  
  if (captureResult.ocrText && options.includeOCR) {
    parts.push(`屏幕上的文字内容: ${captureResult.ocrText.slice(0, options.maxLength - 100)}。`)
  }
  
  parts.push('你可以根据这些信息回答用户的问题。')
  
  return parts.join(' ')
}

/**
 * 生成图片描述
 */
function generateImageDescription(analysis, maxLength = 500) {
  const parts = []
  
  if (analysis.description) {
    parts.push(analysis.description)
  } else {
    parts.push('这是一张图片的分析结果。')
  }
  
  if (analysis.objects?.length) {
    const objList = analysis.objects.slice(0, 5).join('、')
    parts.push(`图片中检测到: ${objList}。`)
  }
  
  if (analysis.text && analysis.text.length > 10) {
    parts.push(`图片中的文字: ${analysis.text.slice(0, 200)}。`)
  }
  
  const description = parts.join(' ')
  return description.length > maxLength 
    ? description.slice(0, maxLength - 3) + '...'
    : description
}

/**
 * 生成目录描述
 */
function generateDirectoryDescription(browseResult, folderPath) {
  const parts = []
  
  parts.push(`目录 ${folderPath} 的内容概览:`)
  
  if (browseResult.summary) {
    const { fileCount, dirCount, totalSize } = browseResult.summary
    parts.push(`包含 ${dirCount} 个文件夹, ${fileCount} 个文件`)
    if (totalSize) {
      const sizeMB = (totalSize / 1024 / 1024).toFixed(1)
      parts.push(`总大小约 ${sizeMB} MB`)
    }
  }
  
  if (browseResult.items?.length) {
    const topItems = browseResult.items.slice(0, 5)
    parts.push(`主要内容包括: ${topItems.map(i => i.name).join(', ')}`)
  }
  
  return parts.join('。')
}

/**
 * 生成文件描述
 */
function generateFileDescription(content, filePath) {
  const parts = []
  
  const fileName = filePath.split('/').pop()
  parts.push(`文件 ${fileName} 的内容:`)
  
  if (content.type === 'code') {
    parts.push(`这是一个代码文件，使用 ${content.language || '未知'} 语言`)
  } else if (content.type === 'data') {
    parts.push(`这是一个数据文件`)
  } else if (content.type === 'document') {
    parts.push(`这是一个文档文件`)
  }
  
  if (content.content) {
    parts.push(`内容摘要: ${content.content.slice(0, 300)}`)
  }
  
  return parts.join('。')
}

/**
 * 生成搜索描述
 */
function generateSearchDescription(results, query) {
  const parts = []
  
  parts.push(`关于"${query}"的搜索结果:`)
  
  if (results.items?.length) {
    parts.push(`找到 ${results.items.length} 个相关文件`)
    
    const topResults = results.items.slice(0, 5)
    for (const item of topResults) {
      parts.push(`- ${item.name} (${item.path})`)
    }
  } else {
    parts.push('没有找到直接匹配的文件')
  }
  
  return parts.join('。')
}

/**
 * 获取最近视觉上下文
 */
export function getRecentVisionContext(limit = 3) {
  const entries = Array.from(visionContextCache.entries())
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .slice(0, limit)
  
  return entries.map(([key, value]) => ({ key, value }))
}

/**
 * 清除视觉缓存
 */
export function clearVisionCache() {
  visionContextCache.clear()
  lastCapture = null
}

/**
 * 检查视觉桥接状态
 */
export function getVisionBridgeStatus() {
  const visionStatus = VISION_SYSTEM.getStatus()
  return {
    initialized,
    visionCapabilities: visionStatus.capabilities,
    cachedContexts: visionContextCache.size,
    hasLastCapture: !!lastCapture,
  }
}