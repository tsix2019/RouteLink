# RouteLink 设计文档

- 日期：2026-10-05
- 状态：设计已逐段确认，等待评审书面文档
- 仓库：`github.com/tsix2019/RouteLink`（公开，MIT 协议）
- 配套设计：路由器插件、流量统计、无线工具、网络诊断、Android 实时监控，见 `2026-10-05-routelink-agent-design.md`（下文简称"插件设计"）

## 1. 目标

做一款管理 OpenWrt 路由器的手机 App，要求如下：

- 同时支持 iOS 和 Android。
- 界面有简体中文和英文两种语言。
- 功能对齐现有开源 OpenWrt App 的并集，参考对象有 LuCI Mobile、OpenWrt Manager、YALA、WrtHub、WrtPulse、OpenWRT Global 等。
- Tab 栏、导航栏、卡片、按钮都用 iOS 26 液态玻璃风格。
- 源码推送到 GitHub，README 有中英文两版，并附软件截图。

### 1.1 不做的事

- 上架 App Store 或 Google Play。这需要开发者账号。
- 专门适配 iPad 和横屏。iPad 能用，只是不单独优化。
- Web 版。
- 内网穿透或云端中转。需要远程管理时，手动填公网地址或 DDNS 域名即可。
- GL.iNet 等厂商的私有接口。
- 管理 rpcd 多用户和权限（ACL）。App 可以用非 root 账号登录，但不负责配置账号。
- 保留已装软件包的在线固件定制（ASU）。

## 2. 已确定的决策

| 项目 | 决定 |
|---|---|
| 技术栈 | Expo SDK 57（React Native 0.86）+ TypeScript |
| 液态玻璃 | iOS 用系统原生组件（`NativeTabs`、`GlassView`）。Android 自己画仿制效果：真实背景模糊，加高光和描边 |
| 功能范围 | 调研里出现过的全部功能（第一、二、三档，加上零碎功能，包括 VLAN）。GL.iNet 私有接口除外 |
| 高风险功能 | 照做，按风险分级给出提示（第 10 节） |
| 测试环境 | 用户的真实路由器、演示模式、CI 里用 QEMU 跑的 OpenWrt |
| iOS 构建 | 在 GitHub Actions 的 macOS 机器上编译、截图，并打包未签名 IPA |
| 交付节奏 | 分四个里程碑，每完成一个推送一次（第 24 节） |
| README | `README.md` 是中文版，`README.en.md` 是英文版 |

## 3. 技术栈

| 用途 | 选型 |
|---|---|
| 框架 | Expo SDK 57、React Native 0.86.3（SDK 57 锁定的版本）、TypeScript（strict 模式） |
| 路由 | expo-router。iOS 用 `expo-router/unstable-native-tabs`；Android 用 `expo-router/ui` 的无头 Tab，自己画 Tab 栏 |
| 玻璃和模糊 | `expo-glass-effect`（iOS 26 的 `GlassView`、`GlassContainer`）；`expo-blur`（Android 上用 `BlurTargetView` 加 `blurMethod="dimezisBlurView"`） |
| 动画 | react-native-reanimated |
| 图形 | react-native-svg（流量曲线、仪表）、react-native-qrcode-svg |
| 数据请求 | @tanstack/react-query |
| 状态 | zustand。普通数据存在 `expo-sqlite/kv-store`，敏感数据存在 `expo-secure-store` |
| 多语言 | i18next、react-i18next、expo-localization |
| 文件 | expo-document-picker、expo-file-system、expo-sharing |
| 终端 | react-native-webview + @xterm/xterm |
| 小组件 | iOS 用 `expo-widgets`，Android 用 `react-native-android-widget` |
| 后台任务和通知 | expo-background-task、expo-notifications |
| 原生模块 | 本地 Expo 模块 `modules/routelink-native`（Kotlin + Swift）。SSH 部分 Android 用 sshj，iOS 用 Citadel |
| 路由器插件 | C 守护进程 `routelinkd` + `luci-app-routelink`（LuCI JS），代码在 `openwrt/`，见插件设计 |
| 测试 | Jest（jest-expo）、React Native Testing Library、QEMU OpenWrt 集成测试 |

## 4. 架构

### 4.1 分层

```
界面层       app/（页面路由）+ src/features/*（功能页面）+ src/ui/*（玻璃组件）
               │  通过 React Query hooks 取数据
领域服务层   src/api/services/*：按功能划分的函数，在这一层统一处理 OpenWrt 各版本之间的差异
               │
协议层       ubus 客户端 · uci 安全应用 · cgi-io 文件上传下载 · SSH 执行
               │
RouterConnection 接口 ──┬── LiveConnection：连真实路由器，HTTP 和 SSH 都走原生模块
                         └── DemoConnection：演示模式，数据和状态都在内存里
```

规则：

- 依赖只能从上往下。
- 界面层不能直接调用 ubus。
- 领域服务层不知道界面的存在。
- 演示模式只替换 `RouterConnection` 这一层，上面的代码不需要改。

### 4.2 目录结构

```
app/                          页面路由（expo-router）
  _layout.tsx                 根布局：多语言、数据请求、主题等 Provider
  (onboarding)/               欢迎页、添加路由器（含自动发现）
  (tabs)/_layout.tsx          iOS：NativeTabs
  (tabs)/_layout.android.tsx  Android：expo-router/ui 无头 Tab + 自己画的玻璃 Tab 栏
  (tabs)/{overview,devices,wireless,network,more}/
src/
  api/
    connection/               RouterConnection 接口、LiveConnection、DemoConnection
    ubus/                     登录策略、会话续期、批量调用、错误码映射
    uci.ts                    uci 读写辅助函数 + 安全应用
    cgi-io.ts                 上传、下载、备份
    ssh.ts                    对原生 SSH 的封装
    capabilities.ts           功能检测
    services/                 system、clients、wireless、network、firewall、vpn、ddns、sqm、
                              adblock、packages、logs、services、cron、leds、backup、firmware、
                              diagnostics、nlbw、vnstat、speedtest、processes、vlan……
  discovery/                  网段计算、并发探测、OpenWrt 识别
  ai/                         模型服务商适配、工具定义、数据脱敏、会话存储
  background/                 后台任务、通知、小组件快照
  features/<功能>/            页面、组件、hooks
  ui/                         GlassSurface（分 iOS 和 Android 两个实现）、GlassCard、GlassButton、
                              GlassTabBar（Android）、RouterSwitcher、Sheet、RiskConfirm、
                              图表、渐变背景
  state/                      路由器列表、App 设置、快照
  i18n/                       初始化代码，locales/zh-CN/*.json、locales/en/*.json
  utils/                      字节、速率、时长的格式化，MAC/OUI 查询，IP/CIDR 计算
modules/routelink-native/     原生模块（android/、ios/、src/）
widgets/                      iOS 和 Android 小组件
test/                         单元测试、各 OpenWrt 版本的接口数据样本、QEMU 集成测试
scripts/                      截图脚本、QEMU 启动脚本、OUI 数据生成脚本
.github/workflows/            CI 配置
```

`ios/` 和 `android/` 目录不提交到 git，由 `expo prebuild` 生成（Expo 的 CNG 模式）。

### 4.3 RouterConnection 接口

```ts
interface RouterConnection {
  readonly routerId: string;
  call<T>(object: string, method: string, params?: object): Promise<T>;
  batch(calls: UbusCall[]): Promise<UbusResult[]>;              // 打包成一个 JSON-RPC 数组发出
  upload(remotePath: string, file: LocalFile, mode?: number): Promise<void>;   // cgi-upload
  download(source: 'backup' | { path: string }): Promise<LocalFile>;          // cgi-backup / cgi-download
  ssh(): SshChannel;                                            // exec + 交互式 shell
}
```

- LiveConnection 负责：登录、会话续期、错误映射、证书固定。
- DemoConnection 按 `object.method` 分发到一台模拟路由器的处理函数上。写操作会修改内存里的状态。

### 4.4 原生模块 `routelink-native`

```ts
// HTTP：所有发往路由器的请求都走这里
httpRequest({ url, method, headers, body?, multipart?, saveToFile?, timeoutMs,
              tls: { mode: 'system' } | { mode: 'pinned', sha256: string } })
  → { status, headers, body | filePath }
fetchServerCertificate(url) → { sha256, subject, issuer, notBefore, notAfter }

// 网络
getNetworkInfo() → { isWifi, ip, netmask, gateway, ifname }
sendWakeOnLan(mac, broadcast?, port?)        // 仅 Android；iOS 发广播需要苹果审批的组播权限

// SSH（M4）
sshFetchHostKey(host, port) → { type, sha256 }
sshConnect({ host, port, username, password?, privateKey?, passphrase?, hostKeySha256 }) → sessionId
sshExec(sessionId, command, timeoutMs) → { stdout, stderr, exitCode }
sshOpenShell(sessionId, { cols, rows, term }) → shellId
sshWrite(shellId, data) / sshResize(shellId, cols, rows) / sshCloseShell(shellId)
sshDisconnect(sessionId)
sshGenerateKey('ed25519') → { privateKey, publicKey }
// 事件：onShellData、onShellClosed、onSessionClosed
```

HTTP 请求统一走原生模块，而不用 React Native 自带的 `fetch`，原因有三个：

1. 可以做自定义证书校验，也就是证书固定。
2. 不使用全局 Cookie 罐。各路由器的 LuCI cookie 自己管理，几台路由器之间互不干扰。
3. 能关掉自动跳转，从而读到 LuCI 登录时 302 响应里的 `Set-Cookie`。

## 5. 连接与登录

- **地址格式**：`http(s)://主机[:端口]`。用户名默认是 `root`。
- **登录顺序**：
  1. 先向 `/ubus` 发 `session login`，会话 ID 用 32 个 0 的空会话。成功后拿到 `ubus_rpc_session`。
  2. 如果失败（返回 404，或者路由器没有 ubus 接口），改走 LuCI 网页登录：向 `/cgi-bin/luci/` 提交表单，从 302 响应里取出 `sysauth` cookie，之后用它访问 `/cgi-bin/luci/admin/ubus`。
  3. 哪种方式成功了就记到路由器配置里，下次直接用这种。
- **会话续期**：会话默认 300 秒过期。如果收到 `-32002`（Access denied）或 HTTP 403，就重新登录一次，再重发刚才的请求。重登后仍然失败，就判定为"权限不足"，不再当作会话过期处理。
- **合并请求**：同一个页面要用的多个调用，打包成一个 JSON-RPC 数组一次发出。
- **超时**：普通请求 10 秒。上传和下载根据文件大小适当延长。
- **HTTP 被跳转到 HTTPS**：检测到这种跳转时，提示用户把地址改成 HTTPS。
- **明文连接**：用 HTTP 连接的路由器，在卡片上标注"未加密"。
- **证书**：
  - 系统信任的证书，按正常流程校验。
  - 自签名证书第一次连接时，显示它的 SHA-256 指纹、主题和有效期，用户确认后固定下来。
  - 之后证书一旦变化就拦截连接。拦截页说明原因：可能是中间人攻击，也可能是路由器重置过。页面上显示新指纹，由用户决定是否重新信任。
- **功能检测**：每次登录后执行一遍，结果按路由器缓存；装好或卸掉软件包后重新检测。
  - 检测手段有三种：`list`（看有哪些 ubus 对象）、`session access`（看有没有权限）、`file stat`（看可选程序在不在，比如 etherwake、nlbw、vnstat）。
  - 结果是一张"功能 → 状态"的表。状态有三种：可用、缺软件包（附包名）、没有权限。

## 6. 自动发现

- **入口**：欢迎页的"添加路由器"，以及"更多 → 管理路由器 → 添加"。页面一打开就开始扫描。
- **三种方式同时进行**：
  1. 读手机当前 Wi-Fi 的网关。
  2. 试 OpenWrt 的默认主机名，比如 `openwrt.lan`、`openwrt`。
  3. 扫描手机所在网段：
     - 网段不超过 /24 时，扫整个网段。
     - 网段更大时，只扫手机所在的那个 /24 和网关所在的那个 /24。
     - 高级选项"扫描指定网段"：手动填 CIDR，比如 `192.168.1.0/24`，最大 /22。适用于两种情况：手机和路由器不在同一网段；在 Android 模拟器里测试（模拟器跑在虚拟网段里）。
- **探测方法**：
  - 先单独探测网关、默认主机名和 .1/.254 这几个最可能的地址，再扫其余地址。扫其余地址时最多 48 个请求同时进行。每个请求 2.5 秒超时（实施时从 1.2 秒调大，见计划的执行记录 T49）。
  - 每个地址探测 80 和 443 端口。
  - 判断依据：`/cgi-bin/luci/` 返回 LuCI 页面（200，或者未登录时的 403 登录页；页面标题是"主机名 - LuCI"，或者引用了 `luci-static/`），或者 `/ubus` 能给出 JSON-RPC 格式的回应。
  - 主机名从 LuCI 登录页的标题里读。
- **结果列表**：
  - 每台显示 IP、主机名、HTTP 还是 HTTPS、是不是网关。已经添加过的标"已添加"。
  - 网关排在第一位，其余按 IP 排序。
  - 如果网关不是 OpenWrt，提示"你可能在用旁路由"。
  - 可以多选一起添加；几台密码一样时只需输入一次。
- **安全**：探测请求不带任何账号信息。用户选中某台设备之后，才会把密码发给它。
- **找不到时**：给出排查提示，比如是否连在同一个网络、LuCI 有没有开启；也可以手动输入地址。
- **手机用移动数据时**：提示先连上路由器的 Wi-Fi。
- **iOS**：在 Info.plist 里写好"本地网络"权限的说明文字，中英文各一份。

## 7. 多路由器管理

- **每台路由器保存的信息**：名称、地址、用户名、登录方式、证书指纹、SSH 端口、SSH 用户名、SSH 主机指纹、排序、最后使用时间。
  - 密码、SSH 私钥存在钥匙串或 Keystore。
  - 可以选择不保存密码。
- **切换入口**：每个 Tab 左上角都有一个玻璃胶囊，显示当前路由器的名字和在线状态圆点。点开是一个面板：
  - 列出所有路由器，每台显示名称、地址、型号、在线状态。
  - 打开面板时，会并发检测所有路由器是否在线。
  - 点一下就切换。
- **切换速度**：数据按路由器分别缓存。切回某台时，先显示上次的数据，再在后台刷新。
- **管理**：台数不限，可以排序、编辑、删除（M1 的排序是"编辑"模式下的上移、下移按钮，没有引入拖动排序库）。App 会记住上次用的那台，下次打开直接进入。批量管理放在"更多 → 管理路由器"。

## 8. 导航与界面

### 8.1 Tab 结构（5 个）

| Tab | 图标（iOS SF Symbol / Android Material） | 内容 |
|---|---|---|
| 概览 | `gauge.with.dots.needle.67percent` / `dashboard` | 系统状态、实时流量、快捷操作 |
| 设备 | `laptopcomputer.and.iphone` / `devices` | 设备列表和设备详情 |
| 无线 | `wifi` / `wifi` | 射频、SSID、访客网络等 |
| 网络 | `network` / `lan` | 接口和连接、安全、服务、统计、诊断 |
| 更多 | `ellipsis.circle` / `more_horiz` | 系统、工具、App 设置 |

具体功能见第 9 节。

### 8.2 液态玻璃实现

- **iOS 26 及以上**：
  - Tab 栏用 `NativeTabs`，是系统悬浮玻璃 Tab 栏，加 `minimizeBehavior="onScrollDown"`，向下滚动时自动收缩。
  - 导航栏用原生 Stack 的大标题，滚动时系统自动变成玻璃效果。
  - 卡片、按钮、弹出面板用 `GlassView`，可点的元素设 `isInteractive`。相邻的按钮用 `GlassContainer` 融合在一起。
- **iOS 26 以下**：`GlassSurface` 改用 `BlurView` 的毛玻璃效果。
- **Android**：
  - Tab 栏是一个悬浮胶囊，外观仿 iOS 26，由几层叠成：`BlurView` 的真实模糊、半透明渐变、顶部一道高光描边、阴影。
  - 选中的 Tab 下面有一颗玻璃"水滴"，切换时用 reanimated 做滑动动画。
  - 导航栏自己画，内容滚到它下面时用同样的玻璃效果。
  - 只有压在滚动内容上面的浮层才用真实模糊：Tab 栏、导航栏、弹出面板。页面内容包在 `BlurTargetView` 里，作为模糊的取样来源。
  - 卡片下面是平滑的渐变背景，模糊前后看起来几乎一样，所以卡片用半透明渐变加高光描边就能达到同样的效果，也省掉了模糊的性能开销。
  - Android 12 以下不支持模糊，浮层也改用半透明。
- **背景**：每个页面底下铺一层柔和的渐变色，浅色和深色模式各一套。玻璃透出底下有颜色的内容才看得出效果。
- **外观**：默认跟随系统深浅色，也可以手动切换。尊重系统的"降低透明度"和"减弱动态效果"设置。Android 上另外提供"降低透明度"开关，给性能一般的手机用。
- **适配范围**：只针对手机竖屏优化。

### 8.3 页面形式

- 列表页点进去，详情用弹出面板（sheet）展示，可以拖动调整高度。
- 编辑表单底部是"保存并应用"按钮。
- 只有破坏性操作的按钮用红色。

## 9. 功能清单

**列名说明**

- 风险：低、中、高，含义见第 10 节。
- 里程碑：M1 到 M4，见第 24 节。

**通用依赖**

- 下面"依赖"一列里没写的，都只需要 OpenWrt 装了 LuCI 后默认带的包：rpcd、uhttpd-mod-ubus、rpcd-mod-luci、rpcd-mod-iwinfo、rpcd-mod-file、cgi-io。
- 表里的接口名是根据调研整理的，实际用法以实现时在 QEMU 上跑出的结果为准。

### 9.1 概览（OV）

| ID | 功能 | 实现方式 | 风险 | 里程碑 |
|---|---|---|---|---|
| OV-1 | 系统信息：型号、固件版本、内核、主机名、运行时间、本地时间 | `system board`、`system info` | 低 | M1 |
| OV-2 | CPU（有 `/proc/stat` 读权限时显示使用率，否则显示负载）、内存、存储、温度（`thermal_zone`，读不到就隐藏） | `system info`、`file read` | 低 | M1 |
| OV-3 | WAN 状态：协议、IPv4/IPv6、DNS、在线时长 | `network.interface dump` | 低 | M1 |
| OV-4 | WAN 实时上下行流量曲线 | `luci-rpc getNetworkDevices` 两次读数的字节差 | 低 | M1 |
| OV-5 | 在线设备数 | 设备汇总（DV-1） | 低 | M1 |
| OV-6 | 快捷操作：重启（M1）、Wi-Fi 二维码（M2）、问 AI（M4） | 见各功能 | 中 | M1–M4 |

### 9.2 设备（DV）

| ID | 功能 | 实现方式 | 依赖 | 风险 | 里程碑 |
|---|---|---|---|---|---|
| DV-1 | 设备列表：DHCP 租约、邻居表、无线终端合成一个列表；按在线/离线、有线/无线筛选；显示信号强度、厂商；支持搜索 | `luci-rpc getDHCPLeases`、`getHostHints`、`getWirelessDevices`、`iwinfo assoclist`；内置 OUI 厂商库 | — | 低 | M1 |
| DV-2 | 改名（写到路由器上，LuCI 和 DNS 里都能看到这个名字） | `dhcp host`，只填 name 和 mac；这台设备已经有 `dhcp host` 条目（比如绑过静态 IP）时，直接改那一条的 name | — | 低 | M1 |
| DV-3 | 静态 IP 绑定 | `dhcp host`，填 name、mac、ip | — | 中 | M1 |
| DV-4 | 踢下线 | `hostapd.<接口> del_client` | — | 中 | M1 |
| DV-5 | 拉黑（禁止上网） | 防火墙规则：`src_mac` 加 REJECT，规则名带 `RouteLink:` 前缀 | — | 中 | M1 |
| DV-6 | 网络唤醒（WOL） | 优先让路由器发（etherwake）。路由器上没装时，Android 手机直接发 UDP 广播；iOS 发广播需要苹果审批的组播权限，所以 iOS 上只能由路由器发 | luci-app-wol（可选） | 低 | M1 |
| DV-7 | 单台设备的流量统计（改由插件实现，见插件设计 TR-4） | 插件的 `routelink` ubus 对象 | RouteLink 插件 | 低 | P1 |
| DV-8 | 家长控制：按时段禁止某台设备上网 | 防火墙规则：`start_time`、`stop_time`、`weekdays` | — | 中 | M3 |

### 9.3 无线（WL）

| ID | 功能 | 实现方式 | 风险 | 里程碑 |
|---|---|---|---|---|
| WL-1 | 射频：开关、信道、频宽、发射功率、国家码 | uci `wireless` 的 `wifi-device` 段 | 中 | M1 |
| WL-2 | SSID：名称、密码、加密方式、隐藏、启用。改动不走自动回滚，会提示手机将断开 | uci `wifi-iface` 段 | 中 | M1 |
| WL-3 | 扫描周边网络 | `iwinfo scan` | 低 | M1 |
| WL-4 | Wi-Fi 二维码分享 | 在手机本地生成 `WIFI:T:..;S:..;P:..;H:..;;` 字符串（特殊字符转义） | 低 | M2 |
| WL-5 | 访客网络：一键创建、开关、删除。创建时自动配好独立网段、客户端隔离、防火墙区域，只放行 DHCP 和 DNS | uci：network、wireless、dhcp、firewall | 中 | M2 |
| WL-6 | MAC 过滤：白名单或黑名单 | `wifi-iface` 的 `macfilter`、`maclist` | 中 | M2 |
| WL-7 | Wi-Fi 定时开关 | 计划任务里由 App 管理的条目，用 `# RouteLink:` 注释标记 | 中 | M3 |

### 9.4 网络（NW）

| ID | 功能 | 实现方式 | 依赖 | 风险 | 里程碑 |
|---|---|---|---|---|---|
| NW-1 | 接口列表和状态、重连接口 | `network.interface dump`；`network.interface.<名称> up/down` | — | 中 | M1 |
| NW-2 | WAN/LAN 设置：DHCP、静态 IP、PPPoE、DNS、MTU、LAN IP、DHCP 地址池 | uci：network、dhcp | — | 中（改 LAN IP 的流程见第 11 节） | M2 |
| NW-3 | VLAN：新式 DSA（`bridge-vlan`）和旧式 swconfig（`switch_vlan`）都支持；界面是"端口 × VLAN"矩阵 | uci network | — | 高 | M3 |
| NW-4 | 路由表查看、静态路由增删改 | `ip route` 输出；uci network 的 `route` 段 | — | 中 | M2 |
| NW-5 | 实时连接（conntrack），带反向 DNS 解析 | `luci getConntrackList`、`network.rrdns lookup` | — | 低 | M2 |
| NW-6 | 防火墙：查看区域；端口转发、通信规则的增删改和启停 | uci firewall 的 zone、redirect、rule 段 | — | 中 | M2 |
| NW-7 | WireGuard 状态：对端、最近握手、流量 | `luci.wireguard getWgInstances` | luci-proto-wireguard | 低 | M2 |
| NW-8 | VPN 配置：WireGuard 接口和对端的增删改，生成密钥，导出对端配置和二维码；OpenVPN 导入 `.ovpn`、启停实例 | uci network/openvpn、`luci.wireguard generateKeyPair`、cgi-upload | luci-proto-wireguard / openvpn、luci-app-openvpn | 中 | M3 |
| NW-9 | DDNS：服务增删改、状态 | uci ddns、`luci.ddns` | ddns-scripts | 中 | M3 |
| NW-10 | SQM：按接口设置上下行限速、队列算法 | uci sqm、`rc init sqm` | sqm-scripts | 中 | M3 |
| NW-11 | 广告过滤：开关、状态、规则源（支持 adblock 和 adblock-fast，装了哪个用哪个） | 对应包的 uci 配置和 rpcd 接口 | adblock 或 adblock-fast | 中 | M3 |
| NW-12 | 流量历史：按日、按月（改由插件实现，见插件设计 TR-5） | 插件的 `routelink` ubus 对象 | RouteLink 插件 | 低 | P1 |
| NW-13 | 诊断：ping、traceroute、nslookup（并入插件设计 DG-2） | 通过 `file exec` 执行，用 LuCI 诊断页的权限 | — | 低 | P3 |

### 9.5 更多（MO）

| ID | 功能 | 实现方式 | 依赖 | 风险 | 里程碑 |
|---|---|---|---|---|---|
| MO-1 | 服务管理：启动、停止、重启、开机自启 | `rc list`、`rc init` | — | 中 | M1 |
| MO-2 | 系统日志、内核日志（支持搜索） | logread、dmesg | — | 低 | M1 |
| MO-3 | 重启路由器 | `system reboot` | — | 中 | M1 |
| MO-4 | 进程列表，可结束进程 | 解析 `top -bn1` 的输出，用 `kill` 结束进程（借用 LuCI 进程页的权限） | — | 中 | M2 |
| MO-5 | 软件包：已安装列表、搜索、安装、卸载、更新软件源（同时支持 opkg 和 apk） | `opkg-call` 或 `package-manager-call` | luci-app-opkg 或 luci-app-package-manager | 中 | M2 |
| MO-6 | 计划任务编辑 | 读写 `/etc/crontabs/root`，然后重启 cron | — | 中 | M2 |
| MO-7 | LED 灯：开关、触发方式 | uci system 的 `led` 段 | — | 低 | M2 |
| MO-8 | 修改管理密码；设置时区；把路由器时间同步成手机时间 | `luci setPassword`、uci system、`luci setLocaltime` | — | 中 | M2 |
| MO-9 | 下载备份、恢复备份 | cgi-backup；cgi-upload 后执行 `sysupgrade --restore-backup` | — | 高（恢复） | M3 |
| MO-10 | 恢复出厂设置 | `firstboot -r -y`，然后重启 | — | 高 | M3 |
| MO-11 | 固件升级，两种来源：本地文件；官方在线（仅限官方 OpenWrt/ImmortalWrt 构建：从官方下载站的 `profiles.json` 里按 board 名称匹配 sysupgrade 镜像，下载后用 SHA-256 校验；匹配不到时只提供本地文件方式） | cgi-upload、`system validate_firmware_image`、sysupgrade | — | 高 | M3 |
| MO-12 | SSH 终端：密码或密钥登录、主机指纹固定、一键把 App 的公钥装到路由器 | 原生 SSH 模块；写入 `/etc/dropbear/authorized_keys` | — | 中 | M4 |
| MO-13 | 测速：手机端测；路由器端测改由插件执行，不再依赖 SSH（并入插件设计 DG-4） | 原生 HTTP、插件 | 路由器端测速需要 RouteLink 插件 | 低 | P3 |
| MO-14 | 网络唤醒常用设备列表 | 与 DV-6 相同 | — | 低 | M1 |
| MO-15 | AI 助手（第 18 节） | — | 用户自己的 API Key | 隐私 | M4 |
| MO-16 | App 设置：管理路由器、语言、外观、刷新间隔、通知（M4）、降低透明度、演示模式、关于 | — | — | 低 | M1 |

### 9.6 App 级功能（AP）

| ID | 功能 | 里程碑 |
|---|---|---|
| AP-1 | 自动发现（第 6 节） | M1 |
| AP-2 | 多路由器切换（第 7 节） | M1 |
| AP-3 | 演示模式（第 16 节）。M1 搭好框架，之后每个里程碑把新功能的演示数据补进去 | M1–M4 |
| AP-4 | 桌面小组件（第 19 节） | M4 |
| AP-5 | 后台通知：路由器掉线或恢复、有新设备接入（第 19 节）。装了插件的路由器，新设备提醒改由插件推送（插件设计 AG-14） | M4 |

### 9.7 插件与配套功能

以下功能的详细设计见插件设计，编号沿用那份文档：

| 前缀 | 内容 | 期 |
|---|---|---|
| AG | 路由器插件：流量采集、存储、接口、LuCI 页面、打包、App 一键安装、无线采样、延迟探测、测速、限速和配额、DNS 和访问去向、推送 | P1–P4 |
| TR | 流量统计：时间段筛选、总览和排行、实时速率、设备流量详情、WAN 口历史、导出、限速和配额设置、访问去向 | P1、P4 |
| NG | 网络组：主路由加 AP 编组，数据合并 | P2 |
| WF | 无线工具：实时信号监测、信道扫描与优化、查蹭网、Wi-Fi 安全检查 | P2 |
| DG | 诊断：一键诊断、诊断工具、断网和延迟记录、测速 | P3 |
| LU | Android 实时监控（状态栏胶囊和各家的岛） | P4 |

## 10. 风险分级与提示

| 级别 | 包括哪些操作 | 怎么提示 |
|---|---|---|
| 低 | 只读操作；改设备名；生成二维码；网络唤醒 | 直接执行 |
| 中 | 踢下线、拉黑；启停服务；改无线、网络、防火墙、VPN、SQM、DDNS、广告过滤的配置；安装或卸载软件包；结束进程；重启 | 弹窗说明后果，确认后执行。可能导致断网的配置走安全应用（第 11 节） |
| 高 | 固件升级、恢复备份、恢复出厂、VLAN | 见下方高风险流程 |
| 隐私 | AI 助手把数据发给第三方 | 见第 18 节 |

**高风险操作的流程**

1. 打开一个单独的警告页，逐条列出风险：可能变砖、配置会丢失、断电的后果、需要重新连接。
2. 用户必须勾选"我已了解风险"，并输入路由器名称才能继续。
3. 刷机和恢复备份之前，提示先一键备份当前配置。
4. 执行过程中全屏提示"不要断电，不要关闭 App"。
5. 执行完自动检测路由器是否恢复，最多等 5 分钟。
6. 恢复出厂完成后，提示路由器地址会变回 `192.168.1.1`，而且没有密码。

**补充规则**

- AI 助手不能调用任何高风险操作。
- 确认弹窗统一用 `RiskConfirm` 组件，测试要覆盖"没完成确认步骤就无法继续"。

## 11. 修改配置与安全应用

- **基本形式**：每个编辑页面都是"保存并应用"，不设全局的"待提交更改"列表。
- **标准流程**：
  1. 为这次修改单独登录一个新会话，在这个会话里暂存修改（`uci set`、`uci add`、`uci delete`）。实测发现 root 不能通过 ubus 执行 `uci revert`，暂存区没法清理，所以每次修改都用独立会话，用完即弃。
  2. 在同一个会话里执行 `uci apply {rollback: true, timeout: 90}`。
  3. App 重新连上路由器（不换会话，因为只有发起 apply 的会话能确认）。
  4. 在同一个会话里执行 `uci confirm`。
  5. 刷新相关数据。

  如果 90 秒内没有确认，路由器会自动回滚。App 发现回滚后，提示"配置已自动恢复"，并说明原因。

- **不回滚的情况**：修改手机当前连着的那个 SSID 的名称、密码或加密方式。
  - 判断方法：手机 IP → DHCP 租约里对应的 MAC → 看这个 MAC 是否在该 SSID 的无线终端列表里。
  - 确认是同一个 SSID 时，手机一定会断开，没法确认，所以不走回滚。先明确提示"手机会断开，请用新密码重连"，然后提交并重新加载。
  - 判断出手机连的是别的 SSID 或网线，或者无法判断时，照常走带回滚的标准流程。
- **修改 LAN IP**：
  1. 用带回滚的方式应用。
  2. App 临时把这台路由器的地址改成新 IP，连上后执行确认。
  3. 确认失败时，路由器自动回滚，App 也把地址改回原来的。
  （注：只有发起 apply 的会话能确认，而会话是按地址登录的，所以修改 LAN IP 要等到实现时验证 rpcd 会话在新地址上是否仍然有效，再定具体做法。M1 不包含这个功能。）
- **必须走回滚的情况**：VLAN、WAN 协议、防火墙区域的修改。
- **提交前的校验**：IP、CIDR、端口、MAC 的格式；冲突检查，比如静态 IP 重复、端口转发重叠。
- **能实际验证**：回滚和确认的具体行为，在 QEMU 的三个 OpenWrt 版本上逐一验证。

## 12. 数据刷新与缓存

- **只刷新正在看的页面**：
  - 概览的流量每 2 秒刷新一次，间隔在设置里可选 1、2、5、10 秒。
  - 设备列表每 10 秒刷新一次。
  - 其他页面进入时拉取一次，也支持下拉刷新。
  - App 进入后台或页面失去焦点时停止刷新（React Query 的 `focusManager` 配合 `AppState`）。
- **缓存键**：以 `[routerId, 领域, 方法, 参数]` 为键，每台路由器的数据互相隔离。
- **流量速率**：用字节计数的差值除以时间差算出来，每台路由器在内存里保留最近 60 个点。计数器归零（比如路由器重启）时丢弃这一个点。
- **快照**：每台路由器把最后一份概览数据持久化保存。冷启动、切换路由器、小组件、后台通知对比都用它。
- **写操作完成后**：让相关的查询失效，触发重新拉取。

## 13. 出错处理

| 情况 | 处理 |
|---|---|
| 连不上路由器（超时、拒绝连接） | 顶部出现提示条；页面照常显示缓存数据并标注"上次更新于几点几分"；按指数退避自动重试 |
| 会话过期 | 后台自动重新登录。登录失败时（比如密码已改），弹窗让用户重新输入 |
| 没有权限，或缺 ubus 对象 | 功能置灰，写明原因和需要装的包 |
| 证书指纹变化 | 拦截连接，进入警告页（第 5 节） |
| SSH 主机指纹变化 | 同上 |
| 安全应用触发回滚 | 提示"配置已自动恢复"，并说明原因 |
| 重启、刷机、恢复出厂进行中 | 显示等待页，持续检测，最多 5 分钟；恢复后回到正常页面，超时就给出排查建议 |
| ubus 返回错误码 | 翻译成用户能看懂的中英文提示，原始错误码放在"详情"里 |
| 某个页面渲染崩溃 | 每个页面有自己的错误边界，只有这一页显示错误和"重试"按钮 |

## 14. 兼容性

- **OpenWrt 版本**：
  - CI 里测试三个版本：23.05、24.10.8、25.12.5。
  - 21.02、22.03 已停止维护，尽量兼容。
  - ImmortalWrt 等衍生版尽量兼容。
- **包管理器**：24.10 及以前用 opkg，25.12 起用 apk。
- **防火墙**：fw4 和 fw3 的 uci 配置格式相同，通用一套代码。
- **交换机配置**：新式 DSA 和旧式 swconfig 都支持。
- **手机系统**：
  - 最低系统版本以 Expo SDK 57 的要求为准。
  - iOS 26 以下没有液态玻璃，改用毛玻璃。
  - Android 12 以下没有模糊效果，改用半透明。
- **差异放在哪一层处理**：各版本之间的差异只在 `src/api/services/` 这一层处理。
- **M1 实测到的版本差异**（详见实施计划的执行记录）：
  - 23.05 不授权 `rc list/init`，服务管理走 LuCI 的 `luci getInitList/setInitAction`，拿不到运行状态。
  - 23.05 没有 `/usr/libexec/syslog-wrapper`，系统日志用 `logread -e ^`。
  - 25.12 的网络唤醒走 `luci.wol exec`（25.12.5 上这个接口有上游问题，App 退回由手机发送）。
  - 三个版本都不允许 root 通过 ubus 执行 `uci revert`，所以每次修改都在独立会话里暂存和确认（第 11 节）。

## 15. 多语言

- **语言**：简体中文（`zh-CN`）和英文（`en`）。
- **默认语言**：跟随系统。系统语言是中文（包括繁体）时显示中文，其他情况显示英文。设置里可以手动切换，马上生效。
- **翻译文件**：按功能拆分命名空间，放在 `src/i18n/locales/{zh-CN,en}/*.json`。
- **原生部分的翻译**：App 显示名称、iOS 权限说明（本地网络、通知）、通知内容、小组件文字，都通过 Expo 的 `locales` 配置和代码完成本地化。
- **格式化**：日期、数字、流量单位按当前语言格式化。
- **防漏翻**：有测试检查两种语言的翻译条目一一对应，缺任何一条测试都会失败。

## 16. 演示模式

- **入口**：欢迎页的"先体验演示模式"，以及 App 设置里的开关。
- **一台虚构的 OpenWrt 路由器**：
  - 型号是 OpenWrt One，系统 OpenWrt 24.10.8。
  - 有两个射频、约 15 台设备（有线和无线都有）、WireGuard、几条端口转发和服务。
  - 流量会随时间变化，设备会上下线。
- **修改**：写操作会修改内存里的状态，能看到效果；重启 App 后恢复原样。
- **特殊功能的演示**：
  - 自动发现会"找到"几台虚构的路由器。
  - SSH 是一个模拟 shell，支持 `uptime`、`ifconfig`、`logread` 等几条命令。
  - AI 助手显示一段示例对话。
  - 刷机、恢复出厂会走完整流程，但只是动画。
- **截图用的深链接**：`routelink://demo?lang=zh&theme=dark&route=/devices`，只在演示模式下生效。

## 17. SSH 与终端

- **原生实现**：Android 用 sshj，iOS 用 Citadel（通过 podspec 引入 SPM 依赖）。没有用现成的 React Native SSH 库，因为它们不校验主机指纹，iOS 端也不支持模拟器。（M1 已验证：在本地 Expo 模块的 podspec 里用 React Native 的 `spm_dependency` 引入 Citadel，在 Xcode 26 上编译通过。）
- **认证**：支持密码和私钥。App 可以生成一对 ed25519 密钥，再一键把公钥写进路由器的 `/etc/dropbear/authorized_keys`。
- **主机指纹**：第一次连接时确认并固定，之后指纹变化就拦截。
- **终端界面**：xterm.js 跑在 WebView 里，键盘上方加一排快捷键：Esc、Tab、Ctrl、方向键、`|`、`/`、`-`、`~`。支持复制粘贴、调整字号。每台路由器同时只开一个会话，断开后可以重连。
- **执行通道**：有些命令 ubus 权限不允许执行，比如路由器端测速，改走 SSH 的 exec 执行。

## 18. AI 助手

- **服务商**：
  - 默认用 Anthropic Claude：默认模型 `claude-sonnet-5-5`，可以改选 `claude-opus-5-5` 或 `claude-haiku-4-5-20251001`。
  - 也支持 OpenAI 兼容接口，自填 Base URL 和模型名，内置 DeepSeek、通义千问、OpenAI、Ollama 的预设。
  - 实现时按 claude-api 参考文档核对模型 ID 和工具调用格式。
- **调用方式**：手机直接请求服务商的 API，回复用流式输出，没有自建后端。API Key 存在钥匙串或 Keystore。
- **工具调用**：
  - 只读工具可以直接调用：系统状态、设备列表、接口、无线配置、防火墙、日志、连接、诊断。
  - 写操作工具每次调用都要出确认卡片，按第 10 节的级别提示。写操作包括：重启、踢下线、拉黑、改 Wi-Fi、开关射频、增删端口转发、重启服务。
  - 高风险操作不开放给 AI。
- **隐私**：
  - 第一次使用时说明会发送哪些数据。
  - 设备名、IP、MAC、日志这几类数据，每类都可以单独关闭。
  - 默认开启脱敏：MAC 地址和公网 IP 打码。
  - 密码和密钥永远不发送。
- **会话记录**：按路由器分开保存在本机，可以清空。

## 19. 小组件与后台通知

- **小组件**：
  - 显示当前路由器的名称、在线状态、上下行速率、在线设备数、更新时间。
  - iOS 用 `expo-widgets` 的 `updateSnapshot`；Android 用 `react-native-android-widget`。
  - 数据来自第 12 节的快照。
- **后台任务**：
  - 用 `expo-background-task`，系统限制最短大约 15 分钟一次，iOS 上不保证准时。
  - 对开启了通知的路由器执行：登录，拉取状态和设备列表，和上一份快照对比。
  - 出现以下情况时发本地通知：掉线、恢复、出现从没见过的 MAC 地址。
  - 同时更新小组件。
- **凭据访问**：后台任务读取的凭据，设为"首次解锁后可访问"。
- **设置页的说明**：写明后台检查不准时、小组件数据可能滞后。

## 20. 安全与隐私

- 密码、SSH 私钥、AI API Key 只存在钥匙串或 Keystore。不写日志，也不出现在崩溃信息里。
- HTTPS 自签名证书和 SSH 主机密钥都在第一次使用时确认，之后固定。
- 自动发现的探测请求不带账号信息。
- HTTP 明文连接标注"未加密"，并建议在路由器上开启 HTTPS。
- 不收集任何统计数据，App 不联系任何自有服务器。只有以下情况会访问外部网络：测速、在线固件检查、AI 服务商、下载或检查路由器插件（GitHub），而且都是用户主动触发的。
- 路由器插件的 DNS 记录默认关闭，开启时说明会记录哪些内容（插件设计 §10）。
- 公开仓库里的测试数据，只能来自 QEMU 或演示数据。用户真实路由器的数据不提交。

## 21. 测试

| 类别 | 内容 |
|---|---|
| 单元测试（Jest） | 登录策略和回退；会话续期；批量调用；错误码映射；领域服务层对各版本返回数据的解析（样本来自 QEMU 的三个版本）；安全应用状态机；流量速率计算；网段计算和 OpenWrt 识别；二维码字符串转义；AI 数据脱敏；翻译条目一致性 |
| 组件测试（RNTL） | `RiskConfirm`：不勾选、名称没输对时无法继续；路由器切换；表单校验 |
| 集成测试（QEMU） | 在 CI 里用 QEMU 启动 OpenWrt x86-64 的 23.05、24.10.8、25.12.5 镜像，通过端口转发把路由器的 80、22 端口映射出来，领域服务层直接对着它跑；刷机、恢复出厂、恢复备份、VLAN、安全应用回滚都在这台用完即弃的路由器上完整执行 |
| 原生模块 | Android 在本机测（连用户的路由器）。iOS 在 CI 编译后，在模拟器里跑自检，对象是 CI 机器上临时启动的服务：一个自签名 HTTPS 服务，一个 dropbear SSH 服务 |
| 真机联调 | 每个里程碑结束时，在 Android 模拟器上连用户的路由器，把这个里程碑的功能逐个过一遍。路由器密码由用户自己在 App 里输入 |
| 高风险操作的约束 | 在用户的真实路由器上，刷机、恢复出厂、恢复备份、改 VLAN 只走到最后确认之前，不真正执行，除非用户当时明确同意 |

## 22. CI/CD（GitHub Actions）

| 工作流 | 触发条件 | 内容 |
|---|---|---|
| `ci.yml` | 推送、PR | 类型检查、ESLint、Jest、翻译检查 |
| `integration.yml` | 推送、PR | 在 Ubuntu 上开 KVM，QEMU 跑三个 OpenWrt 版本，执行集成测试 |
| `android.yml` | 推送、打标签 | `expo prebuild` 后构建 release APK。打标签时把 APK 发布到 Releases |
| `ios.yml` | 推送、打标签 | macOS 上执行 `expo prebuild` 和 `xcodebuild`，构建模拟器版；运行原生模块自检；用深链接自动截图（中文和英文，浅色和深色），截图作为构建产物上传。打标签时额外打包未签名 IPA，发布到 Releases |

- **Android 签名**：签名密钥由我在本机生成，存进 GitHub Secrets，并在仓库外的 `D:\RouteLink-keys\` 备份一份。这个密钥丢失后，就无法覆盖安装升级。
- **公开仓库**：使用标准 GitHub Actions 机器免费。

## 23. 仓库与 README

- **仓库**：`tsix2019/RouteLink`，公开，MIT 协议。包名 / Bundle ID 是 `io.github.tsix2019.routelink`。
- **README**：`README.md`（中文）和 `README.en.md`（英文），顶部可以互相跳转。内容包括：
  - 简介和特色
  - 截图
  - 功能清单（标注已完成或计划中）
  - 安装方式：Android 下载 APK；iOS 用 AltStore 或 TrollStore 自签安装
  - 路由器要求：OpenWrt 版本、默认需要的包、各功能对应的可选包
  - 安全和隐私说明
  - 从源码构建的步骤
  - 协议
- **截图**：
  - 中文版 README 用中文截图，英文版用英文截图。
  - iOS（液态玻璃）和 Android 截图并排放，浅色、深色都有。
  - iOS 截图来自 CI 构建产物，Android 截图在本机模拟器上截。全部使用演示模式。
  - 存放在 `docs/screenshots/{zh,en}/`。
- **建仓时机**：M1 一开始就建公开仓库，推送项目骨架，README 先标注"开发中"，这样 iOS CI 从第一天就能跑。开发过程中持续推送。
- **更新时机**：每个里程碑完成后，更新 README 的功能清单和截图。

## 24. 里程碑

| 里程碑 | 内容 | 完成标准 |
|---|---|---|
| **M1 地基和第一档** | 项目骨架；玻璃组件和渐变背景；主题；中英文；原生模块（HTTP 和证书固定、网络信息、WOL）；连接层（ubus 登录和 LuCI 回退、会话续期、批量调用、功能检测）；演示模式；自动发现；多路由器切换和管理；OV-1～5，以及 OV-6 里的重启；DV-1～6；WL-1～3；NW-1；MO-1～3、MO-14、MO-16；安全应用和 `RiskConfirm`；四个 CI 工作流；创建 GitHub 仓库；README 和截图 | Android 模拟器连用户的路由器，M1 功能全部可用；iOS 在 CI 编译通过并产出截图；首次推送完成 |
| **M2 第二档和零碎功能** | OV-6（二维码）；WL-4～6；NW-2、NW-4～7；MO-4～8 | 功能可用，QEMU 集成测试通过，推送并更新 README |
| **M3 第三档的路由器功能** | DV-8；WL-7；NW-3、NW-8～11；MO-9～11 | 高风险功能在 QEMU 上完整执行通过，在用户路由器上只走到最后确认之前；推送 |
| **M4 第三档的原生能力** | SSH 原生模块和 MO-12；MO-15 和 OV-6（问 AI）；AP-4、AP-5 | 功能可用，iOS 自检通过；打标签发布 v1.0.0（APK 和未签名 IPA） |

每个里程碑单独写实施计划，按"计划 → 实现 → 测试 → 推送"推进。

M1 之后插入插件设计的 P1～P4 四期（插件设计 §22）。DV-7、NW-12 移到 P1，NW-13、MO-13 移到 P3，所以从 M2、M4 里去掉了。

## 25. 风险与应对

| 风险 | 应对 |
|---|---|
| iOS 的 Swift 代码（证书固定、SSH、小组件）无法在本机编译 | M1 就把原生模块骨架和 iOS CI 打通，尽早暴露问题。Citadel 通过 SPM 接入 CocoaPods 的方式，在 M1 先做技术验证 |
| `NativeTabs` 在 SDK 57 里还是 unstable API（SDK 58 起改为 `expo-router/native-tabs`） | 把它的用法集中放在 `(tabs)/_layout.tsx` 一个文件里，以后升级只需要改这一处 |
| 各 OpenWrt 版本的 ubus 接口和 ACL 不一样 | 以 QEMU 的三个版本加用户的路由器为准，版本差异收拢在领域服务层；衍生版尽量兼容 |
| 很多功能依赖可选软件包 | 功能检测后置灰，并提示要装的包名；在 App 里就能跳到软件包页安装 |
| iOS 后台执行不保证频率 | 在设置页里说明，小组件上显示"更新于几点几分" |
| Android 模糊在低端机上可能卡顿 | 提供"降低透明度"开关；模糊层只用在 Tab 栏、导航栏、弹出面板，列表里的卡片默认用半透明 |
| 高风险操作可能弄坏用户的路由器 | 只在 QEMU 上真正执行；在用户路由器上只走到最后确认之前，除非用户当时明确同意 |

## 26. 验收标准

1. Android 模拟器连用户的路由器，四个里程碑的功能都能用。高风险功能以 QEMU 上的验证为准。
2. iOS 在 CI 编译通过，截图里能看到原生液态玻璃 Tab 栏和导航栏。
3. 中英文覆盖所有界面文字，翻译检查测试通过。
4. 演示模式下，所有页面都能浏览，主要操作都能演示。
5. GitHub 公开仓库里有中英文 README 和截图；Releases 里有 APK 和未签名 IPA。
