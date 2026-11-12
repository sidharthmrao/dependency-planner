import { resolveTaskPositions } from './layout.js';

const WIDTH = 260;
const HEIGHT = 130;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeMermaid(value) {
  return String(value).replaceAll('"', "'").replace(/\s+/g, ' ');
}

function wrappedLines(text, max = 34, limit = 3) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max && line) {
      lines.push(line);
      line = word;
      if (lines.length === limit - 1) break;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line && lines.length < limit) lines.push(line);
  return lines;
}

export function exportLayout(tasks) {
  if (!tasks.length) return { positions: {}, width: WIDTH, height: HEIGHT };
  const raw = resolveTaskPositions(tasks);
  const values = Object.values(raw);
  const minX = Math.min(...values.map((position) => position.x));
  const minY = Math.min(...values.map((position) => position.y));
  const positions = Object.fromEntries(Object.entries(raw).map(([id, position]) => [id, {
    x: position.x - minX + 36,
    y: position.y - minY + 64,
  }]));
  return {
    positions,
    width: Math.max(WIDTH + 72, Math.max(...Object.values(positions).map((position) => position.x + WIDTH)) + 36),
    height: Math.max(HEIGHT + 128, Math.max(...Object.values(positions).map((position) => position.y + HEIGHT)) + 36),
  };
}

export function buildSvg(planner, generatedAt = new Date()) {
  const tasks = planner.tasks || [];
  const { positions, width, height } = exportLayout(tasks);
  const canvasWidth = Math.max(620, Math.ceil(width));
  const canvasHeight = Math.max(260, Math.ceil(height));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const edges = tasks.flatMap((task) => task.dependencyIds.map((dependencyId) => {
    if (!positions[dependencyId]) return '';
    const source = positions[dependencyId];
    const target = positions[task.id];
    const sourceX = source.x + WIDTH;
    const sourceY = source.y + HEIGHT / 2;
    const targetX = target.x;
    const targetY = target.y + HEIGHT / 2;
    const bend = Math.max(60, Math.abs(targetX - sourceX) / 2);
    return `<path d="M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}" fill="none" stroke="#8391a2" stroke-width="2" marker-end="url(#arrow)"/>`;
  })).join('');
  const nodes = tasks.map((task) => {
    const { x, y } = positions[task.id];
    const blocked = task.dependencyIds.some((id) => byId.has(id) && !byId.get(id).completed);
    const status = task.completed ? 'Complete' : blocked ? 'Blocked' : 'Ready';
    const accent = task.completed ? '#8b98a8' : blocked ? '#d29a37' : '#2f9568';
    const titleLines = wrappedLines(task.title);
    const title = titleLines.map((line, index) => `<text x="${x + 18}" y="${y + 34 + index * 19}" class="title">${escapeXml(line)}</text>`).join('');
    return `<g><rect x="${x}" y="${y}" width="${WIDTH}" height="${HEIGHT}" rx="12" fill="#fff" stroke="${accent}" stroke-width="2"/>${title}<text x="${x + 18}" y="${y + 94}" class="meta">${escapeXml(status)} · ${escapeXml(task.estimatedHours)} h</text></g>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8391a2"/></marker></defs>
  <style>.title{font:600 15px system-ui,sans-serif;fill:#17202b}.meta{font:13px system-ui,sans-serif;fill:#5d6877}.heading{font:700 20px system-ui,sans-serif;fill:#17202b}.stamp{font:12px system-ui,sans-serif;fill:#6f7a88}</style>
  <rect width="100%" height="100%" fill="#f7f8fa"/>
  <text x="36" y="30" class="heading">${escapeXml(planner.name)}</text>
  <text x="${canvasWidth - 36}" y="29" text-anchor="end" class="stamp">Exported ${escapeXml(generatedAt.toLocaleString())}</text>
  ${edges}${nodes}
</svg>`;
}

export function buildMermaid(planner) {
  const lines = ['flowchart LR'];
  const idMap = new Map((planner.tasks || []).map((task, index) => [task.id, `task_${index + 1}`]));
  for (const task of planner.tasks || []) {
    const status = task.completed ? 'Complete' : 'Open';
    lines.push(`  ${idMap.get(task.id)}["${escapeMermaid(task.title)}<br/>${status} · ${task.estimatedHours} h"]`);
  }
  for (const task of planner.tasks || []) {
    for (const dependencyId of task.dependencyIds) {
      if (idMap.has(dependencyId)) lines.push(`  ${idMap.get(dependencyId)} --> ${idMap.get(task.id)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function downloadBlob(contents, type, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'planner';
}

export function downloadSvg(planner) {
  downloadBlob(buildSvg(planner), 'image/svg+xml', `${safeName(planner.name)}.svg`);
}

export function downloadMermaid(planner) {
  downloadBlob(buildMermaid(planner), 'text/markdown', `${safeName(planner.name)}.md`);
}

export function downloadJson(planner) {
  const contents = JSON.stringify({ version: 2, planner: { name: planner.name, description: planner.description }, tasks: planner.tasks }, null, 2);
  downloadBlob(contents, 'application/json', `${safeName(planner.name)}.json`);
}

export async function downloadPng(planner, scale = 2) {
  const svg = buildSvg(planner);
  const dimensions = svg.match(/width="(\d+)" height="(\d+)"/);
  const width = Number(dimensions?.[1] || 1200);
  const height = Number(dimensions?.[2] || 700);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const pngUrl = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = pngUrl;
    link.download = `${safeName(planner.name)}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
