import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  autoArrangePositions,
  BOARD_NODE_HEIGHT,
  BOARD_NODE_WIDTH,
  isValidPosition,
  resolveTaskPositions,
} from './graph/layout.js';

const EDIT_HEIGHT = 325;

function TaskNode({ data }) {
  const { task, status, priority, critical, editing, readOnly, onEdit, onCancel, onSave, onDelete, onToggleComplete } = data;

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
      <Handle type="target" position={Position.Left} isConnectable={!readOnly} />
      {editing ? (
        <form className="node-editor nodrag nopan" onSubmit={save} onKeyDown={(event) => event.stopPropagation()}>
          <label>Task name<input name="title" defaultValue={task.title} required autoFocus /></label>
          <label>Description<textarea name="description" defaultValue={task.description} rows="3" /></label>
          <label>Estimated hours<input name="estimatedHours" type="number" min="0.001" step="any" defaultValue={task.estimatedHours ?? ''} required /></label>
          <div className="node-actions">
            <button type="button" className="danger" onClick={() => {
              if (window.confirm(`Delete "${task.title}"? Its dependency links will also be removed.`)) onDelete(task.id);
            }}>Delete</button>
            <span className="node-actions-right"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="submit">Save</button></span>
          </div>
        </form>
      ) : (
        <>
          <div className="node-title-row">
            <strong className="graph-node-title" title={task.title}>{task.title}</strong>
            {!readOnly && <button className="node-edit nodrag nopan" type="button" onClick={() => onEdit(task.id)}>Edit</button>}
          </div>
          <p className="graph-node-description" title={task.description || undefined}>{task.description || 'No description'}</p>
          <p className="graph-node-estimate">{task.estimatedHours == null ? 'No estimate' : `Estimate: ${task.estimatedHours} h`}</p>
          <div className="node-flags">
            {priority && <span className="priority-badge" title={`${priority.downstreamCount} unfinished downstream tasks`}>Priority #{priority.rank}</span>}
            {critical && <span className="critical-badge">Critical path</span>}
          </div>
          <div className="node-footer">
            <span className="graph-node-status">{status}</span>
            <label className="node-complete nodrag nopan">
              <input type="checkbox" checked={task.completed} disabled={readOnly || (!task.completed && status === 'blocked')} onChange={() => onToggleComplete(task.id)} />
              Complete
            </label>
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} isConnectable={!readOnly} />
    </div>
  );
}

const nodeTypes = { task: TaskNode };
const samePosition = (a, b) => a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

export function layoutGraph(tasks, editingId = null, actions = {}, options = {}) {
  const positions = options.positions || resolveTaskPositions(tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const priorityRanks = options.priorityRanks ?? getPriorityRanks(tasks);
  const criticalTaskIds = new Set(options.showCriticalPath ? options.criticalPath?.taskIds : []);
  const criticalEdgeIds = new Set(options.showCriticalPath ? options.criticalPath?.edgeIds : []);
  const edges = [];
  tasks.forEach((task) => task.dependencyIds.forEach((dependencyId) => {
    if (!byId.has(dependencyId)) return;
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
  }));

  const nodes = tasks.map((task) => {
    const blocked = task.dependencyIds.some((id) => byId.has(id) && !byId.get(id).completed);
    const status = task.completed ? 'done' : blocked ? 'blocked' : 'ready';
    const height = task.id === editingId ? EDIT_HEIGHT : BOARD_NODE_HEIGHT;
    return {
      id: task.id,
      type: 'task',
      position: positions[task.id],
      style: { width: BOARD_NODE_WIDTH, height },
      data: {
        task,
        status,
        priority: priorityRanks.get(task.id),
        critical: criticalTaskIds.has(task.id),
        editing: task.id === editingId,
        ...actions,
      },
      deletable: false,
    };
  });
  return { nodes, edges };
}

function GraphCanvas({ tasks, readOnly = false, priorityRanks, criticalPath, showCriticalPath, arrangeRequest, onUpdateTask, onDeleteTask, onToggleComplete, onAddDependency, onRemoveDependencies, onMoveTask, onAutoArrange }) {
  const [editingId, setEditingId] = useState(null);
  const [phoneLayout, setPhoneLayout] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const pendingPositions = useRef(new Map());
  const draggingId = useRef(null);
  const lastArrangeRequest = useRef(0);
  const canDrag = !readOnly && !phoneLayout;
  const layout = useMemo(() => layoutGraph(tasks, editingId, {
    onEdit: setEditingId,
    onCancel: () => setEditingId(null),
    onSave: (id, changes) => { onUpdateTask(id, changes); setEditingId(null); },
    onDelete: (id) => { onDeleteTask(id); setEditingId(null); },
    onToggleComplete,
    readOnly,
  }, { priorityRanks, criticalPath, showCriticalPath }), [tasks, editingId, readOnly, priorityRanks, criticalPath, showCriticalPath, onUpdateTask, onDeleteTask, onToggleComplete]);
  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setPhoneLayout(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      return layout.nodes.map((next) => {
        const existing = currentById.get(next.id);
        const pending = pendingPositions.current.get(next.id);
        const remote = next.data.task.position;
        if (pending && samePosition(remote, pending)) pendingPositions.current.delete(next.id);
        const localPosition = draggingId.current === next.id ? existing?.position : null;
        return { ...next, draggable: canDrag, position: localPosition || (pending && !samePosition(remote, pending) ? pending : next.position), selected: existing?.selected || false };
      });
    });
    setEdges(layout.edges);
  }, [layout, canDrag, setNodes, setEdges]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 250 }));
    return () => cancelAnimationFrame(frame);
  }, [fitView]);

  useEffect(() => {
    if (!arrangeRequest || arrangeRequest === lastArrangeRequest.current) return;
    lastArrangeRequest.current = arrangeRequest;
    const positions = autoArrangePositions(tasks);
    Object.entries(positions).forEach(([id, position]) => pendingPositions.current.set(id, position));
    setNodes((current) => current.map((node) => ({ ...node, position: positions[node.id] || node.position })));
    Promise.resolve(onAutoArrange(positions)).then(() => {
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    }).catch(() => {
      pendingPositions.current.clear();
      setNodes(layout.nodes.map((node) => ({ ...node, draggable: canDrag })));
    });
  }, [arrangeRequest, canDrag, fitView, layout.nodes, onAutoArrange, setNodes, tasks]);

  const isValidConnection = useCallback(({ source, target }) => (
    !readOnly && Boolean(source && target && source !== target) &&
    tasks.some((task) => task.id === source) &&
    tasks.some((task) => task.id === target && !task.dependencyIds.includes(source)) &&
    !wouldCreateCycle(tasks, target, source)
  ), [tasks, readOnly]);

  const onConnect = useCallback(({ source, target }) => {
    if (isValidConnection({ source, target })) onAddDependency(target, source);
  }, [isValidConnection, onAddDependency]);

  const onNodeDragStop = useCallback((event, node) => {
    if (!canDrag) return;
    draggingId.current = null;
    const position = { x: node.position.x, y: node.position.y };
    pendingPositions.current.set(node.id, position);
    const needsInitialization = tasks.some((task) => !isValidPosition(task.position));
    const allPositions = needsInitialization
      ? Object.fromEntries(nodes.map((item) => [item.id, item.id === node.id ? position : item.position]))
      : null;
    Promise.resolve(onMoveTask(node.id, position, allPositions)).catch(() => {
      pendingPositions.current.delete(node.id);
      setNodes(layout.nodes.map((item) => ({ ...item, draggable: canDrag })));
    });
  }, [canDrag, layout.nodes, nodes, onMoveTask, setNodes, tasks]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStart={(event, node) => { draggingId.current = node.id; }}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onEdgesDelete={onRemoveDependencies}
      isValidConnection={isValidConnection}
      nodesDraggable={canDrag}
      edgesReconnectable={false}
      edgesFocusable={!readOnly}
      deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
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
  const [arrangeRequest, setArrangeRequest] = useState(0);
  const [phoneLayout, setPhoneLayout] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const priorityRanks = useMemo(() => getPriorityRanks(props.tasks), [props.tasks]);
  const criticalPath = useMemo(() => getCriticalPath(props.tasks), [props.tasks]);
  const hours = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(criticalPath.totalHours);
  const hasManualLayout = props.tasks.some((task) => isValidPosition(task.position));

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setPhoneLayout(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function requestAutoArrange() {
    if (hasManualLayout && !window.confirm('Replace the current board arrangement with an automatic layout?')) return;
    setArrangeRequest((value) => value + 1);
  }

  return (
    <section className="graph-section" aria-labelledby="graph-heading">
      <div className="graph-heading">
        <div>
          <h2 id="graph-heading">Dependency graph</h2>
          <p>{props.readOnly ? 'Explore task status, priorities, and the critical path.' : phoneLayout ? 'Use the list view to edit tasks and prerequisites on a phone.' : "Drag tasks to arrange the shared board. To make task B dependent on A, drag from A's right dot to B's left dot."}</p>
        </div>
        <div className="critical-control">
          {!props.readOnly && <button type="button" onClick={requestAutoArrange}>Auto-arrange</button>}
          <button type="button" disabled={!criticalPath.available} aria-pressed={showCriticalPath} onClick={() => setShowCriticalPath((current) => !current)}>{showCriticalPath ? 'Hide critical path' : 'Show critical path'}</button>
          {criticalPath.available && showCriticalPath && <strong>{hours} h remaining</strong>}
          {!criticalPath.available && props.tasks.length > 0 && <span>Add estimates to {criticalPath.missingCount} task{criticalPath.missingCount === 1 ? '' : 's'}.</span>}
        </div>
      </div>
      <div className="graph-canvas">
        {props.tasks.length === 0 ? <p className="graph-empty">Add a task to see the graph.</p> : (
          <ReactFlowProvider>
            <GraphCanvas {...props} arrangeRequest={arrangeRequest} priorityRanks={priorityRanks} criticalPath={criticalPath} showCriticalPath={showCriticalPath && criticalPath.available} />
          </ReactFlowProvider>
        )}
      </div>
    </section>
  );
}
