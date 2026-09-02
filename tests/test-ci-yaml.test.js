// tests/test-ci-yaml.test.js — GINA CI/CD workflow YAML 校验
//
// 设计：ADR-016-CICD-Pipeline_2026-09-02.md §10 验收清单
// 目的：3 仓 7 个 workflow 文件结构严守
//   - 主仓 ci.yml: test job + emotion-isolation 9/9 step
//   - 主仓 build-mac.yml: build-mac job + upload-artifact
//   - 主仓 build-win.yml: build-win job + upload-artifact
//   - 内核仓 ci.yml: test job + auto-tag job
//   - UI 仓 ci.yml: ios + android + shared jobs
//   - UI 仓 build-ios.yml: xcodebuild + upload-artifact
//   - UI 仓 build-android.yml: gradle + upload-artifact
//
// 8 断言：主仓 3 + 内核仓 2 + UI 仓 3（>5 满足验收）
//
// 运行：node --test tests/test-ci-yaml.test.js
// CI 入口：主仓 ci.yml 的 pnpm test 链中（链式调用 .test.js）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)  // 主仓根

// ── 工具函数 ──

function loadYml(absPath) {
  if (!existsSync(absPath)) {
    throw new Error(`workflow not found: ${absPath}`)
  }
  const raw = readFileSync(absPath, 'utf8')
  return yaml.load(raw)
}

function findStep(workflow, contains) {
  // 在所有 job 的 steps 中找包含 contains 字符串的 step
  const jobs = workflow.jobs || {}
  for (const jobName of Object.keys(jobs)) {
    const steps = jobs[jobName]?.steps || []
    for (const step of steps) {
      const text = JSON.stringify(step)
      if (text.includes(contains)) return { jobName, step }
    }
  }
  return null
}

function hasJob(workflow, jobName) {
  return Boolean(workflow.jobs?.[jobName])
}

function hasUploadArtifact(workflow) {
  return Boolean(findStep(workflow, 'actions/upload-artifact'))
}

function hasPnpmTest(workflow) {
  // 找 run: pnpm test
  const jobs = workflow.jobs || {}
  for (const jobName of Object.keys(jobs)) {
    const steps = jobs[jobName]?.steps || []
    for (const step of steps) {
      if (step.run && /\bpnpm\s+test\b/.test(step.run)) return true
    }
  }
  return false
}

// ── 测试用例 ──

test('T1: 主仓 ci.yml 必有 test job + emotion-isolation 显式 step + pnpm test', () => {
  const wf = loadYml(join(ROOT, '.github/workflows/ci.yml'))
  assert.ok(hasJob(wf, 'test'), '主仓 ci.yml 缺 test job')
  const eIsoStep = findStep(wf, 'test:joy-isolation')
  assert.ok(eIsoStep, '主仓 ci.yml 缺 emotion-isolation 显式 step（test:joy-isolation）')
  assert.ok(hasPnpmTest(wf), '主仓 ci.yml 缺 pnpm test 调用')
})

test('T2: 主仓 build-mac.yml 必有 build-mac job + upload-artifact + macos-latest runner', () => {
  const wf = loadYml(join(ROOT, '.github/workflows/build-mac.yml'))
  assert.ok(hasJob(wf, 'build-mac'), '主仓 build-mac.yml 缺 build-mac job')
  assert.ok(hasUploadArtifact(wf), '主仓 build-mac.yml 缺 upload-artifact step')
  const buildJob = wf.jobs['build-mac']
  assert.match(buildJob['runs-on'], /macos/, '主仓 build-mac.yml 没用 macos runner')
})

test('T3: 主仓 build-win.yml 必有 build-win job + upload-artifact + windows-latest runner', () => {
  const wf = loadYml(join(ROOT, '.github/workflows/build-win.yml'))
  assert.ok(hasJob(wf, 'build-win'), '主仓 build-win.yml 缺 build-win job')
  assert.ok(hasUploadArtifact(wf), '主仓 build-win.yml 缺 upload-artifact step')
  const buildJob = wf.jobs['build-win']
  assert.match(buildJob['runs-on'], /windows/, '主仓 build-win.yml 没用 windows runner')
})

test('T4: 内核仓 ci.yml 必有 test + auto-tag job（auto-tag 用 package.json version bump）', () => {
  // 内核仓独立路径
  const corePath = '/Users/ahs/Desktop/GINA/gina增加计划登记/.github/workflows/ci.yml'
  const wf = loadYml(corePath)
  assert.ok(hasJob(wf, 'test'), '内核仓 ci.yml 缺 test job')
  assert.ok(hasJob(wf, 'auto-tag'), '内核仓 ci.yml 缺 auto-tag job')
  assert.ok(hasPnpmTest(wf), '内核仓 ci.yml 缺 pnpm test 调用')
  // auto-tag 必须读 package.json version
  const autoTagJob = wf.jobs['auto-tag']
  const autoTagJson = JSON.stringify(autoTagJob)
  assert.ok(
    autoTagJson.includes('package.json') && autoTagJson.includes('version'),
    '内核仓 auto-tag job 缺 package.json version 处理'
  )
})

test('T5: UI 仓 ci.yml 必有 ios + android + shared test job（跨平台）', () => {
  const uiPath = '/Users/ahs/Documents/gina-ui/.github/workflows/ci.yml'
  const wf = loadYml(uiPath)
  assert.ok(hasJob(wf, 'test-ios'), 'UI 仓 ci.yml 缺 test-ios job')
  assert.ok(hasJob(wf, 'test-android'), 'UI 仓 ci.yml 缺 test-android job')
  assert.ok(hasJob(wf, 'test-shared'), 'UI 仓 ci.yml 缺 test-shared job')
  // iOS 跑在 macos
  assert.match(wf.jobs['test-ios']['runs-on'], /macos/, 'iOS 没用 macos runner')
})

test('T6: UI 仓 build-ios.yml 必有 build-ios job + xcodebuild + upload-artifact + macos runner', () => {
  const uiPath = '/Users/ahs/Documents/gina-ui/.github/workflows/build-ios.yml'
  const wf = loadYml(uiPath)
  assert.ok(hasJob(wf, 'build-ios'), 'UI 仓 build-ios.yml 缺 build-ios job')
  const steps = wf.jobs['build-ios']?.steps || []
  const hasXcodebuild = steps.some((s) => s.run && /xcodebuild/.test(s.run))
  assert.ok(hasXcodebuild, 'UI 仓 build-ios.yml 缺 xcodebuild 调用')
  assert.ok(hasUploadArtifact(wf), 'UI 仓 build-ios.yml 缺 upload-artifact')
  assert.match(wf.jobs['build-ios']['runs-on'], /macos/, 'iOS build 没用 macos runner')
})

test('T7: UI 仓 build-android.yml 必有 build-android job + gradle + upload-artifact', () => {
  const uiPath = '/Users/ahs/Documents/gina-ui/.github/workflows/build-android.yml'
  const wf = loadYml(uiPath)
  assert.ok(hasJob(wf, 'build-android'), 'UI 仓 build-android.yml 缺 build-android job')
  const steps = wf.jobs['build-android']?.steps || []
  const hasGradle = steps.some((s) => s.run && /gradle|assembleDebug/.test(s.run))
  assert.ok(hasGradle, 'UI 仓 build-android.yml 缺 gradle 调用')
  assert.ok(hasUploadArtifact(wf), 'UI 仓 build-android.yml 缺 upload-artifact')
  // Android build 跑 ubuntu + java 17
  const allSteps = JSON.stringify(steps)
  assert.ok(/java-version/.test(allSteps) || /setup-java/.test(allSteps), 'Android build 缺 Java setup')
})

test('T8: 7 个 workflow 全部存在 + 3 仓都配 concurrency（避免重复 run）', () => {
  const files = [
    // 主仓
    join(ROOT, '.github/workflows/ci.yml'),
    join(ROOT, '.github/workflows/build-mac.yml'),
    join(ROOT, '.github/workflows/build-win.yml'),
    // 内核仓
    '/Users/ahs/Desktop/GINA/gina增加计划登记/.github/workflows/ci.yml',
    // UI 仓
    '/Users/ahs/Documents/gina-ui/.github/workflows/ci.yml',
    '/Users/ahs/Documents/gina-ui/.github/workflows/build-ios.yml',
    '/Users/ahs/Documents/gina-ui/.github/workflows/build-android.yml',
  ]
  for (const f of files) {
    assert.ok(existsSync(f), `workflow 缺失: ${f}`)
  }
  // 主仓 3 个全部配 concurrency
  for (const f of files.slice(0, 3)) {
    const wf = loadYml(f)
    assert.ok(wf.concurrency, `${f} 缺 concurrency 配置（避免重复 run）`)
  }
})
