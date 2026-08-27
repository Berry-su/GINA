// use-node20-better-sqlite3.cjs
// 系统 Node（ABI 115）跑测试时，把 better-sqlite3 加载重定向到
// .test-deps 里为 Node 编译的副本（ABI 115）——CJS require 和 ESM import 都覆盖。
// Electron 运行时（ABI 130）不受影响，仍用项目内 node_modules 那份。
// 用法：NODE_OPTIONS=--require=./scripts/use-node20-better-sqlite3.cjs node ./src/test-xxx.js
'use strict';

if (process.versions.electron) {
  // Electron 自己的 Node：保持默认加载，不动
  return;
}

const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');

const TARGET = path.join(__dirname, '..', '.test-deps', 'node_modules', 'better-sqlite3');

// 1) CJS：require('better-sqlite3') 走这里
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'better-sqlite3') {
    return origResolve.call(this, TARGET, parent, isMain, options);
  }
  return origResolve.call(this, request, parent, isMain, options);
};

// 2) ESM：import 'better-sqlite3' 走这里
try {
  register(path.join(__dirname, 'node20-esm-loader.mjs'), pathToFileURL(__filename));
} catch (e) {
  console.warn('[use-node20-better-sqlite3] ESM hook register failed:', e.message);
}
