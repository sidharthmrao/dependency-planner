import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';

function statusFor(task, byId) {
  if (task.completed) return 'complete';
  return task.dependencyIds.some((id) => byId.has(id) && !byId.get(id).completed) ? 'blocked' : 'ready';
}

export default function TaskList({ tasks, readOnly, onEdit, onDelete, onToggle, onSetDependencies }) {
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const filtered = useMemo(() => tasks.filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase())), [tasks, search]);
  const groups = ['ready', 'blocked', 'complete'].map((status) => ({
    status,
    tasks: filtered.filter((task) => statusFor(task, byId) === status),
  }));

  return (
    <div className="task-list-view">
      <label className="search-field">
        <span className="sr-only">Search tasks</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" />
      </label>
      {groups.map((group) => group.tasks.length > 0 && (
        <section className="task-group" key={group.status}>
          <h3>{group.status} <span>{group.tasks.length}</span></h3>
          {group.tasks.map((task) => {
            const isExpanded = expanded === task.id;
            return (
              <article className="task-row" key={task.id}>
                <button className="task-row-main" type="button" onClick={() => setExpanded(isExpanded ? null : task.id)} aria-expanded={isExpanded}>
                  <span className={`status-dot ${group.status}`} />
                  <span className="task-row-copy"><strong>{task.title}</strong><small>{task.estimatedHours} h · {task.dependencyIds.length} prerequisite{task.dependencyIds.length === 1 ? '' : 's'}</small></span>
                  {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {isExpanded && (
                  <div className="task-row-details">
                    <p>{task.description || 'No description.'}</p>
                    <label className="dependency-picker">
                      Prerequisites
                      <select
                        multiple
                        disabled={readOnly}
                        value={task.dependencyIds}
                        onChange={(event) => onSetDependencies(task.id, [...event.target.selectedOptions].map((option) => option.value))}
                      >
                        {tasks.filter((candidate) => candidate.id !== task.id).map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                        ))}
                      </select>
                      {!readOnly && <small>Hold Command or Control to select more than one.</small>}
                    </label>
                    {!readOnly && (
                      <div className="task-row-actions">
                        <button type="button" onClick={() => onToggle(task.id)}><Check size={16} />{task.completed ? 'Reopen' : 'Complete'}</button>
                        <button type="button" onClick={() => onEdit(task)}><Pencil size={16} />Edit</button>
                        <button className="danger-text" type="button" onClick={() => onDelete(task)}><Trash2 size={16} />Delete</button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ))}
      {filtered.length === 0 && <p className="empty-state">No tasks match your search.</p>}
    </div>
  );
}
