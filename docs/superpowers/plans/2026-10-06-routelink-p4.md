# RouteLink P4 实施计划：管控、推送、上岛

> 设计文档：`docs/superpowers/specs/2026-10-05-routelink-agent-design.md`（下文简称"设计"）
> 上两期：`2026-10-06-routelink-p2.md`、`2026-10-06-routelink-p3.md`
>
> **前提**：P3 已完成。执行方式和 P2 计划相同，另加两条：
> - 设计 §9.1（限速准确性）和 §16（后台轮询）的两项技术验证排在最前面，结论写进执行记录。
> - 原生代码在本机 Android 模拟器上验证；需要 Android 16 QPR1（API 36.1）以上的系统镜像。

**目标**（设计 §19、§22）：

| 编号 | 功能 | 风险 |
|---|---|---|
| AG-12 | 限速和配额（§9） | 中 |
| AG-13 | DNS 记录和访问去向（§10） | 隐私 |
| AG-14 | 推送：插件负责发送，App 和 LuCI 提供设置页（§11） | 低 |
| AG-5/6 | `quotas`、`quota_allow`、`destinations`、`dns`、`notify_test`、`notify_status`；LuCI 限速与配额、访问记录、推送页 | 低 |
| TR-7 | 限速和配额设置 | 中 |
| TR-8 | 访问去向和 DNS 记录 | 隐私 |
| LU-1 | 实时监控：前台服务和通知 | 低 |
| LU-2 | 状态栏胶囊和上岛 | 低 |
| LU-3 | 离线提醒 | 低 |
| LU-4 | 权限和各品牌的引导 | 低 |

完成标准（设计 §22）：两项技术验证有结论；限速、配额、DNS 记录、推送可用；Android 16 QPR1 及以上的模拟器上，实时监控出现在状态栏胶囊里。打标签 `agent-v1.0.0` 要先征得你的同意（不在这个 PR 里做）。

---

## 0. 和设计不同的决定

1. **限速的技术验证放到 CI**。本机 Docker 用的是 WSL2 的 5.15 内核，没有 `sch_htb` 和 `act_police`（实测 `tc qdisc add … htb` 报 "Specified qdisc kind is unknown"），容器里也装不了内核模块。CI 的 Ubuntu 内核有这些模块：集成测试先在宿主机上 `modprobe sch_htb cls_flower act_mirred ifb`，再在实验环境里分别在开和关软件加速的情况下测限速误差。
   - 守护进程在设置限速失败时（模块缺失）不重试刷屏，在 `info.limits_error` 里报告原因，App 和 LuCI 显示出来。
2. **限速的实现**（设计 §9.1）：
   - 对象：LAN 网桥的全部成员口（有线口和无线口，从 netifd 的 `network.device status` 读 `bridge-members`）。
   - 下载：每个口的出方向挂 HTB（`handle 1:`，默认类不限速），每条规则一个类，`flower dst_mac` 分类。
   - 上传：每个口挂 `clsact`，入方向用 `flower src_mac` 把被限速设备的包 `mirred` 重定向到共用的 ifb 设备 `rl-ifb0`，在它的出方向用同样的 HTB 整形（按 `src_mac` 分类），所以一台设备的上传限速对所有口合计生效。（原计划用 `police … drop`，CI 实测 TCP 上传只能跑到限速的 50%～85%，见执行记录。）
   - 通过启动 `tc` 进程执行（`tc -batch`），不直接写 netlink。
   - 无线口重建（`wifi reload`）、网口上下线后规则会丢：守护进程每 60 秒检查一次每个口上是否还有自己的 qdisc，没有就重新下发；收到 `network.interface`、`network.device` 事件时也立即检查。
   - 依赖：`tc-tiny`、`kmod-sched-core`（HTB、`act_mirred`）、`kmod-sched-flower`、`kmod-ifb`。建不了 ifb 时只有上传限速失效，原因写进 `limits_error`。
3. **断网用自己的 nftables 表**，不放进 fw4 的 `chain-pre/forward`：
   - `table inet routelink`，`forward` 链挂在 `filter - 1` 优先级，集合 `block`（MAC）、`local4`、`local6`（本地网段）。规则：源 MAC 在 `block` 里、目的地址不在本地网段的包丢弃。
   - 原因：fw4 每次重载都会重建 `inet fw4` 表，引用里的集合会被清空；自己的表不受影响，也不依赖 fw4 的内部结构。
   - 已经建立的连接：通过 ctnetlink 删除这台设备的连接跟踪条目（按它当前的 IPv4 和 IPv6 地址），走加速通道的连接也随之失效。
4. **配额的运行状态**（本周期的起点、是否已提醒、是否已断网、临时放行到何时）存在数据目录的 `quota.json`。临时放行用新方法 `quota_allow`（写权限），设计 §7.1 的表里没有它。
5. **DNS 记录**：
   - 每个 LAN 网桥一个 `AF_PACKET` 套接字，BPF 只放行 UDP 和 TCP 的 53 端口；TCP 只解析一个分段里完整的报文。
   - 存储：变长记录日志 `core/vlog`（2 字节长度 + 内容），`dns.log` 保留 7 天、最多 10 万条；内存里只留最近 2000 条和还没写盘的部分，查询时扫描文件。
   - "IP → 域名"缓存按 TTL 过期，最多 4096 条。
6. **访问去向**：在流量归属时，把互联网类连接的对端地址按"设备 × 小时"累计（当前小时在内存里，关闭时每台设备取前 100 条写进 `dest.log`），记录时按缓存换成域名。保留 7 天。DNS 记录关闭时访问去向也关闭（设计 §10 默认关闭）。
7. **推送**：
   - 通过 `uclient-fetch --header=… --post-data=…` 发送（本机实测 24.10.8 的 uclient-fetch 支持 `--header`），依赖加 `ca-bundle`。
   - 钉钉和飞书的加签需要 HMAC-SHA256：`core/sha256` 自己实现，用标准测试向量做单元测试。
   - 语言：UCI `notify.lang`，`auto` 时跟随 LuCI 的语言；LuCI 也是 `auto` 时，时区在中国大陆、港澳台按中文，否则英文。
   - 最近一次失败的原因通过新方法 `notify_status` 读取。
   - App 的后台通知（M4 AP-5）里的"新设备"：装了插件、并且有开着的推送渠道订阅了新设备的路由器，App 不再重复提醒。
8. **实时监控直接用 Kotlin 原生轮询**，不先试 Headless JS。M4 已经实测：后台启动时 JS 定时器不运行（M4 执行记录 T12～T15 ④），Headless JS 依赖同样的定时器。这正是设计 §16 写好的退路：
   - 开始监控时，JS 把路由器地址、会话 ID、证书指纹、WAN 设备名和是否装了插件交给原生代码。
   - 装了插件：每次调用 `routelink live`；没装：`luci-rpc getNetworkDevices` 算 WAN 速率，每 10 秒用 `ip -4 neigh show` 数在线设备。
   - rpcd 的会话每次访问都会续期，轮询期间不会过期；真的失效了（路由器重启），通知提示"请打开 App 重新连接"。
   - App 在前台时，概览页拿到的数据也通过 `updateLiveMonitor` 交给通知，避免重复请求。
9. **Android 17 的 MetricStyle**：需要 compileSdk 37。先在 CI 上试编译；不行就按设计退回 Android 16 的样式。

## 1. 接口约定

### 1.1 UCI

```
config limit
	option mac 'AA:BB:CC:DD:EE:FF'
	option enabled '1'
	option download '8000'        # kbit/s，0 = 不限
	option upload '2000'
	list weekdays 'mon'           # 不写 = 每天
	option start_time '20:00'     # 不写 = 全天
	option stop_time '23:00'

config quota
	option mac 'AA:BB:CC:DD:EE:FF'
	option enabled '1'
	option period 'month'         # day | week | month
	option reset_day '1'          # 月：1～28；周：1～7（星期一 = 1）
	option limit_mb '102400'
	option direction 'total'      # total | download
	option action 'block'         # block | limit
	option limit_download '1000'  # action=limit 时，kbit/s
	option limit_upload '500'

config dns 'dns'
	option enabled '0'
	option keep_days '7'
	option max_records '100000'

config notify
	option type 'webhook'         # webhook | bark | serverchan | pushplus | telegram | wecom | dingtalk | feishu
	option enabled '1'
	option name ''
	option url ''                 # webhook、bark 服务器、企业微信/钉钉/飞书地址
	option template ''            # webhook 的 JSON 模板，{title} {body} 会被替换
	option token ''               # bark key、SendKey、PushPlus token、Telegram bot token
	option chat_id ''             # Telegram
	option secret ''              # 钉钉、飞书的加签密钥
	list events 'device_new'      # device_new | device_watch | quota | outage

config notify_settings 'notify'
	option lang 'auto'
```

### 1.2 方法

- `quotas` → `{ "quotas": [ { "section": "cfg0a1b2c", "mac": "…", "period": "month", "period_start": 0, "period_end": 0, "limit": 107374182400, "used": 0, "pct": 12.5, "state": "ok|warned|exceeded|allowed", "allow_until": 0, "action": "block" } ] }`
- `quota_allow`（`section`、`until`：`hour` 或 `period`）→ `{}`
- `destinations`（`mac`、`start`、`end`、`limit?`）→ `{ "destinations": [ { "host": "example.com"?, "ip": "93.184.216.34", "rx": 0, "tx": 0, "conns": 3 } ] }`
- `dns`（`mac?`、`start`、`end`、`q?`、`limit?`、`offset?`）→ `{ "count": 0, "records": [ { "ts": 0, "mac": "…", "name": "example.com", "type": "A", "rcode": "NOERROR", "answers": ["93.184.216.34"] } ] }`
- `notify_test`（`section`）→ `{ "ok": false, "error": "…" }`（同步发送，最多等 15 秒）
- `notify_status` → `{ "channels": [ { "section": "…", "last_ok": 0, "last_error": "…", "last_error_ts": 0 } ], "pending": 0 }`
- `info` 增加 `limits_error`（空串表示正常）、`dns_enabled`。

新的事件类型：`quota_warn`、`quota_exceeded`、`quota_reset`、`limit_applied`（不显示给用户，调试用）。

## 2. 任务

### 阶段 A：技术验证

- **T1 限速**：实验环境脚本加限速测试（`test/agent/limits.agent.ts`），CI 里加载模块后在开和关软件加速时各跑一次，误差 ±10% 以内。不通过时按设计退回"提示关闭软件加速"。
- **T2 compileSdk 37**：CI 上试编译。

### 阶段 B：守护进程

- **T3 `core/quota`**：周期起止（按天、按周、按月和重置日，本地时间，跨夏令时）、用量判断、状态变化（80% 提醒、100% 动作、到期恢复、临时放行）。单元测试。
- **T4 `core/schedule`**：限速规则在某个本地时刻是否生效（星期、跨午夜）。单元测试。
- **T5 `sys/shaper`、`sys/block`**：tc 和 nftables 的下发、检查和清理；ctnetlink 删除连接。
- **T6 `core/dns`、`core/vlog`、`core/dest`**：DNS 报文解析（压缩指针、A/AAAA/CNAME、截断和畸形报文）、IP → 域名缓存、去向累计和取前 100。单元测试。
- **T7 `sys/dnscap`**：AF_PACKET 和 BPF。
- **T8 `core/sha256`、`core/notify`**：消息格式（中英文）、1 分钟合并、各渠道的请求体和加签。单元测试。
- **T9 `sys/notify`**：发送、重试、失败原因。
- **T10 守护进程接入和 ubus 方法**、ACL、UCI 默认配置、Makefile 依赖。
- **T11 集成测试**：配额断网后已有连接被切断（设计 §21 ④）；DNS 记录能查到实验环境里的查询；推送发到实验环境里的 Webhook 接收器。

### 阶段 C：LuCI

- **T12** 限速与配额页、访问记录页、推送页；设备详情弹窗加访问去向和 DNS。

### 阶段 D：App

- **T13 插件客户端**：新方法的解析和调用；UCI 规则的读写（`services/agent-rules.ts`）。
- **T14 演示模式**：规则、配额、DNS、去向、推送；契约测试。
- **T15 限速和配额界面**：设备流量详情里的入口和编辑页、总列表（当前用量）、临时放行。
- **T16 访问去向和 DNS 记录**：设备流量详情里的两个列表，DNS 可搜索；没开启时的开启按钮和隐私说明。
- **T17 推送设置**：更多 → 路由器插件 → 推送：渠道列表、编辑、测试、事件订阅、最近一次失败的原因。
- **T18 原生实时监控**：`LiveMonitorService`（前台服务类型 `connectedDevice`）、通知（推广、胶囊文字、停止按钮）、Kotlin 轮询、离线提醒、到时结束、`onLiveMonitorStopped` 事件。
- **T19 实时监控界面**：概览页的按钮（选时长、剩余时间、停止）、权限和电池优化引导、品牌提示、"监控被系统中断"的提示。
- **T20 模拟器验证**：Android 16 QPR1 模拟器上截图状态栏胶囊。

### 阶段 E：收尾

- **T21** 版本号（插件 1.0.0）、README、设计文档同步、执行记录。

---

## 执行记录（实施过程中填写）

| 项目 | 结论 |
|---|---|
| T13–T17 App | 完成。规则读写在 `services/agent-rules.ts`，插件新方法在 `services/agent-control.ts`；演示路由器带一条限速、两条配额、开着 DNS 记录和一个 Bark 渠道 |
| 核心模块 | `core/sha256`、`core/quota`、`core/schedule`、`core/dns`、`core/vlog`、`core/dest`、`core/notify`、`core/tcgen`、`core/nftgen` 先写好并有单元测试（ASan、UBSan）；钉钉、飞书的签名用 Python 的 hmac 核对过；nftables 脚本在 24.10.8 容器里用 `nft -c` 和实际加载检查过 |
| 配额周期 | 按路由器本地时间，用 `mktime` 处理夏令时（切换那天按 23 或 25 小时算）；80% 的门槛是 `limit - limit / 5` |
| DNS 解析 | 压缩指针只能往前指、最多跳 16 次；随机数据喂 2000 次在 ASan、UBSan 下不出错 |
| 变长记录日志 | 每条记录前后都有长度，所以可以从新到旧倒着读（按 64 KB 一块）；访问去向一条记录装不下 100 条时，丢掉流量最少的几条 |
| 后台通知去重（§0.7） | 路由器插件里有开着的、订阅了新设备的推送渠道时，App 的后台检查不再发新设备通知 |
| T1 限速验证 | 测试 `test/agent/limits.agent.ts`：在路由器的 LAN 口上套用 `core/tcgen` 生成的脚本，开、关软件加速各测一次下载和上传，误差要求 ±10%。CI 先加载 `sch_htb`、`cls_flower`、`act_mirred`、`ifb` 和 flowtable 模块；rootfs 镜像里没有 `tc`，测试里先装 `tc-tiny` |
| T18–T19 实时监控 | 完成（子任务）。服务用 JS 单独登录的会话轮询，不接触密码；插件消失时自动改用 LuCI 计数；会话失效后只要 App 进程在，JS 会重新登录并把新会话交给服务；证书变了就停止并留一条说明。在 API 34 模拟器上验证了刷新、后台继续、通知里的停止、到时结束、离线 9 秒后提示并震动、恢复、无插件模式、rpcd 重启后的会话续上、被强制停止后的"中断"提示 |
| T2 MetricStyle | 不改 compileSdk：Android 17 的 `Notification.MetricStyle`（文档已核对：`MetricStyle().addMetric(Metric(FixedFloat(值, 单位, 0, 1), 标签))`、`setCriticalMetric`）通过反射构造，用 `Notification.Builder.recoverBuilder` 套到兼容库建好的通知上；API 37 以下或接口不符时保持 BigText。下载设为最重要的一项（状态栏胶囊显示它） |
| T20 模拟器 | 本机只有 API 34 的镜像；用户决定不下载 API 36.1 镜像（磁盘空间），状态栏胶囊和推广通知的验证留到以后 |
