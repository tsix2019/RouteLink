<p align="center"><img src="assets/images/icon.png" width="96" alt="RouteLink"></p>

<h1 align="center">RouteLink</h1>

<p align="center"><b>中文</b> | <a href="README.en.md">English</a></p>

<p align="center">
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/ci.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/ios.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/ios.yml/badge.svg" alt="iOS"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/android.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/android.yml/badge.svg" alt="Android"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/integration.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/integration.yml/badge.svg" alt="OpenWrt"></a>
  <a href="https://github.com/tsix2019/RouteLink/releases"><img src="https://img.shields.io/github/v/release/tsix2019/RouteLink?include_prereleases&amp;filter=v%2A" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tsix2019/RouteLink" alt="MIT"></a>
</p>

RouteLink 是一款管理 OpenWrt 路由器的手机 App，支持 iOS 和 Android，界面有中文和英文。

- **iOS 26 风格**：iOS 上用系统原生的液态玻璃（Tab 栏、导航栏、底部面板）；Android 上也按 iOS 26 的样式绘制：悬浮玻璃 Tab 栏、大标题导航栏、圆角分组列表。
- **自动发现**：扫描手机所在的局域网，找出 OpenWrt 设备，旁路由也能找到；也可以扫描指定网段或手动输入地址。
- **多路由器**：添加多台路由器，在页面左上角一键切换。
- **按设备统计流量**：配合路由器插件，看每台设备的实时速率，以及任意时间段、按天、按月的用量；插件可以在 App 里一键安装。
- **改配置更安全**：所有改动都走 OpenWrt 自带的"应用 + 确认"机制，App 联系不上路由器时，路由器会在 90 秒后自动撤销改动；会断网的操作都有分级的风险提示。
- **SSH 终端**：在 App 里直接用路由器的命令行；第一次连接时确认主机指纹，之后指纹变了会拦下来；可以一键把 App 的密钥装到路由器上。
- **AI 助手**：用你自己的 API Key（Claude、OpenAI、DeepSeek、通义千问，或本地的 Ollama）问路由器的情况；需要改设置时先请你确认。
- **桌面小组件和掉线通知**：桌面上看当前路由器的状态、速率和在线设备数（Android 另有网速、在线设备、系统资源、外网、快捷操作 5 种，点 ↻ 立即刷新）；路由器连不上、恢复、有新设备接入时发通知。
- **演示模式**：没有路由器也能先试用，内置一台模拟的 OpenWrt 路由器。
- **隐私**：不收集任何数据，App 只和你添加的路由器通信，只在你检查更新、打开自动检查更新或安装插件时访问 GitHub；AI 助手只在你自己启用后，才联系你选的服务商。

> App 的五个里程碑（M1～M5）和路由器插件的第一期（P1）已完成，后续功能见下面的功能清单。

## 截图

所有截图都来自演示模式。iOS 截图由 CI 在 iOS 26 模拟器上自动截取，Android 截图在 Android 模拟器上截取。

**浅色**

| | iOS | Android |
|---|---|---|
| 概览 | <img src="docs/screenshots/zh/ios-overview-light.png" width="240"> | <img src="docs/screenshots/zh/android-overview-light.png" width="240"> |
| 设备详情 | <img src="docs/screenshots/zh/ios-device-light.png" width="240"> | <img src="docs/screenshots/zh/android-device-light.png" width="240"> |
| 无线 | <img src="docs/screenshots/zh/ios-wireless-light.png" width="240"> | <img src="docs/screenshots/zh/android-wireless-light.png" width="240"> |

**深色**

| | iOS | Android |
|---|---|---|
| 设备 | <img src="docs/screenshots/zh/ios-devices-dark.png" width="240"> | <img src="docs/screenshots/zh/android-devices-dark.png" width="240"> |
| 网络 | <img src="docs/screenshots/zh/ios-network-dark.png" width="240"> | <img src="docs/screenshots/zh/android-network-dark.png" width="240"> |
| 更多 | <img src="docs/screenshots/zh/ios-more-dark.png" width="240"> | <img src="docs/screenshots/zh/android-more-dark.png" width="240"> |

**流量统计（需要路由器插件）**

| | iOS | Android |
|---|---|---|
| 流量总览 | <img src="docs/screenshots/zh/ios-traffic-light.png" width="240"> | <img src="docs/screenshots/zh/android-traffic-light.png" width="240"> |
| 设备流量 | <img src="docs/screenshots/zh/ios-traffic-device-light.png" width="240"> | <img src="docs/screenshots/zh/android-traffic-device-light.png" width="240"> |
| WAN 口历史 | <img src="docs/screenshots/zh/ios-wan-dark.png" width="240"> | <img src="docs/screenshots/zh/android-wan-dark.png" width="240"> |

**网络与系统工具**

| | iOS | Android |
|---|---|---|
| 防火墙 | <img src="docs/screenshots/zh/ios-firewall-light.png" width="240"> | <img src="docs/screenshots/zh/android-firewall-light.png" width="240"> |
| 实时连接 | <img src="docs/screenshots/zh/ios-connections-dark.png" width="240"> | <img src="docs/screenshots/zh/android-connections-dark.png" width="240"> |
| 软件包 | <img src="docs/screenshots/zh/ios-packages-light.png" width="240"> | <img src="docs/screenshots/zh/android-packages-light.png" width="240"> |

**更多路由器功能**

| | iOS | Android |
|---|---|---|
| 家长控制 | <img src="docs/screenshots/zh/ios-parental-light.png" width="240"> | <img src="docs/screenshots/zh/android-parental-light.png" width="240"> |
| Wi-Fi 定时开关 | <img src="docs/screenshots/zh/ios-wifi-schedule-dark.png" width="240"> | <img src="docs/screenshots/zh/android-wifi-schedule-dark.png" width="240"> |
| WireGuard | <img src="docs/screenshots/zh/ios-wireguard-dark.png" width="240"> | <img src="docs/screenshots/zh/android-wireguard-dark.png" width="240"> |
| 广告过滤 | <img src="docs/screenshots/zh/ios-adblock-light.png" width="240"> | <img src="docs/screenshots/zh/android-adblock-light.png" width="240"> |
| 固件升级 | <img src="docs/screenshots/zh/ios-firmware-light.png" width="240"> | <img src="docs/screenshots/zh/android-firmware-light.png" width="240"> |

**终端、AI 助手和小组件**

| | iOS | Android |
|---|---|---|
| SSH 终端 | <img src="docs/screenshots/zh/ios-terminal-dark.png" width="240"> | <img src="docs/screenshots/zh/android-terminal-dark.png" width="240"> |
| AI 助手 | <img src="docs/screenshots/zh/ios-assistant-light.png" width="240"> | <img src="docs/screenshots/zh/android-assistant-light.png" width="240"> |
| 通知与小组件 | <img src="docs/screenshots/zh/ios-notifications-light.png" width="240"> | <img src="docs/screenshots/zh/android-widget-light.png" width="240"> |

其余截图在 [docs/screenshots/zh](docs/screenshots/zh)。

## 功能

✅ 已完成　🚧 计划中（括号里是阶段：M2～M4 是 App 本身的里程碑，P2～P4 是路由器插件和配套功能的分期）

**概览**

- ✅ 系统信息：型号、固件、内核、主机名、运行时间
- ✅ 资源：负载、内存、存储、温度（路由器支持时）
- ✅ 外网状态：协议、IP、网关、DNS、在线时长
- ✅ 实时流量曲线、在线设备数
- ✅ 重启路由器（带进度和恢复检测）
- ✅ 今日流量卡片：今天的上下行和用得最多的设备（需要插件）
- ✅ Wi-Fi 二维码分享（概览和每个 Wi-Fi 的页面）
- ✅ 问 AI：一键打开 AI 助手

**设备**

- ✅ 设备列表：合并 DHCP 租约、邻居表和无线终端；在线/离线、有线/无线筛选；搜索；信号强度；厂商识别
- ✅ 改名（写到路由器上；符合主机名规则的名字在 LuCI 和局域网 DNS 里也能看到）
- ✅ 绑定静态 IP、拉黑（禁止上网）、踢下线
- ✅ 网络唤醒（路由器装了 etherwake 时由路由器发送；否则 Android 手机直接发送）
- ✅ 单台设备的流量：曲线、总量、峰值、上下线记录（需要插件）
- ✅ 家长控制：按时段禁止某台设备上网（跨午夜的时段也可以），时段开始时连它正在进行的连接一起断开
- 🚧 查蹭网、信任设备（P2）

**无线**

- ✅ 射频设置：开关、信道、频宽、发射功率、国家码
- ✅ Wi-Fi 设置：名称、密码、加密方式、隐藏、启用。手机正连着这个 Wi-Fi 时，会提示并引导重新连接
- ✅ 扫描周边 Wi-Fi
- ✅ 访客网络：一键创建（只能上网、访客之间隔离）、开关、二维码分享、删除；只在负责上网的路由器上提供
- ✅ MAC 过滤：只允许或禁止列表里的设备，不会把正在用的手机挡在外面
- ✅ Wi-Fi 定时开关：到点关闭、到点打开，可以只管某个射频；不改无线配置
- 🚧 信号监测、信道扫描与优化、Wi-Fi 安全检查（P2）

**网络**

- ✅ 接口列表和详情、重连接口
- ✅ 流量统计（需要插件）：任意时间段（可以只看每天的某几个小时）的总量和曲线、设备排行（互联网或局域网）、实时速率、导出 CSV
- ✅ WAN 口历史（需要插件）：按日、按月的用量，按每月重置日计算本期已用
- ✅ WAN 设置（DHCP、静态、PPPoE、DNS、MTU）和 LAN 设置（地址、DHCP 地址池；改地址时 App 在新地址确认，连不上会自动改回）
- ✅ 路由表和静态路由、实时连接（路由器反查域名）、防火墙（端口转发、通信规则、区域）、WireGuard 状态
- 🚧 一键诊断、ping/traceroute/nslookup、断网和延迟记录、测速（P3）
- ✅ VLAN："端口 × VLAN"矩阵，支持新式 DSA 网桥和旧式 swconfig 交换机；高风险操作，改错了路由器会自动回滚
- ✅ VPN：WireGuard 新建隧道和对端、导出配置文件和二维码；OpenVPN 导入 `.ovpn`、启停
- ✅ DDNS、SQM 限速、广告过滤（adblock-fast 或 adblock）

**更多**

- ✅ 服务管理：启动、停止、重启、开机自启
- ✅ 系统日志、内核日志（筛选、分享）
- ✅ 网络唤醒常用设备列表
- ✅ 管理路由器（排序、编辑、删除、证书）、语言、外观、刷新间隔、降低透明度、演示模式
- ✅ 路由器插件：一键安装、检查更新、重启、清空数据、卸载
- ✅ 检查 App 更新：Android 在 App 里下载、校验并安装新版本，iOS 打开发布页；可以打开每天自动检查（默认关闭）
- ✅ 进程（结束、重新加载）、软件包（搜索、安装、卸载）、计划任务、LED、系统（时区、同步手机时间、修改管理密码）
- ✅ 备份与恢复、固件升级（官方 OpenWrt 和 ImmortalWrt 可以在线升级，也可以用本地文件）、恢复出厂。这几项都是高风险操作：先提示备份，勾选并输入路由器名称才能继续，执行时全屏提示不要断电
- ✅ SSH 终端：密码或密钥登录、主机指纹确认和固定、快捷键栏（Esc、Tab、Ctrl、方向键）、调整字号、手指滑动翻看输出、横屏；一键把 App 的公钥装到路由器
- ✅ AI 助手：Claude、OpenAI、DeepSeek、通义千问、Ollama 或任意 OpenAI 兼容的服务，用你自己的 API Key；查状态、设备、日志，改设置（踢掉或拉黑设备、改 Wi-Fi、加端口转发、重启服务或路由器）前在对话里请你确认；可以选择发送哪些数据、是否打码；每台路由器保存多段对话，可以搜索、重命名、删除
- ✅ 桌面小组件（iOS、Android）：当前路由器的在线状态、速率、在线设备数，点按打开 App
  - Android 共 6 种：路由器状态、网速、在线设备、系统资源、外网、快捷操作。点小组件上的 ↻ 在后台读一次路由器（需要保存了密码），系统大约每半小时也会自动更新一次。在「更多 → 桌面小组件」里预览和添加
  - 从 App 里添加时没反应：小米、vivo、OPPO、华为、荣耀等手机默认不允许 App 往桌面添加东西，要在 RouteLink 的应用权限里打开「桌面快捷方式」，App 会提示并带你去设置页；也可以长按桌面空白处，从「小组件」里手动添加
- ✅ 后台通知：路由器连不上、恢复、有新设备接入（按路由器开关，需要保存密码）
- 🚧 限速和流量配额、访问去向和 DNS 记录、上下线推送、Android 实时监控（P4）

## 安装

- **Android**：从 [Releases](https://github.com/tsix2019/RouteLink/releases) 下载 `RouteLink-<版本>.apk` 安装。需要 Android 8.0 或更新版本、ARM 处理器（市面上的手机和平板都是）。
- **iOS**：需要 iOS 17 或更新版本（液态玻璃效果需要 iOS 26）。没有上架 App Store。Releases 里提供未签名的 `RouteLink-unsigned.ipa`，可以用 [AltStore](https://altstore.io)、[SideStore](https://sidestore.io)、Sideloadly 用自己的 Apple ID 签名安装；支持 TrollStore 的 iOS 版本也可以用 TrollStore 安装。
  - IPA 里带一个桌面小组件扩展，签名时要算两个 App ID（免费 Apple ID 每 7 天最多注册 10 个）。App 和小组件通过 App Group `group.io.github.tsix2019.routelink` 共享数据，签名时要换成你账号下的 App Group（AltStore、SideStore 会自动处理）。如果小组件一直没有数据，多半是签名时丢了 App Group，App 本身不受影响。

## 路由器要求

- OpenWrt 21.02 或更新版本，装有 LuCI 网页管理界面。CI 在 OpenWrt **23.05、24.10、25.12** 上实测；ImmortalWrt 等衍生版尽量兼容。
- 默认需要的软件包都随 LuCI 一起安装：`rpcd`、`uhttpd-mod-ubus`、`rpcd-mod-luci`、`rpcd-mod-iwinfo`、`rpcd-mod-file`。
- 可选软件包：

  | 功能 | 软件包 |
  |---|---|
  | 由路由器发送网络唤醒包 | `luci-app-wol`（带 `etherwake`）。OpenWrt 25.12.5 上 LuCI 的唤醒接口有问题，Android 会自动改由手机发送 |
  | HTTPS 访问 | 较新的固件默认已带；旧版本安装 `luci-ssl` |
  | WireGuard（状态、新建隧道和对端） | `luci-proto-wireguard` |
  | OpenVPN | `openvpn-openssl`、`luci-app-openvpn` |
  | DDNS | `ddns-scripts`、`luci-app-ddns`；部分服务商要另装脚本，比如 `ddns-scripts-cloudflare` |
  | SQM 限速 | `sqm-scripts`、`luci-app-sqm` |
  | 广告过滤 | `adblock-fast` 和 `luci-app-adblock-fast`，或者 `adblock` 和 `luci-app-adblock` |

- **HTTPS 自签名证书**：第一次连接时，App 会显示证书指纹请你确认，确认后只信任这一张证书。之后证书如果变了，App 会拦下连接并提示（可能是重置了路由器，也可能有人冒充）。
- **HTTP**：可以用，但密码会以明文在局域网里传输，App 会标注"未加密"。建议在路由器上开启 HTTPS。
- 登录账号默认是 `root`，也可以用其他 rpcd 账号；没有权限或缺少软件包时，相应功能会给出提示。

## 路由器插件

RouteLink 插件装在路由器上，统计每台设备的上传和下载并保存历史，App 和 LuCI 页面（服务 → RouteLink）都能查看。

- **怎么统计**：按设备 MAC 汇总连接跟踪的计数，IPv4、IPv6 都算；开着软件加速（flow offloading）也准确，在 Docker 实验环境里和终端网卡的字节数逐字节一致。
- **保存多久**：按分钟保存 48 小时，按小时保存 90 天，按天保存 2 年；数据在路由器的 `/etc/routelink`，默认每 10 分钟写一次闪存，占用上限 32 MB，升级固件时会保留。
- **占用**：在 x86 上（Docker 实测）52 台设备、5000 个连接时，平时占单核 0.04%，内存 1.7 MB。
- **支持**：OpenWrt 23.05、24.10、25.12，以及基于 25.12 但仍用 opkg 的固件（如 Kwrt）；架构 x86_64、aarch64（cortex-a53、cortex-a72、generic）、arm（cortex-a7、cortex-a9、cortex-a15）、mipsel_24kc、mips_24kc。

**安装**

- **App 一键安装**：更多 → 路由器插件 → 安装插件。需要 root 账号，并且路由器能连上 OpenWrt 官方软件源（补装依赖）。国内访问 GitHub 慢时，可以在同一页填写下载镜像。
- **手动安装**：从 [Releases](https://github.com/tsix2019/RouteLink/releases) 下载对应版本和架构的安装包（`manifest.json` 里有清单），传到路由器上安装。架构可以用 `. /etc/openwrt_release; echo $DISTRIB_ARCH` 查看。

  ```sh
  # OpenWrt 23.05 / 24.10，以及仍用 opkg 的 25.12 固件（如 Kwrt，用 25.12 的 .ipk 包）
  opkg update
  opkg install routelinkd_*.ipk luci-app-routelink_*.ipk luci-i18n-routelink-zh-cn_*.ipk

  # OpenWrt 25.12：先信任 RouteLink 的签名公钥
  wget -O /etc/apk/keys/routelink.pem https://tsix2019.github.io/RouteLink/agent/keys/routelink-apk.pem
  apk update
  apk add routelinkd-*.apk luci-app-routelink-*.apk luci-i18n-routelink-zh-cn-*.apk
  ```

- **添加软件源**（以后可以在 LuCI 的软件包页面升级）。把 `24.10`、`x86_64` 换成你的版本和架构：

  ```sh
  # OpenWrt 23.05 / 24.10，以及仍用 opkg 的 25.12 固件（地址里写 25.12）
  wget -O /etc/opkg/keys/a276fe73982c5f59 https://tsix2019.github.io/RouteLink/agent/keys/a276fe73982c5f59
  echo 'src/gz routelink https://tsix2019.github.io/RouteLink/agent/24.10/x86_64' >> /etc/opkg/customfeeds.conf
  opkg update && opkg install routelinkd luci-app-routelink luci-i18n-routelink-zh-cn

  # OpenWrt 25.12
  wget -O /etc/apk/keys/routelink.pem https://tsix2019.github.io/RouteLink/agent/keys/routelink-apk.pem
  echo 'https://tsix2019.github.io/RouteLink/agent/25.12/x86_64/packages.adb' >> /etc/apk/repositories.d/customfeeds.list
  apk update && apk add routelinkd luci-app-routelink luci-i18n-routelink-zh-cn
  ```

**注意**

- **nlbwmon**：它会把插件读取的连接计数清零，两者同时运行时统计会偏少。App 和 LuCI 页面都会提示，并提供"停用 nlbwmon"按钮。
- **硬件加速**：开了硬件加速（或 Turbo ACC/SFE）以后，走加速通道的流量统计不到，插件会提示"统计可能偏少"。软件加速没有影响。
- **时间**：路由器时间同步之前，数据只保存在内存里；按天、按月的统计以路由器的时区为准。
- **隐私**：数据只保存在你的路由器上；App 只在你点检查更新或安装插件时访问 GitHub。

<img src="docs/screenshots/luci/zh-traffic.png" width="720" alt="LuCI 流量页">

## 安全与隐私

- 路由器密码只存在系统钥匙串（iOS Keychain / Android Keystore），不写日志。也可以选择不保存密码，每次打开 App 时输入。
- 自动发现的探测请求不带任何账号信息。
- App 生成的 SSH 私钥存在钥匙串里，不会离开手机；装到路由器上的只是公钥。
- AI 助手默认不启用。只有你填了自己的 API Key、看过说明并同意后，才会把你的问题和回答需要的路由器数据（状态、设备列表、无线和防火墙设置、系统日志）发给你选的服务商。MAC 地址和公网 IP 默认打码，每类数据都可以单独关闭，密码和密钥永远不会发送。对话只存在手机上。
- 不收集任何统计数据，没有广告，App 不联系任何自有服务器；只在你检查更新、打开自动检查更新或安装插件时访问 GitHub。
- 仓库里的测试数据只来自演示模式和一次性的虚拟路由器（Docker / QEMU），不包含任何真实路由器的数据。

## 从源码构建

需要 Node.js 22。

```bash
npm ci
npx expo run:android   # 需要 Android SDK 和 JDK 17
npx expo run:ios       # 需要 macOS 和 Xcode 26
```

测试：

```bash
npm run typecheck && npm run lint && npm test
scripts/dev-router.sh up   # 用 Docker 启动一台测试用的 OpenWrt
ROUTER_URL=http://127.0.0.1:18080 ROUTER_PASSWORD=routelink-test npm run test:int
```

路由器插件（需要 Docker）：

```bash
scripts/agent-test.sh                    # 守护进程的单元测试（ASan、UBSan）
scripts/agent-build.sh 24.10.8 x86_64    # 用 OpenWrt SDK 编译，输出到 openwrt/out/
scripts/agent-router.sh up && scripts/agent-dev-install.sh && scripts/traffic-lab.sh up
npx jest -c jest.agent.config.js         # 准确性测试
```

## 参与开发

代码按层组织，下层不依赖上层：

```
modules/routelink-native   原生模块：HTTP（证书固定、无 Cookie 罐、不跟随跳转）、网络信息、网络唤醒
src/api/http               HTTP 客户端接口
src/api/ubus               JSON-RPC、登录（ubus / LuCI 回退）、会话续期、批量调用
src/api/connection         RouterConnection：真实路由器和演示路由器
src/api/services           领域服务：系统、网络、设备、无线、服务、日志……（版本差异只在这一层处理）
src/hooks、src/state       React Query 查询、本地状态（路由器、设置）
src/app、src/features      页面和功能组件（expo-router）
src/ui                     iOS 26 风格的组件：玻璃、列表、面板、风险确认、图表
openwrt/                   路由器插件：routelinkd（C 守护进程）、luci-app-routelink（LuCI 页面）、软件源公钥
```

- 设计文档：[docs/superpowers/specs/2026-10-05-routelink-design.md](docs/superpowers/specs/2026-10-05-routelink-design.md)
- M1 实施计划与执行记录：[docs/superpowers/plans/2026-10-05-routelink-m1.md](docs/superpowers/plans/2026-10-05-routelink-m1.md)
- 插件设计：[docs/superpowers/specs/2026-10-05-routelink-agent-design.md](docs/superpowers/specs/2026-10-05-routelink-agent-design.md)
- P1 实施计划与执行记录：[docs/superpowers/plans/2026-10-05-routelink-p1.md](docs/superpowers/plans/2026-10-05-routelink-p1.md)
- M5 设计（二级页面、软件更新）：[docs/superpowers/specs/2026-10-06-routelink-m5-design.md](docs/superpowers/specs/2026-10-06-routelink-m5-design.md)
- M5 实施计划与执行记录：[docs/superpowers/plans/2026-10-06-routelink-m5.md](docs/superpowers/plans/2026-10-06-routelink-m5.md)

## 致谢

功能范围参考了这些开源 OpenWrt App（只参考功能，没有使用它们的代码）：

- [LuCI Mobile](https://github.com/cogwheel0/luci-mobile)
- [OpenWrt Manager](https://github.com/hagaygo/OpenWrtManager)
- [YALA](https://github.com/GiridharSalana/yala)
- [WrtHub](https://github.com/whykang/wrthub-android)
- [WrtPulse](https://github.com/iamvivekkaushik/WrtPulse)

也感谢 [OpenWrt](https://openwrt.org)、[LuCI](https://github.com/openwrt/luci) 和 [Expo](https://expo.dev)。

## 协议

[MIT](LICENSE)
