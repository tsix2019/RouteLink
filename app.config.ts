import type { ExpoConfig } from 'expo/config';

const VERSION = '0.3.1';
/** 1.2.3 → 10203, so every release is an upgrade of the one before (v0.1.0 shipped with the default, 1). */
const BUILD = VERSION.split('.').reduce((n, part) => n * 100 + Number(part), 0);

const config: ExpoConfig = {
  name: 'RouteLink',
  slug: 'routelink',
  scheme: 'routelink',
  version: VERSION,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: 'io.github.tsix2019.routelink',
    buildNumber: String(BUILD),
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
    versionCode: BUILD,
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
    'expo-sharing',
    '@react-native-community/datetimepicker',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
          // The APK is downloaded from GitHub Releases, so its size is what users wait for. Real
          // phones are ARM; x86_64 emulators on Android 11+ run ARM code through translation.
          buildArchs: ['arm64-v8a', 'armeabi-v7a'],
          // Compressed native libraries: about a third of the download, extracted at install.
          useLegacyPackaging: true,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    './plugins/with-release-signing',
  ],
  experiments: {
    typedRoutes: false,
    reactCompiler: true,
  },
};

export default config;
