import assert from 'node:assert/strict';
import { buildMermaid, buildSvg } from './exports.js';

const planner = {
  name: 'Launch & Review',
  tasks: [
    { id: 'a', title: 'Research "needs"', estimatedHours: 2, completed: true, dependencyIds: [] },
    { id: 'b', title: 'Build\nprototype', estimatedHours: 5, completed: false, dependencyIds: ['a'] },
  ],
};

const mermaid = buildMermaid(planner);
assert.match(mermaid, /^flowchart LR/);
assert.match(mermaid, /task_1 --> task_2/);
assert.doesNotMatch(mermaid, /Research "needs"/);
assert.doesNotMatch(mermaid, /Build\nprototype/);

const svg = buildSvg(planner, new Date('2026-11-11T12:00:00Z'));
assert.match(svg, /Launch &amp; Review/);
assert.match(svg, /marker-end="url\(#arrow\)"/);
assert.doesNotMatch(svg, /Research "needs"/);

const manualSvg = buildSvg({ ...planner, tasks: [
  { ...planner.tasks[0], position: { x: -200, y: -100 } },
  { ...planner.tasks[1], position: { x: 200, y: 200 } },
] }, new Date('2026-11-11T12:00:00Z'));
assert.match(manualSvg, /<rect x="36" y="64"/);
assert.match(manualSvg, /<rect x="436" y="364"/);
assert.match(manualSvg, /M 296 129 C/);

console.log('export tests passed');
