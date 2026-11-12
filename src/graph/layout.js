import dagre from '@dagrejs/dagre';

export const BOARD_NODE_WIDTH = 250;
export const BOARD_NODE_HEIGHT = 220;
export const BOARD_NODE_GAP = 44;
export const POSITION_LIMIT = 1000000;

export function isValidPosition(position) {
  return Boolean(
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Math.abs(position.x) <= POSITION_LIMIT &&
    Math.abs(position.y) <= POSITION_LIMIT,
  );
}

export function autoArrangePositions(tasks, { width = BOARD_NODE_WIDTH, height = BOARD_NODE_HEIGHT } = {}) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: BOARD_NODE_GAP, ranksep: 90, marginx: 30, marginy: 30 });
  graph.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(tasks.map((task) => task.id));
  tasks.forEach((task) => graph.setNode(task.id, { width, height }));
  tasks.forEach((task) => task.dependencyIds.forEach((dependencyId) => {
    if (ids.has(dependencyId)) graph.setEdge(dependencyId, task.id);
  }));
  dagre.layout(graph);
  return Object.fromEntries(tasks.map((task) => {
    const point = graph.node(task.id);
    return [task.id, { x: point.x - width / 2, y: point.y - height / 2 }];
  }));
}

function overlaps(candidate, occupied, width, height) {
  return occupied.some((position) => (
    candidate.x < position.x + width + BOARD_NODE_GAP &&
    candidate.x + width + BOARD_NODE_GAP > position.x &&
    candidate.y < position.y + height + BOARD_NODE_GAP &&
    candidate.y + height + BOARD_NODE_GAP > position.y
  ));
}

export function resolveTaskPositions(tasks, options = {}) {
  const width = options.width || BOARD_NODE_WIDTH;
  const height = options.height || BOARD_NODE_HEIGHT;
  const automatic = autoArrangePositions(tasks, { width, height });
  const resolved = {};
  const occupied = [];

  tasks.filter((task) => isValidPosition(task.position)).forEach((task) => {
    resolved[task.id] = { x: task.position.x, y: task.position.y };
    occupied.push(resolved[task.id]);
  });

  tasks.filter((task) => !isValidPosition(task.position)).forEach((task) => {
    const candidate = { ...automatic[task.id] };
    while (overlaps(candidate, occupied, width, height)) candidate.y += height + BOARD_NODE_GAP;
    resolved[task.id] = candidate;
    occupied.push(candidate);
  });
  return resolved;
}

export function nextTaskPosition(tasks) {
  if (!tasks.length) return { x: 30, y: 30 };
  const positions = resolveTaskPositions(tasks);
  const values = Object.values(positions);
  return {
    x: Math.max(...values.map((position) => position.x)) + BOARD_NODE_WIDTH + 90,
    y: Math.min(...values.map((position) => position.y)),
  };
}
