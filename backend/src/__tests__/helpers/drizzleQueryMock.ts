import { vi, type Mock } from 'vitest';
import { getTableName, type Table } from 'drizzle-orm';

/**
 * Chainable drizzle query mock: every builder method returns a fresh chain
 * that resolves to `rows`, so `db.select().from().where().limit()` and
 * `db.update().set().where().returning()` both work without per-shape setup.
 *
 * Shared home for a mock that had been copy-pasted per test file — when
 * drizzle grows a new chained method, add it HERE once (that exact drift
 * happened when `.returning` support had to be patched into one copy).
 */
export type QueryMock = Promise<unknown[]> & {
    from: Mock; where: Mock; limit: Mock; orderBy: Mock; set: Mock; values: Mock; returning: Mock;
    innerJoin: Mock; onConflictDoNothing: Mock;
};

export function q(rows: unknown[]): QueryMock {
    const p = Promise.resolve(rows) as QueryMock;
    for (const m of ['from', 'where', 'limit', 'orderBy', 'set', 'values', 'returning', 'innerJoin', 'onConflictDoNothing'] as const) {
        p[m] = vi.fn(() => q(rows));
    }
    return p;
}

/** A fresh LinkLogger-shaped spy pair for services that take an optional logger. */
export const mkLog = () => ({ info: vi.fn(), warn: vi.fn() });

// ---------------------------------------------------------------------------
// Shape-keyed db router — for services whose one call path runs MANY distinct
// queries.
//
// `q()` resolves every query to the same rows; a positional queue (shift one
// result per await) encodes the service's internal query ORDER as test data,
// so adding one query shifts every index and rows silently feed the wrong
// query. The router instead matches each awaited query against queued specs
// by operation + table (+ for selects, a distinguishing subset of the
// selected field keys), so tests declare WHICH query gets WHICH rows.
// Unqueued SELECTs and INSERTs THROW with the queued/actual shapes in the
// message — a silent `[]` default fails somewhere far away. UPDATE/DELETE
// resolve `[]` by default (their results are conventionally unused) but are
// still recorded in `calls`/`events` for assertions.
// ---------------------------------------------------------------------------

type DbOp = 'select' | 'insert' | 'update' | 'delete';

export interface DbQuerySpec {
    op: DbOp;
    /** The real drizzle table object (matched by its table name). */
    table: Table;
    /**
     * Selects only: field keys that must ALL appear among the query's selected
     * columns (omitted/empty = matches any select on the table). A full-row
     * `db.select()` has the pseudo-key `*`.
     */
    fields?: string[];
    /** Rows the awaited query resolves to. */
    rows?: unknown[];
    /** Reject the awaited query with this error instead of resolving. */
    error?: Error;
}

export interface DbCallRecord {
    op: DbOp;
    table: string;
    fields?: string[];
    values?: unknown;
    set?: unknown;
    where?: unknown;
}

export interface DbRouter {
    /** Drop-in `db` mock: select/insert/update/delete/transaction. */
    db: Record<string, unknown>;
    /** Queue rows (or an error) for one matching query. FIFO among equal matches. */
    queue: (spec: DbQuerySpec) => void;
    /**
     * Ordered audit trail: `${op}:${table}` per resolved query plus
     * `tx:start` / `tx:commit` / `tx:rollback`. Tests may push their own
     * markers (e.g. from a storage mock) to assert cross-system ordering.
     */
    events: string[];
    /** Every query the mock saw, with its captured .values()/.set()/.where() args. */
    calls: DbCallRecord[];
}

export function makeDbRouter(): DbRouter {
    const queued: DbQuerySpec[] = [];
    const events: string[] = [];
    const calls: DbCallRecord[] = [];

    const specLabel = (s: DbQuerySpec) =>
        `${s.op}:${getTableName(s.table)}${s.fields?.length ? `(${s.fields.join(',')})` : ''}`;

    function takeSpec(op: DbOp, tableName: string, fieldKeys: string[]): DbQuerySpec | undefined {
        const idx = queued.findIndex(s =>
            s.op === op
            && getTableName(s.table) === tableName
            && (op !== 'select' || (s.fields ?? []).every(f => fieldKeys.includes(f))));
        return idx === -1 ? undefined : queued.splice(idx, 1)[0];
    }

    function chain(op: DbOp, fields?: Record<string, unknown>, table?: Table) {
        const state: { table?: Table; values?: unknown; set?: unknown; where?: unknown } = { table };
        const self: Record<string, unknown> = {};
        const capture = (key: 'table' | 'values' | 'set' | 'where') =>
            vi.fn((arg?: unknown) => { state[key] = arg as never; return self; });
        self.from = capture('table');
        self.values = capture('values');
        self.set = capture('set');
        self.where = capture('where');
        for (const m of ['limit', 'orderBy', 'innerJoin', 'leftJoin', 'groupBy', 'onConflictDoNothing', 'returning'] as const) {
            self[m] = vi.fn(() => self);
        }
        self.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
            const tableName = state.table ? getTableName(state.table) : '<no-table>';
            const fieldKeys = fields ? Object.keys(fields) : ['*'];
            calls.push({
                op, table: tableName,
                ...(op === 'select' ? { fields: fieldKeys } : {}),
                values: state.values, set: state.set, where: state.where,
            });
            const spec = takeSpec(op, tableName, fieldKeys);
            let p: Promise<unknown>;
            if (spec?.error) {
                events.push(`${op}:${tableName}:error`);
                p = Promise.reject(spec.error);
            } else if (spec) {
                events.push(`${op}:${tableName}`);
                p = Promise.resolve(spec.rows ?? []);
            } else if (op === 'update' || op === 'delete') {
                events.push(`${op}:${tableName}`);
                p = Promise.resolve([]);
            } else {
                p = Promise.reject(new Error(
                    `[drizzleQueryMock] No queued result for ${op} on "${tableName}" (fields: ${fieldKeys.join(',')}). `
                    + `Queued: ${queued.map(specLabel).join(' | ') || 'none'}`,
                ));
            }
            return p.then(onFulfilled, onRejected);
        };
        return self;
    }

    const db: Record<string, unknown> = {
        select: (fields?: Record<string, unknown>) => chain('select', fields),
        insert: (table: Table) => chain('insert', undefined, table),
        update: (table: Table) => chain('update', undefined, table),
        delete: (table: Table) => chain('delete', undefined, table),
        transaction: async <T>(fn: (tx: Record<string, unknown>) => Promise<T>): Promise<T> => {
            events.push('tx:start');
            try {
                const out = await fn(db);
                events.push('tx:commit');
                return out;
            } catch (err) {
                events.push('tx:rollback');
                throw err;
            }
        },
    };

    return { db, queue: (spec) => { queued.push(spec); }, events, calls };
}
