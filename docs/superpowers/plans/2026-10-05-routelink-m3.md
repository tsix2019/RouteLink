# RouteLink M3 实施计划：第三档的路由器功能

> 主设计：`docs/superpowers/specs/2026-10-05-routelink-design.md`（下文简称"设计"，§ 表示章节）
> 前几期的计划：`2026-10-05-routelink-m1.md`、`2026-10-05-routelink-p1.md`、`2026-10-05-routelink-m2.md`
>
> **前提**：M2 已经完成。插件和你路由器的联调暂停（P1 执行记录 T45），P2、P3 都要在真实网络里联调插件，所以先做 M3。
>
> **执行方式**：和 M2 相同，另加两条。
> - 按顺序逐个完成任务，每个任务做完提交一次；改动了 CI 的任务提交后立刻推送。
> - 逻辑代码走 TDD：先写测试，确认失败；再实现，确认通过。
> - 读写路由器的服务都要有 QEMU 上录制的样本（23.05、24.10、25.12），并在 `test/integration/` 里补集成测试。
> - 界面任务用演示路由器和 Docker 路由器走查；iOS 以 CI 的截图为准。
> - **高风险功能**（VLAN、恢复备份、恢复出厂、固件升级）在 QEMU 上完整执行。这几项测试单独放在 CI 的最后一步，因为它们会改掉测试路由器的状态。
> - **你的路由器**：M3 的功能只读，或者只走到最后确认之前（设计 §21）。真正执行任何一步前都先问你。

**目标**：设计 §24 里 M3 的功能：

| 编号 | 功能 | 风险 |
|---|---|---|
| DV-8 | 家长控制：按时段禁止某台设备上网 | 中 |
| WL-7 | Wi-Fi 定时开关 | 中 |
| NW-3 | VLAN：DSA（`bridge-vlan`）和 swconfig（`switch_vlan`），"端口 × VLAN"矩阵 | 高 |
| NW-8 | VPN 配置：WireGuard 接口和对端的增删改、生成密钥、导出配置和二维码；OpenVPN 导入 `.ovpn`、启停 | 中 |
| NW-9 | DDNS：服务增删改、状态 | 中 |
| NW-10 | SQM：按接口限速、队列算法 | 中 |
| NW-11 | 广告过滤：adblock-fast 和 adblock | 中 |
| MO-9 | 下载备份、恢复备份 | 高（恢复） |
| MO-10 | 恢复出厂设置 | 高 |
| MO-11 | 固件升级：本地文件、官方在线 | 高 |

---

## 0. 和设计不同的决定

1. **家长控制用 fw4 的时间规则，另加一条清连接的计划任务**。
   - 每个禁止时段写成防火墙规则：`src_mac`、`REJECT`、`start_time`、`stop_time`、`weekdays`，名称前缀 `RouteLink: schedule `，和 M1 的拉黑规则一样，在防火墙页只读。
   - 跨午夜的时段（比如 21:00～07:00）拆成两条：当天 21:00～23:59:59，次日 00:00～07:00。这样"星期几"的含义不会错位。
   - fw4 在所有规则之前就放行已经建立的连接（§1 实测），所以规则只挡新连接，正在看的视频不会断。每个时段开始时，由 App 管理的计划任务把这台设备已有的连接清掉（写 `/proc/net/nf_conntrack`，OpenWrt 内核的补丁支持按 IP 清除）。T1 在 QEMU 上确认三个版本都支持；不支持时退回"只挡新连接"，并在页面上说明。
   - fw4 在加载规则时按路由器时区换算成 UTC。有夏令时的时区，切换后要等下一次防火墙重载才对齐。页面上说明。
2. **Wi-Fi 定时开关只用计划任务**：到点执行 `wifi down <射频>` / `wifi up <射频>`，不改无线配置。由 App 管理的条目前一行带 `# RouteLink: wifi-schedule` 注释（M2 的计划任务页已经把这类条目显示为只读）。关闭时段里路由器重启，Wi-Fi 会先开着，到下一个时间点再关。页面上说明。
3. **VLAN 的范围**：
   - 支持两种：DSA 指网桥上的 `bridge-vlan`，任何网桥都适用，x86 也行，所以能在 QEMU 上完整测试；swconfig 需要交换芯片，QEMU 上没有，只做单元测试。swconfig 的样本取自 OpenWrt 源码里几款典型机型的默认配置。
   - 能做的事：查看矩阵；改成员关系（不加入、不打标签、打标签，以及 DSA 的 PVID）；增删 VLAN。DSA 的网桥还没开 VLAN 过滤时，提供"开启 VLAN 过滤"：建 VLAN 1，所有端口不打标签，用到 `br-lan` 的接口改用 `br-lan.1`（和 LuCI 的做法一致）。
   - 新 VLAN 对应的接口、DHCP、防火墙区域不在这里建，页面上提示到 LuCI 里配。
   - 正在被接口使用的 VLAN 不能删。手机所在的端口离开它的 VLAN 时，单独警告。
   - 一律带回滚应用（设计 §11），按高风险流程确认。
4. **WireGuard 配置**：
   - 新建接口时可以选两项，默认都开：把接口加进 `lan` 区域，连上的设备能访问内网也能上网；在 `wan` 区域放行监听端口，规则名 `RouteLink: WireGuard <接口>`。
   - 新建对端时，可以让路由器生成密钥对（`luci.wireguard generateKeyPair`），私钥存在对端段的 `private_key` 里，和 LuCI 的做法相同，用来导出配置文件和二维码。对端的公钥由用户自己填的，没法导出。
   - 导出用的服务器地址依次取：DDNS 域名、WAN 的公网 IPv4，用户也可以改。
   - 客户端的地址自动取接口网段里下一个空闲地址（/32）。
5. **OpenVPN 只导入客户端配置**。上传前在手机上改写 `.ovpn`：需要账号密码时，把 `auth-user-pass` 指向 `/etc/openvpn/<名称>.auth`，再把账号密码写进这个文件。启停就是改 `enabled` 后应用，procd 会按配置启停实例。状态读 `service list`。默认配置里的三个示例实例（`custom_config`、`sample_server`、`sample_client`）在没有启用时不显示。
6. **DDNS**：服务商列表从路由器上读，来自已装的 `/usr/share/ddns/default/*.json`。表单只做常用项：服务商、域名、账号、密码或令牌、IP 来源（WAN 接口或网页检测）、IPv6、启用。默认配置里的两个示例服务（`myddns_ipv4`、`myddns_ipv6`）在没有启用时不显示。
7. **SQM 只做常用项**：接口（默认 WAN）、上下行（Mbit/s）、队列脚本（piece_of_cake、layer_cake、simple、simplest）、链路层（无、以太网、ADSL）和开销。是否生效，看有没有 `ifb4<接口>` 这个设备。
8. **广告过滤**：两个包都装了时，用已启用的那个；都没启用时用 adblock-fast。
   - 能做的事：开关、状态（是否在运行、拦截的域名数、上次更新时间）、规则源开关、立即更新。
   - QEMU 上两个都装。adblock 装好后默认是启用的，安装脚本里先把它关掉，免得影响其他测试的 DNS。
9. **下载备份要改原生模块**。`/cgi-bin/cgi-backup` 返回二进制，原生模块的 HTTP 请求现在只能返回文本。给它加 `responseEncoding: 'base64'`，Android、iOS 和 Node 都要改。
   - 备份文件存在 App 的文档目录，可以分享出去。
   - 恢复时，可以选 App 里的备份，也可以选别的文件。
   - 上传沿用 P1 的 `file write` 分块。
10. **恢复出厂**：执行后路由器回到 `192.168.1.1`，并且没有密码。App 同时探测原地址和 `192.168.1.1`。
    - 地址没变时，用空密码登录，然后带用户去"系统 → 管理密码"设一个密码。
    - 地址变了时，提示用户把手机连到路由器上，再更新这台路由器的地址。
11. **固件升级**：
    - **官方在线**：只对正式版的 OpenWrt 和 ImmortalWrt 提供。条件是 `distribution` 为 OpenWrt 或 ImmortalWrt，版本号形如 `24.10.8`（不是 SNAPSHOT，也没有其他后缀），并且官方 `profiles.json` 里有这台机器的 board 名称。x86 和 armsr 用 `generic` 配置，按当前的根文件系统（squashfs 或 ext4）和是否 EFI 选镜像。
    - **可选版本**：当前系列的最新版，加上 `.versions.json` 里的最新稳定版。不提供降级，降级只能用本地文件。
    - **校验**：手机下载镜像后核对 SHA-256，传到路由器的 `/tmp/firmware.bin`，再用 `system validate_firmware_image` 检查。检查不通过、但允许强制刷入时，要额外勾选才能强制刷。
    - **命令**：命令行必须和 LuCI 的 ACL 完全一致，比如 `/sbin/sysupgrade /tmp/firmware.bin`、`/sbin/sysupgrade -n /tmp/firmware.bin`。
    - **提示**：升级后自己装的软件包（插件、SQM、DDNS 等）需要重装（设计 §1.1：不做保留软件包的 ASU）。
12. **高风险流程做成公共部件**（设计 §10）：
    - 警告页：沿用 `RiskConfirm` 的 high 级别，要勾选"我已了解风险"并输入路由器名称。
    - 新增"先备份"这一步：刷机和恢复备份之前提示。
    - 新增全屏进度页：把 `/reboot` 扩展成 `/maintenance`，有重启、恢复、升级、恢复出厂几种模式。进度页提示"不要断电，不要关闭 App"，等路由器恢复，最多 5 分钟。
13. **演示模式**：上面的功能都能操作，数据和状态都在内存里。刷机、恢复出厂、恢复备份走完整流程，但只是动画（设计 §16）。

## 1. 已确认的接口和权限（Docker 24.10.8 上查过各包的 ACL）

| 功能 | 接口 | 授权来自 |
|---|---|---|
| 家长控制 | uci firewall 的 `rule`（`start_time`、`stop_time`、`weekdays`）；计划任务同 M2 | luci-app-firewall、luci-mod-system |
| Wi-Fi 定时 | 计划任务：`file read/write /etc/crontabs/root`、`file exec /etc/init.d/cron reload` | luci-mod-system |
| VLAN | uci network 的 `device`、`bridge-vlan`、`switch`、`switch_vlan`；`luci-rpc getBoardJSON`；`luci getSwconfigFeatures/getSwconfigPortState`；`network.device status`（网桥 VLAN 的实际状态） | luci-base、luci-mod-network |
| WireGuard | uci network；`luci.wireguard generateKeyPair / generatePsk / getPublicAndPrivateKeyFromPrivate` | luci-proto-wireguard |
| OpenVPN | uci openvpn；`file write /etc/openvpn/*`；`service list` | luci-app-openvpn |
| DDNS | uci ddns；`luci.ddns get_services_status / get_ddns_state / get_env / get_services_log`；`file list/read /usr/share/ddns/default/*`；`luci setInitAction` | luci-app-ddns |
| SQM | uci sqm；`file exec /etc/init.d/sqm enable` 和 `start`；`luci setInitAction` | luci-app-sqm |
| adblock-fast | uci adblock-fast；`luci.adblock-fast getInitStatus / setInitAction / getFileUrlFilesizes` | luci-app-adblock-fast |
| adblock | uci adblock；`file read /var/run/adb_runtime.json`；`file exec /etc/init.d/adblock reload / restart / suspend / resume / stop` | luci-app-adblock |
| 备份 | `/cgi-bin/cgi-backup`（cgi-io backup）；`file exec /sbin/sysupgrade --list-backup` | luci-mod-system |
| 恢复备份 | `file write /tmp/backup.tar.gz`；`file exec /bin/tar -tzf /tmp/backup.tar.gz`、`/sbin/sysupgrade --restore-backup /tmp/backup.tar.gz` | luci-mod-system |
| 恢复出厂 | `file exec /sbin/firstboot -r -y` | luci-mod-system |
| 固件升级 | `file write /tmp/firmware.bin`；`system validate_firmware_image`；`file exec /sbin/sysupgrade [-n] [--force] /tmp/firmware.bin` | luci-mod-system |

另外查到的：

- **fw4 的 forward 链**：第一条就是 `ct state vmap { established : accept, related : accept }`，所以拉黑和定时规则都只挡新连接（§0 第 1 条）。
- **fw4 的时间规则**：渲染成 `meta hour "21:00:00"-"23:59:59"` 和 `meta day { ... }`。`utc_time` 选项会解析，但不起作用。
- **时区**：OpenWrt 的 musl 读 `/etc/TZ`。crond 和 nft 都按路由器时区工作。

---

## 阶段 A：录制样本

### T1. QEMU 测试路由器和样本录制

- **`scripts/ci/qemu-openwrt.sh`**：
  - 再加两块网卡（eth2、eth3），并入 `br-lan`，给 VLAN 测试用。
  - 安装 `ddns-scripts luci-app-ddns sqm-scripts luci-app-sqm adblock-fast luci-app-adblock-fast adblock luci-app-adblock openvpn-openssl luci-app-openvpn`，装完把 adblock 关掉。
  - 输出几项检查结果到日志：`/proc/net/nf_conntrack` 能否按 IP 清除，`ip neigh` 的输出格式，openvpn 的 init 脚本是否支持 `username`/`password`。
- **`scripts/record-fixtures.ts`**：
  - 加上 §1 表里的只读调用：`getBoardJSON`、`network.device status`；uci 的 ddns、sqm、adblock-fast、adblock、openvpn；`luci.ddns get_services_status / get_env`、`luci.adblock-fast getInitStatus`、`file read /var/run/adb_runtime.json`、`file list /usr/share/ddns/default`、`service list`、`sysupgrade --list-backup`。
  - 加上写操作接口对应的 `session access` 检查。
  - adblock-fast 的 `rpcd_token` 在录制时打码。

**提交**：`test: record M3 calls on 23.05, 24.10 and 25.12`

## 阶段 B：领域服务（TDD）

每个服务一个文件，放在 `src/api/services/`，解析函数单独导出并有单元测试；写操作都走 `stageAndApply`。演示路由器在同一个任务里补上对应的处理函数，`contract.test.ts` 加用例。

### T2. 家长控制 `services/parental.ts`（DV-8）

- 模型：每台设备有一组禁止时段 `{ days: 0–6 的集合, from: 'HH:MM', to: 'HH:MM' }`。
- `parseSchedules(firewall, crontab)`：把名称以 `RouteLink: schedule <MAC>` 开头的规则还原成时段，拆开的两条要合回一段。
- `scheduleChanges(mac, periods, existing)`：生成规则的增删改，以及计划任务里清连接的条目（每段的开始时间一条）。
- 校验：开始和结束不能相同；至少选一天。
- **测试**：跨午夜拆分与还原，周日到周一的跨越，多段，删除全部时段。

### T3. Wi-Fi 定时开关 `services/wifi-schedule.ts`（WL-7）

- 模型：`{ radios: 'all' | string[], days, off: 'HH:MM', on: 'HH:MM' }`，可以有多条。
- 生成和解析带 `# RouteLink: wifi-schedule` 标记的计划任务行。开启时间早于关闭时间时，开启那一行的星期加一天。
- 写回用 M2 的 `writeCrontab`，它会检查文件在读取后有没有被别处改过。
- **测试**：普通时段，跨午夜，全部射频和单个射频，和用户自己的条目混在一起时原样保留。

### T4. VLAN `services/vlan.ts`（NW-3）

- `getVlanState`：判断是 DSA 还是 swconfig；读出端口、VLAN、成员关系；标出每个 VLAN 被哪个接口使用，以及手机所在的端口（能判断时）。
- DSA：`bridge-vlan` 的 `ports` 写法是 `lan1:u*`（u 表示不打标签，* 表示 PVID，不写表示打标签）；`enableFilteringChanges` 见 §0 第 3 条。
- swconfig：`switch_vlan` 的 `ports` 写法是 `"1 2 3 0t"`；CPU 端口必须打标签，从 `getBoardJSON` 的交换机定义里读。
- 校验：每个端口最多一个不打标签的 VLAN；VLAN ID 在 1～4094 之间；VLAN 不能和已有的重复。
- **测试**：DSA 和 swconfig 的解析与生成；开启过滤；三项校验。

### T5. WireGuard 配置（NW-8，扩展 `services/wireguard.ts`）

- 接口：新建、编辑（私钥、监听端口、地址、MTU）、删除（同时删掉它的对端和 App 加的防火墙规则）。
- 对端：新建、编辑、删除；生成密钥对和预共享密钥。
- `clientConfig(peer, iface, { endpoint, dns, allowedIps })`：生成 wg-quick 格式的配置文本。
- `nextPeerAddress`：取接口网段里下一个空闲地址。
- **测试**：生成的配置文本；地址分配；删除接口时连带删除的内容。

### T6. OpenVPN `services/openvpn.ts`（NW-8）

- `listInstances`：uci 的实例，加上 `service list` 里的运行状态。
- `importOvpn(name, text, credentials?)`：检查是不是客户端配置，按 §0 第 5 条改写 `auth-user-pass`，上传文件，新建实例。
- `setEnabled`、`deleteInstance`。
- **测试**：识别客户端配置；改写 `auth-user-pass`（原来没写、写了路径、内嵌证书的情况）；名称校验。

### T7. DDNS `services/ddns.ts`（NW-9）

- `getDdns`：服务列表，状态（注册的 IP、上次更新、下次更新、是否在运行）；服务商列表。
- `serviceChanges`：增删改。保存后重启 ddns（`luci setInitAction ddns restart`）。
- **测试**：解析状态（包括"已停止"、没有记录的情况）；隐藏示例服务；生成的修改。

### T8. SQM `services/sqm.ts`（NW-10）

- `getSqm`：队列列表；是否生效；可用的队列脚本。
- `queueChanges`：Mbit/s 换算成 kbit/s；第一次启用时执行 `/etc/init.d/sqm enable`。
- **测试**：换算、默认值、生成的修改。

### T9. 广告过滤 `services/adblock.ts`（NW-11）

- `detectAdblock`：装了哪个、用哪个（§0 第 8 条）。
- adblock-fast：`getInitStatus` 解析成统一的状态；规则源是 `file_url` 段；`setInitAction start/stop/restart`。
- adblock：状态读 `adb_runtime.json`；规则源是 `adb_feed` 列表；`/etc/init.d/adblock reload|restart|stop`。
- **测试**：两种状态解析；规则源开关生成的修改。

### T10. 备份与恢复 `services/backup.ts`（MO-9）

- 原生模块：`httpRequest` 加 `responseEncoding: 'base64'`（Kotlin、Swift、Node）。
- `RouterConnection.downloadBackup()`：LiveConnection 走 cgi-backup；演示路由器返回一个小的 tar.gz。
- `uploadBackup`（`file write` 分块）、`listBackupFiles`（`tar -tzf`）、`restoreBackup`（`sysupgrade --restore-backup`，然后重启）。
- 恢复前检查：解压列表里必须有 `etc/config/`。
- **测试**：base64 解码；列表检查；命令行和 ACL 完全一致。

### T11. 恢复出厂 `services/maintenance.ts`（MO-10）

- `factoryReset`：`firstboot -r -y`（会自己重启）。
- `findRouterAfterReset(oldUrl)`：同时探测原地址和 `http://192.168.1.1`。
- 进度页的状态机从 `/reboot` 抽出来，放到 `features/maintenance/`。

### T12. 固件升级 `services/firmware.ts`（MO-11）

- `firmwareInfo(conn)`：发行版、版本、目标平台、board 名称、根文件系统类型、能不能在线升级。
- `findOfficialImages(info, fetchJson)`：读 `.versions.json` 和 `profiles.json`，按 §0 第 11 条选出镜像（URL、SHA-256、大小）。
- `uploadFirmware`、`validateFirmware`、`sysupgrade(keep, force)`。
- **测试**：用 OpenWrt 官方的 `profiles.json` 片段测匹配（几款路由器加 x86），覆盖正式版、快照版、第三方固件、没有匹配到的情况；命令行和 ACL 完全一致。

## 阶段 C：界面

新增文字放进对应的命名空间，中英文都要有。

| 任务 | 页面 | 入口 |
|---|---|---|
| T13 | 高风险流程：先备份、全屏进度页 `/maintenance` | 供 T16、T22～T24 使用 |
| T14 | 家长控制：时段列表、编辑面板 | 设备详情面板加一行"上网时间" |
| T15 | Wi-Fi 定时开关 | 无线 Tab 的新一行 |
| T16 | VLAN 矩阵 | 网络 Tab 的"接口"分组 |
| T17 | WireGuard：接口编辑、对端编辑、导出（二维码和配置文本） | M2 的 WireGuard 页加编辑；没有接口时显示"新建" |
| T18 | OpenVPN | 网络 Tab 的新分组"VPN" |
| T19 | DDNS | 网络 Tab 的新分组"服务" |
| T20 | SQM | 同上 |
| T21 | 广告过滤 | 同上 |
| T22 | 备份与恢复 | 更多 Tab 的新分组"维护" |
| T23 | 固件升级 | 同上 |
| T24 | 恢复出厂设置（红色） | 同上 |

每个页面都要：
- 有加载骨架、空状态、错误状态，支持下拉刷新。
- 写操作用 `RiskConfirm`，按设计 §10 的级别。
- 缺软件包时用 `FeatureGate` 说明要装哪个，并能跳到软件包页。
- 演示模式下能完整操作。

## 阶段 D：测试与发布

### T25. QEMU 集成测试（普通）

`test/integration/m3.int.test.ts`，三个版本都跑：
- **家长控制**：加一个时段，读回，用 SSH 看 `nft list chain inet fw4 forward` 里有对应的 `meta hour` 和 `meta day`；在 SSH 里执行一次清连接的命令；删除。
- **Wi-Fi 定时开关**：把关闭和开启时间设在接下来的两分钟内，等射频真的关掉再打开，然后删除这条定时。
- **WireGuard**：新建接口 wg1 和一个对端，生成密钥，导出配置，删除。
- **OpenVPN**：导入一个客户端配置（服务器地址连不上也没关系），启用后实例在运行，停用，删除。
- **DDNS**：在测试机上起一个 HTTP 服务，用自定义更新地址加一个服务，等收到更新请求，再删除。
- **SQM**：在 eth1 上启用，看到 `ifb4eth1`，停用。
- **广告过滤**：adblock-fast 启用、等状态变成运行中、停用；adblock 同样走一遍。
- **备份**：下载备份，检查是 gzip 格式，里面有 `etc/config/network`。

### T26. QEMU 集成测试（高风险，CI 最后一步）

`test/integration/m3.risky.test.ts`，按顺序执行，不和普通测试一起跑：
1. **VLAN**：
   - 开启 VLAN 过滤：带回滚应用并确认，`network.device status` 里能看到 VLAN。
   - 加 VLAN 10，在 eth2、eth3 上打标签。
   - 把 eth0 移出 VLAN 1，模拟用户自己断网：App 确认不了，路由器自动回滚，能重新连上。
   - 关闭过滤，恢复原样。
2. **恢复备份**：
   - 备份，然后改主机名。
   - 恢复备份，路由器重启后主机名变回原来的。
3. **固件升级**：用同一版本的官方镜像，走"在线"流程（从官方下载站查找、下载、校验、上传、检查），保留配置刷入。重启后版本相同，配置还在。
4. **恢复出厂**：执行后能用空密码登录，测试数据都不在了。

### T27. 截图、README、执行记录

- 截图：新增家长控制、VLAN、WireGuard 导出、DDNS、固件升级五页，中英文、深浅色。
- README：功能清单里 M3 的项改成 ✅；路由器要求里补上各功能对应的可选包。
- 执行记录里的结论同步进设计文档，设计 §24 把 M3 标成完成。

### T28. 在你的路由器上走查（需要你在场）

- 在 Android 模拟器上连你的路由器，逐个打开 M3 的页面。只读功能直接看；写操作只走到最后确认之前，不真正执行，除非你当时明确同意。
- 你家的主路由器用的是第三方固件，固件升级页会显示"非官方固件，只能用本地文件"，这是预期结果。

### T29. 发布

- 打标签前征得你的同意。版本号视 v0.2.0 是否已经发布而定，产物和 v0.1.0 相同（APK 和未签名 IPA）。

---

## 执行记录（实施过程中填写）

| 项目 | 结论 |
|---|---|
