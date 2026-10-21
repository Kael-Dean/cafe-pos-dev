#!/usr/bin/env node
// Copies the shared static assets (packages/pos-core/public: sw.js, offline page,
// PWA icons, logo, ePOS SDK) into the calling app's public/ before dev/build.
// Next serves public/ only from the app directory, and keeping one copy in core
// means the service worker and icons can never drift between editions.
//
// Run from an app directory (npm sets cwd to the workspace): `pos-sync-public`.
// apps/<edition>/public/ is generated — it is gitignored; edit the files in core.
// An edition that needs its own asset puts it in apps/<edition>/public-overrides/,
// which is copied on top.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(coreRoot, 'public');
const appRoot = process.cwd();
const dest = path.join(appRoot, 'public');
const overrides = path.join(appRoot, 'public-overrides');

if (path.resolve(appRoot) === coreRoot) {
  console.error('[pos-sync-public] run this from an app directory, not from @pos/core');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
if (fs.existsSync(overrides)) fs.cpSync(overrides, dest, { recursive: true, force: true });

console.log(`[pos-sync-public] ${path.relative(appRoot, src)} -> public/${fs.existsSync(overrides) ? ' (+ public-overrides/)' : ''}`);
