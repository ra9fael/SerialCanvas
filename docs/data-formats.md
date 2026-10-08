# Data formats

Everything SerialCanvas writes or persists, so captures and configurations can be read by other
tools.

- [Browser storage](#browser-storage)
- [Preference snapshot](#preference-snapshot)
- [User config transfer](#user-config-transfer)
- [Timeline files](#timeline-files)
- [Analysis export](#analysis-export)
- [Round-trip caveats](#round-trip-caveats)

## Browser storage

| Key | Written by | Purpose |
| --- | --- | --- |
| `serialweb:prefs` | The app (debounced 500 ms, flushed on unload) | The whole working configuration — schema below. Read by `bootstrap.js` before first paint to apply theme and layout. |
| `serialweb:version-modal-seen` | The app | Holds the version string of the release whose notes were dismissed, so the dialog does not reopen on every load. |
| `wsl-layout` | Legacy | Read by nothing; deleted at startup and swept on reset. Older builds used it. |

`Reset config (清空配置)` removes those keys plus **any** key beginning with `serialweb:` or
`wsl-` in both `localStorage` and `sessionStorage`. No cookies, no IndexedDB.

## Preference snapshot

`serialweb:prefs` is a single JSON object. Unknown keys are ignored on read, and each section
falls back to defaults independently, so hand-editing or trimming it is safe.

```jsonc
{
  "appVersion": "0.4.1",
  "receiveContentSchemaVersion": 1,
  "savedAt": 1767100000000,          // Date.now(), informational only
  "theme": "system",                 // "system" | "light" | "dark"
  "locale": "system",                // "system" | "zh" | "en" — interface language

  "layout": {
    "expanded": false,               // false = 监视, true = 解析 layout
    "monitorView": "terminal",       // "terminal" | "manual"
    "terminalFont": "",              // CSS font-family, "" = default; unset families are rejected by the picker
    "terminalFontSize": 12,          // px, clamped to 8-48
    "terminalSkin": "",              // "" | green | black-white | dracula | solarized-dark | solarized-light | one-dark
    "terminalNewline": "n",          // "n" | "rn" | "r" | "none"
    "sidebarCollapsed": false,
    "parserResultsExpanded": false,
    "sendExtensionHeight": 0         // px, 0 = default (252)
  },

  "settings": {
    "baudRate": "115200",            // stored as a string
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
    "binary": { "rows": [ /* schema rows, see below */ ] }
  },

  "charts": [ /* one entry per chart panel, see below */ ],

  "modules": { "autoSendOpen": false, "conditionSendOpen": false, "presetSendOpen": false },

  "autoSend": {
    "enabled": false,
    "intervalMs": 1000,              // floor 100
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

**Every send/schema field keeps a raw-hex twin.** `payload`/`pattern`/`response`/`expected`
hold the *displayed* text, and `…RawHex` holds the exact bytes that were typed. This is what
lets a value survive toggling 十六进制发送 and lets a text-mode payload contain bytes that no
encoding can round-trip. When you write these by hand, set both consistently; if only the text
field is present, the hex twin is derived from it using the current encoding.

A binary schema row:

```jsonc
{ "id": "binary-3", "kind": "data",            // header | footer | data | checksum | gap
  "value": "",                                  // hex literal for header/footer/gap
  "dataType": "float32le",                      // data rows only
  "name": "vout", "nameAuto": false }
```

A chart entry records type, title, panel height, `alignScale`, `fftWindow`,
`fftFrameIntervalMs`, the binding list, the selected Y-axis owner, per-binding Y views, and
the view state (`viewMode`, `viewZoomX/Y`, `viewOffsetX/Y`, `viewFollowLatestX`, and the
`viewBase*` snapshot the **AUTO** button restores).

## User config transfer

**Copy config (复制配置)** puts this envelope on the clipboard as JSON — the same payload type
embedded in every timeline export:

```jsonc
{
  "type": "SerialWebUserConfig",
  "version": 1,
  "exportedAt": 1767100000000,
  "exportedAtText": "2026-01-01 08:00:00",
  "userConfig": { /* preference snapshot, exactly as above */ }
}
```

**Paste import (粘贴导入)** requires `type === "SerialWebUserConfig"` **and**
`version === 1`; anything else is rejected with `剪贴板中未检测到有效的配置。` On success the
settings are applied immediately, which includes re-opening the serial port if framing
changed. There is no migration path for future versions — a v2 file will not load in the current release.

## Timeline files

A timeline is a captured byte stream plus the configuration needed to re-derive its analysis.
Logical model:

```jsonc
{
  "type": "WSLTimelineRaw",
  "version": 1,
  "name": "REC-01-20260101-080000",
  "createdAt": 1767100000000,
  "createdAtText": "2026-01-01 08:00:00",
  "textEncoding": "utf-8",
  "startUnixUs": 1767100000000000,   // microseconds since epoch
  "durationUs": 12500000,            // microseconds
  "graphConfig": { "version": 2, "userConfig": { /* config snapshot */ } }
  // plus the chunk list: { relativeUs, direction: "rx"|"tx", bytes }
}
```

Timestamps are microseconds derived from `performance.timeOrigin + performance.now()`, so they
are monotonic and wall-clock aligned to the machine that recorded them. All three exports
carry the same fields — only the container differs. **Detection on import is by content, not
extension.**

### `.bin` — preferred

Little-endian throughout.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | Magic `57 53 4C 42 49 4E 31 00` (`WSLBIN1\0`) |
| 8 | 4 | `uint32` metaLength |
| 12 | metaLength | UTF-8 JSON metadata (the object above, without the chunk list) |
| 12+metaLength | 4 | `uint32` chunkCount |
| then | 8 | `uint64` relativeUs (µs from `startUnixUs`) |
| | 1 | `uint8` direction — `0` = rx, `1` = tx |
| | 4 | `uint32` byteLength |
| | n | raw payload bytes |

Reader sketch:

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

### `.csv` — text container for the same data

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

- One line per metadata key; the value is the text **after the first comma**.
- `NAME`, `CREATED_AT_TEXT`, `TEXT_ENCODING` and `GRAPH` are base64 of UTF-8
  (`btoa(unescape(encodeURIComponent(s)))`) so that Chinese names and the JSON blob cannot
  break the line format.
- `direction` is the literal `rx` or `tx`; `hex` is compact lowercase-free **uppercase hex
  with no separators**.
- LF line endings, no BOM.

### `.txt`

Same fields, space-separated instead of comma-separated (value is the text after the
**first space**), header `#WSL-TIMELINE TXT1`, then a `#DATA` marker line, then
`<relative_us> <rx|tx> <compact hex>` rows.

### Import

`Import timeline (导入时间线)` accepts `.csv`, `.txt`, `.bin` and `.timeline` in the picker,
then routes on content: BIN magic → `WSLBIN1` parser; `#WSL-TIMELINE,CSV1` → CSV;
`#WSL-TIMELINE TXT1` → TXT. Anything else fails with
`仅支持 BIN / TXT / CSV version 1 时间线文件。` A `.timeline` file therefore has to actually be
one of those three — the extension carries no meaning.

Requirements on the payload: `type: "WSLTimelineRaw"`, `version: 1`, and a present
`graphConfig.userConfig` (`时间线缺少配置快照。` otherwise). Importing allocates fresh chunk
ids, converts µs to ms, takes
`durationMs = max(1, payloadDuration, lastChunkRelative)`, appends the archive and selects it,
which applies the embedded parser, chart and send configuration. Recorded bytes are **not**
merged into the live session, and the import does not persist the applied configuration to
`localStorage`.

## Analysis export

**Export parsed results (导出解析结果 → TXT / CSV)** is a flat frame table for spreadsheets and
scripting — not a timeline, and not re-importable.

```
Seq,Time(ms),vout,ibat,flags.0
0,0.0,3.2981,0.121,1
1,20.0,3.2974,0.119,1
```

- Header is `Seq,Time(ms),` followed by one column per **numeric** channel, in the order the
  channels were first seen. TXT joins the same cells with tabs.
- `Time(ms)` is `frameIndex × frame interval` with one decimal — the derived cadence, not a
  per-frame timestamp.
- Only frames with at least one numeric value are listed; non-finite cells are written empty.
  Text channels (names, the 8-character `bool8` parent) are omitted.
- It re-parses the archive's **raw bytes with the rule embedded in that archive**, independent
  of what the rule box currently says, and applies no chunk-count cap — so it can contain more
  frames than the charts show.
- Export is refused (`无法导出`) when the table would be empty.

## Round-trip caveats

| Caveat | Detail |
| --- | --- |
| Per-chunk metadata is lost | BIN/TXT/CSV store direction and bytes only. In-app monitor tags produced by 触发发送 and 预设发送 (and their `√`/`×` status) do not survive an export/import cycle. |
| Timeline CSV vs analysis CSV | Both are named `<capture>.csv` and will overwrite each other in your downloads folder. Rename one. |
| Configuration overwrite | Selecting an archive applies its embedded config; returning to 实时 or another archive applies that one's. Copy config first if you want to keep your current setup. |
| Version field | Both envelopes pin `version: 1`; forward compatibility is not attempted. |
| Encoding | Metadata is UTF-8. TXT/CSV metadata values are base64, so grepping a CSV for a Chinese name finds nothing — decode the `#NAME` field. |
| Clock | `startUnixUs` is the recording machine's wall clock; relative offsets are authoritative, absolute times are only as good as that clock. |
