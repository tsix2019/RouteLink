# RouteLink P2 实施计划：网络组 + 无线

> 设计文档：`docs/superpowers/specs/2026-10-05-routelink-agent-design.md`（下文简称"设计"，§ 表示章节）
> 主设计：`docs/superpowers/specs/2026-10-05-routelink-design.md`（下文简称"主设计"）
> 前几期的计划：`2026-10-05-routelink-p1.md`（下文简称"P1 计划"）、`m2`、`m3`、`2026-10-06-routelink-m4.md`
>
> **前提**：P1、M2～M4 都已完成，App 版本 1.0.0，插件 0.1.0。P2、P3、P4 三期在同一个分支里连续实施，最后一起提一个 PR（你的要求）。P3、P4 的计划见 `2026-10-06-routelink-p3.md`、`2026-10-06-routelink-p4.md`。
>
> **执行方式**：和 P1 相同。
> - 按顺序完成任务，每个任务做完提交一次。
> - 逻辑代码走 TDD：守护进程的纯 C 部分在 `core/` 里，用 `scripts/agent-test.sh` 在 Docker 里跑单元测试（ASan + UBSan）；App 的逻辑用 Jest。
> - 守护进程的系统接入（nl80211）只能在有无线的环境里跑：本机 Docker 没有 `mac80211_hwsim`，所以无线部分在 CI 的 QEMU（已经有三个 hwsim 射频）上做集成测试。
> - 界面用演示路由器走查。
> - **你的路由器**：联调需要你在场，只读，或者只做可撤销的写操作，每次先问你（和以前的约定相同）。

**目标**（设计 §19、§22）：

| 编号 | 功能 | 风险 |
|---|---|---|
| AG-9 | 无线采样（§5.2）：终端、信道繁忙度、连接和断开事件 | 低 |
| AG-5/6 | `stations`、`signal`、`survey` 三个方法；信任列表；LuCI 无线页 | 低 |
| NG-1 | 路由器角色和建组，含自动建议 | 低 |
| NG-2 | 切换面板分组显示 | 低 |
| NG-3 | 设备合并：所在 AP、漫游 | 低 |
| NG-4 | 无线 Tab 按 AP 分组；同名 SSID 同步修改 | 中 |
| NG-5 | 踢下线自动发到所在 AP；AP 离线的处理 | 中 |
| WF-1 | 实时信号监测 | 低 |
| WF-2 | 信道扫描与优化 | 中 |
| WF-3 | 查蹭网 | 中 |
| WF-4 | Wi-Fi 安全检查和一键修复 | 中 |

完成标准（设计 §22）：主路由和 AP 编成一组后设备合并显示；信号、信道推荐、查蹭网、安全检查可用；QEMU 无线测试通过。真实网络里的验收要你在场，放到三期最后一起做。

---

## 0. 和设计不同的决定

1. **插件的能力清单**。设计里 App 只靠 `info.modules` 判断模块是否开启，分不清"插件太旧"和"模块被关掉"。`info` 增加 `capabilities` 数组，列出这个版本支持的全部模块（`traffic`、`wifi`、`latency`、`speedtest`、`limits`、`quotas`、`dns`、`notify`），`modules` 仍然只列已开启的。新增方法都是兼容的改动，接口版本号 `api` 保持 1。
2. **无线采样用 nl80211，不经过 iwinfo**。通过 libmnl 发 generic netlink，不引入 libnl。用到的 nl80211 常量都很老（4.x 内核就有），直接包含 `<linux/nl80211.h>`。EHT（Wi-Fi 7）的速率字段不读，协商速率用 `NL80211_RATE_INFO_BITRATE32` 已经够用。
3. **AP 的设备表**。AP 上没有流量统计，但终端的 MAC 也进设备表，事件引用它的序号；`devices` 在 AP 上返回终端（`online` 取"是否已连接"）。
4. **信号历史的存储**。新增一个通用的定长记录日志 `core/series`：32 字节的记录、开头 4 字节是时间戳，追加写入，按保留期裁剪，按时间范围扫描。信号、延迟、断网（P3）都用它。不改 P1 的 `core/store`。
   - 文件：`signal.minute`（默认 7 天）、`signal.hour`（30 天）。
   - 最近 5 分钟的逐秒数据只在内存里：每台终端一个 300 项的环形缓冲，只在实时租约期间每秒写入，平时每 10 秒写入。
5. **`stations` 也能续期实时租约**：参数 `live: true`。AP 上没有流量页，单台终端的实时曲线靠它每秒刷新。
6. **连接和断开事件**：事件类型 `wifi_connect`、`wifi_disconnect`，`value` 是当时所在接口的频率（MHz），App 据此换算频段。漫游记录由 App 合并组内各台 AP 的事件得到。
7. **信任列表**（WF-3）：存在主路由的 UCI `routelink` 里，每台设备一个 `device` 段（`mac`、`trusted`、`watch`），段名不固定。守护进程读到后在 `devices` 里返回 `trusted`、`watch`。App 读写 UCI 时用 `uci apply`（不回滚，设计 §7.2）。
8. **网络组只在 App 里**。路由器资料增加 `role`（`gateway`、`ap`、`standalone`，缺省按 `standalone`）和 `gatewayId`。
   - 组内每台路由器的连接都由 `src/api/group/` 管理：主路由用当前连接，AP 用各自保存的密码登录。AP 没有保存密码时，该 AP 当作离线，提示条里给出"输入密码"。
   - 演示模式：演示路由器带一台演示 AP（`RouteLink Demo AP`），部分无线设备挂在它上面，插件角色是 AP。
9. **无线相关页面的路由参数**：编辑射频和 Wi-Fi 的页面加可选参数 `router`（组内成员的 id），查询和写入都走那台路由器的连接，React Query 的键以那台路由器的 id 开头。
10. **扫描邻居网络的频宽**：iwinfo 的扫描结果里有 `ht_operation`、`vht_operation`（三个版本的 QEMU 样本里都有），据此算出每个网络占用的频段；没有这两项时按 20 MHz 计算。
11. **常见密码表**：设计写约 1000 条。内置一张常见弱密码表（数字串、键盘序列、常见单词和拼音），再加上规则判断（重复字符、连续数字、年份日期、键盘连续按键），不追求条数。
12. **SAE 支持的判断**：`luci getFeatures` 的 `hostapd.sae`。读不到时（旧版本没有这个字段）不提供"升级到 WPA3"的修复，只给出建议。

## 1. 接口约定（新增部分）

字段名 snake_case；速率单位 kbit/s（无线协商速率沿用 iwinfo 的习惯），信号单位 dBm。

### 1.1 `info` 增加

```json
{ "roles": ["gateway", "ap"], "modules": ["traffic", "wifi"],
  "capabilities": ["traffic", "wifi"],
  "retention": { ..., "signal_minute_days": 7, "signal_hour_days": 30 } }
```

### 1.2 `stations`（参数 `live?: bool`）

```json
{ "ts": 1790000000, "live_until": 1790000030,
  "interfaces": [ { "ifname": "phy0-ap0", "phy": "phy0", "ssid": "Home", "bssid": "02:..",
                    "freq": 2437, "channel": 6, "width": 20, "noise": -92, "stations": 3 } ],
  "stations": [ { "mac": "AA:BB:..", "ifname": "phy0-ap0", "freq": 2437,
                  "signal": -58, "signal_avg": -60, "noise": -92,
                  "inactive_ms": 120, "connected_sec": 3600,
                  "rx_rate": 144400, "tx_rate": 173300, "rx_mcs": 7, "tx_mcs": 9, "rx_nss": 2, "tx_nss": 2,
                  "width": 80, "mode": "he",
                  "rx_bytes": 123, "tx_bytes": 456, "rx_packets": 1, "tx_packets": 2,
                  "tx_retries": 10, "tx_failed": 0 } ] }
```

`mode` 是 `legacy`/`ht`/`vht`/`he`，取自 tx 速率信息；拿不到的字段省略。

### 1.3 `signal`（参数 `mac`、`start`、`end`、`max_points?`）

```json
{ "start": 0, "end": 0, "step": 60, "tier": "minute",
  "points": [ [ts, avg_signal, min_signal, avg_tx_rate, avg_rx_rate, tx_retries, tx_failed] | [ts, null, ...] ] }
```

- `tier`：`live`（来自内存，逐秒或 10 秒一点）、`minute`、`hour`。范围在最近 10 分钟以内并且有内存数据时用 `live`。
- 没有数据的点：除时间戳外都是 `null`。没见过的 MAC 返回 `NOT_FOUND`。

### 1.4 `survey`

```json
{ "radios": [ { "ifname": "phy0-ap0", "phy": "phy0", "freq": 2437, "channel": 6, "noise": -92,
                "active_ms": 0, "busy_ms": 0, "rx_ms": 0, "tx_ms": 0,
                "busy_pct": 23, "updated": 1790000000 } ],
  "channels": [ { "phy": "phy0", "freq": 2412, "channel": 1, "noise": -95, "busy_pct": 41 } ] }
```

`busy_pct` 是最近两次采样（60 秒）之间的增量比例；第一次采样后为 `null`。`channels` 是扫描后驱动留下的其他信道的数据，可能为空。

### 1.5 `devices` 增加 `watch`；`trusted` 读自 UCI。AP 上增加 `ifname`、`signal`。

### 1.6 UCI

```
config retention 'retention'
	option signal_minute_days '7'
	option signal_hour_days '30'

config routelink 'main'
	option wifi '1'            # AP 角色的无线采样

config device
	option mac 'AA:BB:CC:DD:EE:FF'
	option trusted '1'
	option watch '0'
```

## 2. 任务

### 阶段 A：守护进程

- **T1 `core/series`**：通用定长记录日志（open、append、commit、compact、scan、reset，损坏的文件改名为 `.bad`）。单元测试：追加和扫描、提交失败时文件长度不变、按保留期裁剪、重新打开后数据还在。
- **T2 `core/wifi`**：终端表（MAC → 最新采样、所在接口、实时环形缓冲）；分钟和小时的信号汇总（平均和最小信号、平均协商速率、重传和失败的增量，计数器回退按 0 处理）；信道繁忙度的增量比例。单元测试覆盖汇总、计数器回退、跨分钟和跨小时、环形缓冲。
- **T3 `sys/nl80211`**：generic netlink 接入。解析接口（只要 AP 模式）、终端、survey；订阅 `mlme` 组的 `NEW_STATION`、`DEL_STATION`。
- **T4 守护进程接入**：角色识别加 AP（有 AP 模式的无线接口）；平时每 10 秒、实时租约期间每秒采样终端，每 60 秒采样 survey；终端进设备表；连接和断开事件；`config device` 段（信任和关注）；保留期配置；`info` 的 `capabilities`；写盘和裁剪包含信号文件；`reset` 的 `signal` 范围。
- **T5 ubus 方法和 ACL**：`stations`、`signal`、`survey`；`devices` 的新字段。
- **T6 QEMU 无线集成测试**：在 `integration.yml` 的 QEMU 路由器上安装 x86_64 插件包，加一个第四个 hwsim 射频跑 `wpa_supplicant` 作为终端，连上 `RouteLink` 网络。检查：`stations` 里有它、信号合理；`survey` 有繁忙度；断开后出现 `wifi_disconnect` 事件；`signal` 有分钟数据。

### 阶段 B：LuCI

- **T7 无线页** `view/routelink/wireless.js`：终端信号表（按信号排序，质量评级的颜色）、选中终端后显示信号历史曲线（SVG）、信道繁忙度表；AP 角色时菜单只显示"无线"和"设置"。设置页增加无线模块开关和信号保留期。中文翻译。

### 阶段 C：App 接入层（TDD）

- **T8 插件客户端**：`agent.ts` 增加 `capabilities`、`stations`、`signal`、`survey` 的解析和调用；录制或手写样本。
- **T9 网络组** `src/api/group/`：
  - `members.ts`：从路由器资料算出组（主路由 + AP）。
  - `merge.ts`（纯函数）：主路由的设备列表 + 各台 AP 的终端 → 合并后的设备（`ap` 字段：路由器 id、名称、频段、SSID；漫游时取空闲时间短的）；AP 离线时标记无线信息未知。
  - `stations.ts`：AP 的终端，装了插件用 `stations`，否则用 iwinfo `assoclist`。
  - 测试覆盖：合并、漫游中两台 AP 都报告、AP 离线、没有 AP 的组。
- **T10 组内连接**：`ActiveRouterProvider` 提供 `group`（成员及其连接或"需要密码"）；`useMemberQuery(routerId, key, fn)`；`useClients` 改为组感知。
- **T11 信号评级** `features/wifi-tools/signal.ts`：设计 §17.1 的四级评级（信噪比低于 20 dB 降一级）、"协商速率低于该频段常见水平的一半"的判断、本机识别。
- **T12 信道推荐** `features/wifi-tools/channel.ts`：设计 §17.2 的算法（可选信道、干扰分、多台 AP 依次分配、50% 门槛、2.4 GHz 拥挤时建议 20 MHz）。测试用手工构造的扫描结果。
- **T13 安全评级和密码强度** `features/wifi-tools/security.ts`：设计 §17.4 的评级表、附加检查、密码强度规则；修复项生成 uci 改动。
- **T14 信任列表** `features/wifi-tools/trust.ts`：插件 UCI 和本地存储两种来源；装上插件后迁移。
- **T15 演示模式**：演示 AP；`routelink.stations`、`signal`、`survey`；信任列表；契约测试覆盖新方法。

### 阶段 D：App 界面

- **T16 建组**：路由器详情页的"网络组"一节（独立、主路由、作为 AP 加入某台主路由）；添加路由器时的自动建议；添加 AP 时"使用主路由的密码"。
- **T17 切换面板**：只列主路由和独立路由器，AP 缩进显示在主路由下面。
- **T18 设备 Tab 和设备详情**：显示所在 AP；踢下线发到所在 AP；AP 离线的提示条。
- **T19 无线 Tab**：按路由器分组；编辑页带 `router` 参数；同名 SSID 同步。
- **T20 信号监测**：列表页和单台详情（实时曲线、历史曲线、漫游记录、重传率、提示）。
- **T21 信道扫描与优化**：扫描、占用图、信道表、推荐和一键切换。
- **T22 查蹭网**：扫描动画、总结、范围切换、首次使用的信任引导、处理陌生设备。
- **T23 安全检查**：评级列表、附加检查、一键修复、同步到同名 SSID。

### 阶段 E：收尾

- **T24** 版本号、README 的功能清单、执行记录。

---

## 执行记录（实施过程中填写）

| 项目 | 结论 |
|---|---|
| 磁盘满（10-06） | 实施中 C、D 两盘同时被占满，子任务中断；腾出空间后从 `core/series` 起继续，已写的文件都完好 |
| T1–T7 守护进程和 LuCI | 完成。单元测试 17 组（ASan、UBSan、-Werror）。Docker 路由器没有 nl80211，只验证了非无线路径；QEMU 无线测试（`scripts/ci/plugin-wireless.sh`，第 4 个 hwsim 射频跑 `wpa_supplicant`）在本机 Docker 里用 KVM 跑通 24.10.8，23.05、25.12 留给 CI |
| `stations` 和计划的差别 | 多一个 `interval`（当前采样间隔）；没在运行的接口不列出；驱动不报的字段省略，包括 `signal`（App 用 `signal_avg` 代替，再没有按 0）；EHT 速率不报 `mode`；HT 的 MCS 按每流报（MCS 15 → `mcs 7`、`nss 2`） |
| `signal` 和计划的差别 | 实时层返回原始采样点，不是等间距的格子；分钟、小时层从包含 `start` 的那一格开始，和 `history` 一致；实时层要求 `start` 在路由器时钟的 600 秒以内，所以 App 用路由器的时间（`stations.ts`）算实时范围（本机测试时主机和路由器差了约 130 秒） |
| `survey` | `radios` 每个射频一项，按接口频率匹配（hwsim 不设 in-use 标志）；扫描到的信道在第一次采样后就有值（累计繁忙比例），之后是增量。hwsim 只在扫描时更新计数，所以 QEMU 里射频的 `busy_pct` 一直是 null，真机路径只有单元测试覆盖 |
| AP 上的 `devices` | 没有流量统计时，无线终端的 `online` 表示"已连接"；只有已连接的终端带 `ifname`、`signal`；AP 不产生上下线事件，但新终端仍产生 `device_new`。终端认证完成才算连接，输错密码不产生设备和事件；同一台路由器上换频段是先断开再连接 |
| AP 角色识别 | nl80211 有 AP 模式接口，或者 UCI 里有开着的射频上开着的 AP 接口，就算 AP（Wi-Fi 关着时角色不变）。守护进程写 `/var/run/routelink/ap`、`ap-only` 并清 LuCI 菜单缓存；浏览器按会话缓存菜单，角色变化要重新登录才看得到 |
| 存储分配 | 信号分钟数据最多占上限的 1/4，小时数据 1/8，其余给流量（至少一半） |
| `agent-router.sh` | 增加 `RL_AGENT_NAME`、`RL_AGENT_NET`、`RL_AGENT_PORT`，可以和默认实例同时跑第二台 |
| 遗留 | `integration.yml` 现在也在 `openwrt/routelinkd/**` 变化时触发（main 上会连带跑整套 App 集成测试）；AP_VLAN（WDS）接口上的终端不采样；LuCI 设置页在测试浏览器里因为会话问题停在加载中，需要人工看一眼 |
| T13 安全检查的规则细节 | `sae-mixed` 没写 `ieee80211w` 时按 hostapd 的默认值算作开启了管理帧保护（可选）；单一字符类型、少于 16 位的密码也算弱；修复项：插件报告支持 SAE 时给"升级到 WPA2/WPA3"，不确定时只对低、危险两级给"升级到 WPA2（AES）" |
| T15 演示 AP | 和演示主路由共用设备：客厅电视、Echo、摄像头、iPad 挂在 AP 上，iPhone 每天 7:30–7:50 漫游到 AP。AP 的 2.4 GHz 是 WPA2、开着 WPS、密码含 SSID；5 GHz 和主路由同在 36 信道 |
| T16 建组 | 自动建议在登录成功、保存之后判断（最多等 6 秒）：默认路由的下一跳是某台已保存的路由器并且有无线，或者插件角色只有 AP |
| T19 同名 SSID 同步 | 同步名称、加密方式和密码三项；每台路由器一次应用；手机所在的那台最后应用、不回滚 |
| CI 无线测试 | `plugin-wireless.sh` 在 23.05、24.10、25.12 的 QEMU 路由器上都通过。23.05 上 hwsim 的射频自带默认 AP 接口，所以"空闲射频"改为按"没有 AP 接口的 phy"挑，再删掉 hwsim 自建的 `wlanN` |
| 界面走查 | 演示模式下在 API 34 模拟器上走查了建组、切换面板、无线 Tab、信号、信道、查蹭网、安全检查。修了：演示设备的 IP 出现负数（`>>` 改 `>>>`）、2.4 GHz 的协商速率、信道图滚动到推荐信道、查蹭网的行被裁掉。根栈页面（Wi-Fi 二维码、设备详情、切换面板）在模拟器上打不开，原因是 ARM 安装包在 x86 模拟器上转译时 `Math.random` 出错，与本分支无关，已在另一个分支修复 |
| 代码审查 | 全分支审查后修了：160 MHz 的信道推荐只按主信道判断 DFS（改为按整个信道块）；信任列表迁移失败后每次渲染都重试（改为每台路由器只试一次）；安全检查的修复面板清空新密码时崩溃 |
| T24 收尾 | App 版本 1.1.0；README 中英文的功能清单、插件一节更新；设计文档同步 |
