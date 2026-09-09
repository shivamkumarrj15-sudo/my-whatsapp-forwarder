/**
 * Start script to run both OpenWA Gateway and Forwarder together.
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting OpenWA Server...');

// Start OpenWA Backend
const openwa = spawn('node', ['dist/main.js'], {
  stdio: 'inherit',
  env: process.env,
});

openwa.on('error', err => {
  console.error('Failed to start OpenWA:', err);
});

// Wait 10 seconds for OpenWA to initialize before starting Forwarder
setTimeout(() => {
  console.log('\n🚀 Starting Auto-Forwarder Service...');
  const forwarder = spawn('node', ['forwarder.js'], {
    stdio: 'inherit',
    env: process.env,
  });

  forwarder.on('error', err => {
    console.error('Failed to start Forwarder:', err);
  });
}, 10000);

process.on('SIGTERM', () => {
  openwa.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  openwa.kill('SIGINT');
  process.exit(0);
});
