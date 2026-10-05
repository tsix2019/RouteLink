# RouteLink P1 实施计划：插件核心 + 流量

> 设计文档：`docs/superpowers/specs/2026-10-05-routelink-agent-design.md`（下文简称"设计"，§ 表示章节）
> 主设计：`docs/superpowers/specs/2026-10-05-routelink-design.md`（下文简称"主设计"）
> M1 计划：`docs/superpowers/plans/2026-10-05-routelink-m1.md`（下文简称"M1 计划"）
>
> **前提**：M1 已经全部完成。网络 Tab（M1 T54）、更多 Tab（T55、T56）、`ios.yml` 和 `integration.yml`（T59、T60）都已存在。P1 只在这些页面里加入口，不重写它们。
>
> **执行方式**：和 M1 计划相同。
> - 按顺序逐个完成任务。
> - 逻辑代码走 TDD：先写测试，确认失败；再实现，确认通过；然后提交。
> - 界面任务按"验收"清单在 Android 模拟器上截图核对。
> - 每个任务做完都提交一次。改动了 CI 的任务，提交后立刻推送。

**目标**：做出能在真实路由器上运行的 RouteLink 插件第一版，以及 App 里的流量功能。具体包括：
- 路由器端：统计每台设备的流量，分层保存，通过 ubus 接口提供查询
- LuCI 页面：概览、流量、设备详情、设置
- CI：按"OpenWrt 版本 × CPU 架构"编译，发布到 GitHub Releases 和带签名的软件源
- App：一键安装插件；流量总览、实时速率、设备流量详情、WAN 口历史、CSV 导出
- 发布标签：`agent-v0.1.0`

**架构**：
- **守护进程 `routelinkd`**：
  - 核心逻辑在 `src/core/`，是不依赖任何系统库的纯 C，在 Linux 主机上做单元测试。
  - 系统接入在 `src/sys/`：连接跟踪和邻居表通过 libmnl 读取，ubus 用 libubus，配置用 libuci。
- **LuCI 页面**：用 LuCI JS 写，直接调用 `routelink` ubus 对象。
- **App 端**：按主设计的分层，新增领域服务 `services/agent.ts` 和 `services/packages.ts`，上面是 React Query hooks 和页面。

**技术栈**：
- 守护进程：C11、CMake、libubox、libubus、libuci、libjson-c、libmnl
- 编译：OpenWrt SDK（本机用 Docker，CI 用 `openwrt/gh-action-sdk`）
- LuCI：JS 视图（`view`、`form`、`rpc`、`ui`），图表用自己写的 SVG
- App：Expo SDK 57；新增依赖 `expo-file-system`、`expo-sharing`、`expo-crypto`、`@react-native-community/datetimepicker`

---

## 0. 约定

### 0.1 本机环境

M1 计划 §0.1 的约定全部沿用，另外加三条：

- **Docker 磁盘位置**：
  - 问题：OpenWrt SDK 镜像加上软件源，每个版本占 3～4 GB，而 C 盘只剩 13 GB 左右。
  - **T2 之前要做**：在 Docker Desktop 的"设置 → Resources → Disk image location"里，把磁盘镜像移到 D 盘。**这一步需要你在 Docker Desktop 里操作**；做完后执行 `docker info` 确认。
- **编译**：本机编译插件用 SDK 的 Docker 镜像，SDK 目录放在 Docker 卷 `routelink-sdk-<版本>` 里，这样下次不用重新下载软件源。
- **单元测试**：守护进程的单元测试在 Docker 里的 Linux 环境中编译运行，因为 Windows 上没有 gcc。

### 0.2 代码约定

- **C 代码**：
  - 遵循 OpenWrt 的风格：用 Tab 缩进；函数和类型加 `rl_` 前缀；头文件里只放需要对外的声明。
  - 编译选项：`-std=gnu11 -Wall -Wextra -Werror`。主机测试另外开 `-fsanitize=address,undefined`。
  - `src/core/` 里的代码只能用 C 标准库和 libjson-c，不能用 libubox、libubus、libmnl，这样才能在主机上单独测试。
  - 字节数一律用 `uint64_t`，时间一律用 `int64_t`（UTC 秒）。
- **ubus 接口**：字段名用 snake_case；速率的单位是字节/秒，用量的单位是字节；`rx` 指设备收到的（下载），`tx` 指设备发出的（上传）。
- **LuCI JS**：遵循 LuCI 的写法（`'use strict'; 'require view';` 等），用 Tab 缩进。界面文字用 `_()` 包起来。
- **App**：沿用 M1 计划 §0.2 的约定。接口字段在 `services/agent.ts` 里统一转成 camelCase，速率转成比特/秒，和现有的 `RatePoint` 保持一致。
- **提交信息**：用英文，范围前缀用 `agent`（守护进程）、`luci`、`app`、`ci`，末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

### 0.3 常用命令（T2 之后可用）

| 命令 | 作用 |
|---|---|
| `scripts/agent-test.sh` | 在 Docker 里编译并运行守护进程的单元测试（开启 ASan 和 UBSan） |
| `scripts/agent-build.sh 24.10 x86_64` | 用 SDK 编译三个包，输出到 `openwrt/out/24.10/x86_64/` |
| `scripts/agent-dev-install.sh` | 把 `openwrt/out/24.10/x86_64/` 里的包装进 Docker 测试路由器 |
| `scripts/traffic-lab.sh up\|down` | 在测试路由器旁边启动或删除"终端"和"外网服务器"两个容器（T19 创建） |
| `npx jest -c jest.agent.config.js` | 插件集成测试（需要测试路由器、实验环境都已启动，插件已安装） |

---

## 1. P1 范围

设计 §19 的编号：

| 类别 | 编号 |
|---|---|
| 插件 | AG-1～8 |
| App | TR-1～6 |
| LuCI 页面 | 概览、流量（含设备详情）、设置 |

P1 需要提供的 ubus 方法：`info`、`devices`、`live`、`history`、`summary`、`events`、`reset`，以及两个内部方法 `commit`、`ntp_synced`。

`devices` 里的 `trusted` 字段先固定返回 `false`，P2 再接上信任列表。

## 2. 文件结构（P1 结束时）

```
openwrt/
  routelinkd/
    Makefile                    OpenWrt 包定义
    files/
      routelink.init            procd 启动脚本
      routelink.config          UCI 默认配置
      routelink.keep            /lib/upgrade/keep.d/routelink
      routelink.upgrade.sh      /lib/upgrade/routelink.sh（升级前写盘的钩子）
      routelink.ntp             /etc/hotplug.d/ntp/90-routelink
    src/
      CMakeLists.txt
      core/  timeutil.[ch] addr.[ch] flows.[ch] classify.[ch] agg.[ch]
             store.[ch] query.[ch] devtab.[ch] events.[ch] util.h
      sys/   ct.[ch] neigh.[ch] netinfo.[ch] role.[ch] config.[ch] api.[ch]
      main.c
      tests/ t.h test_*.c Dockerfile
  luci-app-routelink/
    Makefile
    htdocs/luci-static/resources/
      routelink/common.js       rpc 声明、格式化、SVG 图表
      view/routelink/overview.js traffic.js settings.js
    root/usr/share/luci/menu.d/luci-app-routelink.json
    root/usr/share/rpcd/acl.d/luci-app-routelink.json
    po/templates/routelink.pot
    po/zh_Hans/routelink.po
  out/                          本机编译产物（不提交）
scripts/
  agent-test.sh agent-build.sh agent-dev-install.sh traffic-lab.sh
  agent-manifest.ts             生成 manifest.json（CI 用）
.github/workflows/openwrt.yml
src/
  api/services/agent.ts packages.ts
  api/connection/demo/agent.ts
  hooks/agent-queries.ts
  features/traffic/  timeRange.ts csv.ts TimeRangePicker.tsx DeviceTrafficRow.tsx TodayTrafficCard.tsx
  features/agent/    manifest.ts install.ts download.ts AgentGate.tsx AgentBanner.tsx
  ui/charts/         TimeSeriesChart.tsx BarChart.tsx Sparkline.tsx scale.ts
  app/(tabs)/network/traffic/index.tsx [mac].tsx wan.tsx
  app/(tabs)/more/agent/index.tsx install.tsx
  i18n/locales/{zh-CN,en}/traffic.json agent.json
test/
  fixtures/agent-24.10/         插件接口的样本
  agent/accuracy.agent.ts
```

---

## 阶段 A：工程与构建

### T1. 目录骨架与构建文件

**文件**：`openwrt/routelinkd/Makefile`、`openwrt/routelinkd/src/CMakeLists.txt`、`openwrt/routelinkd/src/tests/t.h`、`openwrt/luci-app-routelink/Makefile`、`.gitignore`（加上 `openwrt/out/`）

```make
# openwrt/routelinkd/Makefile
include $(TOPDIR)/rules.mk

PKG_NAME:=routelinkd
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=tsix2019

include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/cmake.mk

define Package/routelinkd
  SECTION:=net
  CATEGORY:=Network
  TITLE:=RouteLink per-device traffic monitor
  DEPENDS:=+libubox +libubus +libuci +libjson-c +libmnl +kmod-nf-conntrack-netlink
endef

define Package/routelinkd/conffiles
/etc/config/routelink
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Package/routelinkd/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/init.d $(1)/etc/config $(1)/lib/upgrade/keep.d $(1)/etc/hotplug.d/ntp
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/routelinkd $(1)/usr/sbin/
	$(INSTALL_BIN) ./files/routelink.init $(1)/etc/init.d/routelink
	$(INSTALL_CONF) ./files/routelink.config $(1)/etc/config/routelink
	$(INSTALL_DATA) ./files/routelink.keep $(1)/lib/upgrade/keep.d/routelink
	$(INSTALL_DATA) ./files/routelink.upgrade.sh $(1)/lib/upgrade/routelink.sh
	$(INSTALL_DATA) ./files/routelink.ntp $(1)/etc/hotplug.d/ntp/90-routelink
endef

$(eval $(call BuildPackage,routelinkd))
```

```cmake
# openwrt/routelinkd/src/CMakeLists.txt
cmake_minimum_required(VERSION 3.13)
project(routelinkd C)
set(CMAKE_C_STANDARD 11)
add_compile_options(-Wall -Wextra -Werror)
option(RL_TESTS "Build host unit tests (core only)" OFF)
option(RL_SANITIZE "ASan + UBSan" OFF)
if(RL_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()
file(GLOB CORE core/*.c)
add_library(rlcore STATIC ${CORE})
target_link_libraries(rlcore json-c)
if(RL_TESTS)
  enable_testing()
  file(GLOB TESTS tests/test_*.c)
  foreach(t ${TESTS})
    get_filename_component(n ${t} NAME_WE)
    add_executable(${n} ${t})
    target_link_libraries(${n} rlcore)
    add_test(NAME ${n} COMMAND ${n})
  endforeach()
else()
  file(GLOB SYS sys/*.c)
  add_executable(routelinkd main.c ${SYS})
  target_link_libraries(routelinkd rlcore ubox ubus uci mnl blobmsg_json)
  install(TARGETS routelinkd RUNTIME DESTINATION sbin)
endif()
```

**测试辅助头文件** `tests/t.h`：约 40 行，不依赖第三方库。
- 提供 `T_ASSERT(cond)`、`T_EQ_U64(a,b)`、`T_EQ_I64(a,b)`、`T_EQ_STR(a,b)`、`T_RUN(fn)`。
- 失败时打印文件、行号、两边的值；最后返回失败数作为退出码。

**LuCI 包的 Makefile**：
```make
include $(TOPDIR)/rules.mk
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
LUCI_TITLE:=LuCI support for RouteLink
LUCI_DEPENDS:=+routelinkd
LUCI_PKGARCH:=all
PKG_LICENSE:=MIT
include $(TOPDIR)/feeds/luci/luci.mk
# call BuildPackage - OpenWrt buildroot signature
```

**验证**：`cmake -S openwrt/routelinkd/src -B /tmp/b -DRL_TESTS=ON` 能完成配置。此时还没有测试文件，所以先放一个空的 `test_smoke.c` 跑通流程。

**提交**：`chore(agent): package skeleton, CMake and host test harness`

### T2. 本机脚本

**文件**：`scripts/agent-test.sh`、`scripts/agent-build.sh`、`scripts/agent-dev-install.sh`、`openwrt/routelinkd/src/tests/Dockerfile`

**`openwrt/routelinkd/src/tests/Dockerfile`**：
```dockerfile
FROM gcc:14
RUN apt-get update -qq && apt-get install -y -qq cmake libjson-c-dev >/dev/null
```

**`agent-test.sh`**：
- 第一次运行时构建镜像 `routelink-ctest`。
- 然后执行：
  ```
  docker run --rm -v <repo>/openwrt/routelinkd/src:/src -w /tmp routelink-ctest \
    sh -c 'cmake -S /src -B b -DRL_TESTS=ON -DRL_SANITIZE=ON && cmake --build b -j && ctest --test-dir b --output-on-failure'
  ```
- 和 `dev-router.sh` 一样，Windows 路径用 `cygpath -w` 转换，并加上 `MSYS_NO_PATHCONV=1`。

**`agent-build.sh <版本> <架构>`**：
1. 镜像是 `openwrt/sdk:<target>-<版本>`。标签的具体格式以 Docker Hub 上的实际命名为准；x86_64 对应的 target 是 `x86-64`。
2. 把 SDK 目录挂到 Docker 卷 `routelink-sdk-<版本>-<架构>` 上。第一次运行时执行：
   - `./setup.sh`（如果镜像要求）
   - 在 `feeds.conf.default` 里加 `src-link routelink /feed`
   - `./scripts/feeds update -a && ./scripts/feeds install -a -p routelink`
3. 每次运行：`make defconfig`，然后 `make package/routelinkd/compile package/luci-app-routelink/compile V=s -j$(nproc)`。
4. 把 `bin/packages/*/routelink/` 下的 `.ipk` 或 `.apk` 复制到 `openwrt/out/<版本>/<架构>/`。

**`agent-dev-install.sh`**：
1. 把 `openwrt/out/24.10/x86_64/*.ipk` 用 `docker cp` 复制到测试路由器的 `/tmp/`。
2. 执行 `opkg update`（只在第一次需要）和 `opkg install /tmp/routelinkd_*.ipk /tmp/luci-app-routelink_*.ipk /tmp/luci-i18n-routelink-zh-cn_*.ipk`。
3. 打印 `ubus call routelink info` 的结果。

**验证**：
1. `scripts/agent-test.sh` 跑通 `test_smoke`。
2. `scripts/agent-build.sh 24.10 x86_64` 能编出 `routelinkd`。此时它只有一个空的 `main.c`：启动后打印版本号就退出。
3. 把 SDK 镜像的实际标签、首次编译用时、Docker 卷的大小写进"执行记录"。

**提交**：`chore(agent): local build, install and host-test scripts`

### T3. openwrt.yml 初版

**文件**：`.github/workflows/openwrt.yml`

```yaml
name: OpenWrt
on:
  push:
    branches: ['**']
    paths: ['openwrt/**', 'scripts/agent-*.sh', '.github/workflows/openwrt.yml']
    tags: ['agent-v*']
  pull_request:
    paths: ['openwrt/**']

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: sudo apt-get install -y -qq cmake libjson-c-dev
      - run: cmake -S openwrt/routelinkd/src -B b -DRL_TESTS=ON -DRL_SANITIZE=ON && cmake --build b -j && ctest --test-dir b --output-on-failure

  build:
    needs: unit
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        release: ['23.05', '24.10', '25.12']
        arch: [x86_64, aarch64_cortex-a53, aarch64_cortex-a72, aarch64_generic,
               arm_cortex-a7_neon-vfpv4, arm_cortex-a9_vfpv3-d16, arm_cortex-a15_neon-vfpv4,
               mipsel_24kc, mips_24kc]
    steps:
      - uses: actions/checkout@v7
      - uses: openwrt/gh-action-sdk@v<当前版本>   # 输入参数以该 Action 的 README 为准
        env:
          ARCH: ${{ matrix.arch }}-${{ matrix.release }}   # 格式以 README 为准
          FEEDNAME: routelink
          PACKAGES: routelinkd luci-app-routelink
          FEED_DIR: ${{ github.workspace }}/openwrt
          NO_REFRESH_CHECK: true
      - uses: actions/upload-artifact@v6
        with:
          name: pkg-${{ matrix.release }}-${{ matrix.arch }}
          path: bin/packages/${{ matrix.arch }}/routelink/
```

T27 会在这个工作流里加上签名、生成索引和发布的步骤。T19 会加上集成测试的 job。

**验证**：推送后，27 个编译 job 全部成功。如果某个"版本 × 架构"的 SDK 不存在，就把它从矩阵里删掉，并写进"执行记录"。

**提交**：`ci: openwrt.yml with host unit tests and SDK build matrix`

---

## 阶段 B：守护进程核心逻辑（纯 C，TDD）

本阶段每个模块都先写 `tests/test_<模块>.c`，用 `scripts/agent-test.sh` 确认失败，再实现。

### T4. 时间工具与桶对齐 `core/timeutil`

```c
/* core/timeutil.h */
typedef enum { RL_TIER_MINUTE, RL_TIER_HOUR, RL_TIER_DAY, RL_TIER_MONTH, RL_TIER_COUNT } rl_tier;

/* Bucket start for ts in the process-local time zone (TZ must already be set). */
int64_t rl_bucket_start(rl_tier tier, int64_t ts);
/* Start of the bucket after the one that contains ts. */
int64_t rl_bucket_next(rl_tier tier, int64_t ts);
/* Local hour of day (0-23) for ts. */
int rl_local_hour(int64_t ts);
/* Apply a POSIX TZ string (from /etc/TZ) to this process: setenv("TZ") + tzset(). */
void rl_tz_apply(const char *posix_tz);
```

**实现要点**：
- 分钟桶直接对 60 取整。
- 小时、天、月：先用 `localtime_r` 换成本地时间，把低位字段清零，再用 `mktime` 换回来（`tm_isdst = -1`）。
- 这样能处理 +5:30 这类半小时时区，也能处理夏令时。

**测试**（每个用例先调用 `rl_tz_apply` 设好时区）

| 时区 | 输入 | 预期 |
|---|---|---|
| `CST-8` | 2026-10-05 13:47:12 本地时间，小时桶 | 13:00:00 |
| `CST-8` | 同上，天桶 | 当天 00:00 本地时间 |
| `CST-8` | 2026-10-31 23:59 本地时间，`rl_bucket_next` 月桶 | 11-01 00:00 |
| `IST-5:30` | 10:15 本地时间，小时桶 | 10:00 本地时间（对应 UTC 04:30） |
| `CET-1CEST,M3.5.0,M10.5.0/3` | 夏令时结束那天，天桶的长度 | 25 小时 |
| `UTC0` | `rl_local_hour` | 等于 UTC 的小时数 |

**提交**：`feat(agent): local-time bucket alignment`

### T5. 地址工具与网段集合 `core/addr`

```c
/* core/addr.h */
typedef struct { uint8_t b[6]; } rl_mac;
typedef struct { uint8_t family; uint8_t a[16]; } rl_ip;   /* family: 4 or 6; v4 uses a[0..3] */
typedef struct { rl_ip net; uint8_t prefix; } rl_cidr;
typedef struct { rl_cidr *items; size_t n, cap; } rl_cidr_set;

bool rl_mac_parse(const char *s, rl_mac *out);          /* accepts : or -, any case */
void rl_mac_format(const rl_mac *m, char out[18]);     /* upper case, colons */
bool rl_mac_is_random(const rl_mac *m);                /* locally administered bit */
bool rl_ip_parse(const char *s, rl_ip *out);
void rl_ip_format(const rl_ip *ip, char out[46]);
bool rl_ip_eq(const rl_ip *a, const rl_ip *b);
uint32_t rl_ip_hash(const rl_ip *ip);
void rl_cidr_set_add(rl_cidr_set *s, const rl_ip *ip, uint8_t prefix);
bool rl_cidr_set_contains(const rl_cidr_set *s, const rl_ip *ip);
void rl_cidr_set_clear(rl_cidr_set *s);
```

**测试**

| 输入 | 预期 |
|---|---|
| `aa-bb-cc-00-11-22` | 格式化成 `AA:BB:CC:00:11:22` |
| `02:00:00:00:00:01` | 是随机 MAC |
| `00:1A:2B:00:00:01` | 不是随机 MAC |
| `192.168.1.0/24` 的集合，查询 `192.168.1.77` 和 `192.168.2.1` | 前者在集合里，后者不在 |
| `fd12:3456:789a::/48`，查询 `fd12:3456:789a:1::5` | 在集合里 |
| `/0` 前缀 | 包含同一地址族的所有地址，不包含另一个地址族 |
| 非法字符串 | `parse` 返回 false |

**提交**：`feat(agent): MAC/IP helpers and CIDR sets`

### T6. 连接计数差值 `core/flows`

```c
/* core/flows.h */
typedef struct {
	uint32_t ct_id;
	uint32_t tuple_hash;        /* hash of orig tuple: guards against id reuse */
	rl_ip orig_src, orig_dst, reply_src, reply_dst;
	uint8_t l4proto;
	uint64_t orig_bytes, reply_bytes, orig_pkts, reply_pkts;
} rl_ct_sample;

typedef struct { uint64_t orig_bytes, reply_bytes; } rl_delta;

typedef struct rl_flows rl_flows;
rl_flows *rl_flows_new(void);
void rl_flows_free(rl_flows *f);
/* Start of a dump pass (mark-and-sweep generation). */
void rl_flows_begin(rl_flows *f);
/* A flow seen in a dump: returns bytes since the last time we saw it (first sight: all bytes). */
rl_delta rl_flows_update(rl_flows *f, const rl_ct_sample *s, void **slot_userdata);
/* A DESTROY event: final delta, then the entry is removed. */
rl_delta rl_flows_destroy(rl_flows *f, const rl_ct_sample *s, void **slot_userdata);
/* End of a dump pass: drop entries not seen in this or the previous pass (lost DESTROY). */
size_t rl_flows_sweep(rl_flows *f);
size_t rl_flows_count(const rl_flows *f);
```

- **用户数据槽**：`slot_userdata` 让上层（T7）把"这条连接属于哪台设备、哪个分类"挂在连接上，只在第一次见到时计算。
- **计数变小时**：比如连接被别的程序清零，这一次的差值记为 0，并以新的计数为基准。

**测试**

| 场景 | 预期 |
|---|---|
| 第一次见到某条连接，orig=1000、reply=5000 | 差值是 1000/5000 |
| 再见到它，orig=1500、reply=9000 | 差值是 500/4000 |
| 收到 DESTROY，orig=1600、reply=9100 | 差值是 100/100，之后连接数减 1 |
| 没见过就收到 DESTROY（两次 dump 之间建立又关闭的短连接） | 差值是全部字节 |
| 同一个 `ct_id`，但 `tuple_hash` 不同 | 当作新连接，差值是全部字节 |
| 计数从 1500 变成 200 | 差值是 0，下一次从 200 起算 |
| 某条连接连续两轮 dump 都没出现，也没有 DESTROY | `sweep` 删除它 |
| 10 万条连接各更新 3 次 | 在 ASan 下运行，没有泄漏 |

**提交**：`feat(agent): conntrack counter deltas without zeroing`

### T7. 归属与分类 `core/classify`

```c
/* core/classify.h */
typedef enum { RL_CLASS_INTERNET, RL_CLASS_LAN, RL_CLASS_ROUTER } rl_class;

typedef struct {
	rl_cidr_set local;          /* LAN-zone subnets (v4 + v6 prefixes) */
	rl_cidr_set router_addrs;   /* every address on the router, as /32 or /128 */
} rl_netview;

typedef struct {
	int n;                      /* 0, 1 or 2 attributions */
	struct { rl_ip client; rl_class cls; bool client_is_orig; } a[2];
} rl_attribution;

/* Which LAN clients a flow belongs to and in which class. */
rl_attribution rl_classify(const rl_netview *nv, const rl_ct_sample *s);

/* rx/tx from the client's point of view. */
void rl_client_bytes(bool client_is_orig, rl_delta d, uint64_t *rx, uint64_t *tx);
```

**规则**（"本地"指在 `local` 里、但不是路由器自己的地址）：

| 连接 | 归属 |
|---|---|
| orig 源是本地、orig 目的不是本地也不是路由器 | 给 orig 源，分类为互联网；`client_is_orig=true` |
| orig 源不是本地，reply 源是本地（端口转发进来的连接） | 给 reply 源，分类为互联网；`client_is_orig=false` |
| orig 源和 reply 源都是本地 | 两边各记一份，分类为局域网 |
| 一端是本地设备，另一端是路由器自己（DNS、LuCI 等） | 给本地设备，分类为局域网 |
| 一端是路由器自己，另一端不是本地 | 给伪设备"路由器自身"，分类为路由器 |
| 其他情况（比如两端都不是本地） | 不统计 |

方向：`client_is_orig` 为真时，设备的 tx 等于 orig 字节、rx 等于 reply 字节；为假时反过来。

**测试**：上表每一行各写一个用例，IPv4 和 IPv6 各一份。另外断言：192.168.1.10 下载 1 MB 时，返回的是 rx=1MB 的那一侧，不会把上下行弄反（设计 §5.1）。

**提交**：`feat(agent): flow attribution and traffic classes`

### T8. 聚合与实时速率 `core/agg`

```c
/* core/agg.h */
#define RL_DEV_ROUTER 0xFFFE
#define RL_DEV_WAN    0xFFFF

typedef struct {
	int64_t ts;          /* bucket start */
	uint16_t dev;        /* device index or RL_DEV_* */
	uint8_t cls;         /* rl_class; WAN uses RL_CLASS_INTERNET */
	uint8_t flags;
	uint32_t conns;      /* max concurrent flows seen in the bucket */
	uint64_t rx, tx;
} rl_rec;                /* 32 bytes on disk, see T9 */

typedef struct rl_agg rl_agg;
/* on_close is called for every record of a bucket that just closed, in ts order. */
rl_agg *rl_agg_new(void (*on_close)(rl_tier, const rl_rec *, void *), void *ctx);
void rl_agg_add(rl_agg *a, int64_t now, uint16_t dev, rl_class cls, uint64_t rx, uint64_t tx);
void rl_agg_conns(rl_agg *a, uint16_t dev, uint32_t conns);
/* Close every bucket that ended before now (all tiers); call after each sample pass. */
void rl_agg_tick(rl_agg *a, int64_t now);
/* Open (unfinished) bucket values for queries. */
size_t rl_agg_open(const rl_agg *a, rl_tier tier, const rl_rec **out);

/* Live rates: bytes per second over the last sample interval. */
typedef struct { uint16_t dev; uint64_t rx_rate, tx_rate; } rl_rate;
void rl_agg_sample_done(rl_agg *a, int64_t now_ms);
size_t rl_agg_rates(const rl_agg *a, const rl_rate **out);
/* 2 s ring for the last 10 minutes (only filled while a live lease is active). */
size_t rl_agg_ring(const rl_agg *a, uint16_t dev, int64_t since_ms, const rl_rate **out);
```

- 每个差值同时累加到四个层的当前桶里（设计 §6.1）。
- **WAN 口**：每个桶都会写一条 WAN 记录，流量为 0 时也写。查询时，用"这个桶有没有 WAN 记录"来区分"没有流量"和"数据缺失"（T10）。

**测试**
1. 在同一分钟里加 3 次，`tick` 到下一分钟后，`on_close` 收到一条分钟记录，数值是三次之和；小时桶仍然是打开的。
2. 跨天时，分钟、小时、天三个层都关闭，各发出一条记录，月桶仍然打开。
3. 速率：两次采样相隔 2 秒，期间增加 2 MB，算出 1 MB/s。
4. 时间往回跳了 120 秒：当前桶不倒退，也不发出乱序的记录（`tick` 忽略回退的时间）。
5. 连续 30 秒没有任何流量时，只发出 WAN 的零值记录。

**提交**：`feat(agent): multi-tier aggregation and live rates`

### T9. 分层存储 `core/store`

**文件格式**：每层一个文件，`traffic.m`、`traffic.h`、`traffic.d`、`traffic.M`。

```c
/* core/store.h */
#define RL_STORE_MAGIC 0x31544c52u   /* "RLT1" */
typedef struct { uint32_t magic; uint16_t version, rec_size; uint8_t tier, pad[7]; } rl_file_hdr; /* 16 bytes */

typedef struct rl_store rl_store;
rl_store *rl_store_open(const char *dir, const rl_retention *ret);  /* creates files if missing */
void rl_store_close(rl_store *s);
/* Buffer a closed record in RAM until the next commit. */
void rl_store_append(rl_store *s, rl_tier tier, const rl_rec *r);
/* Append pending records to disk (fsync + no rewrite). */
int rl_store_commit(rl_store *s);
/* Drop expired records: rewrite to <file>.tmp, then rename. Called once a day and on size pressure. */
int rl_store_compact(rl_store *s, int64_t now, uint64_t max_bytes);
/* Iterate records with start <= ts < end from disk + pending, in ts order. */
typedef bool (*rl_rec_cb)(const rl_rec *r, void *ctx);
int rl_store_scan(rl_store *s, rl_tier tier, int64_t start, int64_t end, rl_rec_cb cb, void *ctx);
uint64_t rl_store_bytes(const rl_store *s);
int64_t rl_store_oldest(const rl_store *s, rl_tier tier);
```

- **记录**：32 字节，小端序，字段和 `rl_rec` 一一对应。
- **扫描**：文件里的记录本来就是按时间顺序追加的，扫描时先用二分查找定位起点，再顺序读。
- **加载**：启动时校验文件头。文件头不对、或者文件长度不是记录大小的整数倍时，把文件改名为 `.bad`，再新建一个空文件，并记一条事件。
- **原子写入**：压缩时先写临时文件，`fsync` 后再 `rename`。

**测试**（在临时目录里进行）
1. 追加 100 条，提交，重新打开，扫描结果完全一致。
2. 没提交就关闭：只有已提交的部分保留下来。
3. 扫描 [t1, t2)：只返回范围内的记录，而且同时包含磁盘上的和内存里待写的。
4. 压缩：过期的记录被删掉，没过期的保留，文件头有效。
5. 超过大小上限：先删分钟层最旧的数据。
6. 文件被截断成半条记录：重新打开后改名为 `.bad`，新文件可以正常使用。
7. 压缩到一半失败（模拟 `rename` 失败）：原文件完好无损。

**提交**：`feat(agent): append-only tier files with compaction`

### T10. 查询 `core/query`

```c
/* core/query.h */
typedef struct {
	int64_t start, end;
	int dev;                 /* -1: all devices (sum), else device index or RL_DEV_* */
	int cls;                 /* -1: internet+lan; else rl_class */
	uint32_t hours_mask;     /* 0: no filter; bit h = local hour h */
	int max_points;          /* default 500, max 1000 */
} rl_history_q;

typedef struct { int64_t ts; bool gap; uint64_t rx, tx; } rl_point;
typedef struct { rl_tier tier; int64_t step; size_t n; rl_point *pts; } rl_history;

int rl_query_history(rl_store *s, const rl_agg *a, const rl_history_q *q, int64_t now, rl_history *out);

typedef struct { int64_t start, end; int cls; uint32_t hours_mask; } rl_summary_q;
typedef struct { uint16_t dev; uint64_t rx, tx; } rl_dev_total;
typedef struct {
	int64_t start_exact; rl_tier granularity;
	uint64_t rx, tx, wan_rx, wan_tx;
	size_t n; rl_dev_total *devs;
} rl_summary;
int rl_query_summary(rl_store *s, const rl_agg *a, const rl_summary_q *q, int64_t now, rl_summary *out);
```

**选择粒度（history）**：
1. 从细到粗，选第一个保留期能覆盖 `start` 的层。
2. 步长 = 层的粒度 × ⌈（范围 ÷ 粒度）÷ max_points⌉。
3. 有 `hours_mask` 时，只能用分钟层或小时层。如果 `start` 早于小时层的保留期，返回 `INVALID_ARGUMENT`。

**缺失数据**：某个步长内一条 WAN 记录都没有，这个点就标为 `gap`。

**汇总（summary）的分段**：
- 从 `end` 往前，能用细层的部分用细层，更早的部分用粗层。比如查"最近 7 天"：前 5 天用小时层，最近 48 小时用分钟层。
- 桶是否计入，以桶的起始时间是否在 [start, end) 内为准。
- `start_exact` 是实际计入的第一个桶的起始时间。App 用它提示"早期数据精确到天"。
- 当前还没关闭的桶也会计入，所以"今天"包含最近几分钟的数据。

**测试**（用构造的 store 和 agg）

| 场景 | 预期 |
|---|---|
| 最近 1 小时 | 分钟层，步长 60，60 个点 |
| 最近 48 小时 | 分钟层，步长 360，480 个点 |
| 最近 30 天 | 小时层，步长 7200，360 个点 |
| 最近 2 年 | 天层 |
| 中间断电 2 小时（没有 WAN 记录） | 对应的点 `gap=true`，前后的点正常 |
| `hours_mask` 只含 20～22 点，范围 7 天 | 只计入每天 20:00～23:00 的数据 |
| `hours_mask` 加上 100 天前的起点 | `INVALID_ARGUMENT` |
| 汇总"最近 7 天" | 等于逐条累加各层记录的结果；`start_exact` 正确 |
| 汇总里包含当前还没关闭的桶 | 最近的流量也计入了 |
| 按 `rx+tx` 排序后取前 N 名 | 顺序正确 |

**提交**：`feat(agent): history and summary queries across tiers`

### T11. 设备表与在线状态 `core/devtab`

```c
/* core/devtab.h */
typedef struct {
	rl_mac mac;
	uint16_t idx;
	int64_t first_seen, last_seen, last_active;
	bool online;
	char hostname[64];           /* from DHCP; not persisted */
	char name[64];               /* dhcp host name / routelink_alias; not persisted */
} rl_device;

typedef struct rl_devtab rl_devtab;
rl_devtab *rl_devtab_load(const char *path);         /* devices.json; empty table if missing/corrupt */
int rl_devtab_save(const rl_devtab *t, const char *path);  /* json-c, tmp + rename */
/* Finds or creates; *created tells the caller to emit device_new. */
rl_device *rl_devtab_get(rl_devtab *t, const rl_mac *mac, int64_t now, bool *created);
rl_device *rl_devtab_by_idx(rl_devtab *t, uint16_t idx);
void rl_devtab_touch(rl_device *d, int64_t now);     /* traffic / neighbour REACHABLE / lease renew */
/* Online after any activity; offline after 180 s without activity. Calls cb on every change. */
void rl_devtab_presence(rl_devtab *t, int64_t now, void (*cb)(rl_device *, bool online, void *), void *ctx);
size_t rl_devtab_count(const rl_devtab *t);
void rl_devtab_clear(rl_devtab *t);
```

- 设备序号只增不减，最大 0xFFFD。
- `devices.json` 的格式：`{ "version": 1, "devices": [ { "idx": 2, "mac": "AA:..", "first": 0, "last": 0 } ] }`。

**测试**
1. 新 MAC：`created=true`，序号依次递增；同一个 MAC 再查一次，返回同一条。
2. 保存后重新加载：序号、首次和最近出现时间都一致。
3. JSON 损坏：加载成空表，不崩溃。
4. 在线判定：`touch` 后变为在线；第 179 秒仍在线；第 181 秒变为离线，回调只触发一次。
5. 离线后再次 `touch`：变为在线，回调触发一次。

**提交**：`feat(agent): device table and presence debounce`

### T12. 事件 `core/events`

```c
/* core/events.h */
typedef enum { RL_EV_DEVICE_NEW = 1, RL_EV_DEVICE_ONLINE, RL_EV_DEVICE_OFFLINE,
               RL_EV_DAEMON_START, RL_EV_TIME_JUMP, RL_EV_COMMIT_FAILED } rl_event_type;
typedef struct { uint32_t ts; uint16_t type, dev; int64_t a; } rl_event;   /* 16 bytes */

int rl_events_open(rl_events **e, const char *path, int keep_days, size_t cap);
void rl_events_add(rl_events *e, const rl_event *ev);
int rl_events_commit(rl_events *e);
int rl_events_scan(rl_events *e, int64_t start, int64_t end, uint32_t type_mask, int dev,
                   size_t offset, size_t limit, rl_event *out, size_t *n, size_t *total);
const char *rl_event_name(rl_event_type t);  /* "device_new", ... */
```

**测试**
1. 追加、提交、重新打开后能扫描到。
2. 按类型和设备过滤。
3. 分页的 `offset` 和 `limit` 正确，`total` 是过滤后的总数。
4. 超过 `cap` 或保留天数的事件，压缩后被删除。
5. `rl_event_name` 覆盖所有类型。

**提交**：`feat(agent): event log`

---

## 阶段 C：守护进程的系统接入

这一阶段的代码依赖系统库，没有主机单元测试，靠 T19 的集成测试验证。每个任务完成后，都要用 `agent-build.sh` 编译通过，再用 `agent-dev-install.sh` 装到测试路由器上，看日志（`logread -e routelinkd`）确认运行正常。

### T13. 连接跟踪 netlink `sys/ct`

```c
/* sys/ct.h */
typedef struct rl_ct rl_ct;
typedef void (*rl_ct_cb)(const rl_ct_sample *s, bool destroyed, void *ctx);
rl_ct *rl_ct_open(rl_ct_cb cb, void *ctx);          /* event socket: NFNLGRP_CONNTRACK_DESTROY */
int rl_ct_event_fd(const rl_ct *c);                 /* for uloop */
void rl_ct_on_readable(rl_ct *c);                    /* drains events; counts ENOBUFS */
int rl_ct_dump(rl_ct *c);                            /* IPCTNL_MSG_CT_GET + NLM_F_DUMP, AF_UNSPEC */
uint64_t rl_ct_events_lost(const rl_ct *c);
void rl_ct_close(rl_ct *c);
```

**实现要点**：
- **libmnl 解析**：用 libmnl 解析 `CTA_TUPLE_ORIG`、`CTA_TUPLE_REPLY`（里面的 `CTA_TUPLE_IP`、`CTA_TUPLE_PROTO`）、`CTA_COUNTERS_ORIG`、`CTA_COUNTERS_REPLY`、`CTA_ID`。所有数值都是网络字节序。
- **不能用 `IPCTNL_MSG_CT_GET_CTRZERO`**：它会把计数器清零（设计 §5.1）。
- **两个套接字**：dump 和事件分开用两个 netlink 套接字。事件套接字的接收缓冲区用 `SO_RCVBUFFORCE` 设成 4 MB。
- **事件丢失**：收到 `ENOBUFS` 时，把计数加 1，并立刻做一次 dump。
- **计数开关**：启动时读 `/proc/sys/net/netfilter/nf_conntrack_acct`，值为 0 时写入 1，并记一条日志。
- **tuple 哈希**：`tuple_hash` 用 orig 方向的五元组计算。

**验证**：在测试路由器上，开启调试日志（`-v`），确认每次 dump 打印的连接数和 `conntrack -C`（如果装了 conntrack-tools）一致，或者和 `/proc/net/nf_conntrack` 的行数一致。

**提交**：`feat(agent): conntrack dump and destroy events over libmnl`

### T14. 邻居表、租约与名称 `sys/neigh`

```c
/* sys/neigh.h */
typedef struct rl_neigh rl_neigh;
rl_neigh *rl_neigh_open(void (*on_reachable)(const rl_mac *, void *), void *ctx);
int rl_neigh_fd(const rl_neigh *n);
void rl_neigh_on_readable(rl_neigh *n);
int rl_neigh_dump(rl_neigh *n);                              /* RTM_GETNEIGH, AF_UNSPEC */
bool rl_neigh_lookup(const rl_neigh *n, const rl_ip *ip, rl_mac *out);
void rl_neigh_set_lan_ifindexes(rl_neigh *n, const int *idx, size_t count);
/* /tmp/dhcp.leases (+ ubus dhcp ipv6leases when odhcpd runs) and /etc/config/dhcp host names */
void rl_names_refresh(rl_devtab *t, rl_neigh *n);
```

**实现要点**：
- 订阅 `RTNLGRP_NEIGH`，只记录 LAN 接口上的条目。
- 收到状态为 `NUD_REACHABLE` 的更新时，调用 `on_reachable`，用于在线判定。
- **IP 到 MAC 的映射**：缓存在哈希表里。邻居表里找不到时，再查 DHCP 租约。
- **设备名称**：优先用 `dhcp` 配置里 host 段的 `routelink_alias`，其次用 `name`，最后用租约里的主机名。规则和 M1 T29 的约定一致。
- **刷新**：每 60 秒刷新一次；`/tmp/dhcp.leases` 的修改时间变化时也立即刷新。

**提交**：`feat(agent): neighbour cache, DHCP leases and device names`

### T15. 网络信息、角色、加速与 nlbwmon `sys/netinfo`、`sys/role`

**netinfo**：
- 通过 ubus 调用 `network.interface dump`，用 libuci 读 `firewall` 配置的 zone。
  - **WAN 区域**：`masq=1` 的 zone；其他 zone 都算 LAN 区域。
  - **LAN 网段**：LAN 区域里各接口的 `ipv4-address`、`ipv6-address`、`ipv6-prefix-assignment`。
  - **路由器地址**：所有接口的地址。
  - **WAN 设备**：WAN 区域里各接口的 `l3_device`。
- 订阅 ubus 的 `network.interface` 事件，接口变化时重新计算；另外每 60 秒兜底刷新一次。
- **WAN 计数器**：每次采样时读 `/sys/class/net/<WAN 设备>/statistics/{rx,tx}_bytes`，写进 `RL_DEV_WAN`。PPPoE 时读 `pppoe-wan`。

**role**：
- **角色**：有 WAN 区域并且有处于 up 状态的接口，就是 `gateway`。P1 只识别这一种角色；`ap` 在 P2 加上。
- **加速模式**：

| 配置 | 判定 |
|---|---|
| `firewall.@defaults[0].flow_offloading_hw=1` | `hardware` |
| `flow_offloading=1` | `software` |
| 存在 `turboacc` 配置，并且 `sfe_flow=1` | `sfe` |
| 都没有 | `none` |

  `hardware` 和 `sfe` 时，`offload_warning=true`。
- **nlbwmon**：调用 ubus 的 `service list {name:'nlbwmon'}`，有正在运行的实例时，`nlbwmon_running=true`。

**验证**：在测试路由器上分别把 `flow_offloading` 设为 0 和 1，`info` 报告的加速模式随之变化。

**提交**：`feat(agent): LAN/WAN view, role, offload and nlbwmon detection`

### T16. 配置、init 脚本与系统钩子

**`sys/config`**：用 libuci 读 `/etc/config/routelink`，字段见设计 §7.2。P1 用到的部分：

```
config routelink 'main'
	option enabled '1'
	option data_dir '/etc/routelink'
	option commit_interval '0'       # 0 = 自动：闪存 60 分钟，其他 10 分钟（设计 §6.3）
	option max_size_mb '32'
	option max_size_percent '10'
	option sample_interval '30'
	option live_interval '2'
	option traffic '1'

config retention 'retention'
	option minute_hours '48'
	option hour_days '90'
	option day_days '730'
	option event_days '90'
```

**闪存判定**：对数据目录调用 `statfs`。如果是 overlayfs，改看 `/overlay` 的文件系统类型。jffs2（`0x72b6`）和 ubifs（`0x24051905`）算闪存。

**`files/routelink.init`**：
```sh
#!/bin/sh /etc/rc.common
START=95
STOP=10
USE_PROCD=1

start_service() {
	config_load routelink
	config_get_bool enabled main enabled 1
	[ "$enabled" -eq 1 ] || return 0
	procd_open_instance
	procd_set_param command /usr/sbin/routelinkd
	procd_set_param respawn 3600 5 5
	procd_set_param term_timeout 15
	procd_set_param stderr 1
	procd_close_instance
}

service_triggers() {
	procd_add_reload_trigger routelink
}

reload_service() {
	procd_send_signal routelink
}
```

**`files/routelink.ntp`**（busybox ntpd 对时成功时会触发 `stratum` 事件）：
```sh
[ "$ACTION" = stratum ] && ubus -t 2 call routelink ntp_synced >/dev/null 2>&1
exit 0
```

**`files/routelink.upgrade.sh`**（升级固件前写一次盘）：
```sh
routelink_commit() { ubus -t 10 call routelink commit >/dev/null 2>&1; return 0; }
append sysupgrade_init_conffiles "routelink_commit"
```

**`files/routelink.keep`**：只有一行 `/etc/routelink/`。数据目录改了位置时，由守护进程在启动时重写 `/lib/upgrade/keep.d/routelink`。

**验证**（写进"执行记录"）：
1. `uci set routelink.main.sample_interval=10; uci commit routelink` 之后，日志显示守护进程收到 SIGHUP 并重新加载了配置。
2. `/etc/init.d/routelink stop`：日志显示停止前写了一次盘。
3. 执行 `sysupgrade -b /tmp/b.tgz`，确认 `routelink_commit` 被调用（看日志），并且备份里的数据文件是最新的。如果钩子不生效，记下原因，退而接受"最多丢一个写盘间隔"（设计 §6.3）。
4. 安装后服务是否被自动启用和启动。OpenWrt 的 `default_postinst` 会处理这件事，三个版本分别确认一下。

**提交**：`feat(agent): UCI config, procd init, NTP and sysupgrade hooks`

### T17. 主循环 `main.c`

**启动**：
1. 读取配置，应用 `/etc/TZ` 里的时区。
2. 打开 store、devtab、events。
3. 依次打开 ct、neigh、netinfo，注册 ubus 对象。
4. 记一条 `daemon_start` 事件。

**定时器**（用 uloop）：

| 定时器 | 间隔 | 做什么 |
|---|---|---|
| 采样 | 平时 `sample_interval`；实时租约期间 `live_interval` | 依次执行：`rl_flows_begin` → `rl_ct_dump`（每条连接都要做差值、归属和累加）→ `rl_flows_sweep` → 读 WAN 计数器 → `rl_agg_tick` → `rl_agg_sample_done` → `rl_devtab_presence` |
| 名称 | 60 秒 | `rl_names_refresh`、netinfo 兜底刷新 |
| 写盘 | 按 §6.3 的规则 | 对时完成后，才执行 `rl_store_commit`、`rl_events_commit`、`rl_devtab_save`；每天本地时间 0 点后第一次写盘时，顺带做压缩 |

**连接关闭事件**：DESTROY 事件到达时，立刻做差值并累加到当前桶。

**对时判定**：满足任一条件就认为已经对时：
- 收到过 `ntp_synced`
- `system.ntp.enabled=0`
- 运行时间超过 900 秒，并且当前时间晚于编译时间（`SOURCE_DATE_EPOCH`）

**时间跳变**：两次采样之间，时间往回超过 60 秒，或者往前超过 1 小时，记一条 `time_jump` 事件，并关闭所有打开的桶。

**信号**：

| 信号 | 处理 |
|---|---|
| SIGHUP | 重新加载配置（包括时区） |
| SIGTERM | 写一次盘，然后退出 |

**实时租约**：
- `live` 调用会把 `live_until` 设为当前时间 + 30 秒，并立刻采样一次。
- 租约到期后，采样间隔恢复为平时的值。

**验证**：在测试路由器上运行 10 分钟，日志里没有错误；`top` 显示 CPU 占用很低。

**提交**：`feat(agent): event loop, sampling, commits and live lease`

### T18. ubus 接口 `sys/api`

请求和返回的格式就是 App 和 LuCI 要遵守的**接口约定**（`api: 1`），T29 照着它写类型。

```jsonc
// info
{ "version": "0.1.0", "api": 1, "roles": ["gateway"], "modules": ["traffic"],
  "offload": "software", "offload_warning": false, "nlbwmon_running": false,
  "time_synced": true, "zonename": "Asia/Shanghai", "data_dir": "/etc/routelink",
  "storage_used": 1234567, "storage_limit": 33554432, "commit_interval": 600, "last_commit": 1759650000,
  "sample_interval": 30, "live_interval": 2, "live_until": 0, "started": 1759600000, "events_lost": 0,
  "retention": { "minute_hours": 48, "hour_days": 90, "day_days": 730, "event_days": 90 } }

// devices
{ "devices": [ { "mac": "AA:BB:CC:00:11:22", "name": "", "hostname": "iPhone", "ipv4": ["192.168.1.10"],
                 "ipv6": [], "first_seen": 0, "last_seen": 0, "online": true, "random_mac": true,
                 "trusted": false, "today_rx": 0, "today_tx": 0, "rx_rate": 0, "tx_rate": 0 } ] }

// live {}  — 申请或续期 30 秒的实时租约
{ "ts": 1759650000, "lease_until": 1759650030, "interval": 2,
  "wan": { "rx_rate": 0, "tx_rate": 0 }, "online": 18,
  "devices": [ { "mac": "...", "rx_rate": 0, "tx_rate": 0 } ] }        // 按 rx_rate+tx_rate 从大到小

// history { mac?, start, end, class?: "internet"|"lan"|"router"|"wan"|"all", hours?: int, max_points?: int }
{ "start": 0, "end": 0, "step": 60, "tier": "minute",
  "points": [ [1759650000, 123, 45], [1759650060, null, null] ] }       // null 表示数据缺失

// summary { start, end, class?, hours?, sort?: "total"|"rx"|"tx", limit?: 50, offset?: 0 }
{ "start_exact": 0, "end": 0, "granularity": "hour", "rx": 0, "tx": 0, "wan_rx": 0, "wan_tx": 0,
  "count": 23, "devices": [ { "mac": "...", "rx": 0, "tx": 0 } ] }

// events { start, end, types?: ["device_new", ...], mac?, limit?: 200, offset?: 0 }
{ "count": 3, "events": [ { "ts": 0, "type": "device_online", "mac": "..." } ] }

// reset { scope: "traffic"|"events"|"devices"|"all" }   → {}
// commit {}                                            → { "ok": true }
// ntp_synced {}                                         → {}
```

**参数校验**：以下情况一律返回 `UBUS_STATUS_INVALID_ARGUMENT`：
- `start >= end`
- 时间范围超过 10 年
- `max_points` 不在 1～1000 之间
- `mac` 格式不对
- `class`、`sort`、`scope` 取了未知的值
- `hours` 超出 24 位

**大小控制**：
- `devices` 和 `summary` 每次最多返回 500 台设备。
- `events` 每次最多返回 1000 条。
- 返回结果用 `blob_buf` 构造，超过 512 KB 时截断，并带上 `"truncated": true`。

**验证**：用 `ubus call routelink <方法> '<参数>'` 把每个方法都试一遍，包括非法参数，结果写进"执行记录"。

**提交**：`feat(agent): ubus API v1`

### T19. 实验环境与插件集成测试

**改 `scripts/dev-router.sh`**：
- `docker create` 加上 `--sysctl net.ipv6.conf.all.disable_ipv6=0`。
- `test/docker/network` 给 lan 加 `ip6addr 'fd30::2/64'`，给 wan 加 `ip6addr 'fd31::2/64'`。

**新建 `scripts/traffic-lab.sh up|down`**：

| 容器 | 网络 | 地址 | 内容 |
|---|---|---|---|
| `routelink-lab-server` | routelink-wan | 172.31.0.10、`fd31::10` | `alpine` + busybox httpd，提供 `/1k`、`/100m` 两个文件，另外跑一个 TCP echo 服务 |
| `routelink-lab-client` | routelink-lan | 172.30.0.10、`fd30::10` | `alpine` + wget、python3 |

- 两个容器都开 `NET_ADMIN`。
- 客户端的默认路由改成经过测试路由器：`ip route replace default via 172.30.0.2`，IPv6 走 `fd30::2`。
- IPv6 的转发路径：wan 侧加一条到 `fd30::/64` 的回程路由，具体做法在实施时确定。

**集成测试** `test/agent/accuracy.agent.ts`：
- 通过 `docker exec` 驱动客户端产生流量，再用 `UbusSession` 调用 `routelink`。
- **基准值**：客户端 `eth0` 的 `rx_bytes`、`tx_bytes` 差值，减去"包数 × 14"（以太网帧头），得到 IP 层的字节数。

| 测试 | 断言 |
|---|---|
| 下载 100 MB（关闭加速） | 设备的 rx 和基准值的误差小于 2% |
| 下载 100 MB（开启软件加速 `flow_offloading=1`） | 同上 |
| 1000 个短连接，每个下载 1 KB | 设备的 rx 和基准值的误差小于 2% |
| 通过 IPv6 下载 20 MB | 归到同一台设备，误差小于 2% |
| 上传 20 MB | 记在 tx 上，没有算进 rx |
| `live` 期间持续下载 | `rx_rate` 和实际速率的误差在 ±15% 以内 |
| `history` 和 `summary` | 最近 1 小时曲线的总和等于汇总值 |
| 重启守护进程 | 已经写盘的数据还在，中间缺失的那段标为 `null` |
| 启动 nlbwmon | `info.nlbwmon_running=true` |

**CI**：在 `openwrt.yml` 里加一个 `integration` job，依赖 `build` 中 24.10/x86_64 的产物，在 ubuntu 机器上依次执行 `dev-router.sh up` → `agent-dev-install.sh`（改为从下载的产物里安装）→ `traffic-lab.sh up` → `npx jest -c jest.agent.config.js`。

**需要记进"执行记录"**：
- Docker Desktop 的内核是否支持 flowtable（不支持时，本机跳过加速相关的用例，以 CI 的结果为准）
- IPv6 的转发路径具体怎么配
- 各用例的实测误差

**提交**：`test(agent): traffic lab and accuracy integration tests`

### T20. 性能测量

**方法**：
1. 在实验环境里，客户端用 python 开 5000 个空闲的 TCP 连接，连到服务器的 echo 端口。同时用 50 个不同的 MAC 在客户端上建 macvlan 子接口，模拟 50 台设备。
2. 读取 `/proc/<pid>/stat` 的 utime+stime 和 `/proc/<pid>/status` 的 VmRSS，分别测平时模式和实时模式，各测 5 分钟。
3. 有条件时，在 QEMU 的 malta（mipsel_24kc）OpenWrt 上再测一次，作为 MIPS 平台的粗略参考（设计 §21）。

**目标**：见设计 §6.5。在 x86 上超标时先优化：
- 连接表哈希的负载因子
- dump 回调里避免分配内存

**需要记进"执行记录"**：x86 的实测数字、QEMU MIPS 的实测数字（或者没测的原因）。

**提交**：`perf(agent): measurement notes`（如果有优化，就和优化代码一起提交）

---

## 阶段 D：LuCI 页面

做完每个页面，都要在电脑浏览器里打开测试路由器（`http://127.0.0.1:18080`）实际看一遍。实验环境要开着，这样页面上有数据。

### T21. LuCI 骨架

**菜单** `root/usr/share/luci/menu.d/luci-app-routelink.json`：
```json
{
  "admin/services/routelink": {
    "title": "RouteLink", "order": 60,
    "action": { "type": "firstchild" },
    "depends": { "acl": [ "luci-app-routelink" ] }
  },
  "admin/services/routelink/overview": { "title": "Overview", "order": 1, "action": { "type": "view", "path": "routelink/overview" } },
  "admin/services/routelink/traffic":  { "title": "Traffic",  "order": 2, "action": { "type": "view", "path": "routelink/traffic" } },
  "admin/services/routelink/settings": { "title": "Settings", "order": 9, "action": { "type": "view", "path": "routelink/settings" } }
}
```

**ACL** `root/usr/share/rpcd/acl.d/luci-app-routelink.json`：
```json
{
  "luci-app-routelink": {
    "description": "Grant access to RouteLink",
    "read":  { "ubus": { "routelink": [ "info", "devices", "live", "history", "summary", "events" ] },
               "uci": [ "routelink" ] },
    "write": { "ubus": { "routelink": [ "reset", "commit" ] },
               "uci": [ "routelink" ] }
  }
}
```
`ntp_synced` 不授权给任何账号，只能由本机的 root 调用。

**共享模块** `routelink/common.js`：
- **rpc 声明**：所有方法都用 `rpc.declare` 声明。
- **格式化**：字节、速率、时间。
- **图表**：`chartSeries(points, {height})` 返回一个 SVG 元素，画上下行两条面积，缺失数据处断开；`barList(items)` 画排行条。
- **时间段**：`timeRanges()` 返回和 App 相同的预设（T31）。

**翻译**：建 `po/templates/routelink.pot`，用 LuCI 仓库的 `i18n-scan.pl` 扫描生成。

**提交**：`feat(luci): menu, ACL and shared rpc/chart module`

### T22. 概览页 `view/routelink/overview.js`

- **状态卡**：
  - 角色、版本、对时状态、存储占用和上限、上次写盘时间。
  - `offload_warning` 和 `nlbwmon_running` 为真时显示警告条。nlbwmon 的警告条带"停用 nlbwmon"按钮，点击后执行 `rc init nlbwmon stop/disable`；LuCI 的 `rc` 接口需要 luci-mod-system 的权限。
- **实时卡**：WAN 上下行速率和最近 2 分钟的曲线。用 `poll.add` 每 2 秒调用一次 `live`，同时续期租约。
- **今日排行**：用量前 5 名，点击跳到流量页，并打开那台设备的详情。
- **非主路由**：本机不是主路由时，只显示提示"本机不是主路由，流量统计未启用"。

**提交**：`feat(luci): overview page`

### T23. 流量页 `view/routelink/traffic.js`

- **时间段**：预设按钮，加上自定义起止时间（`<input type="datetime-local">`）和可选的"每天时段"。
- **概要**：下载、上传、WAN 总量，以及上下行曲线（`history`）。
- **筛选**：可以切换"互联网"和"局域网"。
- **排行表**：设备名、MAC、IP、下载、上传、合计、占比条。可以按列排序，每页 50 条。
- **实时表**：切换到"实时"后，每 2 秒调用 `live`，按当前速率排序。
- **导出**：在浏览器里生成 CSV 并下载，格式和 App 一致（T32）。
- **设备详情**：用 `ui.showModal` 弹出，包括这台设备的曲线、总量、峰值速率，以及上下行记录（`events`，只列这台设备的上线和下线）。
- **数据精度**：`start_exact` 晚于所选起点时，提示"更早的数据只保留到天"。

**提交**：`feat(luci): traffic page with ranking, live table and device modal`

### T24. 设置页 `view/routelink/settings.js`

- 用 `form.Map('routelink')` 编辑：开关、数据目录、写盘间隔（0 表示自动）、大小上限、采样间隔、各层的保留期。
- **数据管理**：
  - "立即写盘"按钮，调用 `commit`。
  - "清空数据"按钮，调用 `reset`，分别清空流量、事件、设备或全部。执行前用 `ui.showModal` 二次确认。
- **数据目录**：修改时提示"旧目录里的数据不会自动迁移"。

**提交**：`feat(luci): settings page`

### T25. 中文翻译与 LuCI 验收

- 更新 `.pot`，编写 `po/zh_Hans/routelink.po`，翻译全部条目。
- **验收**（截图存进 `docs/screenshots/luci/`，中英文各一套）：
  1. 三个页面在中文和英文下都没有漏翻的文字。
  2. 实验环境产生流量时，概览和流量页能看到实时变化。
  3. 用非 root 账号登录 LuCI（rpcd 里另建一个只授权 `luci-app-routelink` 的账号）时，菜单可见，`reset` 能执行。不授权时，菜单不显示。

**提交**：`feat(luci): zh_Hans translation`

---

## 阶段 E：发布

### T26. 签名密钥（需要你确认）

1. **生成密钥**：在测试路由器容器里生成，容器里自带 `usign` 和 `openssl`：
   - opkg 用的 usign 密钥：`usign -G -s key-build -p key-build.pub -c "RouteLink feed"`
   - apk 用的 ECDSA 密钥：`openssl ecparam -name prime256v1 -genkey -noout -out apk-private.pem`，再导出 `apk-public.pem`
2. **备份**：把密钥复制到 `D:\RouteLink-keys\openwrt\`。
3. **公钥**：公钥提交到仓库的 `openwrt/feed/keys/`。
4. **存进 GitHub Secrets**：私钥用 `gh secret set` 存成 `OPENWRT_USIGN_KEY` 和 `OPENWRT_APK_KEY`。**这一步会写入你的 GitHub 仓库，执行前先征得你的同意。**
5. **开启 GitHub Pages**：Pages 的来源设为 GitHub Actions，可以用 `gh api` 设置。**同样先征得你的同意。**

**提交**：`chore(agent): public feed keys`

### T27. 发布流程：Releases、manifest 与软件源

在 `openwrt.yml` 里，打 `agent-v*` 标签时额外执行以下步骤：

1. **签名**：编译时开启 `INDEX=1`，并传入 `KEY_BUILD` 和 `PRIVATE_KEY`（变量名以 `gh-action-sdk` 的 README 为准），生成带签名的索引。
2. **汇总 job `publish`**：下载所有编译产物，然后：
   - **重命名**：文件名统一成 `<包名>_<版本>-r<发布号>_<OpenWrt 版本>_<架构>.<ipk|apk>`。
   - **生成清单**：用 `npx tsx scripts/agent-manifest.ts` 生成 `manifest.json`：
     ```json
     { "version": "0.1.0", "api": 1, "tag": "agent-v0.1.0", "released": "2026-..",
       "targets": { "24.10/x86_64": { "format": "ipk",
         "files": [ { "package": "routelinkd", "name": "routelinkd_0.1.0-r1_24.10_x86_64.ipk",
                      "url": "https://github.com/tsix2019/RouteLink/releases/download/agent-v0.1.0/...",
                      "sha256": "...", "size": 123456 } ] } } }
     ```
   - **发布到 Releases**：`gh release create agent-v0.1.0`，上传全部安装包和 `manifest.json`，发布说明写上安装方法。
   - **发布软件源**：把软件源目录 `agent/<OpenWrt 版本>/<架构>/`（安装包加签名索引）、`agent/manifest.json`、`agent/keys/` 用 `actions/deploy-pages` 发布到 GitHub Pages。
3. **测试 `agent-manifest.ts`**：放在 Jest 里（`scripts/agent-manifest.test.ts`），断言文件名解析、SHA-256、URL 拼接都正确。

**验证**：先打一个预发布标签 `agent-v0.1.0-rc.1`，确认 Releases 和 Pages 的内容。然后在测试路由器上按 README 的方法手动添加软件源，`opkg update && opkg install routelinkd` 能通过签名校验。预发布标签不进软件源的正式路径，`agent-manifest.ts` 会在清单里标注 `"prerelease": true`。

**推送标签之前先征得你的同意。**

**提交**：`ci: sign, index and publish agent packages`

### T28. 包管理器的调用方式（三个版本）

用 `dev-router.sh up 23.05.x`、`24.10.8`、`25.12.x` 分别启动测试路由器，在每个版本上确认以下几点，结果写进"执行记录"。T33 照这个结果实现。

1. **LuCI 的包管理页**：用的是哪个辅助程序（`/usr/libexec/opkg-call` 还是 `/usr/libexec/package-manager-call`）、支持哪些参数（`update`、`install <文件或包名>`、`remove`），以及 ACL 文件里授权的命令和上传路径（比如 `/tmp/upload.ipk`）。
2. **写文件**：`file write` 是否支持 `base64: true` 和 `append: true`。用 48 KB 一块分块写入一个 300 KB 的文件，再用 `file md5` 或 `sha256sum` 校验是否完整。
   - **不支持时的备选**：通过 cgi-io 上传。这需要在原生模块里加 multipart 上传，记入"执行记录"，并调整 T33。
3. **安装本地包**：`install` 一个本地文件时，依赖会不会从软件源自动补装；软件包列表不存在时，返回什么错误。
4. **执行时长**：`file exec` 有没有超时；`update` 加上 `install` 的实际用时。
5. **添加软件源**：root 账号能不能写 `/etc/opkg/customfeeds.conf`、`/etc/opkg/keys/`（25.12 是 `/etc/apk/repositories.d/`、`/etc/apk/keys/`）。决定设计 §13.3 第 7 步的"同时添加软件源"能不能做。做不了时，改成在界面上显示手动添加的命令。
6. **识别架构**：`file read /etc/os-release` 读得到 `OPENWRT_ARCH`；`system info` 的 `root` 字段能反映剩余空间。

**提交**：`docs: package manager behaviour per OpenWrt release`（把结论写进计划的"执行记录"）

---

## 阶段 F：App 接入层（TDD）

### T29. 插件接口客户端 `services/agent.ts`

```ts
// src/api/services/agent.ts
export const AGENT_API = { min: 1, max: 1 } as const;

export interface AgentInfo {
  version: string; api: number; roles: ('gateway' | 'ap')[]; modules: string[];
  offload: 'none' | 'software' | 'hardware' | 'sfe'; offloadWarning: boolean; nlbwmonRunning: boolean;
  timeSynced: boolean; zonename: string; dataDir: string;
  storage: { usedBytes: number; limitBytes: number }; lastCommit: number; liveUntil: number;
}
export interface AgentDevice {
  mac: string; name?: string; hostname?: string; ipv4: string[]; ipv6: string[];
  firstSeen: number; lastSeen: number; online: boolean; randomMac: boolean; trusted: boolean;
  today: { rx: number; tx: number };             // bytes
  rate: { rxBps: number; txBps: number };        // bits per second
}
export type TrafficClass = 'internet' | 'lan' | 'router' | 'wan' | 'all';
export interface HistoryQuery { mac?: string; start: number; end: number; cls?: TrafficClass; hoursMask?: number; maxPoints?: number }
export interface History { start: number; end: number; step: number; tier: 'minute' | 'hour' | 'day' | 'month';
  points: { t: number; rx: number | null; tx: number | null }[] }
export interface SummaryQuery { start: number; end: number; cls?: TrafficClass; hoursMask?: number;
  sort?: 'total' | 'rx' | 'tx'; limit?: number; offset?: number }
export interface Summary { startExact: number; end: number; granularity: 'minute' | 'hour' | 'day';
  rx: number; tx: number; wanRx: number; wanTx: number; count: number; devices: { mac: string; rx: number; tx: number }[] }
export interface Live { ts: number; leaseUntil: number; intervalSec: number; wan: { rxBps: number; txBps: number };
  online: number; devices: { mac: string; rxBps: number; txBps: number }[] }
export interface AgentEvent { ts: number; type: string; mac?: string }

export function getAgentInfo(conn: RouterConnection): Promise<AgentInfo>;
export function getAgentDevices(conn: RouterConnection): Promise<AgentDevice[]>;
export function agentLive(conn: RouterConnection): Promise<Live>;
export function agentHistory(conn: RouterConnection, q: HistoryQuery): Promise<History>;
export function agentSummary(conn: RouterConnection, q: SummaryQuery): Promise<Summary>;
export function agentEvents(conn: RouterConnection, q: { start: number; end: number; types?: string[]; mac?: string; limit?: number; offset?: number }): Promise<{ count: number; events: AgentEvent[] }>;
export function agentReset(conn: RouterConnection, scope: 'traffic' | 'events' | 'devices' | 'all'): Promise<void>;
export function agentCommit(conn: RouterConnection): Promise<void>;
```

**解析规则**：
- snake_case 转成 camelCase；速率从字节/秒乘 8 换成比特/秒。
- 字段缺失时用安全的默认值，不抛异常。
- `points` 里的 `null` 保留为 `null`。

**样本**：
- 扩展 `scripts/record-fixtures.ts`：加一个 `--agent` 选项，录制 `routelink.*` 的全部方法，存到 `test/fixtures/agent-24.10/`。
- 录制前先开实验环境产生一些流量。录制的参数在脚本里写死：最近 1 小时、今天。

**测试**：
1. 用 `FixtureConnection` 读录好的样本，断言每个函数都能解析，字段值合理（比如 MAC 格式、速率不小于 0）。
2. 手写几个特殊样本：缺失字段、`null` 点、`truncated`。

**提交**：`feat(app): routelink agent service client`

### T30. 插件状态与 hooks

```ts
// src/api/services/agent.ts（续）
export type AgentStatus =
  | { state: 'ok'; info: AgentInfo }
  | { state: 'not-installed' }
  | { state: 'not-running' }                       // 包装了（/usr/sbin/routelinkd 存在），但 ubus 对象不在
  | { state: 'too-old'; info: AgentInfo }          // info.api < AGENT_API.min
  | { state: 'too-new'; info: AgentInfo }          // info.api > AGENT_API.max
  | { state: 'no-permission' };
export async function getAgentStatus(conn: RouterConnection): Promise<AgentStatus>;
```

**判定**：一次批量调用里同时做 `routelink.info` 和 `file.stat /usr/sbin/routelinkd`：

| 结果 | 状态 |
|---|---|
| `info` 成功 | 看 `api` 是否在 `AGENT_API` 范围内：在范围内为 `ok`，太小为 `too-old`，太大为 `too-new` |
| `METHOD_NOT_FOUND` 或 `NOT_FOUND`，并且文件存在 | `not-running` |
| `METHOD_NOT_FOUND` 或 `NOT_FOUND`，并且文件不存在 | `not-installed` |
| `PERMISSION_DENIED` | `no-permission` |

**hooks** `src/hooks/agent-queries.ts`：
```ts
export const useAgentStatus = () => useRouterQuery(['agent', 'status'], getAgentStatus, { staleTime: 60_000 });
export const useAgentDevices = (enabled: boolean) => useRouterQuery(['agent', 'devices'], getAgentDevices, { refetchInterval: 10_000, enabled });
export const useAgentLive = (enabled: boolean) => useRouterQuery(['agent', 'live'], agentLive, { refetchInterval: 2_000, enabled, staleTime: 0 });
export const useTrafficSummary = (q: SummaryQuery | null) => useRouterQuery(['agent', 'summary', q], (c) => agentSummary(c, q!), { enabled: !!q });
export const useTrafficHistory = (q: HistoryQuery | null) => useRouterQuery(['agent', 'history', q], (c) => agentHistory(c, q!), { enabled: !!q });
```
- `useAgentLive` 只在页面获得焦点时轮询。这一点沿用 `useRouterQuery` 的现有行为，正好对应设计 §5.1 的"页面开着就续期"。
- 安装或卸载插件之后，让 `['agent']` 开头的所有查询失效。

**测试**：`getAgentStatus` 对上表的五种情况各写一个用例。

**提交**：`feat(app): agent status detection and query hooks`

### T31. 时间段换算 `features/traffic/timeRange.ts`

```ts
export type PresetId = 'lastHour' | 'today' | 'yesterday' | 'last7d' | 'thisMonth' | 'lastMonth' | 'last30d';
export interface HourWindow { from: number; to: number }   // 0..23; from > to 表示跨过午夜，比如 22→6
export type TimeRange =
  | { kind: 'preset'; id: PresetId; hours?: HourWindow }
  | { kind: 'custom'; start: number; end: number; hours?: HourWindow };   // 秒

export function resolveRange(r: TimeRange, now: Date): { start: number; end: number };
export function hoursMask(w: HourWindow): number;          // 24 位
export function rangeLabel(t: TFunction, r: TimeRange, locale: string): string;
export function validateCustom(start: number, end: number, now: number): 'ok' | 'empty' | 'future' | 'too-long';
```

- 所有预设都按手机的本地时区计算（设计 §15）。
- `end` 取当前时间，或者那一天、那个月的结束时刻，取两者中较早的一个。

**测试**（用固定的 `now` 和时区；Jest 里通过 `process.env.TZ` 设置）

| 输入 | 预期 |
|---|---|
| `today`，now = 10-05 13:47 +08 | [10-05 00:00, 13:47] |
| `yesterday` | [10-04 00:00, 10-05 00:00) |
| `lastMonth`，now = 2026-03-10 | [02-01, 03-01) |
| `last7d` | start = now − 7×86400 |
| `hoursMask({from:20,to:23})` | 第 20、21、22 位为 1 |
| `hoursMask({from:22,to:6})` | 第 22、23、0～5 位为 1 |
| `validateCustom`：结束时间早于开始时间 | `empty` |
| `validateCustom`：范围超过 10 年 | `too-long` |

**提交**：`feat(app): traffic time ranges`

### T32. CSV 生成 `features/traffic/csv.ts`

```ts
export function summaryCsv(s: Summary, names: Map<string, string>, range: { start: number; end: number }, tz: string): string;
export function historyCsv(h: History, tz: string): string;
```

- **格式**：开头加 UTF-8 BOM，这样 Excel 打开中文不乱码。
- **列**：
  - 汇总：设备名、MAC、下载字节、上传字节、合计。
  - 曲线：时间、下载字节、上传字节。
- **时间格式**：`YYYY-MM-DD HH:mm`，用手机时区。
- **转义**：字段里有逗号、引号或换行时，按 RFC 4180 转义。
- **缺失数据**：留空。

**测试**：BOM、转义、缺失数据各写一个用例；用快照测试锁定完整输出。

**提交**：`feat(app): traffic CSV export`

### T33. 一键安装的状态机 `features/agent/install.ts`、`services/packages.ts`

**`services/packages.ts`**（M2 的 MO-5 也会复用）：
```ts
export interface PackageEnv {
  release: string;            // "24.10"，取自 system board
  arch: string;               // 取自 distfeeds 里的 URL（.../packages/<arch>/base），/etc/os-release 没有读权限
  manager: 'opkg' | 'apk';
  helper: '/usr/libexec/opkg-call' | '/usr/libexec/package-manager-call';
  uploadPath: '/tmp/upload.ipk' | '/tmp/upload.apk';
  updateArgs: string[];       // 23.05：['update', '-q']（ACL 只认 "update *"）；24.10 起：['update']
  freeKb: number;
  hasLists: boolean;
}
export function detectPackageEnv(conn: RouterConnection): Promise<PackageEnv | { unsupported: 'no-helper' | 'not-openwrt' | 'no-permission' }>;
/** 每块 32 KB：48 KB 编码成 base64 后超过 uhttpd 64 KB 的请求上限，会返回 Parse error */
export function writeFileChunks(conn: RouterConnection, path: string, bytes: Uint8Array, chunk = 32 * 1024): Promise<void>;
export function updateLists(conn: RouterConnection, env: PackageEnv): Promise<void>;
/** 走 conn.cgiExec：ubus 的 file exec 在包的 postinst 重载 rpcd 时会一直挂到 uhttpd 的 60 秒超时 */
export function installUploaded(conn: RouterConnection, env: PackageEnv): Promise<{ ok: boolean; output: string }>;
export function removePackages(conn: RouterConnection, env: PackageEnv, names: string[]): Promise<{ ok: boolean; output: string }>;
/** apk 不接受未签名的本地包，辅助程序又不放行 --allow-untrusted：先把 routelink-apk.pem 写进 /etc/apk/keys/ */
export function trustApkKey(conn: RouterConnection, pem: string): Promise<void>;
```
- **新增 `RouterConnection.cgiExec(argv: string[]): Promise<string>`**：
  - LiveConnection 向 `<路由器地址>/cgi-bin/cgi-exec` POST 表单 `sessionid`、`command`；命令里的空白字符要用反斜杠转义，和 LuCI 的 `fs.exec_direct` 一样。
  - 返回辅助程序打印的 JSON（`code`、`stdout`、`stderr`）。
  - DemoConnection 里模拟这个方法。
- 各版本的实测结论见"执行记录"的 T28。

**`features/agent/manifest.ts`**：
```ts
export interface Manifest { version: string; api: number; prerelease?: boolean; targets: Record<string, { format: 'ipk' | 'apk'; files: ManifestFile[] }> }
export interface ManifestFile { package: string; name: string; url: string; sha256: string; size: number }
export function parseManifest(json: unknown): Manifest;
export function pickTarget(m: Manifest, env: PackageEnv): ManifestFile[] | 'unsupported-release' | 'unsupported-arch';
export function applyMirror(url: string, mirror?: string): string;   // mirror 是前缀，比如 https://ghproxy.example/
export const INSTALL_ORDER = ['routelinkd', 'luci-app-routelink', 'luci-i18n-routelink-zh-cn'];
```

**`features/agent/install.ts`**：纯状态机，所有外部操作都通过注入的依赖完成，方便测试。
```ts
export type InstallStep =
  | { step: 'detect' } | { step: 'manifest' }
  | { step: 'download'; index: number; total: number }
  | { step: 'upload'; index: number; total: number; sent: number; size: number }
  | { step: 'lists' } | { step: 'install'; index: number; total: number }
  | { step: 'verify' } | { step: 'done'; version: string }
  | { step: 'failed'; reason: InstallFailure; detail?: string };
export type InstallFailure = 'not-root' | 'no-helper' | 'unsupported-release' | 'unsupported-arch'
  | 'no-space' | 'download' | 'checksum' | 'upload' | 'lists' | 'dependencies' | 'install' | 'verify';
export interface InstallDeps {
  conn: RouterConnection;
  fetchManifest(): Promise<unknown>;
  download(url: string): Promise<Uint8Array>;
  sha256(bytes: Uint8Array): Promise<string>;
  onStep(s: InstallStep): void;
  sleep(ms: number): Promise<void>;
}
export function installAgent(deps: InstallDeps, mirror?: string): Promise<InstallStep>;
```

**流程**：
1. **识别**：`detectPackageEnv`。
2. **取清单**：`fetchManifest`，再 `pickTarget`。
3. **检查空间**：所需空间按文件总大小的 3 倍估算，剩余空间不够时失败。
4. **逐个安装**：
   - 第一次安装之前，如果 `!hasLists`，先 `updateLists`。
   - apk 系统先 `trustApkKey`。
   - 按 `INSTALL_ORDER` 的顺序，每个包依次 `download` → 校验 SHA-256 → `writeFileChunks` → `installUploaded`。
5. **确认**：每秒调用一次 `getAgentStatus`，最多 15 秒，直到变为 `ok`。

**失败原因的判断**：
- 安装输出里出现 `cannot find dependency` 或 `unable to select packages` → `dependencies`，`detail` 里带上缺少的包名。
- 其他非零退出 → `install`。

**测试**（用假的依赖和 `FixtureConnection` 的覆盖）
1. 一路顺利，步骤序列完全符合预期。
2. 每一种 `InstallFailure` 各写一个用例。
3. SHA-256 不一致时，不会上传。
4. 镜像前缀被正确加到 URL 前面。
5. 写文件分块：300 KB 的文件分成 10 块，第一块 `append:false`，其余 `append:true`。
6. apk 系统：安装前写入 `/etc/apk/keys/routelink.pem`；opkg 系统不写。
7. 23.05 的 `update` 带 `-q`，24.10 起不带。

**提交**：`feat(app): one-tap agent install state machine`

### T34. 演示模式

**`src/api/connection/demo/agent.ts`**：
- **确定性的流量模型**：每台演示设备的用量由"设备 × 时间桶"决定。
  - 用 `seed`、设备序号、桶的起始时间做种子，生成伪随机数。
  - 叠加一条按小时变化的日常曲线：晚上 20～23 点最高，凌晨 2～6 点最低。
  - 这样查任意时间段的结果都稳定，不需要存储。
- **处理函数**：`routelink.info`、`devices`、`live`、`history`、`summary`、`events`、`reset`、`commit`，注册进 `handlers`。
  - 演示路由器的插件状态是 `ok`。
  - `live` 用 `state.wanRate` 按设备拆分，各设备的速率之和等于 WAN 速率。
- **演示安装流程**：`file.stat`、包管理器的辅助程序、`file.write` 也做模拟，安装流程可以完整走一遍，用时大约 6 秒。

**契约测试**：在 `contract.test.ts` 里加上 `routelink.*`，断言演示连接返回的数据能被 T29 的解析函数正确解析；`summary` 的合计等于 `history` 的总和（同一时间段）。

**提交**：`feat(demo): routelink agent in demo mode`

---

## 阶段 G：App 界面

这一阶段的每个任务都在 Android 模拟器上按"验收"清单截图核对。iOS 以 CI 的截图为准。新增的文字全部写进 `traffic.json` 或 `agent.json`，中英文都要有，并且在 `resources.ts`、`i18next.d.ts` 里注册这两个命名空间。

### T35. 新依赖

1. 按 AGENTS.md 的要求，先读 Expo SDK 57 的文档（`https://docs.expo.dev/versions/v57.0.0/`），确认以下几点：
   - `expo-file-system` 的下载和读取 API，SDK 57 用的是新的 `File` 类 API
   - `expo-sharing` 的 `shareAsync`
   - `expo-crypto` 的 `digest`
   - `@react-native-community/datetimepicker` 和 SDK 57 是否兼容
2. `npx expo install expo-file-system expo-sharing expo-crypto @react-native-community/datetimepicker`
3. **`features/agent/download.ts`**：
   - **下载**：用 `expo-file-system` 下载到缓存目录，再读出字节。
   - **校验**：用 `expo-crypto` 计算 SHA-256。
   - **清单**：直接用 `fetch` 读 `manifest.json`。这是访问 GitHub 的公开 HTTPS，不经过路由器，所以不走原生模块。
4. 重新编译开发版：`npx expo run:android`。在 iOS CI 里确认能编译。

**验证**：在模拟器里写一个临时的调试按钮，下载一个文件并计算 SHA-256，和电脑上 `sha256sum` 的结果一致。验证完删掉这个按钮。

**提交**：`chore(app): file system, sharing, crypto and date picker`

### T36. 图表

**纯函数** `src/ui/charts/scale.ts`（有单元测试）：
- `timeTicks(start, end, width)`：根据时间范围选择刻度，比如每小时、每 6 小时、每天、每周、每月。
- `niceMax`：复用现有的实现。
- `segments(points)`：遇到缺失的点就把曲线断开。

**组件**：
- **`TimeSeriesChart`**：
  - 上下行两条面积曲线，缺失处断开，并在缺失处画虚线框，标注"数据缺失"。
  - 有横轴时间刻度。
  - 用 `react-native-gesture-handler` 实现按住拖动，显示当前时间点的下载和上传数值，同时触发一次轻微的触感反馈（`expo-haptics`）。
- **`BarChart`**：按日或按月的上下行并排柱状图，点一下显示数值。
- **`Sparkline`**：60 个点的小曲线，不画坐标轴，用在实时列表的每一行里。

**测试**：`timeTicks`、`segments` 的单元测试。

**验收**：在一个临时的演示页面上，三种图表在深色和浅色模式下都清楚可读；拖动时数值跟着手指变化。

**提交**：`feat(ui): time-series, bar and sparkline charts`

### T37. 时间段选择器 `features/traffic/TimeRangePicker.tsx`

- **预设**：一排横向可滚动的胶囊按钮：最近 1 小时、今天、昨天、最近 7 天、本月、上月、最近 30 天、自定义。
- **自定义**：点"自定义"打开一个面板（沿用 `SheetScreen` 的样式）：
  - 开始时间和结束时间，用 datetimepicker 选，精确到分钟。
  - "只看每天的某个时段"开关，打开后选起止整点。
  - 用 `validateCustom` 校验，出错时显示原因。
- **当前选择**：在组件下方用一行小字显示，比如"10月5日 00:00 – 13:47 · 每天 20–23 点"。

**测试**（RNTL）：
1. 点预设按钮会回调对应的 `TimeRange`。
2. 自定义面板里，结束时间早于开始时间时，"确定"按钮不可用。

**提交**：`feat(app): time range picker`

### T38. 流量总览 `app/(tabs)/network/traffic/index.tsx`

- **布局**：
  - 顶部是时间段选择器。
  - 下面是总量卡：下载、上传、WAN 总量；WAN 总量旁边有一个"ⓘ"，点开说明"WAN 口含报头开销，会比各设备之和略多"。
  - 再下面是上下行曲线 `TimeSeriesChart`。
  - 再下面是分段控件：排行 | 实时。
- **排行**：
  - 用 `summary`，可以切换按总量、下载或上传排序，也可以切换"互联网"和"局域网"。
  - 每行显示：设备图标（复用 `deviceIcon`）、名称、MAC 或 IP、下载、上传、占比条。点击进入设备流量详情。
  - **名称的来源**：优先用 M1 的设备列表（`useClients`）里的名称，其次用插件返回的 `name` 和 `hostname`，最后用 MAC。
  - 一次加载 50 条，滑到底部再加载下一页。
- **实时**：
  - 用 `useAgentLive`，每行显示设备名、当前下载和上传速率、`Sparkline`。最近 60 个点存在页面状态里。
  - 按当前速率排序；排序变化时，列表用动画重新排列。
- **右上角菜单**：导出 CSV（汇总加曲线两个文件，用 `expo-sharing` 分享）、插件设置（跳到 T42 的页面）。
- **精度提示**：`start_exact` 晚于所选起点时，在曲线下面提示"更早的数据只保留到天"。
- **状态**：插件不是 `ok` 状态时，整个页面换成 T43 的占位卡。

**验收**：
1. 实验环境产生流量时，切换到"实时"，2 秒内看到速率变化。
2. 切换"今天"和"最近 7 天"，总量和曲线跟着变化。
3. 导出的 CSV 用 Excel 打开，中文不乱码。
4. 演示模式下，所有时间段都有数据。

**提交**：`feat(app): traffic overview with ranking and live tab`

### T39. 设备流量详情 `app/(tabs)/network/traffic/[mac].tsx`

- **页头**：设备名、MAC、IP、厂商、在线状态。
- **时间段**：选择器默认沿用上一页选中的时间段，通过路由参数传过来。
- **内容**：
  - 这台设备的上下行曲线。
  - 总量、峰值速率。峰值取曲线里步长内的最大值换算成速率，并注明"按 X 分钟平均"。
  - 上下线记录：用 `events` 查这台设备的上线和下线，按时间倒序列出，每条显示时长。
- **从设备详情进入**：M1 的设备详情面板（`src/app/device/[mac].tsx`）加一行"流量"，显示今日用量，点击后跳到这里。插件不是 `ok` 状态时，这一行显示"安装插件后可查看"，点击后跳到 T42。

**验收**：
1. 从排行进入、从设备详情进入，两条路径都能到达这一页，并且显示正确。
2. 上下线记录和实验环境的操作一致：停掉客户端 3 分钟后，出现一条下线记录。

**提交**：`feat(app): per-device traffic detail`

### T40. WAN 口历史 `app/(tabs)/network/traffic/wan.tsx`

- **切换**：分段控件"按日 | 按月"。
  - 按日：最近 30 天，用 `history`（`class=wan`，天层）。
  - 按月：最近 12 个月，用月层。
- **图表**：`BarChart`，下面附一张表，列出每天或每月的下载、上传。
- **本期合计**：可选填"每月重置日"（只保存在 App 本地），按这个日期计算"本期已用"。

**提交**：`feat(app): WAN usage history`

### T41. 概览卡片与网络 Tab 入口

- **概览页卡片** `TodayTrafficCard`：
  - 显示今日的下载、上传，以及今日用量最多的 3 台设备，点击进入流量总览。
  - 插件不是 `ok` 状态时，卡片显示"安装 RouteLink 插件，查看每台设备的流量"和安装按钮。用户可以关掉这张卡片，关掉的状态按路由器记在 App 本地。
- **网络 Tab**：在 M1 T54 的列表里加两行："流量统计"、"WAN 口历史"。

**提交**：`feat(app): today traffic card and network tab entries`

### T42. 插件管理与安装界面

**页面**：`app/(tabs)/more/agent/index.tsx`，入口是"更多 → 路由器插件"。

- **已安装时**：
  - 显示版本、角色、加速模式、对时状态、存储占用、上次写盘时间。
  - **检查更新**：点击后才去取 `manifest.json`，发现新版本时显示"升级到 x.y.z"。
  - 操作：重启插件（`rc init routelink restart`）、立即写盘、清空数据（走主设计 §10 的"中"级确认）。
  - 卸载：可以选择是否同时删除数据；勾选删除时，先调用 `reset all`。
  - 打开 LuCI 页面：用 `expo-web-browser` 打开 `<路由器地址>/cgi-bin/luci/admin/services/routelink`。
- **未安装时**：
  - 一段说明：插件能做什么、需要多少空间、需要 root 账号、需要路由器能连上 OpenWrt 官方软件源。
  - "安装"按钮。
- **下载镜像**：一个可选的文本框，填镜像前缀，存进 `state/settings`。

**安装页** `install.tsx`：
- 竖排的步骤列表，每一步显示进行中、完成或失败，下载和上传时显示进度条。
- **失败时**：显示原因（设计 §13.3 第 10 步），以及"重试"和"查看手动安装说明"两个按钮。说明链接到 README 的对应章节。
- **成功后**：显示"已安装 x.y.z"，"完成"按钮回到插件页，同时让 `['agent']` 开头的查询失效。
- **风险提示**：安装属于"中"风险（设计 §19），开始前用 `RiskConfirm` 确认一次，说明会在路由器上安装软件包、需要路由器联网。

**验收**：
1. 在 Docker 测试路由器上，把插件卸载干净后，从 App 一键安装成功，然后流量页可以使用。
2. 断开电脑的外网（或者填一个错误的镜像地址）后安装，失败原因显示为"下载失败"。
3. 用非 root 账号安装，失败原因显示为"需要 root 账号"。
4. 演示模式下能完整走一遍安装流程。

**提交**：`feat(app): agent management and one-tap install UI`

### T43. 插件状态提示

- **`AgentGate`**：包在依赖插件的页面外面。插件状态不是 `ok` 时，按状态显示占位卡：

| 状态 | 显示 |
|---|---|
| `not-installed` | "需要 RouteLink 插件" + 安装按钮 |
| `not-running` | "插件未运行" + "重启插件"按钮 |
| `too-old` | "插件版本太旧" + "升级插件"按钮 |
| `too-new` | "请升级 App" |
| `no-permission` | "当前账号没有访问插件的权限"，并说明解决办法：用 root 登录，或者在 LuCI 里给这个账号授权 `luci-app-routelink` |

- **`AgentBanner`**：插件正常时，按情况在流量页顶部显示警告条：
  - `nlbwmon_running`：带"停用 nlbwmon"按钮，走主设计 MO-1 的服务停止和禁用，属于"中"风险，要确认。
  - `offload_warning`：提示"统计可能偏少"。
  - `!time_synced`：提示"路由器时间未同步"。

**测试**（RNTL）：五种状态和三种警告条，各自渲染出正确的文字和按钮。

**提交**：`feat(app): agent gate and warning banners`

---

## 阶段 H：联调与发布

### T44. 本地完整测试

1. `scripts/verify.sh`：类型检查、lint、Jest 全部通过；翻译条目一致性测试通过。
2. `scripts/agent-test.sh`：守护进程的单元测试全部通过，ASan 和 UBSan 没有报错。
3. 在 Docker 上依次用 23.05、24.10、25.12 三个版本跑 `npx jest -c jest.agent.config.js`。25.12 用 apk 包。
4. LuCI 三个页面在三个版本上都能打开。
5. 演示模式下截图：流量总览（排行和实时）、设备流量详情、WAN 口历史、插件页，中英文、深浅色各一套，存进 `docs/screenshots/{zh,en}/`。
6. 推送代码，确认 `ci.yml`、`openwrt.yml`、`ios.yml` 都通过；iOS 的截图里能看到新页面。

**提交**：`test: P1 full local verification`

### T45. 和你的 x86 路由器联调（需要你配合）

1. **一键安装**：由你在 App 里输入路由器密码，然后在 App 里一键安装插件。
2. **准确性抽查**：在一台电脑上下载一个已知大小的大文件，和插件统计的数字对比。同时对比所有设备之和与 WAN 口总量，差距应该在 3%～5% 左右。
3. **加速**：如果你开着软件加速，确认统计正常。
4. **LuCI**：中英文都看一遍。
5. **性能**：记录 CPU、内存占用和数据目录的大小。
6. **长时间运行**：放 24 小时，第二天查看"昨天"的数据是否完整，曲线有没有缺失。

结果写进"执行记录"。发现的问题先修好再进入 T46。

### T46. README 与发布 agent-v0.1.0

1. **README 中英文**：
   - 在功能清单里加上"路由器插件与流量统计"。
   - 新增"路由器插件"一节，内容包括：功能介绍、App 一键安装、手动安装（下载 ipk/apk，或者添加软件源）、支持的 OpenWrt 版本和架构、与 nlbwmon 的冲突、加速对统计的影响、隐私说明。
   - 附上 App 和 LuCI 的截图。
2. **发布**：版本号确认是 `0.1.0`。**征得你的同意后**，推送标签 `agent-v0.1.0`，等发布流程完成。
3. **检查**：
   - Releases 里有全部安装包和 `manifest.json`。
   - Pages 上的软件源可以访问。
   - 在 Docker 测试路由器上，用 App 从正式的清单完成一次安装。

**提交**：`docs: README for the router plugin`

### T47. 收尾

1. 把"执行记录"里的结论同步进设计文档：
   - 包管理器的调用方式
   - sysupgrade 钩子是否生效
   - 实测的误差和性能数字
   - Docker 的限制
2. 在主设计 §24 和设计 §22 里，把 P1 标记为"已完成"。
3. 检查设计 §19 里 P1 的每个编号都已实现。没有实现的列出来，说明原因，并移到后续的期里。

**提交**：`docs: record P1 results in the design`

---

## 执行记录（实施过程中填写）

| 项目 | 结论 |
|---|---|
| T2 SDK 镜像标签、首次编译用时、Docker 卷大小 | 镜像是 `openwrt/sdk:<架构>-<版本>`，例如 `x86_64-24.10.8`。首次编译约 8.5 分钟（主要是 `feeds update -a`），Docker 卷 2.8 GB；之后每次约 1 分钟。编译时发现漏了依赖 `libblobmsg-json`，已补上。**偏离计划**：`dev-router.sh` 的容器名、端口、网段和其他工作树共用，执行 `up` 会把别人正在用的测试路由器删掉重建（本次已经发生过一次）。所以插件改用独立的 `scripts/agent-router.sh`（容器 `routelink-agent-owrt`，网段 172.40/41.0.0/24，端口 18280），`dev-router.sh` 不改 |
| T3 编译矩阵里不存在的"版本 × 架构" | 没有缺的，27 个组合全部编译通过（25.12 出 apk）。`gh-action-sdk` 自带的 shfmt 检查在 SDK 镜像里跑不了（镜像里没有 shfmt，`openwrt/` 也不是 git 根目录），所以设了 `NO_SHFMT_CHECK`，另外加了一个 `lint` job。编译矩阵后来拆成可复用的 `openwrt-build.yml` |
| T13 Docker 内核的 conntrack 事件和计数 | Docker Desktop 的内核支持容器里的 ctnetlink。但容器里 `nf_conntrack_acct` 是 0：`/proc/sys` 只读，`/etc/sysctl.d` 的设置写不进去，所有计数都是 0。处理：`agent-router.sh` 创建容器时加 `--sysctl net.netfilter.nf_conntrack_acct=1`；守护进程在 `info` 里报告 `conntrack_accounting`，LuCI 据此提示 |
| T16 sysupgrade 钩子、安装后服务是否自动启动 | 都生效：`sysupgrade -b` 会调用 `routelink_commit`（`/lib/upgrade/*.sh` 是在 `sysupgrade_init_conffiles` 赋值之后才 include 的）；安装后服务自动启用（`S95`/`K10`）。用命令行的 `uci commit` 不会触发重载，需要 `reload_config`，或者走 ubus 的 uci commit（LuCI 和 App 都是这样），约 2 秒后生效 |
| T18 各方法的实际调用结果 | 全部方法都按约定返回；非法参数返回 `Invalid argument`，没见过的 MAC 返回 `Not found`。**偏离计划**：rpcd 里 root 的"全部权限"指的是所有 ACL 组的并集，没有任何组授权 `routelink` 对象时，连 root 也调不了。所以 ACL 文件改放进 `routelinkd` 包（组名 `routelink`），安装后重载 rpcd；LuCI 菜单依赖这个组，不装 LuCI 包 App 也能用。`info` 新增了 `conntrack_accounting` 字段 |
| T19 Docker 是否支持 flowtable；IPv6 转发的配法；各用例的实测误差 | Docker Desktop 的内核没有 flowtable，开了 `flow_offloading` 之后 fw4 加载失败，所以本机跳过这一项。CI 的 Ubuntu 内核支持 flowtable，开着软件加速实测通过（误差小于 2%）。CI 上发现的两个测试环境问题：① Docker 不保证容器里多个网络的网卡顺序，测试路由器启动后按 MAC 地址核对，顺序反了就对调 `eth0`/`eth1`；② 容器改不了系统时间，ntpd 永远不会报告对时成功，而 CI 机器刚开机、运行时间不到 15 分钟，守护进程因此一直不写盘。测试路由器关掉了 NTP；另外 NTP 钩子改为也响应 `step` 和 `periodic`（守护进程在 ntpd 已经对时之后才启动时也能确认）。IPv6 的配法：两个 Docker 网络用 `--ipv6` 创建，路由器容器加 `--sysctl net.ipv6.conf.all.forwarding=1`。实测误差：下载 100 MB、1000 个短连接、IPv6 下载、上传，都是 0.00%（和终端网卡 IP 层字节数逐字节一致）。**测试发现的问题**：重启后丢数据。原因是小时、天、月的桶只在内存里，重启或断电会丢掉当天甚至当月的数据。已修复：新增 `core/recover`，启动时补算停机期间已经结束的桶，并用已存记录恢复当前的桶；正常停止前把未满的一分钟写下去。分钟保留期最少 2 小时，按天保留期最少 62 天。集成测试的 Jest 配置单独放在 `jest.agent.config.js`，因为原来的集成测试配置不编译 TypeScript，`testMatch` 在 Windows 上也匹配不到文件 |
| T20 x86 和 QEMU MIPS 的性能数字 | x86（i5-13500H，Docker）上 52 台设备、5000 个连接：平时占单核 0.04%，实时模式 0.55%，内存 1.7 MB。QEMU MIPS 没有测；按 MIPS 慢 15～25 倍估算，也在目标以内（未经实机验证） |
| T25 非 root 账号的 LuCI 访问 | 没有测。页面验证改用 Docker 里的无头 Chrome（`scripts/luci-screenshots.sh`）：LuCI 用 `requestAnimationFrame` 合并发送请求，浏览器面板隐藏时请求永远发不出去；完整版无头 Chrome 会拒绝访问内网地址，要用 `headless: 'shell'`。三个页面中英文都能加载，截图在 `docs/screenshots/luci/` |
| T27 预发布的检查结果 | 没有执行：需要先把私钥存进 GitHub Secrets（`OPENWRT_USIGN_KEY`、`OPENWRT_APK_KEY`）、开启 GitHub Pages（来源选 GitHub Actions，`github-pages` 环境允许 `agent-v*` 标签），再推送标签。这几步要等你确认。工作流已经通过 actionlint 检查，`agent-manifest.ts` 有单元测试 |
| T28 三个版本的包管理器：辅助程序、上传路径、`file write` 的 base64 和 append、依赖补装、超时、能否添加软件源 | 见下方的表 |
| T29/T30 插件接口客户端与状态判断 | 用 Docker 24.10.8 加实验环境录制了 `test/fixtures/agent-24.10/`（`record-fixtures.ts --agent`）。实测两点和计划不同：① 没装插件时，rpcd 里没有任何 ACL 授权 `routelink` 对象，调用直接被拒（PERMISSION_DENIED），不是"找不到"，所以"没装"和"没权限"要靠 `/usr/sbin/routelinkd` 是否存在来区分；② 守护进程停止时，uhttpd 返回 JSON-RPC -32000（Object not found），原来被当成未知错误，现在统一映射为 NOT_FOUND。另外确认：插件装好、rpcd 重载后，已经登录的会话不用重新登录就能访问新的 ACL |
| T33 一键安装 | 在 Docker 24.10.8 上用 App 的状态机走完整流程：卸载 → 识别为没装 → 上传 3 个包 → 通过 cgi-exec 安装 → 确认运行，全程约 1 秒。cgi-exec 在会话过期时返回 403"Exec permission denied"，被 ACL 拒绝时返回 403"Access to command denied by ACL"，App 只对前者重新登录一次。非 root 账号连 `file stat` 都没有权限，原来被误判成"没有 LuCI 软件包管理页"，改为提示"需要 root 账号"。QEMU 上录制的 23.05.6、24.10.8、25.12.5 样本验证了三种包管理器的识别（`versions.test.ts`） |
| T34 演示模式 | 用确定性的模型代替存储：每台设备每小时一个速率（每天的作息曲线乘以按种子生成的系数），小时内再叠加一个整周期的正弦波，所以一小时内各分钟之和不变。任意时间段都能算出稳定的结果，汇总和曲线之和只差取整误差。演示路由器上可以卸载插件再一键安装，整个流程约 6 秒 |
| T35 新依赖和 SDK 57 的兼容性 | 用 `npx expo install` 安装 expo-file-system、expo-sharing、expo-crypto、@react-native-community/datetimepicker 9.1.0，expo-doctor 21 项检查全部通过。下载安装包改用 `expo/fetch` 读取字节，不经过文件系统；文件系统只用于导出 CSV。发现一个 M1 遗留问题：Hermes 的 `toLocaleString(locale)` 只按手机系统语言格式化，中文界面在英文系统的手机上会显示"Oct 5"，改为 App 自己按中英文格式化日期（`utils/dates`）。本机编译时空闲内存只有约 2 GB，16 个线程并行编译 C++ 会内存不足，改为先关模拟器，再用 `--max-workers=2` 编译 |
| T36～T43 界面 | 在模拟器上用演示路由器和 Docker 路由器逐页走查。插件的月层只用于两年前的数据，所以 WAN 口历史改为在手机上把小时数据按天汇总、把天数据按月汇总；"每天时段"筛选只对小时数据（90 天）有效，更早的时间段自动去掉这个筛选并提示；实时页在实验环境 2 MB/s 下载时显示 17.1 Mbps，和实际一致；插件清单还没发布时，安装失败并提示"下载失败" |
| T27/T46 发布 | Secrets 和 GitHub Pages（来源：GitHub Actions；`github-pages` 环境另外允许 `agent-v*` 标签）设好后，先发预发布 `agent-v0.1.0-rc.1`：82 个文件（54 个 ipk、27 个 apk、`manifest.json`），清单 27 个"版本×架构"，抽查的 SHA-256 一致。再发正式版 `agent-v0.1.0`。**发现的问题**：工作流用"标签里有没有连字符"判断预发布，`agent-v` 前缀本身就有连字符，结果正式版被标成预发布、软件源没有部署到 Pages。已改成只看版本号部分，并增加手动触发（`workflow_dispatch`，可以复用之前运行的安装包），用它重新发布了 0.1.0，没有删除也没有重新编译。之后：清单、各版本软件源、两把公钥在 Pages 上都能访问；Docker 24.10.8 上用 App 从正式清单一键安装成功（约 20 秒）；按 README 添加软件源后 `opkg update` 签名校验通过 |
| T45 真实路由器的联调结果 | **暂停**（按你的要求，以后再做）。已经发现的两点：① 这台路由器用的第三方固件（Kwrt）的 uhttpd 返回错误时把 JSON-RPC 的 `id` 写成 `null`，App 按编号对应回复，于是所有失败的调用都成了 "missing response"（插件页报错）。已修复：没有编号的回复按位置对应，并加了测试。② 一键安装停在"查找匹配的安装包"：这个固件基于 25.12，但很可能仍然用 opkg，而插件的 25.12 只有 apk 包。后续要么给 25.12 也出 ipk，要么让 App 在这种情况下改用 24.10 的 ipk（需要先确认 ABI 兼容）。整个过程只读，路由器上没有任何改动 |

**T28 实测结果**（`scripts/pm-check.mjs`、`scripts/pm-cgi-exec.mjs`，root 会话，经由 HTTP）

| 项目 | 23.05.6 | 24.10.8 | 25.12.5 |
|---|---|---|---|
| 辅助程序 | `/usr/libexec/opkg-call`（luci-app-opkg） | `/usr/libexec/package-manager-call` | `/usr/libexec/package-manager-call`（apk） |
| 上传路径 | `/tmp/upload.ipk` | `/tmp/upload.ipk` | `/tmp/upload.apk` |
| 更新软件包列表 | ACL 只认 `update *`，要带一个会被丢掉的参数，比如 `update -q` | `update`（带参数反而被拒） | 同 24.10 |
| `file write` base64 + append | 可以，但每块最多 32 KB（48 KB 编码后超过 uhttpd 的 64 KB 上限） | 同左 | 同左 |
| 用 ubus `file exec` 安装 | 能装好，但请求要挂满 60 秒才超时：包的 postinst 重载了 rpcd | 同左 | 同左 |
| 用 `/cgi-bin/cgi-exec` 安装 | 0.3～1.4 秒，返回辅助程序的 JSON。**App 用这个** | 同左 | 同左 |
| 本地包的签名 | 不检查 | 不检查 | 报 `UNTRUSTED signature`，辅助程序不放行 `--allow-untrusted`。解决：CI 用 `apk adbsign` 逐个签名（一次只能签一个文件），App 先把公钥写进 `/etc/apk/keys/`。已在 25.12.5 上验证通过 |
| 依赖补装 | 从官方源自动补装（`kmod-nf-conntrack-netlink`） | 同左 | 同左 |
| 识别架构 | `/etc/os-release`、`/etc/openwrt_release` 都没有读权限；从可读的 `/etc/opkg/distfeeds.conf` 里的 URL 取 | 同左 | 从 `/etc/apk/repositories.d/distfeeds.list` 取 |
| App 能否加软件源 | 不能：`/etc/opkg/keys/` 没有写权限，只能显示手动命令 | 能：`customfeeds.conf` 和 `/etc/opkg/keys/` 都可写 | 能：`customfeeds.list` 和 `/etc/apk/keys/` 都可写 |

另外：OpenWrt 的 SDK 只给 apk 软件源的索引签名，不给包签名；包签名后哈希会变，所以 25.12 的索引要在签名之后用 `apk mkndx` 重新生成（`openwrt-build.yml`）。按包名从自建的 apk 软件源安装，也已在 25.12.5 上验证通过。
