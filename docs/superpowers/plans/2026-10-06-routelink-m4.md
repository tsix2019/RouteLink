# RouteLink M4 实施计划：第三档的原生能力

> 主设计：`docs/superpowers/specs/2026-10-05-routelink-design.md`（下文简称"设计"，§ 表示章节）
> 前几期的计划：`2026-10-05-routelink-m1.md`、`2026-10-05-routelink-p1.md`、`2026-10-05-routelink-m2.md`、`2026-10-05-routelink-m3.md`
>
> **前提**：M3 已经完成（QEMU 三个版本的普通和高风险集成测试全部通过）。插件和你路由器的联调仍然暂停，P2、P3 都要在真实网络里联调插件，所以接着做 M4。
>
> **执行方式**：和 M3 相同。
> - 按顺序逐个完成任务，每个任务做完提交一次；改动了 CI 或原生代码的任务提交后立刻推送。
> - 逻辑代码走 TDD：先写测试，确认失败；再实现，确认通过。
> - 原生代码：Android 在本机模拟器上测（连我自己的 Docker 路由器）；iOS 靠 CI 编译，并在模拟器里跑自检（设计 §21）。
> - 界面任务用演示路由器走查；iOS 以 CI 的截图为准。
> - **你的路由器**：SSH 登录用你自己输入的密码；把 App 的公钥写进路由器是写操作，执行前先问你。AI 助手只在你愿意时用你自己的 API Key。

**目标**：设计 §24 里 M4 的功能：

| 编号 | 功能 | 风险 |
|---|---|---|
| MO-12 | SSH 终端：密码或密钥登录、主机指纹固定、一键把 App 的公钥装到路由器 | 中 |
| MO-15 | AI 助手（设计 §18） | 隐私 |
| OV-6 | 概览快捷操作"问 AI" | — |
| AP-4 | 桌面小组件（设计 §19） | — |
| AP-5 | 后台通知：路由器掉线、恢复、有新设备接入 | — |
| AP-3 | 演示模式：上面这些功能的演示数据 | — |

完成标准（设计 §24）：功能可用，iOS 自检通过；打标签发布 v1.0.0（APK 和未签名 IPA）前先征得你的同意。

---

## 0. 和设计不同的决定

1. **最低系统版本提高到 iOS 17、Android 8.0（API 26）**。
   - iOS：Citadel 从 0.12 起要求 iOS 17。设计 §17 说"M1 已验证 Citadel 在 Xcode 26 上编译通过"，这个结论是错的：当时的 CI 把编译失败掩盖了（日志过滤后面的 `|| true` 吞掉了 xcodebuild 的退出码，失败的编译也会留下一个 `.app` 目录）。真实的报错是 `compiling for iOS 16.4, but module 'Citadel' has a minimum deployment target of iOS 17.0`。CI 已改成必须看到 `BUILD SUCCEEDED`（56a0d26）。
   - Android：sshj 的 ed25519 代码用到 `java.util.Base64`，要 API 26。
   - 2026 年仍在用 iOS 16 和 Android 7 的设备很少，README 的系统要求同步修改。
2. **SSH 原生模块的细节**：
   - **Android**：sshj 0.41.1，加上 BouncyCastle 1.84。
     - 第一次用之前，要把系统自带的精简版 `BC` 换成完整版。否则密钥交换会报 "no such algorithm: X25519 for provider BC"。
     - 三个 BouncyCastle 包里有同名文件 `META-INF/versions/9/OSGI-INF/MANIFEST.MF`，打包时要排除它（`expo-build-properties` 的 `packagingOptions`）。
     - APK 会增大大约 10 MB。以后可以考虑开启 R8 来缩小。
   - **iOS**：Citadel 0.12.1，通过 React Native 的 `spm_dependency` 引入，用 `exactVersion` 固定版本。
     - podspec 的平台改为 iOS 17，`swift_version` 设为 5.9。
     - OpenWrt 的 dropbear 没有开 AES-GCM，而 Citadel 默认只提供 GCM，所以要加上 `AES128CTR`。
     - 静态链接有出问题的风险（重复符号），T3 先单独验证；不行就退回 `useFrameworks: 'dynamic'`。
   - **首次连接分两步**：先连一次，拒绝未知的主机密钥，并记下它的指纹；用户确认后再连一次，这次带上固定的指纹。原因是 Citadel 把 TCP 连接、密钥交换和认证一起限定在 10 秒内，校验回调里不能停下来等用户点确认。两个平台都按这个流程做，和 HTTPS 证书的确认页一致（设计 §5）。
   - **App 的密钥**：整个 App 只用一对 ed25519 密钥。
     - 私钥保存 32 字节的种子（两个平台格式相同），存在 SecureStore，设为首次解锁后可读。
     - 公钥写成一行：`ssh-ed25519 AAAA… routelink`。
   - **指纹格式**：和 OpenSSH 一致，`SHA256:` 后面跟去掉补位的 base64。
3. **装公钥走 ubus，不走 SSH**：
   - 用登录路由器得到的会话读 `/etc/dropbear/authorized_keys`。没有这一行才追加，然后以 0600 权限写回。
   - 移除公钥时也一样，只删 App 自己那一行。
   - 写之前按中风险确认，弹窗里显示要写入的内容。
4. **终端**：
   - react-native-webview 13.16.1 加 @xterm/xterm 6.0.0、@xterm/addon-fit 0.11.0。
   - xterm 的 JS 和 CSS 由脚本生成到 `src/features/terminal/xterm.generated.ts`，内联进 HTML，不从网上加载。文件开头保留 MIT 许可声明。
   - 数据双向传递：
     - 原生模块收到的数据以 base64 交给页面，经 `injectJavaScript` 写进 xterm。xterm 会自己处理被切开的 UTF-8 字节。
     - 用户输入和终端尺寸变化经 `postMessage` 传回 App。
   - 同一台路由器只有一个会话，离开终端页时保持连接，关掉页面上的"断开"或连接断了才结束。
5. **AI 助手**（按 §1 核对过的接口）：
   - **Anthropic**：
     - 模型可选 `claude-sonnet-5-5`（默认）、`claude-opus-5-5`、`claude-haiku-4-5-20251001`。
     - 不传 `temperature`，`tool_choice` 只用 `auto`。
     - 工具循环里，`thinking` 块原样传回；已经结束的轮次去掉 `thinking` 块，系统提示和工具列表在一次对话里不变。
   - **OpenAI 兼容接口**：自填 Base URL 和模型。预设 OpenAI、DeepSeek、通义千问（国际站、国内站）、Ollama。
     - 带工具时，预设里关掉思考模式：DeepSeek 用 `thinking: {type: 'disabled'}`，通义千问用 `enable_thinking: false`，OpenAI 用 `reasoning_effort: 'none'`。
     - 不传 `tool_choice`。限长字段按预设决定用哪一个，或者干脆不传。
   - **流式输出**：用全局的 `fetch`（SDK 57 里就是 expo/fetch），通过 `body.getReader()` 读取，`TextDecoder` 带 `stream` 解码，自己解析 SSE。
     - "停止"按钮用 `AbortController`。
     - 90 秒没有收到数据就算超时，不自动重连。
   - **测试连接**：调 `GET /v1/models`，同时得到可选的模型列表。
   - **设备代号**：工具返回的设备带一个代号（`d1`、`d2`…），写操作也用代号指定设备。这样 MAC 打码后仍然能指定设备。代号和 MAC 的对应关系只留在手机上。
   - **永不发送**：Wi-Fi 密码、私钥、预共享密钥、管理密码。工具输出里的 `key`、`password`、`private_key`、`preshared_key` 一律去掉。
   - **测试方式**：
     - CI 和本机都不调用真实服务商。
     - 单元测试用录好的 SSE 流。
     - 模拟器上的完整流程，连本机启动的模拟服务（`scripts/mock-llm.ts`，两种协议都支持）。
6. **小组件**：
   - iOS 用 expo-widgets 57.0.22 和 @expo/ui，App Group 为 `group.io.github.tsix2019.routelink`。
     - 未签名的 IPA 自己签名时，要给 App 和小组件扩展都配置这个 App Group，否则小组件拿不到数据。README 里说明。
     - 自检时检查 `widgetsDirectory` 不为空。
   - Android 用 react-native-android-widget 0.22.1。它没有写明支持 RN 0.86，T15 先确认能编译。
     - 小组件文件开头写 `"use no memo";`，否则 React Compiler 编译后会报 "Invalid hook call"。
7. **后台任务需要自己的入口文件**：
   - `TaskManager.defineTask` 和 `registerWidgetTaskHandler` 要在入口模块里执行。后台启动时不会加载 `_layout.tsx`。
   - `package.json` 的 `main` 改为 `index.ts`，它先 `import 'expo-router/entry'`，再注册这两项。
8. **后台检查与通知**：
   - 用 expo-background-task，间隔 15 分钟。
     - iOS 用的是 `BGProcessingTask`，模拟器上不运行，只能在真机上看到效果。
     - Android 用 WorkManager，App 在前台时不运行；可以用 `adb shell cmd jobscheduler run -f` 手动触发。
   - 只发本地通知。
     - expo-notifications 默认会给 iOS 加上推送的 `aps-environment` 授权，可能让免费的 Apple ID 签不了 IPA。加一个小的配置插件把它去掉，并用 prebuild 确认。
   - 每台路由器单独开关，默认关闭。没有保存密码的路由器不能开。
   - 判断规则：
     - **掉线**：这一次连不上，10 秒后再试一次还是连不上，而上一次能连上。
     - **恢复**：这一次能连上，而上一次连不上。
     - **新设备**：出现以前没见过的 MAC 地址。第一次检查只记录，不发通知。
   - 装了插件的路由器，新设备提醒以后改由插件推送（插件设计 AG-14，P4）。M4 先由 App 对所有路由器做。
9. **入口**：
   - SSH 终端：更多 Tab 的"路由器"分组加"SSH 终端"。SSH 设置（端口、用户、认证方式、主机指纹、安装或移除公钥）放在路由器详情页。
   - AI 助手：
     - 概览的快捷操作加"问 AI"（OV-6）。
     - 对话页 `/assistant` 是根层级的全屏页面，从哪里都能打开。
     - 设置页放在更多 Tab 的"App"分组。
   - 通知与小组件：更多 Tab 的"App"分组。
10. **演示模式**：
    - 终端：一个假 shell，能执行几条常用命令，比如 `uname -a`、`uptime`、`free`、`df -h`、`ip -4 addr`、`logread | tail`。
    - AI 助手：用脚本化的服务商，不联网，会调用一次工具，并弹出一次写操作的确认卡片。
    - 小组件显示演示路由器。
    - 通知设置里的"发送测试通知"可以用。

## 1. 已确认的接口（2026-10-06 查阅官方文档和源码）

| 用途 | 结论 |
|---|---|
| Anthropic | `POST https://api.anthropic.com/v1/messages`，请求头 `x-api-key`、`anthropic-version: 2023-06-01`；手机直连不需要其他请求头（`anthropic-dangerous-direct-browser-access` 只用于浏览器）。流式事件依次是 `message_start`、每个块的 `content_block_start/delta/stop`、`message_delta`（带 `stop_reason`）、`message_stop`；`ping` 随时出现，HTTP 200 之后也可能来 `error` 事件；没有 `[DONE]`。工具参数是 `input_json_delta.partial_json`，拼完后在块结束时解析，空串当作 `{}`。工具结果放在下一条 user 消息开头，每个 `tool_use` 对一个 `tool_result`，拒绝执行时 `is_error: true`。Opus 5.5 和 Sonnet 5.5：`tool_choice` 只能用 `auto` 或 `none`；不能传 `temperature`、`top_p`、`top_k`；返回里可能有内容为空、带 `signature` 的 `thinking` 块，工具循环里要原样传回。`stop_reason` 可能是 `refusal`。错误：401、429（看 `retry-after`）、529（过载） |
| OpenAI 兼容 | `POST {base}/chat/completions`，`Authorization: Bearer`。流式块是 `data: {json}`，最后一行 `data: [DONE]`。工具调用按 `index` 累加：`id` 和 `name` 只在非空时取，`arguments` 逐段拼接，流结束后再解析；是否要调工具，以累加的结果为准，不只看 `finish_reason`。`delta.reasoning_content`、`delta.reasoning` 和不认识的字段一律忽略 |
| 预设 | OpenAI `https://api.openai.com/v1`；DeepSeek `https://api.deepseek.com`（`deepseek-chat` 已在 2026-07-24 停用，默认 `deepseek-flash`）；通义千问国际站 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`、国内站 `https://dashscope.aliyuncs.com/compatible-mode/v1`（默认 `qwen3.7-plus`，Key 和地域绑定）；Ollama `http://<局域网地址>:11434/v1`（模型从列表里选）。默认模型以测试连接时拿到的列表为准 |
| expo/fetch | SDK 57 在 iOS 和 Android 上把它装成全局 `fetch`，`response.body.getReader()` 可以流式读取；原生 `TextDecoder` 只支持 UTF-8，但支持 `{stream: true}` |
| expo-widgets 57.0.22 | 小组件界面写在以 `'widget'` 开头的函数里，用 `@expo/ui/swift-ui` 组件，函数会被转成字符串，在独立环境里运行：不能用 Hook，不能引用函数外的任何东西。`createWidget(name, fn)` 返回对象的 `updateSnapshot(props)` 写入 App Group 并刷新。App 至少要运行过一次 `createWidget`，小组件才能显示 |
| react-native-android-widget 0.22.1 | 配置插件声明小组件；`registerWidgetTaskHandler` 在入口注册；`requestWidgetUpdate({ widgetName, renderWidget })` 从 App 或后台任务刷新。界面只有 Flex、Text、Image、Icon、Svg、List 这几种组件 |
| expo-background-task 57.0.21 | `TaskManager.defineTask` 加 `BackgroundTask.registerTaskAsync(name, { minimumInterval: 15 })`，单位是分钟。已经注册过的任务再注册不会更新间隔，要先注销 |
| expo-notifications 57.0.21 | `setNotificationHandler`（`shouldShowBanner`、`shouldShowList`）；Android 先建通道 `setNotificationChannelAsync`，Android 13 的授权弹窗要在建了通道以后才会出现；立即发送用 `scheduleNotificationAsync({ content, trigger: null })` |
| sshj 0.41.1 | 依赖 slf4j-api、bcprov/bcpkix-jdk18on 1.84。指纹：对 `Buffer.PlainBuffer().putPublicKey(key)` 的结果做 SHA-256（sshj 自带的只有 MD5）。PTY：`allocatePTY`、`startShell`、`changeWindowDimensions`。单次命令：每条命令一个 session，`exec` 后同时读标准输出和错误输出 |
| Citadel 0.12.1 | `SSHClient.connect(host:port:authenticationMethod:hostKeyValidator:reconnect:algorithms:…:connectTimeout:)`；认证用 `.passwordBased` 或 `.ed25519(username:privateKey:)`；主机密钥校验用 `.custom(NIOSSHClientServerAuthenticationDelegate)`；交互式 shell 用 `withPTY`（写入用 `TTYStdinWriter`，改尺寸用 `changeSize`）；单次命令用 `withExec`，它在结束时会关闭通道，超时自己用任务组实现 |
| 设计 §21 的 iOS SSH 自检 | CI 的 macOS 机器上用 Homebrew 的 dropbear（2026.94）临时起一个 SSH 服务，用户名、密码和主机密钥都在脚本里生成 |

---

## 阶段 A：SSH

### T1. 最低系统版本

- `app.config.ts`：`ios.deploymentTarget: '17.0'`（SDK 56 起的内置配置项）；Android 用 `expo-build-properties` 设 `minSdkVersion: 26`，并加上 BouncyCastle 的打包排除项。
- podspec：`s.platforms = { :ios => '17.0' }`。
- README 的系统要求、设计 §17 的错误结论一并改掉。

**提交**：`build: iOS 17 and Android 8.0 at least, for the SSH libraries`

### T2. Android SSH（sshj）

- `modules/routelink-native/android`：
  - `SshEngine.kt`：负责会话表、读线程、事件。
  - `SshKeys.kt`：生成密钥、算公钥行和指纹。
- 模块函数：
  - `sshGenerateKey()`：返回 `{ seed, publicKey }`。
  - `sshOpen(options)`：返回会话 id。选项有 `host`、`port`、`username`、`password` 或 `keySeed`、`hostKey`、`cols`、`rows`、`timeoutMs`。
  - `sshWrite(id, base64)`、`sshResize(id, cols, rows)`、`sshClose(id)`。
  - `sshExec(options, command, timeoutMs)`：返回 `{ code, stdout, stderr }`。
- 事件：`onSshData { id, data }`、`onSshClosed { id, error? }`。
- 错误码沿用 `NativeError`，新增几种：
  - `SSH_HOST_KEY_UNKNOWN`、`SSH_HOST_KEY_CHANGED`：details 里带指纹和密钥类型。
  - `SSH_AUTH_FAILED`。
  - 连不上、超时用原有的错误码。
- `RouteLinkNative.types.ts` 补上类型。JS 端的封装 `src/api/ssh/native.ts` 用假模块写单元测试。
- **验证**：在模拟器上连我的 Docker 路由器（端口转发 22），密码登录、密钥登录、指纹不符被拦截、PTY 输入输出、改尺寸、执行单条命令。

**提交**：`feat(native): SSH on Android with sshj`

### T3. iOS SSH（Citadel）

- `SshEngine.swift`：和 Android 相同的函数、事件和错误码。
- podspec 里用 `spm_dependency` 引入 Citadel 0.12.1。
- **自检**：
  - `scripts/ci/selftest-servers.py` 旁边加 `scripts/ci/selftest-ssh.sh`：用 Homebrew 装 dropbear，在 2222 端口起一个服务，带一个测试用户和密码，再把测试密钥写进 `authorized_keys`。
  - 自检页加几项检查：
    - 第一次连接得到 `SSH_HOST_KEY_UNKNOWN`，指纹和脚本算出的一致。
    - 固定指纹后，用密码登录能执行 `echo`。
    - 用密钥登录能执行。
    - 指纹不符被拦截。
    - PTY 能回显输入。
- 先在一个分支上用 `workflow_dispatch` 验证能编译、能链接；静态链接不行就改用动态框架。

**提交**：`feat(native): SSH on iOS with Citadel`

### T4. SSH 服务层

- `src/api/ssh/session.ts`：
  - 会话管理，每台路由器一个会话。
  - 首次连接两步确认。
  - 指纹固定在路由器资料里，新增字段 `sshPort`、`sshUser`、`sshHostKey`、`sshAuth`。
- `src/api/services/ssh-keys.ts`：
  - `appKey()`：没有就生成。
  - `installPublicKey(conn, line)`、`removePublicKey(conn, line)`：通过 ubus 读写 `authorized_keys`。
  - `hasPublicKey(conn, line)`。
- `runOverSsh(router, command)`：给以后 ubus 没有权限的命令用，设计 §17 里的"执行通道"。
- **测试**：
  - 单元测试：追加和移除公钥时不改动其他行，文件没有末尾换行时也正确，不重复追加。
  - QEMU 集成测试（三个版本）：在 Node 里生成一对 ed25519 密钥，用 App 的函数装公钥；在 CI 机器上用 `ssh -i` 登录成功；移除公钥后登录失败。

**提交**：`feat(api): SSH sessions, host key pinning and the app's key on the router`

## 阶段 B：终端

### T5. 终端组件

- `scripts/build-terminal.ts`：从 node_modules 生成 `xterm.generated.ts`。
- `src/features/terminal/TerminalView.tsx`：WebView、xterm、自适应尺寸、主题跟随浅色和深色、字号。
- `KeyBar.tsx`：Esc、Tab、Ctrl（按下后作用于下一个键）、方向键、`|`、`/`、`-`、`~`；粘贴；复制选中的文字。
- **测试**：Ctrl 组合键的编码；方向键的转义序列。

### T6. 终端页和 SSH 设置

- `src/app/(tabs)/more/terminal.tsx`：
  - 连接中、已连接、已断开（重连）三种状态。
  - 首次连接时跳到指纹确认页，复用证书确认页的样式。
  - 指纹变化时进入警告页（设计 §13）。
- 路由器详情页加 SSH 一节：端口、用户、认证方式（密码或 App 密钥）、主机指纹（可以清除）、安装或移除 App 的公钥。
- 演示模式用假 shell。

**提交**：`feat(app): SSH terminal`

## 阶段 C：AI 助手

### T7. SSE 和两种服务商

- `src/ai/sse.ts`：处理 CRLF、多行 `data`、注释行、被切开的块、BOM 和结尾没有空行的情况。
- `src/ai/providers/anthropic.ts`、`openai.ts`：
  - 把流转换成统一的事件：文字片段、工具调用、结束原因、用量、错误。
  - 再把统一格式的对话历史转换成各自的请求体。
- **测试**：用录好的事件序列，包括并行工具调用、拆成多段的参数、流中途出错、拒答、`[DONE]`、Ollama 一次给完整个工具调用、通义千问续传块的 `id` 为空。

### T8. 工具和脱敏

- `src/ai/tools.ts`：
  - 只读工具：概览、设备列表、接口、无线（不含密码）、防火墙、日志（最近若干行）、实时连接（前若干条）。
  - 写工具：重启、踢下线、拉黑和解除、改 Wi-Fi 名称和密码、开关射频、增删端口转发、重启服务。风险级别按设计 §10。
  - 高风险操作不开放。
- `src/ai/redact.ts`：
  - MAC 只保留前三段（厂商部分）。
  - 公网 IP 打码；内网地址按"IP 地址"类别的开关决定。
  - 设备名、IP、MAC、日志四类数据可以分别关闭。关掉"日志"后，日志工具不出现在工具列表里。
- **测试**：用 QEMU 录制的样本跑每个工具，检查脱敏结果和永不发送的字段。

### T9. 对话引擎

- `src/ai/agent.ts`：
  - 工具循环：只读工具直接执行；写工具发出确认请求，等待用户决定。拒绝时回给模型"用户拒绝了这次操作"。
  - 每次回答最多 8 轮工具调用。
  - 支持停止；出错时保留已经输出的内容。
- `src/state/assistant.ts`：
  - 服务商设置；API Key 存在 SecureStore。
  - 隐私开关；第一次使用的说明是否已经同意。
  - 每台路由器的对话记录，存在本机，最多 50 条，可以清空。
- **测试**：用假服务商覆盖这些情况：确认后执行、拒绝、中途停止、工具出错、超过轮数上限、切换路由器后对话分开。

### T10. 对话页和设置页

- `/assistant`：
  - 消息列表，Markdown 自己渲染（段落、粗体、行内代码、代码块、列表、标题）。
  - 流式显示。
  - 工具调用显示成小标签，比如"读取了设备列表"。
  - 写操作的确认卡片：级别、要做什么、"执行"和"取消"。
  - 输入框和停止按钮。
- 第一次打开时，说明会发送哪些数据，同意后才能用。
- 设置页：服务商、预设、Base URL、模型（测试连接后可以从列表里选）、API Key、隐私开关、清空对话记录。
- 概览快捷操作加"问 AI"。

### T11. 演示服务商和本机模拟服务

- `src/ai/providers/demo.ts`：按关键词回答，会调用一次只读工具，会提出一次写操作。
- `scripts/mock-llm.ts`：本机 HTTP 服务，支持 Anthropic 和 OpenAI 两种协议，按脚本流式回复，也会调用工具。模拟器通过 `10.0.2.2` 访问它。

**提交**（T7～T11 各一次）：`feat(ai): …`

## 阶段 D：小组件与后台通知

### T12. 入口文件和快照

- `index.ts` 作为新的 `main`。
- `RouterSnapshot` 加上路由器名称、在线状态、上下行速率。概览刷新时写入快照，并通知小组件刷新。

### T13. 后台检查和通知

- `src/features/background/check.ts`：比较规则（§0 第 8 条）写成纯函数，单元测试覆盖。
- `src/features/background/task.ts`：注册后台任务，依次检查开启了通知的路由器。
- `plugins/withoutPushEntitlement.js`：去掉 `aps-environment`。
- 设置页"通知与小组件"：
  - 每台路由器一个开关。
  - 系统通知权限的状态。
  - 后台检查的说明：不准时，iOS 上可能好几个小时才运行一次。
  - "发送测试通知"。
- **验证**：在 Android 模拟器上用 `cmd jobscheduler run -f` 触发：把 Docker 路由器停掉，收到"连不上"；再启动，收到"已恢复"。

### T14. iOS 小组件

- `src/widgets/RouterWidget.ios.tsx`：小尺寸显示名称、在线状态和在线设备数，中尺寸再加上下行速率和更新时间。
- 点击打开 App 的概览。
- 自检里检查 `widgetsDirectory`。

### T15. Android 小组件

- 先在空分支上确认 react-native-android-widget 能和 RN 0.86 一起编译。
- 尺寸和内容同 iOS，点击打开 App。

**提交**（T12～T15 各一次）

## 阶段 E：测试与发布

### T16. 截图、README、执行记录

- 截图新增：终端、AI 对话、AI 设置、通知与小组件。中英文都要有。
- README：
  - 功能清单里 M4 的项改成 ✅。
  - 系统要求改为 iOS 17、Android 8.0。
  - 说明 AI 助手会把哪些数据发给服务商。
  - 说明自己签名 IPA 时 App Group 要怎么配。
- 设计 §24 把 M4 标成完成。

### T17. 走查

- Android 模拟器：
  - 用 Docker 路由器走一遍 SSH 终端的全部流程。
  - 用本机模拟服务走一遍 AI 助手的全部流程（只读工具、确认后执行、拒绝、停止）。
  - 后台检查。
  - 两个尺寸的小组件。
- iOS：看 CI 的自检结果和截图。

### T18. 在你的路由器上走查（需要你在场）

- SSH 用你输入的密码登录，只执行只读命令。装公钥前先问你。
- AI 助手：只有你愿意时，才用你自己的 API Key，只问只读的问题。
- 通知：开启后，看后台检查能不能连上。

### T19. 发布 v1.0.0

- 先征得你的同意。产物和以前一样：APK 和未签名 IPA。

---

## 执行记录（实施过程中填写）

| 项目 | 结论 |
|---|---|
