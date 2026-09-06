// Self-modify framework barrel export.
//
// Public surface:
//   analyzeCodebase, pickTopCandidates
//   parsePatch, applyPatch, restoreBackup, checkSyntax, applyEditSafely
//   runTests, runAllChecks, checkSyntax, checkDiffSize
//   isGitRepo, getHeadCommit, gitAdd, gitCommit, gitRevert, commitIfPasses
//   _resetForTest

export {
  analyzeCodebase,
  pickTopCandidates,
  _resetForTest
} from './code-analyzer.js'

export {
  parsePatch,
  applyPatch,
  restoreBackup,
  checkSyntax,
  applyEditSafely,
  applyHunks
} from './code-editor.js'

export {
  checkSyntax as checkSyntaxSafety,
  runTests,
  checkDiffSize,
  runAllChecks
} from './safety-checker.js'

export {
  isGitRepo,
  getHeadCommit,
  gitAdd,
  gitCommit,
  gitRevert,
  getDiff,
  commitIfPasses
} from './git-commit.js'
