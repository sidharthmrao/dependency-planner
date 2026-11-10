import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTasks, parseImportedTasks, saveTasks } from './tasks.js';

test('previously saved tasks without estimates receive one hour', () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => JSON.stringify([
      { id: 'old', estimatedHours: null },
      { id: 'older' },
      { id: 'estimated', estimatedHours: 2.5 },
    ]),
  };

  try {
    assert.deepEqual(loadTasks().map((task) => task.estimatedHours), [1, 1, 2.5]);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test('exported tasks can be imported and old estimates are filled', () => {
  const imported = parseImportedTasks({
    version: 1,
    tasks: [
      { id: 'a', title: 'First', dependencyIds: [], completed: true },
      { id: 'b', title: 'Second', dependencyIds: ['a'], completed: false, estimatedHours: 2 },
    ],
  });
  assert.equal(imported[0].estimatedHours, 1);
  assert.equal(imported[1].estimatedHours, 2);
  assert.deepEqual(imported[1].dependencyIds, ['a']);
});

test('import rejects circular dependencies', () => {
  assert.throws(
    () => parseImportedTasks({ tasks: [
      { id: 'a', title: 'A', dependencyIds: ['b'] },
      { id: 'b', title: 'B', dependencyIds: ['a'] },
    ] }),
    /invalid dependency/,
  );
});

test('save failure is reported without crashing the app', () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem: () => { throw new Error('Storage blocked'); } };
  try {
    assert.equal(saveTasks([]), false);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});
