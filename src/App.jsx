import React, { useEffect, useRef, useState } from 'react';
import TaskGraph from './TaskGraph.jsx';
import { loadTasks, parseImportedTasks, saveTasks, wouldCreateCycle } from './tasks.js';

function AddTask({ onAdd }) {
  const dialogRef = useRef(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');

  function submit(event) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    onAdd({
      id: crypto.randomUUID(),
      title: cleanTitle,
      description: description.trim(),
      estimatedHours: estimatedHours === '' ? null : Number(estimatedHours),
      dependencyIds: [],
      completed: false,
    });
    setTitle('');
    setDescription('');
    setEstimatedHours('');
    dialogRef.current.close();
  }

  return (
    <>
      <button className="open-task-dialog" type="button" onClick={() => dialogRef.current.showModal()}>
        Add task
      </button>
      <dialog
        className="task-dialog"
        ref={dialogRef}
        aria-labelledby="add-task-heading"
        onClose={() => {
          setTitle('');
          setDescription('');
          setEstimatedHours('');
        }}
      >
        <form className="add-task-form" onSubmit={submit}>
          <h2 id="add-task-heading">Add a task</h2>
          <label className="add-task-field" htmlFor="new-task-title">
            Task name
            <input
              id="new-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task name"
              required
              autoFocus
            />
          </label>
          <label className="add-task-field" htmlFor="new-task-description">
            Description
            <textarea
              id="new-task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What needs to be done?"
              rows="4"
            />
          </label>
          <label className="add-task-field" htmlFor="new-task-duration">
            Estimated hours
            <input
              id="new-task-duration"
              type="number"
              min="0.001"
              step="any"
              value={estimatedHours}
              onChange={(event) => setEstimatedHours(event.target.value)}
              placeholder="e.g. 2.5"
              required
            />
          </label>
          <div className="dialog-actions">
            <button type="button" className="dialog-cancel" onClick={() => dialogRef.current.close()}>
              Cancel
            </button>
            <button type="submit">Add task</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function DataTransfer({ tasks, onImport }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');

  function exportData() {
    const contents = JSON.stringify({ version: 1, tasks }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dependency-planner-tasks.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importData(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const imported = parseImportedTasks(JSON.parse(await file.text()));
      if (tasks.length > 0 && !window.confirm('Replace your current tasks with the imported tasks?')) return;
      onImport(imported);
      setError('');
    } catch (problem) {
      setError(problem instanceof SyntaxError ? 'This is not a valid JSON file.' : problem.message);
    }
  }

  return (
    <div className="data-transfer">
      <button type="button" onClick={exportData}>Export data</button>
      <button type="button" onClick={() => inputRef.current.click()}>Import data</button>
      <input ref={inputRef} type="file" accept=".json,application/json" onChange={importData} hidden />
      {error && <span role="alert" className="import-error">{error}</span>}
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState(loadTasks);
  const [storageAvailable, setStorageAvailable] = useState(true);

  useEffect(() => setStorageAvailable(saveTasks(tasks)), [tasks]);

  function updateTask(taskId, changes) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...changes } : task)),
    );
  }

  function toggleComplete(taskId) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task,
      ),
    );
  }

  function addDependency(taskId, dependencyId) {
    setTasks((current) => {
      if (wouldCreateCycle(current, taskId, dependencyId)) return current;
      return current.map((task) =>
        task.id === taskId && !task.dependencyIds.includes(dependencyId)
          ? { ...task, dependencyIds: [...task.dependencyIds, dependencyId] }
          : task,
      );
    });
  }

  function removeDependencies(edges) {
    setTasks((current) =>
      current.map((task) => {
        const removedIds = edges.filter((edge) => edge.target === task.id).map((edge) => edge.source);
        return removedIds.length
          ? { ...task, dependencyIds: task.dependencyIds.filter((id) => !removedIds.includes(id)) }
          : task;
      }),
    );
  }

  return (
    <main className="app-shell">
      <header className="page-top">
        <h1>Dependency-based Project Planner</h1>
        <div className="header-actions">
          <DataTransfer tasks={tasks} onImport={setTasks} />
          <AddTask onAdd={(task) => setTasks((current) => [...current, task])} />
        </div>
      </header>
      {!storageAvailable && (
        <p className="storage-warning" role="alert">
          This browser cannot save tasks for this file. Export your data before closing it.
        </p>
      )}
      <TaskGraph
        tasks={tasks}
        onUpdateTask={updateTask}
        onToggleComplete={toggleComplete}
        onAddDependency={addDependency}
        onRemoveDependencies={removeDependencies}
      />
    </main>
  );
}
