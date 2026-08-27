/**
 * self-learning.js — 自主学习引擎
 *
 * 定位：把"学习"从对话的副产品，变成 agent 自己发起的正式动作。
 * 每天到点（提醒器/定时器触发）调用 runLearningCycle()：
 *   1. 按九方向五条线进度表，取下一课
 *   2. 扫最近的反思记录，找知识缺口/矛盾点，附加进任务
 *   3. 生成学习任务（含目标来源：arXiv/官方文档），记入任务流水
 *   4. 返回本轮任务摘要，供调用方写笔记/汇报
 *
 * 依赖：仅 node 内置模块；记忆库/反思数据的读取通过注入，缺省时降级为空。
 * 接入点：与 refresh-loop.js 同级，由 ticker 周期调用。
 */

import fs from 'fs';
import path from 'path';

// 九方向五条线进度表。done=true 表示已学完并写笔记。
const DIRECTIONS = [
  {
    line: '主攻线', id: 'ai',
    items: [
      { name: 'Agent记忆机制综述 (arXiv:2404.13501)', done: true },
      { name: 'CoALA 记忆类型学 (arXiv:2309.02427)', done: true },
      { name: 'MemGPT/Letta 分层记忆', done: false },
      { name: 'mem0 提取式记忆', done: false },
      { name: 'GraphRAG 图记忆', done: false },
      { name: '混合检索与重排 (RAG 进阶)', done: false },
      { name: '工具使用与 Function Calling', done: false },
      { name: '多智能体协作', done: false },
      { name: 'LLM 推理与规划', done: false },
    ],
  },
  {
    line: '钱线', id: 'finance',
    items: [
      { name: '金融投资基础：资产类别与风险', done: false },
      { name: '国内地产：政策与周期', done: false },
      { name: '海外地产：市场与税务', done: false },
      { name: 'CRS 信息交换机制', done: false },
      { name: '税务合规与合法筹划', done: false },
    ],
  },
  {
    line: '经营线', id: 'business',
    items: [
      { name: '公司法：公司形态与治理', done: false },
      { name: '工商管理：经营与决策', done: false },
    ],
  },
  {
    line: '底线线', id: 'law',
    items: [
      { name: '刑法总则：罪与非罪边界', done: false },
    ],
  },
  {
    line: '人情线', id: 'emotion',
    items: [
      { name: '人类情感：亲密关系与沟通', done: false },
    ],
  },
];

const DEFAULT_PROGRESS = { directions: DIRECTIONS, updatedAt: null };

function loadProgress(learnDir) {
  try {
    const p = path.join(learnDir, 'progress.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* 读失败则重建 */ }
  return JSON.parse(JSON.stringify(DEFAULT_PROGRESS));
}

function saveProgress(progress, learnDir) {
  progress.updatedAt = new Date().toISOString();
  fs.mkdirSync(learnDir, { recursive: true });
  fs.writeFileSync(path.join(learnDir, 'progress.json'), JSON.stringify(progress, null, 2), 'utf8');
  return progress.updatedAt;
}

// 按线序取第一个未学课程；无剩余则返回 null
function pickNextLesson(progress) {
  for (const line of progress.directions) {
    for (const item of line.items) {
      if (!item.done) return { lineId: line.id, lineName: line.line, item };
    }
  }
  return null;
}

// 扫反思文本，找"缺口/矛盾/没搞懂"信号，附加为本次学习关注点
const GAP_MARKERS = ['没搞懂', '缺口', '矛盾', '失败', '卡住', '不懂', '不会', '待补'];
function findGaps(reflections = []) {
  const gaps = [];
  for (const r of reflections) {
    const text = (typeof r === 'string' ? r : JSON.stringify(r || {})) || '';
    for (const m of GAP_MARKERS) {
      if (text.includes(m)) {
        gaps.push(text.slice(0, 120));
        break;
      }
    }
  }
  return gaps.slice(0, 3);
}

/**
 * 主入口。options: { learnDir, taskLogPath, getReflections }
 * getReflections 由调用方注入（如 reflection-executor 的读取端），缺省返回 []。
 * 返回本轮任务摘要；若无可学课程返回 { done: true }。
 */
export function runLearningCycle(options = {}) {
  const learnDir = options.learnDir || '.';
  const progress = loadProgress(learnDir);
  const next = pickNextLesson(progress);
  const gaps = findGaps(typeof options.getReflections === 'function' ? options.getReflections() : []);

  if (!next) {
    return { done: true, progress: progress.updatedAt || null };
  }

  const task = {
    lineId: next.lineId,
    lineName: next.lineName,
    lesson: next.item.name,
    gaps,
    source: 'arXiv / 官方文档等权威源头',
    createdAt: new Date().toISOString(),
  };

  // 任务流水
  const logPath = options.taskLogPath || path.join(learnDir, 'tasks.json');
  let tasks = [];
  try {
    if (fs.existsSync(logPath)) tasks = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch (e) { tasks = []; }
  tasks.push(task);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(tasks, null, 2), 'utf8');

  saveProgress(progress, learnDir);
  return { done: false, task };
}

// 学完一课回调：标记 done，供笔记落盘后调用；返回下一课预告
export function markLessonDone(learnDir, lineId, lessonName) {
  const progress = loadProgress(learnDir);
  for (const line of progress.directions) {
    if (line.id !== lineId) continue;
    for (const item of line.items) {
      if (!item.done && item.name === lessonName) item.done = true;
    }
  }
  saveProgress(progress, learnDir);
  return pickNextLesson(progress);
}

export { DIRECTIONS, pickNextLesson, findGaps };
