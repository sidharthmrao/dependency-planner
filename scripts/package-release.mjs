import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const releaseDir = path.join(projectRoot, 'release');
const { version } = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));

let html = await readFile(path.join(distDir, 'index.html'), 'utf8');
const scriptTag = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const styleTag = html.match(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/);

if (!scriptTag || !styleTag) {
  throw new Error('Expected one Vite JavaScript bundle and one stylesheet in dist/index.html');
}

async function readAsset(assetPath) {
  const relativePath = assetPath.replace(/^\.\//, '').replace(/^\//, '');
  const absolutePath = path.resolve(distDir, relativePath);
  if (!absolutePath.startsWith(`${distDir}${path.sep}`)) {
    throw new Error(`Asset path leaves dist: ${assetPath}`);
  }
  return readFile(absolutePath, 'utf8');
}

const javascript = await readAsset(scriptTag[1]);
const stylesheet = await readAsset(styleTag[1]);

html = html.replace(scriptTag[0], () => `<script type="module">\n${javascript.replaceAll('</script', '<\\/script')}\n</script>`);
html = html.replace(styleTag[0], () => `<style>\n${stylesheet.replaceAll('</style', '<\\/style')}\n</style>`);

if (html.includes(scriptTag[0]) || html.includes(styleTag[0])) {
  throw new Error('The release HTML still references external build assets');
}

await mkdir(releaseDir, { recursive: true });
const artifact = path.join(releaseDir, `Dependency-based-Project-Planner-v${version}.html`);
await writeFile(artifact, html);
process.stdout.write(`${artifact}\n`);
