# RouteLink M2 实施计划：第二档和零碎功能

> 主设计：`docs/superpowers/specs/2026-10-05-routelink-design.md`（下文简称"设计"，§ 表示章节）
> 插件设计：`docs/superpowers/specs/2026-10-05-routelink-agent-design.md`（下文简称"插件设计"）
> M1 计划：`docs/superpowers/plans/2026-10-05-routelink-m1.md`；P1 计划：`docs/superpowers/plans/2026-10-05-routelink-p1.md`
>
> **前提**：M1 和 P1 的 App 部分已经完成。P1 的发布和你路由器上的联调另外进行，不阻塞 M2。
>
> **执行方式**：和 M1、P1 相同。
> - 按顺序逐个完成任务，每个任务做完提交一次；改动了 CI 的任务提交后立刻推送。
> - 逻辑代码走 TDD：先写测试，确认失败；再实现，确认通过。
> - 读写路由器的服务都要有 QEMU 上录制的样本（23.05、24.10、25.12），并在 `test/integration/` 里补集成测试。
> - 界面任务在 Android 模拟器上用演示路由器和 Docker 路由器走查；iOS 以 CI 的截图为准。

**目标**：设计 §24 里 M2 的功能（插件设计 §4.2 已经把 DV-7、NW-12、NW-13 移走）：

| 编号 | 功能 | 风险 |
|---|---|---|
| OV-6、WL-4 | Wi-Fi 二维码：概览的快捷操作，以及每个 SSID 的"分享"按钮 | 低 |
| WL-5 | 访客网络：一键创建、开关、删除 | 中 |
| WL-6 | MAC 过滤：白名单或黑名单 | 中 |
| NW-2 | WAN/LAN 设置：协议、DNS、MTU、LAN IP、DHCP 地址池 | 中 |
| NW-4 | 路由表查看、静态路由增删改 | 中 |
| NW-5 | 实时连接，带反向 DNS | 低 |
| NW-6 | 防火墙：区域查看；端口转发、通信规则的增删改和启停 | 中 |
| NW-7 | WireGuard 状态 | 低 |
| MO-4 | 进程列表、结束进程 | 中 |
| MO-5 | 软件包：列表、搜索、安装、卸载、更新列表 | 中 |
| MO-6 | 计划任务 | 中 |
| MO-7 | LED 灯 | 低 |
| MO-8 | 修改管理密码、时区、同步手机时间 | 中 |

---

## 0. 和设计不同的决定

1. **访客网络只在"既有 Wi-Fi 又负责路由"的路由器上一键创建**。
   - 判断方法：有 `wifi-device`，并且防火墙里有开了 masquerade 的 WAN 区域。
   - 插件设计 §2 记录了你的网络是"x86 主路由 + 单独的 OpenWrt AP"：AP 有 Wi-Fi 但不负责路由，访客网络要和主路由一起配，放到 P2 的网络组之后做。
   - M2 在 AP 上打开访客网络页时，说明原因，不提供创建按钮。
2. **MAC 过滤按单台路由器做**。多台 AP 的同名 SSID 同步放到 P2（插件设计 NG-4）。
3. **修改 LAN IP**：按设计 §11 的流程做，先在 QEMU 上验证"rpcd 会话在新地址上是否有效"（A6），按结果定做法。提交前提示：局域网里设了静态地址或网关的设备（比如 AP）要跟着改。
4. **软件包**复用 P1 的 `services/packages.ts`（经 `/cgi-bin/cgi-exec` 调用 LuCI 的辅助程序），不另写一套。
5. **二维码**用纯 JS 的编码库（`qrcode-generator`，没有原生代码），用 `react-native-svg` 画出来。
6. **时区**：插件按路由器时区统计每天和每月；P1 已经让插件在系统配置变化时重新读取时区，M2 改时区后不用额外处理。

## 1. 已确认的接口和权限（Docker 24.10.8 上查过 LuCI 的 ACL）

| 功能 | 接口 | 授权来自 |
|---|---|---|
| 进程 | `luci getProcessList`；结束进程 `file exec /bin/kill -<信号> <pid>` | luci-mod-status |
| 实时连接 | `luci getConntrackList`；反向解析 `network.rrdns lookup` | luci-mod-status |
| 路由表 | `file exec /sbin/ip -4 route show table all`（`-6` 同理） | luci-mod-status |
| 计划任务 | `file read/write /etc/crontabs/root`；`file exec /etc/init.d/cron reload` | luci-mod-system |
| LED | `luci getLEDs`；uci system 的 `led` 段 | luci-mod-system |
| 密码、时间 | `luci setPassword`、`luci getTimezones`、`luci setLocaltime`；uci system | luci-mod-system |
| 防火墙 | uci firewall | luci-app-firewall |
| WireGuard | `luci.wireguard getWgInstances` | luci-proto-wireguard（可选） |
| 软件包 | `package-manager-call list-installed / list-available / install / remove / update`（23.05 是 `opkg-call`） | luci-app-package-manager / luci-app-opkg |

每个接口在 23.05、25.12 上的差异，由 T1 录制的样本确认，写进"执行记录"。

---

## 阶段 A：录制样本

### T1. 扩展样本录制

- `scripts/record-fixtures.ts` 的 `CALLS` 加上 §1 表里的只读调用：`luci getProcessList`、`getConntrackList`、`getLEDs`、`getTimezones`、`getLocaltime`、`ip route show table all`（-4、-6）、`file read /etc/crontabs/root`、`uci get firewall`（已有）、`luci.wireguard getWgInstances`、两个辅助程序的 `list-installed`，以及对应的 `session access`。
- `scripts/ci/qemu-openwrt.sh`：给测试路由器加一条计划任务、一个 WireGuard 接口（装 `luci-proto-wireguard`）和一条端口转发，让样本里有数据。
- 推送后从 integration 工作流下载三个版本的样本，提交到 `test/fixtures/openwrt-<版本>/`。

**提交**：`test: record M2 calls on 23.05, 24.10 and 25.12`

## 阶段 B：领域服务（TDD）

每个服务一个文件，放在 `src/api/services/`，解析函数单独导出并有单元测试；写操作都走 M1 的 `stageAndApply`（会断网的带回滚，见设计 §11）。演示路由器在同一个任务里补上对应的处理函数，`contract.test.ts` 加用例。

### T2. 二维码 `features/wireless/wifiQr.ts`

- `wifiQrString({ ssid, key, encryption, hidden })`：`WIFI:T:WPA;S:...;P:...;H:true;;`。`\ ; , : "` 要转义；开放网络用 `T:nopass`；WPA3（`sae`）也写 `WPA`（手机都认）。
- 依赖：`qrcode-generator`。`QrCode` 组件把模块矩阵画成 SVG。
- **测试**：转义、开放网络、隐藏网络；矩阵尺寸。

### T3. 进程 `services/processes.ts`（MO-4）

- `listProcesses(conn)`：解析 `getProcessList`（PID、PPID、用户、状态、内存、CPU、命令）。
- `signalProcess(conn, pid, signal: 'TERM' | 'KILL' | 'HUP')`。
- 内核线程（命令以 `[` 开头）和 PID 1 不允许结束。

### T4. 计划任务 `services/cron.ts`（MO-6）

- 解析 crontab：每行五个时间字段加命令；注释和空行原样保留；`# RouteLink:` 注释留给 M3 的 Wi-Fi 定时开关。
- `validateCronLine`：字段数、取值范围、`*/n`、列表、范围。
- 写回后执行 `/etc/init.d/cron reload`。
- 写回前比较读取时的内容，内容变了就提示"别处修改过"（文件没有 uci 的暂存机制）。

### T5. LED `services/leds.ts`（MO-7）

- `getLeds`：`luci getLEDs`（名称、触发方式列表、当前触发方式、亮度）合并 uci system 的 `led` 段。
- 编辑：开关（`trigger none` + `default 0/1`）、换触发方式（`timer`、`heartbeat`、`netdev` 等，`netdev` 要选接口和模式）。不走回滚，直接应用。

### T6. 系统设置 `services/system-settings.ts`（MO-8）

- `setAdminPassword(conn, username, password)`：`luci setPassword`；成功后 App 更新保存的密码（M1 的 `routers.update`），避免下一次请求登录失败。
- 时区：`getTimezones` 和 uci system 的 `zonename`、`timezone`，直接应用。
- 同步时间：`luci setLocaltime { localtime: 手机时间 }`，界面上显示两边的时间差。

### T7. 路由 `services/routes.ts`（NW-4）

- 解析 `ip -4/-6 route show table all`：目标、网关、设备、协议、metric、表。
- 静态路由：uci network 的 `route`/`route6` 段增删改，走带回滚的应用。
- 校验：CIDR、网关在某个接口的网段里。

### T8. 实时连接 `services/conntrack.ts`（NW-5）

- 解析 `getConntrackList`；按设备（源地址）分组，按流量排序。
- 反向解析：去重后的远端地址分批调用 `network.rrdns lookup`（每批最多 100 个，超时 3 秒），结果缓存 10 分钟。

### T9. 防火墙 `services/firewall.ts`（NW-6）

- 区域：名称、接口、输入/输出/转发策略、masquerade、区域间转发（只读）。
- 端口转发（`redirect`，`target DNAT`）和通信规则（`rule`）的增删改、启停（`enabled 0`）。
- M1 拉黑设备用的规则（名称以 `RouteLink: block` 开头）标成"由 App 管理"，在这里只读。
- 校验：端口和范围格式；同一外部端口的转发重复时提示冲突。
- 走带回滚的应用。

### T10. WireGuard 状态 `services/wireguard.ts`（NW-7）

- `getWgInstances`：接口、公钥、监听端口；每个对端的名称（uci 里的 `description`）、端点、允许的地址、最近握手、收发字节。
- 没装 luci-proto-wireguard 时，功能检测返回"缺少软件包"。

### T11. WAN/LAN 设置 `services/interfaces-config.ts`（NW-2）

- WAN：协议 DHCP、静态（IP、掩码、网关）、PPPoE（账号、密码），自定义 DNS，MTU。
- LAN：IP 和掩码；DHCP 地址池（起始、数量、租期）。
- **改 LAN IP 的验证 A6**（QEMU 上做，结论写进执行记录）：apply 之后，原会话在新地址上还能不能 confirm。
  - 能：按设计 §11——App 临时把路由器地址改成新 IP，连上后确认；确认失败时路由器回滚，App 把地址改回去。
  - 不能：改为"不回滚 + 明确提示"，并在提交前要求勾选"我知道手机需要重新连接"。
- 校验：IP、掩码、网关在同一网段；DHCP 地址池在 LAN 网段内；LAN 和 WAN 网段不重叠。

### T12. 访客网络 `services/guest.ts`（WL-5）

- `detectGuestSupport`：有没有 Wi-Fi，有没有开了 masquerade 的 WAN 区域（§0 第 1 条）。
- 创建（一组修改，带回滚应用）：
  - network：接口 `guest`，静态地址，默认网段 `192.168.<x>.1/24`，`x` 取一个没被占用的。
  - dhcp：`guest` 段，地址池 100～250。
  - firewall：区域 `guest`（input REJECT、output ACCEPT、forward REJECT），转发 `guest → wan`，规则放行 guest 到路由器的 DHCP（67/udp）和 DNS（53）。
  - wireless：每个选中的射频一个 `wifi-iface`，`network guest`、`isolate 1`、名称、密码和加密方式。
  - 所有新段都用固定名字（`guest`、`guest_dhcp`、`guest_dns` 等），这样能识别出"App 创建的访客网络"，开关和删除都只动这些段。
- 开关：只切换 `wifi-iface` 的 `disabled`。删除：去掉所有这些段。

### T13. MAC 过滤 `services/macfilter.ts`（WL-6）

- 每个 `wifi-iface` 的 `macfilter`（disable / allow / deny）和 `maclist`。
- 改手机当前连着的 SSID 时，按设计 §11 的规则不走回滚；白名单里没有手机自己的 MAC 时，提交前警告"手机会被断开"。

### T14. 软件包页的服务（MO-5）

- 在 `services/packages.ts` 里加：`listInstalled`（opkg 的 status 文件格式；apk 的 `list -I --full` 格式）、`searchAvailable`（关键字，结果最多 200 条）、`installByName`、`removeByName`（复用 `removePackages`）、`updateLists`。
- 安装和卸载都是"中"风险，要确认；卸载 `luci-base`、`rpcd`、`uhttpd` 这类 App 依赖的包时，提示会导致 App 连不上（不禁止）。

## 阶段 C：界面

新增文字放进对应的命名空间（`wireless`、`network`、`more`），中英文都要有。

| 任务 | 页面 | 入口 |
|---|---|---|
| T15 | 二维码面板（全屏，亮度最高） | 概览快捷操作"Wi-Fi 二维码"（多个 SSID 时先选）；SSID 编辑页右上角"分享" |
| T16 | 访客网络页 | 无线 Tab 的新分组"访客网络" |
| T17 | MAC 过滤页 | SSID 编辑页的一行 |
| T18 | WAN 设置、LAN 设置 | 网络 Tab 的接口详情页加"编辑" |
| T19 | 路由表 | 网络 Tab 的"路由" |
| T20 | 实时连接 | 网络 Tab 的"实时连接"；设备详情面板加一行"连接" |
| T21 | 防火墙（区域、端口转发、规则） | 网络 Tab 的"防火墙" |
| T22 | WireGuard 状态 | 网络 Tab（装了才显示） |
| T23 | 进程 | 更多 → 进程 |
| T24 | 软件包（已安装、可安装、更新列表） | 更多 → 软件包 |
| T25 | 计划任务 | 更多 → 计划任务 |
| T26 | LED | 更多 → LED（路由器有 LED 才显示） |
| T27 | 系统：管理密码、时区、时间 | 更多 → 系统 |

每个页面都要：加载骨架、空状态、错误状态、下拉刷新；写操作用 `RiskConfirm`（按设计 §10 的级别）；演示模式下能完整操作。

## 阶段 D：测试与发布

### T28. QEMU 集成测试

`test/integration/m2.int.test.ts`，三个版本都跑：
- 进程列表能读到 `uhttpd`；结束一个测试先通过 SSH 启动的 `sleep` 进程。
- 计划任务：加一行、读回、删除。
- 静态路由：加一条（带回滚，confirm），读回，删除。
- 防火墙：加一条端口转发，读回，停用，删除。
- 访客网络：在 hwsim 射频上创建、读回、删除（只在有 WAN 区域的 QEMU 路由器上）。
- MAC 过滤：设黑名单、读回、关闭。
- 时区：改成 Asia/Shanghai 再改回。
- 软件包：列出已安装；搜索 `luci-app`；更新列表。安装和卸载一个很小的包（比如 `tcpdump-mini`）。
- A6：改 LAN IP 的会话验证（见 T11）。

### T29. 截图、README、执行记录

- 截图：新增访客网络、防火墙、实时连接、软件包、进程五页，中英文、深浅色。
- README：功能清单里 M2 的项改成 ✅。
- 执行记录里的结论同步进设计文档；设计 §24 把 M2 标成完成。

### T30. 发布 v0.2.0

- 打标签前征得你的同意。产物同 v0.1.0（APK 和未签名 IPA）。

---

## 执行记录（实施过程中填写）

| 项目 | 结论 |
|---|---|
| T1 各版本接口差异 | 三个版本都录到了。差异：① 23.05 的 `ip` 是 busybox 版，输出没有 `proto`，字段之间有双空格；24.10 和 25.12 是 iproute2 格式。解析按"关键字 值"读，两种都支持。② **`luci getLocaltime` 谁都调不了**（root 也是 Access denied，三个版本的 ACL 里都没有它）。LuCI 自己的系统页用的是 `system info` 的 `localtime`（本地时间秒数），App 改成同样的做法，再用 uci 的 POSIX 时区串（含夏令时规则）换算回 UTC。③ x86 上 `getLEDs` 是空的。④ WireGuard 对端还没握手时，`getWgInstances` 的 `endpoint` 是 `(none)`，`allowed_ips` 是空数组（LuCI 只在有端点时才填）。⑤ QEMU 初始化脚本里 `uci -q delete` 在 `set -e` 下对不存在的段返回 1，导致第一次录制失败，已修 |
| T11 A6：改 LAN IP 后会话是否有效 | **有效**，23.05、24.10、25.12 都一样：用回滚方式把 LAN 从 192.168.1.1 改到 192.168.1.5，原会话在新地址上 `uci confirm` 成功（中间几秒连不上），再用同样的方法改回去也成功。rpcd 的会话在网络重载后仍然有效。所以按设计 §11 做：App 临时用新地址连接并确认；确认不了时路由器 60～90 秒后自动改回 |
| T12 访客网络在 QEMU 上的实测 | |
| T14 opkg 和 apk 的已安装列表格式 | 23.05、24.10：`list-installed` 输出 opkg 的 status 文件（`Package:` 块，带 `Auto-Installed: yes` 标记依赖安装的包）；`list-available` 是各软件源列表解压后的同样格式。25.12：输出 apk 的 JSON 数组（`name`、`version`、`description`、`installed-size`、`depends`……，没有"是否手动安装"的信息）。列表走 cgi-exec（可用列表有几 MB）。可用列表在 Docker 24.10 上实测超过 1000 个包 |
