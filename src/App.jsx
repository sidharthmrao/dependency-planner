import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Archive, ArrowLeft, BookOpen, ChevronDown, CircleHelp, Download, ExternalLink,
  FileCode2, FileImage, FolderKanban, LayoutDashboard, Link2, List, LogOut, Menu,
  Network, Plus, Save, Settings, Share2, ShieldCheck, Upload, Users, X,
} from 'lucide-react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import TaskGraph from './TaskGraph.jsx';
import { useAuth } from './auth/AuthProvider.jsx';
import { repository } from './data/repository.js';
import { downloadJson, downloadMermaid, downloadPng, downloadSvg } from './graph/exports.js';
import { isValidPosition, nextTaskPosition } from './graph/layout.js';
import TaskList from './graph/TaskList.jsx';
import { loadTasks, parseImportedTasks } from './tasks.js';

const WorkspaceContext = createContext(null);
const useWorkspace = () => useContext(WorkspaceContext);

function LoadingScreen({ label = 'Loading your workspace…' }) {
  return <div className="loading-screen"><span className="spinner" /><p>{label}</p></div>;
}

function ErrorBanner({ message, onClose }) {
  if (!message) return null;
  return <div className="error-banner" role="alert"><span>{message}</span>{onClose && <button type="button" onClick={onClose} aria-label="Dismiss"><X size={17} /></button>}</div>;
}

function Modal({ open, title, children, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={dialogRef} className="app-dialog" onCancel={onClose} onClose={onClose}><div className="dialog-title"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>{children}</dialog>;
}

function TeamForm({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try { await onCreate(name.trim()); setName(''); onClose(); } finally { setBusy(false); }
  }
  return <Modal open={open} onClose={onClose} title="Create a team"><form className="stack-form" onSubmit={submit}><label>Team name<input autoFocus required maxLength="80" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Product Operations" /></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create team'}</button></div></form></Modal>;
}

function PlannerForm({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try { await onCreate(name.trim(), description.trim()); setName(''); setDescription(''); onClose(); } finally { setBusy(false); }
  }
  return <Modal open={open} onClose={onClose} title="Create a planner"><form className="stack-form" onSubmit={submit}><label>Planner name<input autoFocus required maxLength="120" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Launch readiness" /></label><label>Description<textarea rows="3" maxLength="500" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this team coordinating?" /></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create planner'}</button></div></form></Modal>;
}

function TaskForm({ open, task, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(task?.title || ''); setDescription(task?.description || ''); setHours(task?.estimatedHours ?? ''); }, [task, open]);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try { await onSave({ title: title.trim(), description: description.trim(), estimatedHours: Number(hours) }); onClose(); } finally { setBusy(false); }
  }
  return <Modal open={open} onClose={onClose} title={task ? 'Edit task' : 'Add a task'}><form className="stack-form" onSubmit={submit}><label>Task name<input autoFocus required maxLength="160" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Description<textarea rows="4" maxLength="4000" value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Estimated hours<input type="number" min="0.001" step="any" required value={hours} onChange={(event) => setHours(event.target.value)} /></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}><Save size={16} />{busy ? 'Saving…' : 'Save task'}</button></div></form></Modal>;
}

function SignInPage() {
  const { user, loading, signIn, demoMode, authError, clearAuthError } = useAuth();
  const [error, setError] = useState('');
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/teams" replace />;
  return <main className="auth-page"><section className="auth-panel"><div className="brand-mark"><Network size={27} /></div><p className="eyebrow">Dependency Planner</p><h1>Make the path forward visible.</h1><p>Map shared work, spot blockers, and keep every teammate aligned as plans change.</p><ErrorBanner message={error || authError} onClose={() => { setError(''); clearAuthError(); }} /><button className="google-button" type="button" onClick={() => signIn().catch((problem) => setError(problem.message))}>G&nbsp;&nbsp;Continue with Google</button>{demoMode && <p className="microcopy">Local demo mode is active because Firebase credentials are not configured.</p>}<Link className="text-link" to="/help">View the quick guide</Link></section><section className="auth-visual" aria-hidden="true"><div className="visual-card card-a"><span>Research</span><small>Complete</small></div><div className="visual-line line-a" /><div className="visual-card card-b"><span>Prototype</span><small>Ready · 8h</small></div><div className="visual-line line-b" /><div className="visual-card card-c"><span>Team review</span><small>Blocked</small></div></section></main>;
}

function ProtectedShell() {
  const { user, loading } = useAuth();
  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) return undefined;
    let stop = () => {};
    repository.claimInvitations().catch(() => null).finally(() => {
      stop = repository.subscribeTeams(user.uid, (items) => { setTeams(items); setTeamsLoading(false); }, (problem) => { setError(problem.message); setTeamsLoading(false); });
    });
    return () => stop();
  }, [user]);
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/sign-in" replace />;
  return <AppShell workspace={{ teams, loading: teamsLoading, error, setError }} />;
}

function AppShell({ workspace }) {
  const { user, signOut, demoMode } = useAuth();
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  return <WorkspaceContext.Provider value={workspace}><div className="workspace-shell"><header className="topbar"><Link to="/teams" className="brand"><span className="brand-mark small"><Network size={21} /></span><span>Dependency Planner</span></Link><nav className={mobileNav ? 'global-nav open' : 'global-nav'} aria-label="Global navigation"><Link className={location.pathname.startsWith('/teams') ? 'active' : ''} to="/teams" onClick={() => setMobileNav(false)}><LayoutDashboard size={17} />Teams</Link><Link className={location.pathname === '/help' ? 'active' : ''} to="/help" onClick={() => setMobileNav(false)}><CircleHelp size={17} />Help</Link></nav><div className="account-area">{demoMode && <span className="demo-badge">Demo mode</span>}<span className="avatar">{(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}</span><span className="account-name">{user.displayName || user.email}</span>{!demoMode && <button className="icon-button" type="button" onClick={signOut} title="Sign out"><LogOut size={18} /></button>}<button className="icon-button mobile-menu" type="button" onClick={() => setMobileNav((value) => !value)} aria-label="Toggle navigation"><Menu size={21} /></button></div></header><ErrorBanner message={workspace.error} onClose={() => workspace.setError('')} /><Outlet /></div></WorkspaceContext.Provider>;
}

function TeamsIndex() {
  const { teams, loading, setError } = useWorkspace();
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();
  if (loading) return <LoadingScreen label="Loading teams…" />;
  async function create(name) { try { const result = await repository.createTeam(name); navigate(`/teams/${result.teamId}`); } catch (problem) { setError(problem.message); } }
  return <main className="page-content"><div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>Your teams</h1><p>Choose a shared space or start a new one.</p></div><button className="button primary" type="button" onClick={() => setShowCreate(true)}><Plus size={17} />New team</button></div><div className="team-grid">{teams.map((team) => <Link className="team-card" to={`/teams/${team.id}`} key={team.id}><span className="team-card-icon"><Users size={24} /></span><span><strong>{team.name}</strong><small>{team.role || 'member'}</small></span><span className="card-arrow">→</span></Link>)}</div>{teams.length === 0 && <div className="large-empty"><Users size={34} /><h2>Create your first team</h2><p>Teams keep planners and collaborators in one shared space.</p><button className="button primary" onClick={() => setShowCreate(true)}><Plus size={17} />Create team</button></div>}<TeamForm open={showCreate} onClose={() => setShowCreate(false)} onCreate={create} /></main>;
}

function TeamDashboard() {
  const { teamId } = useParams();
  const { teams, setError } = useWorkspace();
  const team = teams.find((item) => item.id === teamId);
  const [planners, setPlanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [members, setMembers] = useState([]);
  const importRef = useRef(null);
  const navigate = useNavigate();
  useEffect(() => repository.subscribePlanners(teamId, (items) => { setPlanners(items); setLoading(false); }, (problem) => setError(problem.message)), [teamId, setError]);
  const visible = planners.filter((planner) => planner.archived === showArchived && `${planner.name} ${planner.description}`.toLowerCase().includes(search.toLowerCase()));
  const isAdmin = ['owner', 'admin'].includes(team?.role);
  useEffect(() => {
    if (!isAdmin) return undefined;
    return repository.subscribeMembers(teamId, setMembers, (problem) => setError(problem.message));
  }, [isAdmin, teamId, setError]);
  if (!team && teams.length) return <Navigate to="/teams" replace />;
  async function create(name, description) { try { const result = await repository.createPlanner(teamId, name, description); navigate(`/teams/${teamId}/planners/${result.plannerId}`); } catch (problem) { setError(problem.message); } }
  async function invite(event) { event.preventDefault(); try { await repository.inviteMember(teamId, inviteEmail); setInviteEmail(''); setInviteOpen(false); } catch (problem) { setError(problem.message); } }
  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.email || member.displayName || 'this member'} from the team?`)) return;
    try { await repository.removeMember(teamId, member.id); } catch (problem) { setError(problem.message); }
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const tasks = parseImportedTasks(data);
      const name = data?.planner?.name || file.name.replace(/\.json$/i, '') || 'Imported planner';
      const result = await repository.importPlanner(teamId, name, data?.planner?.description || 'Imported from JSON.', tasks);
      navigate(`/teams/${teamId}/planners/${result.plannerId}`);
    } catch (problem) { setError(problem instanceof SyntaxError ? 'That file is not valid JSON.' : problem.message); }
  }
  async function migrateBrowserTasks() {
    try {
      const tasks = loadTasks();
      if (!tasks.length) throw new Error('No browser tasks were found.');
      const result = await repository.importPlanner(teamId, 'Imported browser planner', 'Copied from the original local planner.', tasks);
      navigate(`/teams/${teamId}/planners/${result.plannerId}`);
    } catch (problem) { setError(problem.message); }
  }
  return <main className="page-content"><Link className="back-link" to="/teams"><ArrowLeft size={16} />All teams</Link><div className="page-heading team-heading"><div><p className="eyebrow">Team space</p><h1>{team?.name || 'Team'}</h1><p>{planners.length} planner{planners.length === 1 ? '' : 's'} · Your role: {team?.role || 'member'}</p></div><div className="heading-actions">{isAdmin && <button className="button secondary" onClick={() => setSettingsOpen(true)}><Settings size={17} />Members</button>}{isAdmin && <button className="button secondary" onClick={() => setInviteOpen(true)}><Users size={17} />Invite</button>}<button className="button secondary" onClick={() => importRef.current.click()}><Upload size={17} />Import JSON</button><input ref={importRef} type="file" accept=".json,application/json" onChange={importFile} hidden /><button className="button primary" onClick={() => setShowCreate(true)}><Plus size={17} />New planner</button></div></div>{repository.mode === 'firebase' && loadTasks().length > 0 && <div className="migration-banner"><div><strong>Local planner found</strong><span>Copy the tasks saved in this browser into the team. The original stays untouched.</span></div><button className="button secondary" onClick={migrateBrowserTasks}>Copy into team</button></div>}<div className="list-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search planners" aria-label="Search planners" /><button className={showArchived ? 'button secondary active' : 'button secondary'} onClick={() => setShowArchived((value) => !value)}><Archive size={16} />{showArchived ? 'Showing archived' : 'Archived'}</button></div>{loading ? <LoadingScreen label="Loading planners…" /> : visible.length ? <div className="planner-grid">{visible.map((planner) => <Link className="planner-card" to={`/teams/${teamId}/planners/${planner.id}`} key={planner.id}><div className="planner-card-top"><span className="planner-icon"><FolderKanban size={20} /></span><span className="task-count">{planner.taskCount || 0} tasks</span></div><h2>{planner.name}</h2><p>{planner.description || 'No description.'}</p><footer><span>Updated {planner.updatedAt ? new Date(planner.updatedAt).toLocaleDateString() : 'recently'}</span><span>Open →</span></footer></Link>)}</div> : <div className="large-empty compact"><FolderKanban size={34} /><h2>{showArchived ? 'No archived planners' : 'No planners yet'}</h2><p>{showArchived ? 'Archived planners will appear here.' : 'Create a planner to map this team’s shared work.'}</p>{!showArchived && <button className="button primary" onClick={() => setShowCreate(true)}><Plus size={17} />Create planner</button>}</div>}<PlannerForm open={showCreate} onClose={() => setShowCreate(false)} onCreate={create} /><Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a teammate"><form className="stack-form" onSubmit={invite}><label>Google account email<input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" /></label><p className="form-note">Invited teammates can create and edit all planners in this team.</p><div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setInviteOpen(false)}>Cancel</button><button className="button primary">Create invitation</button></div></form></Modal><Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Team members"><div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><span className="avatar">{(member.displayName || member.email || 'U').slice(0, 1).toUpperCase()}</span><span><strong>{member.displayName || member.email || member.id}</strong><small>{member.email && member.displayName ? member.email : member.role}</small></span><span className="role-pill">{member.role}</span>{member.role !== 'owner' && <button className="danger-text" onClick={() => removeMember(member)}>Remove</button>}</div>)}</div></Modal></main>;
}

function ExportMenu({ planner }) {
  const [open, setOpen] = useState(false);
  return <div className="menu-wrap"><button className="button secondary" type="button" onClick={() => setOpen((value) => !value)}><Download size={17} />Export<ChevronDown size={15} /></button>{open && <div className="action-menu"><button onClick={() => { downloadPng(planner); setOpen(false); }}><FileImage size={17} /><span><strong>PNG image</strong><small>Best for quick sharing</small></span></button><button onClick={() => { downloadSvg(planner); setOpen(false); }}><FileImage size={17} /><span><strong>SVG diagram</strong><small>Scalable for Confluence</small></span></button><button onClick={() => { downloadMermaid(planner); setOpen(false); }}><FileCode2 size={17} /><span><strong>Mermaid Markdown</strong><small>Editable diagram source</small></span></button><button onClick={() => { downloadJson(planner); setOpen(false); }}><Save size={17} /><span><strong>JSON backup</strong><small>Re-import planner data</small></span></button></div>}</div>;
}

function PlannerPage() {
  const { teamId, plannerId } = useParams();
  const navigate = useNavigate();
  const { teams, setError } = useWorkspace();
  const team = teams.find((item) => item.id === teamId);
  const [planner, setPlanner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => window.matchMedia('(max-width: 760px)').matches ? 'list' : 'graph');
  const [taskDialog, setTaskDialog] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [saveState, setSaveState] = useState('Saved');
  const [online, setOnline] = useState(navigator.onLine);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  useEffect(() => repository.subscribePlanner(teamId, plannerId, (item) => { setPlanner(item); setLoading(false); }, (problem) => { setError(problem.message); setLoading(false); }), [teamId, plannerId, setError]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const isAdmin = ['owner', 'admin'].includes(team?.role);
  if (loading) return <LoadingScreen label="Loading planner…" />;
  if (!planner) return <main className="page-content"><div className="large-empty"><FolderKanban size={34} /><h1>Planner not found</h1><Link className="button primary" to={`/teams/${teamId}`}>Back to team</Link></div></main>;
  const tasks = planner.tasks || [];
  async function perform(work) { setSaveState('Saving'); try { const result = await work(); setSaveState('Saved'); return result; } catch (problem) { setSaveState('Not saved'); setError(problem.message); throw problem; } }
  async function saveTask(values) {
    if (editingTask) await perform(() => repository.updateTask(teamId, plannerId, editingTask.id, values, editingTask.revision));
    else {
      const position = tasks.every((task) => isValidPosition(task.position)) ? nextTaskPosition(tasks) : null;
      await perform(() => repository.createTask(teamId, plannerId, { id: crypto.randomUUID(), ...values, completed: false, ...(position ? { position } : {}) }));
    }
  }
  async function updateTask(id, changes) { const task = tasks.find((item) => item.id === id); await perform(() => repository.updateTask(teamId, plannerId, id, changes, task?.revision)); }
  async function moveTask(id, position, initialLayout) { return perform(() => initialLayout ? repository.updateTaskPositions(teamId, plannerId, initialLayout) : repository.updateTaskPosition(teamId, plannerId, id, position)); }
  async function autoArrange(positions) { return perform(() => repository.updateTaskPositions(teamId, plannerId, positions)); }
  async function deleteTask(task) { if (!window.confirm(`Delete “${task.title}” and remove its dependency links?`)) return; await perform(() => repository.deleteTask(teamId, plannerId, task.id)); }
  async function changeDependency(taskId, dependencyId, action, revision = planner.graphRevision) { return perform(() => repository.mutateDependency(teamId, plannerId, taskId, dependencyId, action, revision)); }
  async function setDependencies(taskId, nextIds) {
    const task = tasks.find((item) => item.id === taskId); let revision = planner.graphRevision;
    for (const id of task.dependencyIds.filter((id) => !nextIds.includes(id))) { const result = await repository.mutateDependency(teamId, plannerId, taskId, id, 'remove', revision); revision = result?.graphRevision ?? revision + 1; }
    for (const id of nextIds.filter((id) => !task.dependencyIds.includes(id))) { const result = await repository.mutateDependency(teamId, plannerId, taskId, id, 'add', revision); revision = result?.graphRevision ?? revision + 1; }
  }
  async function createShare() { try { const result = await repository.createShareLink(teamId, plannerId); const base = import.meta.env.BASE_URL === './' ? '' : import.meta.env.BASE_URL.replace(/\/$/, ''); const url = `${window.location.origin}${base}/share/${result.token}`; setShareUrl(url); setShareOpen(true); } catch (problem) { setError(problem.message); } }
  async function revokeShare() { try { await repository.revokeShareLink(teamId, plannerId); setShareUrl(''); setShareOpen(false); } catch (problem) { setError(problem.message); } }
  async function renamePlanner() { const name = window.prompt('Planner name', planner.name)?.trim(); if (name && name !== planner.name) await perform(() => repository.updatePlanner(teamId, plannerId, { name })); }
  async function toggleArchive() {
    const action = planner.archived ? 'restore' : 'archive';
    if (window.confirm(`${action === 'archive' ? 'Archive' : 'Restore'} this planner?`)) {
      await perform(() => repository.updatePlanner(teamId, plannerId, { archived: !planner.archived }));
      navigate(`/teams/${teamId}`);
    }
  }
  const status = online ? saveState : 'Offline';
  return <main className="planner-page"><div className="planner-topline"><Link className="back-link" to={`/teams/${teamId}`}><ArrowLeft size={16} />{team?.name || 'Team'}</Link><span className={`save-state ${status.toLowerCase().replace(' ', '-')}`}><span />{status}</span></div><div className="planner-header"><div><div className="title-with-action"><h1>{planner.name}</h1><button className="icon-button" onClick={renamePlanner} title="Rename planner"><Settings size={17} /></button></div><p>{planner.description || 'Shared dependency plan'}</p></div><div className="heading-actions"><div className="view-switcher" aria-label="Planner view"><button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}><Network size={16} />Graph</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={16} />List</button></div><ExportMenu planner={planner} /><button className="button secondary" onClick={toggleArchive}><Archive size={17} />{planner.archived ? 'Restore' : 'Archive'}</button>{isAdmin && <button className="button secondary" onClick={createShare}><Share2 size={17} />Share</button>}<button className="button primary" onClick={() => { setEditingTask(null); setTaskDialog(true); }}><Plus size={17} />Add task</button></div></div><div className="planner-body">{tasks.length === 0 ? <div className="large-empty"><Network size={38} /><h2>Map the first task</h2><p>Add work, then connect prerequisites to make the path visible.</p><button className="button primary" onClick={() => setTaskDialog(true)}><Plus size={17} />Add task</button></div> : view === 'graph' ? <TaskGraph tasks={tasks} onUpdateTask={updateTask} onDeleteTask={(id) => deleteTask(tasks.find((item) => item.id === id))} onToggleComplete={(id) => updateTask(id, { completed: !tasks.find((item) => item.id === id).completed })} onAddDependency={(taskId, dependencyId) => changeDependency(taskId, dependencyId, 'add')} onRemoveDependencies={(edges) => Promise.all(edges.map((edge) => changeDependency(edge.target, edge.source, 'remove')))} onMoveTask={moveTask} onAutoArrange={autoArrange} /> : <TaskList tasks={tasks} onEdit={(task) => { setEditingTask(task); setTaskDialog(true); }} onDelete={deleteTask} onToggle={(id) => updateTask(id, { completed: !tasks.find((item) => item.id === id).completed })} onSetDependencies={setDependencies} />}</div><TaskForm open={taskDialog} task={editingTask} onClose={() => { setTaskDialog(false); setEditingTask(null); }} onSave={saveTask} /><Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Share a view-only planner"><div className="share-panel"><p>Anyone with this unlisted link can view the planner. Only team members can edit.</p><div className="copy-field"><input readOnly value={shareUrl} /><button className="button primary" onClick={() => navigator.clipboard.writeText(shareUrl)}><Link2 size={16} />Copy</button></div><div className="share-footer"><button className="button danger-outline" onClick={revokeShare}>Revoke link</button><a className="button secondary" href={shareUrl} target="_blank" rel="noreferrer">Open view <ExternalLink size={15} /></a></div></div></Modal></main>;
}

function HelpPage() {
  const { user } = useAuth();
  const sections = [
    ['start', 'Start', ['Sign in with Google.', 'Open a team from Teams.', 'Select a planner or choose New planner.']],
    ['tasks', 'Tasks', ['Add task records new work.', 'Ready tasks have no unfinished prerequisites. Blocked tasks are waiting. Complete tasks are finished.', 'Use Edit to update the name, description, or estimate.']],
    ['dependencies', 'Dependencies', ['Drag tasks to arrange the shared board; use Auto-arrange to restore an organized layout.', 'On desktop, drag from a prerequisite’s right dot to the dependent task’s left dot.', 'On mobile, open a task and select Prerequisites. Cycles are rejected.']],
    ['sharing', 'Sharing', ['Owners and admins can choose Share to create an unlisted view-only link.', 'People outside the team can view but cannot edit.', 'Choose Revoke link to disable access immediately.']],
    ['exporting', 'Exporting', ['PNG is best for quick sharing. SVG stays sharp at any size.', 'Mermaid is editable diagram text. JSON is a data backup.', 'Upload PNG or SVG manually to Confluence.']],
    ['saving', 'Saving and offline use', ['Saved means the server confirmed the change. Saving means it is still in progress.', 'Offline changes sync after the connection returns.', 'If a conflict appears, review the newer task before reapplying your draft.']],
  ];
  return <main className="help-page"><div className="help-hero"><p className="eyebrow">Quick guide</p><h1>Get unstuck, then get back to planning.</h1><p>Short instructions for the workflows you’ll use most.</p>{user && <Link className="button secondary" to="/teams"><ArrowLeft size={16} />Back to teams</Link>}</div><nav className="help-nav" aria-label="Guide sections">{sections.map(([id, title]) => <a key={id} href={`#${id}`}>{title}</a>)}</nav><div className="help-sections">{sections.map(([id, title, steps]) => <section id={id} key={id}><span className="help-icon"><BookOpen size={19} /></span><div><h2>{title}</h2><ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol></div></section>)}</div><div className="help-contact"><ShieldCheck size={22} /><div><h2>Still stuck?</h2><p>Contact your team owner or administrator for access and sharing questions.</p></div></div></main>;
}

function PublicPlannerPage() {
  const { shareToken } = useParams();
  const [planner, setPlanner] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => window.matchMedia('(max-width: 760px)').matches ? 'list' : 'graph');
  useEffect(() => { repository.getPublicPlanner(shareToken).then((result) => setPlanner(result.planner)).catch((problem) => setError(problem.message)); }, [shareToken]);
  if (error) return <main className="public-page"><div className="large-empty"><Link2 size={35} /><h1>Share link unavailable</h1><p>{error}</p><Link className="button secondary" to="/help#sharing">Sharing help</Link></div></main>;
  if (!planner) return <LoadingScreen label="Opening shared planner…" />;
  return <div className="public-shell"><header><Link className="brand" to="/help"><span className="brand-mark small"><Network size={21} /></span><span>Dependency Planner</span></Link><span className="readonly-pill">View only</span><Link className="text-link" to="/help">Help</Link></header><main className="planner-page"><div className="planner-header"><div><p className="eyebrow">Shared planner</p><h1>{planner.name}</h1><p>{planner.description}</p></div><div className="view-switcher"><button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}><Network size={16} />Graph</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={16} />List</button></div></div><div className="planner-body">{view === 'graph' ? <TaskGraph tasks={planner.tasks || []} readOnly /> : <TaskList tasks={planner.tasks || []} readOnly />}</div></main></div>;
}

export default function App() {
  return <Routes><Route path="/sign-in" element={<SignInPage />} /><Route path="/help" element={<HelpPage />} /><Route path="/share/:shareToken" element={<PublicPlannerPage />} /><Route element={<ProtectedShell />}><Route path="/teams" element={<TeamsIndex />} /><Route path="/teams/:teamId" element={<TeamDashboard />} /><Route path="/teams/:teamId/planners/:plannerId" element={<PlannerPage />} /></Route><Route path="*" element={<Navigate to="/teams" replace />} /></Routes>;
}
