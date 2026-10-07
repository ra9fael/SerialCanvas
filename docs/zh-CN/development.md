# 开发指南

> 本文为[英文版](../development.md)的中文镜像，逐节对应；如有出入以英文版为准。

## 仓库结构

```
index.html              Document shell: every panel, control and dialog. No inline app logic.
bootstrap.js            Runs before first paint: theme, body classes, favicon. Only pre-read script.
app.loader.js           Dev-mode chunk loader (fetch + concat + eval as one script).
app.lang.js             (~420 lines) Locale dictionaries: Chinese source string -> English.
                        Standalone script, not part of the shared closure.
app.core.js             (~2100 lines) Constants, `state`, `refs`, formatting, encoding, hex,
                        theme, layout, toasts, buffers, version/offline detection, analytics.
app.terminal.js         (~300 lines) xterm.js lifecycle, skins, echo/history, view switching.
app.main.js             (~8000 lines) Serial lifecycle, RX pipeline, monitor rendering, send
                        modules, timeline, parser, charts, persistence, wiring.
style.css               All styling, light/dark themes, compact layout.
vendor/xterm/           Vendored xterm.js + fit addon + css (no CDN, so offline works).
LICENSE                 AGPL-3.0, the license the upstream project declares.
build-release.py        Verifies the version, then produces dist/SerialCanvas.html.
.github/workflows/      pages.yml — builds the artifact on every push to main and deploys
                        it to GitHub Pages.
tools/                  Optional development helpers: set-version.py (cut a release),
                        cdp-check.mjs (headless-browser audit driver),
                        extract-i18n-keys.py (dictionary key lister),
                        docs-check.py (doc links, anchors, en/zh mirror parity). Not shipped.
docs/                   This documentation set (English at the root, zh-CN mirror),
                        including acknowledgements.md (provenance and license).
```

没有打包工具、没有框架、开发也不需要有构建步骤——源码就是实际交付的文件。`node_modules/`、`dist/` 和 `.venv/` 都被 git 忽略；`dist/` 随时可以由 `build-release.py` 重新生成。

## 共享闭包约束

`app.core.js` 在第 1 行**打开**一个 IIFE（`(() => {`），`app.main.js` **关闭**它（`})();`），而 `app.terminal.js` 是位于两者之间的片段。拼接后它们是同一个函数体、同一个词法作用域。

一旦动这些源码，下面几点就会立刻产生影响：

- 三个文件**不能分开加载**——每个文件一个 `<script>` 标签会失败，因为闭包无法跨越标签。这正是 `app.loader.js` 存在的原因，也是构建只内联一份拼接结果的原因。
- 顶层的 `const`/`let`/`function` 名称必须在三个文件之间唯一；重复声明会让拼接结果出现 `SyntaxError`，应用会静默地永远启动不起来。
- 因为暂时性死区，顺序是有讲究的：`app.main.js` 可以在函数内部引用 `app.core.js` 的 `const`（调用时没问题），但反过来在顶层引用不行。新的顶层常量请放在 `app.core.js`。
- 绝不要引入 `import`/`export` 或第二个 `(function(){` 包装——它会破坏拼接约定，也会破坏构建。

### 为什么源码模式需要 HTTP

浏览器把每个 `<script src>` 当作独立的程序，所以 `app.loader.js` 会取回三个分片、用 `\n` 连接，并把结果作为一个内联 `<script>` 注入。`fetch()` 在 `file://` 下不可用，因此双击打开 `index.html` 只会看到一个遮罩，指向 `dist/SerialCanvas.html`。此外 Web Serial 还要求安全上下文，所以 `file://` 本来也没法连接端口。开发时请从根目录起服务：

```sh
python -m http.server 8000     # http://localhost:8000/
```

## 全局对象与装配

`bootstrap.js` 定义了唯一有意保留的 `window.*` 接口：`__serialWebInitialPrefs`、`__serialWebInitialTheme`、`__applySerialCanvasInitialBodyClasses()`（由 `<body>` 顶部的内联脚本调用，因此首帧就带上正确的主题/面板类，不会闪一下）以及 `__setSerialCanvasFavicon()`。应用包不导出任何东西——没有控制台 API，DevTools 片段也碰不到内部。增加启动期职责时请扩展 `bootstrap.js`，而不是从应用代码往 `window` 上挂。

DOM 访问集中在 `refs` 映射里（`app.core.js`，大约第 58–205 行）：每个元素 id 一条，启动时解析一次。**在 `index.html` 里新增元素就必须补上对应的 `refs` 条目**——除此之外应用不会为面板元素去查询 DOM。少数 `refs.*` 名称用可选链读取，但既没有条目也没有对应元素（例如 `refs.statUptime`、`refs.extensionPanel`）；它们是失效的残留，可以安全删除。

IIFE 末尾的启动顺序：`initializeDefaults()` → `attachEventListeners()` → `trackSerialCanvasView()` → `tryInitialSerialConnectPrompt()`。

## 扩展点

有两个函数是整个应用的接缝：

| 方向 | 入口 | 保证 |
| --- | --- | --- |
| TX | `sendPayload(payload, source, options, meta)` | 字节计数、日志事件、标签元数据、`sendBusy` 串行化，以及原始分片记录。任何新的发送方都必须走它。 |
| RX | `queueRxBytes(bytes, timestamp, meta)` | 行切分、实时事件裁剪、记录，以及为解析/图表刷新置脏标记。 |

真正的 `writer.write()` 在 `performSerialWrite()` 里；`buildPayloadFrame()` 是唯一把发送框文本 + 十六进制模式 + 换行符选项变成字节的地方。`scheduleRefresh()` 把所有渲染合并进单个 `requestAnimationFrame`。

注意终端视图有意绕过 `queueRxBytes` 和 `sendPayload`（它经由 `sendTerminalBytes` 写出），因此不参与解析、绘图和录制。如果你要让新功能看到终端流量，就必须把它加到那条路径上。

在推断性能或竞态之前需要知道的定时器：

| 周期 | 用途 |
| --- | --- |
| 250 ms | 状态/计数时钟。 |
| 800 ms | `getSignals()` 输入轮询。 |
| 420 ms | 波特率字段在重开端口前的防抖。 |
| 500 ms | `localStorage` 写入防抖。 |
| 80 ms | 二进制结构定义重新解析的防抖。 |
| 1800 ms | 预设期望回复超时。 |
| 500 ms | 发送模式磁贴闪动。 |
| ≥ 100 ms | 自动发送周期。 |
| rAF | 派生数据、监视器与图表绘制。 |

## 构建发布产物

前置条件：Python 3，外加

| 工具 | 用于 | 缺少它时 |
| --- | --- | --- |
| `esbuild`（`npm install`） | 压缩拼接后的 JS | JS 原样内联，并输出 `WARN: esbuild not found`；文件仍然可用。 |
| `minify_html`（`pip install minify-html`） | 压缩 HTML 和 CSS | 输出不压缩，并给出警告。 |
| `node` | 校验压缩后的内联脚本 | 跳过校验（给出警告）。 |

```sh
npm install                                   # provides node_modules/.bin/esbuild
pip install minify-html                       # optional, further compression
python build-release.py                       # -> dist/SerialCanvas.html
python build-release.py --no-minify           # readable output, fastest
```

这个脚本做的事：

1. 校验版本号：`app.core.js` 里的 `const VERSION`、[CHANGELOG.md](../CHANGELOG.md) 中最新的 `## v<版本>` 小节，以及 `index.html` 里最新的 更新日志 块必须指向同一个版本，否则脚本在写出任何内容之前就会停止。见[版本号](#版本号)。
2. 读取 `index.html`，把 `INLINE_ASSETS` 里每个已知资源标签替换为内联的 `<style>`/`<script>` 块。三个应用分片在压缩**之前**拼接，这样 esbuild 会把它们当作一个闭包来解析。
3. 把 JS 内部的 `</script` 转义成 `<\/script`，使内联字符串字面量无法终止该块。
4. 断言内联块之外不再残留任何本地 `src=`/`href=` 引用——新增样式表或脚本必须加入 `INLINE_ASSETS`，否则构建会明确失败。
5. 用 `minify_html` 压缩 HTML/CSS，并刻意设置 `minify_js=False`：minify-html 自带的 JS 压缩器会破坏块级作用域的 `const`/`let`（"Cannot access before initialization"）。JS 压缩属于 esbuild，它在更早的拼接源码阶段执行。
6. 对压缩文档中的每个内联脚本执行 `node --check`；**任何失败都会回退到未压缩的文档**，而不是交付一个坏掉的产物。

结果是一个自包含文件，可以从 `file://` 运行（仅界面——见[原因](#为什么源码模式需要-http)）。

## 验证改动

应用没有自动化测试。实际可行的检查流程是：

1. 重新构建，然后从根目录起服务，同时加载 `index.html`（源码模式）和 `dist/SerialCanvas.html`（发布模式）——只在压缩后才会出现的 bug 只会在后者暴露。
2. 先看控制台：闭包被破坏时表现为一个 `SyntaxError` 加一个空白页面；某个分片加载失败时 `app.loader.js` 会设置 `document.documentElement.dataset.appLoadError`。
3. 用真实设备，或用浏览器的虚拟串口/回环 COM 端口对，把整个链路走一遍：连接、连接状态下改帧参数、DTR/RTS、十六进制发送往返、两个监视标签页。
4. 解析器：套用一条规则，确认卡片和图表，然后在实时数据上用 自动识别。
5. 时间线：REC → 停止 → 选中 → 拖动 → 导出 BIN/TXT/CSV → 重新导入 → 导出解析结果 CSV。
6. 持久化：重新加载页面，确认布局/主题/队列/图表都恢复了；然后 复制配置 → 重新加载 → 粘贴导入。
7. 布局：把窗口拖窄到 720 px 以下，并检查两种布局以及发送面板的拖拽手柄。
8. 两种语言：☰ → 语言 → English，检查界面外壳里是否还残留中文（语言选项本身、字体名与皮肤名属于预期），再切回 中文 检查是否有英文。标签变长是布局风险——监视器标题/计数那一行和 ☰ 菜单是最先挤不下的两处。

`tools/cdp-check.mjs` 把第 1、2、8 步自动化：它通过 CDP 驱动一个无依赖的 headless Edge，例如
`node tools/cdp-check.mjs --url http://127.0.0.1:8731/dist/SerialCanvas.html --out audit --scenario i18n`，
输出一份 JSON 轨迹加一张截图，并报告控制台错误。场景有 `i18n`（语言往返与残留审计）、`term`（字体可用性、字号、Ctrl+滚轮、隐藏时生效）、`roundtrip` 和 `reset`。
`tools/extract-i18n-keys.py` 会从 `index.html` 与各分片重新生成 `app.lang.js` 的候选键表。

## 版本号

`app.core.js` 里的 `const VERSION` 是应用唯一会读取的版本号：它决定 ☰ **关于** 的标签、弹窗标题与当前版本一行、`serialweb:version-modal-seen` 记录，以及写入 prefs 的 `appVersion` 字段。由于 `syncVersionDisplay()` 在启动时就会覆盖这些文案，它们在标记里被刻意留成中性的（`关于`、`SerialCanvas`、`—`）——不要把数字填回去。仍有两处带着字面版本，因为它们必须在任何脚本运行之前就正确：`index.html` 里的 更新日志 块，以及文档。

本仓库从 `v0.1.0` 开始打标签，其下的条目保留它们发布时沿用的上游 `1.x` 编号——所以更新日志读起来是 `0.2.0, 0.1.0, 1.5, 1.4, …`。此后一律使用 `vMAJOR.MINOR.PATCH`，标签就是 `VERSION` 加一个 `v` 前缀。

`package.json` 与 `package-lock.json` 里的版本号与它保持一致，只为让 CI 的 `npm ci` 不报警；没有任何代码读取那一份，它存在的意义只是锁定 esbuild 这个开发依赖。

## 发布新版本

先把更新内容写进 [CHANGELOG.md](../CHANGELOG.md) 的 `## Unreleased` 与 [CHANGELOG.md](CHANGELOG.md) 的 `## 未发布`——两份逐条对应、条目数相同——然后：

```sh
python tools/set-version.py 0.2.0 --date 2026/10/1 --dry-run
python tools/set-version.py 0.2.0 --date 2026/10/1
python build-release.py
git commit -a -m "chore(release): v0.2.0" && git tag v0.2.0
```

`set-version.py` 会同时提升两处更新日志小标题，重写 `const VERSION`，重写 `package.json` 与
`package-lock.json` 的版本字段，插入新的弹窗 更新日志 块（只保留最新的 `--keep 5` 段），依据英文更新日志把新块的标题与每一条英文译文写进 `app.lang.js`，并更新 [README.md](README.md) 的当前版本一行与 [data-formats.md](data-formats.md) 的 `appVersion` 示例。它不提交任何东西，请审阅 diff。弹窗里的每一行本身就是字典的键，手改 `index.html` 会让英文界面显示中文——这个脚本正是让英文更新日志与弹窗保持同步的手段。之后 `build-release.py` 在三处版本不一致时拒绝构建，于是漏掉一步表现为构建失败，而不是交付一个版本号过期的弹窗。

## 发布到 GitHub Pages

`.github/workflows/pages.yml` 在 Python 3.12 与 Node 22 上运行 `build-release.py`，把
`dist/SerialCanvas.html` 复制成 `dist/index.html`，将 `dist/` 作为 Pages 产物上传，再由 `deploy`
作业发布到 <https://ra9fael.github.io/SerialCanvas/>。也就是说线上站点永远是那个提交构建出来的产物：
不手工上传文件，`dist/` 也不进版本库。版本校验在最前面，所以版本漂移会让构建失败，而不是发布一个
版本号过期的弹窗。

新仓库的 Pages 来源默认是 `main:/`，因此需要一次性改成工作流：

```sh
gh api -X POST repos/ra9fael/SerialCanvas/pages -f build_type=workflow
gh api repos/ra9fael/SerialCanvas/pages --jq .build_type   # -> workflow
```

此后每次推送到 `main`（或手动运行该工作流）都会重新部署。锁文件里的 esbuild 解析自一个镜像源；
那次安装失败时工作流会退回 `registry.npmjs.org`，而如果 esbuild 完全缺失，构建仍会给出一个可用
（只是未压缩）的文件。

线上页面不会发出统计请求：`trackSerialCanvasView()` 只在主机名是 `conductance-lab.xyz`（原作者的主机）
时才提交页面访问计数，因此 Pages 部署和本地的 `http://localhost` 都不会去访问它。

## 发布检查清单

1. 把更新内容写进两份更新日志的 `Unreleased` / `未发布`，再按[发布新版本](#发布新版本)切出版本号。不要手工修改 `VERSION` 或弹窗文案。
2. 对 `dist/SerialCanvas.html` 做冒烟测试：控制台干净、两种语言都正常，☰ **关于** 弹窗显示新的版本号。
3. 推送 `main` 和标签，[Pages 工作流](#发布到-github-pages)会用这个提交重新构建并部署
   <https://ra9fael.github.io/SerialCanvas/>。离线的 **下载离线版到本地** 链接和 `ONLINE_VERSION_URL`
   是静态的——不存在更新源，因此只在页面加载时才做版本检查。
4. 检查线上页面：控制台干净、版本标签正确，☰ → 关于 在两种语言里都显示新的更新块。

## 文档

文档位于 `docs/`，英文在根目录，并在 `docs/zh-CN/` 下以完全相同的文件名做中文镜像。两棵树要保持同步：新增一节应当同时出现在两边；上面的锚点被其他文件链接引用，因此重命名标题就意味着要更新指向它的链接。界面已支持中英双语（☰ 菜单里的 中文 / English / 跟随系统），因此英文文档仍把每个标签写作 `English (中文)`。英文词条集中在 `app.lang.js`，以中文原文作为键（缺少词条时退回中文，不会显示键名）；引擎是 `app.core.js` 里的 `t()` / `translateDom()` / `setLocale()`，以及 `app.main.js` 里的 `renderTranslatedViews()`——切换语言后由它重绘所有可能带标签的视图。

`python tools/docs-check.py` 会检查这棵树：每个相对链接与标题锚点都能落到实处，并且每一篇英文文档
在 `docs/zh-CN/` 都有标题层级数一致的镜像。移动或重命名标题之后要跑一次。项目的身份信息一旦变化，
需要一起改的是[来源与致谢](acknowledgements.md)（分叉点、本分叉新增内容、许可证）和 `index.html` 里的关于弹窗——
弹窗是同一批事实的压缩版本。
