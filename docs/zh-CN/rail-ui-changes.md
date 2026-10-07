# 连接栏 —— 实测尺寸与视觉改动

分支：`feat/modernist-ui`。对应 `docs/five-issues-plan.md` 的第 4a / 4b 项。

下文所有数字来自 `audit/shot-rail.mjs` 与 `audit/measure-controls.mjs`
在 1440x1000 与 1920x1080 下的测量。截图见 `audit/rail-1440.png`。

---

## 现状

连接栏内19 个交互控件，**6 种高度**：

| 高度 | 数量 | 是什么 |
| --- | --- | --- |
| 59.3px | 2 | `RELEASE ON BLUR`、`RTS/CTS FLOW CONTROL` —— 换行所致 |
| 44.2px | 1 | 连接按钮 |
| 40px | 3 | DTR / RTS / BREAK 信号芯片 |
| 31px | 6 | 自定义 select 触发器、波特率预设按钮 |
| 30px | 2 | 波特率输入框 |
| 15px | 5 | 勾选框本体 |

空间：1440 下左栏 274x934，`config-panel` 高 432。

**一条值得记下的测量陷阱。** 第一版探针把 `data-bits` / `stop-bits` / `parity`
三个 select 报成 16px 高，看起来像严重的压扁缺陷。**它不是。** 每个
`<select>` 在运行时被自定义 select 组件包裹（`app.core.js:2279`），
原生元素用 `position: absolute; inset: 0; width: 0; height: 0; opacity: 0`
隐藏（`style.css:752`）。隐藏的绝对定位元素会报告一个塌缩的盒子。
用户实际看到的是 `.custom-select-trigger`，31px，正常。

**这是本项目第七次把探针产物当成产品缺陷。** 检查方法始终是同一个：
先确认你量的是用户真正看到的那个元素。

---

## 改动

### 1. 两个高度令牌

```css
--control-h: 32px;      /* select、输入框、行内按钮、勾选行 */
--control-h-lg: 44px;   /* 仅连接按钮 */
```

现有 6 个值的映射：30 / 31 / 40 / 59.3 → `--control-h`，
44.2 → `--control-h-lg`。勾选框 15x15 → 16x16。

**连接按钮刻意保留高度差。** 它是面板里唯一的主操作，
把它和波特率预设按钮做成等高会抹平层级。其余全部统一。

### 2. 让两个标签不换行

`RELEASE ON BLUR`（15 字符）与 `RTS/CTS FLOW CONTROL`（20 字符）换行的原因是：
全大写 kicker 处理加字距后每字符约需 8px，而勾选框旁的标签单元格只有约 100px。
**这是英文 locale 的结构性约束，不是一次性现象。**

按优先级：

- 给标签自己的整行：勾选框在右，标签可用整个单元格。DTR/RTS/BREAK 本来就
  够放（它们没换行），所以要改的是**让布局不依赖文字是否放得下**。
- 缩短英文：`RTS/CTS flow` 在它所处的 DTR/RTS/BREAK 那一行里已经无歧义；
  `Blur release` 比 `Release on blur` 短。
- 万一仍有标签换行，用固定行高封顶两行，保证网格整齐 ——
  `.toggle-row` 上的 `min-height: var(--control-h)` 加
  `align-items: center` 已经接近了，缺的是「行长高而不是文字截断」。

我会做第一项（布局不再依赖文字长度）与第二项（缩短英文），
第三项作为兜底。

### 3. 给勾选框一个可见的勾选态

截图里五个勾选框都读作空心轮廓——状态只能靠「有个 15x15 的框存在」来推断。
两个成因：

- 15px 相对 32px 行高太小，倾向于消失而不是被读作控件。
- `accent-color: var(--accent)`（`style.css:2627`）给原生控件上色，
  但截图里全是未勾选态，所以什么都没能证明。

16x16 配合新 `--accent` 上的 `accent-color`（浅色 `#ec3013`、深色 `#ff563c`），
勾选后会读得很清楚。我还会在两个主题下各截一张验证勾选态 ——
`accent-color` 继承自 `color-scheme`，理论上会跟随，但这值得一张截图而不是一个假设。

### 4. 信号读数：虚线 → 实线

`.signal-readout`（`style.css:2525`）是 `border: 1px dashed var(--border)`。
虚线框的惯例含义是「可填写、待输入」，而这些是只读的设备输入。

- 改为 1px 实线，与 `.signal-chip`、`.toggle-row` 一致 —— 它们会成为同一个
  视觉家族，而这是正确的：它们都是「带标签的一行控件」，
  尽管其中两个可设、两个不可设。
- 用三态指示替代纯文字：
  - 从未读取 → 弱化的 `未知`（现在是 `-`）
  - 已读取、false → `关`
  - 已读取、true → `开`，并保留现有的 `.is-on` 处理

  这个区分有意义，因为不支持 modem status 的驱动上 `getSignals()` 返回全 `false`
  而不抛错，当前与真实的「全低」无法区分。
- 保持不可交互。Web Serial API 无法设置输入引脚。

### 5. VID / PID 归位

`index.html:151` —— 现在浮在面板头右上，与两行标题基线错位，未连接时显示 `-`。
它是设备元信息，所以应该与连接状态在一起，而不是与标题在一起。

移到连接按钮下方，作为一条元信息行：`VID 2341  PID 0043`，
弱化、单行、右对齐或整宽。这同时也给面板在信号行之上一个自然的下边缘。

---

## 本次不改什么

- **左栏空白。** 实测左栏 934px、`config-panel` 432px。多余的空间是被
  `style.css:2712`（`body:not(.layout-expanded)`）隐藏的解析列，
  在等待图形解析模式。收拢面板与让 `layout-expanded` 变成叠加式是
  `docs/layout-redesign.md` 里的方案，**不属于本次改动**。
  先做尺寸统一，收拢时才有统一高度可收。
- **工具栏。** `--control-h-sm`（28px）会为工具栏的 `term-field` 芯片定义，
  但它们当前的尺寸保持不变 —— `c9720e5` 刚为 1280px 下的密度调过，
  现在动会撤销那次实测的结果。

---

## 验证

- 重跑 `audit/shot-rail.mjs`：不同高度的数量必须降到 2 种（32 与 44），
  外加 16px 的勾选框。这个脚本本身就是断言。
- 两个主题各截一张；以及已连接状态的截图，让勾选态与 `开` / `未知`
  两种状态都可见。无硬件时通过 CDP 赋值
  `state.serial.signalInputs` 并调用 `updateSignalControlsUI()` ——
  与 `getSignals()` 走同一条路径。
- **英文 locale 专门测**，1440 与 1280 各一次，因为换行是英文宽度问题。
- 重跑 B1 / B2 / C2 / C3 / tooltip / i18n 检查。左栏标记不变，
  只改 CSS 与两条文案字符串，应当不受影响。

## 待定决策

1. **英文标签缩短。** `RTS/CTS flow control` → `RTS/CTS flow`、
   `Release on blur` → `Blur release`，还是保留描述性文案、只靠布局修正？
   前者更简洁，后者对没读过更新日志的人更清楚。
2. **未读取态用 `未知`。** 保留 `-`、只区分「已读但全低」这种情况，
   还是把未知态显式化？
3. **勾选框样式。** 保留原生控件 + `accent-color`，
   还是换成自定义 span，让勾选态是朱红实心 + 对勾？
   原生方案免费拿到可访问性；自定义方案与这次重设计的其余部分更一致。
