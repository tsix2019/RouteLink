RouteLink router plugin: per-device traffic statistics for OpenWrt 23.05, 24.10 and 25.12, with LuCI
pages and an API for the RouteLink app.

**Easiest:** install it from the RouteLink app (More → Router plugin).

**Manual install** (pick the files for your OpenWrt version and architecture; `manifest.json` lists them):

```sh
# OpenWrt 23.05 / 24.10 (opkg)
opkg update
opkg install routelinkd_*.ipk luci-app-routelink_*.ipk luci-i18n-routelink-zh-cn_*.ipk

# OpenWrt 25.12 (apk): trust the RouteLink key first
wget -O /etc/apk/keys/routelink.pem https://tsix2019.github.io/RouteLink/agent/keys/routelink-apk.pem
apk update
apk add routelinkd-*.apk luci-app-routelink-*.apk luci-i18n-routelink-zh-cn-*.apk
```

**Package feed** (updates through LuCI → System → Software): see the "Router plugin" section of the README.

Notes:
- nlbwmon resets the connection counters this plugin reads; stop it (the LuCI page offers a button).
- Hardware offloading and Turbo ACC/SFE bypass connection accounting; software offloading is fine.
