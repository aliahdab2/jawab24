/**
 * Simple async semaphore to limit concurrent operations.
 * Used to cap concurrent OpenAI API calls and avoid rate limits.
 */
export class Semaphore {
    private running = 0;
    private queue: (() => void)[] = [];

    constructor(private readonly maxConcurrency: number) {}

    async acquire(): Promise<void> {
        if (this.running < this.maxConcurrency) {
            this.running++;
            return;
        }
        return new Promise<void>((resolve) => {
            this.queue.push(() => {
                this.running++;
                resolve();
            });
        });
    }

    release(): void {
        this.running--;
        const next = this.queue.shift();
        if (next) next();
    }

    /** Run a function within the semaphore limit. */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}
