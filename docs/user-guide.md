# User guide

- [Interface map](#interface-map)
- [Connecting a device](#connecting-a-device)
- [Serial monitor](#serial-monitor)
- [Terminal view](#terminal-view)
- [Sending](#sending)
- [Timeline: record, freeze, replay](#timeline-record-freeze-replay)
- [Layout, theme and panels](#layout-theme-and-panels)
- [Settings persistence and config transfer](#settings-persistence-and-config-transfer)
- [Keyboard and mouse reference](#keyboard-and-mouse-reference)
- [Troubleshooting](#troubleshooting)

Two companion documents cover the rest of the app:
[parsing incoming data](parser.md) and [charts](charts.md).

## Interface map

The window has a top bar and two columns. The header's mode switch toggles the whole
layout between two arrangements:

| Mode | Button | Layout |
| --- | --- | --- |
| **Monitor (监视)** | `#serial-mode-btn` | Collapsed. Connection panel + monitor get the width; parser and charts are stacked in the left column. Monitor timestamps are shown. |
| **Parser (解析)** | `#parser-mode-btn` | Expanded. Parser settings and the chart list come forward; the monitor **hides its timestamp prefixes** in this mode. |

| Region | Panel | Purpose |
| --- | --- | --- |
| Top bar, left | Status pill | Connection state (串口离线 / 串口已连接 / 不支持 Web Serial API) and the mode switch. Click, Enter or Space toggles the sidebar. |
| Top bar, centre | Timeline ribbon | `REC` record toggle, freeze hub, scrubber, timestamp readout, capture picker (`▾`). |
| Top bar, right | System menu `☰` | Version info, theme, language, config copy/paste/reset, feedback and manual links, offline download. |
| Left column | Device connection management (设备连接管理) | Port, framing, signals, advanced display options. |
| Left column | Parser protocol settings (解析协议设置) | Text/hex rules and the live results card. See [parser.md](parser.md). |
| Left column | Add chart frame (添加图框) | Chart list. See [charts.md](charts.md). |
| Right column | Serial monitor (串口监视器) | Log view, TX/RX counters, manual/terminal switch, send box, and the timed/trigger/preset modules. |

## Connecting a device

### Opening a port

**Connect device | currently disconnected (连接设备 | 当前未连接)** calls
`navigator.serial.requestPort()` and shows the browser's USB chooser. The button text is a
live state readout; it can show:

| Text | Meaning |
| --- | --- |
| `连接设备 \| 当前未连接` | Idle, click to choose a port. |
| `断开连接 \| HH:MM:SS` | Connected; the timer is uptime. Click to disconnect. |
| `正在重连 \| 点击取消重连` | Auto-reconnect loop is running; clicking cancels it. |
| `重连失败 \| 串口可能被占用` | Reconnect is failing — often a program holding the port. |
| `失焦断连 \| HH:MM:SS` | Released on blur, waiting for the tab to be focused again. |
| `正在应用参数 \| 请稍候` | Re-opening the port to apply changed framing. |
| `不支持 Web Serial API` | Browser has no Web Serial. |

Cancelling the USB chooser is not an error — the log records
`用户取消了串口选择。` and nothing is toasted.

If exactly **one** port was authorised in a previous session, SerialCanvas reconnects to it
automatically at startup. With zero or several known ports it waits for a click, because
the browser only allows `requestPort()` from a user gesture.

### Framing parameters

| Field | Values | Default |
| --- | --- | --- |
| Baud rate (波特率) | Any integer ≥ 1; preset menu offers 1200 … 921600 | `115200` |
| Data bits (数据位) | 8, 7 | `8` |
| Stop bits (停止位) | 1, 2 | `1` |
| Parity (校验位) | None (无), Even (偶校验), Odd (奇校验) | `none` |
| RTS/CTS flow control (RTS/CTS 流控) | on/off | off |

The receive buffer is requested as `bufferSize: 65536`.

**Changes take effect immediately while connected**, including a baud change: SerialCanvas
closes and re-opens the port (a short discontinuity, `正在应用参数 | 请稍候`). Typing in the
baud field is debounced 420 ms; leaving the field, pressing enter, picking a preset, or
changing data/stop/parity/flow-control applies at once. If the port handle disappears
mid-switch, you get `参数未应用` and must reconnect.

### Modem signals

Outputs are written with `setSignals()` and apply without re-opening the port:

- **DTR**, **RTS**, **BREAK** toggles.
- With RTS/CTS flow control enabled the RTS toggle is taken over by the system — its
  tooltip says `RTS/CTS 流控生效时，RTS 由系统自动接管。`
- While "release on blur" is active, all three outputs are forced low.

Inputs are read with `getSignals()` **every 800 ms** and shown as CTS / DSR / DCD / RI
readouts. Polling stops on disconnect, so a stale `-` after disconnecting is expected.

### Auto-reconnect (自动重连)

On by default. When the port drops (`disconnect` event, read error, or a blur release),
SerialCanvas retries **indefinitely with no backoff** — a 20 ms wake interval, 30 ms while the
previous close is still cleaning up — and prefers the original port handle, falling back to
any `getPorts()` entry whose cached `getInfo()` VID/PID matches. The first 900 ms of
failures are silent; after that a `重连失败` toast appears. Plug the device back in and the
browser's `connect` event triggers a retry on its own.

Reconnect stops when you click the connect button, untick 自动重连, or the port is released
manually.

> **Unplug/replug on the same instance**: reconnect needs the browser to still hold an
> authorisation for that device. If the OS enumerates a new device identity, the chooser
> has to be used again.

### Release on blur (失焦自动断连)

Off by default; enabling it also turns **auto-reconnect on**. When the tab is hidden or the
window loses focus, SerialCanvas closes the port so another program can take it, logging
`页面失焦，已释放串口连接。` Refocusing the window and restoring focus reconnects
automatically. Useful when the same board is shared with an IDE flasher.

### Errors

`连接失败` with the detail **串口可能被占用，请关闭其他串口软件后重试** means the port is
held elsewhere (or the driver refused). Close the other tool; on Windows this includes
another browser tab.

## Serial monitor

The log is the *manual* view of **Monitor view (手动收发 / 终端)** tabs.

### Display options (Advanced grid under the connection panel)

| Option | Effect | Default |
| --- | --- | --- |
| Character encoding (字符编码) | `UTF-8`, `ASCII`, `Latin-1`, `UTF-16LE` — decoding of RX **and** encoding of TX text. | `utf-8` |
| Newline (换行符设置) | Line terminator appended to sent text: `\r`, `\n`, `\r\n`. | `\r\n` |
| Hex receive (十六进制接收) | Render RX as space-separated uppercase hex instead of text. | off |
| Hex send (十六进制发送) | Send box is interpreted as hex bytes. | off |
| Show time (显示时间) | Prefix `[HH:MM:SS.d]` — tenths of a second. Hidden in expanded (解析) layout. | on |
| Append newline (结尾补换行符) | Append the terminator above to every send. | on |

### Line handling and buffering

Bytes are split on `0x0D` and `0x0A`. A `CR` at the end of one USB read is held so that a
`CRLF` straddling two reads still produces one line, not a blank one. Lines longer than
**2048 bytes / 2048 characters** are rolled into several display events — a single very long
frame can therefore be parsed as two frames ([see parser notes](parser.md#line-splitting)).

The live session keeps roughly the last **8192 characters of decoded text**
(`MAX_LIVE_EVENT_TOTAL_CHARS`); older output is dropped as new data arrives. This bounds
memory at high baud rates but means **the live view is not an archive** — use
[REC](#timeline-record-freeze-replay) for anything you want to keep. "清空缓存" (Clear cache)
resets the log, the TX/RX counters and the parsed history.

**TX** and **RX** in the monitor header are byte counters for the current session; they show
`-` while disconnected and are recomputed from the visible prefix during
[replay](#replay).

While you have text selected in the log, re-rendering is held back so the selection survives.
The jump-to-bottom arrow appears once you scroll up (more than 20 px from the bottom).

## Terminal view

The **Terminal (终端)** tab is a full xterm.js emulation, vendored locally (no CDN). It is
designed for shells, AT-command modules, boot consoles and anything that wants line editing.

**Terminal mode is an independent channel.** RX is only decoded into the emulator and
counted; it does **not** feed the log, the parser, the charts, or recording, and TX keystrokes
are not recorded either. Switch back to 手动收发 (Manual) before you parse or plot.

Toolbar options:

| Control | Values | Notes |
| --- | --- | --- |
| Newline (换行) | `\n`, `\r\n`, `\r`, none | Bytes sent when you press Enter. |
| Font (字体) | Default plus Cascadia, JetBrains Mono, FiraCode, Hack, MesloLGS NF, 更纱黑体, Noto Mono CJK, Consolas, Courier New | Only fonts installed on the machine are selectable: the rest are greyed out with a `Font not detected…` tooltip, because every stack ends in `monospace` and would otherwise render exactly like the default. Nerd Font variants add icons. |
| Size (字号) | 8–48 px, default 12 | `Ctrl` + mouse wheel over the terminal steps it by 1 px; the grid re-fits either way. |
| Theme (主题) | Follow app (跟随应用), 黑底绿字, 黑底白字, Dracula, Solarized Dark, Solarized Light, One Dark | Independent of the application theme. |
| Echo (回显) | on/off | Local echo for devices that do not echo. |

**Echo off (default)** — every key is forwarded to the device verbatim, so `Ctrl+C`,
`Ctrl+D`, arrows and escape sequences reach your shell. Only Enter is rewritten to the
selected newline. Leave this off for shells and any device that echoes itself, otherwise
you see double characters.

**Echo on** — SerialCanvas edits the line locally: Enter commits and sends, Backspace erases,
`Ctrl+U` clears the line, `↑`/`↓` walk the last **200** commands. Other control characters
are passed through with a `^X` marker.

Once per session the terminal prints a hint line explaining the echo behaviour.
"清空缓存" in this tab runs `term.clear()`.

## Sending

The send area sits under the monitor. **Send now (立即发送)** is the only trigger — the send
box does not bind Enter, so you can compose multi-line content freely. Sending while
disconnected toasts `发送失败 / 串口未连接，无法发送当前内容。`

The text box and hex box keep **separate drafts**, and both are stored as raw bytes
internally: switching 十六进制发送 back and forth never loses or re-mangles bytes that were
typed in the other mode.

### Hex send

**Hex send (十六进制发送)** interprets the box as bytes. Input is normalised aggressively:
`0x`/`0X` prefixes are dropped, every non-hex character is treated as a separator, tokens
longer than two digits are cut into pairs, and the display is re-grouped as pairs (the caret
is kept in place). `AA550102`, `AA 55 01 02`, `0xAA,0x55,0x01,0x02` and `aa55 0102` all send
`AA 55 01 02`. An odd trailing nibble fails with `非法 HEX 字节: <piece>`. The newline option
above still appends the terminator bytes in hex mode.

### The three extra modules

One module panel is open at a time; the tiles under the send box (定时发送 / 触发发送 / 预设发送)
expand it, and the small dot on each tile enables or disables that module independently of
the panel being visible. All three lists support drag-to-reorder, and the whole send area
is drag-resizable by its top edge.

**Timed send (定时发送)** — a round-robin queue sent on a fixed period. Interval floor is
100 ms (default 1000 ms); the *tile pulses* on each send and stays constantly lit below
500 ms. Disabled items are skipped; ticks are skipped while disconnected or while a previous
write is still in flight. Deleting the last row leaves an empty row rather than an empty
list. Seeded with `PING`.

**Trigger send (触发发送)** — reply-when-matched rules, evaluated once per completed RX line:

| Field | Matching |
| --- | --- |
| Pattern (匹配) | Plain **substring** containment. There is no exact-match and no regex option. In hex mode it is a byte-subsequence test. |
| Response (应答) | Sent as soon as the pattern is seen; appears in the log tagged `触发：<desc>`. |

Seeded with `OK` → `ACK`.

**Preset send (预设发送)** — one-shot messages with an optional hotkey and an optional
expected reply:

| Column | Notes |
| --- | --- |
| Send content (发送内容) | Payload. |
| Expected receive (期望接收) | Substring (or byte subsequence in hex mode) or exact match of the trimmed line. |
| Description (描述) | Free text; shown in the log tag. |
| Shortcut (快捷键) | **A single character**, auto-uppercased, focused input is pre-selected. Typing one enables the module. |

With the module **enabled**, pressing that bare key anywhere outside a text field sends the
preset — no Ctrl/Alt/Meta, no function keys, and the key must match exactly one preset
(ambiguous keys do nothing). The log marks the outcome: `√ 预设：<desc>` when the expected
reply arrives within **1800 ms**, `× 预设：<desc>` when it times out. Expectations are cleared
on disconnect. Seeded with `PING` / `PONG`.

## Timeline: record, freeze, replay

The ribbon in the top bar drives a session model: a **realtime** buffer plus any number of
archived **captures**. Only raw bytes and a settings snapshot are archived — parsed values
are always re-derived from those bytes with the snapshot's rule, so a capture re-analyses
correctly even if you change the rule afterwards. See [data formats](data-formats.md) for
the exact layout.

### Record

**REC** starts a capture (auto-archiving any recording in progress) and lights up. Every RX
and TX chunk from that moment is appended with a microsecond-precision relative timestamp.
Stopping saves an archive named `REC-<NN>-YYYYMMDD-HHMMSS` and toasts
`录制已保存 … 共 N 段`. There is no cap on the number of captures or their length — stop
recording when you are done.

### Freeze

The pause icon in the middle of the ribbon snapshots the **live** view so you can inspect it
while data keeps arriving: hover the hub for a temporary freeze, click to lock it. Freeze is
only offered while connected to the realtime timeline, not while recording or waiting on a
blur release. Unfreeze returns to live.

### Replay

Select a capture from the picker (`▾`). The scrubber becomes active: 1000 steps across the
capture's duration, transport buttons step ±250 ms and fast-forward +1000 ms, play runs in
real time, and the monitor, parser results and charts all reflect the state at the playhead.
TX/RX counters are recomputed for the visible prefix.

Choosing a capture **applies the settings it recorded** — parser rule, chart configurations,
serial framing, send modules. This is intentional (a capture re-creates its own analysis
environment), but it means the working configuration changes underneath you when you browse
archives; the live configuration is restored when you return to 实时 or another capture.

### Import and export

The picker menu offers 导出时间线 (**BIN / TXT / CSV**) and 导出解析结果 (**TXT / CSV**) for
each archived capture. Both need a selected archive, not the realtime buffer, and refuse
with `无法导出` when there is nothing to write.

- **Timeline exports** carry the raw byte stream plus an embedded config snapshot, and can be
  read back with the file input (bottom of the picker). Import validates
  `type: 'WSLTimelineRaw', version: 1` and requires the embedded config
  (`时间线缺少配置快照。` otherwise). Import does not inject bytes into the live session.
- **Analysis exports** are a flat table of successfully parsed frames —
  `Seq, Time(ms), <one column per numeric channel>` — for use in Excel or Python. They
  re-derive from raw bytes using the capture's own rule, and are written to the **same
  filename** as the timeline CSV, so rename one of them if you export both.

Formats are specified in [data-formats.md](data-formats.md).

## Layout, theme and panels

- **Wide / narrow.** At `window.innerWidth <= 720` the app switches to a single-column
  compact layout with a floating configuration sheet (the backdrop dims the log). Resize or
  rotate and the charts re-render to fit.
- **Sidebar.** Clicking the status pill (or pressing Enter/Space on it) collapses the left
  column to icons.
- **Expanded analysis layout** is the 解析 mode toggle at the bottom of the connection panel
  (**图形解析模式**). It also suppresses log timestamps.
- **Send area height** drags between 120 px and the remaining monitor height (default 252 px)
  using the handle above the tiles; the value persists.
- **Theme (主题)** — Follow system (跟随系统) / Light (浅色模式) / Dark (深色模式) in the system
  menu. `prefers-color-scheme` is watched live, and the favicon swaps with the theme so the
  tab stays legible. Charts and terminal colours follow unless a terminal skin is set.
- **Language (语言)** — 中文 / English / Follow system (跟随系统) in the same menu. The switch is
  instant, needs no reload and persists in `serialweb:prefs`; Follow system resolves
  `navigator.language`. Only the interface is translated — received log lines, terminal history,
  names you typed and device data keep the language they were written in.
- **Toasts** auto-dismiss after 10 s, are deduplicated by key, and come in success / warn /
  error kinds.
- The system menu's **下载离线版到本地** fetches the page plus every asset and downloads one
  self-contained `SerialCanvas串口调试.html` you can keep on a laptop or USB stick. It is
  unavailable from an already-offline copy (`file://`).

## Settings persistence and config transfer

Everything — serial framing, display options, parser rule, chart layouts and zoom state,
send queues, terminal font and size, language, theme, panel sizes — is saved to `localStorage` under
`serialweb:prefs`, debounced 500 ms, and flushed again when the page unloads. The schema is
documented in [data-formats.md](data-formats.md#preference-snapshot).

The system menu exposes three transfers, all clipboard-based and all asking for a
confirmation step first (`此操作会丢失当前设置`):

| Action | Behaviour |
| --- | --- |
| Copy (复制配置) | Writes `{type:"SerialWebUserConfig", version:1, exportedAt, userConfig:{…}}` JSON to the clipboard. |
| Paste (粘贴导入) | Reads the clipboard, requires the same `type`/`version`, applies settings live (re-opening the port if framing changed). Failure: `粘贴失败 / 剪贴板中未检测到有效的配置。` |
| Clear (清空配置) | Clears `serialweb:*` and legacy `wsl-*` storage, disconnects, restores factory defaults — language back to Follow system, terminal font and size back to default — plus the seeded example send items, and reopens the version dialog. `已还原 / 已恢复默认配置，仅保留示例项。` |

Copy/paste is the quickest way to hand a colleague an identical parser and chart setup, and
it is also what a captured timeline embeds.

## Keyboard and mouse reference

| Input | Action |
| --- | --- |
| `Esc` | Close the version dialog. |
| `Enter` / `Space` on the status pill | Toggle sidebar collapse. |
| A single printable key, no Ctrl/Alt/Meta, focus outside any input | Fire the matching preset-send item (when the module is enabled). |
| `Enter`, `Backspace`, `Ctrl+U`, `↑`, `↓` in the terminal with echo on | Line editing and history. |
| Drag on a chart's plot | Pan (and release "follow latest"). |
| Drag on a chart's X or Y axis | Zoom that axis. |
| Mouse wheel over a chart | Zoom, 0.96 per notch. |
| `Ctrl` + mouse wheel over the terminal | Terminal font size ±1 px, clamped to 8–48. |
| Drag a chart's top/bottom edge | Resize (≥ 140 px). |
| Drag a send row / schema row | Reorder. |

There is deliberately no Ctrl+Enter send shortcut — the send box is free-form text.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `不支持 Web Serial API` | Firefox/Safari, or a non-secure origin. Use Chrome/Edge over `https://` or `http://localhost`. |
| Chooser lists no port | The device is not exposing a serial interface, or the browser lacks permission for it. Check Device Manager; try another cable (charge-only cables are common). |
| `连接失败 / 串口可能被占用` | Another program holds the port. Close it, or enable 失焦自动断连 to share. |
| Garbage characters | Wrong baud, or wrong 字符编码 for the device. |
| No lines appear, only one long block | The device never sends `\n`/`\r\n`. Splitting is newline-driven — fix the firmware, or read raw hex (十六进制接收). |
| Timestamps disappeared | You are in expanded 解析 layout; timestamps are only drawn in the collapsed 监视 layout. |
| Parser/charts are dead | The monitor is on 终端 — terminal traffic bypasses the analysis pipeline. Switch to 手动收发. |
| Rules stopped matching | Check whether the data source changed; on an ongoing session with more than ~8192 chars of output, use a 录制 archive for a stable dataset. |
| Chart looks steppy or missing spikes | Time-domain plots decimate to ~1.5 points per pixel and hold the last point of each pixel bin — narrow spikes can be dropped. Zoom in, or export the analysis table. |
| Old data vanished from a chart | The chart window is 30 s of history (60 s of raw series, 180 000 points). Archive with REC for long runs. |
| FFT looks empty | Fewer than 4 samples in the window, or the auto-detected frame interval is wrong — set 帧间隔 ms explicitly. |
| Hotkey does not fire | Focus is inside an input/textarea/select, the module is disabled, or two presets share the key. |
| Chinese text is mojibake in an export | Exports are UTF-8 without BOM; open CSVs with an explicit UTF-8 import in Excel. |
