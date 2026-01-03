/**
 * Shared Logger Interface
 * 
 * This interface provides a consistent logging contract across all services and controllers.
 * It's designed to be compatible with Fastify's built-in logger (pino) and allows for
 * easy dependency injection for testing.
 * 
 * Usage:
 * - Services: Accept Logger in constructor or setLogger() method
 * - Controllers: Create from request.log using createRequestLogger()
 */

/** Base logger interface for dependency injection */
export interface Logger {
    info(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    debug(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
}

/** No-op logger for when logging is disabled or not configured */
export const noopLogger: Logger = {
    info: () => {},
    error: () => {},
    debug: () => {},
    warn: () => {},
};

/**
 * Creates a Logger adapter from Fastify's request.log (pino logger)
 * Fastify/pino uses (data, msg) order, so we adapt to our (msg, data) interface
 */
export function createRequestLogger(log: {
    info: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
    debug: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
}): Logger {
    return {
        info: (msg, data) => data ? log.info(data, msg) : log.info({}, msg),
        error: (msg, data) => data ? log.error(data, msg) : log.error({}, msg),
        debug: (msg, data) => data ? log.debug(data, msg) : log.debug({}, msg),
        warn: (msg, data) => data ? log.warn(data, msg) : log.warn({}, msg),
    };
}
