# 组合框宽度与 F1–F12

状态：已实现。三行按方案落地（实测 862/682/614px——均衡断言改成了 1440/1100px
下的「行不换行」断言，这才是三行布局下条高恒定的真实契约）。实现时额外挖出一个根因：
`​.term-field input[type="number"] { width: 46px }​` 这条老规则（specificity 更高）把每个
组合框输入框都钉死了——现在组合框会重置它，每个组合框按自身数字宽度设底线，
工具栏里的原生下拉在换行前先收缩。基于 `81ee635` 实测。2026-10-08 评审提出的两件事：

- 组合框输入框（回滚行数、日志字符、字号…）太窄，数字显示不全。
- 按键条应包含 F1–F12，必要时可以三行。

<a id="width"></a>

## 1. 组合框输入框截断数字

audit/probe-combo-width.mjs 实测，1440px 和 1100px 下完全一样：

| 输入框                | 实际宽度 | `33554432` 需要的宽度 |
| ------------------ | ---- | ---------------- |
| `mono-size-input`  | 46px | ~76px            |
| `term-scrollback`  | 46px | ~76px            |
| `live-buffer-size` | 46px | ~76px            |

不是窄窗口挤压——任何窗口宽度下输入框都是 46px。组合框网格是  
`minmax(0, 1fr) 32px`，文本列没有任何下限，工具栏的字段分配就把饿瘦了。  
六位数（262144）靠运气刚好放下，七位数（1000000、33554432）必然截断。

修法：`.combo > input { min-width: 78px }`（8 位数字 + 左右 20px 内边距）。  
▾ 按钮的 32px 不变，每个组合框约加宽 32px。buffer 工具栏有两组（第 2 行  
+64px），verify-toolbar-rows 会断言 1100px 下无溢出无截断——如果被触发，  
降级方案是缩短字段标签（回滚行数 → 回滚），而不是把输入框压到装不下该显示  
的数字。verify-combo.mjs 加一条几何断言：每个组合框的输入框宽度 ≥ 其 `max`  
属性值渲染出来的宽度。

<a id="fkeys"></a>

## 2. F1–F12 与三行按键条

序列是标准 xterm 集，xterm 对物理键盘本来就会发这些序列，所以只加按钮、  
不碰 keydown 处理：

```
f5  ESC[15~   f6  ESC[17~   f7  ESC[18~   f8  ESC[19~
f9  ESC[20~   f10 ESC[21~   f11 ESC[23~   f12 ESC[24~
```

分组：F1–F4 从 `page` 组移出，与 F5–F12 合成新的 `fkeys` 组。「功能键」是  
一个概念，4/8 拆在两组里是当初否掉 F5+ 的历史残留。`page` 只留真正关于  
屏幕/编辑的六个键：PgUp、PgDn、Ins、⇧Tab、Tab、Esc。

60 键，8 组：

| 组       | 键                                            | 数量 |
| ------- | -------------------------------------------- | -- |
| submit  | Enter Alt-⏎ ^M ^J                            | 4  |
| history | ↑ ↓ ^P ^N ^R ^O ^L                           | 7  |
| move    | ←→ ^←^→ Home End ^B^F ^A^E Alt-B Alt-F       | 12 |
| edit    | Bksp ^H Del ^K ^U ^W Alt-⌫ Alt-D ^T ^X ^Y ^V | 12 |
| page    | PgUp PgDn Ins ⇧Tab Tab Esc                   | 6  |
| flow    | ^S ^Q                                        | 2  |
| control | ^C ^D ^Z ^G ^\\                              | 5  |
| fkeys   | F1–F12                                       | 12 |

三行（初步分法，最终照旧以实测为准）：

```
row0: submit, history, move        (23 键，~700px)
row1: edit, page                   (18 键，~560px)
row2: flow, control, fkeys         (19 键，~580px)
```

第 0 行是行输入与导航；第 1 行是文本与屏幕操作；第 2 行以影响设备的键收尾  
——流控、琥珀色中断、固件会吃的功能键。琥珀色保持在最末尾，正是「按之前  
要读两遍」的键该在的位置。渲染循环（`TERM_KEY_ROWS.forEach`）本就支持任意  
行数；按键条高度从两行变三行（约 +34px），折叠开关照旧可用。

验证：verify-keybar（60 键、8 组、三行、F 序列齐全）、verify-three-issues  
（总数 52 → 60）、verify-combo（新增宽度断言）。全量回归 + 构建 + docs  
check，然后发 v0.4.2。

<a id="risks"></a>

## 3. 风险

- 多出的 ~34px 从默认视图的终端画布里出；在意的用户已有折叠开关。
- 第 2 行 ~580px 是最轻的一行；若实测三行过于参差（断言阈值是最宽/最窄  
  25%），降级方案是把 flow 挪到第 1 行（edit, flow, control / page,  
  fkeys）——语义略差，均衡更好。
- F10 在部分终端是菜单键；xterm.js 发 ESC[21~，按钮发的也是它，不做特殊  
  处理。
