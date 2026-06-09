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
      // 'none' on both platforms — the keyboard overlays content without resizing
      // the WebView. iOS must use 'none' ('body' permanently distorts WKWebView);
      // Android relies on windowSoftInputMode=adjustNothing + the --keyboard-height
      // CSS variable that setupKeyboard() derives from the visual viewport.
      // (setResizeMode is a no-op on Android, so there is no runtime override.)
      resize: KeyboardResize.None,
    },
    StatusBar: {
      overlaysWebView: true,
    },
    SplashScreen: {
      launchAutoHide: false, // We'll hide it manually after hydration
      showSpinner: false,    // Explicitly disable spinner
      // Fixed dark-brand color for the legacy/fallback splash path (pre-12
      // fallback and any manual SplashScreen.show()). Matches splash_background
      // in android res and the in-app dark page bg (#060d18). The Android 12+
      // system splash is controlled by android res/values-v31/styles.xml.
      backgroundColor: '#060D18',
      androidScaleType: 'CENTER_INSIDE',
      androidSplashResourceName: 'splash_screen',
    }
  }
};

export default config;
