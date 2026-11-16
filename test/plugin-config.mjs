// Shared by the tests: reads the manifests and resolves the server command the
// same way Claude Code does (it replaces ${CLAUDE_PLUGIN_ROOT} with the plugin folder).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const marketplacePath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function pluginRootOf(entry) {
  return path.resolve(repoRoot, entry.source);
}

export function resolveServer(pluginRoot, server) {
  const sub = (s) => s.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
  return { command: sub(server.command), args: (server.args || []).map(sub) };
}

export function findOnPath(command) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const file = path.join(dir, command + ext);
      if (dir && fs.existsSync(file)) return file;
    }
  }
  return null;
}
