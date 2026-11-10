import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { wouldCreateCycle } from './tasks.js';
import { getCriticalPath, getPriorityRanks } from './graphMetrics.js';

const NODE_WIDTH = 250;
const NODE_HEIGHT = 220;
const EDIT_HEIGHT = 325;

function TaskNode({ data }) {
  const { task, status, priority, critical, editing, onEdit, onCancel, onSave, onDelete, onToggleComplete } = data;

  function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title')).trim();
    const hours = String(form.get('estimatedHours')).trim();
    if (!title) return;
    onSave(task.id, {
      title,
      description: String(form.get('description')).trim(),
      estimatedHours: hours === '' ? null : Number(hours),
    });
  }

  return (
    <div className={`graph-node ${status} ${critical ? 'critical' : ''} ${editing ? 'editing' : ''}`}>
      <Handle type="target" position={Position.Left} />
      {editing ? (
        <form className="node-editor nodrag nopan" onSubmit={save} onKeyDown={(event) => event.stopPropagation()}>
          <label>
            Task name
            <input name="title" defaultValue={task.title} required autoFocus />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={task.description} rows="3" />
          </label>
          <label>
            Estimated hours
            <input name="estimatedHours" type="number" min="0.001" step="any" defaultValue={task.estimatedHours ?? ''} required />
          </label>
          <div className="node-actions">
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (window.confirm(`Delete "${task.title}"? Its dependency links will also be removed.`)) {
                  onDelete(task.id);
                }
              }}
            >
              Delete
            </button>
            <span className="node-actions-right">
              <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
              <button type="submit">Save</button>
            </span>
          </div>
        </form>
      ) : (
        <>
          <div className="node-title-row">
            <strong className="graph-node-title" title={task.title}>{task.title}</strong>
            <button className="node-edit nodrag nopan" type="button" onClick={() => onEdit(task.id)}>Edit</button>
          </div>
          <p className="graph-node-description" title={task.description || undefined}>
            {task.description || 'No description'}
          </p>
          <p className="graph-node-estimate">
            {task.estimatedHours == null ? 'No estimate' : `Estimate: ${task.estimatedHours} h`}
          </p>
          <div className="node-flags">
            {priority && (
              <span className="priority-badge" title={`${priority.downstreamCount} unfinished downstream tasks`}>
                Priority #{priority.rank}
              </span>
            )}
            {critical && <span className="critical-badge">Critical path</span>}
          </div>
          <div className="node-footer">
            <span className="graph-node-status">{status}</span>
            <label className="node-complete nodrag nopan">
              <input
                type="checkbox"
                checked={task.completed}
                disabled={!task.completed && status === 'blocked'}
                onChange={() => onToggleComplete(task.id)}
              />
              Complete
            </label>
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { task: TaskNode };

export function layoutGraph(tasks, editingId = null, actions = {}, options = {}) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 44, ranksep: 90, marginx: 30, marginy: 30 });
  graph.setDefaultEdgeLabel(() => ({}));

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const priorityRanks = options.priorityRanks ?? getPriorityRanks(tasks);
  const criticalTaskIds = new Set(options.showCriticalPath ? options.criticalPath?.taskIds : []);
  const criticalEdgeIds = new Set(options.showCriticalPath ? options.criticalPath?.edgeIds : []);
  for (const task of tasks) {
    graph.setNode(task.id, {
      width: NODE_WIDTH,
      height: task.id === editingId ? EDIT_HEIGHT : NODE_HEIGHT,
    });
  }

  const edges = [];
  for (const task of tasks) {
    for (const dependencyId of task.dependencyIds) {
      if (!byId.has(dependencyId)) continue;
      graph.setEdge(dependencyId, task.id);
      const edgeId = `${dependencyId}->${task.id}`;
      const critical = criticalEdgeIds.has(edgeId);
      edges.push({
        id: edgeId,
        source: dependencyId,
        target: task.id,
        type: 'smoothstep',
        className: critical ? 'critical-edge' : undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color: critical ? '#c77700' : undefined },
      });
    }
  }

  dagre.layout(graph);

  const nodes = tasks.map((task) => {
    const blocked = task.dependencyIds.some((id) => byId.has(id) && !byId.get(id).completed);
    const status = task.completed ? 'done' : blocked ? 'blocked' : 'ready';
    const position = graph.node(task.id);
    const height = task.id === editingId ? EDIT_HEIGHT : NODE_HEIGHT;
    return {
      id: task.id,
      type: 'task',
      position: { x: position.x - NODE_WIDTH / 2, y: position.y - height / 2 },
      style: { width: NODE_WIDTH, height },
      data: {
        task,
        status,
        priority: priorityRanks.get(task.id),
        critical: criticalTaskIds.has(task.id),
        editing: task.id === editingId,
        ...actions,
      },
      draggable: false,
    };
  });

  return { nodes, edges };
}

function GraphCanvas({ tasks, priorityRanks, criticalPath, showCriticalPath, onUpdateTask, onDeleteTask, onToggleComplete, onAddDependency, onRemoveDependencies }) {
  const [editingId, setEditingId] = useState(null);
  const layout = useMemo(
    () => layoutGraph(
      tasks,
      editingId,
      {
        onEdit: setEditingId,
        onCancel: () => setEditingId(null),
        onSave: (id, changes) => {
          onUpdateTask(id, changes);
          setEditingId(null);
        },
        onDelete: (id) => {
          onDeleteTask(id);
          setEditingId(null);
        },
        onToggleComplete,
      },
      { priorityRanks, criticalPath, showCriticalPath },
    ),
    [tasks, editingId, priorityRanks, criticalPath, showCriticalPath, onUpdateTask, onDeleteTask, onToggleComplete],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout, setNodes, setEdges]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 250 }));
    return () => cancelAnimationFrame(frame);
  }, [tasks, editingId, fitView]);

  const isValidConnection = useCallback(
    ({ source, target }) =>
      Boolean(source && target && source !== target) &&
      tasks.some((task) => task.id === source) &&
      tasks.some((task) => task.id === target && !task.dependencyIds.includes(source)) &&
      !wouldCreateCycle(tasks, target, source),
    [tasks],
  );

  const onConnect = useCallback(
    ({ source, target }) => {
      if (isValidConnection({ source, target })) onAddDependency(target, source);
    },
    [isValidConnection, onAddDependency],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onEdgesDelete={onRemoveDependencies}
      isValidConnection={isValidConnection}
      nodesDeletable={false}
      nodesDraggable={false}
      edgesReconnectable={false}
      deleteKeyCode={['Backspace', 'Delete']}
      fitView
      fitViewOptions={{ padding: 0.2 }}
    >
      <Background color="#dfe5ec" gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export default function TaskGraph(props) {
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const priorityRanks = useMemo(() => getPriorityRanks(props.tasks), [props.tasks]);
  const criticalPath = useMemo(() => getCriticalPath(props.tasks), [props.tasks]);
  const hours = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(criticalPath.totalHours);

  return (
    <section className="graph-section" aria-labelledby="graph-heading">
      <div className="graph-heading">
        <div>
          <h2 id="graph-heading">Dependency graph</h2>
          <p>To make task B dependent on A, drag from A's right dot to B's left dot. To remove a dependency, select the dependency arrow and press Delete.</p>
        </div>
        <div className="critical-control">
          <button
            type="button"
            disabled={!criticalPath.available}
            aria-pressed={showCriticalPath}
            onClick={() => setShowCriticalPath((current) => !current)}
          >
            {showCriticalPath ? 'Hide critical path' : 'Show critical path'}
          </button>
          {criticalPath.available && showCriticalPath && <strong>{hours} h remaining</strong>}
          {!criticalPath.available && props.tasks.length > 0 && (
            <span>Add estimates to {criticalPath.missingCount} task{criticalPath.missingCount === 1 ? '' : 's'}.</span>
          )}
        </div>
      </div>
      <div className="graph-canvas">
        {props.tasks.length === 0 ? (
          <p className="graph-empty">Add a task to see the graph.</p>
        ) : (
          <ReactFlowProvider>
            <GraphCanvas
              {...props}
              priorityRanks={priorityRanks}
              criticalPath={criticalPath}
              showCriticalPath={showCriticalPath && criticalPath.available}
            />
          </ReactFlowProvider>
        )}
      </div>
    </section>
  );
}
