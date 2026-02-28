import { useState, useEffect } from 'react';

/**
 * Delays updating a value until it has been stable for `delay` ms.
 * Useful for search inputs and API calls that shouldn't fire on every keystroke.
 *
 * @param value - The raw (frequently changing) value.
 * @param delay - Debounce window in milliseconds.
 * @returns The debounced value, updated only after `delay` ms of inactivity.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
