// meta-learning framework barrel export.
//
// Public surface:
//   - Bandit (UCB1):       select, update, getArmStats, getOverview, resetForTest
//   - Reflection (depth):  decideDepth, recordUsage, buildPrompt, getBudgetSnapshot, resetForTest
//   - Trigger (90/10):     decide, recordTrigger, activeRatioInWindow, isCooldownOk, resetForTest
//   - Planner (70/30):     decide, recordOutcome, singleRatioInWindow, wasLastMultiFailed, resetForTest
//   - Orchestrator:        runMetaLearningCycle, getMetaOverview, runLearningCycle (v1 compat),
//                          markLessonDone (v1 compat), loadControllerState, saveControllerState,
//                          defaultControllerState, resetForTest
//   - State I/O:           loadState + saveState for each module (path-based persistence)

export {
  select,
  update,
  getArmStats,
  getOverview,
  defaultState as defaultBanditState,
  loadState as loadBanditState,
  saveState as saveBanditState,
  resetForTest as resetBanditForTest,
} from './bandit.js'

export {
  decideDepth,
  recordUsage,
  buildPrompt,
  getBudgetSnapshot,
  defaultState as defaultReflectionState,
  loadState as loadReflectionState,
  saveState as saveReflectionState,
  resetForTest as resetReflectionForTest,
} from './reflection.js'

export {
  decide,
  recordTrigger,
  activeRatioInWindow,
  activeQuotaRemaining,
  isCooldownOk,
  defaultState as defaultTriggerState,
  loadState as loadTriggerState,
  saveState as saveTriggerState,
  resetForTest as resetTriggerForTest,
} from './trigger.js'

export {
  decide as decidePlan,
  recordOutcome,
  singleRatioInWindow,
  wasLastMultiFailed,
  defaultState as defaultPlannerState,
  loadState as loadPlannerState,
  saveState as savePlannerState,
  resetForTest as resetPlannerForTest,
} from './planner.js'

export {
  runMetaLearningCycle,
  getMetaOverview,
  runLearningCycle,
  markLessonDone,
  defaultControllerState,
  loadControllerState,
  saveControllerState,
  resetForTest as resetMetaForTest,
} from './meta-controller.js'
