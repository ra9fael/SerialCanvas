# 现代主义 UI 迁移方案

> 本文为[英文版](../modernist-ui-plan.md)的中文镜像，逐节对应；如有出入以英文版为准。

分支：`feat/modernist-ui`（从 `main` 于 `3c1734a` 切出）。

把参考面板（picotty）的视觉语言迁入 SerialCanvas。

## 0. 已定决策

| 问题 | 决策 |
| --- | --- |
| 是否引入 Archivo？ | **不引入。** 保留 `Segoe UI / PingFang SC / Microsoft YaHei` 字体栈，只借参考工程的**排版处理**：字重800、`-0.015em` 字距、区块标签用全大写 letter-spacing。不下载任何字体，单文件发布体积不增长。 |
| 深色模式是否一并改？ | **是。** 两个主题在同一阶段内完成。深色改为暖调近黑色阶，而非当前的冷调 `#1b1b1f`。 |
| 圆角：固定归零，还是可配置？ | **可配置**，在系统菜单里做三档开关。详见第 5 节。默认归零（忠于picotty 的观感）。 |

放弃 Archivo 的后果：参考工程的气质通过字重、字号和分隔线传达，而非字体本身。对中文界面而言这本来也是正确的取舍——Archivo 本身不含汉字覆盖，标题无论如何都会回退到系统中文字体。

## 1. 参考工程到底是什么

picotty 前端只有三个文件，而且**样式不在 JavaScript 里**：

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `static/styles.css` | 234 | 整套设计系统：令牌 + 通用组件类 |
| `static/app.css` | 149 | 仅应用外壳：tooltip 单例、响应式重排 |
| `static/app.js` | 2699 | 应用逻辑。消费令牌，几乎不拥有样式 |

样式在 `styles.css` 里。`app.js` 大量使用 inline `style` 字符串，但这些字符串只引用 `var(--color-*)` 和 `var(--space-*)`——换掉令牌块，整个应用就换皮了。

三点定义了它的观感：

1. **圆角全为0。** `--radius-sm/md/lg`都是 `0px`。每个角都是方的。
2. **用 2px 实线划结构**，不用阴影。`--color-divider` 是
   `color-mix(in srgb, #201e1d 40%, transparent)`。仅 `app.js` 里就有 19 处
   `2px solid var(--color-divider)`。
3. **纯色不透明填充。** `--color-bg #f3f2f2`、`--color-surface #eae9e9`。
   没有 `backdrop-filter`，没有半透明面板，没有渐变。

再加一个强烈的排调性：`Archivo` 字重 800 作标题，10–11px 全大写 letter-spacing
作标签，单一暖红强调色（`#ec3013`）克制使用。

## 2. SerialCanvas 的差距

以下均基于当前 `main`（`3c1734a`）实测，非估算：

| 属性 | SerialCanvas 现状 | `style.css` 中数量 |
| --- | --- | --- |
| 圆角 | 8/10/12/14/16/18/20px、`999px`、`50%` | 112 处 `border-radius` |
| 药丸 / 圆形 | `999px` 用于chip、live bar、状态标签 | 18 |
| 阴影 | 几乎每个表面都有 `box-shadow` | 87 |
| 半透明填充 | `rgba(...)` 背景 | 197 |
| 渐变 | `linear-gradient(...)` | 23 |
| 毛玻璃 | `backdrop-filter` | 4 |
| 细线边框 | `1px solid var(--border)` | 74 |
| 深色覆盖 | `theme-dark` 选择器 | 49 |

`style.css` 顶部（1–64 行）的令牌层组织良好——`--bg`、`--text`、`--accent`、
`--radius`、`--shadow` 以及一个 `theme-dark` 块。这部分迁移很顺。**但那197 处硬编码
`rgba()` 填充和 87 处阴影不会**：它们不跟随令牌变化，必须先转成令牌，否则两套风格会
叠在一起互相打架。

颜色是最容易的部分。几何才是工作量。

## 3. 本仓库特有的约束

以下不可协商，且直接影响排序：

1. **单文件发布。** `build-release.py` 会内联 `style.css`，并断言没有遗留未内联的本地
   `src=`/`href=`（`build-release.py:157`）。任何新样式表必须注册进 `INLINE_ASSETS`
   （`build-release.py:35`），否则构建大声失败。任何字体必须以data URI 内联——运行时无网络。
2. **离线是特性。** `vendor/xterm/` 下的 xterm 之所以存在，正是因为没有 CDN。picotty 的
   `styles.css:4` 从 `fonts.googleapis.com` 拉取 Archivo——那一行不能原样搬过来。
3. **共享闭包。** `app.core.js` 开启 IIFE，`app.main.js` 关闭它，`app.terminal.js` 是中间片段。
   顶层名称必须在三个文件中全局唯一。不要 `import`/`export`。
4. **终端颜色归 JS 管。** `TERMINAL_SKINS`（`app.terminal.js:12`）和 `CHART_COLORS`
   （`app.core.js:39`）是 JS 里硬编码的十六进制数组，不是 CSS。漏掉它们的调色板改动会让
   图表和终端停留在旧配色，而面板已经变了。
5. **深色模式是一等功能**，带持久化用户偏好（`bootstrap.js`、`app.core.js:1464`–`1507`），
   并在 `<html>` 和 `<body>` 上都有 `theme-dark` 类。picotty 根本没有深色主题。丢掉深色模式
   是产品决策，不是实现细节。
6. **中英双语界面。** `app.lang.js` 在运行时翻译 `title`、`aria-label`、`data-tip` 等属性。
   中文是源语言。字号必须能容纳更长的中文串。

## 4. 建议路径 — 先令牌，后几何，分五阶段

排序很重要：每个阶段结束后应用都可启动、可评审；而把几何改造推后，意味着令牌变更能在
2000 行 CSS 变动落地之前单独看清效果。

### Phase 0 — 基线（无视觉变化）

- 用 `tools/cdp-check.mjs` 截取当前浅色与深色主题，作为后续每个阶段的对比参照。
- 把确切的 `CHART_COLORS` 和 `TERMINAL_SKINS` 值记进提交信息，让回归是 diff，而不是争论。

### Phase 1 — 令牌层（收益最高、风险最低）

把 `style.css` 1–64 行改写为 picotty 令牌集，用 SerialCanvas 自己的变量名表达，使文件其余部分
继续工作：

| SerialCanvas 令牌 | 新值 | 来源 |
| --- | --- | --- |
| `--bg` | `#f3f2f2` | `--color-bg` |
| `--bg-panel`、`--bg-panel-strong` | `#eae9e9` | `--color-surface` |
| `--bg-terminal` | `#1b1918` | picotty `.sc-term` 的 inline 颜色 |
| `--text` | `#201e1d` | `--color-text` |
| `--text-soft` | `#605d5d` | `--color-neutral-700` |
| `--accent` | `#ec3013` | `--color-accent` |
| `--accent-strong` | `#ae1800` | `--color-accent-700` |
| `--accent-soft` | `#ffe0d9` | `--color-accent-200` |
| `--border`、`--border-strong` | `rgba(32,30,29,.40)`、`rgba(32,30,29,.62)` | `--color-divider` 缩放 |
| `--radius`、`--radius-small` | 由 `--radius-scale` 驱动（见第 5 节） | `--radius-*` |
| `--shadow`、`--shadow-soft` | `none` | 取消 |

同时新增一套推导出的深色（picotty 没有，这是新工作）——暖调近黑，而非当前的冷调 `#1b1b1f`。

只有约 40 个 `var(--…)` 调用点会响应。预期它看起来**不对**但结构完整：直角、无阴影、暖色调。

### Phase 2 — 圆角令牌化与阴影清理（机械工作）

这是 diff 的主体，而且刻意枯燥。这一阶段的存在是为了让第 5 节的圆角设置成为可能——
**当前 112 处圆角声明都是硬编码像素值，所以在这一阶段把它们改写之前，设置项无处可驱。**

当前分布，实测：

| 值 | 数量 | 处置 |
| --- | --- | --- |
| `999px` | 18 | 药丸。**随** `--radius-scale` 缩放，下限为 0 |
| `14px` | 16 | → `--radius-md` |
| `10px` | 16 | → `--radius-sm` |
| `12px` | 12 | → `--radius-sm` |
| `18px` | 11 | → `--radius-lg` |
| `8px` | 7 | → `--radius-xs` |
| `16px` | 7 | → `--radius-lg` |
| `50%` | 6 | **绝不缩放。** 状态点与滑块拇指 |
| `0` | 6 | 已是直角 |
| `inherit` | 3 | 跟随父元素 |
| `7px` / `6px` / `2px` | 6 | → `--radius-xs` |
| `20px` | 1 | → `--radius-lg` |

然后：

- 阴影只留给浮层：`.floating-menu`、模态背景、`.toast`、图表浮出面板。其余一律 `none`。
- 把 197 处 `rgba()` 面板填充替换为新的不透明令牌。**这里是真正的风险点**——其中一些
  `rgba()` 是叠加在终端之上的、有意义的半透明，必须变成审慎决定的结果，而不是一刀切删掉。
- 移除 4 处 `backdrop-filter`（其中两处本来就是 `none`）。

### Phase 3 — 排版（不含字体文件）

- 保留系统字体栈：`--font-ui` 维持
  `"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`。
- 改为应用参考工程的*处理方式*而非字体本身：标题字重 800、字距 `-0.015em`、行高 `1.12`。
- 给面板标题和区块标签加上全大写 letter-spacing kicker（`10px`、`letter-spacing: .1em`、
  `text-transform: uppercase`、强调色）。主要目标是 `.panel-title`。这是最具辨识度的
  picotty 信号，且零成本。
- `.menu-theme-label` 已在用这套处理（`style.css:989`）——沿用它，而不是发明第二套。
- CJK 说明：中文串永远不会进入大写路径（`text-transform` 对汉字无效），所以 kicker 对拉丁/
  数字标签仍有意义，而中文面板标题保持正常大小写。

### Phase 4 — 结构线

把视觉层级从"阴影驱动"改为"分隔线驱动"：

- 面板头、topbar、区块边界上的 `1px solid var(--border)` → `2px solid var(--color-divider)`，
  即 picotty 的 `.nav` 与侧栏模式。
- 加粗 topbar 下边缘与时间线外壳。
- 内部控件边框保持 1px；到处都用 2px 会变成噪声。

### Phase 5 — JS 侧颜色、构建、文档

- 把 `CHART_COLORS`（`app.core.js:39`）调整为与暖调兼容、且仍能区分七个序列的分类色阶。
- 复核 `app.main.js` 中绕过 CSS 的六处 `ctx.strokeStyle` 字面量（约 4634–5299 行）——
  否则它们会保留旧的冷色调。
- 除非新的深色 `--bg-terminal` 破坏默认皮肤，否则不动 `TERMINAL_SKINS`。终端主题是另一套
  美学契约。
- 重新运行 `build-release.py` 并复核残留引用断言。预期无需改动 `INLINE_ASSETS`——令牌工作
  全部留在 `style.css` 内。
- 更新 `docs/development.md`（仓库结构一节）、`docs/user-guide.md` 及其 `zh-CN` 镜像。
  `tools/docs-check.py` 强制中英一致。
- 把圆角选项加入 `app.lang.js`（中文是源语言，新标签以中文撰写并以此为键）。

## 5. 圆角设置

直接回答那个问题：**可以，而且值得做——但只有在 Phase 2 之后才可能。** 当前 112 处圆角声明
都是硬编码像素，所以在那一阶段改写之前，设置项无处可驱。Phase 2 把它们改写成四个尺度
令牌；本节是它的消费方。

### 令牌形态

一个整数驱动全部，通过 `<html>` 上的 `data-corner`：

```css
:root {
  --radius-scale: 0;                    /* 默认：忠于 picotty 的观感 */
  --radius-xs: calc(2px  * var(--radius-scale));
  --radius-sm: calc(8px  * var(--radius-scale));
  --radius-md: calc(12px * var(--radius-scale));
  --radius-lg: calc(16px * var(--radius-scale));
  --radius-pill: calc(999px * var(--radius-scale));
  --radius-dot: 50%;                    /* 绝不缩放 —— 见下 */
}
:root[data-corner="soft"]  { --radius-scale: .5; }
:root[data-corner="round"] { --radius-scale: 1; }
```

`--radius-pill` 是乘数而非固定 `999px`，所以 scale 为 0 时药丸变方，scale 为 1 时回到
当前形状。一个旋钮，无需逐元素分支。

### 绝不能缩放的

`--radius-dot` 在任何设置下都保持 `50%`。那6 处 `50%` 是：

| 选择器 | 是什么 |
| --- | --- |
| `.status-dot` | 品牌区里的连接状态点 |
| `.status-dot::after` | 它的脉冲环 |
| `#timeline-slider::-webkit-slider-thumb` | 时间线拖动拇指 |
| `#timeline-slider::-moz-range-thumb` | 同上，Firefox |
| `.reconnect-chip .reconnect-dot` | 重连指示点 |

把状态点削成方块会毁掉状态语言——圆形读作"状态"，方形读作"装饰"。`.help-icon`
（`style.css:296` 附近）同理，圆形是它的意图。

`inherit` 的三处跟随父元素，不需要令牌。

### 持久化

沿用现有偏好通路，与 `theme`、`locale` 完全一致：

| 关注点 | 位置 |
| --- | --- |
| 存储位置 | `state.cornerRadius`，在 `buildLocalPrefsSnapshot()`（`app.main.js:6299`）中与 `theme`/`locale` 并列快照 |
| 应用方式 | `applyCornerRadius()`，仿照 `applyTheme()`（`app.core.js:1469`）—— 在 `<html>` 与 `<body>` 上设置 `data-corner`、切换 `is-active`、调用 `refitTerminal()` |
| 处理函数 | `handleCornerRadiusChange(value)`，仿照 `handleThemeChange()`（`app.core.js:1499`），末尾调用 `scheduleLocalPrefsSave()` |
| **首帧** | `bootstrap.js` 必须读取 `prefs.cornerRadius` 并在 `__applySerialCanvasInitialBodyClasses()` 内设置 `data-corner`，否则保存的值会闪一帧默认值——这正是 `__applySerialCanvasInitialBodyClasses()` 为主题色已解决的问题 |
| 清空/重置 | `clearSerialCanvasStoredUserData()`（`app.main.js:6415`）已清除整个偏好键，无需额外工作 |

`bootstrap.js` 是最容易忘的一处。主题类在那里设置，正是为了首帧正确；圆角属性需要同样处理。

### 标记与接线

三个档位，放在系统菜单（`index.html:93`），仿照现有的主题开关——同样的
`.menu-theme-line` / `.menu-theme-group` 结构，同样的滑动 `::before` 指示器，它本来就支持
三档布局：

```html
<div class="menu-theme-line">
  <span class="menu-theme-label">圆角：</span>
  <div id="menu-corner-group" class="menu-theme-group">
    <button class="menu-corner-opt is-active" data-corner="square">直角</button>
    <button class="menu-corner-opt" data-corner="soft">微圆</button>
    <button class="menu-corner-opt" data-corner="round">圆润</button>
  </div>
</div>
```

接线是 `attachEventListeners()`（`app.main.js:7240`）里三行，遵循 `themeOpts` 模式，
外加 `app.core.js:70` 里两条 `refs` 条目。

注意菜单很窄，已经有主题 / 语言 / 配置三行。加第四行在纵向没问题；标签沿用现有的大写
kicker 处理以保持一致。三个选项标签很短（2–3 个汉字），不会溢出滑动指示器。

### 默认值

`square`（scale 0）——忠于 picotty 的观感，也正是这次迁移的目的。`soft` 与 `round`
的存在，是为了让偏好柔和仪表盘质感的用户不必被一个审美意见排除在外。从 `main` 升级的用户
没有存储的 `cornerRadius`，因此会直接落到 `square`。

## 6. 排序与验证

`feat/modernist-ui` 上每个阶段一个提交，进入下一阶段前先验证：

```sh
python -m http.server 8000        # 源码模式需要 HTTP，fetch() 排除了 file://
python build-release.py           # 必须通过残留引用断言
node --check dist/SerialCanvas.html  # 单文件健全性
python tools/docs-check.py        # 文档变更时
```

真正重要的手工检查：

- 浅色**与**深色主题，`square` 与 `round` 都要看。
- **带已保存圆角刷新** —— 确认没有闪一帧默认值。这是 `bootstrap.js` 那条路径，也是最容易
  写错的地方。
- 状态点在每个设置下都仍是圆形。
- 浮出菜单、模态对话框、图表浮出面板、toast——Phase 2 保留阴影的那些浮层。
- 两种终端皮肤下各跑一次真实串口会话。
- 复制/粘贴配置往返，因为圆角加入了快照。

静态部分可以用 `tools/cdp-check.mjs` 覆盖。

## 7. 风险

| 风险 | 严重度 | 缓解 |
| --- | --- | --- |
| 已保存的圆角在刷新时闪一帧默认值 | 中 | `data-corner` 在 `bootstrap.js` 中设置，而不只是应用启动时 |
| scale 为 0 时状态点被削方 | 中 | `--radius-dot` 是独立令牌，绝不参与乘法；三个设置下都验证 |
| 一刀切移除 `rgba()` 破坏有意的半透明 | 中 | 审计那 197 处；终端附近必须保持审慎 |
| 某些 `border-radius` 站点漏改成令牌 | 低 | Phase 2 是全文件机械遍历；之后 `grep -c "border-radius: [0-9]"` 的像素值必须为 0 |
| `CHART_COLORS` 与 canvas 字面量失步 | 低 | Phase 5 明确列出那五处调用点 |
| 5540 行 CSS 意味着 diff 巨大、难以评审 | 低 | 阶段边界让每个提交都保持可评审 |
| 中文串在新字重/字距下看起来不对 | 低 | Phase 3 用真实中文串验证，不用 lorem |

## 8. 仍然待定

1. **终端默认皮肤**是否跟随新的深色 `--bg-terminal`？`TERMINAL_SKINS`
   （`app.terminal.js:12`）是另一套美学契约；当前默认路径会从 body 读`--bg-terminal`，
   所以它会自动吃到新值。这一点值得确认是否符合预期。

## 9. 溯源

`tmp/picotty/` 没有 `LICENSE` 文件，且其 `styles.css:1`–`3` 声明令牌是从一个外部设计项目导入的
（"Raspberry Pi Dashboard UI mockup"）。令牌值本身——十六进制颜色、间距尺度、`0px`
圆角——不构成可保护的表达，因此重新推导它们是直接可行的。但由于该文件本身无许可，所以：

- **重新推导令牌，不要复制文件。** Phase 1 中的每个值都是对照SerialCanvas 自己的变量名
  从零写出的。
- 若日后需要 `app.js` 里的任何逻辑（tooltip 单例确实写得好），需按SerialCanvas 的结构
  重新实现，而非粘贴。
- 在 `docs/acknowledgements.md` 中记录溯源，那里已经在追踪本 fork 借鉴过什么、来自何方。