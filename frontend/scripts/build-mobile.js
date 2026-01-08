/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const configWeb = path.join(rootDir, 'next.config.js');
const configMobile = path.join(rootDir, 'next.config.mobile.js');
const configBackup = path.join(rootDir, 'next.config.js.bak');

console.log('🚀 Starting Mobile Build...');

try {
  // 1. Validate environment
  if (!fs.existsSync(configMobile)) {
    throw new Error('next.config.mobile.js not found!');
  }

  // 2. Backup and Swap
  console.log('📦 Swapping configs...');
  fs.copyFileSync(configWeb, configBackup);
  fs.copyFileSync(configMobile, configWeb);

  // 3. Build
  console.log('🏗️  Running Next build (Static Export)...');
  execSync('npx next build', { 
    cwd: rootDir, 
    stdio: 'inherit',
    env: { ...process.env, MOBILE_BUILD: 'true' } 
  });

  console.log('✅ Build successful!');

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
} finally {
  // 4. Restore
  if (fs.existsSync(configBackup)) {
    console.log('♻️  Restoring web config...');
    fs.copyFileSync(configBackup, configWeb);
    fs.unlinkSync(configBackup);
  }
}
