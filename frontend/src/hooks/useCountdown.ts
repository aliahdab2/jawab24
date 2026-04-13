import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Countdown timer that ticks down from a given number of seconds to zero.
 *
 * Usage:
 *   const { count, start, stop } = useCountdown();
 *   start(60);  // begin counting from 60 → 0
 *
 * The interval clears itself when it reaches zero and on unmount.
 */
export function useCountdown() {
    const [count, setCount] = useState(0);
    const ref = useRef<ReturnType<typeof setInterval> | null>(null);

    const stop = useCallback(() => {
        if (ref.current) { clearInterval(ref.current); ref.current = null; }
    }, []);

    const start = useCallback((from: number) => {
        stop();
        setCount(from);
        ref.current = setInterval(() => {
            setCount(prev => {
                if (prev <= 1) { clearInterval(ref.current!); ref.current = null; return 0; }
                return prev - 1;
            });
        }, 1000);
    }, [stop]);

    useEffect(() => stop, [stop]);

    return { count, start, stop };
}
