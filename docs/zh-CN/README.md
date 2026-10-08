# SerialCanvas

SerialCanvas 是一款基于 Web Serial API 的浏览器串口调试与数据绘图工具。它交付为
**单个 HTML 文件**，没有服务器、不需要安装、不依赖 CDN，因此可以从本地磁盘、U 盘或网页里
直接运行。

它把通常要四个工具才能完成的事合到了一起：

- **串口监视器** —— 带时间戳的原始 RX/TX 日志、十六进制视图，以及基于 xterm 的交互式终端。
- **结构化解析** —— 把每一行接收数据转换为具名通道，可用文本模板（`/name0=/float0`），
  也可用字节级的十六进制帧结构表。
- **实时图表** —— 时域图、频域图（FFT）与柱状图，绑定到解析出的通道。
- **时间线录制** —— 把一次会话录制为原始字节，冻结实时视图，拖动与回放已归档的抓取，
  并以 `.bin` / `.csv` / `.txt` 导出导入。

当前版本：**v0.4.2**。本分叉的主页：
<https://ra9fael.github.io/SerialCanvas/> ·
<https://github.com/ra9fael/SerialCanvas>

SerialCanvas 的前身是[电导实验室（Conductance-lab）](https://conductance-lab.xyz)的
<https://github.com/Conductance-lab/SerialWeb>（基线取到上游 `v1.6`），此后独立发展——已不再是 fork。
界面设计另借鉴了 [PICOTTY](https://github.com/morpheuslord/PICOTTY)。详情见[来源与致谢](acknowledgements.md)。

> 界面支持中英双语：在 ☰ 系统菜单里选择 **中文 / English / 跟随系统**，首次打开时跟随浏览器语言。
> 本套中文文档里的界面控件一律按屏幕上的实际文字书写。英文文档与本套中文文档逐文件对应：[../README.md](../README.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [快速开始](README.md#快速开始) | 运行要求、启动应用、首次连接 |
| [用户指南](user-guide.md) | 连接管理、监视器、终端、发送方式、时间线、布局、快捷键、故障排查 |
| [解析器参考](parser.md) | 文本规则语法、十六进制帧结构表、实时结果、自动识别 |
| [图表参考](charts.md) | 图表类型、通道绑定、缩放与平移、FFT 计算、保留上限 |
| [数据格式](data-formats.md) | `localStorage` 键、配置快照结构、时间线 BIN/TXT/CSV 布局、解析结果导出 |
| [开发指南](development.md) | 仓库结构、共享闭包约束、构建脚本、发布 |
| [更新日志](CHANGELOG.md) | 各版本更新说明 |
| [来源与致谢](acknowledgements.md) | 原始项目、UI 借鉴（SerialWeb、PICOTTY）、许可证 |

## 运行要求

Web Serial 只在**安全上下文**中可用，而且目前只有 Chromium 系浏览器实现了它。

| | 支持情况 |
| --- | --- |
| 浏览器 | Chrome 或 Edge（较新版本）。Firefox 和 Safari 未实现 `navigator.serial` —— 应用仍能加载，但会显示 `不支持 Web Serial API`。 |
| 地址 | `https://…`，或 `http://localhost` / `127.0.0.1`。普通 `http://<lan-ip>` 无法使用该 API。 |
| 操作系统 | Windows / macOS / Linux，浏览器本身支持的系统即可。浏览器接管端口不需要驱动，但设备必须提供串口（`CDC-ACM` 一类）接口。 |
| 权限 | 无需。端口由浏览器从操作系统取得。 |
| 存储 | 设置保存在 `localStorage`；导入配置时应用还会读取剪贴板。 |

用 `file://` 直接打开 `dist/SerialCanvas.html` 可以正常使用界面，但浏览器不会在 `file://`
页面授予串口权限——需要连接设备时，请按下面的方式提供 HTTP 服务。

## 快速开始

**1 —— 使用在线版本（最省事）。** 打开
<https://ra9fael.github.io/SerialCanvas/> —— 本仓库由 GitHub Actions 发布的单文件构建。
[上游原作者的构建](https://conductance-lab.xyz/SerialWeb/) 是另一个程序，版本号各自独立。

**2 —— 或在本地运行单文件构建。**

```sh
python build-release.py            # -> dist/SerialCanvas.html
```

取出自包含的 `dist/SerialCanvas.html`，然后直接双击打开（只能用界面，无法访问串口），
或者把整个目录提供服务：

```sh
python -m http.server 8000         # -> http://localhost:8000/dist/SerialCanvas.html
```

**3 —— 或从源码运行。** 仓库就是一组普通静态文件，任何静态服务器都能用。
在项目根目录提供服务并打开 `index.html`：

```sh
python -m http.server 8000         # -> http://localhost:8000/
```

源码模式通过 `fetch()` 加载 `app.core.js`、`app.terminal.js` 和 `app.main.js`，
因此 `file://` 会被拒绝，并显示一个指向单文件构建的提示层
（[详见](development.md#为什么源码模式需要-http)）。

**4 —— 连接设备。**

1. 插上开发板；关闭其他占用端口的程序（串口监视工具、PuTTY、IDE）。
2. 在 **设备连接管理** 中点击 **连接设备**，在浏览器弹窗中选择端口。每个新端口只会弹出
   一次 USB 授权对话框，浏览器会记住这次授权。
3. 设置 **波特率** —— 识别成功后顶栏会显示 `VID`/`PID`。左上角的状态胶囊显示
   **串口已连接**。
4. 在 **发送** 框里输入内容，点击 **立即发送**；或者把监视器切到 **终端** 直接输入。

## 下一步

- 设备打印 `temperature=42.5 humidity=31`，你想把它画成图 →
  [解析器参考](parser.md#文本规则)，然后看 [图表](charts.md)。
- 想做脚本化的请求/应答交互 → [发送方式](user-guide.md#发送)。
- 想把一次抓取交给同事 → [时间线导出格式](data-formats.md#时间线文件)。
- 有哪里不对劲 → [故障排查](user-guide.md#故障排查)。

## 离线副本

系统菜单（右上角的 ☰）里有 **下载离线版到本地**。通过 HTTP 访问时，应用会重新抓取自身
资源，交给你一个自包含的 HTML 文件，与 `dist/SerialCanvas.html` 等价。在 `file://` 副本中
该功能不可用。

## 反馈

- 源码、issue 与功能需求：<https://github.com/ra9fael/SerialCanvas>
- 手册：就是本套文档 —— 应用的 ☰ 菜单与关于弹窗也链接到这里。

## 原始项目

SerialCanvas 从 SerialWeb 出发、此后独立发展，沿革与许可证见[来源与致谢](acknowledgements.md)。
原始项目在 <https://github.com/Conductance-lab/SerialWeb>。
