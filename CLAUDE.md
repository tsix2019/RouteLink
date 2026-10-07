# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RouteLink is an Expo SDK 57 / React Native 0.86 app (iOS + Android, English + Chinese) for managing OpenWrt routers. The repo also holds the router-side pieces: the `routelinkd` C daemon, a LuCI app, and a native Expo module. Also read [AGENTS.md](AGENTS.md): Expo APIs change every SDK, so check the versioned docs (`https://docs.expo.dev/versions/v57.0.0/`) before touching Expo/RN APIs, and add Expo packages with `npx expo install`.

## Commands

```bash
npm run typecheck                 # tsc --noEmit
npm run lint                      # expo lint
npm test                          # unit/component tests (jest-expo, TZ forced to Asia/Shanghai)
npx jest src/api/services/wifi-schedule.test.ts   # one file; add -t "name" for one test
scripts/verify.sh [jest filters]  # pre-commit gate: typecheck + eslint --max-warnings 0 + jest
npm run test:int                  # integration tests against a real OpenWrt (needs ROUTER_URL / ROUTER_PASSWORD)
npx jest -c jest.agent.config.js  # routelinkd tests (test/agent/*.agent.ts) against the plugin test router
scripts/agent-test.sh [ctest -R filter]   # routelinkd C unit tests under ASan/UBSan in Docker
npm start                         # expo start --dev-client (needs a dev build; Expo Go lacks routelink-native)
npm run android | npm run ios     # expo run:*
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint and `npm test -- --ci`. The QEMU integration job (`integration.yml`) only runs on `main` when router-facing code changes.

- `ios/` and `android/` are generated (Continuous Native Generation, git-ignored). Configure native behaviour in `app.config.ts` and `plugins/*.js` config plugins, never by hand. `android/` may exist locally from a prebuild; it is not source.
- Local test routers are Docker OpenWrt containers: `scripts/dev-router.sh up|down` (`routelink-owrt`, LuCI on :18080, `root` / `routelink-test`) and `scripts/agent-router.sh` (plugin tests, :18280). They are shared across worktrees: `up` removes and recreates the container, so use `RL_AGENT_NAME` / `RL_AGENT_NET` / `RL_AGENT_PORT` for a private instance. From the Android emulator the host is `10.0.2.2`.

## Architecture

The authoritative design is [docs/superpowers/specs/2026-10-05-routelink-design.md](docs/superpowers/specs/2026-10-05-routelink-design.md) (Chinese); per-milestone plans live in `docs/superpowers/plans/`. Key points that span many files:

**Layering (dependencies point down only).** UI (`src/app` routes, `src/features/*`, `src/ui`) → React Query hooks (`src/hooks`) → domain services (`src/api/services/*`, one module per feature, where OpenWrt version differences are handled) → protocol (`src/api/ubus`, `src/api/uci.ts`, `src/api/ssh`) → `RouterConnection`. UI never calls ubus directly; services know nothing about UI.

**`RouterConnection`** (`src/api/connection/types.ts`) is the single seam. `LiveConnection` talks to a real router over rpcd/ubus JSON-RPC plus LuCI's `cgi-exec` / `cgi-download` / `cgi-backup` endpoints; `DemoConnection` (`src/api/connection/demo/`) is an in-memory simulated OpenWrt used for demo mode, screenshots and many tests. Demo mode replaces only this layer, so any new service call needs a demo implementation too. `classifyError` maps stack errors to UI-actionable failures.

**Capabilities** (`src/api/capabilities.ts`): each `Feature` is probed against the router's rpcd ACLs/binaries and reports `ok | missing-package | unsupported`; screens gate on this rather than assuming packages are installed.

**Safe config changes.** Changes go through uci staging with OpenWrt's apply-and-confirm (the router rolls back after 90 s if the app cannot reconnect); `fork()` gives an isolated session for staged changes and `relocated()` re-targets a session after the LAN address changes. Risky actions go through `RiskConfirm` with graded warnings.

**Native module** `modules/routelink-native` (Kotlin/Swift, mocked globally in `test/setup.ts`; tests override individual functions) provides HTTP with TLS pinning/trust prompts, SSH, Wake-on-LAN, network info. `@/…` maps to `src/`, and `routelink-native` to the module, in tsconfig and all jest configs.

**Routing / UI.** Expo Router under `src/app` (5 tabs in `(tabs)/`, plus root-stack screens and sheets). Platform splits use `.ios.tsx` / `.android.tsx`; Android draws the iOS 26 Liquid Glass look itself (`src/ui/glass`, `src/components/app-tabs.android.tsx`). `src/platform-files.test.ts` enforces that a platform file has the same extension as the shared file next to it (Metro resolves one extension at a time). State: zustand stores in `src/state`, server data via React Query, persisted via `src/state/storage.ts` (secure-store/sqlite).

**i18n.** `src/i18n/locales/{en,zh-CN}/<namespace>.json` must have identical keys, no empty strings and matching `{{vars}}` (enforced by `i18n.test.ts`); add every string to both. Native strings (permissions, widget labels) are in `src/i18n/native/` and `plugins/with-widget-strings.js`.

**Other app areas:** `src/ai` (provider adapters for Anthropic/OpenAI-compatible/Ollama, tool definitions, data redaction, SSE), `src/discovery` (LAN scan for OpenWrt), `src/features/agent` (installs/uses the router plugin), `src/features/background` and `src/widgets` (iOS widgets via expo-widgets; Android widgets via react-native-android-widget, with definitions in `app.config.ts`/`src/widgets/catalog.ts`; `expo-widgets` is excluded from Android autolinking in `package.json`).

**Router side (`openwrt/`).** `routelinkd` (C/CMake, OpenWrt package) records per-device traffic from conntrack, wireless stats, latency, speed limits/quotas and push messages, exposed over ubus object `routelink`; its ACL is `openwrt/routelinkd/files/routelink.acl.json`. `openwrt/luci-app-routelink` is the LuCI front end. The app's plugin client is `src/api/services/agent*` / `src/features/agent`; changes to the ubus surface must be made on both sides.

## Conventions worth knowing

- Code comments and docs are in English; the design spec is Chinese.
- Test fixtures of recorded router responses live in `test/fixtures` (regenerate with `scripts/record-fixtures.ts`); don't put real router data, addresses or passwords in the repo.
- Lint runs with `--max-warnings 0` in `scripts/verify.sh`.
