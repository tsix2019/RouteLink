# RouteLink M5 设计：二级页面和 App 更新

> 主设计：`docs/superpowers/specs/2026-10-05-routelink-design.md`（下文简称"设计"，§ 表示章节）
>
> **前提**：M1～M4 和 P1 已完成，发布了 v1.0.0。P2、P3 要在真实网络里和插件联调，仍然暂停，所以先做 M5。

## 1. 目标

| 编号 | 内容 |
|---|---|
| UI-1 | 需要填好几项内容的表单、很长的列表，从弹窗改成二级页面（从右侧推入，有返回按钮，可以侧滑返回） |
| AP-6 | 关于 → 软件更新：检查新版本；Android 在 App 里下载、校验、安装；iOS 打开发布页；可选的自动检查 |

完成后版本号为 **1.1.0**。

### 1.1 不做的事

- P2 的功能（网络组、无线工具）。
- iOS 在 App 里安装新版本。未签名的 IPA 要用户自己签名，App 做不到。
- AltStore 或 SideStore 软件源。
- 测试版通道：预发布版本一律不提示。
- 两项输入的小表单（修改管理密码、添加唤醒设备）保留弹窗。
- 设备详情保留现在的弹出面板（用户决定）。

## 2. 二级页面（UI-1）

### 2.1 原则

设计 §8.3"页面形式"改为：

- **二级页面**：要填好几项内容的表单、很长的列表。
- **弹窗**：确认（`RiskConfirm`）、操作菜单（`ActionSheet`）、只填一项的输入（`PromptSheet`）、只有几个选项的选择（`SelectSheet`）、设备详情、路由器切换、证书确认、Wi-Fi 二维码。
- 编辑表单底部是"保存并应用"按钮，只有破坏性操作的按钮用红色。这两条不变。

### 2.2 清单

| 现在 | 改成的路由（`src/app/(tabs)/` 下） | 参数 |
|---|---|---|
| 防火墙：端口转发 `ForwardSheet` | `network/edit/forward.tsx` | `section`（编辑时） |
| 防火墙：通信规则 `RuleSheet` | `network/edit/rule.tsx` | `section` |
| 静态路由 `RouteSheet` | `network/edit/route.tsx` | `section`、`family`（新建时，4 或 6） |
| WireGuard 接口 `WgInterfaceSheet` | `network/edit/wg-interface.tsx` | `name` |
| WireGuard 对端 `WgPeerSheet` | `network/edit/wg-peer.tsx` | `iface`，以及编辑时的 `section` |
| WireGuard 导出（根层级的面板 `/wireguard-export`） | `network/wireguard-export.tsx` | `iface`、`key`（不变） |
| DDNS `DdnsSheet` | `network/edit/ddns.tsx` | `section` |
| OpenVPN 导入 `ImportSheet` | `network/edit/openvpn.tsx` | 无 |
| 计划任务（cron.tsx 里的 `EditSheet`） | `more/edit/cron.tsx` | `index` |
| 时区（`SelectSheet`，几百项） | `more/timezone.tsx` | 无 |
| Wi-Fi 定时开关的时段 `ScheduleSheet` | `wireless/edit/schedule.tsx` | `index` |
| 家长控制的时段 `PeriodSheet` | `devices/edit/period.tsx` | `mac`，以及编辑时的 `index` |

新建时不带编辑参数。参数里只放配置节的名字或下标，不放表单内容。

### 2.3 页面的统一行为

- **数据**：页面用和列表页相同的查询键从缓存里取数据。缓存里没有时（比如冷启动后直接打开），显示加载骨架，加载失败显示 `ErrorState`。
- **找不到条目**：编辑参数指向的条目不存在了（比如在别处被删掉），显示"这一项已经不存在"和返回按钮。
- **保存**：
  1. 页面自己校验。校验和生成改动的函数沿用服务层现有的（`portForwardChanges`、`trafficRuleChanges` 等）。
  2. 弹出 `RiskConfirm`，级别和后果说明与现在相同。
  3. 应用（`stageAndApply`），成功后提示并返回。
  4. 被回滚时提示，留在页面上。
- **删除**：编辑已有条目时，"保存并应用"下面有一个红色的"删除"按钮。点了以后弹出确认，删除后返回列表。
- **从列表进入**：点条目直接进编辑页，比现在的"点条目 → 操作菜单 → 编辑"少一步。操作菜单里除了编辑和删除还有别的操作时，保留菜单，菜单里的"编辑"再进页面。保留菜单的有：WireGuard 对端（导出）、OpenVPN（启动、停止）。
- **放弃修改**：内容改过但没有保存时，点返回、侧滑返回或按 Android 返回键，会先问"放弃修改？"。用 React Navigation 的 `usePreventRemove`，实施前按文档核对它在原生栈和 iOS 侧滑下的行为。保存成功后不再拦截。
- **页面内的选择**：协议、区域、设备这类短列表，仍用 `SelectSheet` 从底部弹出。以前是弹窗上再叠一层弹窗，现在是在页面上弹出。

### 2.4 个别页面

- **两个时段列表改成逐条保存**：Wi-Fi 定时开关和家长控制现在是"在列表里改好几条，最后点一次保存"。改成二级页面以后：
  - 时段页保存时，把整个列表连同这一条改动一起应用（新增、修改、删除都是），确认后后果说明和现在相同。
  - 列表页去掉草稿状态、"有未保存的修改"提示和底部的"保存"按钮。
  - 页面打开时记下当时的列表，保存时在它上面改这一条。
- **OpenVPN 导入**：页面第一项是"选择 .ovpn 文件"，选好后再显示名称、用户名、密码。文件内容不经过路由参数。
- **新建 WireGuard 对端**：保存成功后用 `router.replace` 换成导出页，导出页返回时回到 WireGuard 列表。
- **时区页**：顶部有搜索框，可以按时区名或 TZ 字符串搜索，当前时区打勾。点一项立即应用（和现在一样是直接应用）并返回。

### 2.5 组件

- **`FormScreen`**（`src/ui/FormScreen.tsx`）：
  - 包一层 `Screen`，加上"保存并应用"按钮、可选的"删除"按钮和"放弃修改？"拦截。
  - 参数：`title`、`dirty`、`onSave`、`saving`、`onDelete`、`saveLabel`。
- **表单内容**：现在各个 `*Sheet` 里的字段和校验移到页面里，或者拆成 `*Form` 组件，按大小决定。
- **删除**：
  - 没人再用的 `EditSheet`、`ForwardSheet`、`RuleSheet`、`RouteSheet`、`WgInterfaceSheet`、`WgPeerSheet`。
  - 根布局里 `wireguard-export` 面板的声明。

## 3. App 更新（AP-6）

### 3.1 数据来源

直接查 GitHub Releases 的接口，不另搭服务：

1. `GET https://api.github.com/repos/tsix2019/RouteLink/releases/latest`，请求头 `Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`。
2. 如果返回的发布不是 App 的（标签不是 `vX.Y.Z`，比如插件的 `agent-v0.1.0`），改为请求 `GET .../releases?per_page=20`，再按下面的规则筛选。

选发布的规则：

- 标签匹配 `^v\d+\.\d+\.\d+$`，`draft` 和 `prerelease` 都是 `false`。
- 在满足条件的发布里取版本号最大的一个，和本机版本 `Constants.expoConfig.version` 比较。只有更大的才算新版本。
- 安装包是名为 `RouteLink-v<版本>.apk` 的附件。附件带 `digest`（`sha256:<hex>`，GitHub 2025 年起提供，2026-10-06 核对过现有发布）和 `size`。
- 更新说明用发布正文。正文是"中文 + `---` + 英文"，按第一处单独一行的 `---` 拆开，App 是英文时显示后一半；拆不开时显示全文。显示时用助手的 `MarkdownText`。

开发版可以用环境变量 `EXPO_PUBLIC_RELEASES_URL` 换成本机的模拟服务，只在 `__DEV__` 时生效。正式版写死 GitHub。

### 3.2 界面

**关于页**：在"源代码"上面加一行"软件更新"：

- 副标题按状态显示："检查更新"、"已是最新版本"或"发现新版本 1.1.0"。
- 点进去打开二级页面 `more/update`。

**软件更新页**（`src/app/(tabs)/more/update.tsx`）：

1. **版本**：
   - 当前版本，"检查更新"按钮，上次检查的时间。
   - 检查时按钮显示转圈。查完显示"已是最新版本"或下面的新版本卡片。
2. **新版本卡片**：版本号、发布日期、安装包大小、更新说明。
   - **Android**：
     - 按钮"下载并安装"。下载时显示进度条、已下载和总大小，按钮变成"取消"。
     - 下载并校验完成后调起系统安装界面。
     - 安装包已经下载并通过校验时，按钮直接是"安装"。第一次安装时，系统会请你允许本 App 安装未知应用，允许后回到 App 再点"安装"即可。
     - 调起安装界面失败（有的系统不允许）时，提示改用浏览器下载，并给出打开发布页的按钮。
   - **iOS**：按钮"前往发布页"，用应用内浏览器打开这次发布的页面。下面附一句"下载 IPA 后用 AltStore、SideStore 或 Sideloadly 重新签名安装"。
3. **设置**：
   - "自动检查更新"开关，默认关闭。说明文字："打开后，App 每天最多访问一次 GitHub 查询新版本。"
   - Android 另有"GitHub 下载镜像"输入框。沿用设置里的 `agentMirror`，和插件安装共用，那边的名称也改成"GitHub 下载镜像"。镜像只作用于下载安装包，不作用于查询接口。

**更多 Tab**：自动检查查到新版本时，"关于"一行右侧显示"新版本"标记。

### 3.3 Android 下载与安装

- **下载**：
  - 用 `File.downloadFileAsync`（expo-file-system 57）下载到 `Paths.cache/updates/RouteLink-v<版本>.apk`，地址按镜像前缀改写（复用 `applyMirror`），用 `onProgress` 显示进度，用 `AbortSignal` 取消。
  - 实施前按 SDK 57 的文档核对这些接口的签名。
- **校验**：
  - 大小要和附件的 `size` 一致。
  - 附件有 `digest` 时，读出文件算 SHA-256 比对（复用 `sha256Hex`）。
  - 不一致就删掉文件，并提示"安装包校验失败，请重新下载"。
  - 签名是否一致由系统安装器检查：从 Releases 安装的 App 和新的 APK 用同一把发布密钥签名。
- **安装**：
  - 新增依赖 `expo-intent-launcher`（用 `npx expo install` 安装），调用 `startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: 'application/vnd.android.package-archive', flags: FLAG_GRANT_READ_URI_PERMISSION })`。
  - `app.config.ts` 的 Android 权限加 `android.permission.REQUEST_INSTALL_PACKAGES`。
  - 这是新的原生依赖，要重新编译开发版。
- **清理**：打开软件更新页时，删掉 `updates` 目录里不是当前最新版本的文件。

### 3.4 自动检查

- **设置项**（`src/state/settings.ts`，持久化）：
  - `updateAutoCheck`，默认 `false`。
  - `updateCheckedAt`：上次成功检查的时间，单位毫秒。
  - `updateLatest`：上次查到的发布，只存版本号、标签、发布日期、发布页地址、APK 的地址、大小和摘要；不存更新说明，打开软件更新页时会重新查。
- **触发**：根布局里的 `useAutoUpdateCheck()`。App 启动和回到前台时，如果开关打开，并且距 `updateCheckedAt` 满 24 小时，就在后台查一次，失败不提示。
- **手动检查**：结果同样写进 `updateLatest` 和 `updateCheckedAt`。

### 3.5 出错

| 情况 | 提示 |
|---|---|
| 网络不通、超时（15 秒） | "连不上 GitHub，请检查网络后重试" |
| 403 或 429（限流） | "GitHub 暂时拒绝了请求，请稍后再试" |
| 找不到符合条件的发布，或返回的数据格式不对 | "没有找到可用的版本信息" |
| 新版本没有 APK 附件（Android） | 显示新版本信息，按钮换成"前往发布页" |
| 下载失败或被取消 | 失败时提示原因；取消时不提示；都删除不完整的文件 |
| 校验失败 | "安装包校验失败，请重新下载"，删除文件 |

### 3.6 隐私

README 和关于页的隐私说明改为："App 只在你检查更新、打开自动检查更新、或安装插件时访问 GitHub。"其余不变。

## 4. 测试

- **单元测试（先写测试）**：
  - 选发布：忽略 `agent-v*`、预发布和草稿；跳过格式不对的条目；`/latest` 不是 App 的发布时改为列出最近的发布。用录下来的 GitHub 接口返回作测试数据，只留需要的字段，不含真实用户数据。
  - 版本号比较；拆分更新说明。
  - 自动检查：24 小时间隔，开关关闭时不查。
  - 下载流程用假的依赖：下载、校验成功后调起安装；大小或摘要不符时删除文件；取消；已经下载并校验过时跳过下载。
  - 时段列表逐条保存：新增、修改、删除一条后生成的列表。
- **走查**：
  - Android 模拟器上用演示路由器把每个二级页面走一遍：新建、编辑、删除、未保存时返回的提示（返回按钮、侧滑、返回键）、条目不存在。
  - 写配置的页面在我的 Docker 测试路由器上再走一遍（端口转发、通信规则、静态路由、WireGuard、计划任务、时区、两个时段列表）。
- **升级的完整流程**：
  - 本机起模拟发布服务 `scripts/mock-releases.ts`：返回假的 `/releases/latest`，并提供一个版本号更高、用同一把调试密钥签名的 APK。
  - 开发版设 `EXPO_PUBLIC_RELEASES_URL` 指向它，在模拟器上走完检查、下载、取消、校验失败（服务故意返回错误的摘要）、系统安装。
- **iOS**：开发期间不推送，所以 CI 不编译 iOS。推送后看 CI 的编译结果和截图，截图加上软件更新页。

## 5. 文档、版本和发布

- 实施计划：`docs/superpowers/plans/2026-10-06-routelink-m5.md`，附执行记录。
- 主设计：§8.3 按 §2.1 改写；§9.6 加 AP-6；§24 加 M5 一行并更新进度。
- README（中英文）：功能清单的"更多"加"检查更新（Android 在 App 里下载安装）"；按 §3.6 改隐私说明。
- 版本号改为 1.1.0。
- **提交和推送**：
  - 在当前分支上开发，每个任务提交一次。
  - 开发期间只在本地提交，你确认后再推送。推送后看 CI（包括 iOS 编译）并开 PR。
  - 打标签发布 v1.1.0 之前先征得你的同意。

## 6. 风险与应对

| 风险 | 应对 |
|---|---|
| 有的 Android 系统（部分国产 ROM）不允许 App 调起安装界面 | 调起失败时给出"前往发布页"，改用浏览器下载 |
| 中国大陆访问 GitHub 慢 | 下载走镜像；查询接口的数据量小，超时 15 秒 |
| 插件发布越来越多，`/releases/latest` 返回插件的发布 | 改为列出最近 20 个发布再筛选 |
| `usePreventRemove` 在 iOS 原生栈上拦不住侧滑 | 实施前按文档核对；拦不住时，表单有改动时关掉这个页面的侧滑返回（`gestureEnabled: false`） |
| 时段列表从"批量保存"改成逐条保存，以前要点一次保存的改动现在要确认好几次 | 新建时段时多半只改一条；页面说明里写清楚"保存后立即生效" |
