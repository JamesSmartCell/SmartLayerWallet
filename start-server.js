#!/usr/bin/env node
/**
 * Launcher for Next.js production server
 * Respects PORT environment variable (default: 8089)
 * Binds to 127.0.0.1 (local only)
 * 
 * Uses absolute paths to work under systemd (where node_modules/.bin is not on PATH)
 */
const { spawn } = require('child_process');
const { resolve } = require('path');

const port = process.env.PORT || '8089';
const host = '127.0.0.1';

// Resolve Next.js CLI using require.resolve to work with any installation location
let nextCliPath;
try {
  nextCliPath = require.resolve('next/dist/bin/next');
} catch (err) {
  console.error('Failed to resolve next CLI:', err.message);
  console.error('Make sure Next.js is installed: npm ci');
  process.exit(1);
}

console.log(`Starting Next.js on ${host}:${port}`);
console.log(`Next.js CLI: ${nextCliPath}`);

// Spawn Next.js using the current node executable and resolved CLI path
const nextStart = spawn(
  process.execPath,
  [nextCliPath, 'start', '-H', host, '-p', port],
  { stdio: 'inherit', env: process.env }
);

// Handle spawn errors (e.g. if node binary doesn't exist)
nextStart.on('error', (err) => {
  console.error('Failed to start Next.js:', err.message);
  process.exit(1);
});

// Forward exit code
nextStart.on('exit', (code, signal) => {
  if (signal) {
    console.log(`Next.js process killed by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code || 0);
});

// Forward signals to child process
['SIGTERM', 'SIGINT', 'SIGHUP'].forEach((signal) => {
  process.on(signal, () => {
    if (nextStart.killed === false) {
      nextStart.kill(signal);
    }
  });
});
