// Renders docs/writeup.html to docs/GRIT_Interview_Hub_Writeup.pdf (A4) and fails if it is not exactly 2 pages.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path'; import fs from 'node:fs';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'docs/GRIT_Interview_Hub_Writeup.pdf');
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto(pathToFileURL(path.join(root, 'docs/writeup.html')).href);
const overflow = await p.evaluate(() => [...document.querySelectorAll('.page')].map(pg => pg.scrollHeight - pg.clientHeight));
await p.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
const pages = (fs.readFileSync(out, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log(`pages: ${pages} · content overflow per page (px): ${overflow.join(', ')}`);
if (pages !== 2 || overflow.some(o => o > 0)) { console.error('Write-up must be exactly 2 pages with no clipped content'); process.exit(1); }
