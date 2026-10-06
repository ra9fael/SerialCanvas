# 后续：终端配色 bug、圆角控件、布局与快捷键

> 本文为[英文版](../modernist-ui-followup.md)的中文镜像，逐节对应；如有出入以英文版为准。

`docs/modernist-ui-plan.md` 的配套文档。写于 Phase 1（`53f7d0a`）落地
`feat/modernist-ui` 之后。

三项内容，按优先级：一个已发布的真实 bug、一个承诺过但从未接线的功能、一个设计问题。

---

## 1. 终端前景色不跟随主题（bug）—— 已在 `eeb3b31` 修复

修复前后实测：

| 主题 | `--bg-terminal` | 前景色 | 对比度 | WCAG AA |
| --- | --- | --- | --- | --- |
| 浅色（修复前） | `#1b1918` | `rgb(32, 30, 29)` | **1.06** | 失败 |
| 浅色（修复后） | `#1b1918` | `rgb(244, 241, 239)` | **15.58** | 通过 |
| 深色 | `#121110` | `rgb(244, 241, 239)` | 16.77 | 通过 |

### 症状

浅色模式下终端不可读。

### 根因

`getTerminalTheme()`（`app.terminal.js:57`）为终端前景色读取了**页面**的前景令牌：

```js
background: read('--bg-terminal', '#101216'),
foreground: read('--text',        '#e8e8ea'),   // <-- 页面文字色
```

这在 Phase 1 之前只是**碰巧**正确。老的浅色主题里 `--bg-terminal: #f6f6f7`（浅）
配 `--text: #3c3c43`（深）——浅色终端配深色文字，对比度 8.9。老的深色主题里
`--bg-terminal: #161618`（深）配 `--text: #dfdfd6`（浅）——同样正确。

新调色板让 `--bg-terminal` 在**两个主题下都是深色**（浅色 `#1b1918` / 深色
`#121110`），这对串口控制台是正确的。但 `--text` 仍会翻转：浅色下是 `#201e1d`，
深色下是 `#f4f1ef`。于是浅色模式变成深色前景配深色背景。

这是 Phase 1 引入的回归，也正是方案在 §3.4 中点名的风险：颜色归 JS 管还是归 CSS 管。

### 已应用的修法

终端拿到了自己的色板，不再借用页面的：

```css
:root {
  --bg-terminal: #1b1918;
  --terminal-text: #f4f1ef;        /* 新增 —— 始终为浅色 */
  --terminal-cursor: #ff9783;
  --terminal-selection: rgba(255, 151, 131, 0.28);
}
```

在 `:root` 中声明一次，**刻意不在** `.theme-dark` 下重复——控制台在两个主题下都是固定的
深色面，所以它的色板与主题无关。深色块里有一句注释说明此事，以防将来有人覆盖它而重新引入
该 bug。

六个显式的 `TERMINAL_SKINS` 条目自带字面值，永远走不到 `read()` 路径，因此不受影响。

### 已验证

| 主题 | 前景 | 背景 | 对比度 |
| --- | --- | --- | --- |
| 浅色 | `rgb(244, 241, 239)` | `rgb(27, 25, 24)` | **15.58** ✅ |
| 深色 | `rgb(244, 241, 239)` | `rgb(18, 17, 16)` | 16.77 ✅ |

---

## 2. 圆角控件 —— 已上线

Phase 1 交付了令牌层；现在 UI 已就位并通过端到端验证。

| 组成 | 位置 |
| --- | --- |
| 标记 | `index.html`，语言行之后的 `menu-corner-group` |
| `refs` | `app.core.js` —— `cornerGroup`、`cornerOpts` |
| 状态 | `state.cornerRadius`，按 `CORNER_SETTINGS` 校验 |
| 应用 | `applyCornerRadius()`，紧邻 `applyTheme()`；在 `<html>` 与 `<body>` 上设置 `data-corner` |
| 处理函数 | `handleCornerRadiusChange()` + `cycleCornerRadius()` |
| 持久化 | `cornerRadius`，出现在 `buildLocalPrefsSnapshot()` 与 `applyLocalPrefsSnapshot()` |
| 重置 | `buildDefaultUserConfigSnapshot()` 中新增 `cornerRadius: 'square'` |
| 首帧 | `bootstrap.js` 在 `__applySerialWebInitialBodyClasses()` 内设置 `data-corner` |
| i18n | `app.lang.js` 中的 `圆角：` / `直角` / `微圆` / `圆润` |

### 已验证

- 默认为 `square`；没有存储值的用户同样落到这里。
- 三个设置都能移动真实元素：`.panel` 0 / 7 / 14px，`.online-mode-chip` 0 / 499.5 / 999px。
- `.status-dot` 在每个设置下都是 `50%`。
- **首帧**：带着已保存的 `round` 刷新，立即渲染为 14px——没有一帧回弹到默认值。
- 持久化在两个方向上都经得起刷新。
- 通过应用自己的按钮清空设置后回到 `square`。
- 英文标签读作 `Corner:` / `Square` / `Soft` / `Round`。

### 验证过程中发现的两个 bug

1. **`buildDefaultUserConfigSnapshot()` 漏了 `cornerRadius`。** 因此"清空配置"会保留
   `state.cornerRadius` 的旧值，重置没有真的重置。已在 `theme`/`locale` 旁补上
   `cornerRadius: 'square'`。
2. **`.menu-corner-opt` 不在共享基础规则里。** 只有 `.is-active` 的颜色规则匹配，所以未激活的
   标签完全没有布局，激活标签在滑动指示器上不可见。已把它加进
   `.menu-theme-opt, .menu-lang-opt` 那个块。

### 同时修掉的：10 处过时的 `#eef2ff` 标签

激活标签颜色被硬编码为 `#eef2ff`——为旧靛蓝强调色挑的浅蓝。压在 `#ec3013` 上时低于 AA
阈值，所以 "System"、"Square" 以及激活的模式标签都几乎读不出来。现在十处统一用 `var(--bg)`，
在强调色上清晰可读。

有一处例外保留了独立规则：冻结状态下的 `.timeline-freeze-btn` 压在 `--accent-soft` 上，
而不是 `--accent`，所以它改用 `var(--accent)`。

### 关于顺序的说明

这个控件刻意没有在圆角令牌化（`0eb7118`）之前上线。当时只有 3 个调用点跟随
`--radius-scale`，拨动开关几乎不会改变任何东西——一个死控件。先做令牌化正是把 Phase 2
排在 Phase 5 的 UI 工作之前的全部意义。

---

## 3. 值得借鉴的布局与快捷键思路

### 3a. 布局 — 真正能迁移的部分

picotty 是三列机群控制台：`节点 │ 控制台 │ 活动`。SerialWeb 是两列仪器面板：
`配置 │ 解析+监视`。这是不同的产品，所以列数不是重点。能迁移的有四样：

| 思路 | 为什么适合 SerialWeb |
| --- | --- |
| **可折叠侧栏 + 键盘切换** | SerialWeb 已有 `layout-expanded` 与 `sidebar-collapsed`，但只能鼠标操作。加一个切换键能让宽/窄切换即时完成。 |
| **常驻的控制字节条** | picotty 把串口控制字节（CR/LF/TAB/ESC/Ctrl-C…）放在专门一行常驻可见，而不是藏在菜单里。SerialWeb 通过预设项发送这些。一个常驻条会优于背十六进制。 |
| **每行的状态点 + 相对时间戳** | picotty 内联渲染 `online · 3s ago`。SerialWeb 的时间线显示绝对时间戳；在状态标签上加一个相对时长很便宜，且更快回答"它还活着吗"。 |
| **随视口伸缩的侧栏列宽** | picotty 用 `clamp(228px, 20vw, 304px)`，控制台不会被挤压。SerialWeb 钉死在 `286px`（`style.css:1936`）。超宽屏值得采用。 |

**不**值得借鉴的：节点列表（SerialWeb 是单端口，不是机群）、hub/故障转移状态、
以及"导航即标签页"的模式（SerialWeb 的模式切换已经是品牌区里的分段控件了）。

### 3b. 快捷键 — picotty 实际只有三个

来自 `tmp/picotty/static/app.js`：

| 按键 | 动作 | 行号 |
| --- | --- | --- |
| `Esc` | 隐藏 tooltip | 118 |
| `Enter` | 发送串口输入行 | 832 |
| `Ctrl-C` / `Ctrl-D` / `Ctrl-Z` | 发送 `0x03` / `0x04` / `0x1a`，发送前先冲掉待发文本 | 1431–1437 |

再加上它本身的流式行为：可打印按键先累积，按**40 ms 防抖**冲刷
（`scheduleSerialFlush`，1411 行），于是快速打字变成每秒若干帧，而不是每字符一帧。
`Enter`/`Backspace`/`Esc` 立即冲刷，并与待发缓冲区保持原子。

### 3c. SerialWeb 已有的 — 不要重复实现

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 完整键盘透传 | `term.onData(handleTermData)`（`app.terminal.js:197`） | **优于 picotty 手写的捕获。** xterm 拥有键盘，所以功能键、方向键、`Ctrl-]` 全部无需自定义 handler 即可工作。 |
| 回显 / 透传分流 | `handleTermData()`（`app.terminal.js:246`） | `refs.termLocalEcho` 选择原始转发还是本地行编辑 |
| 行编辑 + 历史 | `terminalSession`、`navigateTermHistory()` | `Ctrl-U` 清空（`\x15`）、`Backspace` 删除、方向键走历史 |
| 单键预设发送 | `app.main.js:7266` |裸字母触发匹配的预设项，但仅在焦点不在输入框时 |

所以参考工程的串口键盘处理**已被取代**。照抄会是一次倒退。

### 3d. 建议的快捷键集合

仅做新增，全部与现有的一致：

| 按键 | 动作 | 理由 |
| --- | --- | --- |
| `Ctrl-\`` | 折叠左侧配置栏 | 达到 picotty 的侧栏切换目标，无需新增面板 |
| `Ctrl-Alt-C` | 切换圆角设置 | 让新开关可被发现；用组合键以避免冲突 |
| `?` | 打开快捷键表 | 见下|
| `Esc` | 关闭任何打开的浮层/菜单 | 版本模态框已处理；可推广 |

新增任何快捷键前的两条规则：

1. **绝不绑定裸字母。** `app.main.js:7266` 已经占用了裸字母做预设发送。裸键快捷键会悄无声息
   地破坏预设。
2. **先检查 `event.target`。** 现有处理器对 `INPUT` / `TEXTAREA` / `SELECT` /
   `contentEditable` 提前返回。每个新绑定都必须照做，否则在发送框里打字会触发命令。

### 3e. 快捷键表

picotty 真正好的一点是它的自定义 tooltip 携带一个**"Learn more"** 链接
（`app.js:64`–`132`，挂在 `<body>` 上的单例，委托的 `mouseover`，悬停意图延迟，溢出时翻到
上方）。SerialWeb 有 2 个 `help-icon` 元素和 15 个 `title=` 属性，用的是原生 tooltip 和一个
无法承载链接的 CSS `::after` 气泡。

借鉴这个单例模式是值得的，而且它天然是快捷键表的容身之处：一个列出所有绑定的模态框，用
`?` 打开。原生 `title=` 做不到这个，单例可以。

---

## 建议执行顺序

截至 `eeb3b31` / `0eb7118` 的状态：

1. ~~**修复终端前景色**~~ —— **完成**，`eeb3b31`。
2. ~~**Phase 2 圆角令牌化**~~ —— **完成**（圆角部分），`0eb7118`。阴影 / `rgba()` /
   渐变的清理仍未开始。
3. ~~**上线圆角控件**~~ —— **完成**。
4. **布局：视口伸缩侧栏**（3a，一行）与**状态标签相对时长**（3a，小）。与其它一切独立。
5. **快捷键表 + 组合键**（3d、3e）。新增面最大，优先级最低。

第 5 项排在最后是有意的：快捷键最容易悄悄破坏现有功能，而且等它们要导航的布局定下来之后
再做，价值最大。

### Phase 2 剩余工作

| 项 | 数量 | 说明 |
| --- | --- | --- |
| `box-shadow` | 87 | 只留给浮层：`.floating-menu`、模态背景、`.toast`、图表浮出面板 |
| `rgba()` | 198 | 转为令牌。**审计终端附近的那些** —— 有些半透明是有意义的，必须审慎保留 |
| `gradient()` | 23 | 改为纯色填充 |
| `backdrop-filter` | 4 | 其中两处已经是 `none` |