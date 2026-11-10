import React, { useEffect, useRef, useState } from 'react';
import TaskGraph from './TaskGraph.jsx';
import { loadTasks, saveTasks, wouldCreateCycle } from './tasks.js';

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

export default function App() {
  const [tasks, setTasks] = useState(loadTasks);

  useEffect(() => saveTasks(tasks), [tasks]);

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
        <AddTask onAdd={(task) => setTasks((current) => [...current, task])} />
      </header>
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
