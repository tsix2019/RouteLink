<p align="center"><img src="assets/images/icon.png" width="96" alt="RouteLink"></p>

<h1 align="center">RouteLink</h1>

<p align="center"><a href="README.md">中文</a> | <b>English</b></p>

<p align="center">
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/ci.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/ios.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/ios.yml/badge.svg" alt="iOS"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/android.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/android.yml/badge.svg" alt="Android"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/integration.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/integration.yml/badge.svg" alt="OpenWrt"></a>
  <a href="https://github.com/tsix2019/RouteLink/releases"><img src="https://img.shields.io/github/v/release/tsix2019/RouteLink?include_prereleases&amp;filter=v%2A" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tsix2019/RouteLink" alt="MIT"></a>
</p>

RouteLink is a phone app for managing OpenWrt routers, for iOS and Android, in English and Chinese.

- **iOS 26 look**: native Liquid Glass on iOS (tab bar, navigation bar, sheets); on Android the same iOS 26 design is drawn by the app: a floating glass tab bar, large-title navigation bars, rounded grouped lists.
- **Auto-discovery**: scans the phone's network for OpenWrt, side routers included; or scan a subnet you name, or type an address.
- **Several routers**: add as many as you like and switch from the capsule in the top-left corner.
- **Safe changes**: every change goes through OpenWrt's own apply-and-confirm mechanism — if the app can't reach the router afterwards, the router undoes the change after 90 seconds. Anything that can cut connections asks first, with graded risk warnings.
- **Demo mode**: try everything without a router, against a built-in simulated OpenWrt.
- **Private**: no data collection; the app talks only to the routers you add.

> The first milestone (M1) is complete; what comes next is in the feature list below.

## Screenshots

All screenshots use demo mode. The iOS ones are taken automatically by CI on an iOS 26 simulator, the Android ones on an Android emulator.

**Light**

| | iOS | Android |
|---|---|---|
| Overview | <img src="docs/screenshots/en/ios-overview-light.png" width="240"> | <img src="docs/screenshots/en/android-overview-light.png" width="240"> |
| Device | <img src="docs/screenshots/en/ios-device-light.png" width="240"> | <img src="docs/screenshots/en/android-device-light.png" width="240"> |
| Wi-Fi | <img src="docs/screenshots/en/ios-wireless-light.png" width="240"> | <img src="docs/screenshots/en/android-wireless-light.png" width="240"> |

**Dark**

| | iOS | Android |
|---|---|---|
| Devices | <img src="docs/screenshots/en/ios-devices-dark.png" width="240"> | <img src="docs/screenshots/en/android-devices-dark.png" width="240"> |
| Network | <img src="docs/screenshots/en/ios-network-dark.png" width="240"> | <img src="docs/screenshots/en/android-network-dark.png" width="240"> |
| More | <img src="docs/screenshots/en/ios-more-dark.png" width="240"> | <img src="docs/screenshots/en/android-more-dark.png" width="240"> |

More screenshots in [docs/screenshots/en](docs/screenshots/en).

## Features

✅ done (M1)　🚧 planned (milestone in brackets)

**Overview**

- ✅ System: model, firmware, kernel, host name, uptime
- ✅ Resources: load, memory, storage, temperature (where the router reports it)
- ✅ Internet: protocol, IP, gateway, DNS, connected time
- ✅ Live traffic chart, devices online
- ✅ Reboot, with progress and a check that the router is back
- 🚧 Wi-Fi QR code (M2), ask AI (M4)

**Devices**

- ✅ One list from DHCP leases, the neighbour table and Wi-Fi stations; online/offline and wired/Wi-Fi filters; search; signal strength; vendor names
- ✅ Rename (stored on the router; names that are valid host names also show up in LuCI and local DNS)
- ✅ Reserve an IP, block internet access, disconnect from Wi-Fi
- ✅ Wake-on-LAN (sent by the router when etherwake is installed, otherwise directly from Android phones)
- 🚧 Per-device traffic (M2), parental control (M3)

**Wi-Fi**

- ✅ Radios: on/off, channel, channel width, transmit power, country code
- ✅ Networks: name, password, security, hidden, enabled. If your phone is on that network, the app warns you and walks you through rejoining
- ✅ Scan nearby networks
- 🚧 Guest network, MAC filter (M2), schedules (M3)

**Network**

- ✅ Interfaces with details, reconnect
- 🚧 WAN/LAN settings, routes, live connections, firewall, WireGuard status, traffic history, diagnostics (M2)
- 🚧 VLANs, VPN setup, DDNS, SQM, ad blocking (M3)

**More**

- ✅ Services: start, stop, restart, start at boot
- ✅ System and kernel logs (filter, share)
- ✅ Saved Wake-on-LAN devices
- ✅ Router management (order, edit, delete, certificate), language, appearance, refresh interval, reduce transparency, demo mode
- 🚧 Processes, packages, scheduled tasks, LEDs, admin password (M2)
- 🚧 Backup and restore, factory reset, firmware upgrade (M3 — high-risk, with multi-step confirmation)
- 🚧 SSH terminal, speed test, AI assistant, home-screen widgets, offline alerts (M4)

## Install

- **Android**: download `RouteLink-<version>.apk` from [Releases](https://github.com/tsix2019/RouteLink/releases).
- **iOS**: not on the App Store. Releases include an unsigned `RouteLink-unsigned.ipa`; sign and install it with your own Apple ID using [AltStore](https://altstore.io), [SideStore](https://sidestore.io) or Sideloadly, or with TrollStore on iOS versions it supports.

## Router requirements

- OpenWrt 21.02 or newer with the LuCI web interface. CI tests against OpenWrt **23.05, 24.10 and 25.12**; ImmortalWrt and other derivatives should work too.
- The packages it needs come with LuCI: `rpcd`, `uhttpd-mod-ubus`, `rpcd-mod-luci`, `rpcd-mod-iwinfo`, `rpcd-mod-file`.
- Optional packages:

  | Feature | Package |
  |---|---|
  | Wake-on-LAN sent by the router | `luci-app-wol` (with `etherwake`). LuCI's wake helper is broken on OpenWrt 25.12.5; Android then sends the packet itself |
  | HTTPS | included in recent firmware; on older releases install `luci-ssl` |

- **Self-signed HTTPS certificates**: on first connection the app shows the certificate's fingerprint for you to confirm, then trusts only that certificate. If it ever changes, the app stops and tells you (a reset router — or someone impersonating it).
- **HTTP** works, but the password crosses your network unencrypted; the app marks such routers as "Not encrypted". Turning on HTTPS is recommended.
- The default account is `root`; other rpcd accounts work too. Where an account lacks permission or a package is missing, the feature says so.

## Security and privacy

- Router passwords live only in the system keychain (iOS Keychain / Android Keystore) and are never logged. You can also choose not to save a password and enter it when the app starts.
- Discovery probes never carry credentials.
- No analytics, no ads; the app contacts no server of its own.
- Test data in this repository comes only from demo mode and throw-away virtual routers (Docker / QEMU), never from real routers.

## Build from source

Requires Node.js 22.

```bash
npm ci
npx expo run:android   # needs the Android SDK and JDK 17
npx expo run:ios       # needs macOS and Xcode 26
```

Tests:

```bash
npm run typecheck && npm run lint && npm test
scripts/dev-router.sh up   # a disposable OpenWrt in Docker
ROUTER_URL=http://127.0.0.1:18080 ROUTER_PASSWORD=routelink-test npm run test:int
```

## Contributing

The code is layered; lower layers never import upper ones:

```
modules/routelink-native   native module: HTTP (certificate pinning, no cookie jar, no redirects), network info, Wake-on-LAN
src/api/http               HTTP client interface
src/api/ubus               JSON-RPC, login (ubus with LuCI fallback), session renewal, batching
src/api/connection         RouterConnection: real and demo routers
src/api/services           domain services: system, network, devices, Wi-Fi, services, logs… (version differences live here)
src/hooks, src/state       React Query hooks, local state (routers, settings)
src/app, src/features      screens and feature components (expo-router)
src/ui                     iOS 26–style components: glass, lists, sheets, risk confirmation
```

- Design (in Chinese): [docs/superpowers/specs/2026-10-05-routelink-design.md](docs/superpowers/specs/2026-10-05-routelink-design.md)
- M1 plan and execution log (in Chinese): [docs/superpowers/plans/2026-10-05-routelink-m1.md](docs/superpowers/plans/2026-10-05-routelink-m1.md)

## Acknowledgements

The feature set draws on these open-source OpenWrt apps (features only — none of their code is used):

- [LuCI Mobile](https://github.com/cogwheel0/luci-mobile)
- [OpenWrt Manager](https://github.com/hagaygo/OpenWrtManager)
- [YALA](https://github.com/GiridharSalana/yala)
- [WrtHub](https://github.com/whykang/wrthub-android)
- [WrtPulse](https://github.com/iamvivekkaushik/WrtPulse)

Thanks also to [OpenWrt](https://openwrt.org), [LuCI](https://github.com/openwrt/luci) and [Expo](https://expo.dev).

## License

[MIT](LICENSE)
