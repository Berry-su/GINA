/**
 * vision-perceptor.js — Gina 视觉感知系统
 *
 * 核心功能：
 *   1. 📁 文件浏览 — 查看电脑上的文件和目录
 *   2. 🖼️ 图片识别 — 分析图片内容、OCR 文字识别
 *   3. 🎬 视频分析 — 提取视频帧进行分析
 *   4. 📹 屏幕捕获 — 截取屏幕内容
 *
 * 技术架构：
 *   ┌─────────────────────────────────────────────────────┐
 *   │              视觉感知系统 (Vision)                  │
 *   ├─────────────────────────────────────────────────────┤
 *   │                                                     │
 *   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
 *   │  │ 文件浏览器   │  │ 图片分析器   │  │ 视频分析器   │ │
 *   │  └─────────────┘  └─────────────┘  └─────────────┘ │
 *   │                                                     │
 *   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
 *   │  │ 屏幕捕获器   │  │ OCR 引擎    │  │ 视觉记忆    │ │
 *   │  └─────────────┘  └─────────────┘  └─────────────┘ │
 *   │                                                     │
 *   └─────────────────────────────────────────────────────┘
 *                        │
 *                        ↓
 *   ┌─────────────────────────────────────────────────────┐
 *   │              LLM 视觉能力（可选）                    │
 *   │  - 云端多模态模型（如 GPT-4V, Claude Vision）        │
 *   │  - 本地视觉模型（如 LLaVA, Moondream）               │
 *   └─────────────────────────────────────────────────────┘
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// 支持的图片扩展名
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp',
  '.webp', '.tiff', '.tif', '.heic', '.heif',
  '.svg', '.ico', '.raw', '.cr2', '.nef',
])

// 支持的视频扩展名
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.avi', '.mov', '.mkv', '.webm',
  '.flv', '.wmv', '.m4v', '.3gp', '.mpeg',
  '.mpg', '.vob', '.ts', '.mts',
])

// 支持的文本扩展名（可读取内容）
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.log',
  '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.css', '.scss', '.less', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.rb',
  '.php', '.swift', '.kt', '.scala', '.lua', '.pl',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.vue', '.svelte', '.angular',
  '.csv', '.tsv', '.ini', '.cfg', '.conf', '.toml',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
])

/**
 * 视觉系统配置
 */
const VISION_CONFIG = {
  maxFileSize: 50 * 1024 * 1024,    // 最大文件大小 50MB
  maxImageSize: 10 * 1024 * 1024,  // 最大图片大小 10MB
  maxVideoSize: 500 * 1024 * 1024, // 最大视频大小 500MB
  previewMaxChars: 5000,            // 文本预览最大字符数
  thumbnailSize: 256,              // 缩略图尺寸
  supportedExtensions: {
    images: Array.from(IMAGE_EXTENSIONS),
    videos: Array.from(VIDEO_EXTENSIONS),
    texts: Array.from(TEXT_EXTENSIONS),
  },
  // 常用目录路径
  commonPaths: {
    home: process.env.HOME || '~',
    desktop: path.join(process.env.HOME || '', 'Desktop'),
    documents: path.join(process.env.HOME || '', 'Documents'),
    downloads: path.join(process.env.HOME || '', 'Downloads'),
    pictures: path.join(process.env.HOME || '', 'Pictures'),
    videos: path.join(process.env.HOME || '', 'Movies'),
    music: path.join(process.env.HOME || '', 'Music'),
  },
}

/**
 * 初始化视觉感知系统
 */
export function initVisionSystem() {
  console.log('[视觉系统] 初始化...')

  const capabilities = {
    fileBrowser: true,
    imageAnalysis: true,
    videoAnalysis: true,
    screenCapture: checkScreenCaptureCapability(),
    ocr: checkOCRCapability(),
  }

  console.log('[视觉系统] 能力检测完成:', capabilities)
  return {
    initialized: true,
    capabilities,
    config: VISION_CONFIG,
  }
}

/**
 * 检测屏幕捕获能力
 */
function checkScreenCaptureCapability() {
  // 检查是否有 screencapture 命令（macOS）
  // 或其他平台的截屏工具
  try {
    execSync('which screencapture', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * 检测 OCR 能力
 */
function checkOCRCapability() {
  // 检查是否有 tesseract 或其他 OCR 工具
  try {
    execSync('which tesseract', { stdio: 'pipe' })
    return true
  } catch {
    // 如果没有本地 OCR 工具，标记为需要云端支持
    return false
  }
}

// 避免使用未导入的 execSync
import { execSync } from 'child_process'

/**
 * 文件浏览器：列出目录内容
 */
export async function browseDirectory({
  path: dirPath = '~',
  recursive = false,
  depth = 1,
  filter = null,
  sortBy = 'name',
  showHidden = false,
  fileType = 'all', // all | images | videos | texts
} = {}) {
  try {
    // 解析路径
    const resolvedPath = resolvePath(dirPath)
    
    // 检查目录是否存在
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `路径不存在: ${dirPath}` }
    }

    const stats = fs.statSync(resolvedPath)
    if (!stats.isDirectory()) {
      return { success: false, error: `不是目录: ${dirPath}` }
    }

    // 扫描目录
    const items = scanDirectory(resolvedPath, {
      recursive,
      depth,
      filter,
      sortBy,
      showHidden,
      fileType,
    })

    // 统计信息
    const stats_info = calculateDirectoryStats(resolvedPath)

    return {
      success: true,
      path: resolvedPath,
      items,
      stats: stats_info,
      config: {
        recursive,
        depth,
        fileType,
      },
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}

/**
 * 扫描目录
 */
function scanDirectory(dirPath, options) {
  const items = []
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    
    for (const entry of entries) {
      // 跳过隐藏文件（除非 showHidden）
      if (!options.showHidden && entry.name.startsWith('.')) continue
      
      const fullPath = path.join(dirPath, entry.name)
      const item = {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        size: 0,
        extension: path.extname(entry.name).toLowerCase(),
        modified: null,
        created: null,
        type: 'other',
      }

      // 获取文件信息
      try {
        const stat = fs.statSync(fullPath)
        item.size = stat.size
        item.modified = stat.mtime
        item.created = stat.birthtime
        item.type = classifyFile(item)
      } catch {
        // 忽略权限错误
      }

      // 根据 fileType 过滤
      if (options.fileType !== 'all' && item.type !== options.fileType) {
        continue
      }

      // 应用自定义过滤器
      if (options.filter && !matchesFilter(item, options.filter)) {
        continue
      }

      items.push(item)

      // 递归扫描子目录
      if (entry.isDirectory() && options.recursive && options.depth > 1) {
        const subItems = scanDirectory(fullPath, {
          ...options,
          depth: options.depth - 1,
        })
        items.push(...subItems)
      }
    }
  } catch (e) {
    // 跳过无法访问的目录
  }

  // 排序
  return sortItems(items, options.sortBy)
}

/**
 * 分类文件类型
 */
function classifyFile(item) {
  const ext = item.extension
  if (IMAGE_EXTENSIONS.has(ext)) return 'images'
  if (VIDEO_EXTENSIONS.has(ext)) return 'videos'
  if (TEXT_EXTENSIONS.has(ext)) return 'texts'
  if (item.isDirectory) return 'directory'
  return 'other'
}

/**
 * 匹配过滤器
 */
function matchesFilter(item, filter) {
  const lowerFilter = filter.toLowerCase()
  const lowerName = item.name.toLowerCase()
  return lowerName.includes(lowerFilter)
}

/**
 * 排序文件列表
 */
function sortItems(items, sortBy) {
  return items.sort((a, b) => {
    // 目录始终排在前面
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }

    switch (sortBy) {
      case 'size':
        return b.size - a.size
      case 'modified':
        return new Date(b.modified || 0) - new Date(a.modified || 0)
      case 'type':
        return a.extension.localeCompare(b.extension)
      case 'name':
      default:
        return a.name.localeCompare(b.name)
    }
  })
}

/**
 * 计算目录统计信息
 */
function calculateDirectoryStats(dirPath) {
  let fileCount = 0
  let dirCount = 0
  let totalSize = 0
  const typeCount = { images: 0, videos: 0, texts: 0, other: 0 }

  function scan(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          dirCount++
          scan(fullPath)
        } else if (entry.isFile()) {
          fileCount++
          try {
            const stat = fs.statSync(fullPath)
            totalSize += stat.size
            const type = classifyFile({
              name: entry.name,
              extension: path.extname(entry.name).toLowerCase(),
            })
            typeCount[type] = (typeCount[type] || 0) + 1
          } catch {}
        }
      }
    } catch {}
  }

  scan(dirPath)

  return {
    fileCount,
    dirCount,
    totalSize,
    totalSizeFormatted: formatSize(totalSize),
    typeCount,
  }
}

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i]
}

/**
 * 图片分析器：分析图片内容
 */
export async function analyzeImage({
  filePath,
  maxSize = 4000,
  includeOCR = true,
  includeExif = true,
} = {}) {
  try {
    const resolvedPath = resolvePath(filePath)
    
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `文件不存在: ${filePath}` }
    }

    const stat = fs.statSync(resolvedPath)
    if (stat.size > VISION_CONFIG.maxImageSize) {
      return { success: false, error: '文件过大（>10MB）' }
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return { success: false, error: '不支持的图片格式' }
    }

    // 读取文件数据
    const imageData = fs.readFileSync(resolvedPath)

    // 分析图片
    const analysis = {
      success: true,
      path: resolvedPath,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      format: ext.slice(1).toUpperCase(),
      timestamp: Date.now(),
      analysis: {
        // 基础信息
        width: null,
        height: null,
        aspectRatio: null,
        colorMode: null,
        
        // 内容分析（由 LLM 处理）
        description: null,
        objects: [],
        textContent: null,
        
        // 元数据
        exif: null,
        created: stat.birthtime,
        modified: stat.mtime,
      },
    }

    // 获取图片尺寸
    try {
      const dimensions = getImageDimensions(imageData, ext)
      analysis.analysis.width = dimensions.width
      analysis.analysis.height = dimensions.height
      analysis.analysis.aspectRatio = dimensions.aspectRatio
    } catch {}

    // EXIF 数据
    if (includeExif) {
      analysis.analysis.exif = extractBasicInfo(resolvedPath)
    }

    // 内容理解：接多模态视觉 LLM（能力层 analyze_image 工具，vision 槽）。
    // 未配置 vision 槽时优雅降级为 null，不影响基础元数据。
    if (includeOCR || analysis.analysis.description === null) {
      try {
        const enriched = await enrichWithVisionLLM(resolvedPath)
        if (enriched) {
          analysis.analysis.description = enriched.description ?? analysis.analysis.description
          if (enriched.objects?.length) analysis.analysis.objects = enriched.objects
          if (enriched.textContent) analysis.analysis.textContent = enriched.textContent
          analysis.analysis.visionModel = enriched.model ?? null
        }
      } catch { /* 视觉分析失败不阻断 */ }
    }

    return analysis
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}

/**
 * 调用能力层的 analyze_image 工具做真实多模态理解。
 * 动态 import 避免与 capabilities/executor 的模块加载期循环依赖。
 * @returns {Promise<{description?:string, objects?:string[], textContent?:string, model?:string}|null>}
 */
async function enrichWithVisionLLM(filePath) {
  try {
    const { execAnalyzeImage } = await import('../capabilities/tools/api-capability.js')
    const raw = await execAnalyzeImage({
      image_path: filePath,
      prompt: '请用中文描述这张图片的主要内容；识别其中的物体/人物/场景；如有文字请做完整 OCR 转写。请按 JSON 返回：{"description":"...","objects":["..."],"textContent":"..."}。',
    }, {})
    let data = null
    try { data = JSON.parse(raw) } catch { return null }
    if (data?.ok !== true || !data?.result) return null
    // 尝试解析模型返回的 JSON；失败则把整段文本当描述
    const text = String(data.result)
    try {
      const parsed = JSON.parse(text)
      return {
        description: parsed.description || text,
        objects: Array.isArray(parsed.objects) ? parsed.objects : [],
        textContent: parsed.textContent || '',
        model: data.model || null,
      }
    } catch {
      return { description: text, objects: [], textContent: '', model: data.model || null }
    }
  } catch {
    return null
  }
}

/**
 * 获取图片尺寸
 */
function getImageDimensions(buffer, extension) {
  // PNG
  if (extension === '.png') {
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    return { width, height, aspectRatio: (width / height).toFixed(2) }
  }

  // JPEG (简化版)
  if (['.jpg', '.jpeg'].includes(extension)) {
    // 需要解析 JPEG 标记，简化处理
    let offset = 2
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xFF) break
      const marker = buffer[offset + 1]
      if (marker === 0xC0 || marker === 0xC2) {
        const height = buffer.readUInt16BE(offset + 5)
        const width = buffer.readUInt16BE(offset + 7)
        return { width, height, aspectRatio: (width / height).toFixed(2) }
      }
      const length = buffer.readUInt16BE(offset + 2)
      offset += 2 + length
    }
  }

  // GIF
  if (extension === '.gif') {
    const width = buffer.readUInt16LE(6)
    const height = buffer.readUInt16LE(8)
    return { width, height, aspectRatio: (width / height).toFixed(2) }
  }

  // 默认
  return { width: null, height: null, aspectRatio: null }
}

/**
 * 提取文件基本信息
 */
function extractBasicInfo(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return {
      size: stat.size,
      created: stat.birthtime,
      modified: stat.mtime,
      accessed: stat.atime,
    }
  } catch {
    return null
  }
}

/**
 * 视频分析器：分析视频内容
 * 流程：ffprobe 拿元数据 → ffmpeg 按间隔抽关键帧 → 每帧喂视觉模型 → 汇总成整体理解
 */
export async function analyzeVideo({
  filePath,
  frameInterval = 10,  // 每10秒提取一帧
  maxFrames = 10,
  includeAudio = false,
} = {}) {
  try {
    const resolvedPath = resolvePath(filePath)
    
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `文件不存在: ${filePath}` }
    }

    const stat = fs.statSync(resolvedPath)
    if (stat.size > VISION_CONFIG.maxVideoSize) {
      return { success: false, error: '文件过大（>500MB）' }
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    if (!VIDEO_EXTENSIONS.has(ext)) {
      return { success: false, error: '不支持的视频格式' }
    }

    // 元数据（ffprobe，失败则降级为 null）
    let videoInfo = null
    try { videoInfo = await getVideoInfo(resolvedPath) } catch {}

    // 逐帧抽取 + 视觉模型分析（真正"看懂"视频内容）
    const keyFrames = await extractAndAnalyzeFrames(resolvedPath, { frameInterval, maxFrames })
    const summary = summarizeFrames(keyFrames)
    const objects = collectObjects(keyFrames)

    return {
      success: true,
      path: resolvedPath,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      format: ext.slice(1).toUpperCase(),
      video: videoInfo,
      analysis: {
        keyFrames,
        summary,
        objects,
        audioContent: null,
      },
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}

// 用 ffmpeg 在指定时间点抽一帧
async function extractFrame(videoPath, timeSec, outPath) {
  await execAsync(`ffmpeg -ss ${timeSec} -i "${videoPath}" -frames:v 1 -q:v 2 "${outPath}" -y`)
}

// 从视频按间隔抽关键帧，并逐帧用视觉模型分析
async function extractAndAnalyzeFrames(videoPath, { frameInterval = 10, maxFrames = 10 }) {
  const frames = []
  let duration = null
  try { duration = (await getVideoInfo(videoPath))?.duration || null } catch {}
  if (!duration || duration <= 0) return frames

  const frameCount = Math.min(maxFrames, Math.max(1, Math.floor(duration / frameInterval)))
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-video-'))
  try {
    for (let i = 0; i < frameCount; i++) {
      const timeSec = i * frameInterval
      const framePath = path.join(tmpDir, `frame_${String(i).padStart(3, '0')}.jpg`)
      try {
        await extractFrame(videoPath, timeSec, framePath)
      } catch {
        continue // 某帧抽取失败不影响整体
      }
      if (!fs.existsSync(framePath)) continue
      let vision = null
      try { vision = await enrichWithVisionLLM(framePath) } catch {}
      frames.push({
        timeSec,
        timeFormatted: formatDuration(timeSec),
        description: vision?.description || null,
        objects: vision?.objects || [],
        textContent: vision?.textContent || '',
        model: vision?.model || null,
      })
    }
    return frames
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

// 汇总各帧描述，形成视频整体理解
function summarizeFrames(frames) {
  const described = frames.filter(f => f.description).map(f => `[${f.timeFormatted}] ${f.description}`)
  if (!described.length) return null
  return described.join('\n')
}

// 汇总各帧识别到的物体（去重）
function collectObjects(frames) {
  const set = new Set()
  for (const f of frames) for (const o of f.objects || []) if (o) set.add(o)
  return [...set].slice(0, 50)
}

/**
 * 获取视频详细信息（使用 ffprobe）
 */
async function getVideoInfo(filePath) {
  try {
    const { stdout } = await execAsync(`ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`)
    const data = JSON.parse(stdout)
    
    const videoStream = data.streams.find(s => s.codec_type === 'video')
    const audioStream = data.streams.find(s => s.codec_type === 'audio')

    return {
      duration: data.format?.duration ? parseFloat(data.format.duration) : null,
      durationFormatted: formatDuration(data.format?.duration),
      size: data.format?.size ? parseInt(data.format.size) : null,
      bitrate: data.format?.bit_rate ? parseInt(data.format.bit_rate) : null,
      video: videoStream ? {
        codec: videoStream.codec_name,
        width: videoStream.width,
        height: videoStream.height,
        fps: videoStream.r_frame_rate,
        bitrate: videoStream.bit_rate,
      } : null,
      audio: audioStream ? {
        codec: audioStream.codec_name,
        channels: audioStream.channels,
        sampleRate: audioStream.sample_rate,
        bitrate: audioStream.bit_rate,
      } : null,
    }
  } catch {
    throw new Error('ffprobe 不可用')
  }
}

/**
 * 格式化视频时长
 */
function formatDuration(seconds) {
  if (!seconds) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 屏幕捕获：截取当前屏幕
 */
export async function captureScreen({
  outputPath,
  displayId = null,
  delay = 0,
} = {}) {
  try {
    const timestamp = Date.now()
    const defaultPath = path.join(
      process.env.HOME || '~',
      'Desktop',
      `gina-screenshot-${timestamp}.png`
    )
    const targetPath = outputPath || defaultPath

    // macOS 使用 screencapture
    if (process.platform === 'darwin') {
      const delayArg = delay > 0 ? `-T${delay} ` : ''
      const cmd = `screencapture ${delayArg}${displayId ? `-D${displayId} ` : ''}"${targetPath}"`
      await execAsync(cmd)
    } 
    // Windows 使用 PowerShell
    else if (process.platform === 'win32') {
      await execAsync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bmp); $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${targetPath}') }"`)
    }
    // Linux 使用 gnome-screenshot 或其他工具
    else {
      try {
        await execAsync(`gnome-screenshot -f "${targetPath}"`)
      } catch {
        await execAsync(`import -window root "${targetPath}"`)
      }
    }

    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath)
      return {
        success: true,
        path: targetPath,
        size: stat.size,
        sizeFormatted: formatSize(stat.size),
        timestamp,
      }
    }
    return { success: false, error: '截屏文件未创建' }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}

/**
 * 读取文件内容（文本文件）
 */
export async function readFileContent({
  filePath,
  maxChars = VISION_CONFIG.previewMaxChars,
  encoding = 'utf-8',
} = {}) {
  try {
    const resolvedPath = resolvePath(filePath)
    
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `文件不存在: ${filePath}` }
    }

    const stat = fs.statSync(resolvedPath)
    if (stat.size > VISION_CONFIG.maxFileSize) {
      return { success: false, error: '文件过大（>50MB）' }
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    if (!TEXT_EXTENSIONS.has(ext) && !['.txt', '.md'].includes(ext)) {
      return { 
        success: false, 
        error: '不支持读取此类文件，请使用文件浏览功能查看',
        fileType: classifyFile({ name: path.basename(resolvedPath), extension: ext }),
      }
    }

    const content = fs.readFileSync(resolvedPath, encoding)
    const truncated = content.length > maxChars
    const preview = truncated ? content.slice(0, maxChars) + '\n\n... (内容已截断)' : content

    return {
      success: true,
      path: resolvedPath,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      content: preview,
      totalChars: content.length,
      truncated,
      encoding,
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}

/**
 * 搜索文件
 */
export async function searchFiles({
  query,
  basePath = '~',
  fileType = 'all',
  maxResults = 50,
  searchContent = false,
  contentKeywords = [],
} = {}) {
  try {
    const results = []
    const resolvedPath = resolvePath(basePath)
    
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `路径不存在: ${basePath}` }
    }

    function searchRecursive(dir) {
      if (results.length >= maxResults) return
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        
        for (const entry of entries) {
          if (results.length >= maxResults) break
          if (entry.name.startsWith('.')) continue
          
          const fullPath = path.join(dir, entry.name)
          
          if (entry.isDirectory()) {
            searchRecursive(fullPath)
          } else if (entry.isFile()) {
            const lowerQuery = query.toLowerCase()
            const lowerName = entry.name.toLowerCase()
            const ext = path.extname(entry.name).toLowerCase()
            
            // 文件名匹配
            if (lowerName.includes(lowerQuery)) {
              addResult(fullPath, entry, 'filename')
              continue
            }

            // 类型过滤
            if (fileType !== 'all') {
              const type = classifyFile({ name: entry.name, extension: ext })
              if (type !== fileType) continue
            }

            // 内容搜索（仅限文本文件）
            if (searchContent && TEXT_EXTENSIONS.has(ext) && contentKeywords.length > 0) {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8').toLowerCase()
                if (contentKeywords.some(kw => content.includes(kw.toLowerCase()))) {
                  addResult(fullPath, entry, 'content')
                }
              } catch {}
            }
          }
        }
      } catch {}
    }

    function addResult(fullPath, entry, matchType) {
      try {
        const stat = fs.statSync(fullPath)
        results.push({
          name: entry.name,
          path: fullPath,
          size: stat.size,
          sizeFormatted: formatSize(stat.size),
          modified: stat.mtime,
          matchType,
          type: classifyFile({ name: entry.name, extension: path.extname(entry.name).toLowerCase() }),
        })
      } catch {}
    }

    searchRecursive(resolvedPath)

    return {
      success: true,
      query,
      basePath: resolvedPath,
      results,
      totalFound: results.length,
      maxResults,
      truncated: results.length >= maxResults,
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}

/**
 * 路径解析：支持 ~ 展开
 */
function resolvePath(inputPath) {
  if (!inputPath) return process.env.HOME || '/'
  
  // 展开 ~
  if (inputPath === '~' || inputPath.startsWith('~/')) {
    return path.join(process.env.HOME || '', inputPath.slice(1))
  }
  
  // 相对路径转为绝对路径
  if (!path.isAbsolute(inputPath)) {
    return path.resolve(inputPath)
  }
  
  return inputPath
}

/**
 * 获取常用路径快速访问
 */
export function getCommonPaths() {
  const paths = VISION_CONFIG.commonPaths
  const result = {}
  
  for (const [key, dirPath] of Object.entries(paths)) {
    result[key] = {
      path: dirPath,
      exists: fs.existsSync(dirPath),
    }
  }
  
  return result
}

/**
 * 快速浏览图片目录
 */
export async function browseImages({
  dirPath = '~/Pictures',
  limit = 30,
  recursive = false,
} = {}) {
  try {
    const resolvedPath = resolvePath(dirPath)
    const images = []
    
    function scan(dir, remainingDepth) {
      if (images.length >= limit) return
      if (remainingDepth < 0) return
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (images.length >= limit) break
          if (entry.name.startsWith('.')) continue
          
          const fullPath = path.join(dir, entry.name)
          const ext = path.extname(entry.name).toLowerCase()
          
          if (entry.isFile() && IMAGE_EXTENSIONS.has(ext)) {
            try {
              const stat = fs.statSync(fullPath)
              images.push({
                name: entry.name,
                path: fullPath,
                size: stat.size,
                sizeFormatted: formatSize(stat.size),
                modified: stat.mtime,
              })
            } catch {}
          } else if (entry.isDirectory() && recursive) {
            scan(fullPath, remainingDepth - 1)
          }
        }
      } catch {}
    }
    
    scan(resolvedPath, recursive ? 3 : 0)
    
    return {
      success: true,
      directory: resolvedPath,
      images,
      totalFound: images.length,
      limit,
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}

/**
 * 快速浏览视频目录
 */
export async function browseVideos({
  dirPath = '~/Movies',
  limit = 20,
  recursive = false,
} = {}) {
  try {
    const resolvedPath = resolvePath(dirPath)
    const videos = []
    
    function scan(dir, remainingDepth) {
      if (videos.length >= limit) return
      if (remainingDepth < 0) return
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (videos.length >= limit) break
          if (entry.name.startsWith('.')) continue
          
          const fullPath = path.join(dir, entry.name)
          const ext = path.extname(entry.name).toLowerCase()
          
          if (entry.isFile() && VIDEO_EXTENSIONS.has(ext)) {
            try {
              const stat = fs.statSync(fullPath)
              videos.push({
                name: entry.name,
                path: fullPath,
                size: stat.size,
                sizeFormatted: formatSize(stat.size),
                modified: stat.mtime,
              })
            } catch {}
          } else if (entry.isDirectory() && recursive) {
            scan(fullPath, remainingDepth - 1)
          }
        }
      } catch {}
    }
    
    scan(resolvedPath, recursive ? 3 : 0)
    
    return {
      success: true,
      directory: resolvedPath,
      videos,
      totalFound: videos.length,
      limit,
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}

/**
 * 获取视觉系统状态
 */
export function getVisionStatus() {
  const capabilities = {
    fileBrowser: true,
    imageAnalysis: true,
    videoAnalysis: true,
    screenCapture: checkScreenCaptureCapability(),
    ocr: checkOCRCapability(),
  }

  return {
    status: 'active',
    capabilities,
    config: {
      maxFileSize: VISION_CONFIG.maxFileSize,
      maxImageSize: VISION_CONFIG.maxImageSize,
      maxVideoSize: VISION_CONFIG.maxVideoSize,
      supportedImages: IMAGE_EXTENSIONS.size,
      supportedVideos: VIDEO_EXTENSIONS.size,
      supportedTexts: TEXT_EXTENSIONS.size,
    },
    commonPaths: getCommonPaths(),
    platforms: {
      current: process.platform,
      screenCapture: process.platform === 'darwin' || process.platform === 'win32',
    },
  }
}

// ========== 导出 ==========

export const VISION_SYSTEM = {
  init: initVisionSystem,
  browseDirectory,
  analyzeImage,
  analyzeVideo,
  captureScreen,
  readFileContent,
  searchFiles,
  getCommonPaths,
  browseImages,
  browseVideos,
  getStatus: getVisionStatus,
}

export {
  VISION_CONFIG,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  TEXT_EXTENSIONS,
}
