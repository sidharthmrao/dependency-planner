const STORAGE_KEY = 'task-dependencies-v1';

export function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved)) return [];
    return saved.map((task) =>
      Number.isFinite(task.estimatedHours) && task.estimatedHours > 0
        ? task
        : { ...task, estimatedHours: 1 },
    );
  } catch {
    return [];
  }
}

export function saveTasks(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return true;
  } catch {
    return false;
  }
}

export function removeTask(tasks, taskId) {
  if (!tasks.some((task) => task.id === taskId)) return tasks;
  return tasks
    .filter((task) => task.id !== taskId)
    .map((task) => ({
      ...task,
      dependencyIds: task.dependencyIds.filter((id) => id !== taskId),
    }));
}

export function parseImportedTasks(data) {
  const rawTasks = Array.isArray(data) ? data : data?.tasks;
  if (!Array.isArray(rawTasks)) throw new Error('The file does not contain a task list.');

  const tasks = rawTasks.map((task) => {
    if (
      !task ||
      typeof task.id !== 'string' ||
      !task.id ||
      task.id.includes('->') ||
      typeof task.title !== 'string' ||
      !task.title.trim() ||
      !Array.isArray(task.dependencyIds) ||
      task.dependencyIds.some((id) => typeof id !== 'string')
    ) {
      throw new Error('The file contains an invalid task.');
    }
    return {
      id: task.id,
      title: task.title.trim(),
      description: typeof task.description === 'string' ? task.description : '',
      estimatedHours: Number.isFinite(task.estimatedHours) && task.estimatedHours > 0
        ? task.estimatedHours
        : 1,
      dependencyIds: [...task.dependencyIds],
      completed: task.completed === true,
    };
  });

  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error('The file contains duplicate task IDs.');
  for (const task of tasks) {
    for (const dependencyId of task.dependencyIds) {
      if (!ids.has(dependencyId) || wouldCreateCycle(tasks, task.id, dependencyId)) {
        throw new Error('The file contains an invalid dependency.');
      }
    }
  }
  return tasks;
}

// Following dependencies from a candidate must never lead back to the task.
export function wouldCreateCycle(tasks, taskId, candidateId) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set();

  function reachesTask(id) {
    if (id === taskId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (byId.get(id)?.dependencyIds ?? []).some(reachesTask);
  }

  return reachesTask(candidateId);
}
