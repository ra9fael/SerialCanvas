# 方案：解析视图拆成三部分，外加按键条重排

写于 `feat/modernist-ui` 分支的 `854ae77` 之后。一次处理两个诉求：

1. 解析视图应该是三部分 —— **模拟数据源 / 解析设置 + 实时结果 / 图表**；
2. terminal 按键条的排序不合理。

下文每一条都来自源码核对，不是推断。行号除特别说明外都基于 `854ae77`。

**状态：已落地。** 两部分在一次提交里完成。有三处与方案不同，已记在对应位置：预览元素改名为 `#simulation-preview`，因为它现在同时服务文本与二进制脚本；模拟面板有了自己的折叠控件；另外顺带发现一个既有的潜在 bug —— `style.css:6578` 处一个没有闭合的注释把其后直到文件末尾的所有规则都注释掉了，解析面板折叠按钮的全部样式都在其中。

---

## 第一部分 —— 解析视图现在是 1.5 个面板，不是三个

### DOM 里实际是什么

```
(index.html)
  285  <section class="panel parser-panel">          <- "解析协议设置"
  305    <div id="parser-panel-body">                 (可折叠)
  307      #text-parser-pane
  325      #binary-parser-pane
  344    </div>
  355    <section class="simulator-panel"> … </section>   <- 嵌套在内，不是独立面板
  400    <section class="parser-results-card"> … </section>
  407  </section>
  410  <section class="charts-panel"> … </section>
```

所以当前的阅读顺序是 **设置 → 模拟 → 结果 → 图表**，而模拟器只是解析面板里的一个 *section*，不是独立的一部分。这就是"四个东西堆在一起"和"三个部分"之间的差距：模拟器没有自己的面板头、没有边框，只是贴在它所喂给的那个面板里面。

`style.css:2087` 的注释就是这么写的：

```css
/* Simulator: a section inside the parse panel, not a panel of its own, so it
   has no border or padding of its own and reads as part of the pipeline. */
```

### 改动 1 —— 把模拟器提出来，放在最前

```
<section class="panel simulator-panel">   1. 模拟数据源   （默认展开，可折叠）
<section class="panel parser-panel">      2. 解析协议设置 + 实时解析结果
<section class="charts-panel">            3. 图表
```

- 把 `index.html:355-398` 移到 `index.html:285` 之前；
- 给它一个真正的 `.panel-head`：标题「模拟数据源」、启用开关、`#simulation-status` 状态、折叠按钮。原来的头只有开关和状态（`.simulator-head`，`index.html:356-366`）；
- `#parser-results-card` **留在** `parser-panel` 里 —— 这正是诉求里的合并：设置与结果同属一个部分；
- 图表本来就是独立 section，无需移动。

**陷阱**：模拟器在监视视图下被隐藏，靠的是它作为 `.parser-panel` 子元素这一点：

```css
/* style.css:2079 */
body:not(.layout-expanded) .parser-panel { display: none !important; }
```

一旦变成兄弟节点，就必须把它加进这条隐藏规则，否则会漏进监视视图。`.charts-panel` 在 `style.css:2933` 已有自己的规则，照它的写法补一条。

- `style.css:2089` 的 `.simulator-panel` 从"内嵌分组"改为"顶层面板"：与 `.parser-panel` 一致的边框/圆角/内边距，外加头部布局。`.simulator-panel .simulation-config`（2117）保持两列网格。

### 改动 2 —— 载荷模板现在没法用

用 `audit/probe-sim-clarity.mjs` 实测（headless，三个脚本全跑）：

| 症状 | 依据 |
| --- | --- |
| 默认值看不见 | `#simulation-template` 只有 `placeholder="使用脚本默认"`（index.html:389），值为 `""`；`SIMULATION_TEMPLATE_DEFAULT = ''`（app.core.js:211）。屏幕上没有任何模板。 |
| 死路字段 | 二进制脚本下文本输入框被 `disabled` 且置灰（`syncSimulationUi`，app.main.js:342-345）。禁用、无解释，而真正该用的帧模板在下面两行。 |
| 只有一侧有预览 | `#simulation-frame-preview` 仅服务二进制（app.main.js:275-283）；文本脚本什么都不显示。 |
| 两个占位符一个值 | `{n}` 与 `{tick}` 都展开为 tick（`applySimulationTemplate`，app.main.js:227-232），文档里却像是有区别。 |
| 没有图例 | 占位符只存在于 `title` 悬浮提示里（index.html:387）。 |

修法，按收益排序：

1. **每个脚本自带默认值，并且填进输入框** —— 不是提示。在 `SIMULATION_SCRIPTS`（app.core.js:124-186）里加 `templateDefault`，加载或切换脚本时写入输入框，让新用户看到一份可编辑的样例：
   - `text-sensor` → `temp={temp},humid={hum};`
   - `text-json` → `{"device":"sim-01","uptime":{n},"temp":{temp}}`
   - `binary-frame` → `A5 {t} {h} {sum} 5A`（即已有的 `SIMULATION_FRAME_TEMPLATE_DEFAULT`，app.core.js:65）
2. **脏标记。** 记录 `simulation.templateDirty`（帧模板同理）。用户没动过就随脚本切换重新播种；自己写过的模板在切换脚本时保留。与 `state.settings.simulation` 其余字段一样持久化（app.main.js:6936）。
3. **恢复默认按钮**，放在每个模板字段旁 —— 一键回到脚本默认，写坏了也能救回来。
4. **只显示适用的那一个字段。** 文本脚本 → 载荷模板；二进制脚本 → 帧模板。隐藏另一个，而不是禁用它（`syncSimulationUi`，app.main.js:341-352）。
5. **可见的占位符图例**，放在字段下方而不是 tooltip：
   `{temp} 温度 · {hum} 湿度 · {n} 帧号 · {ts} 总帧数 · {tick} 同 {n}` 与
   `{t} 温度×10 · {h} 湿度 · {n} 帧号 · {sum} SUM8(占位符字节)`。长说明仍挂一个 `?` 帮助图标 —— 这个模式已经存在（`data-tip`，index.html:310/329）。
6. **两条路径都有预览。** 统一为一行「下一帧预览」：二进制走 `buildSimulationFrame()`，文本走 `applySimulationTemplate()`。
7. **每个脚本一行示例**，例如 `该脚本默认发出：temp=21.0,humid=48;` —— 这是"它到底会发什么"最便宜的答案。

### 待定决策

`{n}` 与 `{tick}` 目前是同一个值。

- **（A，已采纳）** 两者都保留，在图例与 `docs/parser.md` 里把 `{tick}` 标为 `{n}` 的别名。对已保存的模板零风险。已落地：图例写成 `{n}/{tick} 帧号`。
- **（B）** 让二者真正不同（`{n}` 全局帧号，`{tick}` 当前 burst 内的序号）。对突发测试更有用，但会改变已有模板的展开结果。

---

## 第二部分 —— 按键条是分类错了，不只是长

### 实际渲染出来的是什么

`TERM_KEY_GROUPS`（app.terminal.js:422-492）—— 5 组 44 键：

| 组 | 键 | 所在行（TERM_KEY_ROWS，504-507） |
| --- | --- | --- |
| `submit` | Enter⏎（宽）、Alt-⏎ —— 2 | 0 |
| `nav` | ↑ ↓ ← → Home End PgUp PgDn Ins ⇧Tab ^← ^→ Alt-B Alt-F F1 F2 F3 F4 —— 18 | 0 |
| `edit` | Bksp Del ^A ^E ^B ^F ^K ^U ^W ^T ^Y —— 11 | 1 |
| `history` | ^R ^P ^N ^O ^L —— 5 | 1 |
| `control` | ^C ^D ^Z ^G ^V ^X Tab Esc —— 8 | 1 |

上行 20 键，下行 24 键分属三组。

### 真正错在哪（不只是数量）

1. **历史被拆成两处。** ↑ ↓ 在上行 `nav` 组；^P ^N —— *同一个功能* —— 在下行 `history` 组，中间隔着整个编辑组。
2. **转置被拆成两处。** ^T 转置字符在 `edit`，^X 切换转置在 `control`。
3. **琥珀色警示失效。** `.term-key-control`（style.css:6088）用警示色是因为这些字节会中断设备上的前台进程，但组里有 ^V（引号插入）、^X、Tab、Esc —— 没有一个会中断任何东西。八个"危险键"里四个是假警报。
4. **移动键被归进编辑组。** ^A/^E（行首/行尾）与 ^B/^F（左/右移一字符）夹在 Bksp 与 ^K 之间。
5. **最低频的键占了最好的位置。** F1-F4 收尾上行；PgUp/PgDn/Ins 夹在日常移动键中间。

### 改动 —— 六组，按一次会话里实际会按什么排

| # | 组 | 键 | 数量 | 为什么在这里 |
| --- | --- | --- | --- | --- |
| 1 | `submit` | Enter⏎（宽）、Alt-⏎ | 2 | Enter 打头；不变 |
| 2 | `history` | ↑ ↓ ^P ^N ^R ^O ^L | 7 | 提交之后就是召回；方向键与其 Emacs 对应键放在一起 |
| 3 | `move` | ← → ^← ^→ Home End ^A ^E ^B ^F Alt-B Alt-F | 12 | 字符 → 词 → 行，然后 Emacs，然后 Alt |
| 4 | `edit` | Bksp Del ^K ^U ^W ^T ^X ^Y ^V | 9 | 按删除粒度递增；^X 紧挨 ^T |
| 5 | `page` | PgUp PgDn Ins ⇧Tab Tab Esc F1 F2 F3 F4 | 10 | 屏幕/功能键，使用频率最低 |
| 6 | `control` | ^C ^D ^Z ^G | 4 | 只留真正的中断键，琥珀色重新等于"会中断" |

44 键一个不少，没有丢绑定。`TERM_KEY_ROWS` 改为：

```js
const TERM_KEY_ROWS = [
  ['submit', 'history', 'move'],   // ~21 键
  ['edit', 'page', 'control']      // ~23 键
];
```

**为什么这样分，而不是"热键都放上行"。** 按渲染宽度粗估（`min-width:28px` 加内边距，Home/End/Alt-B/PgUp/⇧Tab 是宽标签，宽版 Enter 约 70px）：

| 方案 | 上行 | 下行 |
| --- | --- | --- |
| **（采用）** submit+history+move / edit+page+control | ≈790 px | ≈815 px |
| submit+edit+history / move+page+control | ≈650 px | ≈960 px |

行本身是 `flex-wrap: wrap`（style.css:6033），所以两行宽度不均衡正是"条高随窗口变化"的原因 —— 而这恰恰是当初拆两行要解决的问题。采用的方案偏差约 3%。

实测结果比估算更好：798px / 795px，偏差 0.4%。

取舍，明说：Bksp/Del 落到第二行。它们是第二行的第一组，也就是 Enter 之后眼睛下一个落点，但确实排在 ↑↓ 下面而不是旁边。另一种分法要付出 48% 的宽度失衡。

可选（想要就说）：每组前加一个极小的分组标签（提交 / 历史 / 移动 / 编辑 / 翻页 / 控制）。每组约 40-60px，能让分类自解释；现在的分隔线什么都说明不了。默认不加，把宽度留给按键。

---

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `index.html` | 模拟器 section 移出 `parser-panel` 并加上面板头；模板图例 + 预览 + 恢复默认按钮（约 285、355、387） |
| `style.css` | `.simulator-panel` 改为顶层面板；加入 `body:not(.layout-expanded)` 隐藏规则；图例/预览/恢复按钮的样式；分组标签仅在需要时加 |
| `app.core.js` | 每个脚本加 `templateDefault`；新增 `simulationTemplateDefault(scriptId)` |
| `app.main.js` | `syncSimulationUi()` —— 按脚本显示/隐藏而非禁用、填默认值、脏标记、文本侧预览、恢复默认处理 |
| `app.terminal.js` | `TERM_KEY_GROUPS` 重新分组与排序；`TERM_KEY_ROWS` 更新 |
| `docs/parser.md` | 新增「模拟数据源」章节：默认值、占位符、`{tick}` 别名 |

## 验证

- 新增 `audit/verify-sim-clarity.mjs`（27 条断言）：三个脚本都有可见的默认模板、只渲染适用的字段、两条路径的预览都会更新、恢复默认可用、手写模板扛得住脚本切换、监视视图下模拟器不可见、折叠开关生效。
- `audit/verify-keybar.mjs`：5 组 → 6 组、行分配、**44 键与全部字节绑定仍在**（第 61 行那 12 个抽样键的"缺失"列表必须为空）、^C 仍是琥珀色、Enter 仍是宽主按钮，另加两行宽度偏差断言。
- `audit/verify-parse-view.mjs`（28 条）：断言三个顶层面板的顺序，以及模拟器不出现在监视视图（用 `checkVisibility()`，不要对子元素用 `getComputedStyle`）。
- `audit/verify-sim-config.mjs`：原来断言"二进制脚本下模板输入被禁用"—— 禁用本身就是 bug，改成断言"只显示适用的那一个，且都不禁用"。
- 回归：`verify-parser-collapse`、`verify-binary`、`verify-sim-tag`、`verify-incremental`、`verify-three-issues`、`verify-layout-chart`，然后 `build-release.py` 与文档检查。

## 施工顺序

1. 按键条（单文件、自包含、无布局风险）。
2. 模拟器提升 + 面板头（纯结构；验证没有漏进监视视图）。
3. 模板可发现性（真正有行为改动的部分）。
4. 验证、构建、文档、提交。
