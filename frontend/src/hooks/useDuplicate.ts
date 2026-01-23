import { useState } from 'react';

interface UseDuplicateOptions<T> {
  createFn: (data: any) => Promise<{ data: T }>;
  onSuccess: (newItem: T) => void;
  transform: (item: T) => any;
}

export function useDuplicate<T>({ createFn, onSuccess, transform }: UseDuplicateOptions<T>) {
  const [loading, setLoading] = useState(false);

  const duplicate = async (item: T) => {
    setLoading(true);
    try {
      const data = transform(item);
      const response = await createFn(data);
      onSuccess(response.data);
    } catch (error) {
      console.error('Failed to duplicate item:', error);
    } finally {
      setLoading(false);
    }
  };

  return { duplicate, loading };
}
