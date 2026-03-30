/**
 * API Response Utilities
 * 
 * Helper functions to safely parse API responses and handle
 * different response formats (wrapped in { data: ... } or raw arrays/objects).
 */

/**
 * Extracts array data from API response, handling both wrapped and unwrapped formats.
 * 
 * @example
 * // Handles: { data: [...] }
 * // Handles: { data: { data: [...] } }
 * // Handles: [...]
 * 
 * const plans = extractArrayData(response.data);
 */
export function extractArrayData<T>(responseData: unknown): T[] {
  if (!responseData) {
    return [];
  }

  // If it's already an array, return it
  if (Array.isArray(responseData)) {
    return responseData as T[];
  }

  // If it's an object with a data property
  if (typeof responseData === 'object' && responseData !== null) {
    const obj = responseData as Record<string, unknown>;
    
    // Check for nested { data: { data: [...] } }
    if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      const nested = obj.data as Record<string, unknown>;
      if (Array.isArray(nested.data)) {
        return nested.data as T[];
      }
    }
    
    // Check for { data: [...] }
    if (Array.isArray(obj.data)) {
      return obj.data as T[];
    }
  }

  // Return empty array as fallback
  return [];
}

/**
 * Extracts object data from API response, handling both wrapped and unwrapped formats.
 * 
 * @example
 * // Handles: { data: { ... } }
 * // Handles: { data: { data: { ... } } }
 * // Handles: { ... }
 * 
 * const usage = extractObjectData(response.data);
 */
export function extractObjectData<T>(responseData: unknown): T | null {
  if (!responseData) {
    return null;
  }

  // If it's an array, return null (expecting object)
  if (Array.isArray(responseData)) {
    return null;
  }

  // If it's an object
  if (typeof responseData === 'object' && responseData !== null) {
    const obj = responseData as Record<string, unknown>;
    
    // Check for nested { data: { data: { ... } } }
    if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      const nested = obj.data as Record<string, unknown>;
      if (nested.data && typeof nested.data === 'object' && !Array.isArray(nested.data)) {
        return nested.data as T;
      }
      // Return the first level data
      return obj.data as T;
    }
    
    // Return the object itself if no data wrapper
    return responseData as T;
  }

  return null;
}

/**
 * Type guard to check if response has data property
 */
export function hasDataProperty(obj: unknown): obj is { data: unknown } {
  return typeof obj === 'object' && obj !== null && 'data' in obj;
}

/**
 * Minimal Axios error shape used for status/code checks in catch blocks.
 * Use this instead of inline `err as { response?: ... }` casts.
 */
export interface ApiError {
  response?: {
    status?: number;
    data?: { error?: string; message?: string };
  };
}

