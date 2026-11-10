import assert from 'node:assert/strict';
import test from 'node:test';
import { getCriticalPath, getPriorityRanks } from './graphMetrics.js';

const tasks = [
  { id: 'a', dependencyIds: [], completed: false, estimatedHours: 2 },
  { id: 'b', dependencyIds: ['a'], completed: false, estimatedHours: 3 },
  { id: 'c', dependencyIds: ['a'], completed: false, estimatedHours: 4 },
  { id: 'd', dependencyIds: ['b'], completed: false, estimatedHours: 5 },
  { id: 'e', dependencyIds: ['c'], completed: false, estimatedHours: 6 },
  { id: 'f', dependencyIds: [], completed: false, estimatedHours: 1 },
];

test('ready tasks rank by unfinished downstream work', () => {
  const ranks = getPriorityRanks(tasks);
  assert.deepEqual(ranks.get('a'), { rank: 1, downstreamCount: 4 });
  assert.deepEqual(ranks.get('f'), { rank: 2, downstreamCount: 0 });
  assert.equal(ranks.has('b'), false);
});

test('equal priorities share a number without skipping the next number', () => {
  const tiedTasks = [
    { id: 'a', dependencyIds: [], completed: false },
    { id: 'b', dependencyIds: ['a'], completed: false },
    { id: 'c', dependencyIds: [], completed: false },
    { id: 'd', dependencyIds: ['c'], completed: false },
    { id: 'e', dependencyIds: [], completed: false },
  ];
  const ranks = getPriorityRanks(tiedTasks);
  assert.equal(ranks.get('a').rank, 1);
  assert.equal(ranks.get('c').rank, 1);
  assert.equal(ranks.get('e').rank, 2);
});

test('critical path includes the longest duration chain and its timing', () => {
  const path = getCriticalPath(tasks);
  assert.equal(path.available, true);
  assert.equal(path.totalHours, 12);
  assert.deepEqual(path.taskIds, ['a', 'c', 'e']);
  assert.deepEqual(path.edgeIds, ['a->c', 'c->e']);
});

test('completed tasks do not contribute time or appear on the remaining critical path', () => {
  const withCompleted = tasks.map((task) =>
    task.id === 'a' ? { ...task, completed: true, estimatedHours: null } : task,
  );
  const path = getCriticalPath(withCompleted);
  assert.equal(path.available, true);
  assert.equal(path.totalHours, 10);
  assert.deepEqual(path.taskIds, ['c', 'e']);
  assert.deepEqual(path.edgeIds, ['c->e']);
});

test('a finished project has no remaining critical path time', () => {
  const completed = tasks.map((task) => ({ ...task, completed: true }));
  const path = getCriticalPath(completed);
  assert.equal(path.available, true);
  assert.equal(path.totalHours, 0);
  assert.deepEqual(path.taskIds, []);
});

test('critical path requires an estimate for every task', () => {
  const withoutEstimate = tasks.map((task) =>
    task.id === 'f' ? { ...task, estimatedHours: null } : task,
  );
  assert.deepEqual(getCriticalPath(withoutEstimate), {
    available: false,
    missingCount: 1,
    taskIds: [],
    edgeIds: [],
    totalHours: 0,
  });
});
