# RouteLink M5 实施计划：二级页面和 App 更新

> 本期设计：`docs/superpowers/specs/2026-10-06-routelink-m5-design.md`（下文简称"M5 设计"，§ 表示其中的章节）
> 主设计：`docs/superpowers/specs/2026-10-05-routelink-design.md`（下文简称"设计"）
>
> **执行方式**：
> - 按顺序逐个完成任务，每个任务做完在本地提交一次。
> - **开发期间不推送**，等你确认后再推送，并开 PR。iOS 只能在推送后由 CI 编译，所以 iOS 的验证放在最后。
> - 逻辑代码走 TDD：先写测试，确认失败；再实现，确认通过。
> - 界面任务用演示路由器在 Android 模拟器上走查；写配置的页面再连我自己的 Docker 测试路由器走一遍。启动测试路由器用 `scripts/agent-router.sh` 或单独的容器名，不用 `dev-router.sh up`，它会清掉其他 worktree 正在用的路由器。
> - 每个任务结束前跑 `npm run typecheck && npm run lint && npm test`。

**目标**：

| 编号 | 内容 |
|---|---|
| UI-1 | 11 个弹窗表单和长列表改成二级页面（M5 设计 §2） |
| AP-6 | 关于 → 软件更新（M5 设计 §3） |

**完成标准**：
- 功能可用，单元测试通过，Android 模拟器上走查完毕（包括升级的完整流程）。
- 你确认后推送，CI 全部通过（包括 iOS 编译和截图）。
- 打标签发布 v1.1.0 之前征得你的同意。

---

## 0. 和 M5 设计不同的地方

1. **`usePreventRemove` 的来源**：
   - `expo-router` 从 SDK 58 起才直接导出它（Expo 文档"Prevent screen removal"）。SDK 57 从 `expo-router/react-navigation` 导入，这是 expo-router 内置的 React Navigation 7。
   - 签名是 `usePreventRemove(prevent, ({ data }) => …)`，用户选择放弃修改后调用 `navigation.dispatch(data.action)` 放行。
   - React Navigation 7 的原生栈会把它传给 react-native-screens，iOS 的侧滑返回也会被拦住。T1 在模拟器上确认 Android 的返回键和返回按钮；iOS 推送后看 CI 截图，必要时在真机上确认。
2. **"放弃修改？"用 `ActionSheet`**，不用系统的 `Alert`：App 里所有的选择都是玻璃风格的面板。菜单只有一项红色的"放弃修改"，另一个按钮是"继续编辑"。
3. **WireGuard 的密钥在页面里生成**：
   - 现在是在打开表单之前，先让路由器生成密钥对和预共享密钥（`withKeys`）。
   - 改成页面以后，在页面里用一个只在这个页面有效的查询（`staleTime: Infinity`，`gcTime: 0`）生成，生成完之前显示加载骨架，失败时显示 `ErrorState`。

## 1. 已确认的接口（2026-10-06 查阅 SDK 57 文档和 node_modules 里的类型）

| 用途 | 结论 |
|---|---|
| expo-file-system 57.0.7 | `File.downloadFileAsync(url, destination: File \| Directory, { idempotent, onProgress({ bytesWritten, totalBytes }), signal, headers }) => Promise<File>`；HTTP 状态不是 2xx 时以 `UnableToDownload` 拒绝，不留文件；`signal` 取消时以 `AbortError` 拒绝；`totalBytes` 在没有 `Content-Length` 时为 `-1`。`File#contentUri`（只有 Android）是可以交给其他 App 的 `content://` 地址。`File#bytes()`、`size`、`exists`、`delete()`；`Directory#create({ idempotent })`、`list()`；`Paths.cache` |
| expo-intent-launcher（SDK 57） | `startActivityAsync(action, { data, type, flags, extra, category, className, packageName })`，用户回到 App 时兑现 `{ resultCode, data, extra }`；只支持 Android；用 `npx expo install expo-intent-launcher` 安装，不需要配置插件 |
| 系统安装器 | `android.intent.action.VIEW`，`type: 'application/vnd.android.package-archive'`，`flags: 1`（`FLAG_GRANT_READ_URI_PERMISSION`）。需要权限 `android.permission.REQUEST_INSTALL_PACKAGES`。第一次时系统会请用户允许本 App 安装未知应用 |
| GitHub Releases 接口 | `GET /repos/{owner}/{repo}/releases/latest` 返回最新的、不是预发布和草稿的发布（插件的 `agent-v0.1.0` 也会被当作最新）；`GET …/releases?per_page=N` 按时间倒序列出。附件有 `name`、`size`、`browser_download_url`、`digest: "sha256:<hex>"`。2026-10-06 查过现有发布：v0.3.1 的 APK 附件带摘要；v1.0.0 的附件还在 CI 上构建 |
| expo-router 57 | `usePreventRemove` 见 §0.1；`router.replace` 替换当前页面 |

---

## 阶段 A：页面框架

### T1. `FormScreen` 和放弃修改的拦截

- `src/ui/FormScreen.tsx`：
  - 包一层 `Screen`，参数有 `title`、`dirty`、`onSave`、`saving`、`saveLabel`（默认"保存并应用"）、`saveDisabled`、`onDelete`、`deleteLabel`、`children`、`testID`。
  - 内容下面是主按钮"保存并应用"，有 `onDelete` 时下面再加一个红色的"删除"。
  - `dirty` 为真时用 `usePreventRemove` 拦住返回，弹出 `ActionSheet`："放弃修改？"菜单里只有一项红色的"放弃修改"，取消按钮是"继续编辑"。
  - 保存成功、需要返回时，用 `FormScreen` 提供的 `leave()`：先关掉拦截，再 `router.back()`（或者用传进来的 `replace` 目标）。可以用 ref 或者 `useFormLeave` hook 实现，避免状态还没更新就触发拦截。
- `src/ui/FormScreen.tsx` 里另外导出 `FormMissing`：要编辑的条目已经不存在时显示的空状态（"这一项已经不存在"，下面是返回按钮）。
- i18n（common）：`saveAndApply`、`discardTitle`、`discard`、`keepEditing`、`itemGone`。
- **测试**：`FormScreen.test.tsx` 用 `expo-router/testing-library` 的 `renderRouter`，建一个两页的栈：
  - 有改动时返回，出现"放弃修改？"；选"继续编辑"后仍在表单页；选"放弃修改"后回到上一页。
  - 没有改动时直接返回。
  - `leave()` 之后不再拦截。
  - 如果 `renderRouter` 在 jest-expo 里跑不起来，改为只测按钮渲染和回调，拦截放到走查里验证，并记进执行记录。

**提交**：`feat(ui): FormScreen, forms as pages with a discard prompt`

## 阶段 B：表单改成页面

每个页面都按 M5 设计 §2.3 的统一行为实现：
- 从缓存取数据，缓存为空时显示加载骨架，加载失败显示 `ErrorState`，找不到要编辑的条目时显示 `FormMissing`。
- 页面自己校验、弹 `RiskConfirm`、应用；成功后提示并返回；被回滚时提示并留在页面上。
- 风险级别、后果说明、提示文字沿用现有的，不改服务层。

### T2. 防火墙：端口转发和通信规则

- 新建 `src/app/(tabs)/network/edit/forward.tsx`（`?section=`），内容从 `ForwardSheet` 搬过来：
  - 字段、设备选择、区域选择不变。
  - 保存时按现在的规则弹 `RiskConfirm`（`expose` 时多一条后果），然后 `applyFirewallChanges(portForwardChanges(…))`。
  - 编辑时有"删除"：`deleteSectionChanges`。
- 新建 `src/app/(tabs)/network/edit/rule.tsx`（`?section=`），内容从 `RuleSheet` 搬过来，规则同上。
- `firewall.tsx`：
  - 点条目直接 `router.push` 到对应的编辑页；"添加"按钮也打开编辑页。
  - 删掉 `selected`、`editing`、`ActionSheet`、两个 Sheet。
  - 开关仍在列表页，保留它的 `RiskConfirm`。
- 删除 `src/features/network/ForwardSheet.tsx`、`RuleSheet.tsx`。
- **走查**：演示路由器和 Docker 路由器上新建、编辑、删除一条转发和一条规则；端口冲突的提示；改了内容后返回会先问。

**提交**：`feat(app): port forwards and traffic rules on their own pages`

### T3. 静态路由

- 新建 `network/edit/route.tsx`：参数是 `?section=`（编辑时），或者 `?family=4|6`（新建时）。内容从 `RouteSheet` 搬过来，用 `saveStaticRoute`；编辑时有"删除"，用 `deleteStaticRoute`。
- `routes.tsx`：点静态路由直接进页面，去掉 `ActionSheet` 和 `RouteSheet`。
- 删除 `RouteSheet.tsx`。

**提交**：`feat(app): static routes on their own page`

### T4. WireGuard

- 新建 `network/edit/wg-interface.tsx`（`?name=`，编辑时）：
  - 新建隧道时，先在页面里让路由器生成密钥对（§0.3），再用 `suggestInterface` 填好默认值。
  - 保存用 `createInterfaceChanges` 或 `editInterfaceChanges`；编辑时有"删除隧道"，用 `deleteInterfaceChanges`。
- 新建 `network/edit/wg-peer.tsx`（`?iface=`，编辑时加 `&section=`）：
  - 页面里生成密钥对和预共享密钥（§0.3）；新对端用 `nextPeerAddress` 填好地址。
  - 保存用 `peerChanges`；编辑时有"删除对端"，用 `deletePeerChanges`。
  - 新对端保存成功后，用 `router.replace` 换成导出页。
- 导出页从 `src/app/wireguard-export.tsx` 移到 `src/app/(tabs)/network/wireguard-export.tsx`：
  - 去掉 `SheetScreen`，改成普通的 `Screen`。
  - 参数 `iface`、`key` 不变。
  - 根布局里去掉它的面板声明。
- `wireguard.tsx`：
  - "编辑隧道"一行直接进隧道页，不再弹菜单。
  - 对端仍弹菜单：导出、编辑（进页面）、删除。
  - "添加对端"、"新建隧道"直接进页面。
  - 去掉 `sheet`、`withKeys`、`busy` 和两个 Sheet。
- 删除 `WgInterfaceSheet.tsx`、`WgPeerSheet.tsx`。
- **走查**：在演示路由器上新建隧道、新建对端后进入导出页、从导出页返回到列表、编辑和删除对端；在 Docker 路由器上（装有 `luci-proto-wireguard`）走一遍新建和删除。

**提交**：`feat(app): WireGuard tunnels, peers and export on their own pages`

### T5. DDNS

- 新建 `network/edit/ddns.tsx`（`?section=`），内容从 `DdnsSheet` 搬过来：服务商选择、自定义 URL、在 NAT 后面时的提示。
  - 保存直接应用，和现在一样不弹确认。
  - "删除"弹确认，用 `deleteDdnsChanges`。
- `ddns.tsx`：点条目和"添加"都进页面，去掉 `DdnsSheet` 和删除确认。

**提交**：`feat(app): DDNS services on their own page`

### T6. OpenVPN 导入

- 新建 `network/edit/openvpn.tsx`：
  - 第一项是"选择 .ovpn 文件"，选文件的逻辑从 `openvpn.tsx` 的 `pick` 移过来。
  - 选好以后显示文件名、名称、需要登录时的用户名和密码，校验用 `validateImport`。
  - 导入的确认和应用沿用现有的。
  - `dirty` 从选了文件开始算。
- `openvpn.tsx`："导入"按钮进页面，去掉 `importing` 和 `ImportSheet`。菜单（启动、停止、删除）保留。

**提交**：`feat(app): OpenVPN import on its own page`

### T7. 计划任务

- 新建 `more/edit/cron.tsx`（`?index=`，编辑时）：
  - 字段和校验从 cron.tsx 里的 `EditSheet` 搬过来。
  - 保存用打开页面时读到的 `lines` 生成新列表，确认后 `writeCrontab`。路由器上的 crontab 在这期间被改过时，沿用现有的 `cron-changed` 提示，并刷新数据。
  - 编辑时有"删除"。
- `cron.tsx`：点任务直接进页面，去掉 `ActionSheet`、`EditSheet`、`pending`。

**提交**：`feat(app): scheduled tasks on their own page`

### T8. 时区

- 新建 `src/features/system/timezones.ts`：`filterZones(zones, query)` 不区分大小写，匹配时区名或 TZ 字符串，查询为空时返回全部。**测试**：中间字符串、大小写、TZ 字符串、空查询。
- 新建 `more/timezone.tsx`：
  - 顶部是搜索框，下面是列表，当前时区打勾。
  - 点一项：和当前时区相同就直接返回；不同就应用（`timezoneChanges`，直接模式），提示后返回。
- `system.tsx`："时区"一行进页面，去掉时区的 `SelectSheet`。

**提交**：`feat(app): time zone page with search`

### T9. Wi-Fi 定时开关：逐条保存

- 新建 `src/utils/list-edit.ts`：`withEntry(list, index | null, entry | null)`。
  - `index` 为 null 时追加，`entry` 为 null 时删除，其余情况替换。
  - **测试**：追加、替换、删除、下标越界时抛错。
- 新建 `wireless/edit/schedule.tsx`（`?index=`，编辑时）：
  - 字段和校验从 `ScheduleSheet` 搬过来。
  - 保存时用打开页面时的列表，经 `withEntry` 得到新列表，弹出现有的确认（后果相同），然后 `saveWifiSchedules`。
  - 删除同理。
- `wireless/schedule.tsx`：
  - 去掉 `draft`、`editing`、"有未保存的修改"和底部的"保存"按钮。
  - 点条目、"添加"进页面。
  - 说明文字加一句"保存后立即生效"。

**提交**：`feat(app): Wi-Fi schedule entries on their own page, saved one at a time`

### T10. 家长控制：逐条保存

- 新建 `devices/edit/period.tsx`：参数 `?mac=`，编辑时加 `&index=`。字段和校验从 `PeriodSheet` 搬过来，保存和删除同 T9，用 `saveSchedule(conn, mac, periods, enabled)`。
  - 还没有计划的设备，第一次保存时 `enabled` 为 true。
- `devices/schedule.tsx`：
  - 去掉草稿和底部的"保存"按钮。
  - "启用"开关改为直接应用：弹出现有的确认，再 `saveSchedule`，时段不变。
  - 点条目、"添加"进页面。
- **走查**：在 Docker 路由器上加一个时段、改它、删它；开关"启用"；确认防火墙规则和计划任务跟着变化。

**提交**：`feat(app): parental control periods on their own page, saved one at a time`

### T11. 收尾

- 删除没人再用的 `src/ui/EditSheet.tsx`，以及不再用到的翻译键：各个 Sheet 的标题，"有未保存的修改"等。可以用 `scripts/luci-i18n-scan.js` 的思路，或者 grep 一遍。
- `src/i18n/i18n.test.ts` 会检查中英文的键是否一致，跑一遍。
- 主设计 §8.3 按 M5 设计 §2.1 改写。

**提交**：`refactor: drop the form sheets; design §8.3 forms are pages`

## 阶段 C：App 更新

### T12. 发布信息

- `src/features/update/releases.ts`：
  - `RELEASES_API`：正式版是 `https://api.github.com/repos/tsix2019/RouteLink`；开发版（`__DEV__`）可以用 `EXPO_PUBLIC_RELEASES_URL` 覆盖。
  - `parseVersion`、`compareVersions`：只认 `X.Y.Z`。
  - `pickRelease(list)`：按 M5 设计 §3.1 的规则筛选，返回
    `AppRelease { version, tag, publishedAt, htmlUrl, notes, apk?: { name, url, size, sha256? } }`。
    - 附件名必须正好是 `RouteLink-v<版本>.apk`。
    - `digest` 只认 `sha256:` 加 64 位十六进制。
  - `notesFor(body, lang)`：按第一处单独一行的 `---` 拆成中文和英文两半。
  - `fetchLatestRelease(fetchJson)`：先查 `/releases/latest`，不是 App 的发布时改查 `/releases?per_page=20`。
    - 网络请求通过参数传进来，测试时用假的。
    - 错误分成 `UpdateError` 的 `network`、`rate-limited`、`no-release` 三种。
- 测试数据：`test/fixtures/github/` 下放几份录下来的接口返回，只留用到的字段。
  - 当前的 `/releases` 列表，包括 `agent-v*` 和预发布。
  - `/releases/latest` 返回插件发布的情况。
  - 自己构造的：新版本没有 APK、摘要格式不对、草稿。
- **测试**：
  - 选发布：忽略 `agent-v*`、预发布、草稿和格式不对的标签，取最大版本。
  - 版本比较：`1.10.0 > 1.9.9`；`v` 前缀；格式不对。
  - 更新说明：拆成中英两半；没有分隔线时显示全文；`---` 出现在代码块里时也只认单独一行的那一处。
  - 回退：`/latest` 是插件发布时改查列表。
  - 错误：403、429 归为限流，超时归为网络错误。

**提交**：`feat(update): find the newest app release on GitHub`

### T13. 设置和自动检查

- `src/state/settings.ts`：
  - 新增 `updateAutoCheck`（默认 false）、`updateCheckedAt`（0）、`updateLatest`（null，类型是不含 `notes` 的 `AppRelease`），加进 `partialize`。
  - 持久化的 `version` 不变：新字段有默认值，旧数据合并时自动补上。
- `src/features/update/check.ts`：
  - `checkForUpdate()`：调 `fetchLatestRelease`，写入 `updateLatest` 和 `updateCheckedAt`，返回完整的 `AppRelease`（含更新说明）和是否比本机新。
  - `shouldAutoCheck(settings, now)`：开关打开，并且距上次检查满 24 小时。
  - `hasUpdate(latest, current)`。
- `src/features/update/useAutoUpdateCheck.ts`：
  - 在根布局里调用。
  - App 启动时和回到前台（`AppState` 变为 `active`）时，满足 `shouldAutoCheck` 就在后台调 `checkForUpdate`，失败不提示。
  - 同一时间只有一次检查在进行。
- **测试**：
  - `shouldAutoCheck`：开关关着、不满 24 小时、满 24 小时、从没检查过。
  - `hasUpdate`。
  - `checkForUpdate` 写设置（用假的 `fetchJson`）。

**提交**：`feat(update): settings and the optional daily check`

### T14. Android 下载和安装

- `npx expo install expo-intent-launcher`。
- `app.config.ts`：`android.permissions` 加上 `android.permission.REQUEST_INSTALL_PACKAGES`。
- `src/features/update/install.ts`：依赖通过参数传入，便于测试。
  - `prepareApk(apk, { mirror, onProgress, signal }, deps)`：
    1. 目标是 `Paths.cache/updates/<附件名>`。
    2. 文件已经存在并且通过校验时，直接返回，不重新下载。
    3. 否则用 `File.downloadFileAsync(applyMirror(url, mirror), file, { idempotent: true, onProgress, signal })` 下载，再校验大小和摘要。
    4. 校验不通过就删除文件，抛出 `UpdateError('verify')`。
    5. 取消或出错时删除不完整的文件。
  - `openInstaller(file)`：`startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: 'application/vnd.android.package-archive', flags: 1 })`。抛错时转成 `UpdateError('installer')`。
  - `cleanUpdates(keepName?)`：删掉 `updates` 目录里不是 `keepName` 的文件。
  - 摘要沿用 `sha256Hex`（`features/agent/download.ts`），把文件内容读进内存计算。APK 大约 32 MB，和在线刷机读固件镜像一样。
- **测试**（假的下载、文件、摘要和安装器）：
  - 下载后校验通过，调起安装器。
  - 大小不符、摘要不符：删除文件，抛 `verify`。
  - 没有摘要时只比大小。
  - 已有通过校验的文件：不下载。
  - 已有校验不通过的旧文件：重新下载。
  - 取消：删除文件，抛 `AbortError`，界面不提示。
  - 镜像前缀应用到下载地址。
- 这是新的原生依赖，需要重新编译开发版：`npx expo run:android`。

**提交**：`feat(update): download, verify and install the APK on Android`

### T15. 软件更新页、关于页和更多 Tab

- 新建 `src/app/(tabs)/more/update.tsx`，按 M5 设计 §3.2 实现：
  - 版本卡片：当前版本、"检查更新"、上次检查的时间。
  - 新版本卡片：版本号、日期、大小，更新说明用 `MarkdownText`（`src/features/assistant/MarkdownText.tsx`）。
  - Android：
    - 按钮依次是"下载并安装"、进度和"取消"、"安装"。
    - 调起安装器失败时，提示并显示"前往发布页"。
    - 没有 APK 附件时，只显示"前往发布页"。
  - iOS："前往发布页"加上重新签名的说明。
  - 设置：
    - "自动检查更新"开关，带说明文字。
    - Android 另有"GitHub 下载镜像"输入框（`agentMirror`），失去焦点时保存。
  - 打开页面时调 `cleanUpdates`，只保留最新版本的文件。
- `about.tsx`：
  - 在"源代码"上面加一行"软件更新"，副标题是"检查更新"、"已是最新版本"或"发现新版本 X"，数据来自 `updateLatest`。
  - 隐私说明按 M5 设计 §3.6 修改。
- `more/index.tsx`：`hasUpdate(updateLatest)` 时，"关于"一行右侧显示 `Badge`"新版本"。
- 插件安装页的镜像输入框，名称也改为"GitHub 下载镜像"。
- i18n：`more` 命名空间新增 `updateScreen.*`，中英文都要有。
- **走查**：演示模式和真实网络下各打开一次。真实网络会查 GitHub：v1.0.0 已经是最新版本，所以会显示"已是最新版本"。

**提交**：`feat(app): software update page`

### T16. 模拟发布服务和完整流程

- `scripts/mock-releases.ts`（用 tsx 运行）：
  - 参数：`--apk <路径>`、`--version <X.Y.Z>`、`--port 8787`、`--bad-digest`。
  - `GET /releases/latest` 返回一个发布：标签 `v<版本>`，正文中英双语，附件是 `RouteLink-v<版本>.apk`，大小和摘要按文件算（`--bad-digest` 时故意给错）。
  - `GET /releases?per_page=…` 返回同一个发布。
  - `GET /download/<名字>` 提供文件，带 `Content-Length`；可以加 `--slow` 限速，用来测取消。
- 完整流程（写进执行记录）：
  1. 开发版设置 `EXPO_PUBLIC_RELEASES_URL=http://10.0.2.2:8787` 后启动。
  2. 另外编一个版本号更高（本地临时改成 1.1.1）、用同一把调试密钥签名的 APK，交给模拟服务。
  3. 在模拟器上依次走：检查（发现新版本）、下载时取消、重新下载、校验失败（`--bad-digest`）、校验通过后系统安装、首次允许安装未知应用、安装后关于页显示新版本号。
  4. 自动检查：打开开关，把 `updateCheckedAt` 改成 25 小时前（开发菜单或临时代码），回到前台后，更多 Tab 出现"新版本"标记。
- 临时改的版本号不提交。

**提交**：`test: a mock release server for the update flow`

## 阶段 D：文档和发布

### T17. 文档和版本号

- `app.config.ts`：`VERSION = '1.1.0'`，`package.json` 的 `version` 同步修改。
- README 和 README.en.md：
  - 功能清单的"更多"加"检查更新（Android 在 App 里下载安装，iOS 打开发布页）"。
  - 隐私说明按 M5 设计 §3.6 修改。
  - "参与开发"里加上 M5 的设计和计划。
- 主设计：
  - §9.6 加 AP-6。
  - §24 加 M5 一行，并更新进度。
- 截图：`scripts/screenshots-android.sh` 和 iOS CI 的截图列表加上软件更新页、一个二级表单页（比如新建端口转发）。Android 截图在模拟器上重新截；iOS 推送后由 CI 截。
- 在本计划末尾补上执行记录。

**提交**：`docs: M5 in the README and the design; version 1.1.0`

### T18. 推送、CI 和 PR（需要你确认）

- 向你汇报走查结果，等你确认后推送分支。
- 看 CI：CI、Android、iOS（编译和截图）、Integration。iOS 截图里检查二级页面的导航栏和侧滑返回、软件更新页。
- 开 PR（合并到 main），PR 描述里写本期内容和验证方式。
- 打标签发布 v1.1.0 之前，再问你一次。发布正文按以往的格式，中文在前、英文在后，中间用单独一行的 `---` 分隔（软件更新页按这一行拆分）。

---

## 执行记录

（按任务填写：做了什么、和计划不同的地方、验证结果。）

### T1（完成）

- `src/ui/FormScreen.tsx`：`FormScreen`、`useFormExit`（`leaving`、`back()`、`replace(href)`），以及 `FormPlaceholder`。计划里的 `FormMissing` 合进了 `FormPlaceholder`：加载中、加载失败、条目不存在三种状态共用一个页面。
- `ActionSheet` 加了可选的 `cancelLabel`，"放弃修改？"的取消按钮显示"继续编辑"。
- `expo-router/testing-library` 的 `renderRouter` 在 jest-expo 里可以用，测试覆盖了四种情况：没改动直接返回、继续编辑、放弃修改、保存后不再拦截。去掉拦截或忽略 `leaving` 时，对应的测试都会失败。

### T2（完成）

- `FormScreen.tsx` 加了两个小工具：`useLoaded`（记下页面打开时读到的条目，保存或删除后列表重新读取时，页面不会闪一下"这一项已经不存在"）和 `differs`（比较表单内容是否改过）。
- 防火墙列表页只保留开关和它的确认；点条目、"添加"直接进页面。

### T3（完成）

- 按计划完成。

### T4（完成）

- 密钥在页面里生成：`src/features/network/useWgKeys.ts`，查询键带上 `useId()`，每次打开页面生成一次，`gcTime: 0`。`useRouterQuery` 为此加了 `gcTime` 参数。
- 导出页的地址抽成 `wgExportHref`（`src/features/network/wireguardHrefs.ts`），列表页和新建对端后的 `router.replace` 共用。

### T5（完成）

- 按计划完成。保存不弹确认；删除弹确认。

### T6（完成）

- "选择 .ovpn 文件"一行选好后显示文件名，再点可以换一个文件。没有选文件时"导入"按钮不可用。
- 新增翻译键 `network:openvpn.pickFile`。

### T7（完成）

- 计划里"路由器上的 crontab 被改过时沿用 `cron-changed` 提示并刷新数据"：提示后重新读取，页面换成新读到的内容，并按"时间 + 命令"重新找到正在编辑的那一条（`findEntry`，离原来位置最近的一条），用户可以直接再保存一次。找不到时显示"这一项已经不存在"。
- `findEntry` 有单元测试：原位置、上面插入了行、同一任务出现两次、被改掉或删掉、App 管理的任务。

### T8（完成）

- `filterZones` 另外把空格和下划线当成一样：LuCI 的时区名用空格（"America/New York"），而用户常按 IANA 的写法输入下划线。
- 新增翻译键 `more:systemScreen.zoneSearch`、`zoneNone`。

### T9（完成）

- `src/utils/list-edit.ts` 除了 `withEntry`，还加了 `findNearest`（列表重新读取后找回正在编辑的那一项，离原位置最近的）。T7 的 `findEntry` 改为用它实现。
- Wi-Fi 定时保存时写回打开页面时读到的 crontab。在这之间 crontab 被别处改过（`cron-changed`）时，和 T7 一样重新读取、找回这一条，可以再保存一次。
- 删除弹确认（新增翻译键 `deleteTitle`、`deleteConsequence`），删除不算会断网的操作。去掉了翻译键 `wireless:schedule.unsaved`。

### T10（完成）

- `saveSchedule` 每次都重新读取防火墙和 crontab，没有 T9 那样的冲突，页面不需要重新读取。
- 设备还没有时段时，"启用"开关不可用：启用状态写在时段生成的防火墙规则里，没有时段就没有可开关的东西。第一次保存时段时自动启用。
- 关闭"启用"时，确认里只列"重新加载防火墙规则"，不列"断开正在进行的连接"。
- 删除弹确认（新增翻译键 `devices:parental.deleteTitle`）。去掉了翻译键 `devices:parental.unsaved`。

### T11（完成）

- 删除 `src/ui/EditSheet.tsx`。
- 翻译键：对比 M5 开始前后"源代码里找不到引用的键"，M5 没有新增这类键（T9、T10 已经删掉了两个"有修改还没保存"）。顺手删掉了这几个页面里早就没用的 `network:ddns.running`、`network:ddns.save`、`network:wireguard.generating`。其余找不到引用的键（各个 Tab 的 `title` 等）不属于 M5，没有动。
- 主设计 §8.3 按 M5 设计 §2.1 改写，并写明修改管理密码、添加唤醒设备这两个小表单保留弹窗（M5 设计 §1.1）。
- 二级页面在模拟器上的走查放到阶段 C 编译开发版之后一起做（T14 本来就要重新编译）。
