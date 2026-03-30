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
    // hostname: 'app.jawab24.com' — WebViewAssetLoader serves app assets from
    // this subdomain. API calls go to jawab24.com/api (different domain) so
    // they are NOT intercepted. Requires backend CORS to allow
    // https://app.jawab24.com (already deployed).
    // Enables Web OTP API autofill: SMS ends with @app.jawab24.com #<code>
    // which matches this origin, so Android Chrome auto-fills the OTP.
    hostname: 'app.jawab24.com',
    allowNavigation: ['jawab24.com', '*.jawab24.com']
  },
  android: {
    // Disable the loading spinner/indicator in WebView
    webContentsDebuggingEnabled: false,
  },
  ios: {
    scheme: 'Jawab24',
    contentInset: 'never',
  },
  plugins: {
    Keyboard: {
      // Use 'none' — keyboard overlays content without resizing.
      // Android overrides to 'body' at runtime in _app.tsx (works correctly on Android WebView).
      // iOS must use 'none' because 'body' permanently distorts the WKWebView layout.
      resize: KeyboardResize.None,
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
