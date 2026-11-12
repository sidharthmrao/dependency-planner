# Persistent Multi-User Dependency Planner: Implementation Plan

## 1. Goal

Turn the existing local React dependency planner into a hosted, persistent application where teams can organize multiple planners and collaborate on them in real time.

The first production version will provide:

- Google sign-in.
- Team spaces containing an organized list of planners.
- Real-time editing for approximately 10 simultaneous users and 100 tasks per planner.
- Full create, view, and edit access for members of the owning team.
- Revocable, unlisted, view-only links for people outside the team.
- Desktop graph editing and a touch-friendly mobile list editor.
- PNG, SVG, and Mermaid Markdown exports for manual insertion into Confluence or other documentation.
- Migration of the current browser-local task list into a team planner.

Visible collaborator presence and direct Confluence publishing or embedding are explicitly deferred.

### Spark-plan architecture amendment

The implemented version must remain deployable on Firebase's no-cost Spark plan. It therefore uses only Firebase Hosting, Google Authentication, Cloud Firestore, Security Rules, indexes, and the local Emulator Suite. Cloud Functions, Cloud Run, Storage, Secret Manager, and other billing-required services are excluded. This amendment supersedes any older references to Functions or server endpoints below.

Graph-wide operations run as Firestore client transactions against a compact `dependencyGraph` map on the planner document. Rules verify membership, roles, limits, immutable fields, and consistency between the planner graph and task documents. The client transaction rejects cycles, but Rules cannot independently prove arbitrary graph acyclicity; the Spark-only version consequently assumes authenticated team members are trusted not to bypass the app client. External links read a duplicated, sanitized Firestore snapshot keyed by a high-entropy token and protected as read-only by Rules.

## 2. Current Application

The current app is a Vite/React single-page application. It stores one task array in `localStorage`, renders the graph with React Flow and Dagre, and validates dependency cycles in the browser. It has no accounts, teams, planner records, server-side authorization, navigation, or persistent shared backend.

Reusable parts:

- Task and dependency validation helpers in `src/tasks.js`.
- Priority and critical-path calculations in `src/graphMetrics.js`.
- Dagre layout and React Flow graph UI in `src/TaskGraph.jsx`.
- JSON import/export as a compatibility and backup feature.

The main architectural change is to separate the local graph state from persistence and replace direct `localStorage` writes with a planner repository backed by Firebase.

## 3. Product and Access Model

### Teams

- A user can belong to one or more teams.
- A team space lists all planners owned by that team, ordered by recent activity by default, with search and optional archived-planner filtering.
- Any team member can create, view, rename, update, archive, and edit planners belonging to that team.
- Team `owner` and `admin` roles manage membership and external sharing.
- A `member` has the same planner create/edit capability but cannot manage team membership or sharing links.
- The initial team creator becomes its owner.
- Membership is established through an explicit invitation to a Google-account email address. Domain-based automatic membership is out of scope.

### External viewing

- An owner or admin can enable a revocable unlisted sharing link for a planner.
- Anyone with the active link can view the planner without joining the team and without edit permission.
- The link contains a high-entropy random token, not a predictable planner ID.
- Rotating or disabling the link immediately invalidates the old URL.
- The public view exposes planner and task content but never team membership, private user data, administrative controls, or edit endpoints.
- The UI clearly labels the session as view-only.

### Authentication and authorization

- Firebase Authentication with Google sign-in is the only sign-in method in the first version.
- Authorization is based on server-stored team membership, never email claims or client-side UI state alone.
- Firestore Security Rules are the primary read/write boundary.
- Privileged or graph-wide mutations use Firestore transactions and atomic batches; Security Rules validate identity, membership, roles, and document consistency.

## 4. Proposed Firebase Architecture

Use Firebase because it satisfies the first-version hosting, identity, real-time synchronization, offline cache, and serverless validation requirements without introducing a separately managed backend.

### Services

- **Firebase Hosting:** serve the built Vite SPA over HTTPS with SPA route rewrites, cache headers, preview channels, and a custom domain when available.
- **Firebase Authentication:** Google sign-in.
- **Cloud Firestore:** team, membership, invitation, planner, task, and sharing metadata; real-time task subscriptions.
- **Firebase App Check:** enable for the web app before public launch to reduce unauthorized scripted use. It supplements rather than replaces Authentication and Security Rules.
- **Firebase Emulator Suite:** local development and integration testing for Auth, Firestore, Hosting, and Security Rules.

Firebase Hosting is a better fit than Firebase App Hosting for this Vite SPA because the application does not require server-side rendering. Because this implementation occurs after October 15, 2026, explicitly create and reserve the default Hosting site instead of assuming Firebase creates one with the project.

### Environments and deployment

- Use separate Firebase projects for `development` and `production` so test users and data cannot affect production.
- Configure project aliases in `.firebaserc` and keep public Firebase web configuration in environment-specific Vite variables.
- No server secrets are required. Firebase web configuration is public by design; never ship service-account credentials.
- Deploy Hosting, Authentication configuration, Firestore indexes, and Security Rules through CI after tests pass.
- Use Hosting preview channels for pull requests and require manual approval for production deployment.
- Keep the project on Spark for a strict no-billing deployment and monitor Firebase quota usage.

## 5. Firestore Data Model

Use individual task documents rather than storing the entire graph in one planner document. This prevents unrelated task edits from overwriting one another and limits real-time update payloads.

```text
users/{uid}
  displayName, email, photoURL, createdAt, lastSignedInAt

teams/{teamId}
  name, createdBy, createdAt, updatedAt

teams/{teamId}/members/{uid}
  role: "owner" | "admin" | "member"
  email, joinedAt, invitedBy

teams/{teamId}/invitations/{invitationId}
  email, role, status, invitedBy, createdAt, expiresAt

teams/{teamId}/planners/{plannerId}
  name, description, createdBy, createdAt, updatedAt
  archived, taskCount, graphRevision
  externalSharingEnabled, externalShareToken
  dependencyGraph: map<taskId, dependencyIds[]>

teams/{teamId}/planners/{plannerId}/tasks/{taskId}
  title, description, estimatedHours, completed
  dependencyIds: string[]
  position?: { x, y }
  createdBy, createdAt, updatedBy, updatedAt, revision

publicPlannerShares/{highEntropyToken}
  teamId, plannerId, name, description, enabled, graphRevision, updatedAt

publicPlannerShares/{highEntropyToken}/tasks/{taskId}
  title, description, estimatedHours, completed, dependencyIds
```

Implementation details:

- Use Firebase-generated document IDs for new teams and planners and retain UUID task IDs for compatibility with existing imports.
- Store timestamps with server timestamps.
- Keep `dependencyIds` on each task because the expected maximum of 100 tasks makes graph reads and cycle validation small. Do not add a separate edge collection in version one.
- Maintain `taskCount` transactionally for dashboard display and quota enforcement.
- Maintain `graphRevision` for dependency changes. It supports stale-client detection, export consistency, and future activity history.
- Treat cached user profile fields as display data only; membership documents remain authoritative.
- Store a high-entropy opaque token as the public snapshot document ID. Rotating or deleting it revokes the old URL.

### Required indexes

- Team planners by `archived` plus `updatedAt` descending.
- Invitations by `email`, `status`, and `expiresAt` where required by the invitation workflow.
- Avoid collection-group membership queries for the dashboard initially. Store a non-authoritative `users/{uid}/teamRefs/{teamId}` index maintained in the same atomic membership batch for efficient team discovery; Rules require the canonical membership document to exist.

## 6. Real-Time Collaboration and Consistency

### Normal task edits

- Subscribe to the selected planner document and its task collection with Firestore `onSnapshot` listeners.
- Add, update, complete, and delete tasks with optimistic UI feedback.
- Update only changed fields and include the task's current `revision` in the write precondition or callable update request.
- If another user updated the same task since editing began, keep the remote version, preserve the user's unsaved draft, and show a conflict dialog that allows the user to review and reapply changes.
- Changes to different tasks proceed independently and appear in connected clients in real time.
- Show `Saving`, `Saved`, and `Offline` states; do not imply that a locally queued write is already durable on the server.

### Dependency mutations

The planner document contains a compact `dependencyGraph` map and `graphRevision`. Every dependency addition or removal runs in a Firestore transaction that reads this single authoritative graph snapshot, verifies the submitted revision and task IDs, rejects cycles in the app client, then atomically updates the task, graph, revision, and any active public snapshot. Concurrent graph transactions conflict and retry against the latest planner document.

Security Rules require the task's `dependencyIds` to match the planner graph after the transaction and limit the graph to 100 entries. This prevents partial and inconsistent writes. Rules cannot determine arbitrary graph acyclicity, so the free-only design assumes authenticated members are trusted to use the application rather than crafting direct Firestore requests.

### Deletion

Task deletion uses a Firestore transaction to remove the task, remove its ID from dependent tasks, update the planner graph and counter, and synchronize any public snapshot atomically. Normal users archive planners; recursive hard deletion is deferred because it requires trusted backend processing or carefully bounded client batches.

## 7. Security Rules and Server Validation

Security Rules must be tested with the Emulator Suite and should implement these invariants:

- Signed-in users can read a team and its planners only when `teams/{teamId}/members/{uid}` exists.
- Team members can create and update ordinary planner metadata and task fields.
- Only owners/admins can modify membership, invitations, external sharing, or initiate hard deletion.
- Clients cannot change immutable creator fields or roles outside the invitation and admin workflows.
- Task writes must match the planner's post-transaction dependency graph, and counters and graphs are bounded by Rules.
- Task documents enforce allowed keys, title and description length limits, positive numeric estimates, boolean completion, immutable creator fields, and bounded dependency arrays.
- External users receive no direct Firestore access through the token.

For external views, duplicate only sanitized planner and task fields beneath `publicPlannerShares/{highEntropyToken}`. Rules allow reads only while the snapshot is enabled and allow writes only from members of the owning team. Rotating or deleting the token document immediately invalidates the old URL. The token is a bearer secret, so the UI must warn admins not to post it publicly.

## 8. Frontend Structure

Introduce routing and isolate Firebase access behind services/hooks so graph calculations remain testable as pure functions.

```text
src/
  auth/
    AuthProvider.jsx
    SignInPage.jsx
  teams/
    TeamDashboard.jsx
    TeamSettings.jsx
    Invitations.jsx
  planners/
    PlannerPage.jsx
    PlannerList.jsx
    PlannerRepository.js
    usePlanner.js
    usePlannerTasks.js
  graph/
    TaskGraph.jsx
    TaskList.jsx
    exports.js
  firebase/
    client.js
    converters.js
  components/
    AppShell.jsx
    GuidePage.jsx
    SaveStatus.jsx
    ReadOnlyBanner.jsx
```

Recommended routes:

```text
/sign-in
/help
/teams
/teams/:teamId
/teams/:teamId/planners/:plannerId
/share/:shareToken
```

The URL is the source of planner navigation state, enabling bookmarks and browser navigation. Protected routes wait for Auth initialization before evaluating membership to avoid unauthorized-content flashes.

## 9. Team and Planner User Experience

### Team dashboard

- Team switcher for users in multiple teams.
- Planner cards or rows with name, description, task progress, last updated time, creator, and archive state.
- Search by planner name and sort by recent activity or name.
- `New planner` available to all members.
- Team settings and invitations visible only to owners/admins.

### Planner page

- Breadcrumb back to the owning team.
- Editable planner name and description for members.
- Desktop toggle between graph and list views.
- Members can drag task cards into a shared persistent arrangement on desktop and tablet; arrows remain attached and positions save on drop.
- Provide `Auto-arrange` to replace manual placement with the deterministic Dagre layout. External views and PNG/SVG exports use the same saved positions.
- Read-only status reflected in disabled controls, banners, and accessible labels—not only by hiding buttons.
- Preserve critical-path and priority calculations as client-derived values; do not persist them because they are deterministic from task data.

### Loading and errors

- Use skeleton/loading states while Auth, membership, planner, and task subscriptions resolve.
- Distinguish `not found`, `share link revoked`, `signed in but not authorized`, and network/offline errors.
- Provide retry actions and keep unsaved form input when recoverable writes fail.

### Guide/Help page

Add a lightweight `/help` page available from the global navigation, planner toolbar, sign-in screen, and external read-only view. Keep it static and version-controlled so it loads without Firestore access and remains available to signed-out visitors.

Limit the first-version guide to short, task-oriented sections:

- **Start:** sign in, open a team, and create or open a planner.
- **Tasks:** add, edit, complete, and delete a task; explain `Ready`, `Blocked`, and `Complete` in one sentence each.
- **Dependencies:** connect tasks on desktop and select prerequisites on mobile; briefly explain why cycles are rejected.
- **Sharing:** distinguish team editing from an external view-only link and explain how an admin revokes a link.
- **Exporting:** identify PNG, SVG, Mermaid, and JSON in one line each, including which formats to insert manually into Confluence.
- **Saving and offline use:** explain `Saving`, `Saved`, and `Offline`, plus what to do after an edit conflict.

Content rules:

- Prefer numbered actions, direct labels that match the interface, and small annotated screenshots only when text would be ambiguous.
- Keep each section independently scannable and avoid product history, architecture, marketing language, exhaustive FAQs, or duplicated policy text.
- Link users directly to the relevant guide section from complex controls and recoverable error messages.
- Show role-specific actions only when relevant; clearly mark owner/admin-only steps.
- Provide a short `Still stuck?` block with the support/contact route chosen before launch, without inventing unsupported troubleshooting steps.
- Treat guide accuracy as part of feature completion: interface-label or workflow changes must update the corresponding help text in the same change.

## 10. Mobile Experience

Use a responsive breakpoint based on available layout width rather than user agent.

- Default phones to a vertical task list grouped by `Ready`, `Blocked`, and `Complete`.
- Support add, edit, complete, and delete in touch-friendly sheets/dialogs.
- Replace drag handles with a `Prerequisites` multi-select/search field that uses the same dependency transaction.
- Provide task search and compact priority/critical-path indicators.
- Keep the graph available as a secondary read-oriented view with pan, pinch-zoom, fit-to-view, and task detail selection.
- Do not require precision edge dragging on touch devices.
- Use at least 44-by-44-pixel touch targets, safe-area padding, keyboard-aware dialogs, and reduced-motion support.
- Test at 320, 375, 390, 768, and desktop widths with both touch and keyboard navigation.

## 11. Export and Confluence Compatibility

Add an `Export` menu with:

- **PNG:** raster image at user-selectable 1x/2x scale with a solid background.
- **SVG:** scalable diagram suitable for Confluence upload and further editing.
- **Mermaid Markdown:** a `flowchart LR` representation with safely escaped task titles, status labels, estimates, and dependency edges.
- Retain JSON import/export as data backup and migration tooling, but label it separately from diagram export.

Export requirements:

- Export the complete laid-out graph, not only the visible viewport.
- Include planner title, generation timestamp, and a small status legend unless the user disables metadata.
- Generate from a consistent in-memory snapshot tied to a `graphRevision`; warn and retry if a dependency mutation completes during export.
- Sanitize text before inserting it into SVG or Mermaid output.
- Avoid remote fonts or images so exported files remain portable.
- Verify the output manually by uploading each format to a Confluence Cloud page. Direct API publishing and a live Forge macro remain future work.

## 12. Migration and Backward Compatibility

On a signed-in user's first visit, detect the existing `task-dependencies-v1` local-storage payload.

1. Explain that local tasks can be copied into a selected team as a new planner.
2. Let the user select a destination team and planner name.
3. Validate with the existing import parser plus server limits.
4. Submit the complete graph in one bounded Firestore batch after client validation; Rules validate membership, shapes, limits, and graph/task consistency.
5. Mark migration complete only after Firestore confirms the batch.
6. Keep the original local data until the user explicitly removes it; never silently delete it.

Continue accepting the version-1 JSON format. Add a version-2 export envelope with planner metadata while keeping tasks structurally compatible where practical.

## 13. Delivery Phases

### Phase 0: Foundation

- Create development and production Firebase projects and explicit Hosting sites.
- Add Firebase SDK, routing, environment configuration, emulators, CI, and deployment config.
- Define shared data types, Firestore converters, field limits, and error conventions.
- Add Auth provider and Google sign-in/sign-out.

**Exit criteria:** the SPA deploys to a preview channel; emulator and CI test suites run; protected routes reliably identify the signed-in user.

### Phase 1: Teams and authorization

- Implement teams, canonical memberships, user team references, invitations, and role-aware settings.
- Add and test Security Rules before exposing planner data.
- Build the team switcher and organized planner dashboard.

**Exit criteria:** invited Google users can join; nonmembers cannot read or write team data; members can create planners; only owners/admins manage membership.

### Phase 2: Persistent planners and real-time tasks

- Add planner/task repositories and subscriptions.
- Refactor the existing app to consume remote task state.
- Implement optimistic ordinary task edits, revision conflicts, save/offline states, and transactional dependency/deletion operations.
- Preserve priority, blocked/ready, and critical-path behavior.

**Exit criteria:** two browsers edit the same planner in real time; task-field conflicts do not silently erase drafts; supported client transactions serialize simultaneous edge additions and reject cycles.

### Phase 3: External sharing

- Add secure token creation, rotation, revocation, and sanitized public Firestore snapshots.
- Build the read-only share route and authorization-state messaging.
- Add App Check where applicable and document Spark quota protections.

**Exit criteria:** a revoked link stops working; external users cannot write or enumerate private planners; team members retain normal editing through authenticated routes.

### Phase 4: Mobile, exports, and help

- Build the mobile task list and prerequisite selector.
- Improve responsive navigation and touch behavior.
- Add PNG, SVG, and Mermaid exports and retain JSON backup tools.
- Add the concise Guide/Help page and contextual links from dependency, sharing, export, offline, and conflict UI.

**Exit criteria:** all core task operations work without graph dragging on a 320-pixel viewport; exports contain the full graph and render correctly after manual Confluence insertion; a new user can complete the primary workflows using the guide without encountering stale labels or unavailable actions.

### Phase 5: Migration, hardening, and launch

- Add local-storage and JSON migration.
- Complete accessibility, performance, security, and failure-mode testing.
- Add monitoring, error reporting, budget alerts, backups/export procedures, operational documentation, and a launch checklist.
- Run a small team pilot before production rollout.

**Exit criteria:** the acceptance criteria below pass in production-like staging, rollback is documented, and local users can migrate without losing their original data.

## 14. Testing Strategy

### Unit tests

- Existing cycle, critical-path, and priority calculations.
- Firestore converters and schema validation.
- Mermaid escaping and deterministic export generation.
- Role and capability helpers.
- Conflict resolution and migration parsing.

### Security Rules tests

Use the Firestore Emulator to cover every role and unauthenticated access:

- Owner/admin/member/nonmember/external-link viewer.
- Cross-team reads and writes.
- Membership privilege escalation.
- Direct dependency and revision manipulation.
- Invalid fields, oversized strings/arrays, and immutable-field changes.

Default-deny cases are as important as allowed cases.

### Firestore transaction integration tests

- Concurrent edge additions that would jointly create a cycle.
- Stale `graphRevision` retries.
- Task deletion with inbound dependency cleanup.
- Invitation acceptance by the correct and incorrect Google email.
- Share-token generation, snapshot synchronization, rotation, and revocation.
- Atomic import rollback for invalid graphs.

### Browser end-to-end tests

- Google Auth should be represented by an emulator/test-auth path in CI rather than live accounts.
- Create a team, invite a member, create a planner, edit concurrently in two sessions, share externally, revoke sharing, export, and migrate local data.
- Exercise desktop mouse, mobile touch-sized layout, keyboard-only operation, and screen-reader names.
- Verify `/help` is available while signed out, all contextual help links reach the correct section, and documented actions match the current role and interface labels.

### Performance targets

With 100 tasks and 10 active clients:

- Initial planner data becomes usable within 3 seconds on a representative mid-range mobile connection after authentication.
- Ordinary remote task updates appear to other connected clients within 1 second under normal conditions.
- Graph interaction remains responsive and export completes without truncation.
- Firestore listeners are detached when leaving a planner to prevent duplicate reads and memory leaks.

## 15. Observability and Operations

- Capture client and Firestore write errors with environment and request correlation IDs, excluding task content and tokens.
- Record structured audit events for team membership changes, planner creation/archive/deletion, and share-link lifecycle events.
- Monitor Firestore reads/writes, Hosting traffic, Auth failures, App Check metrics, and quota usage.
- Keep the project on Spark for a hard billing boundary and define operational responses for quota exhaustion.
- Document incident procedures for leaked share links, compromised team access, failed migrations, quota exhaustion, and rollback.
- Define a retention policy before launch. Archive should be reversible; hard deletion should have a documented grace period and recursive cleanup process.

## 16. First-Version Acceptance Criteria

The release is complete when all of the following are true:

- A user can sign in with Google, create a team, invite Google-account users, and see their teams after returning on another device.
- Any member can create and edit planners in their team; owners/admins alone can manage membership and sharing.
- A nonmember cannot read a planner through authenticated Firestore access.
- An active unlisted link provides a sanitized view-only planner, and rotation or revocation invalidates it.
- Ten connected sessions can observe task changes without manual refresh.
- Concurrent dependency mutations made through the supported client are serialized and cannot commit a cycle.
- Desktop users can edit through the graph; mobile users can complete all core edits through the list and prerequisite selector.
- PNG, SVG, and Mermaid exports represent the complete planner and can be manually inserted into Confluence.
- Signed-in, signed-out, mobile, and external viewers can open a concise Guide/Help page; its instructions and labels match the released interface.
- Existing local and version-1 JSON data can be imported without silently deleting the source.
- Automated unit, Rules, Firestore transaction integration, and browser smoke tests pass in CI.

## 17. Deferred Work

- Visible presence, cursors, and task-editing indicators.
- Comments, mentions, notifications, and activity feeds beyond administrative audit events.
- Planner-level custom roles or per-planner edit exceptions.
- Organization-domain auto-join and enterprise SAML/OIDC.
- Direct Confluence attachment publishing, synchronization, or a live Forge macro.
- Native mobile applications and push notifications.
- Large-graph optimization beyond roughly 100 tasks.
- Full version history, task assignments, dates, resource leveling, and advanced project-management reporting.

## 18. Key Risks and Mitigations

- **Concurrent graph corruption:** route supported dependency and destructive graph mutations through Firestore transactions; test adversarial concurrency and document the trusted-member limitation.
- **Security-rule drift:** keep Rules in version control, test every role in CI, and default deny unspecified paths and fields.
- **External-link leakage:** use high-entropy opaque tokens, support immediate rotation/revocation, expose only sanitized snapshots, and avoid indexing shared pages.
- **Lost edits:** use per-task revisions, field-scoped updates, preserved drafts, explicit conflict handling, and visible offline/save states.
- **Mobile graph usability:** make the list and prerequisite selector the complete mobile editing experience rather than requiring edge dragging.
- **Quota exhaustion:** remain on Spark, use scoped listeners, unsubscribe on navigation, denormalize only dashboard essentials, enforce the 100-task limit, and monitor free-tier usage.
- **Export fidelity:** export from a full off-screen graph snapshot, bundle all styles, sanitize labels, and test outputs in Confluence.

## 19. Architecture Decision Summary

- Firebase Hosting, Authentication, Firestore, App Check, and Emulator Suite are approved for version one; billing-required services are excluded.
- Firestore stores one document per task, with dependency IDs embedded on the dependent task.
- Team membership grants planner editing; external sharing is tokenized and strictly view-only.
- Security Rules enforce authorization and graph/task consistency; the trusted client transaction enforces acyclicity.
- Desktop retains graph-first editing; mobile uses a list-first editor.
- Confluence support begins with portable export formats, not API integration.
