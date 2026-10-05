<p align="center"><img src="assets/images/icon.png" width="96" alt="RouteLink"></p>

<h1 align="center">RouteLink</h1>

<p align="center"><b>中文</b> | <a href="README.en.md">English</a></p>

<p align="center">
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/ci.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/ios.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/ios.yml/badge.svg" alt="iOS"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/android.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/android.yml/badge.svg" alt="Android"></a>
  <a href="https://github.com/tsix2019/RouteLink/actions/workflows/integration.yml"><img src="https://github.com/tsix2019/RouteLink/actions/workflows/integration.yml/badge.svg" alt="OpenWrt"></a>
  <a href="https://github.com/tsix2019/RouteLink/releases"><img src="https://img.shields.io/github/v/release/tsix2019/RouteLink?include_prereleases" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tsix2019/RouteLink" alt="MIT"></a>
</p>

RouteLink 是一款管理 OpenWrt 路由器的手机 App，支持 iOS 和 Android，界面有中文和英文。

- **iOS 26 风格**：iOS 上用系统原生的液态玻璃（Tab 栏、导航栏、底部面板）；Android 上也按 iOS 26 的样式绘制：悬浮玻璃 Tab 栏、大标题导航栏、圆角分组列表。
- **自动发现**：扫描手机所在的局域网，找出 OpenWrt 设备，旁路由也能找到；也可以扫描指定网段或手动输入地址。
- **多路由器**：添加多台路由器，在页面左上角一键切换。
- **改配置更安全**：所有改动都走 OpenWrt 自带的"应用 + 确认"机制，App 联系不上路由器时，路由器会在 90 秒后自动撤销改动；会断网的操作都有分级的风险提示。
- **演示模式**：没有路由器也能先试用，内置一台模拟的 OpenWrt 路由器。
- **隐私**：不收集任何数据，App 只和你添加的路由器通信。

> 第一个里程碑（M1）已完成，后续功能见下面的功能清单。

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

其余截图在 [docs/screenshots/zh](docs/screenshots/zh)。

## 功能

✅ 已完成（M1）　🚧 计划中（括号里是里程碑）

**概览**

- ✅ 系统信息：型号、固件、内核、主机名、运行时间
- ✅ 资源：负载、内存、存储、温度（路由器支持时）
- ✅ 外网状态：协议、IP、网关、DNS、在线时长
- ✅ 实时流量曲线、在线设备数
- ✅ 重启路由器（带进度和恢复检测）
- 🚧 Wi-Fi 二维码分享（M2）、问 AI（M4）

**设备**

- ✅ 设备列表：合并 DHCP 租约、邻居表和无线终端；在线/离线、有线/无线筛选；搜索；信号强度；厂商识别
- ✅ 改名（写到路由器上；符合主机名规则的名字在 LuCI 和局域网 DNS 里也能看到）
- ✅ 绑定静态 IP、拉黑（禁止上网）、踢下线
- ✅ 网络唤醒（路由器装了 etherwake 时由路由器发送；否则 Android 手机直接发送）
- 🚧 单台设备流量统计（M2）、家长控制（M3）

**无线**

- ✅ 射频设置：开关、信道、频宽、发射功率、国家码
- ✅ Wi-Fi 设置：名称、密码、加密方式、隐藏、启用。手机正连着这个 Wi-Fi 时，会提示并引导重新连接
- ✅ 扫描周边 Wi-Fi
- 🚧 访客网络、MAC 过滤（M2），定时开关（M3）

**网络**

- ✅ 接口列表和详情、重连接口
- 🚧 WAN/LAN 设置、路由表、实时连接、防火墙、WireGuard 状态、流量历史、诊断工具（M2）
- 🚧 VLAN、VPN 配置、DDNS、SQM、广告过滤（M3）

**更多**

- ✅ 服务管理：启动、停止、重启、开机自启
- ✅ 系统日志、内核日志（筛选、分享）
- ✅ 网络唤醒常用设备列表
- ✅ 管理路由器（排序、编辑、删除、证书）、语言、外观、刷新间隔、降低透明度、演示模式
- 🚧 进程、软件包、计划任务、LED、修改密码（M2）
- 🚧 备份与恢复、恢复出厂、固件升级（M3，均为高风险操作，需要多重确认）
- 🚧 SSH 终端、测速、AI 助手、桌面小组件、掉线通知（M4）

## 安装

- **Android**：从 [Releases](https://github.com/tsix2019/RouteLink/releases) 下载 `RouteLink-<版本>.apk` 安装。
- **iOS**：没有上架 App Store。Releases 里提供未签名的 `RouteLink-unsigned.ipa`，可以用 [AltStore](https://altstore.io)、[SideStore](https://sidestore.io)、Sideloadly 用自己的 Apple ID 签名安装；支持 TrollStore 的 iOS 版本也可以用 TrollStore 安装。

## 路由器要求

- OpenWrt 21.02 或更新版本，装有 LuCI 网页管理界面。CI 在 OpenWrt **23.05、24.10、25.12** 上实测；ImmortalWrt 等衍生版尽量兼容。
- 默认需要的软件包都随 LuCI 一起安装：`rpcd`、`uhttpd-mod-ubus`、`rpcd-mod-luci`、`rpcd-mod-iwinfo`、`rpcd-mod-file`。
- 可选软件包：

  | 功能 | 软件包 |
  |---|---|
  | 由路由器发送网络唤醒包 | `luci-app-wol`（带 `etherwake`）。OpenWrt 25.12.5 上 LuCI 的唤醒接口有问题，Android 会自动改由手机发送 |
  | HTTPS 访问 | 较新的固件默认已带；旧版本安装 `luci-ssl` |

- **HTTPS 自签名证书**：第一次连接时，App 会显示证书指纹请你确认，确认后只信任这一张证书。之后证书如果变了，App 会拦下连接并提示（可能是重置了路由器，也可能有人冒充）。
- **HTTP**：可以用，但密码会以明文在局域网里传输，App 会标注"未加密"。建议在路由器上开启 HTTPS。
- 登录账号默认是 `root`，也可以用其他 rpcd 账号；没有权限或缺少软件包时，相应功能会给出提示。

## 安全与隐私

- 路由器密码只存在系统钥匙串（iOS Keychain / Android Keystore），不写日志。也可以选择不保存密码，每次打开 App 时输入。
- 自动发现的探测请求不带任何账号信息。
- 不收集任何统计数据，没有广告，App 不联系任何自有服务器。
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
src/ui                     iOS 26 风格的组件：玻璃、列表、面板、风险确认
```

- 设计文档：[docs/superpowers/specs/2026-10-05-routelink-design.md](docs/superpowers/specs/2026-10-05-routelink-design.md)
- M1 实施计划与执行记录：[docs/superpowers/plans/2026-10-05-routelink-m1.md](docs/superpowers/plans/2026-10-05-routelink-m1.md)

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
