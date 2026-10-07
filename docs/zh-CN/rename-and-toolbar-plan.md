# 打磨轮次：圆角分段、芯片作用域、去 fork 化、改名、工具栏溢出

状态：已随 v0.4.0 落地（SerialCanvas 改名、圆角修复、芯片作用域、两行工具栏；
新仓库本身在本仓库之外创建）。所有结论均读自 `872a0ba` 的工作区。

2026-10-08 评审的四项内容，外加新仓库的命名问题。

1. 圆角分段按钮与主题/语言样式不一致
2. 模拟芯片：仅手动视图、不显示帧数
3. 文档去 fork 化，写明两个 UI 借鉴来源
4. 新仓库与新名字
5. 监视工具栏：空间不足时怎么办
6. 建议顺序

English mirror: [../rename-and-toolbar-plan.md](../rename-and-toolbar-plan.md).

## 1. 圆角分段按钮与主题/语言样式不一致

截图是对的，原因也很精确：把分段按钮从通用浮动菜单样式中豁免出来的两个
`:not()` 排除列表，写了主题和语言，**漏了圆角**。

`style.css:983`（基础规则，specificity (0,3,1) —— 无论源码顺序如何都压过
`.menu-corner-opt` 的 (0,1,0)）：

```css
.floating-menu button:not(.menu-theme-opt):not(.menu-lang-opt),
```

`style.css:1241`（hover/focus 规则）：

```css
.floating-menu button:not(.menu-theme-opt):not(.menu-lang-opt):hover,
```

于是 `#menu-corner-group .menu-corner-opt` 的每个按钮都从通用规则里继承了
`width:100%`、`justify-content:flex-start`、`padding:8px 10px`、
`min-height:36px` 和 `background` 过渡——盖掉了 1192 行共享规则里的
`min-height:28px; padding:4px 6px`——并且 hover 会有
`background:var(--accent-soft)`，而主题/语言按钮刻意没有这个（它们跟随滑动
的强调色指示条）。

**修法**：两处选择器补上 `:not(.menu-corner-opt)`。两行，不加新规则。主题、
语言、圆角从此共用同一套分段样式。

**验证**：新增 `audit/verify-menu-segments.mjs`——逐组断言计算样式
`min-height:28px`、宽度不铺满分组、hover 背景透明（用选择器 `matches` 检查）；
三组必须一致。约 6 条断言。

## 2. 模拟芯片：仅手动视图、不显示帧数

现状（`app.main.js:404-424`）：芯片在解析视图隐藏，在监视视图的**两个**
子视图（手动与终端）都显示 `模拟中 · N 帧` / `模拟已让位 · N 帧`。

要求：

1. 只在**手动**子视图显示：可见性条件加上
   `state.ui.monitorView === 'manual'`（终端子视图保持 xterm 干净）。
2. 去掉帧数：文案变为 `模拟中` / `模拟已让位`。数量已由它驱动的 RX 计数
   可见；芯片回答「是不是真的」，不回答「有多少」。

涉及：

- `app.main.js` `applySimulationMonitorChip()`——条件与文案。
- `app.lang.js`——两条 `{{count}}` 词条换成 `模拟中` / `模拟已让位`
  （英文 `Simulating` / `Simulator yielded`）。
- `index.html`——芯片上方的长注释（它解释了帧数）。
- `audit/verify-sim-tag.mjs`——断言按新契约重写（手动可见、终端与解析视图
  隐藏、无数字）。

## 3. 文档去 fork 化，写明两个 UI 借鉴来源

用户判断：应用已经分叉得足够远，再叫 fork 已不准确。文档应改为「从 X 出发
独立发展的项目」，**只保留原始仓库链接**，并说明 UI 源自原 SerialWeb 与
PICOTTY。

计划：

- `docs/fork.md` + `docs/zh-CN/fork.md` 替换为 `docs/acknowledgements.md`
  （+中文镜像）：出处（`Conductance-lab/SerialWeb`，仅链接）、UI 借鉴自
  原 SerialWeb 与 [PICOTTY](https://github.com/morpheuslord/PICOTTY)
  （已查证：morpheuslord 的 Pico fleet console，GPL-3.0）、三句话的沿革、
  许可证一节。
- `README.md`（+`docs/README.md` 镜像）：fork 段落换成两句话——独立项目、
  UI 源自 SerialWeb 与 PICOTTY、链接原始项目。
- 关于弹窗——同样措辞，中英双语。
- `index.html` 菜单链接（`问题反馈` / `工具手册`）——新仓库建好后指向它。
- **诚实说明**：改名不改变 AGPL-3.0 义务。LICENSE 文件、原始版权声明和
  「相对原版的修改」声明必须保留。改名可以，静默换许可不行。

## 4. 新仓库与新名字

候选名（2026-10-07 用 GitHub search API 查重）：

| 候选 | GitHub 重名 | 备注 |
| --- | --- | --- |
| **SerialCanvas** | **0** | canvas 呼应解析 + 绘图；最贴切 |
| **PortCanvas** | 0 | 同思路，更短 |
| SerialScope | 已被占 ×4+ | 示波器类工具 |
| SerialBench / SerialLens / PortLens / WireLens | 已被占 | 各类项目 |

推荐：**SerialCanvas**。中文名：串口画布（SerialCanvas）——待确认。

机械改名范围：

- `index.html`：`<title>`、`<meta>` 描述、`download` 文件名、菜单链接、
  关于弹窗文案、`app.lang.js` 词条。
- `build-release.py`：产物 `dist/SerialCanvas.html`；dist 冒烟测试的
  audit 调用随之改变。
- `.github/workflows/pages.yml`：产物/页面路径。
- `README.md`、`docs/**` 正文、`docs/CHANGELOG.md` 条目。
- 内部标识（`wsl-layout` 等 localStorage 键、模块名）不动——改名会让所有
  用户已存的布局作废，却没有可见收益；已在致谢文档中说明。

仓库迁移（需要用户决策形态）：

- **方案 R1——新仓库、保留现有历史（推荐）**：创建 `<user>/<New>`，把现有
  分支推为 `main`，旧仓库归档。历史保留，不再声称 fork。
- **方案 R2——原地改名**：GitHub Settings 里把 `SerialWeb` 改成 `<New>`；
  旧链接自动重定向。最省事，但保留 fork 谱系元数据，而用户要的是**新仓库**。

## 5. 监视工具栏：空间不足时怎么办

从 CSS 实测的现状：`.monitor-toolbar` 为 `flex-wrap:nowrap`，仅在
`@media (max-width:1280px)` 以下改为换行；`#manual-toolbar-controls` 为
nowrap 且字段压缩——先是标签省略号，其次是内边距。截图（宽窗口、十个控件
+ HB/meta 芯片 + 右侧导出/清空）正是这套策略的终点：`按键 HB: NaN` 被截断、
`模式` 被截断、所有字段压到最小宽度、再无余地。

选项：

- **T1（推荐）——恒定两行。** 与按键条相同的决策。行 1：标题 + 状态芯片/
  meta + 手动收发/终端切换 + 导出日志/清空缓存。行 2：全部参数字段（编码 /
  字号 / 回滚行数 / 日志字节数 / 换行 / 字体 / 主题）。任何窗口宽度下高度
  确定、无截断、零 JS，1280px 特例随之删除。代价：即使窗口很宽也多占一行
  （约 34px）；手动与终端工具栏同样处理。
- **T2——溢出收纳。** 用 `ResizeObserver` 测量；低于宽度阈值时把低频字段
  （字体 / 主题 / 回滚行数 / 日志字节数）收进 `更多 ⋯` 弹层。宽屏保住一行。
  代价：测量 JS + 弹层控件的状态同步，且控件位置会动、难以形成肌肉记忆。
- **T3——维持现状、加长 tooltip。** 最便宜，但不解决问题。

推荐 T1，理由与按键条改为固定行相同：确定的布局胜过会变高度、会挪控件位置
的自适应布局。

## 建议顺序

1. 圆角 `:not()` 修复 + menu-segments 验收（两行、隔离）。
2. 芯片作用域与文案（小改动，有现成 audit 要更新）。
3. 工具栏 T1（CSS + `index.html` 工具栏内重排；如有统计工具栏子节点的
   断言则同步更新）。
4. 改名 + 去 fork 化 + 新仓库（波及面最大：构建、workflow、docs、i18n——
   放最后，一次做完，独立提交）。
