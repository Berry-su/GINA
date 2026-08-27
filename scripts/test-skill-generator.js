/**
 * test-skill-generator.js — skill-generator 冒烟测试
 *
 * 验证：
 * 1. SKILL.md 格式完整（YAML头部 + Prerequisites + 编号步骤 + 命令代码块）
 * 2. 去重正常（重复技能名拒绝生成）
 * 3. 空参数不崩
 * 4. generateFromReflection 端到端
 * 5. 技能目录结构正确（SKILL.md + references/ + templates/）
 *
 * 用法：cd BaiLongma-refactor-codebase && npx electron scripts/test-skill-generator.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILLS_DIR = path.resolve(__dirname, '../skills');
const TEST_DIR = path.join(SKILLS_DIR, '__test_generated__');

// 确保测试目录干净
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

const {
  generateSkillMd,
  generateSkill,
  generateFromReflection,
  extractStepsFromText,
  sanitizeName,
  skillExists,
  listSkills,
} = await import('../src/memory/skill-generator.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

console.log('\n═══════════════════════════════════════');
console.log('  skill-generator 冒烟测试');
console.log('═══════════════════════════════════════\n');

// ── 1. SKILL.md 格式 ──────────────────────────────────────
console.log('1. SKILL.md 格式完整性');

const md = generateSkillMd({
  name: 'test-skill',
  description: 'A test skill for format validation.',
  tags: ['test', 'smoke'],
  prerequisites: ['Node.js 18+', 'bash'],
  steps: [
    { title: 'Check environment', description: 'Verify dependencies are installed.', commands: ['node --version', 'which bash'] },
    { title: 'Run task', subtitle: 'Main execution', description: 'Execute the core logic.', commands: ['echo "hello world"'] },
  ],
  notes: ['This is a test note.'],
});

assert(md.includes('---'), 'YAML header starts with ---');
assert(md.includes('name: test-skill'), 'name field present');
assert(md.includes('description: A test skill for format validation.'), 'description field present');
assert(md.includes('version: 1.0.0'), 'version field present');
assert(md.includes('author: BaiLongma Agent'), 'author field present');
assert(md.includes('license: MIT'), 'license field present');
assert(md.includes('platforms: macos | linux'), 'platforms field present');
assert(md.includes('tags: [test, smoke]'), 'tags field present');
assert(md.includes('## Prerequisites'), 'Prerequisites section');
assert(md.includes('- Node.js 18+'), 'prerequisite item');
assert(md.includes('## 1. Check environment'), 'numbered step');
assert(md.includes('### Main execution'), 'subtitle');
assert(md.includes('```bash'), 'code block');
assert(md.includes('node --version'), 'command in code block');
assert(md.includes('## Notes'), 'Notes section');
assert(md.includes('This is a test note.'), 'note content');

// YAML 头部结构：两个 --- 包裹
const yamlCount = (md.match(/^---$/gm) || []).length;
assert(yamlCount >= 2, `YAML header delimited by --- (found ${yamlCount})`);

// ── 2. 空参数不崩 ─────────────────────────────────────────
console.log('\n2. 空参数安全性');

// 空步骤
const mdEmpty = generateSkillMd({ name: 'empty-test', description: 'No steps', steps: [], prerequisites: [] });
assert(mdEmpty.includes('## Prerequisites'), 'empty prerequisites still renders section');
assert(mdEmpty.includes('- None'), 'empty prerequisites shows "None"');

// 缺少 name 调用 generateSkill
const noName = generateSkill({ description: 'missing name' }, TEST_DIR);
assert(!noName.ok, 'generateSkill rejects missing name');

// 空 note 的 generateFromReflection
const emptyNote = generateFromReflection({ id: 'test_001', note: '', reflected_at: new Date().toISOString() }, TEST_DIR);
assert(!emptyNote.ok, 'generateFromReflection rejects empty note');

const shortNote = generateFromReflection({ id: 'test_002', note: 'ok', reflected_at: new Date().toISOString() }, TEST_DIR);
assert(!shortNote.ok, 'generateFromReflection rejects too-short note');

// ── 3. 去重 ────────────────────────────────────────────────
console.log('\n3. 去重检测');

const res1 = generateSkill({
  name: 'dedup-test',
  description: 'First creation.',
  steps: [{ title: 'Step 1', commands: ['echo 1'] }],
}, TEST_DIR);
assert(res1.ok, 'first creation succeeds');
assert(fs.existsSync(path.join(TEST_DIR, 'dedup-test', 'SKILL.md')), 'SKILL.md written');

const res2 = generateSkill({
  name: 'dedup-test',
  description: 'Duplicate attempt.',
  steps: [{ title: 'Step 2', commands: ['echo 2'] }],
}, TEST_DIR);
assert(!res2.ok, 'duplicate creation rejected');
assert(res2.reason === 'duplicate', 'reason is duplicate');

// skillExists
assert(skillExists(TEST_DIR, 'dedup-test'), 'skillExists returns true');
assert(!skillExists(TEST_DIR, 'nonexistent-skill'), 'skillExists returns false for missing');

// ── 4. generateFromReflection 端到端 ─────────────────────
console.log('\n4. generateFromReflection 端到端');

const reflection = {
  id: 'ref_test_003',
  note: '排查 Clash 代理不生效问题：1. 检查端口是否在监听 2. 手动设置系统代理 3. 重启浏览器。最终代理通了。',
  reflected_at: new Date().toISOString(),
};

const refResult = generateFromReflection(reflection, TEST_DIR);
assert(refResult.ok, 'generateFromReflection succeeds');
assert(refResult.skillName, 'skillName returned');
assert(refResult.path, 'path returned');

const refMd = fs.readFileSync(path.join(refResult.path, 'SKILL.md'), 'utf8');
assert(refMd.includes('排查-clash-代理不生效问题'), 'skill name in file');
assert(refMd.includes('## 1.'), 'numbered steps extracted');
assert(refMd.includes('## Prerequisites'), 'Prerequisites section present');

// 目录结构
assert(fs.existsSync(path.join(refResult.path, 'references')), 'references/ created');
assert(fs.existsSync(path.join(refResult.path, 'templates')), 'templates/ created');

// ── 5. extractStepsFromText ───────────────────────────────
console.log('\n5. 步骤提取');

const text1 = '1. 打开终端\n2. 运行命令\n```bash\nnpm install\n```\n3. 验证结果';
const steps1 = extractStepsFromText(text1);
assert(steps1.length >= 2, `extracts numbered steps (got ${steps1.length})`);
assert(steps1[0].title.includes('打开终端'), 'first step title');

const text2 = '首先，检查环境\n然后，执行任务\n```bash\nls -la\n```';
const steps2 = extractStepsFromText(text2);
assert(steps2.length >= 1, 'extracts Chinese markers');

const text3 = 'No structured steps here.';
const steps3 = extractStepsFromText(text3);
assert(steps3.length === 0, 'returns empty for unstructured text');

// ── 6. sanitizeName ───────────────────────────────────────
console.log('\n6. 名称清理');

assert(sanitizeName('Hello World!') === 'hello-world', 'sanitizes spaces and punctuation');
assert(sanitizeName('排查-Clash-代理') === '排查-clash-代理', 'preserves Chinese');
assert(sanitizeName('') === 'untitled-skill', 'falls back on empty');
assert(sanitizeName('!!!') === 'untitled-skill', 'falls back on all-punctuation');

// ── 7. listSkills ─────────────────────────────────────────
console.log('\n7. 技能列表');

const list = listSkills(TEST_DIR);
assert(list.length >= 2, `lists created skills (got ${list.length})`);

// ── 清理 ──────────────────────────────────────────────────
console.log('\n清理测试目录...');
fs.rmSync(TEST_DIR, { recursive: true, force: true });
console.log('清理完成。');

// ── 结果 ──────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════');
console.log(`  结果: ${passed} 通过 / ${failed} 失败`);
console.log('═══════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
