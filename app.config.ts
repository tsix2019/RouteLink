import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'RouteLink',
  slug: 'routelink',
  scheme: 'routelink',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: 'io.github.tsix2019.routelink',
    icon: './assets/routelink.icon',
    supportsTablet: false,
    infoPlist: {
      NSLocalNetworkUsageDescription:
        'RouteLink connects to routers on your local network to discover and manage them.',
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'io.github.tsix2019.routelink',
    adaptiveIcon: {
      backgroundColor: '#0A5BFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  locales: {
    en: './src/i18n/native/en.json',
    'zh-Hans': './src/i18n/native/zh-Hans.json',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0A5BFF',
        image: './assets/images/splash-icon.png',
        imageWidth: 96,
      },
    ],
    'expo-localization',
    'expo-sqlite',
    'expo-secure-store',
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
