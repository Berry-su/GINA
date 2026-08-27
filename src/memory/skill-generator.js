/**
 * skill-generator.js — SKILL.md 自动生成引擎（增强版）
 *
 * 复刻 Hermes Agent 的自动技能创建闭环：
 *   解决复杂问题 → 自动生成 SKILL.md → 存入技能库 → 下次复用 → 使用中迭代
 *
 * 增强功能：
 *   - 与 reflection-executor 集成：改进建议 → 自动生成改进技能
 *   - 与 emotion-engine 集成：情绪智能 → 情绪响应技能
 *   - 技能自动分类：按改进类别自动组织技能库
 *   - 技能效果追踪：记录技能使用和改进效果
 *
 * 格式对齐 Hermes SKILL.md 规范：
 *   YAML 头部(name/description/version/author/license/platforms/metadata)
 *   + Markdown 正文(Prerequisites + 编号步骤 + 双路径命令代码块)
 *
 * 目录结构：skills/<技能名>/
 *   ├── SKILL.md
 *   ├── references/
 *   └── templates/
 *
 * 与 self-learning.js 并行运行，互不干扰。
 * 接入点：reflection-executor.js 在成功解决复杂问题时调用 generateFromReflection()。
 */

'use strict';

import path from 'node:path';
import fs from 'node:fs';

// ─── 格式生成 ────────────────────────────────────────────────

/**
 * 生成对齐 Hermes 规范的 SKILL.md 内容。
 * @param {Object} params
 * @param {string} params.name - 技能名（英文标识）
 * @param {string} params.description - 一句话描述
 * @param {string} [params.version] - 版本号，默认 1.0.0
 * @param {string} [params.author] - 作者标识
 * @param {string} [params.license] - 许可协议
 * @param {string} [params.platforms] - 支持平台
 * @param {string[]} [params.tags] - 标签列表
 * @param {string[]} [params.relatedSkills] - 关联技能标识
 * @param {string[]} [params.prerequisites] - 前置依赖
 * @param {Array<{title:string, subtitle?:string, description?:string, commands?:string[]}>} [params.steps] - 编号步骤
 * @param {string[]} [params.notes] - 补充说明
 */
function generateSkillMd({
  name,
  description,
  version = '1.0.0',
  author = 'BaiLongma Agent',
  license = 'MIT',
  platforms = 'macos | linux',
  tags = [],
  relatedSkills = [],
  prerequisites = [],
  steps = [],
  notes = [],
}) {
  // YAML 头部
  const yamlLines = [
    `name: ${name}`,
    `description: ${description}`,
    `version: ${version}`,
    `author: ${author}`,
    `license: ${license}`,
    `platforms: ${platforms}`,
    'metadata:',
    `  tags: [${(tags.length ? tags : ['automation']).join(', ')}]`,
  ];
  if (relatedSkills.length) {
    yamlLines.push(`  related_skills: [${relatedSkills.join(', ')}]`);
  }

  const header = ['---', ...yamlLines, '---'].join('\n');

  // 正文
  const bodyParts = [
    `# ${name}`,
    '',
    description,
    '',
    '## Prerequisites',
    ...(prerequisites.length ? prerequisites.map(p => `- ${p}`) : ['- None']),
    '',
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    bodyParts.push(`## ${i + 1}. ${step.title}`);
    if (step.subtitle) bodyParts.push(`### ${step.subtitle}`);
    if (step.description) {
      bodyParts.push('');
      bodyParts.push(step.description);
    }
    if (step.commands && step.commands.length) {
      bodyParts.push('');
      for (const cmd of step.commands) {
        bodyParts.push('```bash');
        bodyParts.push(cmd);
        bodyParts.push('```');
        bodyParts.push('');
      }
    }
  }

  if (notes.length) {
    bodyParts.push('## Notes');
    for (const n of notes) bodyParts.push(`- ${n}`);
  }

  return header + '\n\n' + bodyParts.join('\n');
}

// ─── 辅助函数 ────────────────────────────────────────────────

function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled-skill';
}

function skillExists(skillsDir, skillName) {
  const filePath = path.join(skillsDir, sanitizeName(skillName), 'SKILL.md');
  return fs.existsSync(filePath);
}

/**
 * 从自然语言解决描述中提取编号步骤。
 * 识别模式：1. xxx / 第一、xxx / 首先, xxx
 */
function extractStepsFromText(text) {
  const lines = String(text || '').split('\n');
  const steps = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 匹配 "1. xxx" / "1) xxx" / "第一步" / "第一、" / "首先,"
    const numMatch = trimmed.match(/^(\d+)[\)\.\、]\s+(.+)/);
    const cnMatch = trimmed.match(/^(第[一二三四五六七八九十]+[步]|[首先然后接着最后])[，,、\s]*(.+)/);
    const codeStart = trimmed.match(/^```(\w*)/);

    if (numMatch || cnMatch) {
      if (current) steps.push(current);
      const title = numMatch ? numMatch[2] : (cnMatch ? cnMatch[2] : trimmed);
      current = { title: title.slice(0, 120), description: '', commands: [] };
    } else if (codeStart !== null && current) {
      // 代码块开始，收集到 commands
      const cmdLines = [];
      let j = lines.indexOf(line) + 1;
      while (j < lines.length && !lines[j].trim().startsWith('```')) {
        cmdLines.push(lines[j]);
        j++;
      }
      if (cmdLines.length) current.commands.push(cmdLines.join('\n'));
    } else if (current) {
      current.description += (current.description ? ' ' : '') + trimmed;
    }
  }
  if (current) steps.push(current);

  return steps;
}

// ─── 核心：从反思记录生成技能 ─────────────────────────────────

/**
 * 从一次成功的反思记录生成为 SKILL.md 并写入技能库。
 * @param {Object} reflection - recordReflection 返回的 reflection 条目
 * @param {string} skillsDir - 技能库存放目录
 * @param {Object} [extra] - 额外上下文，如 { sessionSummary, commands, tags }
 */
function generateFromReflection(reflection, skillsDir, extra = {}) {
  const note = reflection.note || extra.sessionSummary || '';
  if (!note || note.length < 20) {
    return { ok: false, reason: 'note_too_short', message: '反思记录太短，不足以生成技能' };
  }

  // 从 note 中推断技能名
  const firstLine = note.split(/[\n。.]/)[0].replace(/\s+/g, ' ').trim().slice(0, 60);
  const skillName = extra.name || sanitizeName(firstLine);

  // 去重
  if (skillExists(skillsDir, skillName)) {
    return { ok: false, reason: 'duplicate', skillName, message: `技能 "${skillName}" 已存在` };
  }

  const steps = extra.steps || extractStepsFromText(note);
  const description = extra.description || firstLine;

  const content = generateSkillMd({
    name: skillName,
    description,
    prerequisites: extra.prerequisites || [],
    steps: steps.length > 0 ? steps : [{ title: '操作步骤', description: note.slice(0, 500), commands: [] }],
    tags: extra.tags || ['generated', 'reflection'],
    relatedSkills: extra.relatedSkills || [],
    notes: extra.notes || [`自动生成自反思记录 ${reflection.id}，时间 ${reflection.reflected_at}`],
  });

  // 写盘
  const skillDir = path.join(skillsDir, sanitizeName(skillName));
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');

  return {
    ok: true,
    skillName: sanitizeName(skillName),
    path: skillDir,
    content,
  };
}

/**
 * 反思模块对外统一入口函数（entry 格式适配）
 * 由 reflection-executor 调用，接收会话反思记录，自动构建SKILL.md技能文件
 * @param {Object} entry 反思原始数据
 * @param {string} skillsDir 技能根目录路径
 * @returns {{ok:boolean,path?:string}}
 */
function generateFromReflectionEntry(entry, skillsDir) {
  return generateFromReflection({
    id: entry.id || 'auto',
    note: entry.note || '由Gina自主反思生成自动化技能',
    reflected_at: entry.reflected_at || new Date().toISOString(),
  }, skillsDir);
}

/**
 * 从交互记录（对话回合组）直接生成技能，不走反思通道。
 * @param {Object} params
 * @param {string} params.name - 技能名
 * @param {string} params.description - 描述
 * @param {string} params.problem - 解决的问题
 * @param {string} params.solution - 解决方案文本
 * @param {string[]} [params.prerequisites]
 * @param {Array<{title:string,commands?:string[]}>} [params.steps]
 * @param {string[]} [params.tags]
 * @param {string[]} [params.notes]
 * @param {string} skillsDir - 技能库目录
 */
function generateSkill(params, skillsDir) {
  const { name, description, problem, solution, prerequisites, steps: inputSteps, tags, notes } = params;

  if (!name) return { ok: false, error: 'name is required' };

  const safeName = sanitizeName(name);

  if (skillExists(skillsDir, safeName)) {
    return { ok: false, reason: 'duplicate', skillName: safeName, message: `技能 "${safeName}" 已存在` };
  }

  const steps = inputSteps || extractStepsFromText(solution || problem || '');

  const content = generateSkillMd({
    name: safeName,
    description: description || problem || '',
    prerequisites: prerequisites || [],
    steps: steps.length > 0 ? steps : [{ title: '操作步骤', description: (solution || '').slice(0, 500), commands: [] }],
    tags: tags || ['generated'],
    relatedSkills: [],
    notes: notes || [],
  });

  const skillDir = path.join(skillsDir, safeName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');

  return { ok: true, skillName: safeName, path: skillDir, content };
}

// ─── 技能检索 ─────────────────────────────────────────────────

/**
 * 列出所有已生成的技能。
 */
function listSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md')))
    .map(d => ({ name: d.name, path: path.join(skillsDir, d.name) }));
}

// ─── 增强功能：与反思引擎集成 ──────────────────────────────

const CATEGORY_DIRS = {
  response_quality: 'response-quality',
  error_recovery: 'error-recovery',
  user_engagement: 'user-engagement',
  emotion_intelligence: 'emotion-intelligence',
  tool_usage: 'tool-usage',
  knowledge_coverage: 'knowledge-coverage',
  // 中文类别映射
  '响应质量': 'response-quality',
  '错误恢复': 'error-recovery',
  '用户参与': 'user-engagement',
  '情绪智能': 'emotion-intelligence',
  '工具使用': 'tool-usage',
  '知识覆盖': 'knowledge-coverage',
}

/**
 * 从反思改进建议批量生成技能
 * @param {Object} suggestion - reflection-executor 生成的改进建议
 * @param {string} skillsDir - 技能库根目录
 * @returns {Array} 生成结果数组
 */
function generateImprovementSkills(suggestion, skillsDir) {
  if (!suggestion || !suggestion.recommendations || suggestion.recommendations.length === 0) {
    return []
  }

  const results = []
  const timestamp = new Date().toISOString()

  for (const rec of suggestion.recommendations) {
    const category = CATEGORY_DIRS[rec.category] || 'general'
    const skillName = sanitizeName(`${category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

    const skill = generateSkill({
      name: skillName,
      description: `改进技能：${rec.action.slice(0, 80)}`,
      problem: `检测到的改进区域：${rec.category}`,
      solution: rec.action,
      prerequisites: [],
      steps: [{
        title: '执行改进动作',
        description: rec.action,
        commands: [],
      }],
      tags: ['improvement', category, `priority-${rec.priority}`],
      notes: [
        `自动生成自反思分析`,
        `优先级: ${rec.priority}`,
        `原始建议: ${rec.action}`,
        `生成时间: ${timestamp}`,
      ],
    }, path.join(skillsDir, 'improvements', category))

    if (skill.ok) {
      results.push(skill)
    }
  }

  return results
}

/**
 * 生成情绪响应技能
 * @param {string} emotion - 情绪类型
 * @param {string} responseStrategy - 响应策略
 * @param {string} skillsDir - 技能库目录
 */
function generateEmotionResponseSkill(emotion, responseStrategy, skillsDir) {
  const emotionSkillTemplates = {
    anger: {
      name: 'emotion-anger-response',
      description: '检测到用户愤怒时的响应策略',
      steps: [
        { title: '确认情绪', description: '表达对用户情绪的理解和尊重', commands: [] },
        { title: '倾听', description: '让用户充分表达不满，不要急于反驳', commands: [] },
        { title: '共情', description: '表示理解他们的感受，不要轻描淡写', commands: [] },
        { title: '提供帮助', description: '等用户情绪平复后，再提供解决方案', commands: [] },
      ],
    },
    sadness: {
      name: 'emotion-sadness-response',
      description: '检测到用户悲伤时的响应策略',
      steps: [
        { title: '表达关心', description: '让用户感受到被关心和理解', commands: [] },
        { title: '给予空间', description: '不要急于提供解决方案，先允许悲伤', commands: [] },
        { title: '陪伴', description: '表示愿意陪伴和倾听', commands: [] },
        { title: '适时引导', description: '在适当的时候提供积极的展望', commands: [] },
      ],
    },
    urgency: {
      name: 'emotion-urgency-response',
      description: '检测到用户紧迫时的响应策略',
      steps: [
        { title: '确认紧急', description: '识别并确认任务的紧迫性', commands: [] },
        { title: '直接行动', description: '跳过寒暄，直接处理核心问题', commands: [] },
        { title: '简明沟通', description: '使用简洁的语言进行沟通', commands: [] },
        { title: '反馈进度', description: '及时向用户反馈处理进度', commands: [] },
      ],
    },
    confusion: {
      name: 'emotion-confusion-response',
      description: '检测到用户困惑时的响应策略',
      steps: [
        { title: '识别困惑', description: '注意用户表达中的不确定和困惑信号', commands: [] },
        { title: '简化解释', description: '使用简单清晰的语言重新解释', commands: [] },
        { title: '提供例子', description: '通过具体例子帮助理解', commands: [] },
        { title: '确认理解', description: '确认用户是否已经理解', commands: [] },
      ],
    },
  }

  const template = emotionSkillTemplates[emotion]
  if (!template) {
    return { ok: false, reason: 'no_template', emotion }
  }

  const existingSkills = listSkills(path.join(skillsDir, 'emotion'))
  if (existingSkills.some(s => s.name === template.name)) {
    return { ok: false, reason: 'exists', skillName: template.name }
  }

  return generateSkill({
    name: template.name,
    description: template.description,
    problem: `用户情绪: ${emotion}`,
    solution: responseStrategy || template.steps.map(s => s.description).join('\n'),
    prerequisites: ['情绪分析已激活'],
    steps: template.steps,
    tags: ['emotion', 'response', emotion],
    notes: [
      `情绪响应技能：${emotion}`,
      `生成时间: ${new Date().toISOString()}`,
      '当检测到用户表现出此类情绪时，参考此策略进行响应',
    ],
  }, path.join(skillsDir, 'emotion'))
}

/**
 * 技能自动分类
 * @param {string} skillName - 技能名
 * @param {Array<string>} tags - 标签
 * @returns {string} 分类目录
 */
function categorizeSkill(skillName, tags = []) {
  if (tags.includes('emotion')) return 'emotion'
  if (tags.includes('improvement')) {
    const cat = tags.find(t => CATEGORY_DIRS[t])
    return cat ? CATEGORY_DIRS[cat] : 'improvements'
  }
  if (tags.includes('reflection')) return 'reflections'
  if (tags.includes('generated')) return 'generated'
  return 'misc'
}

/**
 * 获取技能库统计
 */
function getSkillStats(skillsDir) {
  const allSkills = listSkills(skillsDir)
  const stats = {
    total: allSkills.length,
    byCategory: {},
    byTag: {},
  }

  for (const skill of allSkills) {
    const skillPath = path.join(skill.path, 'SKILL.md')
    try {
      const content = fs.readFileSync(skillPath, 'utf8')
      const category = categorizeSkill(skill.name, extractTagsFromMd(content))
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1

      const tags = extractTagsFromMd(content)
      for (const tag of tags) {
        stats.byTag[tag] = (stats.byTag[tag] || 0) + 1
      }
    } catch {}
  }

  return stats
}

function extractTagsFromMd(content) {
  const tags = []
  const tagMatch = content.match(/tags:\s*\[([^\]]*)\]/)
  if (tagMatch) {
    tagMatch[1].split(',').forEach(t => {
      const trimmed = t.trim().replace(/^['"]|['"]$/g, '')
      if (trimmed) tags.push(trimmed)
    })
  }
  return tags
}

/**
 * 追踪技能使用情况
 */
function trackSkillUsage(skillsDir, skillName, outcome = 'used') {
  const skillPath = path.join(skillsDir, sanitizeName(skillName), 'SKILL.md')
  if (!fs.existsSync(skillPath)) return null

  const usageFile = path.join(skillsDir, sanitizeName(skillName), 'usage.json')
  let usage = { uses: 0, successes: 0, failures: 0, history: [] }

  try {
    if (fs.existsSync(usageFile)) {
      usage = JSON.parse(fs.readFileSync(usageFile, 'utf8'))
    }
  } catch {}

  usage.uses += 1
  if (outcome === 'success') usage.successes += 1
  else if (outcome === 'failure') usage.failures += 1

  usage.history.push({
    timestamp: Date.now(),
    outcome,
  })

  if (usage.history.length > 100) {
    usage.history = usage.history.slice(-50)
  }

  try {
    fs.writeFileSync(usageFile, JSON.stringify(usage, null, 2), 'utf8')
  } catch {}

  return usage
}

// ─── 统一导出 ──────────────────────────────────────────────────

export {
  generateSkillMd,
  generateFromReflection,
  generateFromReflectionEntry,
  generateSkill,
  extractStepsFromText,
  sanitizeName,
  skillExists,
  listSkills,
  generateImprovementSkills,
  generateEmotionResponseSkill,
  categorizeSkill,
  getSkillStats,
  trackSkillUsage,
}
