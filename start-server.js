#!/usr/bin/env node
/**
 * Launcher for Next.js production server
 * Respects PORT environment variable (default: 8088)
 * Binds to 127.0.0.1 (local only)
 */
const { spawn } = require('child_process');

const port = process.env.PORT || '8088';
const host = '127.0.0.1';

console.log(`Starting Next.js on ${host}:${port}`);

const nextStart = spawn(
  'next',
  ['start', '-H', host, '-p', port],
  { stdio: 'inherit', env: process.env }
);

nextStart.on('exit', (code) => {
  process.exit(code || 0);
});
