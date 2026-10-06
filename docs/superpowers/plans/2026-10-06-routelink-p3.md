# RouteLink P3 实施计划：诊断

> 设计文档：`docs/superpowers/specs/2026-10-05-routelink-agent-design.md`（下文简称"设计"）
> 上一期：`2026-10-06-routelink-p2.md`（下文简称"P2 计划"）
>
> **前提**：P2 已完成。执行方式和 P2 计划相同。

**目标**（设计 §19、§22）：

| 编号 | 功能 | 风险 |
|---|---|---|
| AG-10 | 延迟探测和断网记录（§5.3） | 低 |
| AG-11 | 路由器端测速（§12） | 低 |
| AG-5/6 | `latency`、`outages`、`speedtest_start`、`speedtest_status`；LuCI 延迟与断网页 | 低 |
| DG-1 | 一键诊断 | 低 |
| DG-2 | 诊断工具：ping、traceroute、nslookup（替代主设计 NW-13） | 低 |
| DG-3 | 断网和延迟记录 | 低 |
| DG-4 | 测速：手机、路由器、对比（替代主设计 MO-13） | 低 |

完成标准：一键诊断、诊断工具、断网记录、两种测速可用；真实网络里的验收和 P2、P4 一起做。

---

## 0. 和设计不同的决定

1. **探测用原始套接字**。守护进程以 root 运行，IPv4 用 `SOCK_RAW`+`IPPROTO_ICMP`，IPv6 用 `SOCK_RAW`+`IPPROTO_ICMPV6`，挂在 uloop 上，不启动 `ping` 进程。
   - 每 10 秒向每个目标发一个回显请求，2 秒内没有回复算丢包。
   - WAN 口的上一跳网关从 netifd 的 WAN 接口路由里取（默认路由的 `nexthop`），会跟着重新拨号变化。PPPoE 的上一跳是对端地址。
   - 目标最多 8 个。域名不解析，只接受 IP 地址（避免在主循环里阻塞）。
2. **断网判定**：设计 §5.3 的规则写成纯函数（`core/probe`）。除上一跳网关外**没有配置任何目标**时不判定断网。
   - 原因：断网期间收到 netifd 的 WAN `ifdown` 记为 `wan_down`；之后又 `ifup` 了记为 `redial`；都没有记为 `upstream`（上游不通）。
   - 订阅 ubus 事件 `network.interface`（netifd 广播的 `ifup`、`ifdown`），WAN 接口的上下线同时写进事件表（`wan_down`、`wan_up`），一键诊断的"最近 24 小时重拨次数"用它。
3. **存储**：P2 的 `core/series`。`latency.minute`（7 天）、`latency.hour`（90 天）、`outages`（1 年）。一条延迟记录：时间、目标序号、发送数、丢失数、平均、最小、最大往返时间（微秒）。正在进行的断网只在内存里，结束后写入；守护进程停止时把它当作在停止时刻结束。
4. **测速在子进程里跑**。`speedtest_start` fork 出一个子进程，阻塞的事（解析域名、等待下载进程）都在子进程里做；子进程通过管道向守护进程报告进度和结果。
   - 下载：并发 4 个 `uclient-fetch -q -O /dev/null`，持续 10 秒，按 WAN 口接收计数的增量算速率（去掉第 1 秒的爬升）。
   - 上传：在 `/tmp` 里生成一个随机内容的文件（大小取 8 MB 和可用内存的 1/16 中较小的那个），4 个并发连接各自循环 POST 它，持续 10 秒，按 WAN 口发送计数算速率。
   - 延迟：对测速服务器的 443 端口（或 URL 里的端口）做 10 次 TCP 握手计时，取中位数；抖动取相邻两次差值的平均。
   - 服务器：默认 Cloudflare（`https://speed.cloudflare.com/__down?bytes=…`、`__up`）；UCI 可以填 LibreSpeed 的地址（`garbage.php?ckSize=100`、`empty.php`）。
   - 速率用 WAN 计数器，会把同一时间其他设备的流量也算进去，页面上注明。
   - 结果保存在 `speedtest.json`，最近 100 次。
   - 依赖加 `uclient-fetch`（OpenWrt 默认就装了）。
5. **HTTP 204 检查由手机发起**。路由器上执行 `wget` 需要额外的 ACL，所以一键诊断的"外网"一段：ping 公共地址在路由器上做，HTTP 204 由手机做（流量同样经过路由器）。
6. **诊断结果只分享文字**。生成图片要新增截图依赖，先不做。
7. **诊断工具的命令路径**：用 LuCI 诊断页 ACL 里的 `/bin/ping`、`/bin/ping6`、`/bin/traceroute`、`/bin/traceroute6`、`/usr/bin/nslookup`（三个版本都是 busybox 的链接）。IPv6 用 `ping6`、`traceroute6`。
8. **手机到路由器的往返时间**：对路由器做 5 次 HTTP 请求（`RouterConnection.ping`）计时，包含 HTTP 的开销，所以门槛（30 ms、100 ms）已经留了余量。Android 另外显示手机自己测到的 Wi-Fi 信号（原生模块已有的网络信息里有就显示，没有就不显示）。

## 1. 接口约定

### 1.1 `latency`（参数 `start`、`end`、`target?`、`max_points?`）

```json
{ "start": 0, "end": 0, "step": 60, "tier": "minute",
  "targets": [ { "id": 0, "ip": "100.64.0.1", "kind": "gateway" }, { "id": 1, "ip": "223.5.5.5", "kind": "custom" } ],
  "series": [ { "target": 0, "points": [ [ts, avg_ms, max_ms, loss_pct] | [ts, null, null, null] ] } ],
  "summary": [ { "target": 0, "sent": 8640, "lost": 3, "avg_ms": 2.1, "max_ms": 40.2 } ] }
```

`target` 参数是 IP；不带时返回全部目标。往返时间保留 1 位小数。

### 1.2 `outages`（参数 `start`、`end`）

```json
{ "count": 2, "total_sec": 380, "availability": 99.95,
  "outages": [ { "start": 0, "end": 0, "duration": 200, "cause": "wan_down|redial|upstream", "ongoing": false } ] }
```

`availability` 只在这段时间都有探测数据的部分里计算。

### 1.3 `speedtest_start`（参数 `server?`）→ `{ "id": 17 }`；已经在测时返回正在进行的那次：`{ "id": 16, "already": true }`（libubus 没有"忙"这个状态码）。

### 1.4 `speedtest_status`（参数 `id?`）

- 带 `id`：`{ "id": 17, "running": true, "phase": "latency|download|upload|done|failed", "progress": 0.4, "result": {…}? , "error": "…"? }`
- 不带：`{ "running": false, "results": [ { "id": 17, "ts": 0, "server": "…", "latency_ms": 12.3, "jitter_ms": 1.1, "down_bps": 0, "up_bps": 0, "error": "…"? } ] }`（新的在前，速率单位比特/秒）

### 1.5 UCI

```
config probe 'probe'
	option enabled '1'
	list target '223.5.5.5'
	list target '119.29.29.29'
	list target '1.1.1.1'
	option gateway '1'          # 是否探测 WAN 的上一跳

config speedtest 'speedtest'
	option server ''            # 空 = Cloudflare；否则 LibreSpeed 的基础地址
	option streams '4'
	option duration '10'

config retention 'retention'
	option latency_minute_days '7'
	option latency_hour_days '90'
	option outage_days '365'
```

## 2. 任务

### 阶段 A：守护进程

- **T1 `core/probe`**：每个目标每分钟的汇总（发送、丢失、平均、最小、最大）和小时汇总；断网状态机和原因。单元测试：丢包率、只有网关不通不算断网、3 轮判定、任意一个恢复即结束、原因判定、没有自定义目标时不判定。
- **T2 `sys/icmp`**：原始套接字的发送和接收，按序号和标识符匹配，超时处理。
- **T3 守护进程接入**：WAN 上一跳网关；`network.interface` 事件；写盘、裁剪、`reset` 的 `latency` 范围；`latency`、`outages` 方法。
- **T4 `sys/speedtest`**：子进程、进度管道、结果文件；`speedtest_start`、`speedtest_status`。
- **T5 集成测试**：Docker 实验环境：探测"外网服务器"容器（目标改成它的地址），断开 WAN 网络 40 秒后恢复，`outages` 里有一条原因正确的记录；测速指向实验环境里的 LibreSpeed 兼容服务（`traffic-lab.sh` 的服务器容器加两个静态响应），速率在合理范围内。

### 阶段 B：LuCI

- **T6 延迟与断网页** `view/routelink/latency.js`：时间段、每个目标的延迟曲线和丢包柱、可用率、断网列表、测速按钮和历史。设置页加探测目标和测速服务器。

### 阶段 C：App 接入层（TDD）

- **T7 插件客户端**：`latency`、`outages`、`speedtest_*` 的解析和调用。
- **T8 诊断工具** `features/diagnostics/tools.ts`：命令参数、ping/traceroute/nslookup 输出的解析（平均延迟、丢包、每一跳、解析结果）；`services/diag.ts` 通过 `file exec` 执行（超时 60 秒）。
- **T9 一键诊断规则** `features/diagnostics/rules.ts`：设计 §18.1 的表格写成纯函数，每段输出状态和建议；`diagnose.ts` 收集数据（组内成员、插件可选）。
- **T10 测速** `features/diagnostics/speed.ts`：手机测速（`expo/fetch` 流式读取下载、循环 POST 上传、延迟和抖动）、对比结论；`state/speedtest.ts` 保存手机的历史和签约带宽。
- **T11 演示模式**：`latency`、`outages`、`speedtest_*`、诊断命令的输出；契约测试。

### 阶段 D：App 界面

- **T12 诊断入口**：网络 Tab 加"诊断"一节（一键诊断、诊断工具、断网和延迟、测速）；概览快捷操作加"一键诊断"。
- **T13 一键诊断页**：逐段显示进度和结论、建议里的入口、分享文字。
- **T14 诊断工具页**：工具、目标、在哪台路由器上执行、次数、IPv4/IPv6；摘要和原始输出。
- **T15 断网和延迟页**：时间段、曲线、统计、断网列表、导出 CSV 和文字。
- **T16 测速页**：手机、路由器、对比三种；历史；签约带宽。

### 阶段 E：收尾

- **T17** README、执行记录。

---

## 执行记录（实施过程中填写）

| 项目 | 结论 |
|---|---|
