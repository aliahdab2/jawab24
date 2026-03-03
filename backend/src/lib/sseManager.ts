import type { FastifyReply } from 'fastify';
import { getSubscriber, userChannel } from './eventBus';
import { captureError } from '../utils/sentryHelpers';

interface SSEConnection {
    reply: FastifyReply;
    userId: string;
    connectedAt: number;
}

/** Manages active SSE connections, bridging Redis Pub/Sub → browser EventSource */
class SSEManager {
    private connections = new Map<string, Set<SSEConnection>>();
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private subscribedChannels = new Set<string>();

    /** Start the heartbeat timer (call once at server startup) */
    start(): void {
        if (this.heartbeatInterval) return;
        this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), 30_000);
    }

    /** Register a new SSE connection for a user */
    async addConnection(userId: string, reply: FastifyReply): Promise<void> {
        const conn: SSEConnection = { reply, userId, connectedAt: Date.now() };

        let userSet = this.connections.get(userId);
        if (!userSet) {
            userSet = new Set();
            this.connections.set(userId, userSet);
        }
        userSet.add(conn);

        // Subscribe to the user's Redis channel if not already subscribed
        const channel = userChannel(userId);
        if (!this.subscribedChannels.has(channel)) {
            try {
                const sub = getSubscriber();
                await sub.subscribe(channel);
                this.subscribedChannels.add(channel);

                // Only register the message handler once
                if (this.subscribedChannels.size === 1) {
                    sub.on('message', (ch: string, message: string) => {
                        this.onRedisMessage(ch, message);
                    });
                }
            } catch (err) {
                captureError(err, 'SSE Redis subscribe failed', {
                    tags: { service: 'sse-manager', userId },
                });
            }
        }
    }

    /** Remove a connection (called when the client disconnects) */
    async removeConnection(userId: string, reply: FastifyReply): Promise<void> {
        const userSet = this.connections.get(userId);
        if (!userSet) return;

        for (const conn of userSet) {
            if (conn.reply === reply) {
                userSet.delete(conn);
                break;
            }
        }

        // If no more connections for this user, unsubscribe from Redis channel
        if (userSet.size === 0) {
            this.connections.delete(userId);
            const channel = userChannel(userId);
            if (this.subscribedChannels.has(channel)) {
                try {
                    const sub = getSubscriber();
                    await sub.unsubscribe(channel);
                    this.subscribedChannels.delete(channel);
                } catch (err) {
                    captureError(err, 'SSE Redis unsubscribe failed', {
                        tags: { service: 'sse-manager', userId },
                    });
                }
            }
        }
    }

    /** Write an SSE-formatted event to a single reply stream */
    private writeEvent(reply: FastifyReply, event: string, data: string): void {
        try {
            reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
        } catch {
            // Connection already closed — removeConnection will clean up
        }
    }

    /** Handle incoming Redis Pub/Sub message */
    private onRedisMessage(channel: string, message: string): void {
        // Extract userId from channel name (sse:user:<userId>)
        const userId = channel.replace('sse:user:', '');
        const userSet = this.connections.get(userId);
        if (!userSet || userSet.size === 0) return;

        // Parse to extract the event type for the SSE "event:" field
        try {
            const parsed = JSON.parse(message);
            const eventType = parsed.type || 'message';

            for (const conn of userSet) {
                this.writeEvent(conn.reply, eventType, message);
            }
        } catch {
            // Malformed message — skip
        }
    }

    /** Send heartbeat to all active connections */
    private sendHeartbeats(): void {
        const heartbeat = JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
            data: {},
        });

        for (const [, userSet] of this.connections) {
            const dead: SSEConnection[] = [];
            for (const conn of userSet) {
                try {
                    conn.reply.raw.write(`event: heartbeat\ndata: ${heartbeat}\n\n`);
                } catch {
                    dead.push(conn);
                }
            }
            // Clean up dead connections
            for (const conn of dead) {
                userSet.delete(conn);
                if (userSet.size === 0) {
                    this.connections.delete(conn.userId);
                    const channel = userChannel(conn.userId);
                    if (this.subscribedChannels.has(channel)) {
                        this.subscribedChannels.delete(channel);
                        try {
                            getSubscriber().unsubscribe(channel);
                        } catch {
                            // Best-effort cleanup
                        }
                    }
                }
            }
        }
    }

    /** Graceful shutdown: close all connections, clear timers */
    async shutdown(): Promise<void> {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // End all SSE streams
        for (const [, userSet] of this.connections) {
            for (const conn of userSet) {
                try {
                    conn.reply.raw.end();
                } catch {
                    // Already closed
                }
            }
        }
        this.connections.clear();
        this.subscribedChannels.clear();
    }

    /** Monitoring: total active connections */
    getTotalConnectionCount(): number {
        let count = 0;
        for (const [, userSet] of this.connections) {
            count += userSet.size;
        }
        return count;
    }

    /** Monitoring: unique connected users */
    getUniqueUserCount(): number {
        return this.connections.size;
    }
}

/** Singleton instance */
export const sseManager = new SSEManager();
