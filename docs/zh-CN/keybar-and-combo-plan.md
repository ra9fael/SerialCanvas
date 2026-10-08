# 按键条补充与可编辑预设组合框

状态：已实现。行分配按方案落地，实测行宽偏差 4.6%；audit/verify-combo.mjs
（20 条断言）与更新后的 verify-keybar / verify-sim-config 守住契约。所有结论
基于 `233e3a6` 的工作区实读。

2026-10-08 评审提出的两件事：

- 终端快捷键补 8 个：^S、^Q、^\\、^H、^M、^J、Alt-D、Alt-Bksp。
- 五个纯下拉控件（字号、回滚行数、日志字符、模拟间隔、每次帧数）改成波特率
  那种「可输可选」组合框。

<a id="keys"></a>

## 1. 八个新按键

现状：44 键 6 组，字节映射在 `TERM_KEY_SEQUENCES`（app.terminal.js:365）。有个遗留物：
`ctrl-h: '\x08'` 早就写在映射表里，但没有任何按钮引用它。

| 键 | 字节 | 归组 | 理由 |
| --- | --- | --- | --- |
| ^Q | `0x11` | flow（新建，2 键） | XON。恢复被 ^S 冻结的输出 |
| ^S | `0x13` | flow | XOFF。经典的「屏幕突然不动」，值得做成一对按钮 |
| ^\\ | `0x1C` | control（琥珀） | SIGQUIT——^C ^D ^Z ^G 里唯一缺的真中断 |
| ^H | `0x08` | edit | BS 字节。Bksp 发 0x7F，部分固件只认 0x08，两个都得有；映射已存在 |
| ^M | `0x0D` | submit | 裸 CR，绕过换行模式设置 |
| ^J | `0x0A` | submit | 裸 LF。Enter 绑定了换行模式，两个字节里总有一个发不出来 |
| Alt-D | `ESC d` | edit | 向后删一个词。^W 只覆盖向前删 |
| Alt-Bksp | `ESC 0x7F` | edit | 向前删一个词（readline 绑定） |

分组说明：

- 流控单独成组而不是并入 control，因为 control 组整体套琥珀色
  （app.terminal.js:592），而琥珀色专门标记会中断东西的字节。^Q/^S 不会永久
  冻结任何东西，不能谎报危险。
- ^M/^J 放 Enter 旁边：submit 组的主题是「一行怎么结束」，这正是它们。
- edit 组内按删除粒度排序：Bksp、^H（同功能另一字节）、Del、^W、Alt-Bksp、
  Alt-D，然后 ^K/^U。

行均衡：共 52 键。初步分法 `[submit, history, move, flow] / [edit, page,
control]` ≈ 25 对 27 键（按常规键宽估 ~740 / ~810 px）；最终行分配以实测为准
——改完跑 measure + verify-keybar，调 `TERM_KEY_ROWS` 保证 1440px 下仍是两行。

明确不做：F5–F8（要连 keydown 映射一起扩，超出纯序列范畴）、BREAK 信号（不是
字节，需要 `setSignals` 动作通路）。

<a id="combos"></a>

## 2. 五个下拉改波特率式组合框

模式已经存在一次：`.baud-rate-anchor` → 输入框 + ▾ 按钮 + `.floating-menu`
预设列表（index.html:174-190），`toggleBaudRateMenu()`（app.core.js:2550）负责
开关并先收起其他浮动菜单。机制是通用的，只是命名绑死了波特率。

五个控件现状：

| 控件 | Id | 选项 | 现在的处理 |
| --- | --- | --- | --- |
| 字号 | `mono-size-preset` + 隐藏 `mono-size-custom` | 10–20 + 自定义 | 两步：先选自定义再输入。改组合框后整段删除 |
| 回滚行数 | `term-scrollback` | 5000 / 20000 / 100000 | `setTerminalScrollback()`——白名单 `TERMINAL_SCROLLBACK_SIZES`，不在名单内静默忽略 |
| 日志字符 | `live-buffer-size` | 256K / 1M / 4M | 白名单 `LIVE_BUFFER_SIZES`，应用与恢复两处（app.main.js:6632） |
| 间隔 | `simulation-interval` | 60ms–5s | 白名单 `SIMULATION_INTERVALS`，不在名单静默回落默认 |
| 每次帧数 | `simulation-burst` | 1 / 4 / 8 / 16 | 白名单 `SIMULATION_BURSTS`，静默回落 |

真正的拦路虎是白名单而不是标记：五个路径都会把输入值静默丢弃。方案：

1. **组件通用化**。app.core.js 加一个 `wireCombo({ input, button, menu,
   parse, clamp, apply })` 帮助函数。HTML 每个控件加同样的 anchor/combo/menu
   三件套；CSS 把共享规则改成 `.combo-*`，`.baud-rate-combo` 保留为别名，其他
   引用零改动。开关经现有的 `.floating-menu.open` 全局清扫来互斥。
2. **「白名单+回落」改为「范围钳制」**。每个控件给显式范围：

   | 控件 | 范围 | 预设（菜单） |
   | --- | --- | --- |
   | 字号 | 8–48（复用 `clampTerminalFontSize`） | 10 11 12 14 16 18 20 |
   | 回滚行数 | 100–1,000,000 行 | 5000 20000 100000 |
   | 日志字符 | 64K–32M 字符 | 262144 1048576 4194304 |
   | 间隔 | 10–60000 ms | 60 200 700 2000 5000（标签 60 毫秒…5 秒） |
   | 每次帧数 | 1–100 | 1 4 8 16 |

   上限理由：回滚和日志字符是纯内存开销，多打一个 0 就是一次页面卡死不是功能；
   间隔低于 10ms 会淹死 RX 路径；没有哪种轮询设备一次回 100+ 帧。
3. **恢复路径钳制而非拒绝**。app.main.js:6632（liveBufferSize）、:245（burst）、
   :312（intervalMs）与 `getTerminalScrollback` / `clampTerminalFontSize` 全部
   改为范围钳制，用户存过的自定义值刷新后仍在。白名单常量保留，作为菜单预设。
4. **菜单标签带单位**（60 毫秒、2 秒）；输入框是纯数字毫秒，单位写在字段标签
   上——与波特率输入框是纯数字一致。
5. **i18n**：新增提示与单位标签双语进 app.lang.js。

<a id="audits"></a>

## 3. 验证

- `verify-keybar.mjs`：组 id/数量（7 组 52 键）、行分配、每个新键在场、字节绑定不丢。
- 新增 `verify-combo.mjs`：逐控件——输入非预设值生效；超范围值被钳制；点预设生效
  且菜单关闭；非法输入不抛错；localStorage 里的自定义值刷新后存活。
- `verify-sim-clarity.mjs` / `verify-sim-config.mjs`：以 select 方式驱动
  simulation-interval/burst 的断言改成设 input value + dispatch。
- 全量回归 + `build-release.py` + docs check。

<a id="risks"></a>

## 4. 风险与注意点

- ^M/^J 在本地回显模式下与其他按钮一样走 `handleTermData`，其中 `\r` 会提交当前
  编辑行——与按 Enter 语义相同；透传模式下直接上线。无新行为，但提示文案要写明
  「裸字节」，避免有人以为换行设置会管它。
- 回滚行数直接改活着的 xterm 实例（`term.options.scrollback`）——现有处理器已证
  明可行。
- 按键条是恒定两行，8 个新键吃掉约 240px。若实测 1440px 出现第三行，降级方案是
  压缩组分隔间距，而不是把按键缩到 28px 命中目标以下。
