# Dependency-based Project Planner

A small local React app for creating tasks with descriptions and prerequisites. Tasks are saved in this browser's local storage.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. Use `npm run build` to check the production build.

Use **Add task** to open a popup for a name, optional description, and required estimated duration in hours. Each node shows these details and a completion checkbox; use **Edit** inside the node to change them. Drag from a prerequisite's right handle to a dependent task's left handle to add a dependency. Select an arrow and press Delete or Backspace to remove it. The graph automatically lays out prerequisites before dependent tasks. A blocked task becomes ready when its prerequisites are complete. Circular dependencies are prevented.

Ready tasks receive priority numbers based on how many unfinished tasks depend on them downstream. Tasks with the same count share a priority number, and the next rank is consecutive. Use **Show critical path** to highlight the longest remaining dependency chain and see its estimated hours remaining. Completed tasks are excluded. Previously saved tasks without an estimate receive a 1-hour estimate when loaded.
