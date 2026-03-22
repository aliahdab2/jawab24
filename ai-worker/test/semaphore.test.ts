import { describe, it, expect } from 'vitest';
import { Semaphore } from '../src/lib/semaphore';

describe('Semaphore', () => {
    it('should allow up to maxConcurrency calls simultaneously', async () => {
        const sem = new Semaphore(2);
        let running = 0;
        let maxRunning = 0;

        const task = () => new Promise<void>((resolve) => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            setTimeout(() => { running--; resolve(); }, 10);
        });

        await Promise.all([sem.run(task), sem.run(task), sem.run(task), sem.run(task)]);

        expect(maxRunning).toBe(2);
    });

    it('should queue tasks beyond maxConcurrency', async () => {
        const sem = new Semaphore(1);
        const order: number[] = [];

        const task = (id: number) => sem.run(async () => {
            order.push(id);
        });

        await Promise.all([task(1), task(2), task(3)]);

        expect(order).toEqual([1, 2, 3]);
    });

    it('should release on error so subsequent tasks can proceed', async () => {
        const sem = new Semaphore(1);

        const failingTask = sem.run(async () => { throw new Error('boom'); });
        await expect(failingTask).rejects.toThrow('boom');

        // Next task should still succeed (semaphore released)
        const result = await sem.run(async () => 'ok');
        expect(result).toBe('ok');
    });

    it('should return the value from the wrapped function', async () => {
        const sem = new Semaphore(3);
        const result = await sem.run(async () => 42);
        expect(result).toBe(42);
    });

    it('should handle concurrency of 1 (mutex)', async () => {
        const sem = new Semaphore(1);
        let running = 0;
        let maxRunning = 0;

        const task = () => new Promise<void>((resolve) => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            setTimeout(() => { running--; resolve(); }, 5);
        });

        await Promise.all(Array.from({ length: 5 }, () => sem.run(task)));

        expect(maxRunning).toBe(1);
    });
});
