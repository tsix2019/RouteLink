# RouteLink 产品网站设计

> 主设计：`docs/superpowers/specs/2026-10-05-routelink-design.md`
>
> 目标：在 GitHub Pages 上放一个介绍 RouteLink 的单页网站，中英双语、深浅两种主题、响应式，有动画和交互。网站代码放在仓库的 `website/` 目录。

## 1. 部署

GitHub Pages 已经用 Actions 方式部署了路由器插件的软件源（`/agent/`）。App 的 `MANIFEST_URL`（`src/features/agent/manifest.ts`）和用户在路由器上加的 opkg / apk 源都指向它。Actions 方式每次部署都替换整个站点，所以网站和软件源必须在同一个产物里：

- 新增 `.github/workflows/pages.yml`，只有它负责部署 Pages：网站放在根目录，软件源放在 `/agent/`。
  - `main` 上 `website/**`、`docs/screenshots/**`、`assets/images/**` 或这个 workflow 本身有改动时，或手动运行时：用 `website/mirror_feed.py` 把线上的 `/agent/` 原样镜像下来。软件包按 `manifest.json` 和 `Packages` 里的 sha256、大小逐个校验，opkg 源要求 `Packages` 和 `Packages.sig` 都在，apk 源要求 `packages.adb` 在。缺任何一个文件就停止部署，不会出现“网站上线了、软件源没了”的情况。线上还没有软件源（`manifest.json` 返回 404）时，只部署网站。公钥用仓库里的 `openwrt/feed/keys`，和 `scripts/agent-manifest.ts` 一致。
  - `workflow_call` 时由调用方传入 `feed-artifact`，直接用这份软件源，不再镜像。
- `openwrt-release.yml` 不再自己部署 Pages：把 `release/pages/agent` 上传为 artifact `agent-pages`，再调用 `pages.yml`。预发布版本仍然不部署。重新发布旧 tag（workflow_dispatch）时，用的是 main 上的 workflow，同样适用。
- 网站总是取默认分支上的 `website/`，所以从 tag 触发的插件发布不会把网站退回旧版本。
- 网站地址：`https://tsix2019.github.io/RouteLink/`。站内全部使用相对路径。

## 2. 技术方案

- 纯静态 HTML、CSS 和原生 JS（ES 模块），网站本身没有 npm 依赖，也不需要打包工具。
- `website/build.py`（Python 3 + Pillow）生成 `website/dist/`：
  - 复制 `website/src/`；
  - 校验 `src/i18n/en.json` 和 `zh.json`：键必须一致，不能有空字符串；HTML 里用到的键必须两边都有；
  - 预渲染中文：把 `data-i18n` / `data-i18n-html` / `data-i18n-attr` 填进 HTML，没有 JS 的访客和搜索引擎也能看到内容；
  - 把 `docs/screenshots/{zh,en}` 和 `assets/images/widget-preview-*` 转成 WebP，每张出 720w 和 360w 两个尺寸；已是最新的图片跳过；
  - 生成 favicon、apple-touch-icon 和社交分享图 `og.png`；
  - 把 `package.json` 里的版本号写进页面，作为兜底值。
- 截图只有 `docs/screenshots` 这一份，CI 里转换，仓库里不存第二份。
- 不加载外部字体、不放统计代码。页面运行时只访问 GitHub API 读最新版本号和 APK 地址，失败时按钮仍然指向 Releases 页面。

## 3. 视觉

- 沿用 App 的 iOS 26 液态玻璃风格：悬浮玻璃导航、毛玻璃卡片、大标题、圆角分组。
- 主色取自图标的蓝 → 青渐变（`#0A5BFF` → `#14C8C8`）；背景是缓慢流动的极光色块，叠一层很淡的网格。
- 字体用系统字体：SF Pro / Segoe UI / Roboto，中文用苹方 / 微软雅黑 / Noto Sans SC。
- 手机外框由 CSS 绘制：iOS 截图自带灵动岛，Android 补一个前置摄像头开孔。

## 4. 页面结构

1. 导航：玻璃胶囊，包含 Logo、锚点链接、语言切换（中 / EN）、主题切换和 GitHub 链接；手机上收进菜单。
2. Hero：大标题和下载按钮。iOS、Android 两台手机样机跟随鼠标做 3D 倾斜，周围漂浮几张玻璃数据卡片：实时速率（曲线每秒更新）、在线设备、90 秒自动回滚。
3. 兼容性跑马灯：OpenWrt 版本、平台、架构等。
4. 功能便当格，每格一个小动画：
   - 自动发现：雷达扫描；
   - 多路由器切换：胶囊里轮换路由器名；
   - 按设备流量：柱条增长；
   - 安全改配置：90 秒倒计时环；
   - SSH 终端：打字效果；
   - AI 助手：对话气泡和服务商标签；
   - 小组件与通知：通知滑入；
   - 液态玻璃；
   - 演示模式。
5. 滚动叙事：左侧分步讲解，右侧吸顶的手机随步骤切换截图，依次是概览、设备、流量、无线、网络工具、终端和 AI。窄屏改为每一步配一张图。
6. 截图画廊：可切换 iOS / Android，横向滚动并吸附，有左右箭头，可以拖动。
7. 完整功能清单：按概览、设备、无线、网络、更多分 Tab。
8. 路由器插件：展示资源占用数据（数字递增动画）、保存时长、支持的版本和架构，以及 opkg / apk 安装命令（分 Tab，可一键复制）。下方是在网页里绘制的插件 LuCI 页面（`js/luci.js`），不用截图：概览、流量、延迟、限速与配额、访问记录、推送、设置 7 个 Tab 都能切换，曲线由脚本画，概览页的 WAN 实时曲线会动，流量页和延迟页的时间段按钮可以点。全部是演示数据，跟随页面的语言和深浅色。
9. 安全与隐私：钥匙串、证书固定、主机指纹、不收集数据、AI 数据打码、操作确认。
10. 下载：Android APK、iOS IPA（AltStore、SideStore、Sideloadly、TrollStore），以及路由器要求。
11. 页脚：协议、致谢和链接。

## 5. 交互和状态

- 语言：依次看 `?lang=`、`localStorage`、浏览器语言，以中文开头的用中文，其余用英文。切换时就地替换文字，`<html lang>` 和标题同步更新。
- 主题：`<head>` 里的内联脚本在首次绘制前设置 `data-theme`。用户没选过时跟随系统，并监听系统切换；切换时如果浏览器支持 View Transitions，就从按钮位置做圆形展开。
- 截图跟随语言和主题：`img[data-shot="ios:overview"]` 由脚本拼出 `shots/<lang>/<platform>-<name>-<theme>.webp`，切换时淡入淡出。
- 动画：滚动渐显（IntersectionObserver，交错延时）、数字递增、3D 倾斜、跑马灯、各便当格的小动画。页面不可见或元素在视口外时暂停；`prefers-reduced-motion` 时关闭动画，直接显示最终状态。
- 页面在 i18n 应用完之前保持透明，然后淡入。`<noscript>` 和 2 秒超时兜底。

## 6. 验证

- `python website/build.py` 通过 i18n 校验；
- 本地用 `python -m http.server` 在浏览器里检查：桌面、平板、手机三种宽度；浅色、深色；中文、英文；控制台无报错；
- 把 `mirror_feed.py` 在线上软件源上跑一遍，确认能完整镜像，校验全部通过；
- workflow 只能在合并到 main 以后真正运行，PR 里说明这一点。
