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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
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
