import type { ExpoConfig } from 'expo/config';

const VERSION = '1.1.0';
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
    // Citadel (SSH) needs iOS 17.
    deploymentTarget: '17.0',
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
          // sshj's ed25519 code uses java.util.Base64 (API 26).
          minSdkVersion: 26,
          // The same file in all three BouncyCastle jars (sshj).
          packagingOptions: { exclude: ['META-INF/versions/9/OSGI-INF/MANIFEST.MF'] },
          // R8 keeps what is reached by name at run time: sshj's algorithm factories, BouncyCastle's
          // provider classes and Expo's headless app loader (named in a manifest entry; background tasks
          // start the app's JavaScript with it). The rest are optional desktop dependencies.
          extraProguardRules: [
            '-keep class * implements expo.modules.apploader.HeadlessAppLoader { <init>(); }',
            '-keep class net.schmizz.sshj.** { *; }',
            '-keep class com.hierynomus.sshj.** { *; }',
            '-keep class org.bouncycastle.jcajce.provider.** { *; }',
            '-keep class org.bouncycastle.jce.provider.** { *; }',
            '-dontwarn org.bouncycastle.**',
            '-dontwarn org.ietf.jgss.**',
            '-dontwarn javax.naming.**',
            '-dontwarn javax.security.auth.login.**',
            '-dontwarn org.slf4j.**',
          ].join('\n'),
        },
      },
    ],
    './plugins/with-release-signing',
    // M4 (design §19): home-screen widgets, the background check and its local notifications.
    [
      'expo-widgets',
      {
        widgets: [
          {
            name: 'RouterWidget',
            displayName: 'RouteLink',
            description: 'Router status, speed and devices online',
            ios: { supportedFamilies: ['systemSmall', 'systemMedium'] },
          },
        ],
      },
    ],
    [
      'react-native-android-widget',
      {
        widgets: [
          {
            name: 'RouterWidget',
            label: 'RouteLink',
            description: 'Router status, speed and devices online',
            minWidth: '110dp',
            minHeight: '110dp',
            targetCellWidth: 2,
            targetCellHeight: 2,
            resizeMode: 'horizontal|vertical',
            // What the widget picker shows (the demo router, from the emulator).
            previewImage: './assets/images/widget-preview.png',
            // Android's minimum; the app and the background check push fresher data.
            updatePeriodMillis: 1_800_000,
          },
        ],
      },
    ],
    'expo-background-task',
    // A white glyph: Android draws notification icons as a silhouette, tinted with the colour.
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: '#0A5BFF' }],
    './plugins/without-push-entitlement',
    // Until SDK 57 has React Native 0.87's fix: Citadel's Swift package could break Pods.xcodeproj.
    './plugins/with-unique-pods-uuids',
  ],
  experiments: {
    typedRoutes: false,
    reactCompiler: true,
  },
};

export default config;
