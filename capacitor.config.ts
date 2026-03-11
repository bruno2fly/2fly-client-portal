import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.2flymarketing.clientportal',
  appName: '2FlyFlow',
  webDir: 'public',
  // Load from live server instead of bundled files
  server: {
    url: 'https://2flyflow.com',
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#1a56db',
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a56db',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#1a56db',
    },
  },
};

export default config;
