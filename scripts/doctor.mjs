#!/usr/bin/env node
/**
 * Checks the things that actually stop this project from starting, and prints
 * the fix for each one. Run it with `npm run doctor` when something looks off.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function ok(label) {
  console.log(`  ✓ ${label}`);
}

function bad(label, fix) {
  console.log(`  ✗ ${label}`);
  problems.push(fix);
}

console.log('\nPen Fight Arena - environment check\n');

// Node version
const required = 20;
const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
if (major >= required) {
  ok(`Node.js ${process.versions.node}`);
} else {
  bad(
    `Node.js ${process.versions.node} is too old (need ${required} or newer)`,
    `Install Node.js ${required} LTS or newer from https://nodejs.org and reopen the terminal.`,
  );
}

// Dependencies
if (existsSync(join(root, 'node_modules'))) {
  ok('Dependencies installed');
} else {
  bad('node_modules is missing', 'Run: npm install');
}

// Shared package built
if (existsSync(join(root, 'shared', 'dist', 'index.js'))) {
  ok('Shared package built');
} else {
  bad(
    'shared/dist is missing',
    'Run: npm run build:shared   (npm install does this automatically too)',
  );
}

// Environment file
if (existsSync(join(root, '.env'))) {
  ok('.env present');
  const env = readFileSync(join(root, '.env'), 'utf8');
  const hasDb = /^\s*DATABASE_URL\s*=\s*\S+/m.test(env);
  notes.push(
    hasDb
      ? 'DATABASE_URL is set: the server will try PostgreSQL and fall back to local JSON if it cannot connect.'
      : 'No DATABASE_URL set: the server will use local JSON storage. Core gameplay is unaffected.',
  );
} else {
  notes.push('No .env file. Defaults are fine for local play; copy .env.example to .env to change them.');
}

// Rapier is the one dependency that must resolve for the server to simulate.
const rapier = join(root, 'node_modules', '@dimforge', 'rapier3d-compat', 'package.json');
if (existsSync(rapier)) {
  ok('Rapier physics engine installed');
} else {
  bad('Rapier physics engine not found', 'Run: npm install');
}

console.log('');
if (problems.length === 0) {
  console.log('Everything needed to run the game is in place.\n');
} else {
  console.log(`${problems.length} thing(s) to fix:\n`);
  for (const fix of problems) console.log(`  - ${fix}`);
  console.log('');
}

for (const note of notes) console.log(`Note: ${note}`);
console.log('');
process.exitCode = problems.length > 0 ? 1 : 0;
