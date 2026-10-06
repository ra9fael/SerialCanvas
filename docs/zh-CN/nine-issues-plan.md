# 九个问题：诊断与方案

> 本文为[英文版](../nine-issues-plan.md)的中文镜像，逐节对应；如有出入以英文版为准。

写于 `024fb70` 之后的 `feat/modernist-ui` 分支。以下每一条结论都对照源码核实过，
不是推断。行号基于 `3c1734a` 及其之后的提交。

这九个问题分属三类，不能混在一起做：本分支引入的回归、参数归属错位、以及全新功能。
其中一项（布局重设计）明确被另一项（参数归属）阻塞。

---

## A 组 —— 本分支引入的回归（已完成，`6d9a61a`）

### A1. 手动收发文字看不清（问题 1）

**已确认。** 三个容器使用 `--bg-terminal` 底色（现在两个主题下都是深色），但**没有自己的
`color`**，于是继承页面前景色：

| 位置 | 行号 | 背景 | 文字色 |
| --- | --- | --- | --- |
| `.terminal` | 4031 | `var(--bg-terminal)` | 继承 `--text` |
| `.insight-pre` | 3422 | `var(--bg-terminal)` | 继承 `--text` |
| `.log-line .stamp` | 4086 | （在 `.terminal` 内） | 继承 `--text` |
| `.log-line .payload` | 4113 | （在 `.terminal` 内） | 继承 `--text` |

浅色模式下是 `rgb(32, 30, 29)` 文字配 `rgb(27, 25, 24)` 背景——与 `eeb3b31` 中为 xterm
路径测到的 1.06 对比度完全一致。

**这是我只修了一半的同一个回归。** `eeb3b31` 给 *xterm* 表面单独配了色板，但手动模式用的
DOM 日志表面漏掉了，因为它不走 `getTerminalTheme()`。

**修法。** 复用已加的令牌：

```css
.terminal { color: var(--terminal-text); }
.insight-pre { color: var(--terminal-text); }
.log-line .stamp { color: var(--terminal-dim); }
```

新增 `--terminal-dim` 供时间戳与方向标签使用——`--text-soft` 是页面色，落在深色底上会是
中间灰。各方向的颜色（`.rx .dir` 用 `--signal` 等）在深色底上读感正常，无需改动。

验证必须**专门覆盖手动模式**，而不只是终端标签页。问题就出在这里：上次的检查切到了
终端视图。

### A2. 圆角高亮块不移动（问题 3）

**已确认。** `applyCornerRadius()` 只切`is-active`，从未切定位滑动指示器的 `pos-*` 类：

```js
// app.core.js — applyCornerRadius()
refs.cornerOpts.forEach(function(opt) {
  opt.classList.toggle('is-active', opt.dataset.corner === value);
});
// 没有 pos-light / pos-dark / pos-second / pos-third
```

主题开关两个都切（`app.core.js:1549`）：`pos-light` 对应第二格，`pos-dark` 对应第三格。
语言开关用 `pos-second` / `pos-third`。所以指示器永远停在第一格。

**修法。** 照搬主题的模式：

```js
refs.cornerGroup.classList.remove('pos-light', 'pos-dark');
if (value === 'soft') refs.cornerGroup.classList.add('pos-light');
else if (value === 'round') refs.cornerGroup.classList.add('pos-dark');
```

`pos-light` / `pos-dark` 只是"第二格""第三格"的名字，复用它们就不必新增 CSS。
名字难看，但这是既有词汇。

---

## B 组 —— 设计错位（B1 已完成，`fb8ab3a`）

### B1. 参数归属（问题 4）—— 已完成于 `fb8ab3a`

**同意，这是九项中最实质的一项。** 左栏叫"设备连接管理"，却塞了这些：

| 控件 | 行号 | 实际归属 |
| --- | --- | --- |
| 字符编码（`text-encoding`） | 280 | 手动模式 TX/RX 编解码 |
| 换行符设置（`newline-mode`） | 289 | 手动 TX 追加 + 终端发送 |
| 十六进制接收（`rx-ascii`及同级） | 约 300s | RX 显示 |
| 显示时间（`append-timestamp`） | 312 | RX 显示 |
| 结尾换行（`append-newline`） | 318 | TX 追加 |

真正属于这里的只有连接参数：波特率、数据位、停止位、校验、流控、DTR/RTS/BREAK、
自动重连。

正确的拆分沿用 `state.settings` 里已有的 `rxDisplayMode` / `sendMode` 分离：

- **连接栏** —— 只放物理层。
- **手动模式面板** —— 编码、换行、HEX/文本、时间戳。这些已经在门控
  `normalizeSendOptions()`（`app.core.js:967`）与 RX 路径。
- **终端模式面板** —— 换行符（终端有自己的 `getTermLineEnding()`，
  `app.terminal.js:232`）、字体、字号、主题、scrollback。

注意 `newline-mode` 目前被两边共用：手动 TX 和 `getTermLineEnding()` 读的是同一个
`#newline-mode` 元素。拆分意味着要么两个控件，要么一个被两边共读。**建议两个**——
取值不同，getty 要 `\r\n`，一般串口设备要 `\n`。

`state.settings` 的键名不变，只改 DOM 位置与标签。持久化和配置导入导出**不需要改**，
因为它们快照的是 `state.settings` 而非 DOM。

### B2. 统一字号并支持预设下拉（问题 2）

**已确认不一致。** 目前存在三个各自为政的字号：

| 位置 | 字号 | 来源 |
| --- | --- | --- |
| xterm 终端 | `refs.termFontSize`，8–48 | `<input type="number">`，459 行 |
| `.terminal`（手动日志） | 硬编码 `12px` | 4038 行 |
| `.insight-pre` | 硬编码 `12px` | 3428 行 |

没有共享的尺度令牌，且字号控件是自由输入的数字框而非预设列表。

**修法。**

1. 加一个尺度令牌，让终端与日志共用：`--mono-size: 12px`（终端默认）、
   `--log-size: 12px`。**保持两个令牌**——需要放大终端做设备调试的用户，通常不希望
   解析结果面板也跟着变大。
2. 把数字输入换成预设 `<select>`：10 / 11 / 12 / 14 / 16 / 18 / 20 px。
   改之前允许自定义字号，纯 `<select>` 会丢掉这个能力。**建议保留预设，但加一个
   "自定义"选项**来显示数字输入框，什么都不损失。
3. 把选定字号同时应用到 `.terminal` 与 `.insight-pre`，三个表面共用一个设置。

`getTerminalFontSize()`（`app.terminal.js:98`）钳制在 8–48；自定义路径保留该范围。

### B3. 布局重设计（问题 9）—— 被 B1 阻塞

**刻意放在最后。** 一旦参数搬出左栏，那一栏只剩约 9 个连接控件，整个左列会大幅收缩。
在那之前做布局，等于做两遍。

当前结构实际是（`index.html`）：

```
.app-shell（grid：topbar / workspace）
  .workspace（grid：var(--rail-w) 1fr）
    .left-column  → 设备连接管理 + 解析协议设置
    .right-column → 串口监视器（+ 定时/触发/预设发送）
  .expanded-left-top → 添加图框 / charts-panel
```

三条应当驱动重设计的观察，而不是凭空画图：

1. 左列承担**两种不同职责**：连接设置与协议配置。二者不相关，且都很长。
2. `charts-panel` 在 `.workspace` **之外**（`index.html:383`），是两列的兄弟而非子元素——
   这就是布局难以直接用 grid 梳理的原因。
3. `--rail-w` 已经是流式的（来自 `dcde5b3`），重设计应复用它而不是另起一套宽度系统。

方向在 B1 落地之后再定，不提前。

---

## C 组 —— 全新功能

### C1. 终端快捷键条（问题 5）

picotty 有 `serialKeydown()`（`app.js:1429`），覆盖 Enter、Backspace、Tab、Esc、
`Ctrl-C` / `D` / `Z`，外加 40 ms 冲刷防抖。

SerialWeb 已经更好：`term.onData(handleTermData)`（`app.terminal.js:197`）让所有按键
由 xterm 原生接管，功能键和方向键在**终端内**已经可用。缺的是**可发现的按钮**——
你得先知道这些键存在。

**建议的按键条**（终端模式底部、输入行之前）：

| 分组 | 按键 |
| --- | --- |
| 导航 | `←` `→` `↑` `↓` `Home` `End` `PgUp` `PgDn` |
| 编辑 | `Backspace` `Delete` `Ctrl-U` `Ctrl-W` `Ctrl-K` |
| 控制 | `Ctrl-C`（0x03）`Ctrl-D`（0x04）`Ctrl-Z`（0x1a）`Esc`（0x1b）`Tab`（0x09） |
| 召回 | 上下键遍历 `terminalSession.history` |

每个按钮发送与 xterm 会产生的相同字节，所以行为不会分叉。它直接调用
`sendTerminalBytes()`，而不是合成按键事件——真实按钮不能依赖焦点在终端里。

picotty 真正有用的细节是**可打印字符的 40 ms 冲刷防抖**（`app.js:1411`）：快速打字变成
每秒若干帧，而不是每字符一帧。xterm 的 `onData` 每键触发一次，所以粘贴 500 字符目前是
500 次写入。无论做不做按钮都值得加。

### C2. 导出 + 缓冲区可调（问题 6）

**三个子项全部缺失或硬编码：**

| 项 | 当前状态 |
| --- | --- |
| xterm scrollback | `scrollback: 5000`，硬编码（`app.terminal.js:193`） |
| 实时事件缓冲 | `MAX_LIVE_EVENT_TOTAL_CHARS = 8192`，硬编码（`app.core.js:25`） |
| 导出 | 终端与日志输出**都没有**任何导出按钮 |

**导出。** 在终端工具栏旁加 `导出` 按钮，把缓冲区写成 `.txt`（可带时间戳前缀）或
`.cast`（asciicast，picotty 能内联回放）。先做 `.txt`——一个 Blob 加一个下载链接；
`.cast` 需要本代码库里不存在的时序元数据写入器。

**缓冲区 —— 尺寸来自实测，不是猜测。**

`renderMonitor()`（`app.main.js:1798`）用
`refs.terminal.innerHTML = parts.join('')`（`app.main.js:1863`）**重建整个日志 DOM**，
所以 DOM 节点数与重建成本都随缓冲区线性增长。`scheduleRefresh()` 已经用
`requestAnimationFrame` 合并到每帧一次，但那限制的是**频率**，不是**单次成本**。

用 `audit/measure-buffer.mjs` 实测——五次重建取中位数，采用真实的 62 字符 RX 行：

| 缓冲（字符） | 行数 | DOM 节点 | `innerHTML` 重建 | 判定 |
| --- | --- | --- | --- | --- |
| 8 192（现状） | 132 | 528 | 0.2 ms | 余量充足 |
| 131 072 | 2 114 | 8 456 | 3.1 ms | 可以 |
| 262 144 | 4 228 | 16 912 | 7.0 ms | 可以 |
| 524 288 | 8 456 | 33 824 | 13.3 ms | 已到帧预算边缘 |
| 1 048 576 | 16 913 | 67 652 | 26.6 ms | 丢帧 |

60Hz 下一帧是 16.7ms，重建必须装进一帧之内。

**所以"尽量大而不卡顿"收敛到一个具体数字：512K 字符是上限，256K 是仍有真实余量的最大值。**
现在的 8K 比渲染成本所要求的保守得多——可以放大32 倍。

选项都持久化在 `terminalFontSize` 旁边：

- **实时日志缓冲** —— `64K / 256K / 512K` 字符。**默认值从 8K 改为 256K。**
  512K 选项附注说明它接近帧预算，让代价是**被声明的**而不是被发现的。
- **xterm scrollback** —— `5 000 / 20 000 / 100 000` 行。xterm 自己的缓冲区远比 DOM 日志
  便宜（只有文本节点，改scrollback 不触发重绘），所以可以更大。默认从 5 000 改为 20 000。

`trimLiveEvents()`（`app.core.js:582`）需要改为读设置而不是
`MAX_LIVE_EVENT_TOTAL_CHARS`，新值在下一次追加时生效。

保留**字符**预算模型而非改成行数：行宽差异达一个数量级，行数预算在二进制转储和短文本回复
之间行为会截然不同。

**若日后需要大得多的缓冲**，正解是改用增量 DOM 追加而不是 `innerHTML` 重建——
`renderMonitor()` 本来就知道只追加的情况，因为 RX 永远只在末尾增加。那项改动能把上限提升
约一个数量级，但属于真正的重构，而达到 512K 并不需要它。

### C3. 协议模拟演示（问题 8）

**完全不存在**——在全应用范围 grep `simulat|模拟|mock|demo` 无结果。picotty 的 DEMO 模式
会播种假节点并能模拟 OTA 刷写。

这是价值最高、也最大的一项。SerialWeb 的演示会比 picotty 的更有用，因为解析才是有意思的
部分。

**范围，最小可用版本：**

- 解析面板里一个 `模拟数据` 开关，默认关，持久化。
- 开启且未打开串口时，RX 由本地生成而非从设备读取：一个 `setInterval` 走一段脚本化
  协议，把字节喂给 `queueRxBytes()`——**与真实数据同一个 RX 入口。**
- 一段内置脚本匹配文档里的文本语法（`/name0=… /int0 /float0`），另一段匹配二进制结构，
  这样两种解析模式都能演示。
- 模拟期间的 TX 接受输入且不报错。

走 `queueRxBytes()` 很关键：这意味着模拟会完整走一遍分行、解析、图表和录制，与真实流量
一致，而不是一条可能漂移的平行代码路径。

**不要**做 picotty demo 里的 OTA / 固件那部分。它是 Pico 专有的，在这里没有意义。

---

## 问题 7 —— 还有哪些值得借鉴

对照现有实现逐一评估：

| 想法 | 结论 |
| --- | --- |
| **自定义 tooltip 单例** | **值得做。** `app.js:64`–`132`。SerialWeb 只有 2 个 `help-icon` 和 15 个 `title=` 属性。原生 `title=` 无法承载链接，现有的 CSS `::after` 气泡也不能。单例可以带"了解更多"链接，并且天然是快捷键表的容身之处。它还能零成本地提升 C1 和 B2 的可发现性。 |
| **提示 / 目标状态徽章** | 跳过。picotty 的徽章回答"节点是否活着/目标机器是否在线"——机群概念。SerialWeb 只有一个端口，状态标签已经承担了这个职责。 |
| **离线发送队列** | 值得考虑。若 C3 落地，队列能让你在模拟或真实设备重连期间继续输入命令。依赖 C3。 |
| **会话回放（asciicast）** | 推迟。与 C2 的 `.cast` 那一半配套；单独都无用。 |
| **宏 / runbook 系统** | 跳过。SerialWeb 的预设发送已覆盖单次发送场景；runbook 是一层 YAML 编排，SerialWeb 用不上。 |
| **固件 OTA** | 跳过。Pico 专有。 |
| **控制字节条** | 由 C1 覆盖。 |

所以：**tooltip 单例是唯一明确的收益项。** 其余要么与现有功能重复，要么不适用于单端口工具。

---

## 执行顺序

**A 组已完成** —— `6d9a61a`。

1. ~~**A1** 终端文字~~ —— **完成**，`6d9a61a`。手动模式 15.58 / 7.97。
2. ~~**A2** 圆角指示器~~ —— **完成**，`6d9a61a`。指示器位于 0 / 72.6 / 145.3 px。
3. ~~**B1** 参数归属~~ —— **完成**，`fb8ab3a`。解锁 B3。
4. **B2** 字号尺度 + 预设。
5. **C3** 协议模拟 —— 固定内置脚本，价值最高。
6. **C1** 快捷键条 + 粘贴防抖。
7. **C2** 导出 + 缓冲设置。
8. **问题 7** tooltip 单例。
9. **B3** 布局重设计 —— 按约定，**等参数搬完之后**。

## 已定决策

| 问题 | 决策 |
| --- | --- |
| 缓冲尺寸 | **在实测允许的范围内尽量大。** 实时缓冲默认 8K → **256K**，上限 512K（帧预算）。xterm scrollback 5 000 → **20 000**，最大 100 000。数字来自 `audit/measure-buffer.mjs` 实测，非猜测。 |
| 字号预设 | **两者都留。** 预设`<select>` 加一个"自定义"选项来显示现有数字输入框，自由输入不丢。 |
| `newline-mode` | **两个控件 —— 本来就是。** `#newline-mode` 服务手动模式，`#term-newline` 服务 tty/终端。见下方更正：它们从未共用过。 |
| 模拟 | **固定内置脚本。** 本轮不做用户可编辑的协议输入框。 |
| 布局 | **B1 之后。** 现在做等于做两遍。 |

### 更正：两个换行控件本来就是分开的

本方案原先声称它们共用一个元素，拆分会"修掉一个潜在怪异"。**那是错的**，
在实现 B1 时发现：

- `#term-newline` 早已存在于 `index.html:434`，在 `#term-toolbar-controls` 里。
- 它早已被绑定（`app.core.js:236`），早已持久化
  （`layout.terminalNewline`，`app.main.js:6320`）。
- `getTermLineEnding()`（`app.terminal.js:235`）读 `refs.termNewline`；
  `normalizeSendOptions()` 读 `state.settings.newlineMode`，后者来自
  `#newline-mode`（`app.core.js:1481`）。

所以既没有什么可拆，也没有潜在 bug。B1 只是把 `#newline-mode` 搬到了手动工具栏。
搬移后已实测两者独立：`settings.newlineMode = n` 而 `layout.terminalNewline = r`，
两个 DOM 输入框各保持自己的值。

教训与 A1 相同：**断言缺陷前先读代码。** 本方案没有 grep 第二个元素就断言共用，
而这个说法因为"听起来合理"躲过了评审。

### B1 的实际交付（`fb8ab3a`）

编码、换行、HEX 收发、时间戳、结尾补换行从连接栏移到监视器面板内的
`#manual-toolbar-controls`，仅在手动视图显示。纯标记改动：所有控件都通过 `refs`
访问，`state.settings` 键名未变。

左栏现在只放物理层控件。两处值得记住：

- 既有隐藏规则 `.monitor-panel:not(.view-terminal) .term-toolbar-controls`
  必须收窄到 `#term-toolbar-controls`。它也匹配了新的手动工具栏，导致手动视图被清空。
- `.monitor-toolbar` 是 `nowrap`，而六个控件加上模式切换在 1440px 放不下——最后一个
  会换行并让整行显得参差。通过缩短标签、收紧间距解决，低于 1240px 时文字标签隐藏而
  勾选项标签保留（裸勾选框无法辨认）。

`#advanced-panel` 整个删除：`setAdvancedPanel()` 只移除一个没人设置的 `hidden` 类，
其 `refs` 条目会对 null 抛错。