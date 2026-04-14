import { CapacitorConfig } from '@capacitor/cli';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const config: CapacitorConfig = {
  appId: 'com.minimalog.app',
  appName: 'MinimaLog',
  webDir: 'dist',

  // DEV MODE: Dev server enabled for local development
  // ⚠️ IMPORTANT: Uncomment the 'server' block below for local development
  // server: {
  //   url: 'http://192.168.0.224:8080',
  //   cleartext: true
  // },

  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },

  ios: {
    // backgroundColor handled natively in AppDelegate.swift for system theme support
    allowsLinkPreview: false,
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: true,
    // PRODUCTION: Debugging disabled for security
    // ⚠️ Set to true for local development debugging
    webContentsDebuggingEnabled: false,
    // Configure Content Security Policy to allow blob URLs for offline images
    contentInset: 'never',

    // SECURITY NOTE: iOS Data Protection
    // For production iOS builds, enable Data Protection in Xcode:
    // 1. Open ios/App/App.xcworkspace in Xcode
    // 2. Select the App target
    // 3. Go to "Signing & Capabilities"
    // 4. Add "Data Protection" capability
    // 5. Set to "Complete Protection" for maximum security
    //
    // This encrypts app data when device is locked
    // Files written by Capacitor Filesystem API will inherit this protection
  },

  android: {
    backgroundColor: '#000000',
    // SECURITY: Debugging disabled for production builds
    webContentsDebuggingEnabled: false,
  },
};

export default config;
