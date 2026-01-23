#!/usr/bin/env npx ts-node
/**
 * Admin Management CLI
 * 
 * Usage:
 *   npx ts-node scripts/manage-admin.ts add <email>      # Make user an admin
 *   npx ts-node scripts/manage-admin.ts remove <email>   # Remove admin privileges
 *   npx ts-node scripts/manage-admin.ts list             # List all admins
 * 
 * Or via npm scripts (after adding to package.json):
 *   npm run admin:add -- user@example.com
 *   npm run admin:remove -- user@example.com
 *   npm run admin:list
 */

import dotenv from 'dotenv';
dotenv.config();

import { promoteToAdmin, demoteAdmin, listAdmins } from '../src/utils/adminSetup';

async function main() {
    const [,, command, email] = process.argv;

    if (!command) {
        console.log(`
Admin Management CLI

Usage:
  npx ts-node scripts/manage-admin.ts add <email>      Make user an admin
  npx ts-node scripts/manage-admin.ts remove <email>   Remove admin privileges
  npx ts-node scripts/manage-admin.ts list             List all admins

Examples:
  npx ts-node scripts/manage-admin.ts add admin@example.com
  npx ts-node scripts/manage-admin.ts remove former-admin@example.com
  npx ts-node scripts/manage-admin.ts list
        `);
        process.exit(1);
    }

    try {
        switch (command.toLowerCase()) {
            case 'add':
            case 'promote':
                if (!email) {
                    console.error('❌ Error: Email required. Usage: add <email>');
                    process.exit(1);
                }
                const addResult = await promoteToAdmin(email);
                console.log(addResult.message);
                process.exit(addResult.success ? 0 : 1);
                break;

            case 'remove':
            case 'demote':
                if (!email) {
                    console.error('❌ Error: Email required. Usage: remove <email>');
                    process.exit(1);
                }
                const removeResult = await demoteAdmin(email);
                console.log(removeResult.message);
                process.exit(removeResult.success ? 0 : 1);
                break;

            case 'list':
                const admins = await listAdmins();
                if (admins.length === 0) {
                    console.log('No admins found.');
                } else {
                    console.log(`\nCurrent Admins (${admins.length}):\n`);
                    admins.forEach((admin, i) => {
                        console.log(`  ${i + 1}. ${admin.name || 'No name'} <${admin.email}>`);
                    });
                    console.log('');
                }
                process.exit(0);
                break;

            default:
                console.error(`❌ Unknown command: ${command}`);
                console.log('Valid commands: add, remove, list');
                process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main();
