# RouteLink M1 实施计划：地基 + 第一档

> 设计文档：`docs/superpowers/specs/2026-10-05-routelink-design.md`（下文简称"设计"，§ 表示章节）
>
> **执行方式**：按顺序逐个完成任务。
> - 逻辑代码走 TDD：先写测试，确认失败；再实现，确认通过；然后提交。
> - 界面任务按"验收"清单在 Android 模拟器上截图核对。
> - iOS 端以 CI 的编译结果和截图为准。
> - 每个任务做完都提交一次。改动了 CI 的任务，提交后立刻推送。

**目标**：做出一个能用的 RouteLink M1，能连真实的 OpenWrt 路由器，也能跑演示模式。内容包括：
- 第一档功能
- 自动发现
- 多路由器切换
- 中英文
- 液态玻璃界面
- 四个 CI 工作流
- 公开仓库，带中英文 README 和截图

**架构**：
- 分层是：界面 → React Query hooks → 领域服务（`src/api/services`）→ 协议层（ubus / uci / 原生 HTTP）→ `RouterConnection`。`RouterConnection` 有两个实现：`LiveConnection` 连真实路由器，`DemoConnection` 跑演示数据。
- 所有发往路由器的 HTTP 请求都走本地 Expo 原生模块 `routelink-native`。它负责证书固定，不用全局 Cookie，不自动跟随跳转。

**技术栈**：
- Expo SDK 57、React Native 0.86.3、React 19.2、TypeScript 6、expo-router 57、Reanimated 4.5
- 玻璃和模糊：expo-glass-effect、expo-blur
- 数据和状态：TanStack Query、zustand、expo-sqlite/kv-store、expo-secure-store
- 多语言：i18next
- 原生模块：Kotlin（OkHttp）+ Swift（URLSession、Network.framework）
- 测试：Jest（jest-expo）、RNTL；集成测试用 Docker 或 QEMU 跑的 OpenWrt

---

## 0. 约定

### 0.1 本机环境
- 所有命令都在 Git Bash 里执行，工作目录是 `D:\RouteLink`。
- 每个新的终端会话先执行 `source scripts/dev-env.sh`（T1 创建）。原因是 C 盘只剩 13GB，Gradle 缓存、npm 缓存都要放到 D 盘。
- Git Bash 会改写以 `/` 开头的参数，在里面调用 `docker` 时，前面要加 `MSYS_NO_PATHCONV=1`。
- **本地测试路由器**：用 `scripts/dev-router.sh up` 启动（T25 创建），是 Docker 里的 OpenWrt 24.10.8。
  - 在电脑上访问：`http://127.0.0.1:18080`，HTTPS 是 `https://127.0.0.1:18443`。
  - 在模拟器里访问：`http://10.0.2.2:18080`。
  - 账号是 `root`，密码 `routelink-test`。启动脚本会设置这个密码，它是测试值，可以写进仓库。
- **模拟器**：AVD 是 `dcar_test`（Android 14，x86_64，1080×2340，WHPX 加速）。

### 0.2 代码约定
- 单元测试和源文件放在一起，命名 `*.test.ts(x)`。集成测试放在 `test/integration/*.int.test.ts`。
- 路径别名 `@/*` 指向 `./src/*`，沿用模板配置。
- 界面文字一律走 `t()`，不允许硬编码中文或英文。
- MAC 地址统一规范成大写、冒号分隔，例如 `AA:BB:CC:00:11:22`；证书指纹统一存成小写十六进制，不带冒号。
- 提交信息用英文，末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

### 0.3 常用命令（T4 之后可用）

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npm test` | 单元测试 |
| `npm run test:int` | 集成测试，需要设置环境变量 `ROUTER_URL`、`ROUTER_PASSWORD` |
| `npx expo run:android` | 构建开发版并装到模拟器 |
| `npx expo start --dev-client` | 只改了 JS 时，启动 Metro 后在 App 里重新加载 |

## 1. M1 范围

M1 要完成的功能编号见设计 §9：

| 类别 | 编号 |
|---|---|
| 概览 | OV-1～5，以及 OV-6 里的"重启" |
| 设备 | DV-1～6 |
| 无线 | WL-1～3 |
| 网络 | NW-1 |
| 更多 | MO-1～3、MO-14、MO-16（通知设置除外） |
| App 级 | AP-1、AP-2、AP-3 |

基础设施：

- 玻璃组件、主题、中英文
- 原生模块：HTTP 和证书固定、网络信息、Android 网络唤醒
- 连接层：ubus 登录及 LuCI 回退、会话续期、批量调用、功能检测
- 安全应用（设计 §11，其中"改 LAN IP"那部分留到 M2）
- `RiskConfirm` 组件
- 四个 CI 工作流
- 公开仓库、README 和截图

**不在 M1**：LAN IP 修改流程（M2）、cgi-io 上传下载（M3）、SSH（M4）。M1 只对 Citadel 做一次 iOS 编译验证（T17）。

## 2. 文件结构（M1 结束时）

```
.github/workflows/{ci,integration,android,ios}.yml
app.config.ts  package.json  tsconfig.json  jest.config.js  jest.integration.config.js  eslint.config.js
.gitattributes  .gitignore  LICENSE  README.md  README.en.md
assets/icon/routelink.svg  assets/routelink.icon/  assets/images/*.png
plugins/with-release-signing.js
modules/routelink-native/
  expo-module.config.json  index.ts  src/RouteLinkNative.types.ts  src/RouteLinkNativeModule.ts
  android/build.gradle  android/src/main/AndroidManifest.xml
  android/src/main/java/expo/modules/routelinknative/{RouteLinkNativeModule,HttpEngine,Tls,NetInfo,WakeOnLan}.kt
  ios/RouteLinkNative.podspec  ios/{RouteLinkNativeModule,HttpEngine,Tls,NetInfo}.swift
scripts/
  dev-env.sh  dev-router.sh  gen-icons.ts  gen-oui.ts  record-fixtures.ts  router-check.ts
  screenshots-android.sh  ci/qemu-openwrt.sh  ci/ios-selftest.sh  ci/ios-screenshots.sh  ci/selftest-servers.py
src/
  app/                         路由（见 T45）
  api/
    http/{types,native,node,fake}.ts
    ubus/{types,errors,jsonrpc,login,session}.ts
    connection/{types,live,demo/*,manager}.ts
    capabilities.ts  uci.ts
    services/{system,network,traffic,clients,client-actions,wireless,services,logs}.ts
  discovery/{targets,probe,scan}.ts
  data/oui.json
  features/{onboarding,routers,overview,devices,wireless,network,more,settings}/...
  hooks/                       各领域的 React Query hooks
  i18n/{index,resources}.ts  i18n/locales/{zh-CN,en}/*.json  i18n/native/{en,zh-Hans}.json
  state/{settings,routers,snapshots}.ts
  ui/
    theme/{tokens,ThemeProvider}.tsx
    glass/{GlassSurface.ios,GlassSurface.android,BlurTarget}.tsx
    {GradientBackground,GlassCard,GlassButton,ListSection,ListRow,StatusDot,Badge,
     TextField,EmptyState,ErrorState,Skeleton,Banner,RiskConfirm}.tsx
    charts/{area-path,AreaChart,RingGauge}.ts(x)
    tabs/{GlassTabBar,TabIcon}.android.tsx
  utils/{format,net,mac,oui}.ts
test/
  fixtures/openwrt-24.10/*.json  （录制而来，见 T25）
  integration/*.int.test.ts
```

---

## 阶段 A：工程地基与仓库

### T1. 本机开发环境脚本

**文件**：新建 `scripts/dev-env.sh`

```bash
#!/usr/bin/env bash
# Local-only build environment for this Windows machine (C: is nearly full).
export GRADLE_USER_HOME="D:/.gradle-home"
export npm_config_cache="D:/.npm-cache"
export ANDROID_HOME="D:/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
if [ -z "$JAVA_HOME" ]; then
  JAVA_HOME="$(java -XshowSettings:properties -version 2>&1 | sed -n 's/^ *java.home = //p' | tr -d '\r')"
  export JAVA_HOME
fi
```

**验证**

```bash
source scripts/dev-env.sh && emulator -list-avds && java -version 2>&1 | head -1
```

预期输出里有 `dcar_test` 和 `17.x`。如果 `-list-avds` 没列出 `dcar_test`，就补一行 `export ANDROID_AVD_HOME="D:/avd"`，然后重试。

**提交**：`chore: add local dev environment script`

### T2. 脚手架

**步骤**
1. 生成模板：
   ```bash
   source scripts/dev-env.sh
   npx create-expo-app@latest /d/rl-scaffold --template default@sdk-57 --no-install --yes
   ```
2. 把 `app.json`、`package.json`、`tsconfig.json`、`assets/`、`src/` 以及 `.gitignore` 拷到 `D:\RouteLink`，然后删掉 `/d/rl-scaffold`。
3. 修改 `package.json`：
   - `name` 改成 `routelink`，`version` 改成 `0.1.0`。
   - 删除 `react-dom`、`react-native-web`、`@expo/ui` 三个依赖，以及 `reset-project`、`web` 两个脚本。
4. 删除示例代码：
   - `src/app/explore.tsx`
   - `src/components/` 整个目录
   - `src/constants/`、`src/hooks/`、`src/global.css`
   - `src/app/index.tsx` 改成一个只显示 "RouteLink" 的占位页面。
5. 新建 `.gitattributes`：
   ```
   * text=auto eol=lf
   *.png binary
   *.jpg binary
   *.jks binary
   ```
   `.gitignore` 里追加：
   ```
   /build/
   test/integration/.cache/
   *.apk
   *.ipa
   ```
6. 安装 M1 需要的依赖：
   ```bash
   npm install
   npx expo install expo-blur expo-linear-gradient react-native-svg expo-localization expo-sqlite \
     expo-secure-store expo-build-properties expo-haptics expo-clipboard @expo/vector-icons \
     @react-native-segmented-control/segmented-control
   npm i i18next react-i18next @tanstack/react-query zustand
   ```

**验证**：`npx expo-doctor` 全部通过；`npx tsc --noEmit` 没有错误。

**提交**：`chore: scaffold Expo SDK 57 app`

### T3. App 配置与图标

**文件**
- 新建：`app.config.ts`（替代 `app.json`，旧文件删掉）
- 新建：`src/i18n/native/en.json`、`src/i18n/native/zh-Hans.json`
- 新建：`assets/icon/routelink.svg`、`scripts/gen-icons.ts`、`assets/routelink.icon/`

```ts
// app.config.ts
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
      NSLocalNetworkUsageDescription: 'RouteLink connects to routers on your local network to discover and manage them.',
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'io.github.tsix2019.routelink',
    adaptiveIcon: {
      backgroundColor: '#0A5BFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  locales: { en: './src/i18n/native/en.json', 'zh-Hans': './src/i18n/native/zh-Hans.json' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#0A5BFF', image: './assets/images/splash-icon.png', imageWidth: 96 }],
    'expo-localization',
    'expo-secure-store',
    'expo-sqlite',
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
    './plugins/with-release-signing.js',
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
```

`./plugins/with-release-signing.js` 在 T61 创建。在那之前，先把这一行从 `plugins` 里注释掉。

```json
// src/i18n/native/zh-Hans.json
{ "CFBundleDisplayName": "RouteLink", "NSLocalNetworkUsageDescription": "RouteLink 需要访问本地网络，用来发现和管理你的路由器。" }
```

```json
// src/i18n/native/en.json
{ "CFBundleDisplayName": "RouteLink", "NSLocalNetworkUsageDescription": "RouteLink connects to routers on your local network to discover and manage them." }
```

**图标**
- **图案**：三个节点用两条弧线连起来，表示"路由 + 连接"。图案是白色，背景是蓝色（`#0A5BFF`）到青色（`#14C8C8`）的渐变。
- **生成脚本**：`scripts/gen-icons.ts` 用 `@resvg/resvg-js`（先执行 `npm i -D @resvg/resvg-js tsx`）渲染出以下文件：
  - `icon.png`，1024 像素
  - `android-icon-foreground.png`，512 像素，图案留在 66% 的安全区内
  - `android-icon-monochrome.png`，512 像素
  - `splash-icon.png`，288 像素
- **iOS 26 液态玻璃图标**：`assets/routelink.icon/` 照搬模板 `expo.icon` 的结构：
  - `icon.json` 的 `fill` 改成 `"automatic-gradient": "extended-srgb:0.03922,0.35686,1.00000,1.00000"`。
  - 只保留一个图层：`Assets/glyph.svg`，即白色图案。
  - `translucency` 保持开启。

**验证**
- `npx tsx scripts/gen-icons.ts` 能生成上述 4 个 PNG。用 Read 打开 `assets/images/icon.png` 看一眼。
- `npx expo config --type public` 能输出配置，没有报错。

**提交**：`feat: app config, localized native strings and icons`

### T4. Jest、ESLint 与 npm 脚本

**依赖**

```bash
npx expo install jest-expo jest @types/jest -- --save-dev
npm i -D @testing-library/react-native
npx expo lint   # 第一次运行会生成 eslint.config.js
```

**新建 `jest.config.js`**

```js
module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/test/integration/', '/modules/routelink-native/'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFiles: ['<rootDir>/test/setup.ts'],
};
```

**新建 `jest.integration.config.js`**

```js
module.exports = {
  preset: 'jest-expo/node',
  testMatch: ['<rootDir>/test/integration/**/*.int.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testTimeout: 180000,
  maxWorkers: 1,
};
```

**新建 `test/setup.ts`**：mock `expo-secure-store`、`expo-sqlite/kv-store`，以及原生模块 `routelink-native`（T16 补齐）。

**`package.json` 的 scripts**

```json
{
  "start": "expo start --dev-client",
  "android": "expo run:android",
  "ios": "expo run:ios",
  "typecheck": "tsc --noEmit",
  "lint": "expo lint",
  "test": "jest",
  "test:int": "jest -c jest.integration.config.js"
}
```

**冒烟测试**：新建 `src/utils/smoke.test.ts`，内容是 `expect(1 + 1).toBe(2)`。等 T7 写了真正的测试，就把它删掉。

**验证**：`npm run typecheck && npm run lint && npm test` 全部通过。

**提交**：`chore: jest, eslint and npm scripts`

### T5. 建公开仓库，加 ci.yml

**文件**
- 新建：`LICENSE`（MIT，`Copyright (c) 2026 tsix2019`）
- 新建：`README.md`、`README.en.md`。两份都是占位，写明"开发中"，附设计文档链接，顶部互相跳转。
- 新建：`.github/workflows/ci.yml`

```yaml
name: CI
on:
  push: { branches: ['**'] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test -- --ci
```

**步骤**

```bash
git add -A && git commit -m "chore: license, placeholder readmes, CI workflow"
gh repo create tsix2019/RouteLink --public --source . --remote origin \
  --description "OpenWrt router manager for iOS & Android with Liquid Glass UI · 中英文"
git push -u origin main
```

**验证**：`gh run list --limit 1`，状态应该是 `completed success`。等待用后台的 `gh run watch`，不要轮询。

### T6. Android 首次构建

**步骤**
1. 后台启动模拟器：`emulator -avd dcar_test -no-snapshot-save -no-boot-anim`。
2. 等待 `adb wait-for-device` 返回，并且 `adb shell getprop sys.boot_completed` 输出 `1`。
3. 运行 `npx expo run:android`。第一次构建 Gradle 会自动下载 NDK 和 CMake，装到 `D:/Android/Sdk`，大约需要 15 到 25 分钟。

**验证**
- 截图：`adb exec-out screencap -p > /tmp/t6.png`。
- 用 Read 查看截图，应该能看到占位文字 "RouteLink"。
- `du -sh /c/Users/tsix2/.gradle` 应该没有增长，新缓存都写在 `D:/.gradle-home`。

**提交**：不需要（`android/` 已被 `.gitignore` 忽略）。

---

## 阶段 B：纯逻辑工具（TDD）

### T7. 格式化工具 `src/utils/format.ts`

**接口**

```ts
export type Lang = 'zh-CN' | 'en';
export function formatBytes(bytes: number, lang: Lang): string;      // 1536 → "1.5 KB"
export function formatBitRate(bitsPerSec: number, lang: Lang): string; // 12_300_000 → "12.3 Mbps"
export function formatDuration(sec: number, lang: Lang): string;     // 273600 → "3 天 4 小时" / "3d 4h"
export function formatPercent(ratio: number): string;                // 0.423 → "42%"
```

**规则**
- 字节用 1024 进制，单位依次是 B、KB、MB、GB、TB。
- 速率用 1000 进制，单位依次是 bps、Kbps、Mbps、Gbps。
- 数值保留 1 位小数，`>= 100` 时取整。
- 时长最多显示两个单位，依次是天、小时、分钟、秒。中文格式如"3 天 4 小时"，英文格式如"3d 4h"。

**测试**（`src/utils/format.test.ts`）

| 输入 | 预期输出 |
|---|---|
| `formatBytes(0)` | `0 B` |
| `formatBytes(1536)` | `1.5 KB` |
| `formatBytes(5 * 1024 ** 3)` | `5.0 GB` |
| `formatBitRate(999)` | `999 bps` |
| `formatBitRate(12_300_000)` | `12.3 Mbps` |
| `formatBitRate(250_000_000)` | `250 Mbps` |
| `formatDuration(59, 'en')` | `59s` |
| `formatDuration(3_660, 'en')` | `1h 1m` |
| `formatDuration(273_600, 'zh-CN')` | `3 天 4 小时` |
| `formatPercent(0.423)` | `42%` |

先跑一遍确认失败，再实现，然后确认通过。

**提交**：`feat(utils): byte, rate, duration formatting`

### T8. 网络计算 `src/utils/net.ts` 与 `src/utils/mac.ts`

```ts
// src/utils/net.ts
export function ipToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error(`bad ip ${ip}`);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
export const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
export const isIPv4 = (s: string) => { try { ipToInt(s); return true; } catch { return false; } };
export function netmaskToPrefix(mask: string): number {
  const n = ipToInt(mask);
  const prefix = n === 0 ? 0 : 32 - Math.log2((~n >>> 0) + 1);
  if (!Number.isInteger(prefix)) throw new Error(`bad netmask ${mask}`);
  return prefix;
}
export function parseCidr(cidr: string): { network: number; prefix: number } {
  const [ip, p] = cidr.trim().split('/');
  const prefix = Number(p);
  if (!isIPv4(ip) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error(`bad cidr ${cidr}`);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (ipToInt(ip) & mask) >>> 0, prefix };
}
/** Usable host addresses of a CIDR (excludes network/broadcast for prefix <= 30). */
export function cidrHosts(cidr: string, maxHosts = 1024): string[] {
  const { network, prefix } = parseCidr(cidr);
  const size = 2 ** (32 - prefix);
  if (size - 2 > maxHosts) throw new Error(`range too large: ${cidr}`);
  if (prefix >= 31) return Array.from({ length: size }, (_, i) => intToIp(network + i));
  return Array.from({ length: size - 2 }, (_, i) => intToIp(network + 1 + i));
}
/** Scan targets per spec §6: whole subnet if <= /24, else the /24s of phone and gateway. */
export function scanTargets(info: { ip: string; netmask: string; gateway?: string | null }): string[] {
  const prefix = netmaskToPrefix(info.netmask);
  const ranges = prefix >= 24
    ? [`${info.ip}/${prefix}`]
    : [...new Set([info.ip, info.gateway].filter(isIPv4Str).map((a) => `${a}/24`))];
  const hosts = new Set<string>();
  if (info.gateway && isIPv4(info.gateway)) hosts.add(info.gateway); // gateway first
  for (const r of ranges) for (const h of cidrHosts(r)) if (h !== info.ip) hosts.add(h);
  return [...hosts];
}
const isIPv4Str = (a: unknown): a is string => typeof a === 'string' && isIPv4(a);
```

```ts
// src/utils/mac.ts
export function normalizeMac(mac: string): string | null {
  const hex = mac.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return null;
  return hex.toUpperCase().match(/../g)!.join(':');
}
/** Locally administered bit set => randomized/private address (iOS/Android privacy MAC). */
export const isRandomizedMac = (mac: string) => (parseInt(mac.slice(0, 2), 16) & 0x02) === 0x02;
```

**测试**
- `netmaskToPrefix('255.255.255.0')` 返回 24；传入 `'255.0.255.0'` 应抛错。
- `cidrHosts('192.168.1.0/24')` 返回 254 个地址，首尾分别是 `.1` 和 `.254`。
- `cidrHosts('10.0.0.0/16')` 应抛出 "range too large"。
- `scanTargets({ip:'192.168.1.23', netmask:'255.255.255.0', gateway:'192.168.1.1'})`：第一个是 `192.168.1.1`，不包含 `.23`，共 253 个。
- `scanTargets({ip:'10.1.2.3', netmask:'255.255.0.0', gateway:'10.1.0.1'})`：范围是 `10.1.2.0/24` 加 `10.1.0.0/24`，第一个是网关。
- `normalizeMac('aa-bb-cc-00-11-22')` 返回 `AA:BB:CC:00:11:22`；传入 `'xyz'` 返回 null。
- `isRandomizedMac('DA:A1:19:00:00:01')` 返回 true；`isRandomizedMac('00:1A:11:00:00:01')` 返回 false。

**提交**：`feat(utils): IPv4/CIDR math, scan targets, MAC helpers`

### T9. OUI 厂商库

**文件**：新建 `scripts/gen-oui.ts`、`src/data/oui.json`、`src/utils/oui.ts`

**生成脚本**：`scripts/gen-oui.ts` 做以下几步。
1. 下载 `https://standards-oui.ieee.org/oui/oui.csv`。
2. 只保留 MA-L 前缀，即 6 位十六进制。
3. 简化厂商名：去掉 `, Inc.`、`Co.,Ltd`、`Corporation`、`Technologies` 这类后缀，最长 24 个字符。
4. 输出 `{ "v": [厂商名...], "m": { "001A11": 12, ... } }`，用下标去重。

**查询接口**

```ts
// src/utils/oui.ts
let db: { v: string[]; m: Record<string, number> } | null = null;
export function lookupVendor(mac: string): string | null {
  if (isRandomizedMac(mac)) return null;          // UI shows "Private address"
  db ??= require('@/data/oui.json');
  const i = db!.m[mac.replace(/:/g, '').slice(0, 6).toUpperCase()];
  return i === undefined ? null : db!.v[i];
}
```

**测试**
- `lookupVendor('00:1A:11:..')` 返回 `Google`。
- 随机 MAC 返回 null。
- 未知前缀返回 null。

**验证**：生成的 `oui.json` 不超过 900KB（`wc -c`）。

**提交**：`feat(utils): bundled IEEE OUI vendor lookup`

### T10. 多语言

**文件**
- 新建：`src/i18n/index.ts`、`src/i18n/resources.ts`、`src/i18n/i18n.test.ts`
- 新建：`src/i18n/locales/{zh-CN,en}/{common,onboarding,routers,overview,devices,wireless,network,more,settings,errors,risk}.json`

**初始化 `src/i18n/index.ts`**
- 调用 `i18next.use(initReactI18next).init({ resources, lng, fallbackLng: 'en', ns, defaultNS: 'common', interpolation: { escapeValue: false } })`。
- 语言选择逻辑：
  ```ts
  export function resolveLanguage(pref: 'system' | 'zh-CN' | 'en'): 'zh-CN' | 'en' {
    if (pref !== 'system') return pref;
    return getLocales()[0]?.languageCode === 'zh' ? 'zh-CN' : 'en';
  }
  ```
- 导出 `setLanguage(pref)`：调用 `i18next.changeLanguage(resolveLanguage(pref))`，切换后不需要重启。

**测试**（`src/i18n/i18n.test.ts`）

```ts
import { resources, namespaces } from './resources';
const flatten = (o: object, p = ''): Record<string, string> =>
  Object.entries(o).reduce((acc, [k, v]) =>
    typeof v === 'object' ? { ...acc, ...flatten(v, `${p}${k}.`) } : { ...acc, [`${p}${k}`]: v as string }, {});
const vars = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe.each(namespaces)('namespace %s', (ns) => {
  const zh = flatten(resources['zh-CN'][ns]);
  const en = flatten(resources.en[ns]);
  it('has identical keys', () => expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort()));
  it('has no empty strings', () => expect([...Object.values(zh), ...Object.values(en)].filter((s) => !s.trim())).toEqual([]));
  it('uses the same interpolation variables', () => {
    for (const k of Object.keys(zh)) expect([k, vars(zh[k])]).toEqual([k, vars(en[k] ?? '')]);
  });
});
it('resolves system language', () => { /* mock getLocales → zh / fr */ });
```

后续任务每加一条文字，都要同时补上中英文两份。这个测试会拦住漏翻。

**提交**：`feat(i18n): i18next setup with key-parity tests`

---

## 阶段 C：原生模块 `routelink-native`

### T11. 创建模块并定义 TS 接口

**步骤**
1. 运行 `npx create-expo-module@latest --local routelink-native`。如果命令有交互提问，模块名填 `RouteLinkNative`，包名填 `expo.modules.routelinknative`。
2. 删除生成的 web 实现和示例视图（View），只保留 Module。

**接口定义**：`modules/routelink-native/src/RouteLinkNative.types.ts`

```ts
export type TlsOptions =
  | { mode: 'system' }
  | { mode: 'pinned'; sha256: string }   // lowercase hex, no colons
  | { mode: 'insecure-probe' };          // discovery only: never send credentials with it
export interface HttpRequestOptions {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;                    // default 10000
  tls?: TlsOptions;                      // default { mode: 'system' }
}
export interface HttpResponse { status: number; headers: Record<string, string[]>; body: string } // header names lower-case
export interface CertificateInfo { sha256: string; subject: string; issuer: string; notBefore: string; notAfter: string }
export interface NetworkInfo { isWifi: boolean; ip: string | null; netmask: string | null; gateway: string | null; ifname: string | null }
export type NativeErrorCode =
  | 'ERR_TIMEOUT' | 'ERR_UNREACHABLE' | 'ERR_DNS' | 'ERR_TLS_UNTRUSTED' | 'ERR_TLS_PIN_MISMATCH'
  | 'ERR_NETWORK' | 'ERR_UNSUPPORTED' | 'ERR_INVALID_ARGUMENT';
```

**模块接口**：`src/RouteLinkNativeModule.ts`

```ts
declare class RouteLinkNativeModule extends NativeModule {
  httpRequest(o: HttpRequestOptions): Promise<HttpResponse>;
  fetchServerCertificate(url: string, timeoutMs?: number): Promise<CertificateInfo>;
  getNetworkInfo(): Promise<NetworkInfo>;
  sendWakeOnLan(mac: string, broadcast?: string, port?: number): Promise<void>; // iOS rejects ERR_UNSUPPORTED
}
export default requireNativeModule<RouteLinkNativeModule>('RouteLinkNative');
```

**提交**：`feat(native): scaffold routelink-native module and TS API`

### T12. Android：HTTP 与证书固定

**文件**：`android/build.gradle` 加 `implementation "com.squareup.okhttp3:okhttp:4.12.0"`；新建 `HttpEngine.kt`、`Tls.kt`；修改 `RouteLinkNativeModule.kt`。

**核心代码（Tls.kt）**

```kotlin
internal fun sha256Hex(bytes: ByteArray): String =
  MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

internal class PinningTrustManager(private val expected: String) : X509TrustManager {
  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    if (chain.isEmpty() || !sha256Hex(chain[0].encoded).equals(expected, ignoreCase = true))
      throw CertificateException("PIN_MISMATCH")
  }
  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = throw CertificateException()
  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

internal class CapturingTrustManager : X509TrustManager {   // insecure-probe + fetchServerCertificate
  var leaf: X509Certificate? = null
  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) { leaf = chain.firstOrNull() }
  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = throw CertificateException()
  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
```

**HttpEngine.kt 的要点**
- 用一个共享的基础 `OkHttpClient`，每次请求在它上面 `newBuilder()`：
  - `followRedirects(false)`、`followSslRedirects(false)`
  - `cookieJar(CookieJar.NO_COOKIES)`
  - `callTimeout(timeoutMs)`、`connectTimeout(min(timeoutMs, 5000))`
- `pinned` 和 `insecure-probe` 两种模式：设置自定义的 `sslSocketFactory(ctx.socketFactory, tm)`，加上 `hostnameVerifier { _, _ -> true }`。自签名证书的 CN 通常是 `OpenWrt`，和 IP 地址对不上，所以要关掉主机名校验。
- 响应头转成 `Map<String, List<String>>`，键名全部小写。
- 异常映射：
  - `SocketTimeoutException`、`InterruptedIOException` → `ERR_TIMEOUT`
  - `ConnectException`、`NoRouteToHostException` → `ERR_UNREACHABLE`
  - `UnknownHostException` → `ERR_DNS`
  - `SSLHandshakeException`：信息里带 `PIN_MISMATCH` → `ERR_TLS_PIN_MISMATCH`；在 `system` 模式下 → `ERR_TLS_UNTRUSTED`
  - 其他 → `ERR_NETWORK`
  - 统一抛出 `CodedException(code, message, cause)`。
- `fetchServerCertificate`：用 `CapturingTrustManager` 发一次 `HEAD /`（或者直接握手），返回 `sha256Hex(leaf.encoded)`、`subjectX500Principal.name`、`issuerX500Principal.name`，以及 ISO 格式的有效期。

**模块定义**

```kotlin
AsyncFunction("httpRequest") Coroutine { opts: HttpRequestRecord -> engine.execute(opts) }
AsyncFunction("fetchServerCertificate") Coroutine { url: String, timeoutMs: Int? -> engine.certificate(url, timeoutMs ?: 8000) }
```

用 `Record` 加 `@Field` 映射参数。网络请求放在 `Dispatchers.IO` 上执行。

**验证**：放到 T16 和 T25 一起，用开发页对 Docker 路由器做实测。

**提交**：`feat(native/android): OkHttp engine with TLS pinning`

### T13. Android：网络信息与网络唤醒

**文件**：`NetInfo.kt`、`WakeOnLan.kt`；`AndroidManifest.xml` 声明 `ACCESS_NETWORK_STATE` 和 `INTERNET`。

**getNetworkInfo**
- 依次取 `ConnectivityManager.activeNetwork`、`getLinkProperties`、`getNetworkCapabilities`。
- IPv4 地址取第一个 `Inet4Address` 类型的 linkAddress；子网掩码由前缀长度换算。
- 网关取 `routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }`。
- 有 `TRANSPORT_WIFI` 时 `isWifi = true`。

**sendWakeOnLan**
- 唤醒包是 6 个 `0xFF`，后面跟 16 遍 MAC。
- 用 `DatagramSocket(broadcast = true)` 发到 `broadcast ?: "255.255.255.255"` 的 `port ?: 9` 端口。
- MAC 格式不对时抛 `ERR_INVALID_ARGUMENT`。

**提交**：`feat(native/android): network info and Wake-on-LAN`

### T14. iOS：HTTP 与证书固定

**文件**：`HttpEngine.swift`、`Tls.swift`；修改 `RouteLinkNativeModule.swift`

**每次请求**
- 新建一个 `URLSession`，配置用 `.ephemeral`：
  - `httpShouldSetCookies = false`
  - `httpCookieAcceptPolicy = .never`
  - `timeoutIntervalForRequest = timeout`
- delegate 处理证书挑战和跳转。请求结束后调用 `finishTasksAndInvalidate()`。

```swift
final class TaskDelegate: NSObject, URLSessionTaskDelegate {
  let tls: TlsOptions
  private(set) var pinMismatch = false, untrusted = false
  private(set) var leaf: SecCertificate?
  init(tls: TlsOptions) { self.tls = tls }

  func urlSession(_ s: URLSession, task: URLSessionTask, didReceive c: URLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    guard c.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = c.protectionSpace.serverTrust else { return completionHandler(.performDefaultHandling, nil) }
    leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first
    switch tls.mode {
    case "pinned":
      if let leaf, sha256Hex(SecCertificateCopyData(leaf) as Data) == tls.sha256?.lowercased() {
        completionHandler(.useCredential, URLCredential(trust: trust))
      } else { pinMismatch = true; completionHandler(.cancelAuthenticationChallenge, nil) }
    case "insecure-probe":
      completionHandler(.useCredential, URLCredential(trust: trust))
    default:
      if SecTrustEvaluateWithError(trust, nil) { completionHandler(.performDefaultHandling, nil) }
      else { untrusted = true; completionHandler(.cancelAuthenticationChallenge, nil) }
    }
  }
  func urlSession(_ s: URLSession, task: URLSessionTask, willPerformHTTPRedirection r: HTTPURLResponse,
                  newRequest: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)   // never follow redirects; LuCI login needs the 302 + Set-Cookie
  }
}
```

**`sha256Hex`**：用 CryptoKit 的 `SHA256.hash(data:)` 实现。

**错误映射**
- 先看 delegate 的标记：`pinMismatch` → `ERR_TLS_PIN_MISMATCH`，`untrusted` → `ERR_TLS_UNTRUSTED`。
- 再看 `URLError`：
  - `.timedOut` → `ERR_TIMEOUT`
  - `.cannotConnectToHost`、`.networkConnectionLost`、`.notConnectedToInternet` → `ERR_UNREACHABLE`
  - `.cannotFindHost`、`.dnsLookupFailed` → `ERR_DNS`
  - `.serverCertificateUntrusted`、`.serverCertificateHasUnknownRoot` → `ERR_TLS_UNTRUSTED`
  - 其他 → `ERR_NETWORK`
- 抛出时用 Expo 的 `Exception` 子类，并重写 `code`。

**响应头**：`HTTPURLResponse.allHeaderFields` 的键名转成小写。`Set-Cookie` 用 `HTTPCookie.cookies(withResponseHeaderFields:for:)` 拆开后，再还原成 `name=value` 数组。

**fetchServerCertificate**：用 `insecure-probe` 模式请求 `HEAD /`，取 `delegate.leaf`。主题用 `SecCertificateCopySubjectSummary`。iOS 拿颁发者和有效期比较麻烦，`issuer`、`notBefore`、`notAfter` 先留空字符串，界面上只显示指纹和主题。

**验证**：放在 T17 的 iOS CI 里编译，T58 和 T59 做实测。

**提交**：`feat(native/ios): URLSession engine with TLS pinning`

### T15. iOS：网络信息

**getNetworkInfo**
- 用 `NWPathMonitor` 取第一次路径更新：
  - `isWifi = path.usesInterfaceType(.wifi)`
  - 网关取 `path.gateways` 里第一个 `.hostPort(.ipv4(addr), _)`
- 用 `getifaddrs` 读 `en0` 的 `AF_INET` 地址和 `ifa_netmask`。
- 整个过程 2 秒超时。

**sendWakeOnLan**：直接 reject `ERR_UNSUPPORTED`。原因见设计 §9.2 的 DV-6：iOS 14 起，发广播需要苹果审批的组播权限。

**提交**：`feat(native/ios): network info via NWPathMonitor`

### T16. JS 包装与测试 mock

**文件**：`modules/routelink-native/index.ts`、`src/api/http/native.ts`、`test/setup.ts`

**`NativeError` 类**：
- 字段：`code: NativeErrorCode`。
- 方法：`isConnectivity()`，在 `TIMEOUT`、`UNREACHABLE`、`DNS`、`NETWORK` 这几种错误时返回 true。

**`nativeHttpClient`**：实现 T18 的 `HttpClient` 接口，把原生模块抛出的异常统一转成 `NativeError`。

**`test/setup.ts`**：用 `jest.mock` mock 掉 `routelink-native`，默认每个函数都抛 "not mocked"，需要的测试自己覆盖。

**提交**：`feat(native): JS wrapper, error type and jest mock`

### T17. iOS CI 初版 + Citadel 技术验证

**文件**：新建 `.github/workflows/ios.yml`（初版：只编译）

```yaml
name: iOS
on:
  push: { branches: ['**'], tags: ['v*'] }
  workflow_dispatch:
jobs:
  build:
    runs-on: macos-26
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx expo prebuild -p ios --no-install && cd ios && pod install
      - run: |
          xcodebuild -workspace ios/RouteLink.xcworkspace -scheme RouteLink -configuration Release \
            -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
            -derivedDataPath build CODE_SIGNING_ALLOWED=NO | tail -n 80
          test -d build/Build/Products/Release-iphonesimulator/RouteLink.app
```

**Citadel 验证**：在 `spike/citadel` 分支上做，不合并进 main。
1. 在 `ios/RouteLinkNative.podspec` 里，用 React Native 提供的 `spm_dependency(s, url: 'https://github.com/orlandos-nl/Citadel.git', requirement: {kind: 'upToNextMinorVersion', minimumVersion: '0.12.1'}, products: ['Citadel'])` 引入 Citadel。
2. 在 Swift 里加一个调用 `SSHClient` 类型的空函数。
3. 推送这个分支，看 iOS 工作流能不能编译通过。

**两种结果**
- **通过**：在计划末尾的"执行记录"里记下接入方式，然后删掉这个分支。
- **不通过**：记下失败原因，改为在 M4 评估两个备选方案：vendoring Citadel 源码；或改用 libssh2 的 xcframework。

**验证**：main 分支上 iOS 工作流是绿的。

**提交**：`ci: iOS simulator build workflow`

---

## 阶段 D：连接层（TDD）

### T18. HttpClient 接口与三种实现

```ts
// src/api/http/types.ts
export interface HttpRequest { url: string; method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; timeoutMs?: number; tls?: TlsOptions }
export interface HttpResponse { status: number; headers: Record<string, string[]>; body: string }
export interface HttpClient { request(req: HttpRequest): Promise<HttpResponse> }
```

**三种实现**
- `native.ts`：转发给原生模块（T16）。
- `node.ts`：给集成测试和脚本用。基于 Node 的 `fetch`，设 `redirect: 'manual'`，`Set-Cookie` 用 `headers.getSetCookie()` 取。不支持 TLS 固定，只用于 HTTP 和受系统信任的 HTTPS。
- `fake.ts`：单元测试用。按 `METHOD url` 和请求体里的 ubus `object.method` 匹配预设的响应，同时记录收到的请求。

**测试**：`fake.ts` 能按顺序返回预设响应，并记录下收到的请求。

**提交**：`feat(api): HttpClient abstraction with native, node and fake clients`

### T19. JSON-RPC 编解码与错误类型

```ts
// src/api/ubus/types.ts
export const NULL_SESSION = '00000000000000000000000000000000';
export interface UbusCall { object: string; method: string; params?: Record<string, unknown> }
export type UbusResult<T = unknown> = { ok: true; data: T } | { ok: false; error: UbusError };
export const callKey = (c: UbusCall) => `${c.object}.${c.method}`;
```

```ts
// src/api/ubus/errors.ts
export type UbusErrorCode =
  | 'INVALID_COMMAND' | 'INVALID_ARGUMENT' | 'METHOD_NOT_FOUND' | 'NOT_FOUND' | 'NO_DATA'
  | 'PERMISSION_DENIED' | 'TIMEOUT' | 'NOT_SUPPORTED' | 'UNKNOWN' | 'CONNECTION_FAILED'
  | 'ACCESS_DENIED' | 'PARSE_ERROR' | 'INVALID_REQUEST' | 'INVALID_PARAMS';
const STATUS: Record<number, UbusErrorCode> = {
  1: 'INVALID_COMMAND', 2: 'INVALID_ARGUMENT', 3: 'METHOD_NOT_FOUND', 4: 'NOT_FOUND', 5: 'NO_DATA',
  6: 'PERMISSION_DENIED', 7: 'TIMEOUT', 8: 'NOT_SUPPORTED', 9: 'UNKNOWN', 10: 'CONNECTION_FAILED',
};
export class UbusError extends Error {
  constructor(readonly code: UbusErrorCode, readonly call?: string, detail?: string) {
    super(`${code}${call ? ` ${call}` : ''}${detail ? `: ${detail}` : ''}`);
    this.name = 'UbusError';
  }
}
export const fromStatus = (s: number, call?: string) => new UbusError(STATUS[s] ?? 'UNKNOWN', call, `status ${s}`);
export function fromRpcError(e: { code: number; message?: string }, call?: string) {
  const map: Record<number, UbusErrorCode> = { [-32700]: 'PARSE_ERROR', [-32600]: 'INVALID_REQUEST',
    [-32601]: 'METHOD_NOT_FOUND', [-32602]: 'INVALID_PARAMS', [-32002]: 'ACCESS_DENIED' };
  return new UbusError(map[e.code] ?? 'UNKNOWN', call, e.message);
}
export class AuthError extends Error {
  constructor(readonly code: 'BAD_CREDENTIALS' | 'NO_ENDPOINT') { super(code); this.name = 'AuthError'; }
}
export class ProtocolError extends Error {   // HTTP status we can't handle / non-JSON body
  constructor(readonly status: number, message: string) { super(message); this.name = 'ProtocolError'; }
}
```

```ts
// src/api/ubus/jsonrpc.ts
export const encodeCall = (id: number, sid: string, c: UbusCall) =>
  ({ jsonrpc: '2.0', id, method: 'call', params: [sid, c.object, c.method, c.params ?? {}] });
export function decodeCallResponse<T>(resp: any, call: string): UbusResult<T> {
  if (resp?.error) return { ok: false, error: fromRpcError(resp.error, call) };
  const r = resp?.result;
  if (!Array.isArray(r) || typeof r[0] !== 'number') return { ok: false, error: new UbusError('UNKNOWN', call, 'malformed') };
  if (r[0] !== 0) return { ok: false, error: fromStatus(r[0], call) };
  return { ok: true, data: (r[1] ?? {}) as T };
}
export function parseJson(body: string): unknown {
  try { return JSON.parse(body); } catch { throw new ProtocolError(200, 'response is not JSON'); }
}
```

**测试**

| 输入 | 预期 |
|---|---|
| `{result:[0,{a:1}]}` | ok，data 为 `{a:1}` |
| `{result:[0]}` | ok，data 为 `{}` |
| `{result:[6]}` | `PERMISSION_DENIED` |
| `{error:{code:-32002,message:'Access denied'}}` | `ACCESS_DENIED` |
| `{foo:1}` | `UNKNOWN` |

另外断言 `encodeCall` 生成的 params 顺序是 `[sid, object, method, args]`。

**提交**：`feat(api): ubus JSON-RPC encoding and error model`

### T20. 登录策略

```ts
// src/api/ubus/login.ts
export type AuthMode = 'ubus' | 'luci';
export interface Credentials { username: string; password: string }
export interface Session { mode: AuthMode; endpoint: string; sid: string; cookie?: string; expiresInSec: number }
export interface LoginTarget { http: HttpClient; baseUrl: string; tls?: TlsOptions }

export async function loginUbus(t: LoginTarget, cred: Credentials): Promise<Session> {
  const endpoint = `${t.baseUrl}/ubus`;
  const res = await t.http.request({ url: endpoint, method: 'POST', tls: t.tls,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(encodeCall(1, NULL_SESSION, { object: 'session', method: 'login',
      params: { username: cred.username, password: cred.password } })) });
  if (res.status === 404) throw new AuthError('NO_ENDPOINT');
  if (res.status !== 200) throw new ProtocolError(res.status, `HTTP ${res.status}`);
  let body: unknown;
  try { body = parseJson(res.body); } catch { throw new AuthError('NO_ENDPOINT'); } // HTML page => no ubus here
  const r = decodeCallResponse<{ ubus_rpc_session: string; expires?: number }>(body, 'session.login');
  if (!r.ok) {
    if (r.error.code === 'PERMISSION_DENIED' || r.error.code === 'ACCESS_DENIED') throw new AuthError('BAD_CREDENTIALS');
    throw r.error;
  }
  return { mode: 'ubus', endpoint, sid: r.data.ubus_rpc_session, expiresInSec: r.data.expires ?? 300 };
}

export async function loginLuci(t: LoginTarget, cred: Credentials): Promise<Session> {
  const res = await t.http.request({ url: `${t.baseUrl}/cgi-bin/luci/`, method: 'POST', tls: t.tls,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `luci_username=${encodeURIComponent(cred.username)}&luci_password=${encodeURIComponent(cred.password)}` });
  if (res.status === 404) throw new AuthError('NO_ENDPOINT');
  const c = findSysauth(res.headers['set-cookie'] ?? []);
  if (c && (res.status === 302 || res.status === 200)) {
    return { mode: 'luci', endpoint: `${t.baseUrl}/cgi-bin/luci/admin/ubus`, sid: c.value,
             cookie: `${c.name}=${c.value}`, expiresInSec: 3600 };
  }
  if (res.status === 403 || res.status === 200) throw new AuthError('BAD_CREDENTIALS');
  throw new ProtocolError(res.status, `HTTP ${res.status}`);
}

export function findSysauth(cookies: string[]): { name: string; value: string } | null {
  for (const line of cookies) {
    const m = /^\s*(sysauth(?:_https?)?)=([^;]*)/.exec(line);
    if (m && m[2] && m[2] !== 'deleted') return { name: m[1], value: m[2] };
  }
  return null;
}

/** Try preferred mode first; fall back only when the endpoint does not exist. */
export async function login(t: LoginTarget, cred: Credentials, preferred?: AuthMode): Promise<Session> {
  const order: AuthMode[] = preferred === 'luci' ? ['luci', 'ubus'] : ['ubus', 'luci'];
  let last: unknown = new AuthError('NO_ENDPOINT');
  for (const mode of order) {
    try { return mode === 'ubus' ? await loginUbus(t, cred) : await loginLuci(t, cred); }
    catch (e) { if (e instanceof AuthError && e.code === 'NO_ENDPOINT') { last = e; continue; } throw e; }
  }
  throw last;
}
```

**测试**（用 FakeHttpClient）
1. `/ubus` 登录成功：返回的 Session 里 `mode` 是 `ubus`，`sid` 正确。
2. `/ubus` 返回 `[6]`：抛 `BAD_CREDENTIALS`，并且**没有**再去请求 LuCI。
3. `/ubus` 返回 404，LuCI 返回 302 并带 `Set-Cookie: sysauth_http=abc; path=/cgi-bin/luci/; HttpOnly`：返回的 Session 里 `mode` 是 `luci`，`cookie` 是 `sysauth_http=abc`，`endpoint` 以 `/admin/ubus` 结尾。
4. `/ubus` 返回的是 HTML，算作没有这个接口，转去走 LuCI。
5. LuCI 返回 403：抛 `BAD_CREDENTIALS`。
6. `preferred='luci'` 时第一个请求发给 LuCI。
7. `findSysauth`：会跳过值为 `deleted` 的 cookie，三种 cookie 名都能识别。

**提交**：`feat(api): ubus and LuCI login strategies`

### T21. 会话管理与批量调用

```ts
// src/api/ubus/session.ts
export interface CallOptions { relogin?: boolean; timeoutMs?: number }

export class UbusSession {
  private session: Session | null = null;
  private inflight: Promise<Session> | null = null;
  private nextId = 1;
  private readonly denied = new Set<string>();

  constructor(private readonly t: LoginTarget, private readonly cred: Credentials,
              private readonly opts: { preferredMode?: AuthMode; onLogin?: (s: Session) => void; timeoutMs?: number } = {}) {}

  get current(): Session | null { return this.session; }

  async call<T>(object: string, method: string, params?: Record<string, unknown>, o: CallOptions = {}): Promise<T> {
    const [r] = await this.batch([{ object, method, params }], o);
    if (!r.ok) throw r.error;
    return r.data as T;
  }

  async batch(calls: UbusCall[], o: CallOptions = {}): Promise<UbusResult[]> {
    const s = this.session ?? (await this.relogin(null));
    const results = await this.send(s, calls, o.timeoutMs);
    if (o.relogin === false) return results;
    const retry = results.flatMap((r, i) =>
      !r.ok && r.error.code === 'ACCESS_DENIED' && !this.denied.has(callKey(calls[i])) ? [i] : []);
    if (retry.length === 0) return this.markDenied(calls, results);
    const fresh = await this.relogin(s);
    const again = await this.send(fresh, retry.map((i) => calls[i]), o.timeoutMs);
    retry.forEach((i, j) => { results[i] = again[j]; });
    return this.markDenied(calls, results);
  }

  /** ACCESS_DENIED that survives a fresh login is an ACL denial, not an expired session. */
  private markDenied(calls: UbusCall[], results: UbusResult[]): UbusResult[] {
    return results.map((r, i) => {
      if (r.ok || r.error.code !== 'ACCESS_DENIED') return r;
      this.denied.add(callKey(calls[i]));
      return { ok: false, error: new UbusError('PERMISSION_DENIED', callKey(calls[i]), 'access denied') };
    });
  }

  private relogin(stale: Session | null): Promise<Session> {
    if (this.session && this.session !== stale) return Promise.resolve(this.session);
    this.inflight ??= login(this.t, this.cred, this.session?.mode ?? this.opts.preferredMode)
      .then((s) => { this.session = s; this.denied.clear(); this.opts.onLogin?.(s); return s; })
      .finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async send(s: Session, calls: UbusCall[], timeoutMs?: number): Promise<UbusResult[]> {
    const ids = calls.map(() => this.nextId++);
    const payload = calls.length === 1 ? encodeCall(ids[0], s.sid, calls[0]) : calls.map((c, i) => encodeCall(ids[i], s.sid, c));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s.cookie) headers.Cookie = s.cookie;
    const res = await this.t.http.request({ url: s.endpoint, method: 'POST', headers, tls: this.t.tls,
      body: JSON.stringify(payload), timeoutMs: timeoutMs ?? this.opts.timeoutMs ?? 10_000 });
    if (res.status === 401 || res.status === 403)
      return calls.map((c) => ({ ok: false, error: new UbusError('ACCESS_DENIED', callKey(c), `HTTP ${res.status}`) }));
    if (res.status !== 200) throw new ProtocolError(res.status, `HTTP ${res.status}`);
    const body = parseJson(res.body);
    const arr = (Array.isArray(body) ? body : [body]) as Array<{ id: number }>;
    const byId = new Map(arr.map((r) => [r.id, r]));
    return calls.map((c, i) => {
      const r = byId.get(ids[i]);
      return r ? decodeCallResponse(r, callKey(c)) : { ok: false, error: new UbusError('UNKNOWN', callKey(c), 'missing response') };
    });
  }
}
```

**测试**
1. 首次调用会先登录一次，再发请求。
2. 会话过期：第一次返回 `-32002`，重新登录后成功。断言：一共登录了 2 次，结果是成功的。
3. 并发：同时发起 5 个调用，全都遇到 `-32002`。断言：只重新登录了一次，5 个都成功。
4. 权限不足：重新登录后仍然是 `-32002`，抛出 `PERMISSION_DENIED`。再调用一次同一个方法，不会再触发重新登录。
5. `relogin:false`：遇到 `-32002` 直接返回 `ACCESS_DENIED`，不重新登录。安全应用的确认步骤要靠这一点（见 T24）。
6. 批量调用：3 个调用打包成一个数组发出；响应顺序打乱后，结果仍然对应正确；其中一个失败不影响另外两个。
7. LuCI 模式下请求头里带 `Cookie`。

**提交**：`feat(api): ubus session with single-flight relogin and batching`

### T22. RouterConnection 与 LiveConnection

```ts
// src/api/connection/types.ts
export interface RouterConnection {
  readonly routerId: string;
  readonly kind: 'live' | 'demo';
  call<T>(object: string, method: string, params?: Record<string, unknown>, o?: CallOptions): Promise<T>;
  batch(calls: UbusCall[], o?: CallOptions): Promise<UbusResult[]>;
  /** Cheap reachability probe without credentials (GET base URL, 1.5s). */
  ping(): Promise<boolean>;
  dispose(): void;
}
export type ConnectionFailure =
  | { kind: 'offline' } | { kind: 'auth' } | { kind: 'tls-untrusted' } | { kind: 'tls-mismatch' }
  | { kind: 'permission'; call: string } | { kind: 'protocol'; status: number } | { kind: 'unknown'; message: string };
export function classifyError(e: unknown): ConnectionFailure { /* NativeError/AuthError/UbusError/ProtocolError → kind */ }
```

**LiveConnection**（`live.ts`）
- 封装一个 `UbusSession`。
- `tls` 从路由器配置里读：有证书指纹时用 `{mode:'pinned', sha256}`，否则用 `{mode:'system'}`。
- `onLogin` 回调里把检测到的登录方式写回路由器配置（T36）。

**测试**：`classifyError` 对每种错误都能给出正确的 kind。

**提交**：`feat(api): RouterConnection interface and LiveConnection`

### T23. 功能检测

```ts
// src/api/capabilities.ts
export type Feature = 'clients.leases' | 'clients.kick' | 'clients.wol.router' | 'wireless' | 'wireless.scan'
  | 'system.cpu' | 'system.temperature' | 'services' | 'logs.system' | 'logs.kernel' | 'neighbors';
export type CapabilityState = { status: 'ok' } | { status: 'missing-package'; packages: string[] } | { status: 'no-permission' };
export type Capabilities = Record<Feature, CapabilityState>;
export async function detectCapabilities(conn: RouterConnection): Promise<Capabilities>;
```

**检测方法**：一次批量调用里同时做以下几件事。
- 用 `session access` 检查每个功能需要的 `object.method` 有没有权限，参数是 `{ scope: 'ubus', object, function }`。
- 用 `file stat` 检查几个程序在不在：`/usr/bin/etherwake`，`/sys/class/thermal/thermal_zone0/temp`。
- 调一次 `luci-rpc getWirelessDevices`，看返回里有没有射频。

**结果怎么判定**
- 程序不存在 → `missing-package`。比如没有 etherwake，提示安装 `etherwake` 和 `luci-app-wol`。
- `session access` 返回 false → `no-permission`。
- 没有射频 → `wireless` 判为 `missing-package`。这种情况界面上会显示"没有无线设备"。

**测试**：用录制下来的样本（T25），再加上手写的几种情况：缺 etherwake、没有射频、某个方法没有权限。断言每个 Feature 的判定结果正确。

**提交**：`feat(api): capability detection`

### T24. uci 辅助函数与安全应用

```ts
// src/api/uci.ts
type Values = Record<string, string | string[]>;
export const uci = {
  get: <T>(c: RouterConnection, config: string, section?: string) =>
    c.call<{ values: T }>('uci', 'get', section ? { config, section } : { config }).then((r) => r.values),
  set: (config: string, section: string, values: Values) => ({ object: 'uci', method: 'set', params: { config, section, values } }),
  add: (config: string, type: string, values: Values, name?: string) => ({ object: 'uci', method: 'add', params: { config, type, values, ...(name ? { name } : {}) } }),
  del: (config: string, section: string) => ({ object: 'uci', method: 'delete', params: { config, section } }),
};
// set/add/del return UbusCall objects so a change set can be staged in ONE batch.

export type ApplyOutcome = { status: 'confirmed' } | { status: 'applied' } | { status: 'rolled-back'; reason: 'confirm-timeout' | 'router-reverted' };

export async function stageAndApply(conn: RouterConnection, changes: UbusCall[],
  o: { mode: 'rollback' | 'direct'; timeoutSec?: number; sleep?: (ms: number) => Promise<void>; now?: () => number }): Promise<ApplyOutcome> {
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const staged = await conn.batch(changes);
  const failed = staged.find((r) => !r.ok);
  if (failed && !failed.ok) {
    await revertConfigs(conn, changes);             // uci revert for every touched config
    throw failed.error;
  }
  if (o.mode === 'direct') { await conn.call('uci', 'apply', { rollback: false }); return { status: 'applied' }; }

  const timeout = o.timeoutSec ?? 90;
  await conn.call('uci', 'apply', { rollback: true, timeout });
  const deadline = now() + (timeout - 10) * 1000;
  await sleep(1500);
  while (now() < deadline) {
    try {
      // MUST reuse the session that called apply: rpcd only accepts confirm from it.
      await conn.call('uci', 'confirm', {}, { relogin: false, timeoutMs: 4000 });
      return { status: 'confirmed' };
    } catch (e) {
      if (e instanceof UbusError && e.code === 'NO_DATA') return { status: 'rolled-back', reason: 'router-reverted' };
      if (isConnectivityError(e) || (e instanceof UbusError && e.code === 'ACCESS_DENIED')) { await sleep(2000); continue; }
      throw e;
    }
  }
  return { status: 'rolled-back', reason: 'confirm-timeout' };
}
```

**需要在 T25 和 T60 里确认的 rpcd 行为**（测试用例按下面的假设先写，确认后再修正）

| 假设 | 内容 |
|---|---|
| A1 | 发起 apply 的会话调用 `uci confirm` 成功 |
| A2 | 没有待确认的回滚时，`uci confirm` 返回状态 5（NO_DATA） |
| A3 | 换一个会话调用 `uci confirm`，返回 PERMISSION_DENIED |
| A4 | 超时后，配置会恢复成 apply 之前的样子 |

**测试**（用假的 connection 加假时钟）
1. 走 `direct` 模式时，只调用一次 `apply {rollback:false}`。
2. 走 `rollback` 模式，`confirm` 第一次就成功，结果是 `confirmed`。
3. `confirm` 前两次抛出 `ERR_UNREACHABLE`，第三次成功，结果是 `confirmed`。
4. `confirm` 返回 `NO_DATA`，结果是 `rolled-back/router-reverted`。
5. 一直连不上直到超时，结果是 `rolled-back/confirm-timeout`。
6. 暂存阶段的批量调用里有一条失败：对涉及的 config 执行 `uci revert`，并抛出那条错误，不再调用 apply。
7. `confirm` 调用时一定带着 `relogin:false`。

**提交**：`feat(api): uci helpers and safe apply with rollback/confirm`

### T25. 本地测试路由器与样本录制

**文件**：`scripts/dev-router.sh`、`scripts/record-fixtures.ts`、`test/fixtures/openwrt-24.10/`

```bash
#!/usr/bin/env bash
# Disposable OpenWrt for local development (no Wi-Fi). Usage: dev-router.sh up|down [version]
set -euo pipefail
V="${2:-24.10.8}"; NAME="routelink-owrt"
case "${1:-}" in
  up)
    MSYS_NO_PATHCONV=1 docker run -d --rm --name "$NAME" -p 127.0.0.1:18080:80 -p 127.0.0.1:18443:443 \
      "openwrt/rootfs:x86-64-v$V" /sbin/init >/dev/null
    for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:18080/ && break; sleep 1; done
    MSYS_NO_PATHCONV=1 docker exec "$NAME" sh -c 'printf "routelink-test\nroutelink-test\n" | passwd root >/dev/null'
    echo "OpenWrt $V ready: http://127.0.0.1:18080 (root / routelink-test)";;
  down) docker rm -f "$NAME" >/dev/null 2>&1 || true;;
  *) echo "usage: $0 up|down [version]"; exit 2;;
esac
```

**录制脚本** `record-fixtures.ts`（用 `npx tsx` 运行）：
- 用 `node.ts` 的 HttpClient 和 `UbusSession` 登录 `ROUTER_URL`。
- 依次调用 M1 用到的每一个接口：
  - `system board/info`
  - `network.interface dump`
  - `luci-rpc getNetworkDevices/getDHCPLeases/getHostHints/getWirelessDevices`
  - `uci get dhcp/firewall/wireless/network`
  - `rc list`、`log read {lines:200, oneshot:true}`
  - `file read /proc/stat`
  - `file exec /bin/dmesg ['-r']`
  - `file exec /sbin/ip ['-4','neigh','show']`
  - `file read /proc/net/arp`
  - `session access` 的几种情况
- 每个调用的结果，不论成功还是失败（失败时记下错误码），都写成 `test/fixtures/<label>/<object>.<method>[.<tag>].json`。

**验证**
1. `scripts/dev-router.sh up`。
2. `ROUTER_URL=http://127.0.0.1:18080 ROUTER_PASSWORD=routelink-test npx tsx scripts/record-fixtures.ts openwrt-24.10`。
3. 检查生成的文件，记下哪些调用失败了，比如读邻居表的两条命令哪个能用，就在 T28 用哪个。
4. 对 T24 里的假设 A1～A4 做一次手动实验：apply 之后不确认，95 秒后读回配置，看是否已恢复。结果写进"执行记录"。

Docker 里没有无线。无线相关的样本先按 iwinfo 的真实输出格式手写，存为 `test/fixtures/handmade/*.json`，到 T60 再换成 QEMU 加 hwsim 录到的真实数据。

**提交**：`test: local OpenWrt dev router and fixture recorder`

---

## 阶段 E：领域服务（TDD，基于样本）

每个服务函数只依赖 `RouterConnection`。测试用 `FixtureConnection`（`test/fixture-connection.ts`）：它按 `object.method` 从样本目录读 JSON，并支持在测试里覆盖个别调用。

### T26. 系统 `services/system.ts`

```ts
export interface SystemSnapshot {
  hostname: string; model: string; boardName: string; firmware: string; kernel: string; target: string;
  uptimeSec: number; localTime: number; load: [number, number, number];  // already divided by 65536
  memory: { total: number; available: number; buffered: number; cached: number };
  storage: { root?: { total: number; used: number }; tmp?: { total: number; used: number } };
}
export async function getSystem(conn: RouterConnection): Promise<SystemSnapshot>;   // board+info in one batch
export async function getCpuTimes(conn: RouterConnection): Promise<{ busy: number; total: number } | null>; // /proc/stat
export function cpuUsage(prev: { busy: number; total: number }, next: { busy: number; total: number }): number; // 0..1
export async function getTemperature(conn: RouterConnection): Promise<number | null>; // °C, max over thermal zones
export async function reboot(conn: RouterConnection): Promise<void>;                  // system reboot
```

**测试**
- 解析 24.10 的样本，各字段的数值正确：`load` 已经除以 65536，`firmware` 取 `release.description`。
- 用两次 `/proc/stat` 读数算 `cpuUsage`，结果正确。
- 没有读权限时 `getCpuTimes` 返回 null。
- 温度值 `48500` 换算成 48.5；读不到时返回 null。

**提交**：`feat(services): system info, CPU, temperature, reboot`

### T27. 网络接口与流量 `services/network.ts`、`services/traffic.ts`

```ts
export interface NetInterface {
  name: string; proto: string; up: boolean; uptimeSec: number; device?: string;
  ipv4: { address: string; mask: number }[]; ipv6: { address: string; mask: number }[];
  gateway?: string; dns: string[]; isWan: boolean;
}
export async function getInterfaces(conn: RouterConnection): Promise<NetInterface[]>;      // network.interface dump
export async function getDeviceCounters(conn: RouterConnection): Promise<Record<string, { rx: number; tx: number }>>;
export function pickWan(ifs: NetInterface[]): NetInterface | undefined; // name 'wan' or the one holding default route
export async function setInterfaceUp(conn: RouterConnection, name: string, up: boolean): Promise<void>;
```

```ts
// services/traffic.ts
export interface RatePoint { t: number; rxBps: number; txBps: number }
export class RateTracker {
  private last?: { t: number; rx: number; tx: number };
  private readonly points: RatePoint[] = [];
  constructor(private readonly capacity = 60) {}
  push(t: number, rx: number, tx: number): RatePoint | null {
    const prev = this.last; this.last = { t, rx, tx };
    if (!prev || t <= prev.t || rx < prev.rx || tx < prev.tx) return null;   // first sample or counter reset
    const dt = (t - prev.t) / 1000;
    const p = { t, rxBps: ((rx - prev.rx) * 8) / dt, txBps: ((tx - prev.tx) * 8) / dt };
    this.points.push(p);
    if (this.points.length > this.capacity) this.points.shift();
    return p;
  }
  get series(): readonly RatePoint[] { return this.points; }
}
```

**测试**
- `getInterfaces` 解析样本：lan 接口和 IPv4 地址正确。
- `pickWan`：优先选名字是 `wan` 的；如果没有，选带默认路由的。
- `RateTracker`：
  - 第一个点返回 null。
  - 2 秒内收到 250000 字节，算出 1 Mbps。
  - 计数器变小时丢弃这个点。
  - 最多保留 60 个点。

**提交**：`feat(services): interfaces, device counters, rate tracker`

### T28. 设备汇总 `services/clients.ts`

```ts
export interface Client {
  mac: string; name: string; hostname?: string; alias?: string; vendor: string | null; randomizedMac: boolean;
  ipv4?: string; ipv6: string[]; online: boolean; onlineSource: 'wifi' | 'neighbor' | 'lease' | 'none';
  connection: 'wifi' | 'wired' | 'unknown';
  wifi?: { ifname: string; ssid: string; band: '2.4G' | '5G' | '6G'; signal: number; rxRate?: number; txRate?: number; connectedSec?: number };
  isStatic: boolean; staticSection?: string; isBlocked: boolean; blockSection?: string; leaseExpiresSec?: number;
}
export interface ClientInputs {
  leases: Array<{ macaddr: string; ipaddr: string; hostname?: string; expires: number }>;
  hints: Record<string, { name?: string; ipaddrs?: string[]; ip6addrs?: string[] }>;
  stations: Array<{ ifname: string; ssid: string; band: '2.4G' | '5G' | '6G'; list: Array<{ mac: string; signal: number; inactive: number; connected_time?: number; rx?: { rate?: number }; tx?: { rate?: number } }> }>;
  dhcpHosts: Record<string, { '.name': string; name?: string; mac?: string | string[]; ip?: string }>;
  firewallRules: Record<string, { '.name': string; name?: string; src_mac?: string | string[]; enabled?: string }>;
  neighbors?: Array<{ ip: string; mac: string; state: string }>;   // from `ip neigh` or /proc/net/arp (T25 decides)
}
export const BLOCK_RULE_PREFIX = 'RouteLink: block ';
export function mergeClients(i: ClientInputs): Client[];                       // pure
export async function getClients(conn: RouterConnection): Promise<Client[]>; // gathers inputs in ONE batch + assoclist per ifname
```

**合并规则**（`mergeClients`）
- 以规范化后的 MAC 为键。数据来源包括：租约、提示信息、无线终端、静态主机、拉黑规则、邻居表。
- **名称**，按以下优先级取第一个有值的：
  1. `dhcp host` 的名字，同时记为 alias
  2. 租约里的主机名（`*` 不算）
  3. 提示信息里的名字
  4. 厂商名
  5. MAC 地址
- **IPv4**，按以下优先级取：租约 → 提示信息 → 邻居表 → 静态主机。
- **在线状态**，按以下顺序判断：
  1. 出现在无线终端列表里：`online=true`，`source='wifi'`。
  2. 否则，邻居表里状态是 REACHABLE、STALE、DELAY 或 PROBE：`source='neighbor'`。
  3. 否则，在没有邻居表数据的前提下，租约未过期：`source='lease'`。
  4. 都不满足：离线。
- **连接方式**：出现在无线终端列表里就是 `wifi`；有租约或邻居表记录就是 `wired`；只有静态绑定的是 `unknown`。
- `isBlocked`：存在名字以 `BLOCK_RULE_PREFIX` 开头的规则，它的 `src_mac` 包含这台设备，并且 `enabled !== '0'`。
- **排序**：在线的排前面；同在线状态的按名称的 `localeCompare` 排序。

**测试**（手写的输入数据）
1. 无线设备：同时出现在租约和无线终端列表里，合并成一条，带上 SSID、频段、信号。
2. 有线设备：邻居表状态是 REACHABLE，判为在线。
3. 绑了静态 IP 的离线设备：`isStatic=true`，`online=false`。
4. 被拉黑的设备：`isBlocked=true`，并带上 `blockSection`。
5. 随机 MAC：`vendor=null`，`randomizedMac=true`。
6. MAC 大小写不同、分隔符不同的两条记录，能合并成一条。
7. 排序符合规则。

**提交**：`feat(services): client aggregation`

### T29. 设备操作 `services/client-actions.ts`

| 函数 | 生成的调用 | 应用方式 |
|---|---|---|
| `renameClient(conn, client, name)` | 已有 `dhcp host`：`uci set` 改 name；没有：`uci add dhcp host {name, mac}` | 安全应用，带回滚 |
| `setStaticIp(conn, client, ip)` | 已有 `dhcp host`：set `ip` 和 `name`；没有：`uci add`。先校验 IP 格式，再检查是否和其他静态 IP 重复 | 安全应用，带回滚 |
| `removeStaticIp(conn, client)` | 删除 `ip` 选项。如果连名字也没有了，就删掉整条 host | 安全应用，带回滚 |
| `kickClient(conn, client, banMinutes = 0)` | `hostapd.<ifname> del_client {addr, reason: 5, deauth: true, ban_time: banMinutes*60000}` | 直接执行 |
| `blockClient(conn, client)` | `uci add firewall rule {name: BLOCK_RULE_PREFIX + mac, src:'lan', dest:'wan', src_mac: mac, proto:'all', target:'REJECT'}` | 安全应用，带回滚 |
| `unblockClient(conn, client)` | `uci delete firewall <blockSection>` | 安全应用，带回滚 |
| `wakeOnLan(conn, mac, caps)` | 路由器装了 etherwake：`file exec /usr/bin/etherwake ['-D','-i','br-lan', mac]`；没装：Android 调用原生 `sendWakeOnLan`，iOS 抛 `ERR_UNSUPPORTED` | — |

"安全应用，带回滚"指调用 `stageAndApply(mode:'rollback')`。

**测试**：断言每个函数生成的 ubus 调用序列，包括参数和顺序，都和表中一致；断言 IP 重复时会拒绝。

**需要实测**：只有 `name` 和 `mac`、没有 IP 的 `dhcp host` 条目，dnsmasq 能不能接受。在 T60 的集成测试里验证：改名之后，`luci-rpc getHostHints` 返回的是新名字。

**提交**：`feat(services): rename, static lease, kick, block, Wake-on-LAN`

### T30. 无线 `services/wireless.ts`

```ts
export interface Radio { name: string; band: '2.4G' | '5G' | '6G'; channel: string; htmode: string; txpower?: number; country?: string;
  disabled: boolean; up: boolean; channels: number[]; networks: WifiNetwork[] }
export interface WifiNetwork { section: string; ifname?: string; ssid: string; encryption: string; key?: string; hidden: boolean;
  disabled: boolean; network: string; mode: string; clients: number }
export async function getRadios(conn: RouterConnection): Promise<Radio[]>;   // luci-rpc getWirelessDevices + uci wireless, one batch
export function radioChanges(r: Radio, patch: Partial<Pick<Radio, 'channel' | 'htmode' | 'txpower' | 'country' | 'disabled'>>): UbusCall[];
export function networkChanges(n: WifiNetwork, patch: Partial<Pick<WifiNetwork, 'ssid' | 'encryption' | 'key' | 'hidden' | 'disabled'>>): UbusCall[];
export function validateNetwork(p: { ssid: string; encryption: string; key?: string }): Array<'ssid-empty' | 'ssid-too-long' | 'key-length' | 'key-required'>;
export async function scan(conn: RouterConnection, ifname: string): Promise<Array<{ ssid: string; bssid: string; channel: number; signal: number; encryption: string }>>;
export function isPhoneOnNetwork(phoneIp: string | null, clients: Client[], ifname?: string): boolean;  // spec §11
```

**加密方式选项**：`none`、`psk2`、`psk-mixed`、`sae`、`sae-mixed`。界面上显示为"开放 / WPA2 / WPA/WPA2 / WPA3 / WPA2/WPA3"。

**校验规则**
- SSID 按 UTF-8 计算，不能超过 32 字节。
- 密码长度 8 到 63 个字符；不加密时可以不填密码。

**测试**
- 用手写的无线样本解析出两个射频（2.4G 和 5G），以及它们各自的网络。
- `networkChanges` 只生成有变化的字段。
- 校验规则的每一条都有对应用例。
- `isPhoneOnNetwork`：手机 IP 通过租约找到 MAC，这个 MAC 正好在该 ifname 的终端列表里，返回 true；否则返回 false。

**提交**：`feat(services): wireless radios, networks, scan`

### T31. 服务与日志 `services/services.ts`、`services/logs.ts`

```ts
export interface Service { name: string; enabled: boolean; running: boolean; start?: number }
export async function listServices(conn: RouterConnection): Promise<Service[]>;      // rc list
export async function serviceAction(conn: RouterConnection, name: string,
  action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable'): Promise<void>; // rc init
export const CRITICAL_SERVICES = ['network', 'firewall', 'dnsmasq', 'uhttpd', 'rpcd', 'dropbear', 'odhcpd'];

export interface LogLine { time?: number; level?: string; source?: string; text: string }
export async function systemLog(conn: RouterConnection, lines = 500): Promise<LogLine[]>;   // log read
export async function kernelLog(conn: RouterConnection): Promise<LogLine[]>;               // file exec /bin/dmesg -r
export function parseDmesg(stdout: string): LogLine[];                                     // "<6>[   12.345] text"
```

**测试**
- 解析 `rc list` 样本，得到服务列表。
- `parseDmesg`：能取出级别和时间；格式不规范的行原样保留为 `text`。
- `systemLog` 返回的结果按时间排序。

**提交**：`feat(services): services and logs`

### T32. 真实路由器兼容性检查（需要你运行）

**文件**：`scripts/router-check.ts`

**脚本做什么**
- 用 T18～T31 的服务层，逐个调用 M1 的每个读取接口，并跑一遍功能检测。
- **只输出脱敏后的摘要**：
  - OpenWrt 版本、型号
  - 每个调用"成功 / 失败（错误码）"
  - 设备数量、射频数量
- 不输出任何名称、IP、MAC。

**怎么运行**：你在终端里自己执行下面的命令。脚本会提示你输入密码，输入的内容不会显示在屏幕上，也不会留在命令历史里。我不会接触到密码。

```bash
npx tsx scripts/router-check.ts http://你的路由器地址
```

我通过读取终端输出看结果，再修正兼容性问题。修正方式：补充分支处理，并录一份脱敏后的差异样本，只保留结构，名称和地址全部替换掉。

**提交**：`chore: redacted router compatibility check script`

---

## 阶段 F：演示模式

### T33. 演示路由器的状态

**文件**：`src/api/connection/demo/state.ts`

**`createDemoState(seed)`**：生成一台确定性的虚构路由器（同一个 seed 结果相同）。
- 型号：`OpenWrt One`，固件 `OpenWrt 24.10.8`，主机名 `RouteLink-Demo`。
- 接口：`wan`（PPPoE，公网 IP 用文档保留段 `203.0.113.45`）、`wan6`、`lan`（`192.168.8.1/24`）、`wg0`。
- 射频：`radio0` 是 2.4G 信道 6，`radio1` 是 5G 信道 36。SSID 分别是 `RouteLink` 和 `RouteLink-5G`，加密方式都是 `sae-mixed`。
- 15 台设备。主机名用中性的英文，比如 `iPhone-16-Pro`、`MacBook-Air`、`Living-Room-TV`、`NAS`、`Pixel-9`、`Nintendo-Switch`、`HP-LaserJet`、`Desk-PC`、`iPad`、`Echo-Dot`、`Front-Camera`、`Kindle`、`Galaxy-S25`、`ThinkPad`、`Sonos-One`。MAC 用真实厂商的 OUI 前缀，后三段随机。
  - 无线 10 台，有线 5 台，其中 2 台离线。
  - 1 台绑了静态 IP，1 台被拉黑。
- 服务约 20 个，系统日志 120 行，内核日志 60 行。
- 流量计数器：`tick(now)` 按随机游走累加。下行均值约 40 Mbps，上行约 6 Mbps，偶尔出现峰值。

**测试**：同一个 seed 生成的状态完全相同；`tick` 之后计数器单调递增。

**提交**：`feat(demo): deterministic demo router state`

### T34. DemoConnection 与契约测试

**文件**：`src/api/connection/demo/{connection,handlers}.ts`、`src/api/connection/demo/contract.test.ts`

**handlers**：为 M1 服务层用到的每一个 `object.method` 写一个处理函数，从 state 里生成和真实路由器格式相同的响应。处理规则：
- `uci set/add/delete`：修改 state 里的 uci 树。
- `uci apply/confirm`：直接成功。
- `hostapd del_client`：把这台设备从无线终端列表里移除。
- `system reboot`：把 state 标记为"重启中"，8 秒内对所有调用返回连接失败，然后自动恢复。
- 没有实现的方法：返回 `METHOD_NOT_FOUND`，并在开发模式下打一条警告。

**契约测试**：
- 把 T26～T31 导出的每一个读取函数，都对 `DemoConnection` 调用一遍，断言不抛错，并且返回非空数据。
- 写操作函数逐个调用后，断言读回来的数据已经变化，比如改名后 `getClients` 拿到的是新名字。
- 以后每加一个服务函数，都要加进这个测试。这样就能保证"演示模式能浏览所有页面"（设计 §26）。

**提交**：`feat(demo): DemoConnection with contract tests`

### T35. 演示用深链接

**文件**：`src/app/demo.tsx`

**链接格式**：`routelink://demo?lang=zh|en&theme=light|dark&route=/overview`

**打开后依次执行**：
1. 开启演示模式（T36 的设置存储）。
2. 按参数设置语言和外观。
3. `router.replace(route)`。`route` 只允许 `/(tabs)` 下的路径，其他路径一律改为 `/overview`。

只有 `scheme=routelink` 的链接才会进入这个页面，所以真实用户点到也没有危害。

**验收**：在模拟器上执行
```bash
adb shell am start -W -a android.intent.action.VIEW -d "routelink://demo?lang=en&theme=dark&route=/devices" io.github.tsix2019.routelink
```
应该直接进入英文、深色的设备页。

**提交**：`feat(demo): screenshot deep link`

---

## 阶段 G：状态、连接管理与发现

### T36. 设置存储与路由器存储

**文件**：`src/state/settings.ts`、`src/state/routers.ts`、`src/state/snapshots.ts`

```ts
// settings (zustand + persist(createJSONStorage(() => kvStorage)))
interface SettingsState {
  language: 'system' | 'zh-CN' | 'en'; theme: 'system' | 'light' | 'dark';
  refreshIntervalSec: 1 | 2 | 5 | 10; reduceTransparency: boolean; demoMode: boolean;
  wolList: Array<{ name: string; mac: string }>;
  set: (p: Partial<Omit<SettingsState, 'set'>>) => void;
}
// routers
export interface RouterProfile {
  id: string; name: string; baseUrl: string; username: string; authMode?: AuthMode;
  tlsSha256?: string; savePassword: boolean; order: number; lastUsedAt?: number; model?: string;
}
interface RoutersState {
  routers: RouterProfile[]; activeId: string | null;
  add(p: Omit<RouterProfile, 'id' | 'order'>, password?: string): Promise<RouterProfile>;
  update(id: string, patch: Partial<RouterProfile>, password?: string | null): Promise<void>;
  remove(id: string): Promise<void>;           // also deletes secret + snapshot
  reorder(ids: string[]): void; setActive(id: string): void;
}
export const passwordKey = (id: string) => `router.${id}.password`;   // expo-secure-store
```

**存储方式**
- 普通数据：`kvStorage` 封装 `expo-sqlite/kv-store`，提供 `getItem`、`setItem`、`removeItem`。
- 密码：存在 `expo-secure-store`，设置 `keychainAccessible: AFTER_FIRST_UNLOCK`，这是为 M4 的后台任务提前准备的。
- 快照：`snapshots.ts` 按路由器保存最后一份概览数据（系统信息、WAN 状态、在线设备数），附带时间戳。

**测试**（mock 掉存储层）
- 添加路由器时密码写进 secure store；`savePassword=false` 时不写。
- 删除路由器时，对应的密码和快照一起删除。
- 重新排序后 `order` 连续。
- `setActive` 会更新 `lastUsedAt`。

**提交**：`feat(state): settings, router profiles, snapshots`

### T37. 连接管理与 React Query

**文件**：`src/api/connection/manager.ts`、`src/features/routers/ActiveRouterProvider.tsx`、`src/hooks/*.ts`

**连接管理** `manager.ts`
- 有一个 `getConnection(profile)` 函数，按路由器 id 缓存 LiveConnection。
- 地址、证书指纹、密码变化时，丢弃旧连接，重新建立。
- 开启演示模式时，返回单例的 DemoConnection。

**Provider**
- `ActiveRouterProvider` 对外提供 `useActiveRouter()` 和 `useConnection()`。
- 当前没有路由器、也没开演示模式时，返回 null。

**QueryClient 配置**
- 用 `focusManager` 配合 `AppState`，App 回到前台时刷新。
- `retry` 规则：遇到 `auth`、`tls-*`、`permission` 类的错误不重试；其他错误最多重试 2 次。
- 缓存键一律是 `[routerId, domain, ...]`。

**hooks**
| hook | 刷新方式 |
|---|---|
| `useSystem` | 页面在焦点时每 5 秒 |
| `useTraffic` | 每 `refreshIntervalSec` 秒；内部维护每台路由器的 `RateTracker`，同时算 CPU 使用率 |
| `useClients` | 每 10 秒 |
| `useInterfaces` | 进入页面时拉一次 |
| `useRadios` | 进入页面时拉一次 |
| `useServices` | 进入页面时拉一次 |
| `useLogs` | 进入页面时拉一次 |
| `useCapabilities` | 每次登录后重新检测 |

- 写操作用 `useRouterMutation(fn, { invalidate: [...] })`，完成后让指定的查询失效。
- `useSystem` 成功后顺手更新快照。

**测试**：用 RNTL 的 `renderHook` 加 DemoConnection，测两件事：
1. `useTraffic` 推进假时钟两次后，返回 1 个速率点。
2. 切换当前路由器之后，缓存键随之变化。

**提交**：`feat: connection manager and query hooks`

### T38. 自动发现引擎

**文件**：`src/discovery/{targets,probe,scan}.ts`

```ts
export interface DiscoveredRouter { address: string; scheme: 'http' | 'https'; hostname?: string; isGateway: boolean; aliases: string[] }
export interface Prober { probe(host: string, signal: AbortSignal): Promise<{ scheme: 'http' | 'https'; title?: string } | null> }

export async function scan(o: {
  targets: string[]; hostnames: string[]; gateway?: string | null; prober: Prober; concurrency?: number;
  signal: AbortSignal; onFound(r: DiscoveredRouter): void; onProgress(done: number, total: number): void;
}): Promise<DiscoveredRouter[]>;
```

**探测器**（`probe.ts` 里的 `nativeProber`，超时都是 1.2 秒，请求不带任何账号信息。实施时调整为 2.5 秒，并接受 403 登录页，见执行记录 T49）
1. `GET http://host/cgi-bin/luci/`：
   - 返回 200，并且页面里有 `luci` 字样（不区分大小写），判定为 OpenWrt。标题按 `<title>(.+?) - LuCI</title>` 提取，括号里就是主机名。
   - 返回 3xx，跳转地址是 https，进入第 3 步。
2. 上一步没认出来时，`POST http://host/ubus`，请求体是 JSON-RPC 的 `list`。只要返回带 `jsonrpc` 字段的 JSON，就判定为 OpenWrt，此时拿不到主机名。
3. 端口 80 被拒绝，或者第 1 步要求跳到 https 时，用 `insecure-probe` 模式请求 `GET https://host/cgi-bin/luci/`，判定规则同第 1 步。
4. 端口 80 超时，说明这台主机多半不存在，直接跳过 443。

**扫描**（`scan`）
- 最多 48 个任务并发（实施时改为先单独探测网关、主机名和 .1/.254，再并发扫其余地址，见执行记录 T49）。
- 网关排在第一位。
- `openwrt.lan`、`openwrt` 这两个主机名也当作探测目标。如果某个主机名的结果和某个 IP 结果的标题主机名相同，就合并成一条：保留 IP 那条，主机名记进 `aliases`。
- 支持用 `AbortSignal` 取消；`onProgress` 每完成一个目标调用一次。

**测试**（用假的 Prober）
- 能找到 2 台。
- 网关排第一。
- 主机名和 IP 能合并。
- 并发数从不超过设定值。
- 取消之后不再回调 `onFound`。
- 进度最终等于目标总数。

**提交**：`feat(discovery): concurrent LAN scan and OpenWrt detection`

### T39. 证书信任流程

**文件**：`src/features/routers/trust.ts`、`src/app/trust-certificate.tsx`

**`ensureTrusted(profile)` 逻辑**
- 连接失败的原因是 `tls-untrusted`：调用 `fetchServerCertificate` 拿证书，打开信任面板，展示指纹和主题。
  - 用户点"信任"：把指纹写进 `profile.tlsSha256`，然后重新连接。
  - 用户点"取消"：不保存。
- 失败原因是 `tls-mismatch`：打开拦截页，并排显示旧指纹和新指纹，说明可能的原因。只有用户点了"信任新证书"才更新指纹。
- 指纹显示时转成大写，每两位一组用冒号隔开。

**测试**
- 两种失败各自走对了分支。
- 用户取消时不保存。
- 指纹显示格式正确。

**提交**：`feat(routers): TOFU certificate trust flow`

---

## 阶段 H：界面基础

所有界面任务的**验收方式**：
1. 用 `npx expo run:android` 或者在 App 里重新加载。
2. 开演示模式，进入对应页面。
3. 截四张图：中文、英文，各配浅色、深色。命令是 `adb exec-out screencap -p > /tmp/<名称>.png`。
4. 用 Read 查看截图，逐条核对验收项。

### T40. 主题与渐变背景

**文件**：`src/ui/theme/tokens.ts`、`src/ui/theme/ThemeProvider.tsx`、`src/ui/GradientBackground.tsx`

**颜色**

| 名称 | 浅色 | 深色 |
|---|---|---|
| `bg` 背景渐变 | `#EAF1FF`、`#F4ECFF`、`#E6FAF3` | `#0A0F1E`、`#171033`、`#06191A` |
| 主文字 | `#0B1220` | `#F2F5FF` |
| 次文字 | 主文字 60% 透明度 | 主文字 60% 透明度 |
| `accent` 强调色 | `#0A84FF` | `#0A84FF` |
| `success` | `#30D158` | `#30D158` |
| `warning` | `#FF9F0A` | `#FF9F0A` |
| `danger` | `#FF453A` | `#FF453A` |
| `glass.fill` 玻璃填充 | `rgba(255,255,255,0.55)` | `rgba(28,30,44,0.55)` |
| `glass.border` 玻璃描边 | `rgba(255,255,255,0.7)` | `rgba(255,255,255,0.12)` |
| `glass.highlight` 玻璃高光 | 渐变，从顶部 `rgba(255,255,255,0.6)` 到 0 | 同左 |

**其他规格**
- 圆角：卡片 24，按钮 16，胶囊 999。
- 间距：4、8、12、16、24、32。
- 字号：largeTitle 34、title 22、headline 17、body 17、subhead 15、footnote 13、caption 12。

**ThemeProvider**：根据设置里的外观选项和系统深浅色算出当前主题，对外提供 `useTheme()`。同时把颜色传给 expo-router 的导航主题。

**GradientBackground**
- 铺满整个页面，用 `expo-linear-gradient` 画一层对角渐变。
- 上面叠 3 个大的半透明彩色圆斑，用 SVG 的 `RadialGradient` 画，位置固定。这样玻璃就有内容可以"透"。

**验收**：浅色和深色截图里，背景渐变柔和，没有色带，圆斑没有生硬的边缘。

**提交**：`feat(ui): theme tokens and gradient background`

### T41. GlassSurface（iOS 和 Android 两个实现）

**文件**：`src/ui/glass/GlassSurface.ios.tsx`、`GlassSurface.android.tsx`、`BlurTarget.tsx`

```ts
export interface GlassSurfaceProps extends ViewProps {
  variant?: 'card' | 'floating' | 'pill';   // floating = sits over scrolling content (tab bar, header, sheet)
  interactive?: boolean;                     // iOS GlassView isInteractive
  tint?: ColorValue;
  radius?: number;
}
```

**iOS 实现**
- `isLiquidGlassAvailable()` 为真时，用 `<GlassView glassEffectStyle="regular" isInteractive={interactive} tintColor={tint} style={[{borderRadius}, style]}>`。
- 不可用时（iOS 26 以下），用 `<BlurView intensity={60} tint="systemMaterial">`。
- 系统开了"降低透明度"（`AccessibilityInfo.isReduceTransparencyEnabled`）时，用不透明的填充色。
- 不能对 GlassView 及其上层视图设置 `opacity: 0`，否则玻璃效果不渲染（设计 §3 引用的已知问题）。需要淡入淡出时，用它自带的 `animate` 属性。

**Android 实现**
- `card` 和 `pill`：
  - 一个 `View`，填 `glass.fill`，描边 `glass.border`（宽度 `StyleSheet.hairlineWidth * 2`）。
  - 顶部叠一层 `LinearGradient` 做高光，加 `elevation: 2` 的阴影。
- `floating`：
  - `BlurView`，参数是 `blurTarget={useBlurTarget()}`、`blurMethod="dimezisBlurView"`、`intensity={40}`。
  - 上面再叠 `card` 的填充和高光层，透明度减半。
- 设置里开了"降低透明度"，或者系统版本低于 Android 12：`floating` 退回成 `card` 的样子。

**BlurTarget.tsx**：提供 `BlurTargetProvider` 组件和 `useBlurTarget()` hook。Provider 用 `BlurTargetView` 把页面内容包起来，再通过 ref 交给 BlurView 作取样来源。

**验收**：Android 上卡片有玻璃质感（半透明、高光、描边），深浅两种模式下文字都清楚。iOS 的效果留到 T59 的 CI 截图里核对。

**提交**：`feat(ui): GlassSurface with native iOS glass and Android emulation`

### T42. 基础组件

**文件**：都在 `src/ui/` 下

| 组件 | 说明 |
|---|---|
| `GlassCard` | 可选标题行（标题、副标题、右侧附加元素），内边距 16 |
| `GlassButton` | 三种风格：`primary`（强调色填充）、`glass`、`destructive`。按下时缩放到 0.97；用 expo-haptics 给出轻触反馈；有 loading 和 disabled 状态 |
| `ListSection`、`ListRow` | iOS 设置页那样的分组列表，放在玻璃卡片里。每行可以有：左侧图标、标题、副标题、右侧值、右侧箭头、右侧开关。分隔线缩进到文字起点 |
| `StatusDot` | 在线、离线、警告、未知四种状态 |
| `Badge` | 小标签，比如"静态""已拉黑""未加密" |
| `TextField` | 玻璃风格输入框，可以带标签、错误提示、密码显示/隐藏、等宽字体 |
| `EmptyState`、`ErrorState` | 图标、标题、说明、操作按钮。`ErrorState` 接收 `ConnectionFailure`，显示对应的文案 |
| `Skeleton` | 用 reanimated 做闪烁效果的占位块 |
| `Banner` | 顶部提示条，分 info、warning、error 三种 |
| `Icon` | iOS 用 `expo-symbols` 的 SF Symbol；Android 用 MaterialCommunityIcons。通过一张对照表 `{ sf: 'wifi', md: 'wifi' }` 统一调用 |

**测试**：`ListRow` 的开关被点击时触发回调；`TextField` 的错误文字能显示出来。

**验收**：做一个只在开发版里出现的 `src/app/dev/gallery.tsx` 页面，把所有组件列出来，截图核对。

**提交**：`feat(ui): base glass components`

### T43. 图表

**文件**：`src/ui/charts/area-path.ts`、`AreaChart.tsx`、`RingGauge.tsx`

```ts
// area-path.ts (pure, tested)
export function areaPath(values: number[], w: number, h: number, max: number): { line: string; area: string } {
  if (values.length < 2 || max <= 0) return { line: '', area: '' };
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - (Math.min(v, max) / max) * h] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return { line, area: `${line}L${w},${h}L0,${h}Z` };
}
export const niceMax = (v: number) => { const p = 10 ** Math.floor(Math.log10(Math.max(v, 1))); return Math.ceil(v / p) * p; };
```

**AreaChart**
- 两条曲线：下行用强调色，上行用青色。曲线下方填渐变，从 0.35 透明度到 0。
- 右上角是图例和当前速率。
- 纵轴最大值取两条曲线最大值的 `niceMax`。

**RingGauge**：圆环进度，中间显示百分比和标签。

**测试**
- `areaPath`：点数小于 2 时返回空；数值超过 max 时按 max 画；路径以 `M` 开头，填充区域以 `Z` 结尾。
- `niceMax(37)` 返回 40，`niceMax(812)` 返回 900。

**提交**：`feat(ui): traffic area chart and ring gauge`

### T44. RiskConfirm

**文件**：`src/ui/RiskConfirm.tsx`、`src/ui/RiskConfirm.test.tsx`

```ts
export interface RiskConfirmProps {
  visible: boolean; level: 'medium' | 'high';
  title: string; consequences: string[];             // bullet list
  confirmLabel: string; confirmPhrase?: string;      // high: user must type this (router name)
  onConfirm(): void; onCancel(): void;
}
```

**两种级别**
- `medium`：底部弹出面板，显示标题、后果列表，以及"取消""确认"两个按钮。确认按钮的颜色：可能断网的操作用警告色，其余用强调色。
- `high`：全屏红色警告页。要勾选"我已了解风险"，并输入正确的 `confirmPhrase`，确认按钮才会变成可用。

```tsx
it('high level requires checkbox and exact phrase', () => {
  const onConfirm = jest.fn();
  render(<RiskConfirm visible level="high" title="t" consequences={['a']} confirmLabel="Go"
                      confirmPhrase="OpenWrt" onConfirm={onConfirm} onCancel={jest.fn()} />);
  const go = screen.getByRole('button', { name: 'Go' });
  expect(go).toBeDisabled();
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.changeText(screen.getByTestId('risk-confirm-phrase'), 'openwrt');
  expect(go).toBeDisabled();                     // case-sensitive
  fireEvent.changeText(screen.getByTestId('risk-confirm-phrase'), 'OpenWrt');
  expect(go).toBeEnabled();
  fireEvent.press(go);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
it('medium level confirms directly', () => { /* press Go → onConfirm */ });
```

**提交**：`feat(ui): RiskConfirm with tested high-risk gating`

---

## 阶段 I：导航骨架

### T45. 根布局与路由表

**路由文件**

```
src/app/_layout.tsx           Providers + root <Stack>
src/app/index.tsx             <Redirect> → /(tabs)/overview if routers or demo, else /welcome
src/app/welcome.tsx
src/app/add-router.tsx        presentation: 'modal'
src/app/router-switcher.tsx   presentation: 'formSheet', sheetAllowedDetents: [0.5, 1], sheetGrabberVisible
src/app/trust-certificate.tsx presentation: 'modal'
src/app/device/[mac].tsx      presentation: 'formSheet', detents [0.6, 1]
src/app/reboot.tsx            presentation: 'fullScreenModal'
src/app/demo.tsx              (T35)
src/app/__selftest.tsx        (T58)
src/app/(tabs)/_layout.tsx    <AppTabs />
src/app/(tabs)/{overview,devices,wireless,network,more}/_layout.tsx  each a <Stack> (large title on iOS)
src/app/(tabs)/.../index.tsx  + sub-pages (wireless/radio/[name], wireless/network/[section], wireless/scan,
                               network/[iface], more/services, more/logs, more/wol, more/settings/*, more/routers)
```

**Provider 的嵌套顺序**：`GestureHandlerRootView` → `SafeAreaProvider` → `ThemeProvider` → `I18nextProvider` → `QueryClientProvider` → `ActiveRouterProvider` → `Stack`

**启动流程**：先读取持久化的设置并完成多语言初始化，然后才隐藏启动图。

**验收**：冷启动时：
- 没有添加过路由器，进入欢迎页。
- 开着演示模式，直接进入概览。

**提交**：`feat(app): root layout, providers and route map`

### T46. Tab 栏：iOS 原生 / Android 玻璃

**iOS 版**（`src/components/app-tabs.tsx`）

```tsx
import { NativeTabs } from 'expo-router/unstable-native-tabs';   // SDK 58 renames to 'expo-router/native-tabs' — only this file changes
export default function AppTabs() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={colors.accent}>
      <NativeTabs.Trigger name="overview">
        <NativeTabs.Trigger.Label>{t('tabs.overview')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gauge.with.dots.needle.33percent', selected: 'gauge.with.dots.needle.67percent' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="devices">
        <NativeTabs.Trigger.Label>{t('tabs.devices')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="laptopcomputer.and.iphone" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wireless">
        <NativeTabs.Trigger.Label>{t('tabs.wireless')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="wifi" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="network">
        <NativeTabs.Trigger.Label>{t('tabs.network')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="network" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>{t('tabs.more')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

**Android 版**（`src/components/app-tabs.android.tsx`）

```tsx
import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';
export default function AppTabs() {
  return (
    <BlurTargetProvider style={{ flex: 1 }}>
      <Tabs>
        <TabSlot />
        <TabList asChild>
          <GlassTabBar>
            {TABS.map((tab) => (
              <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
                <GlassTabButton icon={tab.icon} label={tab.labelKey} />
              </TabTrigger>
            ))}
          </GlassTabBar>
        </TabList>
      </Tabs>
    </BlurTargetProvider>
  );
}
```

`TabSlot` 必须放在 `BlurTargetView` 里面，`GlassTabBar` 必须在它外面，否则模糊会把 Tab 栏自己也采进去。如果实际摆放时 `TabList` 不能脱离 `Tabs` 的布局，就把 `BlurTargetView` 只包在 `TabSlot` 外面，`TabList` 用绝对定位浮在底部。

**GlassTabBar**
- 外形：悬浮胶囊，距底部 `insets.bottom + 8`，左右各留 16，高 64，使用 `GlassSurface variant="floating"`。
- 选中指示：一颗玻璃"水滴"，用 `GlassSurface variant="pill"`。通过 `onLayout` 记下每个按钮的位置，切换时用 reanimated 的 `withSpring` 把水滴滑到新位置。
- 图标：选中时用实心，未选中时用描边。
- 文字：字号 11。

**每个 Tab 的 Stack**
- iOS：`headerLargeTitle: true`、`headerTransparent: true`、`headerLargeTitleShadowVisible: false`，iOS 26 会自动变成玻璃效果；`headerLeft` 放 `RouterSwitcherCapsule`。
- Android：用自己写的 `GlassHeader`，包含标题、左侧胶囊、右侧操作区。页面滚动超过 8 像素后，背景切换成 `floating` 玻璃。

**验收**（Android 截图）
- Tab 栏悬浮，能看出模糊效果。
- 点击切换 Tab 时，水滴有滑动动画。可以录两张截图，或者用 `adb shell screenrecord` 录屏抽帧检查。
- 深浅两种模式下都清晰可读。
- 页面内容滚动到 Tab 栏下面时，能透过玻璃看到模糊的内容。

**提交**：`feat(app): native iOS tabs and Android glass tab bar`

### T47. 路由器切换

**文件**：`src/features/routers/RouterSwitcherCapsule.tsx`、`src/app/router-switcher.tsx`

**胶囊**
- 外观：`GlassSurface variant="pill"`，内容依次是 `StatusDot`、路由器名称（最多 14 个字，超出显示省略号）、`chevron.down` 图标。
- 状态点：根据当前路由器最近一次查询结果显示。演示模式下名字是"演示路由器"，状态点固定为绿色。

**切换面板**
- 每台路由器显示一行：名称、地址、型号（取自快照）、在线状态。用 HTTP 的 `GET` 未登录探测地址可达性，超时 1.5 秒，所有路由器同时探测。
- 当前路由器打勾。点其他路由器：调用 `setActive`，关闭面板，页面立刻显示该路由器的缓存快照。
- 底部两个按钮："添加路由器"和"管理"（跳到更多 → 管理路由器）。

**验收**：添加两台路由器（演示 + Docker），来回切换，确认页面立即显示对应的数据。

**提交**：`feat(routers): router switcher capsule and sheet`

---

## 阶段 J：页面

每个页面在数据加载中显示 `Skeleton`，出错时显示 `ErrorState`。功能检测没通过的入口要置灰，并写明原因。所有文字都走 `t()`，中英文同时补上。

### T48. 欢迎页

**内容**：渐变背景；App 图标；标题"RouteLink"；一句介绍，中文是"管理你的 OpenWrt 路由器"，英文是 "Manage your OpenWrt routers"；两个按钮，"添加路由器"和"先体验演示模式"；底部一行小字说明隐私原则："不收集任何数据，所有连接都只在你和路由器之间"。

**验收**：中英文、深浅色四张截图。

**提交**：`feat(onboarding): welcome screen`

### T49. 添加路由器（含自动发现）

**文件**：`src/app/add-router.tsx`、`src/features/routers/{DiscoveryList,RouterForm,useDiscovery}.tsx`

**自动发现**
- 打开页面就调用 `getNetworkInfo`。
  - 不在 Wi-Fi 上：显示提示"请先连接路由器的 Wi-Fi"，并提供"重试"按钮。
  - 在 Wi-Fi 上：用 `scanTargets` 算出要扫的地址，开始扫描。
- 页面上方是进度条，找到一台就往列表里加一台。
- 每条结果显示：主机名（拿不到时显示 IP）、IP、HTTP/HTTPS 标签、网关标签、"已添加"标签（已添加的不能再选）。
- 列表左侧有勾选框，可以多选。
- 网关不是 OpenWrt、但扫到了别的 OpenWrt 设备时，显示提示"你可能在用旁路由"。
- 什么都没找到时，显示排查提示，并提供"重新扫描"按钮。
- 高级选项"扫描指定网段"：输入 CIDR，最大 /22，用 `cidrHosts` 校验，然后用它替代自动算出的目标。

**手动输入**：用 `RouterForm`。
- 字段：地址（允许省略协议，默认补上 `http://`）、名称（默认取主机名）、用户名（默认 `root`）、密码、"保存密码"开关（默认开）。

**提交流程**
1. 选中了多台时，先问"这几台的密码一样吗？"
   - 一样：只输一次。
   - 不一样：逐台输入。
2. 逐台尝试登录。
   - 遇到 `tls-untrusted`：走 T39 的证书信任流程。
   - 遇到 `auth`：在这台旁边显示"密码错误"，让用户改。
3. 全部成功后保存。第一台设为当前路由器，然后跳到概览。
4. HTTP 连接的路由器保存后显示"未加密"标签。

**测试**：`useDiscovery` 用假探测器测三件事：开始扫描、取消扫描、合并结果。

**验收**
1. 手动填 `http://10.0.2.2:18080` 添加 Docker 路由器，用户名 `root`，密码 `routelink-test`。登录成功，进入概览。
2. 在模拟器里用"扫描指定网段"填你局域网的网段（比如 `192.168.1.0/24`），能找到你的路由器。模拟器的请求会经过电脑转发到局域网。这一步只做到发现，不登录。

**提交**：`feat(routers): add-router with auto-discovery and multi-select`

### T50. 概览

**文件**：`src/app/(tabs)/overview/index.tsx`、`src/features/overview/*`

**从上到下的卡片**

| 卡片 | 内容 |
|---|---|
| `SystemCard` | 型号、固件、内核、主机名、运行时间、路由器本地时间 |
| `ResourcesCard` | CPU 圆环（读不到使用率时改为显示负载）、内存圆环、根分区占用条、温度（读不到就隐藏） |
| `WanCard` | 状态点、协议、IPv4、IPv6、DNS、在线时长 |
| `TrafficCard` | 实时流量 `AreaChart`，下方显示当前上下行速率；右上角显示刷新间隔 |
| `DevicesCard` | 在线设备总数，分有线和无线各多少，点击跳到设备页 |
| `QuickActions` | M1 只有"重启"一个按钮 |

**重启流程**
1. 点"重启"，弹出 `RiskConfirm`（中风险），后果写"所有设备会断网 1 到 2 分钟"。
2. 确认后进入 `/reboot` 页面：
   - 显示倒计时和状态文字。
   - 每 3 秒用 `ping()` 检测一次，最多等 5 分钟。
   - 检测到路由器恢复后提示"已恢复"，自动返回。
   - 超时后给出排查建议。

**其他**
- 支持下拉刷新。
- 离线时页面上方显示 Banner，卡片继续显示快照数据，并标注更新时间。

**验收**
- 用演示模式截图，四张，各卡片都有数据，流量曲线在变化。
- 连 Docker 路由器截一张，数据正确，温度卡片隐藏。

**提交**：`feat(overview): dashboard with live traffic and reboot`

### T51. 设备列表

**文件**：`src/app/(tabs)/devices/index.tsx`、`src/features/devices/*`

**搜索和筛选**
- 搜索：iOS 用原生的 `headerSearchBarOptions`；Android 在 `GlassHeader` 下面放一个 `TextField`。可以按名称、IP、MAC、厂商搜索。
- 筛选：两组分段控件。一组是"全部 / 在线 / 离线"，另一组是"全部 / 无线 / 有线"。

**每行显示**
- 左侧是设备类型图标，按厂商或主机名里的关键字粗略判断：手机、电脑、电视、打印机、其他。
- 名称；副标题是 IP 加厂商。随机 MAC 的设备，厂商位置显示"私有地址"。
- 右侧是信号格（无线设备才有）和状态点，以及"静态""已拉黑"标签。
- 列表上方显示统计，比如"在线 12 / 共 15"。

**验收**：在演示模式下，各种筛选组合、搜索、空结果的页面都截图核对。

**提交**：`feat(devices): searchable, filterable device list`

### T52. 设备详情面板

**文件**：`src/app/device/[mac].tsx`

**信息区**：IP、MAC、厂商、主机名、连接方式（SSID、频段、信号、收发速率、连接时长）、租约剩余时间。IP 和 MAC 点一下就复制。

**操作区**

| 操作 | 交互 |
|---|---|
| 改名 | 弹出输入框，保存后走 T29 的改名流程（安全应用） |
| 静态 IP | 打开表单，默认填当前 IP。保存前校验格式和重复 |
| 踢下线 | 只有无线设备有这个按钮。弹出中风险确认，带一个"5 分钟内禁止重连"开关 |
| 拉黑 / 解除拉黑 | 弹出中风险确认，后果写"这台设备将无法上网" |
| 网络唤醒 | 有线设备或离线设备才显示。旁边有"加入唤醒列表"按钮 |

**安全应用的结果怎么提示**
- 应用中：按钮显示 loading。
- `confirmed` 或 `applied`：提示"已应用"。
- `rolled-back`：弹出提示"配置已自动恢复"，并说明原因。

**验收**：在演示模式和 Docker 路由器上，分别把改名、静态 IP、拉黑、解除拉黑走一遍。在 Docker 上，用 `uci show dhcp` 和 `uci show firewall` 确认配置确实写进去了。

**提交**：`feat(devices): device detail sheet with actions`

### T53. 无线

**文件**：`src/app/(tabs)/wireless/*`

**首页**：每个射频一张卡片。
- 卡片上显示：频段、信道、频宽、功率、开关。
- 卡片下列出这个射频的 SSID，每个显示名称、加密方式、是否隐藏、终端数。

**射频编辑页**（`radio/[name]`）：
- 可改：信道（自动，或从支持的信道列表里选）、频宽（HT20/HT40/VHT80/HE80 等，按射频的能力过滤）、功率、国家码。
- 保存前弹中风险确认，然后走带回滚的安全应用。

**SSID 编辑页**（`network/[section]`）：
- 可改：SSID、加密方式、密码（带显示/隐藏）、隐藏、启用。
- 保存时先用 `isPhoneOnNetwork` 判断手机是不是连着这个 SSID。
  - **是**：确认文案写"手机会断开，请用新密码重新连接"，然后走 `direct` 模式应用。应用后跳到一个说明页，告诉用户新的 SSID 和密码，以及重新连接的步骤。
  - **否**：走带回滚的安全应用。

**扫描周边**（`scan`）：按信号强弱排序，每行显示 SSID（隐藏网络显示"隐藏网络"）、BSSID、信道、信号、加密方式。

**特殊情况**：设备没有射频时，整个 Tab 显示 `EmptyState`，文案是"这台路由器没有无线设备"。

**验收**
- 在演示模式下改 SSID 和信道，两种应用路径都走一遍。
- Docker 路由器没有射频，确认显示的是 `EmptyState`。
- 真实射频的数据在 T64 联调时核对。

**提交**：`feat(wireless): radios, SSIDs, scan`

### T54. 网络

**文件**：`src/app/(tabs)/network/*`

**接口列表**：每个接口显示名称、协议、设备名、状态点、IPv4、在线时长、累计收发字节数。

**接口详情**（`[iface]`）：显示全部地址、网关、DNS、设备名、流量。底部有"重连"按钮：先弹中风险确认，说明"连接会短暂中断"，然后执行 `setInterfaceUp`，先断开再连上。

**M1 范围**：其他分组（安全、服务、统计、诊断）都是后面的里程碑，M1 先不显示。

**验收**：在演示模式和 Docker 路由器上各截图。

**提交**：`feat(network): interfaces and reconnect`

### T55. 更多：路由器相关

**文件**：`src/app/(tabs)/more/{index,services,logs,wol}.tsx`

**首页**：分组列表，分"路由器"和"App"两组。

**服务管理**
- 列表上显示：运行中 / 已停止、开机自启标签。
- 点一行，弹出操作面板：启动、停止、重启、启用开机自启、禁用开机自启。
- 对 `CRITICAL_SERVICES` 里的服务执行停止、重启或禁用时，确认文案里加一句："可能导致 App 与路由器断开"。

**日志**
- 顶部分段切换：系统日志 / 内核日志。
- 支持关键字筛选，内容用等宽字体，打开时自动滚到底部。
- 可以刷新，也可以分享（用 RN 的 `Share.share`）。

**网络唤醒列表**
- 列出已保存的设备，每个都有"唤醒"按钮。
- 可以手动添加，填名称和 MAC。

**重启**：入口和概览页的重启是同一个流程（T50）。

**验收**：在演示模式和 Docker 路由器上截图。在 Docker 上停掉 `cron` 服务再启动，确认状态变化正确。

**提交**：`feat(more): services, logs, Wake-on-LAN list`

### T56. 更多：App 设置

**文件**：`src/app/(tabs)/more/settings/*`、`src/app/(tabs)/more/routers.tsx`

**管理路由器**
- 列表支持拖动排序。优先用 `react-native-reorderable-list`，先确认它兼容 Reanimated 4.5；不兼容就改成编辑模式下的上移、下移按钮，并在"执行记录"里写明。
- 每台路由器可以编辑：用 `RouterForm` 打开，密码字段为空表示不修改。
- 可以删除：弹出中风险确认。
- 底部有"添加"按钮。

**其他设置项**

| 设置 | 选项 |
|---|---|
| 语言 | 跟随系统 / 中文 / English，切换后立即生效 |
| 外观 | 跟随系统 / 浅色 / 深色 |
| 刷新间隔 | 1、2、5、10 秒 |
| 降低透明度 | 只在 Android 上显示；iOS 跟随系统设置 |
| 演示模式 | 开关 |
| 关于 | 版本号、GitHub 链接（用 `expo-web-browser` 打开）、隐私说明 |

**验收**：切换语言后，Tab 栏标签和页面文字立即变化。这一项在 iOS 上要靠 T59 的截图确认，`NativeTabs` 的标签会随之刷新。

**提交**：`feat(settings): router management and app settings`

### T57. 全局错误处理与离线提示

**每个路由的错误边界**：导出 `ErrorBoundary`（expo-router 支持），出错时显示 `ErrorState` 加"重试"按钮。

**离线提示**：`ConnectionStatusBanner` 从当前路由器的查询错误里汇总出连接状态。
- `offline`：显示"无法连接 X"，并标注上次更新时间。
- `auth`：显示"需要重新登录"，点一下弹出重新输入密码的面板，提交时调用 `routers.update(id, {}, password)`。
- `tls-mismatch`：直接跳到拦截页。

**测试**：`ConnectionStatusBanner` 对每种失败类型都显示正确的文案和操作。

**验收**：
1. 停掉 Docker 路由器：出现离线提示条，页面还在显示快照。
2. 重新启动 Docker 路由器：提示条自动消失。
3. 在路由器上把密码改掉：出现重新登录提示。

**提交**：`feat: error boundaries, offline and re-login banners`

---

## 阶段 K：CI、集成测试与截图

### T58. 自测页（给 iOS CI 用）

**文件**：`src/app/__selftest.tsx`

**启用条件**：只有在构建时设置了 `EXPO_PUBLIC_SELFTEST=1` 才可用，否则重定向到首页。

**输入**：从深链接参数读取 `http`、`https`、`fp`、`report`。

**检查项**

| 名称 | 检查内容 |
|---|---|
| `http-get` | HTTP 请求返回 200 |
| `https-system-untrusted` | 用 `system` 模式访问自签名 HTTPS，得到 `ERR_TLS_UNTRUSTED` |
| `cert-fetch` | `fetchServerCertificate` 返回的 sha256 等于 `fp` |
| `https-pinned-ok` | 用 `pinned` 模式、正确的指纹，返回 200 |
| `https-pinned-mismatch` | 用 `pinned` 模式、错误的指纹，得到 `ERR_TLS_PIN_MISMATCH` |
| `no-redirect` | 服务器返回 302 时，App 拿到的状态码就是 302 |
| `no-cookie-jar` | 第一个请求带回 `Set-Cookie`，第二个请求没有自动带 `Cookie` |
| `netinfo-shape` | `getNetworkInfo` 返回的字段齐全 |
| `wol-unsupported` | 仅 iOS：`sendWakeOnLan` 被拒绝，错误码是 `ERR_UNSUPPORTED` |

**输出**：页面上显示每项的 PASS / FAIL。同时把结果 `POST` 给 `report` 地址，格式是 `{ passed, results: [...] }`。

**提交**：`feat: native self-test screen for CI`

### T59. ios.yml 完整版：自测与截图

**新建 `scripts/ci/selftest-servers.py`**，在 CI 机器上启动三个本地服务：
- `127.0.0.1:8098`：HTTP 服务。`/redirect` 返回 302，`/cookie` 返回 `Set-Cookie`，`/echo-cookie` 把收到的 `Cookie` 请求头原样返回。
- `127.0.0.1:8443`：用临时生成的自签名证书提供 HTTPS 服务。
- `127.0.0.1:8099`：接收 `/report`，收到的内容写入 `selftest-report.json`。

**新建 `scripts/ci/ios-selftest.sh`**，依次执行：
1. 启动模拟器：`xcrun simctl boot "iPhone 17 Pro"`。如果 runner 上没有这个机型，就从 `xcrun simctl list devices available -j` 里选第一台 iOS 26 的 iPhone。
2. 安装 App：`xcrun simctl install`。
3. 算出证书指纹：`openssl x509 -in cert.pem -outform der | shasum -a 256`。
4. 打开深链接：`xcrun simctl openurl booted "routelink://__selftest?http=...&https=...&fp=...&report=..."`。
5. 等待报告，最多 120 秒，然后用 `jq -e '.passed == true'` 检查。

**新建 `scripts/ci/ios-screenshots.sh`**
1. 覆盖状态栏，让截图更干净：`xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3`。
2. 对每种组合截图：语言 `zh`、`en` × 外观 `light`、`dark` × 页面 `overview`、`devices`、`device`、`wireless`、`network`、`more`。
3. 每张图的步骤：
   - `xcrun simctl ui booted appearance <light|dark>`
   - `xcrun simctl openurl booted "routelink://demo?lang=..&theme=..&route=.."`
   - 等 4 秒
   - `xcrun simctl io booted screenshot docs/screenshots/<lang>/ios-<page>-<theme>.png`

**修改 `ios.yml`**
- 构建步骤加环境变量 `EXPO_PUBLIC_SELFTEST=1`。
- 编译完后依次跑自测和截图。
- 用 `actions/upload-artifact@v7` 把截图打包上传，名字是 `ios-screenshots`。
- 打 `v*` 标签时另起一个 job：去掉 `EXPO_PUBLIC_SELFTEST` 重新构建，执行 `xcodebuild archive -sdk iphoneos CODE_SIGNING_ALLOWED=NO`，把 `Payload/RouteLink.app` 压成 `RouteLink-unsigned.ipa`，用 `gh release upload` 发布。M1 结束时会用到（T66）。

**验收**
- CI 是绿的。
- 下载截图：`gh run download <id> -n ios-screenshots -D /tmp/ios-shots`。用 Read 查看，确认三件事：
  - 原生玻璃 Tab 栏是悬浮胶囊的样子。
  - 大标题导航栏没问题。
  - 卡片是 GlassView 的效果。

**提交**：`ci(ios): native self-test and demo screenshots`

### T60. QEMU 集成测试与 integration.yml

**新建 `scripts/ci/qemu-openwrt.sh <版本>`**（只在 Linux 上运行），依次执行：

1. **下载镜像**：从下面的地址下载，并用 `actions/cache` 缓存。
   ```
   https://downloads.openwrt.org/releases/$V/targets/x86/64/openwrt-$V-x86-64-generic-squashfs-combined.img.gz
   ```
   用 `gunzip -c` 解压。OpenWrt 镜像末尾有多余数据，gunzip 会警告并返回码 2，这是正常的，忽略即可。
2. **启动虚拟机**：
   ```bash
   qemu-system-x86_64 -enable-kvm -cpu host -m 512 -smp 2 -display none -daemonize \
     -drive file=owrt.img,format=raw,if=virtio \
     -netdev user,id=lan,net=192.168.1.0/24,host=192.168.1.2,hostfwd=tcp:127.0.0.1:18080-192.168.1.1:80,hostfwd=tcp:127.0.0.1:18443-192.168.1.1:443,hostfwd=tcp:127.0.0.1:18022-192.168.1.1:22 \
     -device virtio-net-pci,netdev=lan -netdev user,id=wan -device virtio-net-pci,netdev=wan \
     -serial file:serial.log
   ```
3. **等待启动**：轮询 `curl http://127.0.0.1:18080/`，最多 120 秒。
4. **初始化**：新装的 OpenWrt 没有 root 密码，可以直接 SSH 登录。通过 `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 18022 root@127.0.0.1` 执行以下操作。如果 dropbear 不允许空密码登录，就改用串口：把 `-serial` 改成 `unix:serial.sock,server,nowait`，再用 `socat` 往串口写命令。
   - 安装软件包：`opkg update && opkg install kmod-mac80211-hwsim wpad-basic-mbedtls luci-app-wol`。25.12 版本改用 `apk update && apk add ...`。
   - 生成无线配置：`wifi config`。
   - 启用两个射频，并把 radio1 的 SSID 设为 `RouteLink-5G`。
   - 执行 `uci commit wireless; wifi up`。
   - 设置 root 密码为 `routelink-test`。

**新建集成测试** `test/integration/*.int.test.ts`：通过环境变量 `ROUTER_URL`、`ROUTER_PASSWORD` 指定路由器，用 `node.ts` 的 HttpClient。

| 测试文件 | 内容 |
|---|---|
| `login.int` | ubus 登录；密码错误时报 `BAD_CREDENTIALS`；调用 `session destroy` 让会话失效后，下一次调用会自动重新登录；在 uhttpd 配置里去掉 ubus 前缀并重启 uhttpd 后，能回退到 LuCI 登录，测完再恢复 |
| `system.int` | `getSystem`、`getCpuTimes`、`getInterfaces`、`getDeviceCounters` |
| `wireless.int` | 能读到两个 hwsim 射频；改信道后读回来的值一致；`scan` 能返回结果。没有射频时跳过 |
| `clients.int` | 改名、绑定静态 IP、拉黑、解除拉黑后，读回来的数据一致；`getHostHints` 能反映出新名字；`etherwake` 能正常执行（返回码为 0） |
| `apply.int` | 验证 T24 的假设 A1～A4：先确认的情况下，配置保留；不确认的情况下，等 95 秒配置恢复；换一个会话去确认，被拒绝 |
| `services.int` | 停止 `cron` 再启动，状态正确；`systemLog`、`kernelLog` 不为空 |

**录制样本**：设置 `RECORD_FIXTURES=1` 时，额外运行 `record-fixtures.ts`，结果作为构建产物上传。

**新建 `.github/workflows/integration.yml`**
- 用 matrix 跑三个版本：`23.05.6`、`24.10.8`、`25.12.5`。
- 开启 KVM：
  ```bash
  echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666"' | sudo tee /etc/udev/rules.d/99-kvm.rules
  sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm
  ```
- 安装 `qemu-system-x86`，启动虚拟机，然后执行 `npm run test:int`。
- 失败时把 `serial.log` 作为产物上传，方便排查。

**本地运行**：可以先对 Docker 路由器跑一遍（无线相关的测试会自动跳过）：
```bash
ROUTER_URL=http://127.0.0.1:18080 ROUTER_PASSWORD=routelink-test npm run test:int
```

**收尾**
- 下载三个版本录制的样本，换掉 T25 里手写的无线样本。
- 让单元测试同时覆盖 23.05、24.10、25.12 三个版本的样本。
- 把 rpcd 行为的验证结果写进"执行记录"。

**提交**：`test(ci): QEMU OpenWrt integration tests on 3 versions`

### T61. android.yml 与发布签名

**新建 `plugins/with-release-signing.js`**：一个 config plugin，用 `withAppBuildGradle` 修改 `android/app/build.gradle`：
- 加一个 `signingConfigs.release`，从环境变量 `RL_KEYSTORE_FILE`、`RL_KEYSTORE_PASSWORD`、`RL_KEY_ALIAS`、`RL_KEY_PASSWORD` 读取签名信息。
- `buildTypes.release.signingConfig` 改成：环境变量齐全时用 `release`，否则用 `debug`。
- 写完后去 `app.config.ts`，把 T3 里注释掉的那行插件配置恢复。

**生成签名密钥**（在本机执行，不进仓库）：
```bash
mkdir -p /d/RouteLink-keys
PASS="$(openssl rand -base64 24)"
keytool -genkeypair -v -keystore /d/RouteLink-keys/routelink-release.jks -alias routelink \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=RouteLink, O=tsix2019" -storepass "$PASS" -keypass "$PASS"
printf 'storePassword=%s\nkeyAlias=routelink\n' "$PASS" > /d/RouteLink-keys/keystore.properties
base64 -w0 /d/RouteLink-keys/routelink-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
printf '%s' "$PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD
printf 'routelink' | gh secret set ANDROID_KEY_ALIAS
```
注意：密码不要在聊天里显示。最后向你说明这个密钥文件很重要，需要你自己另外备份一份。

**新建 `.github/workflows/android.yml`**，依次执行：
1. 准备环境：`actions/setup-java@v6`（JDK 17）和 `setup-node`。
2. `npm ci`。
3. `npx expo prebuild -p android --no-install`。
4. 把 Secrets 里的 base64 解码成 `$RUNNER_TEMP/release.jks`，并设置好 `RL_*` 环境变量。
5. `cd android && ./gradlew assembleRelease --no-daemon`。
6. 把 APK 作为产物上传，名字是 `RouteLink-<短 sha>.apk`。
7. 打 `v*` 标签时，执行 `gh release upload "$GITHUB_REF_NAME" RouteLink-$TAG.apk --clobber`。release 不存在时，先用 `gh release create` 创建（M1 标记为预发布）。

**验收**
- CI 是绿的，能下载到 APK。
- 在本机检查签名：`apksigner verify --print-certs` 打印出的证书 CN 是 `RouteLink`。

**提交**：`ci(android): release APK build with signing from secrets`

### T62. Android 截图脚本

**新建 `scripts/screenshots-android.sh`**，依次执行：

1. **开启系统演示模式**，让状态栏干净统一：
   ```bash
   adb shell settings put global sysui_demo_allowed 1
   adb shell am broadcast -a com.android.systemui.demo -e command enter
   adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
   adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
   adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4
   ```
2. **逐张截图**：遍历"语言 × 外观 × 页面"的每种组合（和 iOS 一样），每张图：
   - `adb shell cmd uimode night yes|no`
   - 打开 `routelink://demo?...` 深链接
   - 等 3 秒
   - `adb exec-out screencap -p > docs/screenshots/<lang>/android-<page>-<theme>.png`
3. **退出系统演示模式**。

**截图的分辨率**：模拟器屏幕是 1080×2340，比例正常，不需要缩放。

**验收**：生成 24 张截图，抽查几张用 Read 打开看。

**提交**：`chore: Android screenshot script`

---

## 阶段 L：联调与发布

### T63. 本地完整测试

**自动检查**：`npm run typecheck && npm run lint && npm test` 全部通过。

**手动走查**：在 Android 模拟器上，分别连演示模式和 Docker 路由器，把 M1 的所有功能走一遍：

| 功能 | 演示模式 | Docker 路由器 |
|---|---|---|
| 添加路由器 | ☐ | ☐ |
| 切换路由器 | ☐ | ☐ |
| 概览 | ☐ | ☐ |
| 重启 | ☐ | ☐ |
| 设备列表 | ☐ | ☐ |
| 设备详情 | ☐ | ☐ |
| 改名 | ☐ | ☐ |
| 静态 IP | ☐ | ☐ |
| 拉黑 / 解除 | ☐ | ☐ |
| 无线 | ☐ | 显示"没有无线设备" |
| 网络 | ☐ | ☐ |
| 服务 | ☐ | ☐ |
| 日志 | ☐ | ☐ |
| 网络唤醒 | ☐ | ☐ |
| 设置 | ☐ | ☐ |
| 离线提示 | ☐ | ☐ |
| 证书信任 | ☐ | ☐（用 18443 端口，自签名） |

**提交**：只有修复了 bug 才提交。

### T64. 和你的路由器联调（需要你配合）

**准备**
1. 我在模拟器上打开"添加路由器"页面。
2. 你在模拟器窗口里操作：
   - 先用"扫描指定网段"找到你的路由器，或者直接手动输入地址。
   - 自己输入密码。

**联调内容**：我按 T63 的清单逐项操作，重点核对：

| 重点 | 说明 |
|---|---|
| 真实射频的数据 | 射频、SSID、终端信号 |
| 设备在线状态判断 | 和你知道的实际情况对照 |
| HTTPS / 证书 | 如果你的路由器开了 HTTPS |

**写操作的边界**
- 只做可以立即复原的操作，并且每做一步都先问你。比如：给一台设备改名后再改回来；拉黑一台测试设备后再解除。
- 改 Wi-Fi、重启这类操作，只在你明确同意后才执行。

**问题修复**：每个问题都在演示模式或 QEMU 上复现后再修，修完补上测试。

### T65. README 与截图

**收集截图**
- iOS：从最新一次 CI 产物里下载截图，放到 `docs/screenshots/{zh,en}/ios-*.png`。
- Android：用 T62 的脚本生成，放到 `docs/screenshots/{zh,en}/android-*.png`。
- 压缩：用 `npx sharp-cli` 重新编码，确保每张不超过 400KB。

**README.md（中文）的内容**

| 部分 | 内容 |
|---|---|
| 开头 | 标题和一句话介绍；徽章：CI 状态、License、最新 Release |
| 截图 | 用表格并排展示，每行是 iOS 和 Android 的同一个页面，浅色深色各一组，大约 6 张 |
| 功能清单 | 按设计 §9 的五个 Tab 列出，M1 已完成的标 ✅，计划中的标 🚧 并注明里程碑 |
| 安装 | Android：从 Releases 下载 APK。iOS：下载未签名 IPA，用 AltStore 或 TrollStore 安装 |
| 路由器要求 | 需要 OpenWrt 21.02 及以上并装了 LuCI；附各功能对应的可选软件包；说明 HTTPS 自签名证书怎么处理 |
| 安全与隐私 | 来自设计 §20 |
| 从源码构建 | `npm ci`，然后 `npx expo run:android`；iOS 需要 macOS 和 Xcode 26 |
| 参与开发 | 说明分层结构，附设计文档链接 |
| 致谢 | 列出参考过的开源项目，附链接 |
| 协议 | MIT |

`README.en.md` 的内容一样，配英文截图。两份 README 顶部都放 `[中文] | [English]` 互相跳转。

**提交**：`docs: bilingual README with screenshots`

### T66. 收尾

**步骤**
1. 推送 main，确认四个工作流（ci、integration、android、ios）全部是绿的。
2. 打标签 `v0.1.0` 并推送，触发 Android 和 iOS 的发布 job，生成预发布 Release，附 APK 和未签名 IPA。这是为了让你能把 APK 装到自己的手机上，测试真实的自动发现。
3. 把计划末尾"执行记录"里的结论（rpcd 的行为、Citadel 能否接入、拖动排序方案等）同步进设计文档。
4. 写一份 M1 小结给你：
   - 完成了哪些内容
   - 和设计不一样的地方，以及原因
   - 发现的问题
   - M2 准备做什么

---

## 执行记录（实施过程中填写）

| 项目 | 结论 |
|---|---|
| T17 Citadel 能否通过 SPM 接入 | **可以**。在本地 Expo 模块的 podspec 里调用 React Native 的 `spm_dependency(s, url:, requirement:, products: ['Citadel'])`，Swift 里 `import Citadel`，在 GitHub Actions macos-26（Xcode 26.6）上编译通过。M4 的 SSH 模块就按这个方式接入 |
| T24/T60 rpcd 行为假设 A1～A4 | 在 Docker 24.10.8 上通过 HTTP 会话实测（`test/integration/apply.int.test.ts`）：A1 成立；A2 成立（没有待确认的回滚时，`uci confirm` 返回 NO_DATA）；**A3 成立：只有发起 apply 的那个会话能 confirm**，其他会话会得到 PERMISSION_DENIED（最初在路由器命令行里用不带会话的 `ubus call` 测，误以为任何会话都行，已更正）；A4 成立：超时后 /etc/config 恢复原样，**但这次的改动会被放回发起 apply 的那个会话的暂存区**；另外发现 **A5：三个版本的 ACL 都不允许 root 通过 ubus 执行 `uci revert`**（`uci commit` 只有 25.12 允许；LuCI 自己也只用 apply/confirm），所以暂存区没法清理。以上结论在 CI 的 QEMU 上对 23.05.6、24.10.8、25.12.5 三个版本复核过。因此实现改为：每组改动都在一个新登录的独立会话里暂存、apply、confirm（`RouterConnection.fork()`），失败或回滚时直接丢弃这个会话（rpcd 在会话过期时删掉它的暂存区），主会话的暂存区始终是干净的；confirm 时不允许换会话重新登录 |
| T25 读邻居表用哪种方式（`ip neigh` 或 `/proc/net/arp`） | 用 `file exec /sbin/ip -4 neigh show`（luci-mod-status 授权）；`/proc/net/arp` 没有读权限。另外：24.10 下 `log read` 和 `/proc/stat` 都被拒绝，系统日志改用 `/usr/libexec/syslog-wrapper`；CPU 使用率拿不到，改为"1 分钟负载 ÷ 核心数"，核心数通过 `file list /sys/devices/system/cpu` 统计；温度在原版 OpenWrt 上读不到（`luci getTempInfo` 只有 ImmortalWrt 有）；`network.device status` 和 `iwinfo devices` 被拒绝，改用 `luci-rpc getNetworkDevices` 和 `getWirelessDevices`。Docker 版测试路由器需要 `NET_ADMIN` 权限，否则 netifd 会卡住 |
| T29 只有 name 和 mac 的 `dhcp host` 条目能否生效 | 可以：dnsmasq 启动脚本只在 ip、name、hostid 都为空时才跳过，会生成 `--dhcp-host=MAC,name`。但 name 会被原样拼进 dnsmasq 参数，中文和空格会让 dnsmasq 起不来，所以**调整了设计**：符合 DNS 规范的名字写 `name`；其他名字写自定义选项 `routelink_alias`（dnsmasq 会忽略它），只有 App 里看得到。拉黑规则用 `src * / dest *`，不依赖防火墙区域的名字。以上都已在 Docker 路由器上实测 |
| T49 添加路由器与自动发现 | 手动添加 Docker 路由器通过（登录后进入概览，数据正常）。在真实局域网里扫描 /24 能发现网关上的 OpenWrt（只发现，没有登录）。实测后调整了探测：① LuCI 21.02 起未登录访问 `/cgi-bin/luci/` 返回 **403** 登录页，探测要接受 403，主机名照样从标题里取；② 有些厂商固件也是基于 LuCI 改的，页面里有 luci 字样但没有 ubus，改为必须满足"标题是 `主机名 - LuCI`"或"页面引用了 `luci-static/`"，否则再走 ubus 探测；③ 模拟器经过 NAT 访问局域网的往返时间约 300 毫秒，整段并发扫描时连网关都会超时，所以单次请求超时从 1.2 秒改为 2.5 秒，并且先单独探测网关、主机名和 .1/.254 这几个最可能的地址，再扫其余地址（并发 48） |
| T56 拖动排序用的库 | 没有引入拖动排序库：react-native-reorderable-list 是否兼容 Reanimated 4.5 没法在不加依赖的情况下验证，按计划的备选方案，改成“编辑”模式下的上移、下移按钮。设置项（语言、外观、刷新间隔、降低透明度、演示模式）直接放在“更多”页的 App 分组里，用底部选择面板切换，和 iOS 设置的做法一致 |
| T58/T59 iOS 原生自检与截图 | iOS 26 模拟器上 9 项自检全部通过（HTTP、三种 TLS 模式、证书读取、不跟随跳转、不带 Cookie、网络信息、iOS 不支持手机发 WOL）。两个坑：`simctl openurl` 打开自定义协议时 iOS 会弹"在 RouteLink 中打开？"，CI 改为用启动参数 `-RouteLinkLaunchURL` 传链接（只接受 demo 和 selftest 链接）；iOS 的 `getNetworkInfo` 原来省略没有值的字段，改成和 Android 一样返回 null。截图发现 iOS 在浅色模式下会把 Tab 内页面的背景画成白色，白色卡片看不见，栈的内容背景改为显式的分组背景色 |
| T61 Android 发布签名 | 密钥在本机 `D:\RouteLink-keys` 生成（RSA 4096，有效期 10000 天），存入 GitHub Secrets。CI 产出的 APK 用 `apksigner` 核对，证书 DN 为 `CN=RouteLink, O=tsix2019`。两个坑：Groovy 会把 `signingConfig (a) ? b : c` 解析成 `signingConfig(a) ? b : c`，要整体加括号；Expo 的原生多语言文件里 iOS 专用的键（CFBundleDisplayName 等）会被写进 Android 的 strings.xml，触发 lint 的 ExtraTranslation 错误，改为放在 `ios` 字段下 |
| T60 QEMU 集成测试 | 23.05.6、24.10.8、25.12.5 三个版本都跑通 22 项集成测试。版本差异：23.05 不授权 `rc list/init`，服务管理改用 LuCI 的 `getInitList/setInitAction`（这个接口不报告运行状态，界面上显示为未知）；23.05 没有 syslog-wrapper，系统日志改用 LuCI 授权的 `logread -e ^`；`uci commit` 只有 25.12 授权给 root。hwsim 射频：`wifi config` 会把它们配成 6 GHz，开放网络在 6 GHz 上起不来；netifd 只在启动时扫描无线处理脚本，装完包要重启一次 |
| T63 本地完整测试 | Android 模拟器上逐项走查。演示模式：全部功能正常（含重启进度页）。Docker 路由器：添加（HTTP、HTTPS）、切换、概览、设备操作、网络与重连、服务、日志、手机发送 WOL、设置、离线提示（`docker pause`）、重新登录（改密码）、证书信任和证书变更拦截都正常。发现并修复：WAN 卡片在接口加载中显示"没有找到 WAN 接口"；日志没有停在最新一行；Metro 扫描 android 构建目录导致打包极慢 |
| T32 真实路由器的兼容性问题 | |
