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
- **Traffic per device**: with the router plugin, live rates per device and usage for any period, per day and per month; the app installs the plugin in one tap.
- **Safe changes**: every change goes through OpenWrt's own apply-and-confirm mechanism — if the app can't reach the router afterwards, the router undoes the change after 90 seconds. Anything that can cut connections asks first, with graded risk warnings.
- **SSH terminal**: the router's command line inside the app; you confirm the host key on first connection and the app stops if it ever changes; installs the app's own key on the router in one tap.
- **AI assistant**: ask about your router with your own API key (Claude, OpenAI, DeepSeek, Qwen, or a local Ollama); it asks you before changing anything.
- **Home-screen widgets and alerts**: the current router's state, speed and devices online on your home screen (Android adds five more: speed, devices online, system, WAN and shortcuts, with ↻ to refresh on the spot); a notification when a router can't be reached, comes back, or sees a new device.
- **Demo mode**: try everything without a router, against a built-in simulated OpenWrt.
- **Private**: no data collection; the app talks only to the routers you add, to GitHub only when you check for updates, turn on automatic checks or install the plugin, and to the AI provider you choose once you turn the assistant on.

> The app's five milestones (M1–M5) and the router plugin's first phase (P1) are complete; what comes next is in the feature list below.

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

**Traffic (needs the router plugin)**

| | iOS | Android |
|---|---|---|
| Traffic | <img src="docs/screenshots/en/ios-traffic-light.png" width="240"> | <img src="docs/screenshots/en/android-traffic-light.png" width="240"> |
| Device traffic | <img src="docs/screenshots/en/ios-traffic-device-light.png" width="240"> | <img src="docs/screenshots/en/android-traffic-device-light.png" width="240"> |
| WAN usage | <img src="docs/screenshots/en/ios-wan-dark.png" width="240"> | <img src="docs/screenshots/en/android-wan-dark.png" width="240"> |

**Network and system tools**

| | iOS | Android |
|---|---|---|
| Firewall | <img src="docs/screenshots/en/ios-firewall-light.png" width="240"> | <img src="docs/screenshots/en/android-firewall-light.png" width="240"> |
| Connections | <img src="docs/screenshots/en/ios-connections-dark.png" width="240"> | <img src="docs/screenshots/en/android-connections-dark.png" width="240"> |
| Packages | <img src="docs/screenshots/en/ios-packages-light.png" width="240"> | <img src="docs/screenshots/en/android-packages-light.png" width="240"> |

**More router features**

| | iOS | Android |
|---|---|---|
| Parental control | <img src="docs/screenshots/en/ios-parental-light.png" width="240"> | <img src="docs/screenshots/en/android-parental-light.png" width="240"> |
| Wi-Fi schedule | <img src="docs/screenshots/en/ios-wifi-schedule-dark.png" width="240"> | <img src="docs/screenshots/en/android-wifi-schedule-dark.png" width="240"> |
| WireGuard | <img src="docs/screenshots/en/ios-wireguard-dark.png" width="240"> | <img src="docs/screenshots/en/android-wireguard-dark.png" width="240"> |
| Ad blocking | <img src="docs/screenshots/en/ios-adblock-light.png" width="240"> | <img src="docs/screenshots/en/android-adblock-light.png" width="240"> |
| Firmware upgrade | <img src="docs/screenshots/en/ios-firmware-light.png" width="240"> | <img src="docs/screenshots/en/android-firmware-light.png" width="240"> |

**Terminal, AI assistant and widget**

| | iOS | Android |
|---|---|---|
| SSH terminal | <img src="docs/screenshots/en/ios-terminal-dark.png" width="240"> | <img src="docs/screenshots/en/android-terminal-dark.png" width="240"> |
| AI assistant | <img src="docs/screenshots/en/ios-assistant-light.png" width="240"> | <img src="docs/screenshots/en/android-assistant-light.png" width="240"> |
| Notifications & widget | <img src="docs/screenshots/en/ios-notifications-light.png" width="240"> | <img src="docs/screenshots/en/android-widget-light.png" width="240"> |

More screenshots in [docs/screenshots/en](docs/screenshots/en).

## Features

✅ done　🚧 planned (phase in brackets: M2–M4 are milestones of the app itself, P2–P4 phases of the router plugin and what builds on it)

**Overview**

- ✅ System: model, firmware, kernel, host name, uptime
- ✅ Resources: load, memory, storage, temperature (where the router reports it)
- ✅ Internet: protocol, IP, gateway, DNS, connected time
- ✅ Live traffic chart, devices online
- ✅ Reboot, with progress and a check that the router is back
- ✅ Today's traffic card: today's download and upload and the busiest devices (needs the plugin)
- ✅ Wi-Fi QR codes (from the overview and each network's page)
- ✅ Ask AI: opens the AI assistant in one tap

**Devices**

- ✅ One list from DHCP leases, the neighbour table and Wi-Fi stations; online/offline and wired/Wi-Fi filters; search; signal strength; vendor names
- ✅ Rename (stored on the router; names that are valid host names also show up in LuCI and local DNS)
- ✅ Reserve an IP, block internet access, disconnect from Wi-Fi
- ✅ Wake-on-LAN (sent by the router when etherwake is installed, otherwise directly from Android phones)
- ✅ Traffic of one device: curve, totals, peak, online/offline record (needs the plugin)
- ✅ Parental control: block a device's internet by schedule (periods across midnight too); when a period starts, its open connections are cut as well
- 🚧 Find unknown devices, trusted devices (P2)

**Wi-Fi**

- ✅ Radios: on/off, channel, channel width, transmit power, country code
- ✅ Networks: name, password, security, hidden, enabled. If your phone is on that network, the app warns you and walks you through rejoining
- ✅ Scan nearby networks
- ✅ Guest network: one-step setup (internet only, guests kept apart), on/off, QR code, delete; on routers that route to the internet themselves
- ✅ MAC filter: allow or block the listed devices, without locking out the phone in use
- ✅ Wi-Fi schedule: off and on again at set times, for all radios or one; the wireless settings stay as they are
- 🚧 Signal monitor, channel scan and advice, Wi-Fi security check (P2)

**Network**

- ✅ Interfaces with details, reconnect
- ✅ Traffic (needs the plugin): totals and curve for any period (optionally only some hours of each day), ranking by device (internet or LAN), live rates, CSV export
- ✅ WAN usage (needs the plugin): per day and per month, and this billing period from a monthly reset day
- ✅ WAN settings (DHCP, static, PPPoE, DNS, MTU) and LAN settings (address, DHCP pool; a new address is confirmed there, and undone if the app can't reach it)
- ✅ Routing tables and static routes, live connections (names from the router's reverse DNS), firewall (port forwards, traffic rules, zones), WireGuard status
- 🚧 One-tap diagnosis, ping/traceroute/nslookup, outage and latency records, speed test (P3)
- ✅ VLANs: a ports × VLANs matrix for DSA bridges and swconfig switches; high-risk, and the router rolls a bad change back by itself
- ✅ VPN: WireGuard tunnels and peers with config files and QR codes to export; OpenVPN `.ovpn` import, start and stop
- ✅ DDNS, SQM shaping, ad blocking (adblock-fast or adblock)

**More**

- ✅ Services: start, stop, restart, start at boot
- ✅ System and kernel logs (filter, share)
- ✅ Saved Wake-on-LAN devices
- ✅ Router management (order, edit, delete, certificate), language, appearance, refresh interval, reduce transparency, demo mode
- ✅ Router plugin: one-tap install, update check, restart, clear data, remove
- ✅ App updates: Android downloads, verifies and installs a new version in the app, iOS opens the release page; an optional daily check (off by default)
- ✅ Processes (stop, reload), packages (search, install, remove), scheduled tasks, LEDs, system (time zone, set the router clock, admin password)
- ✅ Backup and restore, firmware upgrade (online for official OpenWrt and ImmortalWrt releases, or from a file), factory reset. All high-risk: a backup is offered first, a checkbox and the router's name confirm, and a full-screen page asks to keep the power on
- ✅ SSH terminal: password or key login, host key confirmed and pinned, a key bar (Esc, Tab, Ctrl, arrows), adjustable font size, finger scrolling, landscape; installs the app's public key on the router in one tap
- ✅ AI assistant: Claude, OpenAI, DeepSeek, Qwen, Ollama or any OpenAI-compatible service, with your own API key; looks up status, devices and logs, and asks you in the chat before changing anything (kick or block a device, change Wi-Fi, add a port forward, restart a service or the router); you choose what is sent and whether it is masked; keeps several conversations per router, which you can search, rename and delete
- ✅ Home-screen widget (iOS, Android): the current router's state, speed and devices online; tap to open the app
  - Six on Android: router status, speed, devices online, system, WAN and shortcuts. ↻ on a widget reads the router in the background (with a saved password), and the system updates them about every half hour. Preview and add them in More → Home Screen Widgets
  - Nothing happens when adding one from the app: Xiaomi, vivo, OPPO, Huawei, Honor and similar phones do not let apps add to the home screen until "Home screen shortcuts" is allowed in RouteLink's app permissions; the app says so and opens the settings page. Adding one from the launcher's widget picker always works
- ✅ Background alerts: a router can't be reached, comes back, or sees a new device (per router, needs a saved password)
- 🚧 Rate limits and quotas, destinations and DNS log, online/offline push notifications, Android live monitor (P4)

## Install

- **Android**: download `RouteLink-<version>.apk` from [Releases](https://github.com/tsix2019/RouteLink/releases). Needs Android 8.0 or later on an ARM processor (every phone and tablet on the market).
- **iOS**: needs iOS 17 or later (Liquid Glass needs iOS 26). Not on the App Store. Releases include an unsigned `RouteLink-unsigned.ipa`; sign and install it with your own Apple ID using [AltStore](https://altstore.io), [SideStore](https://sidestore.io) or Sideloadly, or with TrollStore on iOS versions it supports.
  - The IPA carries a home-screen widget extension, so signing it takes two App IDs (a free Apple ID may register 10 every 7 days). The app and the widget share data through the App Group `group.io.github.tsix2019.routelink`, which signing has to replace with one of your account (AltStore and SideStore do it for you). If the widget never shows any data, the App Group was most likely lost in signing; the app itself is not affected.

## Router requirements

- OpenWrt 21.02 or newer with the LuCI web interface. CI tests against OpenWrt **23.05, 24.10 and 25.12**; ImmortalWrt and other derivatives should work too.
- The packages it needs come with LuCI: `rpcd`, `uhttpd-mod-ubus`, `rpcd-mod-luci`, `rpcd-mod-iwinfo`, `rpcd-mod-file`.
- Optional packages:

  | Feature | Package |
  |---|---|
  | Wake-on-LAN sent by the router | `luci-app-wol` (with `etherwake`). LuCI's wake helper is broken on OpenWrt 25.12.5; Android then sends the packet itself |
  | HTTPS | included in recent firmware; on older releases install `luci-ssl` |
  | WireGuard (status, new tunnels and peers) | `luci-proto-wireguard` |
  | OpenVPN | `openvpn-openssl`, `luci-app-openvpn` |
  | DDNS | `ddns-scripts`, `luci-app-ddns`; some providers need their own script, e.g. `ddns-scripts-cloudflare` |
  | SQM shaping | `sqm-scripts`, `luci-app-sqm` |
  | Ad blocking | `adblock-fast` and `luci-app-adblock-fast`, or `adblock` and `luci-app-adblock` |

- **Self-signed HTTPS certificates**: on first connection the app shows the certificate's fingerprint for you to confirm, then trusts only that certificate. If it ever changes, the app stops and tells you (a reset router — or someone impersonating it).
- **HTTP** works, but the password crosses your network unencrypted; the app marks such routers as "Not encrypted". Turning on HTTPS is recommended.
- The default account is `root`; other rpcd accounts work too. Where an account lacks permission or a package is missing, the feature says so.

## Router plugin

The RouteLink plugin runs on the router, counts what every device uploads and downloads, and keeps the history; the app and LuCI (Services → RouteLink) show it.

- **How it counts**: connection-tracking counters summed per device MAC, IPv4 and IPv6; accurate with software flow offloading on. In the Docker lab it matches the byte counts of the client's network card exactly.
- **How long**: per minute for 48 hours, per hour for 90 days, per day for 2 years. Data lives in `/etc/routelink` on the router, written to flash every 10 minutes by default, capped at 32 MB, kept across firmware upgrades.
- **Cost**: on x86 (measured in Docker), with 52 devices and 5000 connections, 0.04% of one core and 1.7 MB of memory.
- **Runs on**: OpenWrt 23.05, 24.10 and 25.12, and firmware based on 25.12 that kept opkg (such as Kwrt); x86_64, aarch64 (cortex-a53, cortex-a72, generic), arm (cortex-a7, cortex-a9, cortex-a15), mipsel_24kc, mips_24kc.

**Install**

- **From the app**: More → Router plugin → Install Plugin. Needs the root account and a router that can reach the official OpenWrt package servers (for dependencies). Where GitHub is slow, set a download mirror on the same page.
- **By hand**: download the packages for your release and architecture from [Releases](https://github.com/tsix2019/RouteLink/releases) (`manifest.json` lists them) and install them on the router. `. /etc/openwrt_release; echo $DISTRIB_ARCH` shows the architecture.

  ```sh
  # OpenWrt 23.05 / 24.10, and 25.12 firmware that kept opkg (Kwrt: the 25.12 .ipk packages)
  opkg update
  opkg install routelinkd_*.ipk luci-app-routelink_*.ipk luci-i18n-routelink-zh-cn_*.ipk

  # OpenWrt 25.12: trust the RouteLink signing key first
  wget -O /etc/apk/keys/routelink.pem https://tsix2019.github.io/RouteLink/agent/keys/routelink-apk.pem
  apk update
  apk add routelinkd-*.apk luci-app-routelink-*.apk luci-i18n-routelink-zh-cn-*.apk
  ```

- **As a package feed** (later updates through LuCI's software page). Replace `24.10` and `x86_64` with your release and architecture:

  ```sh
  # OpenWrt 23.05 / 24.10, and 25.12 firmware that kept opkg (with 25.12 in the URL)
  wget -O /etc/opkg/keys/a276fe73982c5f59 https://tsix2019.github.io/RouteLink/agent/keys/a276fe73982c5f59
  echo 'src/gz routelink https://tsix2019.github.io/RouteLink/agent/24.10/x86_64' >> /etc/opkg/customfeeds.conf
  opkg update && opkg install routelinkd luci-app-routelink

  # OpenWrt 25.12
  wget -O /etc/apk/keys/routelink.pem https://tsix2019.github.io/RouteLink/agent/keys/routelink-apk.pem
  echo 'https://tsix2019.github.io/RouteLink/agent/25.12/x86_64/packages.adb' >> /etc/apk/repositories.d/customfeeds.list
  apk update && apk add routelinkd luci-app-routelink
  ```

**Good to know**

- **nlbwmon** resets the connection counters the plugin reads, so totals come out low while both run. The app and LuCI say so and offer to stop it.
- **Hardware offloading** (or Turbo ACC/SFE) hides offloaded traffic from the counters; the plugin warns that totals may be low. Software offloading is fine.
- **Time**: until the router's clock is synchronised, data stays in memory; days and months follow the router's time zone.
- **Privacy**: the data stays on your router; the app contacts GitHub only when you check for updates or install the plugin.

<img src="docs/screenshots/luci/en-traffic.png" width="720" alt="LuCI traffic page">

## Security and privacy

- Router passwords live only in the system keychain (iOS Keychain / Android Keystore) and are never logged. You can also choose not to save a password and enter it when the app starts.
- Discovery probes never carry credentials.
- The SSH private key the app creates lives in the keychain and never leaves the phone; only the public key goes on the router.
- The AI assistant is off until you enter your own API key, read what it sends and agree. Then your question and the router data needed to answer it (status, device list, wireless and firewall settings, system log) go to the provider you chose. MAC addresses and public IPs are masked by default, each kind of data can be turned off, and passwords and keys are never sent. Conversations stay on the phone.
- No analytics, no ads; the app contacts no server of its own, and GitHub only when you check for updates, turn on automatic checks or install the plugin.
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

The router plugin (needs Docker):

```bash
scripts/agent-test.sh                    # daemon unit tests (ASan, UBSan)
scripts/agent-build.sh 24.10.8 x86_64    # build with the OpenWrt SDK into openwrt/out/
scripts/agent-router.sh up && scripts/agent-dev-install.sh && scripts/traffic-lab.sh up
npx jest -c jest.agent.config.js         # accuracy tests
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
src/ui                     iOS 26–style components: glass, lists, sheets, risk confirmation, charts
openwrt/                   the router plugin: routelinkd (C daemon), luci-app-routelink (LuCI pages), feed keys
```

- Design (in Chinese): [docs/superpowers/specs/2026-10-05-routelink-design.md](docs/superpowers/specs/2026-10-05-routelink-design.md)
- M1 plan and execution log (in Chinese): [docs/superpowers/plans/2026-10-05-routelink-m1.md](docs/superpowers/plans/2026-10-05-routelink-m1.md)
- Plugin design (in Chinese): [docs/superpowers/specs/2026-10-05-routelink-agent-design.md](docs/superpowers/specs/2026-10-05-routelink-agent-design.md)
- P1 plan and execution log (in Chinese): [docs/superpowers/plans/2026-10-05-routelink-p1.md](docs/superpowers/plans/2026-10-05-routelink-p1.md)
- M5 design, forms as pages and app updates (in Chinese): [docs/superpowers/specs/2026-10-06-routelink-m5-design.md](docs/superpowers/specs/2026-10-06-routelink-m5-design.md)
- M5 plan and execution log (in Chinese): [docs/superpowers/plans/2026-10-06-routelink-m5.md](docs/superpowers/plans/2026-10-06-routelink-m5.md)

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
