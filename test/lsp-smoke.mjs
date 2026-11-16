#!/usr/bin/env node
// Starts the language server exactly as plugin.json describes it and talks LSP to it:
// initialize, open the fixture template, then ask for hover, definition and diagnostics.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { marketplacePath, readJson, pluginRootOf, resolveServer, repoRoot } from './plugin-config.mjs';

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 90000);
const fixture = path.join(repoRoot, 'test', 'fixture');
const templatePath = path.join(fixture, 'src', 'app', 'app.component.html');
const templateUri = pathToFileURL(templatePath).href;
const templateText = fs.readFileSync(templatePath, 'utf8');

if (!fs.existsSync(path.join(fixture, 'node_modules', '@angular', 'core'))) {
  console.error('FAIL  fixture packages are missing. Run: npm ci --ignore-scripts --prefix test/fixture');
  process.exit(1);
}

const entry = readJson(marketplacePath).plugins.find((p) => p.name === 'angular-ls');
const pluginRoot = pluginRootOf(entry);
const server = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json')).lspServers.angular;
const { command, args } = resolveServer(pluginRoot, server);
const languageId = server.extensionToLanguage['.html'];

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}

const child = spawn(command, args, {
  cwd: fixture,
  env: { ...process.env, ...(server.env || {}), CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: fixture },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
let exited = false;
child.on('exit', () => { exited = true; });
child.on('error', (e) => { console.error(`FAIL  could not start ${command}: ${e.message}`); process.exit(1); });

// --- JSON-RPC over stdio with Content-Length framing
let nextId = 1;
const pending = new Map();
const diagnostics = new Map();
const notifications = [];
function send(msg) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }), 'utf8');
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
}
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
}
function onMessage(msg) {
  if (msg.id !== undefined && msg.method) {
    // A request from the server. Answer the common ones so it does not wait for us.
    const result = msg.method === 'workspace/configuration' ? (msg.params?.items || []).map(() => null) : null;
    send({ id: msg.id, result });
  } else if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (p) msg.error ? p.reject(new Error(`${msg.error.code} ${msg.error.message}`)) : p.resolve(msg.result);
  } else if (msg.method === 'textDocument/publishDiagnostics') {
    diagnostics.set(msg.params.uri, msg.params.diagnostics);
  } else if (msg.method) {
    notifications.push(msg.method);
  }
}
let buffer = Buffer.alloc(0);
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const match = /Content-Length: *(\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'));
    if (!match) { console.error('FAIL  server wrote something that is not LSP to stdout'); process.exit(1); }
    const start = headerEnd + 4;
    const end = start + Number(match[1]);
    if (buffer.length < end) return;
    onMessage(JSON.parse(buffer.subarray(start, end).toString('utf8')));
    buffer = buffer.subarray(end);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + TIMEOUT_MS;
async function until(fn, what) {
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (exited) throw new Error(`server exited while waiting for ${what}`);
    if (Date.now() > deadline) throw new Error(`timed out after ${TIMEOUT_MS} ms waiting for ${what}`);
    await sleep(500);
  }
}
function positionOf(needle) {
  const offset = templateText.indexOf(needle);
  const before = templateText.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before.at(-1).length + 1 };
}
function hoverText(hover) {
  const c = hover?.contents;
  if (!c) return '';
  return (Array.isArray(c) ? c : [c]).map((x) => (typeof x === 'string' ? x : x.value)).join('\n');
}

const watchdog = setTimeout(() => {
  console.error(`FAIL  no result after ${TIMEOUT_MS + 10000} ms`);
  if (stderr) console.error(`--- server stderr\n${stderr}`);
  child.kill('SIGKILL');
  process.exit(1);
}, TIMEOUT_MS + 10000);

try {
  console.log(`server command: ${[server.command, ...(server.args || [])].join(' ')}`);
  const init = await Promise.race([
    request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(fixture).href,
      workspaceFolders: [{ uri: pathToFileURL(fixture).href, name: 'fixture' }],
      capabilities: {
        textDocument: {
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          publishDiagnostics: {},
        },
        workspace: { workspaceFolders: true, configuration: true },
      },
    }),
    until(() => false, 'the initialize response'),
  ]);
  check(Boolean(init?.capabilities), 'initialize answered with capabilities');
  check(Boolean(init?.capabilities?.hoverProvider), 'server offers hover');
  check(Boolean(init?.capabilities?.definitionProvider), 'server offers go to definition');
  send({ method: 'initialized', params: {} });

  send({
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: templateUri, languageId, version: 1, text: templateText } },
  });
  const doc = { uri: templateUri };
  const titlePos = positionOf('title');

  const hover = await until(
    () => request('textDocument/hover', { textDocument: doc, position: titlePos }).catch(() => null),
    'a hover result for "title" in the template',
  );
  const text = hoverText(hover);
  check(/title/.test(text) && /string/.test(text), 'hover on {{ title }} shows the property and its type',
    JSON.stringify(text.replace(/\s+/g, ' ').trim()));

  const def = await request('textDocument/definition', { textDocument: doc, position: titlePos });
  const targets = (Array.isArray(def) ? def : def ? [def] : []).map((d) => d.targetUri || d.uri);
  check(targets.some((u) => u.endsWith('/app.component.ts')), 'definition of title points into app.component.ts',
    targets.map((u) => path.basename(u)).join(', ') || 'no result');

  const diags = await until(
    () => (diagnostics.get(templateUri) || []).length > 0 && diagnostics.get(templateUri),
    'diagnostics for the template',
  );
  const messages = diags.map((d) => d.message);
  check(messages.some((m) => m.includes('missingProperty')), 'diagnostics report the unknown property in the template',
    JSON.stringify(messages));

  await request('shutdown', null);
  send({ method: 'exit' });
  await Promise.race([until(() => exited, 'the server to exit'), sleep(5000)]);
  check(exited, 'server exits after shutdown and exit');
} catch (e) {
  check(false, 'smoke test', e.message);
}

clearTimeout(watchdog);
if (!exited) child.kill('SIGKILL');
if (failures > 0) {
  if (notifications.length) console.error(`--- notifications seen: ${[...new Set(notifications)].join(', ')}`);
  if (stderr) console.error(`--- server stderr\n${stderr}`);
}
console.log(failures === 0 ? '\nlsp smoke test: all checks passed' : `\nlsp smoke test: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
