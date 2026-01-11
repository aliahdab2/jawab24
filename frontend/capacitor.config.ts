import { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.jawab24.app',
  appName: 'Jawab24',
  webDir: 'out',
  server: {
    url: process.env.CAP_SERVER_URL,
    cleartext: !!process.env.CAP_SERVER_URL,
    androidScheme: 'https',
    allowNavigation: ['jawab24.com', '*.jawab24.com']
  },
  android: {
    // Disable the loading spinner/indicator in WebView
    webContentsDebuggingEnabled: false,
  },
  ios: {
    scheme: 'Jawab24',
    contentInset: 'automatic',
  },
  plugins: {
    Keyboard: {
      resize: KeyboardResize.Body,
    },
    StatusBar: {
      overlaysWebView: true,
    },
    SplashScreen: {
      launchAutoHide: false, // We'll hide it manually after hydration
      showSpinner: false,    // Explicitly disable spinner
    }
  }
};

export default config;
