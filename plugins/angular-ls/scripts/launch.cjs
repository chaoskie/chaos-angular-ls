#!/usr/bin/env node
// Starts the Angular language server (ngserver) over stdio.
//
// ngserver refuses to start unless it is told where to look for TypeScript and
// for @angular/language-service. This launcher passes the project folder first
// and the server's own install folder second, so the project's versions win
// when the project has them.
//
// stdout belongs to the LSP protocol. Everything this file prints goes to stderr.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SERVER_PKG = '@angular/language-server';

function isServerDir(dir) {
  return fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'index.js'));
}

// Walks up from `start` and returns the first node_modules/@angular/language-server found.
function findInNodeModules(start) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...SERVER_PKG.split('/'));
    if (isServerDir(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Finds the package behind an `ngserver` command on PATH.
function findOnPath() {
  const names = process.platform === 'win32' ? ['ngserver.cmd', 'ngserver'] : ['ngserver'];
  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    if (!entry) continue;
    for (const name of names) {
      const file = path.join(entry, name);
      if (!fs.existsSync(file)) continue;
      // POSIX: the command is a symlink to <package>/bin/ngserver.
      try {
        const pkg = path.dirname(path.dirname(fs.realpathSync(file)));
        if (isServerDir(pkg)) return pkg;
      } catch {}
      // Windows: the command is a shim next to a node_modules folder.
      const beside = path.join(entry, 'node_modules', ...SERVER_PKG.split('/'));
      if (isServerDir(beside)) return beside;
    }
  }
  return null;
}

function findInGlobalRoot() {
  try {
    const root = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
      timeout: 15000,
    }).trim();
    const candidate = path.join(root, ...SERVER_PKG.split('/'));
    return isServerDir(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const override = process.env.ANGULAR_LS_SERVER_DIR;

let serverDir = null;
if (override) {
  if (!isServerDir(override)) {
    console.error(`angular-ls: ANGULAR_LS_SERVER_DIR does not hold ${SERVER_PKG}: ${override}`);
    process.exit(1);
  }
  serverDir = path.resolve(override);
} else {
  serverDir = findInNodeModules(projectDir) || findOnPath() || findInGlobalRoot();
}

if (!serverDir) {
  console.error(
    `angular-ls: could not find ${SERVER_PKG}. Install it with "npm install -g ${SERVER_PKG}" ` +
      'or add it to the project as a dev dependency.'
  );
  process.exit(1);
}

const probe = [...new Set([projectDir, process.cwd(), serverDir])].join(',');

if (process.argv.includes('--print-config')) {
  // For troubleshooting: show what would be used, then stop.
  console.error(JSON.stringify({ serverDir, probeLocations: probe.split(',') }, null, 2));
  process.exit(0);
}

const extra = process.argv.slice(2);
process.argv = [
  process.argv[0],
  path.join(serverDir, 'index.js'),
  '--stdio',
  '--tsProbeLocations', probe,
  '--ngProbeLocations', probe,
  ...extra,
];
require(path.join(serverDir, 'index.js'));
