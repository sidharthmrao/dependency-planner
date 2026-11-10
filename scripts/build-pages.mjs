import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const pagesDir = path.join(projectRoot, 'docs');

process.env.GITHUB_PAGES = 'true';
await build();
await mkdir(pagesDir, { recursive: true });
await cp(distDir, pagesDir, { recursive: true, force: true });
await writeFile(path.join(pagesDir, '.nojekyll'), '');
process.stdout.write(`Built GitHub Pages site in ${pagesDir}\n`);
