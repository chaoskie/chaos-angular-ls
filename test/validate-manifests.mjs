#!/usr/bin/env node
// Checks the marketplace and plugin manifests without Claude Code:
// valid JSON, required fields, known field names, and that everything they point at exists.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { marketplacePath, readJson, pluginRootOf, resolveServer, findOnPath } from './plugin-config.mjs';

// Field names from the Claude Code plugin manifest reference ("lspServers" section).
const LSP_FIELDS = new Set([
  'command', 'extensionToLanguage', 'args', 'transport', 'env', 'initializationOptions',
  'settings', 'workspaceFolder', 'startupTimeout', 'shutdownTimeout', 'requestTimeout',
  'restartOnCrash', 'maxRestarts', 'diagnostics',
]);

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
  return ok;
}
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isPosInt = (v) => Number.isInteger(v) && v > 0;

let market;
try {
  market = readJson(marketplacePath);
  check(true, 'marketplace.json is valid JSON');
} catch (e) {
  check(false, 'marketplace.json is valid JSON', e.message);
  process.exit(1);
}

check(isText(market.name) && !/\s/.test(market.name), 'marketplace has a name without spaces');
check(isText(market.owner?.name), 'marketplace has owner.name');
check(Array.isArray(market.plugins) && market.plugins.length > 0, 'marketplace lists at least one plugin');

for (const entry of market.plugins || []) {
  const tag = `plugin "${entry.name}"`;
  check(isText(entry.name), `${tag}: entry has a name`);
  if (!check(isText(entry.source) && entry.source.startsWith('./'), `${tag}: source is a relative path starting with ./`)) continue;

  const root = pluginRootOf(entry);
  const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
  if (!check(fs.existsSync(manifestPath), `${tag}: ${entry.source}/.claude-plugin/plugin.json exists`)) continue;

  let manifest;
  try {
    manifest = readJson(manifestPath);
    check(true, `${tag}: plugin.json is valid JSON`);
  } catch (e) {
    check(false, `${tag}: plugin.json is valid JSON`, e.message);
    continue;
  }

  check(manifest.name === entry.name, `${tag}: plugin.json name matches the marketplace entry`, `${manifest.name}`);
  check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name || ''), `${tag}: name is kebab-case`);
  check(isText(manifest.version), `${tag}: plugin.json has a version`);
  check(!entry.version || entry.version === manifest.version, `${tag}: marketplace version matches plugin.json`, `${entry.version} vs ${manifest.version}`);
  check(isText(manifest.description), `${tag}: plugin.json has a description`);
  check(isText(manifest.author?.name), `${tag}: plugin.json has author.name`);

  const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  check(changelog.includes(`## ${manifest.version}`), `${tag}: CHANGELOG.md has an entry for ${manifest.version}`);

  const servers = manifest.lspServers;
  if (!check(servers && typeof servers === 'object' && !Array.isArray(servers) && Object.keys(servers).length > 0,
    `${tag}: plugin.json declares lspServers inline`)) continue;

  for (const [name, server] of Object.entries(servers)) {
    const stag = `${tag} server "${name}"`;
    const unknown = Object.keys(server).filter((k) => !LSP_FIELDS.has(k));
    check(unknown.length === 0, `${stag}: only documented fields`, unknown.join(', '));
    check(isText(server.command), `${stag}: has a command`);
    check(server.args === undefined || (Array.isArray(server.args) && server.args.every((a) => typeof a === 'string')),
      `${stag}: args is a list of strings`);
    const map = server.extensionToLanguage;
    const exts = map && typeof map === 'object' ? Object.entries(map) : [];
    check(exts.length > 0 && exts.every(([k, v]) => k.startsWith('.') && isText(v)),
      `${stag}: extensionToLanguage maps dotted extensions to language ids`);
    for (const key of ['startupTimeout', 'shutdownTimeout', 'requestTimeout']) {
      check(server[key] === undefined || isPosInt(server[key]), `${stag}: ${key} is a positive integer`);
    }
    check(server.maxRestarts === undefined || (Number.isInteger(server.maxRestarts) && server.maxRestarts >= 0),
      `${stag}: maxRestarts is zero or more`);
    if (!isText(server.command)) continue;

    const resolved = resolveServer(root, server);
    const isPath = resolved.command.includes('/') || resolved.command.includes('\\');
    check(isPath || !/\s/.test(resolved.command), `${stag}: command has no spaces`);
    const found = isPath ? (fs.existsSync(resolved.command) ? resolved.command : null) : findOnPath(resolved.command);
    check(Boolean(found), `${stag}: command "${server.command}" exists`, 'not found');

    // Every argument that points into the plugin must exist and stay inside it.
    for (const [i, raw] of (server.args || []).entries()) {
      if (!raw.includes('${CLAUDE_PLUGIN_ROOT}')) continue;
      const file = resolved.args[i];
      const inside = !path.relative(root, file).startsWith('..');
      check(inside && fs.existsSync(file), `${stag}: ${raw} exists inside the plugin`);
      if (/\.[cm]?js$/.test(file) && fs.existsSync(file)) {
        const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        check(syntax.status === 0, `${stag}: ${path.basename(file)} passes a syntax check`, syntax.stderr.trim());
      }
    }
  }
}

console.log(failures === 0 ? '\nmanifests: all checks passed' : `\nmanifests: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
