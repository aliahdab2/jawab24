import type { StateStorage } from "zustand/middleware";

/**
 * Check if we're running in a native Capacitor environment
 */
const isNativePlatform = (): boolean => {
  if (typeof window === "undefined") return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
};

/**
 * Web storage (fast, synchronous)
 */
const webStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Silent fail
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Silent fail
    }
  },
};

/**
 * Mobile secure storage (Keychain/Keystore)
 * Uses dynamic import to keep web bundles clean.
 */
const getSecureStorage = async (): Promise<StateStorage> => {
  const { SecureStoragePlugin } = await import("capacitor-secure-storage-plugin");

  return {
    getItem: async (name) => {
      try {
        const res = await SecureStoragePlugin.get({ key: name });
        return res?.value ?? null;
      } catch {
        return null; // Key not found
      }
    },
    setItem: async (name, value) => {
      try {
        await SecureStoragePlugin.set({ key: name, value });
      } catch (err) {
        console.error('SecureStorage set error:', err);
      }
    },
    removeItem: async (name) => {
      try {
        await SecureStoragePlugin.remove({ key: name });
      } catch {
        // Silent fail
      }
    },
  };
};

/**
 * Returns the appropriate storage based on platform.
 * Web: localStorage (sync)
 * Native: SecureStorage (async)
 */
export const getPersistStorage = async (): Promise<StateStorage> => {
  if (typeof window === "undefined") return webStorage;
  if (!isNativePlatform()) return webStorage;
  return await getSecureStorage();
};
