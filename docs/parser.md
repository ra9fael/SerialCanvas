# Parser reference

The parser turns the incoming byte stream into **named numeric channels** that the live
results card and the [charts](charts.md) consume. Two engines share the pipeline:

| Engine | Input | Configured in |
| --- | --- | --- |
| **Text parse (文本解析)** | One decoded line of text per frame. | 配置文本 rule box. |
| **Hex parse (十六进制解析)** | Raw bytes matched against a field table. | 十六进制结构表. |

Switch between them with the tabs in **Parser protocol settings (解析协议设置)**.

- [Text rules](#text-rules)
- [Hex (binary) frames](#hex-binary-frames)
- [Live results panel](#live-results-panel)
- [Limits and gotchas](#limits-and-gotchas)

## Text rules

### Tag vocabulary

A rule is an ordinary string with **markers** inserted where the variable data lives. A
marker is exactly `/` + one of three words + one or more digits:

| Marker | Captures | |
| --- | --- | --- |
| `/intN` | `12`, `-3`, `+7` — no decimal point | integer |
| `/floatN` | `3.14`, `.5`, `3.`, `42` | number |
| `/nameN` | A label such as `温度`, `temp_1`, `chan-A`, or words separated by spaces | text |

Everything between markers is a **literal** and must match the input character for
character (it is regex-escaped, so `=`, `,`, `[`, `(` etc. are safe to write literally).
Spaces and punctuation in the rule are part of the pattern — `=` and `=`␣ are different
rules.

```
/name0=/float0,/name1=/int0;
```

matches

```
temp=3.14,humid=61;
```

### The trailing number binds a name to a value

The digit suffix is what pairs a label with its value. `/name1` labels the value in
`/int1`; `/name2` labels `/float2`. A suffix may be reused (two `/int7` markers are legal)
and does not have to be sequential.

- If a value marker has a same-suffix `/nameN` and that name captured text, the captured
  text **becomes the channel key**. That is how one rule tracks a dynamic label:

  ```
  Rule:   /name0=/int0
  Input:  sensorA=25      ->  channel sensorA = 25
  Input:  sensorB=30      ->  channel sensorB = 30
  ```

- Without a matching name, the key is the marker's own kind and suffix: `int0`, `float1`.
- A `/nameN` with no same-suffix numeric partner produces its own text card (not plottable).
- An optional name that matches nothing falls back to the `kind+index` key, which silently
  splits what you may have intended as one channel into two. Keep names and values paired.

### How a rule is matched

SerialCanvas tries three strategies, in order, and stops at the first that yields anything:

1. **Anchored match.** The rule compiles to `^<pattern>$` (Unicode) and the trimmed line has
   to fit it end to end. This is exact and fastest.
2. **Repeated `name = value` pairs.** If the rule is exactly one `/nameN` followed by one
   numeric marker, the line is scanned globally for further `label=value` pairs of that
   shape, so `/name0=/int0` also parses `temp=42 humid=31 volt=3.3`.
3. **Relaxed token stream.** If the rule has at least one numeric marker, numbers and words
   are tokenised out of the line and consumed left-to-right in rule order, ignoring the
   literals. Values that fail to bind keep nothing; if no numeric value is found at all, the
   line yields no result.

A value that fails to convert to a number is kept as text rather than discarded.
Non-matching lines produce nothing: no gap marker, and the results card keeps showing the
last successful value per key.

### JSON fallback

With an **empty** rule box the parser tries JSON: `JSON.parse` first, then a repair pass for
unquoted keys and single quotes. Objects are flattened with dotted keys (`a.b`), arrays of
objects recurse, numeric array indices render as `arr[0]`. The moment you type any rule, this
fallback is off.

### Line splitting

Frames are delimited by `0x0D`/`0x0A`; a `CRLF` split across two reads is still one frame.
A single physical line longer than **2048 bytes or 2048 characters** is rolled into several
display events, each parsed independently — keep protocol frames well under that. Details in
[user guide § Serial monitor](user-guide.md#line-handling-and-buffering).

### Auto-detect (自动识别)

The button next to the rule box infers a rule from traffic instead of asking you to write one:

1. Take the last **12** lines of the current session (at least two are required).
2. Compare lines pairwise, newest backwards, and find segments whose shape agrees but whose
   values differ.
3. If both lines look like `name=value` pairs with matching names, emit the compact
   `/name0=/<kind>0`. Otherwise rebuild the line, replacing each changing segment with
   `/nameN`, `/intN` or `/floatN`.

A suggested rule is previewed as a **ghost** inside the rule box while you hover or focus the
button. The label reads `自动识别：可用` or `自动识别：不可用`; clicking an unavailable
suggestion does nothing. When the button says 可用 there is a real suggestion — the button is
never truly disabled.

After connecting, if a suggestion exists and differs from your current rule, SerialCanvas raises
an actionable **发现解析可用** toast with two choices: **应用添加并转到** (apply the rule, add
a time chart for every numeric channel, expand the layout) or apply the rule only. The prompt
appears once per connection and only in realtime, text mode, while connected.

## Hex (binary) frames

**Hex parse (十六进制解析)** describes a frame as a table of rows, evaluated top to bottom
against the byte stream. 新增一行 appends a row; rows drag to reorder; the table re-parses
80 ms after any edit.

### Row types

| Row | Field | Behaviour |
| --- | --- | --- |
| 帧头 header | Hex literal, default `A5` | Must match. **Empty = skipped entirely.** The first non-empty header is used as the stream sync marker. |
| 数据 data | Data type + label | Consumes the type's width and emits one channel. |
| 校验和 checksum | Fixed `SUM8` | Consumes 1 byte, compares against the running sum of the data bytes. |
| 间隔符 gap | Optional hex literal | Empty consumes one wildcard byte; filled must match. |
| 帧尾 footer | Hex literal, default `5A` | Must match. **Empty = frame end is not checked** (wide matching). |

A brand-new table seeds `header / data / checksum / footer`.

### Data types

| Type | Bytes | Type | Bytes |
| --- | --- | --- | --- |
| UInt8, Int8, Bool(8bit) | 1 | UInt32 / Int32 / Float32, LE and BE | 4 |
| UInt16 / Int16, LE and BE | 2 | UFloat16 / Float16, LE and BE | 2 |

`LE` is little-endian (low byte first), `BE` big-endian. Float16 is decoded in software,
including subnormals, ±0, ±Inf and NaN; `UFloat16` ignores the sign bit. There are no 64-bit
integers, no Float64 and no string/array fields.

**Bool(8bit)** is the interesting one: it emits the parent channel as an 8-character bit
string **plus** eight numeric children `label.0 … label.7` (0/1), so a status register becomes
eight plottable flags. The children are named from the row's label, so give it a short one.

### Framing and resync

Frames are located by searching for the sync header, then walking the schema from there:

- Enough bytes and everything matches → frame emitted, scan resumes after it.
- Not enough bytes yet → the tail is retained and parsing waits for the next chunk (a frame
  may straddle any number of reads).
- Literal mismatch → advance **one byte** and search for the header again. Corrupt or
  interleaved data is skipped, and the parser re-syncs on the next header.
- If the header never appears, only the last `max(32, headerLength-1)` bytes are kept, so
  idle garbage cannot grow the buffer.

**Only RX is parsed.** Transmitted bytes are archived and displayed but not run through the
schema.

### Checksum

One algorithm is implemented: **SUM8** — the low byte of the arithmetic sum of all `data`
row bytes (header, footer and gap bytes excluded, `bool8` contributing its raw byte).

A checksum row behaves as data, not as a gate: the received byte becomes a numeric channel
(named `checksum` by default) and the results card turns green on match or red showing
`expected!=received`. **A bad checksum does not reject the frame** — if you want to discard
corrupt frames, filter them downstream in your own analysis.

### Channels

Every `data` row label becomes `parsed.<label>`; auto-naming follows the row's position among
data rows (`int0`, `uint1`, `float2`, `bool3`) until you type a name. Labels are what the
chart picker and exports show, so prefer stable ASCII names with no dots.

## Live results panel

**Realtime parsed results (实时解析结果)** shows one card per key, in first-seen order:
`key` above, value below, coloured to match the channel's curve in the charts.

- Values are **last-write-wins and sticky**: a card keeps its final value when the field stops
  arriving; the map is only emptied by 清空缓存 or a reset.
- Before any match, the panel shows placeholders (`-`), derived from the rule tags in text
  mode or from the schema labels in hex mode, so the expected layout is visible immediately.
- A horizontal scrollbar appears only when the row actually overflows; **展开 / 折叠** then
  grows the card into multiple rows.
- Numeric cards feed the charts and the analysis export. Text cards (names, bit strings) are
  tracked as channels but cannot be plotted.
- Raw helper fields (`raw.*`) exist internally for statistics but are neither plotted nor
  exported.

## Limits and gotchas

| Limit | Value | Consequence |
| --- | --- | --- |
| Live text analysed | last 320 events | Realtime parsing ignores older buffered lines. |
| Timeline text re-parse | last 12 000 chunks | Very long archives chart only their tail (the analysis *export* has no such cap). |
| Timeline binary re-parse | last 24 000 chunks | as above. |
| Frame size | 2048 bytes / chars | Longer lines are split into several frames. |
| Live buffer | 8192 decoded chars | The monitor is not an archive — record with `REC`. |
| Match modes | substring only | 触发发送 has no exact-match or regex option. |
| Checksum | SUM8 only | No CRC variants. |

Practical notes:

- Anchor rules with as much literal text as the protocol actually carries. `/float0` alone
  matches any number and the relaxed fallback will pick something out of noise.
- The trailing-newline is stripped before matching — do not put `\n` in a rule.
- Changing a rule re-derives from the retained buffer, so results update backwards as well
  as forwards (within the caps above).
- Terminal view bypasses the parser entirely
  ([user guide](user-guide.md#terminal-view)).
- Text parsing honours the **字符编码** setting; hex parsing does not, because it reads raw
  bytes.

## Simulation source

The simulator generates RX locally so the parser, the live results and the
charts can be exercised with no device attached. Frames go through the same
`queueRxBytes()` entry point the serial reader uses, so line splitting,
parsing, recording and chart painting behave exactly as they do for real
traffic. It yields automatically while a port is open.

It is the first of the three parts of the parse view (simulator → parser →
charts), because it is where the bytes come from.

### Scripts

| Script | Sends |
| --- | --- |
| 文本：传感器读数 | `temp=21.0,humid=54;` |
| 文本：JSON 负载 | `{"device":"sim-01","uptime":0,"temp":21.0}` |
| 二进制：A5 帧 | `A5 <t> <h> <sum> 5A` |

Selecting the binary script also fills the structure table with the schema it
needs, so it decodes without hand-building one first.

### Payload and frame templates

Each box is seeded with the chosen script's default, so the format is visible
and editable instead of hinted at. Only the template that applies to the
current script is shown — text scripts get the payload template, the binary
script gets the frame template — and 恢复默认 puts the default back. A template
you typed survives a script switch.

Payload placeholders (text scripts):

| Placeholder | Expands to |
| --- | --- |
| `{temp}` | temperature, one decimal |
| `{hum}` | humidity, integer |
| `{n}` | frame counter |
| `{tick}` | the same value as `{n}`, kept as an alias |
| `{ts}` | total frames emitted this session |

Frame placeholders (binary script): `{t}` temperature ×10, `{h}` humidity,
`{n}` counter, `{sum}` SUM8 of the placeholder-produced bytes only — the same
domain the checksum row uses, so the frame decodes with a valid checksum.
Literal hex groups (the `A5` header, the `5A` footer) are framing and are not
summed.

下一帧预览 shows the exact text or bytes the next tick will emit, expanded with
the current template. Without it a mistyped placeholder is indistinguishable
from a stalled simulator.
