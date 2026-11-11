import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import fs from 'fs'; import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const twBase = path.join(root, 'node_modules/tailwindcss');
const css = `@import "tailwindcss";
@theme {
  /* Brand palette — Jenny Henderson Studio: Midnight · Lionsmane · Celeste · Herb · Marigold */
  --color-midnight: #013D5A; --color-lionsmane: #FCF3E3; --color-celeste: #BDD3CE; --color-herb: #708C69; --color-marigold: #F4A258;
  --color-navy-800: #0B4D6E; --color-navy-900: #013D5A;
  /* "indigo" = interactive/info: Celeste tints → Midnight */
  --color-indigo-50: #EFF5F3; --color-indigo-100: #DDEAE6; --color-indigo-200: #BDD3CE; --color-indigo-300: #9DBDB7;
  --color-indigo-500: #1D6A8A; --color-indigo-600: #0E5576; --color-indigo-700: #013D5A; --color-indigo-800: #01324A; --color-indigo-900: #012638;
  /* "teal" + "emerald" = success/positive: Herb (600+ darkened for AA text contrast on white) */
  --color-teal-50: #F0F4EF; --color-teal-100: #DFE8DC; --color-teal-200: #C2D3BE; --color-teal-300: #A3BC9E; --color-teal-500: #708C69;
  --color-teal-600: #56704F; --color-teal-700: #485F42; --color-teal-800: #3A4C35; --color-teal-900: #2C3A29;
  --color-emerald-50: #F0F4EF; --color-emerald-200: #C2D3BE; --color-emerald-600: #56704F; --color-emerald-700: #485F42; --color-emerald-800: #3A4C35; --color-emerald-900: #2C3A29;
  /* "amber" = warning: Marigold (text steps darkened for contrast) */
  --color-amber-50: #FEF3E8; --color-amber-200: #F8CFA4; --color-amber-300: #F6BA7E; --color-amber-500: #F4A258;
  --color-amber-700: #94541A; --color-amber-800: #7A4515; --color-amber-900: #5A3310;
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
}
html { -webkit-font-smoothing: antialiased; }
:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
`;
// 1) JS bundle
const js = await build({ entryPoints: [path.join(root, 'src/ui/main.tsx')], bundle: true, minify: true, write: false, format: 'iife', target: 'es2020',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'warning' });
const code = js.outputFiles[0].text;
// 2) Tailwind: candidates = every token in the sources
const files = []; const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : /\.(tsx?|mjs)$/.test(e.name) && files.push(p); });
walk(path.join(root, 'src'));
const cands = new Set(); for (const f of files) for (const t of fs.readFileSync(f, 'utf8').split(/[\s"'`{}<>;]+/)) if (t && t.length < 200) cands.add(t.replace(/[,)]+$/, '')).add(t);
const tw = await compile(css, { base: twBase, loadStylesheet: async (id, b) => { const p = id === 'tailwindcss' ? path.join(twBase, 'index.css') : path.resolve(b, id); return { content: fs.readFileSync(p, 'utf8'), base: path.dirname(p), path: p }; } });
const out = tw.build([...cands]);
// 3) Single self-contained HTML
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GRIT Interview Hub</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${out}</style></head>
<body><div id="root"></div><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
console.log('built', (html.length / 1024).toFixed(0) + ' KB', 'css', (out.length / 1024).toFixed(0) + ' KB');
