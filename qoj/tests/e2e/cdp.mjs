// Minimal Chrome DevTools Protocol client (Node built-in WebSocket/fetch only).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dir = mkdtempSync(join(tmpdir(), 'qoj-e2e-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(100); }
    if (i === 99) throw new Error('Chrome did not start');
  }
  return {
    port,
    async close() { proc.kill('SIGKILL'); await sleep(100); try { rmSync(dir, { recursive: true, force: true }); } catch {} },
  };
}

export async function newTarget(port) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      for (const f of listeners.get(msg.method) || []) f(msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const on = (ev, f) => { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(f); };
  return {
    send, on, id: t.id,
    async close() { try { ws.close(); } catch {} try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); } catch {} },
  };
}
