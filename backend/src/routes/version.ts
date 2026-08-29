import { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Cache version info at startup (doesn't change during runtime)
let versionInfo: {
    version: string;
    shortVersion: string;
    deployedAt: string;
    environment: string;
    buildTime: string;
} | null = null;

function getVersionInfo() {
    if (versionInfo) return versionInfo;

    let gitCommit = 'unknown';
    let gitCommitShort = 'unknown';

    try {
        // Try to get git commit from environment (set during Docker build)
        if (process.env.GIT_COMMIT) {
            gitCommit = process.env.GIT_COMMIT;
            gitCommitShort = gitCommit.substring(0, 7);
        } else {
            // Fallback: try to read from git directly
            gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
            gitCommitShort = gitCommit.substring(0, 7);
        }
    } catch {
        // If git command fails, try to read from a version file
        try {
            const versionFile = path.join(__dirname, '../../VERSION');
            if (fs.existsSync(versionFile)) {
                gitCommit = fs.readFileSync(versionFile, 'utf-8').trim();
                gitCommitShort = gitCommit.substring(0, 7);
            }
        } catch {
            // Keep as 'unknown'
        }
    }

    // Get environment from .active-env file or env var
    let environment = process.env.DEPLOY_ENV || 'unknown';
    try {
        const activeEnvFile = '/var/www/jawab24/.active-env';
        if (fs.existsSync(activeEnvFile)) {
            environment = fs.readFileSync(activeEnvFile, 'utf-8').trim();
        }
    } catch {
        // Keep from env var
    }

    // Get deploy time from file or use startup time
    let deployedAt = new Date().toISOString();
    try {
        const deployTimeFile = '/var/www/jawab24/.deploy-time';
        if (fs.existsSync(deployTimeFile)) {
            deployedAt = fs.readFileSync(deployTimeFile, 'utf-8').trim();
        }
    } catch {
        // Use current time as fallback
    }

    versionInfo = {
        version: gitCommit,
        shortVersion: gitCommitShort,
        deployedAt,
        environment,
        buildTime: new Date().toISOString(),
    };

    return versionInfo;
}

export default async function versionRoutes(fastify: FastifyInstance) {
    // Public endpoint - no auth required
    fastify.get('/version', {
        schema: { tags: ['Health'], summary: 'Get full version and deployment info' },
    }, async (_request, reply) => {
        const info = getVersionInfo();
        // Never cache: this is the deploy-verification endpoint. Its whole purpose
        // is to reflect the currently-running commit, which changes on every deploy.
        // `immutable`/max-age served a stale commit for up to 24h after a deploy.
        return reply
            .header('Cache-Control', 'no-store')
            .send(info);
    });

    // Simple version for health checks
    fastify.get('/version/short', {
        schema: { tags: ['Health'], summary: 'Get short version string' },
    }, async (_request, reply) => {
        const info = getVersionInfo();
        // Never cache — same reason as /version above.
        return reply
            .header('Cache-Control', 'no-store')
            .send({ v: info.shortVersion });
    });
}
