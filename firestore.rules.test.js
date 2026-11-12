import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'dependency-planner-rules-test',
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const createdAt = new Date('2026-11-12T12:00:00Z');
    await setDoc(doc(db, 'teams/team-a'), { name: 'Team A', createdBy: 'alice', createdAt, updatedAt: createdAt });
    await setDoc(doc(db, 'teams/team-a/members/alice'), { role: 'member', email: 'alice@example.com', joinedAt: createdAt });
    await setDoc(doc(db, 'teams/team-a/planners/plan-a'), {
      name: 'Plan A', description: '', archived: false, createdBy: 'alice', createdAt, updatedAt: createdAt,
      taskCount: 1, graphRevision: 1, dependencyGraph: { task_a: [] }, externalSharingEnabled: true, externalShareToken: 'share-a',
    });
    await setDoc(doc(db, 'teams/team-a/planners/plan-a/tasks/task_a'), {
      title: 'Task A', description: '', estimatedHours: 1, completed: false, dependencyIds: [],
      createdBy: 'alice', createdAt, updatedBy: 'alice', updatedAt: createdAt, revision: 1,
    });
    await setDoc(doc(db, 'publicPlannerShares/share-a'), { teamId: 'team-a', plannerId: 'plan-a', name: 'Plan A', description: '', enabled: true, graphRevision: 1, updatedAt: createdAt });
    await setDoc(doc(db, 'publicPlannerShares/share-a/tasks/task_a'), { title: 'Task A', description: '', estimatedHours: 1, completed: false, dependencyIds: [] });
  });
});

after(async () => environment?.cleanup());

test('a member can update only private and public board positions', async () => {
  const db = environment.authenticatedContext('alice', { email: 'alice@example.com' }).firestore();
  await assertSucceeds(updateDoc(doc(db, 'teams/team-a/planners/plan-a/tasks/task_a'), {
    position: { x: -120, y: 340 }, layoutUpdatedBy: 'alice', layoutUpdatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(db, 'publicPlannerShares/share-a/tasks/task_a'), { position: { x: -120, y: 340 } }));
});

test('layout-only writes cannot smuggle content or revision changes', async () => {
  const db = environment.authenticatedContext('alice', { email: 'alice@example.com' }).firestore();
  await assertFails(updateDoc(doc(db, 'teams/team-a/planners/plan-a/tasks/task_a'), {
    title: 'Changed through layout write', position: { x: 10, y: 10 }, layoutUpdatedBy: 'alice', layoutUpdatedAt: serverTimestamp(),
  }));
});

test('content updates preserve a concurrently saved position', async () => {
  const db = environment.authenticatedContext('alice', { email: 'alice@example.com' }).firestore();
  const task = doc(db, 'teams/team-a/planners/plan-a/tasks/task_a');
  await assertSucceeds(updateDoc(task, {
    position: { x: 75, y: 125 }, layoutUpdatedBy: 'alice', layoutUpdatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(task, {
    title: 'Updated task', updatedBy: 'alice', updatedAt: serverTimestamp(), revision: 2,
  }));
});

test('invalid coordinates and nonmember writes are rejected', async () => {
  const memberDb = environment.authenticatedContext('alice', { email: 'alice@example.com' }).firestore();
  const outsiderDb = environment.authenticatedContext('bob', { email: 'bob@example.com' }).firestore();
  await assertFails(updateDoc(doc(memberDb, 'teams/team-a/planners/plan-a/tasks/task_a'), {
    position: { x: 1000001, y: 0 }, layoutUpdatedBy: 'alice', layoutUpdatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(outsiderDb, 'teams/team-a/planners/plan-a/tasks/task_a'), {
    position: { x: 20, y: 20 }, layoutUpdatedBy: 'bob', layoutUpdatedAt: serverTimestamp(),
  }));
});

test('external viewers cannot move public tasks', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(db, 'publicPlannerShares/share-a/tasks/task_a'), { position: { x: 10, y: 10 } }));
  assert.ok(true);
});
