import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTasks } from './tasks.js';

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
