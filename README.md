# Shared Dependency Planner

A responsive, real-time dependency planner for teams. The production architecture uses only Firebase services available on the no-cost Spark plan:

- Firebase Hosting for the Vite single-page app.
- Firebase Authentication with Google sign-in.
- Cloud Firestore for teams, planners, tasks, invitations, and view-only shares.
- Firestore Security Rules as the authorization boundary.

No Cloud Functions, Cloud Run, Storage, or Secret Manager resources are required.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the Firebase web app values.
3. Enable Google sign-in in Firebase Authentication.
4. Create a Firestore database.
5. Run `npm run dev`.

For local Firebase emulators, set `VITE_USE_FIREBASE_EMULATORS=true` and run:

```bash
firebase emulators:start
```

The emulator configuration includes Auth, Firestore, Hosting, and the Emulator UI.

## Commands

```bash
npm test          # graph, task, and export tests
npm run build     # production Vite build
npm run preview   # serve the production build locally
```

## Deployment

```bash
npm test
npm run build
firebase deploy --only auth,firestore,hosting
```

The current production project is `shared-dependency-planner`, hosted at [shared-dependency-planner.web.app](https://shared-dependency-planner.web.app).

## Data and authorization

Canonical membership lives at `teams/{teamId}/members/{uid}`. Team members can create and edit planners. Owners and admins manage invitations, members, and external sharing. External viewers can read only a duplicated, sanitized planner snapshot under a high-entropy share token; they cannot access team data or edit.

Task, dependency, and share changes use Firestore transactions or atomic batches. A compact dependency map on each planner serializes graph mutations and lets Security Rules verify that task documents stay consistent with the planner graph.

Task cards can be freely arranged on desktop and tablet boards. Positions are shared after each completed drag, synchronized to view-only links, and used by PNG/SVG exports. `Auto-arrange` restores the deterministic dependency layout; phone layouts remain list-first.

### Free-tier security tradeoff

Rules enforce authentication, membership, roles, field shapes, task limits, and graph/task consistency. The app checks graph cycles inside its Firestore transaction, but Firestore Rules cannot independently prove that an arbitrary dependency graph is acyclic. Therefore a malicious authenticated team member who bypasses the app client could submit a cyclic—but internally consistent—graph. This is acceptable only when team members are trusted collaborators. Authoritative server-side cycle validation would require a paid backend such as Cloud Functions and is intentionally outside the Spark-only version.

Firestore also has no absolute-spend cap once a project is upgraded. Keep this project on Spark, monitor quota usage, and avoid enabling billing-linked services if a strict $0 ceiling is required.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the full architecture and acceptance criteria.
