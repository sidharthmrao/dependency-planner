function taskMap(tasks) {
  return new Map(tasks.map((task) => [task.id, task]));
}

export function getPriorityRanks(tasks) {
  const byId = taskMap(tasks);
  const dependents = new Map(tasks.map((task) => [task.id, []]));

  for (const task of tasks) {
    for (const dependencyId of task.dependencyIds) {
      dependents.get(dependencyId)?.push(task.id);
    }
  }

  function unfinishedDownstreamCount(id) {
    const visited = new Set();
    const pending = [...dependents.get(id)];
    while (pending.length) {
      const nextId = pending.pop();
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      pending.push(...(dependents.get(nextId) ?? []));
    }
    return [...visited].filter((nextId) => !byId.get(nextId)?.completed).length;
  }

  const ready = tasks
    .filter(
      (task) =>
        !task.completed &&
        task.dependencyIds.every((id) => !byId.has(id) || byId.get(id).completed),
    )
    .map((task) => ({ id: task.id, downstreamCount: unfinishedDownstreamCount(task.id) }))
    .sort((a, b) => b.downstreamCount - a.downstreamCount);

  const ranks = new Map();
  let currentRank = 0;
  ready.forEach((item, index) => {
    const previous = ready[index - 1];
    if (!previous || previous.downstreamCount !== item.downstreamCount) currentRank += 1;
    ranks.set(item.id, { rank: currentRank, downstreamCount: item.downstreamCount });
  });
  return ranks;
}

export function getCriticalPath(tasks) {
  if (tasks.length === 0) {
    return { available: false, missingCount: 0, taskIds: [], edgeIds: [], totalHours: 0 };
  }
  const remainingTasks = tasks.filter((task) => !task.completed);
  const missingCount = remainingTasks.filter(
    (task) => !Number.isFinite(task.estimatedHours) || task.estimatedHours <= 0,
  ).length;
  if (missingCount > 0) {
    return { available: false, missingCount, taskIds: [], edgeIds: [], totalHours: 0 };
  }

  const byId = taskMap(remainingTasks);
  const memo = new Map();
  const visiting = new Set();

  function longestPathTo(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) throw new Error('Dependency cycle detected');
    visiting.add(id);

    const task = byId.get(id);
    let best = { totalHours: 0, taskIds: [] };
    for (const dependencyId of task.dependencyIds) {
      if (!byId.has(dependencyId)) continue;
      const candidate = longestPathTo(dependencyId);
      if (candidate.totalHours > best.totalHours) best = candidate;
    }

    const result = {
      totalHours: best.totalHours + task.estimatedHours,
      taskIds: [...best.taskIds, id],
    };
    visiting.delete(id);
    memo.set(id, result);
    return result;
  }

  try {
    let longest = { totalHours: 0, taskIds: [] };
    for (const task of remainingTasks) {
      const candidate = longestPathTo(task.id);
      if (candidate.totalHours > longest.totalHours) longest = candidate;
    }
    return {
      available: true,
      missingCount: 0,
      ...longest,
      edgeIds: longest.taskIds.slice(1).map((id, index) => `${longest.taskIds[index]}->${id}`),
    };
  } catch {
    return { available: false, missingCount: 0, taskIds: [], edgeIds: [], totalHours: 0 };
  }
}
