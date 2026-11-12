import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, firebaseEnabled } from '../firebase/client.js';
import { isValidPosition } from '../graph/layout.js';
import { loadTasks, removeTask, wouldCreateCycle } from '../tasks.js';

const DEMO_KEY = 'dependency-planner-demo-v4';
const DEMO_EVENT = 'dependency-planner-demo-change';

const now = () => new Date().toISOString();

function starterTasks() {
  const migrated = loadTasks();
  if (migrated.length) return migrated;
  return [
    { id: 'research', title: 'Confirm project requirements', description: 'Align the team on scope, constraints, and success criteria.', estimatedHours: 2, dependencyIds: [], completed: true, revision: 1 },
    { id: 'prototype', title: 'Build working prototype', description: 'Implement the core planner workflow for team review.', estimatedHours: 8, dependencyIds: ['research'], completed: false, revision: 1 },
    { id: 'review', title: 'Run team review', description: 'Collect feedback and resolve launch blockers.', estimatedHours: 3, dependencyIds: ['prototype'], completed: false, revision: 1 },
  ];
}

function initialDemo() {
  const timestamp = now();
  return {
    teams: { demo: { id: 'demo', name: 'Product Operations', role: 'owner', createdAt: timestamp } },
    planners: { demo: { roadmap: {
      id: 'roadmap', teamId: 'demo', name: 'Launch readiness', description: 'Shared dependencies for the next launch.',
      archived: false, updatedAt: timestamp, createdAt: timestamp, createdBy: 'demo-user', graphRevision: 1,
      externalSharingEnabled: true, shareToken: 'demo-share', tasks: starterTasks(),
    } } },
  };
}

function readDemo() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || initialDemo(); } catch { return initialDemo(); }
}

function writeDemo(data) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event(DEMO_EVENT));
}

function mutateDemo(mutator) {
  const data = readDemo();
  const result = mutator(data);
  writeDemo(data);
  return result;
}

function listenDemo(selector, callback) {
  const emit = () => callback(selector(readDemo()));
  emit();
  window.addEventListener(DEMO_EVENT, emit);
  window.addEventListener('storage', emit);
  return () => { window.removeEventListener(DEMO_EVENT, emit); window.removeEventListener('storage', emit); };
}

const normalizeTimestamp = (value) => value?.toDate?.().toISOString?.() || value || null;
const plannerFromDoc = (snapshot) => ({ id: snapshot.id, ...snapshot.data(), updatedAt: normalizeTimestamp(snapshot.data().updatedAt) });
const plannerRef = (teamId, plannerId) => doc(db, 'teams', teamId, 'planners', plannerId);
const taskRef = (teamId, plannerId, taskId) => doc(db, 'teams', teamId, 'planners', plannerId, 'tasks', taskId);

function privateTask(task, uid, existing = null) {
  const value = {
    title: task.title.trim(),
    description: (task.description || '').trim(),
    estimatedHours: Number(task.estimatedHours),
    completed: task.completed === true,
    dependencyIds: [...(task.dependencyIds || [])],
    createdBy: existing?.createdBy || uid,
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    revision: existing ? existing.revision + 1 : (task.revision || 1),
  };
  const position = task.position ?? existing?.position;
  if (isValidPosition(position)) value.position = { x: position.x, y: position.y };
  return value;
}

function publicTask(task) {
  const value = {
    title: task.title,
    description: task.description || '',
    estimatedHours: task.estimatedHours,
    completed: task.completed === true,
    dependencyIds: [...(task.dependencyIds || [])],
  };
  if (isValidPosition(task.position)) value.position = { x: task.position.x, y: task.position.y };
  return value;
}

function publicPlanner(planner, teamId, plannerId) {
  return {
    teamId,
    plannerId,
    name: planner.name,
    description: planner.description || '',
    enabled: true,
    graphRevision: planner.graphRevision || 0,
    updatedAt: serverTimestamp(),
  };
}

function graphTasks(graph) {
  return Object.entries(graph || {}).map(([id, dependencyIds]) => ({ id, dependencyIds }));
}

function shareToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

async function emailKey(email) {
  const bytes = new TextEncoder().encode(email.toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deletePublicShare(batch, token) {
  if (!token) return;
  const tasks = await getDocs(collection(db, 'publicPlannerShares', token, 'tasks'));
  tasks.forEach((item) => batch.delete(item.ref));
  batch.delete(doc(db, 'publicPlannerShares', token));
}

export const repository = {
  mode: firebaseEnabled ? 'firebase' : 'demo',

  subscribeTeams(uid, callback, onError = console.error) {
    if (!firebaseEnabled) return listenDemo((data) => Object.values(data.teams).sort((a, b) => a.name.localeCompare(b.name)), callback);
    return onSnapshot(collection(db, 'users', uid, 'teamRefs'), (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), onError);
  },

  subscribePlanners(teamId, callback, onError = console.error) {
    if (!firebaseEnabled) return listenDemo((data) => Object.values(data.planners[teamId] || {}).map(({ tasks, ...planner }) => ({ ...planner, taskCount: tasks.length })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), callback);
    return onSnapshot(query(collection(db, 'teams', teamId, 'planners'), orderBy('updatedAt', 'desc')), (snapshot) => callback(snapshot.docs.map(plannerFromDoc)), onError);
  },

  subscribeMembers(teamId, callback, onError = console.error) {
    if (!firebaseEnabled) return listenDemo(() => [{ id: 'demo-user', displayName: 'Demo Collaborator', email: 'demo@example.com', role: 'owner' }], callback);
    return onSnapshot(collection(db, 'teams', teamId, 'members'), (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), onError);
  },

  subscribePlanner(teamId, plannerId, callback, onError = console.error) {
    if (!firebaseEnabled) return listenDemo((data) => data.planners[teamId]?.[plannerId] || null, callback);
    let planner;
    let tasks = [];
    const emit = () => { if (planner !== undefined) callback(planner ? { ...planner, tasks } : null); };
    const stopPlanner = onSnapshot(plannerRef(teamId, plannerId), (snapshot) => { planner = snapshot.exists() ? plannerFromDoc(snapshot) : null; emit(); }, onError);
    const stopTasks = onSnapshot(collection(db, 'teams', teamId, 'planners', plannerId, 'tasks'), (snapshot) => { tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); emit(); }, onError);
    return () => { stopPlanner(); stopTasks(); };
  },

  async createTeam(name) {
    if (!firebaseEnabled) return mutateDemo((data) => { const id = crypto.randomUUID(); data.teams[id] = { id, name, role: 'owner', createdAt: now() }; data.planners[id] = {}; return { teamId: id }; });
    const uid = auth.currentUser.uid;
    const team = doc(collection(db, 'teams'));
    const batch = writeBatch(db);
    const stamp = serverTimestamp();
    batch.set(team, { name: name.trim(), createdBy: uid, createdAt: stamp, updatedAt: stamp });
    batch.set(doc(db, 'teams', team.id, 'members', uid), { role: 'owner', email: auth.currentUser.email || '', displayName: auth.currentUser.displayName || '', joinedAt: stamp, invitedBy: uid });
    batch.set(doc(db, 'users', uid), { displayName: auth.currentUser.displayName || '', email: auth.currentUser.email || '', photoURL: auth.currentUser.photoURL || '', lastSignedInAt: stamp }, { merge: true });
    batch.set(doc(db, 'users', uid, 'teamRefs', team.id), { name: name.trim(), role: 'owner', joinedAt: stamp });
    await batch.commit();
    return { teamId: team.id };
  },

  async createPlanner(teamId, name, description = '') {
    if (!firebaseEnabled) return mutateDemo((data) => { const id = crypto.randomUUID(); const timestamp = now(); data.planners[teamId][id] = { id, teamId, name, description, archived: false, tasks: [], graphRevision: 0, updatedAt: timestamp, createdAt: timestamp, createdBy: 'demo-user', externalSharingEnabled: false }; return { plannerId: id }; });
    const ref = doc(collection(db, 'teams', teamId, 'planners'));
    const stamp = serverTimestamp();
    await writeBatch(db).set(ref, { name: name.trim(), description: description.trim(), archived: false, createdBy: auth.currentUser.uid, createdAt: stamp, updatedAt: stamp, taskCount: 0, graphRevision: 0, dependencyGraph: {}, externalSharingEnabled: false, externalShareToken: null }).commit();
    return { plannerId: ref.id };
  },

  async importPlanner(teamId, name, description, tasks) {
    if (!firebaseEnabled) return mutateDemo((data) => { const id = crypto.randomUUID(); const timestamp = now(); data.planners[teamId][id] = { id, teamId, name, description, archived: false, tasks: tasks.map((task) => ({ ...task, revision: task.revision || 1 })), graphRevision: 1, updatedAt: timestamp, createdAt: timestamp, createdBy: 'demo-user', externalSharingEnabled: false }; return { plannerId: id }; });
    const ref = doc(collection(db, 'teams', teamId, 'planners'));
    const batch = writeBatch(db);
    const stamp = serverTimestamp();
    const graph = Object.fromEntries(tasks.map((task) => [task.id, [...task.dependencyIds]]));
    batch.set(ref, { name: name.trim(), description: description.trim(), archived: false, createdBy: auth.currentUser.uid, createdAt: stamp, updatedAt: stamp, taskCount: tasks.length, graphRevision: 1, dependencyGraph: graph, externalSharingEnabled: false, externalShareToken: null });
    tasks.forEach((task) => batch.set(taskRef(teamId, ref.id, task.id), privateTask(task, auth.currentUser.uid)));
    await batch.commit();
    return { plannerId: ref.id };
  },

  async updatePlanner(teamId, plannerId, changes) {
    if (!firebaseEnabled) return mutateDemo((data) => Object.assign(data.planners[teamId][plannerId], changes, { updatedAt: now() }));
    const ref = plannerRef(teamId, plannerId);
    const current = await getDoc(ref);
    if (!current.exists()) throw new Error('Planner not found.');
    const batch = writeBatch(db);
    batch.update(ref, { ...changes, updatedAt: serverTimestamp() });
    const data = current.data();
    if (data.externalSharingEnabled && data.externalShareToken) batch.update(doc(db, 'publicPlannerShares', data.externalShareToken), { name: changes.name ?? data.name, description: changes.description ?? data.description, updatedAt: serverTimestamp() });
    await batch.commit();
  },

  async createTask(teamId, plannerId, task) {
    if (!firebaseEnabled) return mutateDemo((data) => { const planner = data.planners[teamId][plannerId]; planner.tasks.push({ ...task, dependencyIds: [], revision: 1 }); planner.updatedAt = now(); });
    const uid = auth.currentUser.uid;
    await runTransaction(db, async (transaction) => {
      const planRef = plannerRef(teamId, plannerId);
      const itemRef = taskRef(teamId, plannerId, task.id);
      const [plan, existing] = await Promise.all([transaction.get(planRef), transaction.get(itemRef)]);
      if (!plan.exists()) throw new Error('Planner not found.');
      if (existing.exists()) throw new Error('Task already exists.');
      if ((plan.data().taskCount || 0) >= 100) throw new Error('This planner has reached the 100-task limit.');
      const value = privateTask({ ...task, dependencyIds: [] }, uid);
      const graph = { ...(plan.data().dependencyGraph || {}), [task.id]: [] };
      const revision = (plan.data().graphRevision || 0) + 1;
      transaction.set(itemRef, value);
      transaction.update(planRef, { taskCount: (plan.data().taskCount || 0) + 1, dependencyGraph: graph, graphRevision: revision, updatedAt: serverTimestamp() });
      if (plan.data().externalSharingEnabled && plan.data().externalShareToken) {
        transaction.set(doc(db, 'publicPlannerShares', plan.data().externalShareToken, 'tasks', task.id), publicTask(value));
        transaction.update(doc(db, 'publicPlannerShares', plan.data().externalShareToken), { graphRevision: revision, updatedAt: serverTimestamp() });
      }
    });
  },

  async updateTask(teamId, plannerId, taskId, changes, baseRevision) {
    if (!firebaseEnabled) return mutateDemo((data) => { const planner = data.planners[teamId][plannerId]; const task = planner.tasks.find((item) => item.id === taskId); if (!task) throw new Error('Task not found.'); if (baseRevision && task.revision !== baseRevision) throw new Error('This task changed in another session.'); Object.assign(task, changes, { revision: (task.revision || 1) + 1 }); planner.updatedAt = now(); });
    await runTransaction(db, async (transaction) => {
      const planRef = plannerRef(teamId, plannerId);
      const itemRef = taskRef(teamId, plannerId, taskId);
      const [plan, current] = await Promise.all([transaction.get(planRef), transaction.get(itemRef)]);
      if (!plan.exists()) throw new Error('Planner not found.');
      if (!current.exists()) throw new Error('Task not found.');
      if (current.data().revision !== baseRevision) throw new Error('This task changed in another session. Review the latest version and try again.');
      const next = { ...current.data(), ...changes };
      const patch = {
        ...changes,
        updatedBy: auth.currentUser.uid,
        updatedAt: serverTimestamp(),
        revision: baseRevision + 1,
      };
      transaction.update(itemRef, patch);
      transaction.update(planRef, { updatedAt: serverTimestamp() });
      if (plan.data().externalSharingEnabled && plan.data().externalShareToken) {
        const publicPatch = {};
        for (const field of ['title', 'description', 'estimatedHours', 'completed', 'dependencyIds']) {
          if (field in changes) publicPatch[field] = next[field];
        }
        transaction.update(doc(db, 'publicPlannerShares', plan.data().externalShareToken, 'tasks', taskId), publicPatch);
      }
    });
    return { ok: true };
  },

  async updateTaskPosition(teamId, plannerId, taskId, position) {
    if (!isValidPosition(position)) throw new Error('The task position is invalid.');
    if (!firebaseEnabled) return mutateDemo((data) => { data.planners[teamId][plannerId].tasks.find((task) => task.id === taskId).position = { ...position }; });
    const plan = await getDoc(plannerRef(teamId, plannerId));
    if (!plan.exists()) throw new Error('Planner not found.');
    const batch = writeBatch(db);
    batch.update(taskRef(teamId, plannerId, taskId), { position, layoutUpdatedBy: auth.currentUser.uid, layoutUpdatedAt: serverTimestamp() });
    if (plan.data().externalSharingEnabled && plan.data().externalShareToken) {
      batch.update(doc(db, 'publicPlannerShares', plan.data().externalShareToken, 'tasks', taskId), { position });
    }
    await batch.commit();
    return { ok: true };
  },

  async updateTaskPositions(teamId, plannerId, positions) {
    const entries = Object.entries(positions || {});
    if (!entries.length || entries.length > 100 || entries.some(([, position]) => !isValidPosition(position))) throw new Error('The board layout is invalid.');
    if (!firebaseEnabled) return mutateDemo((data) => { const byId = new Map(data.planners[teamId][plannerId].tasks.map((task) => [task.id, task])); entries.forEach(([id, position]) => { if (byId.has(id)) byId.get(id).position = { ...position }; }); });
    const plan = await getDoc(plannerRef(teamId, plannerId));
    if (!plan.exists()) throw new Error('Planner not found.');
    const batch = writeBatch(db);
    entries.forEach(([id, position]) => {
      batch.update(taskRef(teamId, plannerId, id), { position, layoutUpdatedBy: auth.currentUser.uid, layoutUpdatedAt: serverTimestamp() });
      if (plan.data().externalSharingEnabled && plan.data().externalShareToken) batch.update(doc(db, 'publicPlannerShares', plan.data().externalShareToken, 'tasks', id), { position });
    });
    await batch.commit();
    return { ok: true };
  },

  async deleteTask(teamId, plannerId, taskId) {
    if (!firebaseEnabled) return mutateDemo((data) => { const planner = data.planners[teamId][plannerId]; planner.tasks = removeTask(planner.tasks, taskId); planner.graphRevision += 1; planner.updatedAt = now(); });
    await runTransaction(db, async (transaction) => {
      const planRef = plannerRef(teamId, plannerId);
      const plan = await transaction.get(planRef);
      if (!plan.exists()) throw new Error('Planner not found.');
      const graph = structuredClone(plan.data().dependencyGraph || {});
      if (!(taskId in graph)) throw new Error('Task not found.');
      const dependentIds = Object.keys(graph).filter((id) => graph[id].includes(taskId));
      const dependentDocs = [];
      for (const id of dependentIds) dependentDocs.push(await transaction.get(taskRef(teamId, plannerId, id)));
      transaction.delete(taskRef(teamId, plannerId, taskId));
      delete graph[taskId];
      dependentDocs.forEach((item) => {
        const dependencyIds = item.data().dependencyIds.filter((id) => id !== taskId);
        graph[item.id] = dependencyIds;
        transaction.update(item.ref, { dependencyIds, revision: item.data().revision + 1, updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp() });
      });
      const revision = (plan.data().graphRevision || 0) + 1;
      transaction.update(planRef, { taskCount: Math.max(0, (plan.data().taskCount || 1) - 1), dependencyGraph: graph, graphRevision: revision, updatedAt: serverTimestamp() });
      if (plan.data().externalSharingEnabled && plan.data().externalShareToken) {
        transaction.delete(doc(db, 'publicPlannerShares', plan.data().externalShareToken, 'tasks', taskId));
        dependentDocs.forEach((item) => transaction.update(doc(db, 'publicPlannerShares', plan.data().externalShareToken, 'tasks', item.id), { dependencyIds: graph[item.id] }));
        transaction.update(doc(db, 'publicPlannerShares', plan.data().externalShareToken), { graphRevision: revision, updatedAt: serverTimestamp() });
      }
    });
    return { ok: true };
  },

  async mutateDependency(teamId, plannerId, taskId, dependencyId, action, baseGraphRevision) {
    if (!firebaseEnabled) return mutateDemo((data) => { const planner = data.planners[teamId][plannerId]; if (baseGraphRevision != null && planner.graphRevision !== baseGraphRevision) throw new Error('Dependencies changed in another session. Please try again.'); const task = planner.tasks.find((item) => item.id === taskId); if (!task) throw new Error('Task not found.'); if (action === 'add') { if (wouldCreateCycle(planner.tasks, taskId, dependencyId)) throw new Error('That dependency would create a cycle.'); if (!task.dependencyIds.includes(dependencyId)) task.dependencyIds.push(dependencyId); } else task.dependencyIds = task.dependencyIds.filter((id) => id !== dependencyId); task.revision = (task.revision || 1) + 1; planner.graphRevision += 1; planner.updatedAt = now(); return { graphRevision: planner.graphRevision }; });
    return runTransaction(db, async (transaction) => {
      const planRef = plannerRef(teamId, plannerId);
      const itemRef = taskRef(teamId, plannerId, taskId);
      const [plan, item] = await Promise.all([transaction.get(planRef), transaction.get(itemRef)]);
      if (!plan.exists() || !item.exists()) throw new Error('Task not found.');
      if (baseGraphRevision != null && plan.data().graphRevision !== baseGraphRevision) throw new Error('Dependencies changed in another session. Please try again.');
      const graph = structuredClone(plan.data().dependencyGraph || {});
      if (!(dependencyId in graph) || taskId === dependencyId) throw new Error('Task not found.');
      let dependencyIds = [...(graph[taskId] || [])];
      if (action === 'add') {
        if (wouldCreateCycle(graphTasks(graph), taskId, dependencyId)) throw new Error('That dependency would create a cycle.');
        if (!dependencyIds.includes(dependencyId)) dependencyIds.push(dependencyId);
      } else dependencyIds = dependencyIds.filter((id) => id !== dependencyId);
      graph[taskId] = dependencyIds;
      const revision = (plan.data().graphRevision || 0) + 1;
      transaction.update(itemRef, { dependencyIds, revision: item.data().revision + 1, updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp() });
      transaction.update(planRef, { dependencyGraph: graph, graphRevision: revision, updatedAt: serverTimestamp() });
      if (plan.data().externalSharingEnabled && plan.data().externalShareToken) {
        transaction.update(doc(db, 'publicPlannerShares', plan.data().externalShareToken, 'tasks', taskId), { dependencyIds });
        transaction.update(doc(db, 'publicPlannerShares', plan.data().externalShareToken), { graphRevision: revision, updatedAt: serverTimestamp() });
      }
      return { graphRevision: revision };
    });
  },

  async inviteMember(teamId, email, role = 'member') {
    if (!firebaseEnabled) return { invitationId: crypto.randomUUID(), email };
    const normalized = email.trim().toLowerCase();
    const invitationId = await emailKey(normalized);
    const team = await getDoc(doc(db, 'teams', teamId));
    if (!team.exists()) throw new Error('Team not found.');
    await writeBatch(db).set(doc(db, 'teams', teamId, 'invitations', invitationId), { email: normalized, role: role === 'admin' ? 'admin' : 'member', status: 'pending', teamName: team.data().name, invitedBy: auth.currentUser.uid, createdAt: serverTimestamp() }).commit();
    return { invitationId, email: normalized };
  },

  async removeMember(teamId, uid) {
    if (!firebaseEnabled) throw new Error('The demo owner cannot be removed.');
    const batch = writeBatch(db);
    batch.delete(doc(db, 'teams', teamId, 'members', uid));
    batch.delete(doc(db, 'users', uid, 'teamRefs', teamId));
    await batch.commit();
    return { ok: true };
  },

  async claimInvitations() {
    if (!firebaseEnabled || !auth.currentUser.email) return { claimed: 0 };
    const email = auth.currentUser.email.toLowerCase();
    const invitations = await getDocs(query(collectionGroup(db, 'invitations'), where('email', '==', email), where('status', '==', 'pending')));
    let claimed = 0;
    for (const invitation of invitations.docs) {
      const teamId = invitation.ref.parent.parent.id;
      const batch = writeBatch(db);
      batch.set(doc(db, 'teams', teamId, 'members', auth.currentUser.uid), { role: invitation.data().role, email, displayName: auth.currentUser.displayName || '', joinedAt: serverTimestamp(), invitedBy: invitation.data().invitedBy, invitationId: invitation.id });
      batch.set(doc(db, 'users', auth.currentUser.uid, 'teamRefs', teamId), { name: invitation.data().teamName, role: invitation.data().role, joinedAt: serverTimestamp() });
      batch.update(invitation.ref, { status: 'accepted', acceptedBy: auth.currentUser.uid, acceptedAt: serverTimestamp() });
      await batch.commit();
      claimed += 1;
    }
    return { claimed };
  },

  async createShareLink(teamId, plannerId) {
    if (!firebaseEnabled) return mutateDemo((data) => { const planner = data.planners[teamId][plannerId]; planner.shareToken = crypto.randomUUID(); planner.externalSharingEnabled = true; return { token: planner.shareToken }; });
    const planRef = plannerRef(teamId, plannerId);
    const [plan, tasks] = await Promise.all([getDoc(planRef), getDocs(collection(db, 'teams', teamId, 'planners', plannerId, 'tasks'))]);
    if (!plan.exists()) throw new Error('Planner not found.');
    const token = shareToken();
    const batch = writeBatch(db);
    await deletePublicShare(batch, plan.data().externalShareToken);
    batch.set(doc(db, 'publicPlannerShares', token), publicPlanner(plan.data(), teamId, plannerId));
    tasks.forEach((item) => batch.set(doc(db, 'publicPlannerShares', token, 'tasks', item.id), publicTask(item.data())));
    batch.update(planRef, { externalSharingEnabled: true, externalShareToken: token, updatedAt: serverTimestamp() });
    await batch.commit();
    return { token };
  },

  async revokeShareLink(teamId, plannerId) {
    if (!firebaseEnabled) return mutateDemo((data) => { const planner = data.planners[teamId][plannerId]; planner.externalSharingEnabled = false; delete planner.shareToken; });
    const planRef = plannerRef(teamId, plannerId);
    const plan = await getDoc(planRef);
    if (!plan.exists()) throw new Error('Planner not found.');
    const batch = writeBatch(db);
    await deletePublicShare(batch, plan.data().externalShareToken);
    batch.update(planRef, { externalSharingEnabled: false, externalShareToken: null, updatedAt: serverTimestamp() });
    await batch.commit();
  },

  async getPublicPlanner(token) {
    if (!firebaseEnabled) { const data = readDemo(); for (const planners of Object.values(data.planners)) { const planner = Object.values(planners).find((item) => item.externalSharingEnabled && item.shareToken === token); if (planner) return { planner: { ...planner, shareToken: undefined } }; } throw new Error('This share link is invalid or has been revoked.'); }
    const [share, tasks] = await Promise.all([getDoc(doc(db, 'publicPlannerShares', token)), getDocs(collection(db, 'publicPlannerShares', token, 'tasks'))]);
    if (!share.exists() || share.data().enabled !== true) throw new Error('This share link is invalid or has been revoked.');
    return { planner: { id: share.data().plannerId, name: share.data().name, description: share.data().description, graphRevision: share.data().graphRevision, tasks: tasks.docs.map((item) => ({ id: item.id, ...item.data() })) } };
  },
};
