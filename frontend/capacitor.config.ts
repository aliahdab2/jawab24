import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jawab24.app',
  appName: 'Jawab24',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    // androidScheme creates a secure context for cookies/auth.
    // For local dev, you can temporarily set 'url' here to http://YOUR_IP:3000
  },
};

export default config;
