# 数据格式

SerialCanvas 写出或持久化的一切格式，便于其他工具读取抓取数据与配置。

- [浏览器存储](#浏览器存储)
- [配置快照](#配置快照)
- [用户配置传输](#用户配置传输)
- [时间线文件](#时间线文件)
- [解析结果导出](#解析结果导出)
- [往返使用注意](#往返使用注意)

## 浏览器存储

| 键 | 写入方 | 用途 |
| --- | --- | --- |
| `serialweb:prefs` | 应用（防抖 500 ms，页面卸载时刷新） | 完整的工作配置——结构见下文。`bootstrap.js` 在首次绘制前读取它，以套用主题和布局。 |
| `serialweb:version-modal-seen` | 应用 | 版本说明弹窗被关闭后写入版本字符串（被关闭的那一次的版本号），以免每次加载都重新打开。 |
| `wsl-layout` | 遗留 | 没有任何代码读取它；启动时删除，重置时一并清除。旧版本使用过。 |

**清空配置** 会删除上述键，外加 `localStorage` 和 `sessionStorage` 中**任何**以
`serialweb:` 或 `wsl-` 开头的键。不使用 Cookie，也不使用 IndexedDB。

## 配置快照

`serialweb:prefs` 是一个单独的 JSON 对象。读取时忽略未知键，每一节各自回退到默认值，
因此手工编辑或裁剪都是安全的。

```jsonc
{
  "appVersion": "0.4.1",
  "receiveContentSchemaVersion": 1,
  "savedAt": 1767100000000,          // Date.now()，仅供参考
  "theme": "system",                 // "system" | "light" | "dark"
  "locale": "system",                // "system" | "zh" | "en" — 界面语言

  "layout": {
    "expanded": false,               // false = 监视布局，true = 解析布局
    "monitorView": "terminal",       // "terminal" | "manual"
    "terminalFont": "",              // CSS font-family，"" = 默认；未安装的字体族会被选择器拒绝
    "terminalFontSize": 12,          // 像素，限制在 8-48
    "terminalSkin": "",              // "" | green | black-white | dracula | solarized-dark | solarized-light | one-dark
    "terminalNewline": "n",          // "n" | "rn" | "r" | "none"
    "sidebarCollapsed": false,
    "parserResultsExpanded": false,
    "sendExtensionHeight": 0         // 像素，0 = 默认（252）
  },

  "settings": {
    "baudRate": "115200",            // 以字符串保存
    "dataBits": 8,                   // 7 | 8
    "stopBits": 1,                   // 1 | 2
    "parity": "none",                // "none" | "even" | "odd"
    "flowControl": "none",           // "none" | "hardware"
    "releaseSignalsOnBlur": false,
    "autoReconnect": true,
    "signalDtr": false, "signalRts": false, "signalBreak": false,
    "textEncoding": "utf-8",         // "utf-8" | "ascii" | "latin1" | "utf-16le"
    "newlineMode": "rn",             // "r" | "n" | "rn"
    "appendNewline": true,
    "appendTimestamp": true,
    "rxDisplayMode": "text",         // "text" | "hex"
    "sendMode": "ascii"              // "ascii" | "hex"
  },

  "parser": {
    "mode": "text",                  // "text" | "binary"
    "text": { "rule": "/name0=/float0," },
    "binary": { "rows": [ /* 结构表行，见下文 */ ] }
  },

  "charts": [ /* 每个图框一条，见下文 */ ],

  "modules": { "autoSendOpen": false, "conditionSendOpen": false, "presetSendOpen": false },

  "autoSend": {
    "enabled": false,
    "intervalMs": 1000,              // 下限 100
    "queue": [ { "enabled": true, "payload": "PING", "payloadRawHex": "50494E47" } ]
  },
  "conditionSend": {
    "enabled": false,
    "rules": [ { "enabled": true, "pattern": "OK", "patternRawHex": "4F4B",
                 "response": "ACK", "responseRawHex": "41434B" } ]
  },
  "presetSend": {
    "enabled": false,
    "items": [ { "enabled": true, "payload": "PING", "payloadRawHex": "50494E47",
                 "expected": "PONG", "expectedRawHex": "504F4E47",
                 "description": "", "shortcut": "P" } ]
  },

  "sendDraft": { "text": "", "hex": "" }
}
```

**每个发送/结构表字段都有一份原始十六进制副本。** `payload`/`pattern`/`response`/`expected`
保存*显示用*文本，`…RawHex` 保存实际键入的字节。正因如此，切换 十六进制发送 时数值不会丢失，
文本模式下的待发内容也能包含任何编码都无法往返的字节。手工填写时要把两者保持一致；
只给了文本字段时，十六进制副本会按当前编码从文本推导出来。

一行十六进制结构表：

```jsonc
{ "id": "binary-3", "kind": "data",            // 帧头 | 帧尾 | 数据 | 校验和 | 间隔符
  "value": "",                                  // 帧头/帧尾/间隔符的十六进制字面量
  "dataType": "float32le",                      // 仅数据行
  "name": "vout", "nameAuto": false }
```

一条图表记录保存类型、标题、面板高度、`alignScale`、`fftWindow`、`fftFrameIntervalMs`、
绑定列表、当前选定的纵轴归属、每个绑定的纵轴视图，以及视图状态（`viewMode`、
`viewZoomX/Y`、`viewOffsetX/Y`、`viewFollowLatestX`，还有 **AUTO** 按钮还原时使用的
`viewBase*` 快照）。

## 用户配置传输

**复制配置** 会把下面这个信封以 JSON 写入剪贴板——与每次时间线导出内嵌的载荷类型相同：

```jsonc
{
  "type": "SerialWebUserConfig",
  "version": 1,
  "exportedAt": 1767100000000,
  "exportedAtText": "2026-01-01 08:00:00",
  "userConfig": { /* 配置快照，与上文完全一致 */ }
}
```

**粘贴导入** 要求 `type === "SerialWebUserConfig"` **且** `version === 1`；
其他内容一律以 `剪贴板中未检测到有效的配置。` 拒绝。成功后设置立即生效，包括在帧参数发生
变化时重新打开串口。没有面向未来版本的迁移路径——v2 文件无法在当前版本中载入。

## 时间线文件

时间线是一段抓取的字节流，加上重新推导其解析结果所需的配置。逻辑模型：

```jsonc
{
  "type": "WSLTimelineRaw",
  "version": 1,
  "name": "REC-01-20260101-080000",
  "createdAt": 1767100000000,
  "createdAtText": "2026-01-01 08:00:00",
  "textEncoding": "utf-8",
  "startUnixUs": 1767100000000000,   // 自 epoch 起的微秒数
  "durationUs": 12500000,            // 微秒
  "graphConfig": { "version": 2, "userConfig": { /* 配置快照 */ } }
  // 另外还有分块列表：{ relativeUs, direction: "rx"|"tx", bytes }
}
```

时间戳是微秒，由 `performance.timeOrigin + performance.now()` 得出，因此单调递增，并与录制
那台机器的墙上时钟对齐。三种导出携带的字段完全相同——只是容器不同。
**导入时按内容识别，不看扩展名。**

### `.bin` 推荐格式

全部使用小端序。

| 偏移 | 长度 | 字段 |
| --- | --- | --- |
| 0 | 8 | 魔数 `57 53 4C 42 49 4E 31 00`（`WSLBIN1\0`） |
| 8 | 4 | `uint32` metaLength |
| 12 | metaLength | UTF-8 JSON 元数据（上面那个对象，不含分块列表） |
| 12+metaLength | 4 | `uint32` chunkCount |
| 其后 | 8 | `uint64` relativeUs（µs，相对 `startUnixUs`） |
| | 1 | `uint8` direction —— `0` = rx，`1` = tx |
| | 4 | `uint32` byteLength |
| | n | 原始载荷字节 |

读取示意：

```js
const dv = new DataView(buf);
let o = 8;
const metaLen = dv.getUint32(o, true); o += 4;
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o, metaLen)));
o += metaLen;
const count = dv.getUint32(o, true); o += 4;
for (let i = 0; i < count; i++) {
  const us = Number(dv.getBigUint64(o, true)); o += 8;
  const dir = dv.getUint8(o) ? 'tx' : 'rx';         o += 1;
  const len = dv.getUint32(o, true); o += 4;
  const bytes = new Uint8Array(buf, o, len); o += len;
}
```

```python
import struct, json
with open("REC-01.bin", "rb") as f:
    assert f.read(8) == b"WSLBIN1\x00"
    meta, = struct.unpack("<I", f.read(4))
    obj = json.loads(f.read(meta))
    n, = struct.unpack("<I", f.read(4))
    for _ in range(n):
        us, = struct.unpack("<Q", f.read(8))
        direction = "tx" if f.read(1) == b"\x01" else "rx"
        ln, = struct.unpack("<I", f.read(4))
        payload = f.read(ln)
```

### `.csv` 同一数据的文本容器

```
#WSL-TIMELINE,CSV1
#NAME <base64>
#CREATED_AT 1767100000000
#CREATED_AT_TEXT <base64>
#TEXT_ENCODING <base64>
#START_UNIX_US 1767100000000000
#DURATION_US 12500000
#GRAPH <base64 of the graphConfig JSON>
relative_us,direction,hex
0,rx,54454D503D32332E350D0A
250,tx,4F4B0D0A
```

- 每个元数据键占一行；取值是**第一个逗号之后**的文本。
- `NAME`、`CREATED_AT_TEXT`、`TEXT_ENCODING` 与 `GRAPH` 是 UTF-8 的 base64
  （`btoa(unescape(encodeURIComponent(s)))`），以免中文名称和那段 JSON 破坏行格式。
- `direction` 是字面量 `rx` 或 `tx`；`hex` 为紧凑形式，**大写字节十六进制，无分隔符**。
- 行尾用 LF，无 BOM。

### `.txt`

字段相同，只是以空格而非逗号分隔（取值是**第一个空格之后**的文本），文件头为
`#WSL-TIMELINE TXT1`，随后是一行 `#DATA` 标记，然后是
`<relative_us> <rx|tx> <compact hex>` 数据行。

### 导入

**导入时间线** 在选择框里接受 `.csv`、`.txt`、`.bin` 和 `.timeline`，再按内容分流：
BIN 魔数 → `WSLBIN1` 解析器；`#WSL-TIMELINE,CSV1` → CSV；`#WSL-TIMELINE TXT1` → TXT。
其余一律以 `仅支持 BIN / TXT / CSV version 1 时间线文件。` 失败。因此 `.timeline`
文件实际必须是三者之一——扩展名本身没有含义。

对载荷的要求：`type: "WSLTimelineRaw"`、`version: 1`，且必须存在 `graphConfig.userConfig`
（否则报 `时间线缺少配置快照。`）。导入时会重新分配分块 id，把 µs 换算成 ms，取
`durationMs = max(1, payloadDuration, lastChunkRelative)`，追加为归档并选中它，
从而套用内嵌的解析、图表与发送配置。录制到的字节**不会**并入实时会话，导入也不会把套用的配置
持久化到 `localStorage`。

## 解析结果导出

**导出解析结果 → TXT / CSV** 输出的是一张扁平的帧表，供电子表格和脚本使用——它不是时间线，
也无法再导入。

```
Seq,Time(ms),vout,ibat,flags.0
0,0.0,3.2981,0.121,1
1,20.0,3.2974,0.119,1
```

- 表头是 `Seq,Time(ms),`，其后每个**数值**通道一列，按通道首次出现的顺序排列。
  TXT 用制表符连接同样的单元格。
- `Time(ms)` 是 `frameIndex × 帧间隔`，保留一位小数——推导出的节拍，不是逐帧时间戳。
- 只列出至少含一个数值的帧；非有限值的单元格留空。文本通道（名称、8 字符的 `bool8` 父字段）
  会被省略。
- 它用该归档内嵌的规则重新解析归档的**原始字节**，与规则框当前的内容无关，也不限制分块数量——
  因此帧数可能多于图表显示的。
- 表格将为空时拒绝导出（`无法导出`）。

## 往返使用注意

| 注意点 | 说明 |
| --- | --- |
| 分块级元数据会丢失 | BIN/TXT/CSV 只保存方向与字节。触发发送 和 预设发送 在监视器里打出的标签（以及它们的 `√`/`×` 状态）无法在一次导出/导入之后保留。 |
| 时间线 CSV 与解析结果 CSV | 两者都叫 `<capture>.csv`，在下载目录里会互相覆盖。请给其中一个改名。 |
| 配置被覆盖 | 选中归档会套用其内嵌配置；切回 实时 或其他归档则套用那一份的配置。想保留当前设置，请先 复制配置。 |
| 版本字段 | 两个信封都固定 `version: 1`；不做向前兼容。 |
| 编码 | 元数据是 UTF-8。TXT/CSV 的元数据取值是 base64，所以在 CSV 里搜索中文名称不会命中——需要解码 `#NAME` 字段。 |
| 时钟 | `startUnixUs` 是录制那台机器的墙上时钟；相对偏移才是权威的，绝对时间只取决于那个时钟。 |
