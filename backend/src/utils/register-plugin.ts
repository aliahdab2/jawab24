/**
 * Type-safe plugin registration helper for Fastify 5.
 *
 * Fastify 5's register() overload resolution breaks when FastifyInstance
 * is augmented with plugin types (cookie, rate-limit, etc.).
 * This isolates the type workaround to a single well-documented location
 * instead of scattering suppressions across every registration call site.
 *
 * @see https://github.com/fastify/fastify/issues/5643
 */
export function registerPlugin(
    app: { register: CallableFunction },
    plugin: unknown,
    opts?: Record<string, unknown>,
): Promise<void> {
    return app.register(plugin, opts);
}
