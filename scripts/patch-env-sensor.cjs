const { readFileSync, writeFileSync } = require('fs');
const path = '/Users/ahs/Documents/BaiLongma-refactor-codebase/src/index.js';

let content = readFileSync(path, 'utf8');
const original = content;

// 1. Import: after createTaskManager import
const importMarker = "import { createTaskManager } from './task-manager.js'";
if (!content.includes(importMarker)) {
  console.error('ERROR: import marker not found');
  process.exit(1);
}
content = content.replace(
  importMarker,
  importMarker + "\nimport { createEnvironmentSensor, formatEnvironmentSample } from './environment-sensor.js'"
);
console.log('✓ Import inserted');

// 2. Instance: after taskManager creation block
const instanceMarker = `const taskManager = createTaskManager({
  state,
  getConfig,
  setConfig,
  saveThreadState,
  openCommitment,
  closeCommitment,
  emitEvent,
  insertMemory,
  nowTimestamp,
})`;
if (!content.includes(instanceMarker)) {
  console.error('ERROR: instance marker not found');
  process.exit(1);
}
content = content.replace(
  instanceMarker,
  instanceMarker + '\n\nconst environmentSensor = createEnvironmentSensor()'
);
console.log('✓ Instance inserted');

// 3. Context injection: add environmentSample to baseContextArgs
// The last field in baseContextArgs is selfEvolution, followed by closing }
const ctxMarker = `      selfEvolution: injection.selfEvolution || '',
    }`;
if (!content.includes(ctxMarker)) {
  console.error('ERROR: context marker not found');
  process.exit(1);
}
content = content.replace(
  ctxMarker,
  `      selfEvolution: injection.selfEvolution || '',
      environmentSample: (() => { try { return formatEnvironmentSample(environmentSensor.sample()); } catch { return ''; } })(),
    }`
);
console.log('✓ Context injection inserted');

if (content === original) {
  console.error('ERROR: no changes made');
  process.exit(1);
}

writeFileSync(path, content, 'utf8');
console.log('✓ Patch complete — 3 insertions');
