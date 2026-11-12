import assert from 'node:assert/strict';
import test from 'node:test';
import { autoArrangePositions, BOARD_NODE_WIDTH, nextTaskPosition, resolveTaskPositions } from './layout.js';

const tasks = [
  { id: 'a', dependencyIds: [] },
  { id: 'b', dependencyIds: ['a'] },
];

test('automatic layout is deterministic for legacy tasks', () => {
  assert.deepEqual(autoArrangePositions(tasks), autoArrangePositions(tasks));
  assert.deepEqual(resolveTaskPositions(tasks), autoArrangePositions(tasks));
});

test('saved positions are preserved including negative coordinates', () => {
  const positioned = tasks.map((task, index) => ({ ...task, position: { x: index ? 420 : -180, y: index ? 210 : -90 } }));
  assert.deepEqual(resolveTaskPositions(positioned), { a: { x: -180, y: -90 }, b: { x: 420, y: 210 } });
});

test('new tasks are placed to the right of the board', () => {
  const positioned = tasks.map((task, index) => ({ ...task, position: { x: index * 400, y: 40 } }));
  const next = nextTaskPosition(positioned);
  assert.equal(next.x, 400 + BOARD_NODE_WIDTH + 90);
  assert.equal(next.y, 40);
});
