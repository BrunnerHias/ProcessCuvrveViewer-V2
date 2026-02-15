// ============================================================
// Post-build: Fix HTML for file:// portability
// Strategy:
//   1. Inline CSS into <style> tags (avoid CSS file CORS)
//   2. Convert <script type="module"> to classic <script defer>
//      and move to end of <body> (classic scripts have no CORS)
//   3. Remove modulepreload links
// Result: dist/ folder with index.html + assets/xxx.js works
// via file:// double-click in Chrome.
// ============================================================

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const distDir = resolve(import.meta.dirname, '..', 'dist');
const assetsDir = join(distDir, 'assets');
const htmlPath = join(distDir, 'index.html');

let html = readFileSync(htmlPath, 'utf-8');
const assetFiles = readdirSync(assetsDir);

// 1. Inline CSS: replace <link rel="stylesheet" href="./assets/xxx.css"> with <style>
for (const file of assetFiles.filter(f => f.endsWith('.css'))) {
  const css = readFileSync(join(assetsDir, file), 'utf-8');
  const linkPattern = new RegExp(
    `<link[^>]*href=["']\\./assets/${file.replace(/\./g, '\\.')}["'][^>]*>`,
    'g'
  );
  html = html.replace(linkPattern, `<style>${css}</style>`);
}

// 2. For each JS file: remove the original <script type="module"> from <head>
//    and insert a classic <script defer> at end of <body>
const scriptTags = [];
for (const file of assetFiles.filter(f => f.endsWith('.js'))) {
  const scriptPattern = new RegExp(
    `<script[^>]*src=["']\\./assets/${file.replace(/\./g, '\\.')}["'][^>]*>\\s*</script>`,
    'g'
  );
  html = html.replace(scriptPattern, '');
  // Classic <script defer> — no CORS restriction on file://, runs after DOM parsed
  scriptTags.push(`<script defer src="./assets/${file}"></script>`);
}

// 3. Remove modulepreload links and any remaining Vite inline module scripts
html = html.replace(/<link[^>]*rel=["']modulepreload["'][^>]*>/g, '');
html = html.replace(/<script type="module"[^>]*>[\s\S]*?<\/script>/g, '');

// 4. Insert classic script tags right before </body>
html = html.replace('</body>', `${scriptTags.join('\n')}\n</body>`);

writeFileSync(htmlPath, html, 'utf-8');

const jsFiles = assetFiles.filter(f => f.endsWith('.js'));
console.log(`✓ Patched index.html for file:// portability`);
console.log(`  → CSS inlined, JS loaded as classic <script defer>`);
console.log(`  → Files: index.html + ${jsFiles.map(f => 'assets/' + f).join(', ')}`);
console.log(`  → Copy the entire dist/ folder to use anywhere`);
