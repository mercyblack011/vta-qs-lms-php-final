// Builds docs/Research-Document.pdf from docs/research/research-document.html.
// Usage (from the repo root): node docs/research/build-pdf.mjs
// Needs Node.js 22+ and Google Chrome, Microsoft Edge or Chromium. Set CHROME_PATH to use a specific browser.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'research-document.html');
const output = resolve(here, '..', 'Research-Document.pdf');

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) { console.error('No Chrome, Edge or Chromium found. Set CHROME_PATH.'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'research-pdf-'));
const child = spawn(browser, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

try {
  let port;
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100);
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
  }
  if (!port) throw new Error('Browser did not start');

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(source).href });
  await sleep(2500); // let images and fonts finish loading

  const footer = `<div style="width:100%;font:8px Segoe UI,Arial,sans-serif;color:#8A8A94;padding:0 17mm;display:flex;justify-content:space-between">
    <span>VTA QS LMS · Research document</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
  const res = await send('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: footer,
  });
  if (!res.result) throw new Error(JSON.stringify(res.error));
  writeFileSync(output, Buffer.from(res.result.data, 'base64'));
  console.log('Wrote', output);
  ws.close();
} finally {
  child.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
