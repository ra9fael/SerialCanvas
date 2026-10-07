# Four more issues — toolbar heights, redundant panel, simulator, key bar

Branch: `feat/modernist-ui`. Follow-up to `docs/five-issues-plan.md`.

Measurements from `audit/measure-toolbar-controls.mjs`,
`audit/probe-a5.mjs` and the source. One report is corrected, and one turns out
to be a design decision worth revisiting rather than a defect.

---

## 1. Toolbar controls are four different heights (real)

Measured at 1600x1000 with a selector that picks up **every** visible control,
not just the labelled chips:

| Height | Count | What | Source |
| --- | --- | --- | --- |
| 39px | 1 | 导出日志 / Export log | `.secondary-btn` has `padding: 10px 16px` and no height |
| 34px | 6 | 字号, 回滚行数, 日志字符, 换行, 字体, 主题 | `.term-field` has `min-height: 30px`, but the 32px custom-select trigger inside it plus 1px borders push the row to 34 |
| 32px | 6 | the six `<select>` triggers | `--control-h` |
| 30px | 4 | 视图切换 (2), Echo, 清空缓存 | `min-height: 30px` |

Four heights, three different mechanisms, and the two buttons you named are on
different rows from the selects next to them.

### Fix

`--control-h-sm` already exists (28px) for the dense toolbar chips; the toolbar
should use **one** value, not three. 32px, matching `--control-h`:

- `.secondary-btn` / `.mode-tab` in the toolbar: replace the padding arithmetic
  with `height: var(--control-h)` + `padding: 0 10px`. The global
  `.secondary-btn` keeps its padding — this is a toolbar-scoped override,
  because the same class is used at other sizes elsewhere (the chart strip, the
  send panel) where 39px is right.
- `.term-field`: the 34px comes from wrapping a 32px trigger in a box that has
  its own `min-height` and padding. Two options:
  - give `.term-field` `height: var(--control-h)` and let the trigger fill it,
    so the chip becomes a frame around the control rather than a box that
    contains it — the cleaner outcome, and the one that matches how
    `.toggle-row` works after `2375f30`;
  - or drop `.term-field` for the bare trigger where there is no checkbox, which
    saves 2px of border and a layer.

  I would do the first for anything with a label and the second for the
  bare-select cases, so the row mixes framed chips with bare triggers only where
  the distinction carries meaning (a labelled field vs an anonymous one).

One caveat, stated because it was measured: the toolbar already stacks to
3–4 lines at 1280–1440px (`audit/measure-toolbar.mjs`). Unifying the heights
reduces the row height by 7px but does not change the line count, and an
attempt to compress the wrapping during this phase introduced an overflowing
control at 1280px and was reverted. Fixing the wrapping is a separate piece of
work, listed in section 5.

---

## 2. The protocol settings panel is now redundant

Agreed, and this is a consequence of what we just did rather than a separate
observation.

Before `8a0effd` the rail showed only the connection panel, and the parser
settings were reachable through the graph-parsing toggle. `8a0effd` made the
parser panel the default occupant of the rail's second row, so the rail now
shows:

```
设备连接管理      connection: baud, framing, flow control, signals
协议设置          parser mode, rule box, binary schema
实时解析结果      live cards, simulator
```

That is a fair reading — but you are looking at a third of the screen
dedicated to parser configuration, and the tool's primary job is the serial
console. In practice the parser panel is needed when setting up a protocol and
invisible afterwards.

### Options

| Option | Effect | Cost |
| --- | --- | --- |
| **Collapse it to a header strip** — title plus a toggle, body hidden until expanded | Rail returns to connection + results, parser settings one click away | An extra state to remember per session |
| **Collapse it when idle** — auto-collapse after N seconds without RX, expand on RX or click | Same, without the user doing anything | "Idle" is a judgement call; a slow device would keep it collapsed |
| **Move it to a modal** | Rail is fully connection + results | The rule box is a multi-line editor with syntax highlighting and inline help; a modal is cramped for it and loses the side-by-side with results |

I recommend the first with the state persisted in `layout.parserPanelOpen`,
defaulting to collapsed. Persisting matters: someone who configures a protocol
once a week does not want to re-open it every session.

**The honest counter-argument**: the simulator lives inside the results card,
so collapsing the parser hides the two things a newcomer should try together.
Worth keeping `模拟数据` reachable from the collapsed strip.

---

## 3. Simulation needs configuration, and the A5 frame does not parse

Two separate problems. The second is a real defect I introduced.

### 3a. The A5 frame cannot be parsed — confirmed by measurement

With simulation on, script `binary-frame`, parser mode `binary`:

```
rxRows: 2          the data IS arriving
parseCards: 2      ["int0  -", "checksum  -"]
```

Both card values are empty, so the frame is being received and not decoded.

**Root cause: the script and the default schema do not match.**

| | Script emits | Default schema expects |
| --- | --- | --- |
| header | `A5` | `A5` ✓ |
| data | **two bytes** (`temp*10`, `hum`) | **one `int8` row** |
| checksum | `SUM8` | `SUM8` ✓ |
| footer | `5A` | `5A` ✓ |

The script's own comment claims it "matches the default seeded schema", and
that claim is false: `state.parser.binarySchema` defaults to `[]`
(`app.core.js:486`). `ensureBinarySchemaRow()` seeds
`header / data / checksum / footer` — **one** data row — but only when the
binary pane is rendered, which is behind the graph-parsing toggle. So in the
default view there is no schema at all.

This is the second time I wrote a comment asserting a match I had not verified
(the first was `#term-newline` in the B1 plan). **A comment claiming two things
correspond is a claim that needs a test.**

### Fix for 3a

Two changes, and both are worth doing:

1. **Make the script match a one-row schema** — use `uint16le` for a single data
   field packing both bytes, or emit one data byte. Cheapest, and keeps the
   default schema untouched.
2. **Better: have the binary script declare the schema it needs**, and apply it
   when the script is selected. The simulator's whole purpose is to make the
   parser demonstrable, so it should not require the user to hand-build a
   structure table to see a decoded value. Selecting `binary-frame` fills the
   schema table with the matching rows.

I would do 2, and keep 1 as the schema it writes (one `uint16le` row named
`reading`, plus a second row if you want both values separately — the type list
already has `uint8`/`uint16le`/`float16le`/`float32le`).

Verification: the binary cards must show a **changing number**, not `-`. That is
the assertion that would have caught this.

### 3b. Configuration

Currently the only knobs are on/off and script choice (`SIMULATION_SCRIPT_IDS`,
`app.core.js:96`). What is worth adding, in value order:

| Knob | Why | Cost |
| --- | --- | --- |
| **Tick interval** | 700ms is arbitrary. A fast protocol demo at 60ms and a slow sensor at 5s are both plausible; today neither is reachable | One `<select>`, persisted |
| **Burst size** | Devices rarely emit exactly one frame per poll. 1/4/16 frames per tick shows how the parser handles a backlog | One `<select>`, multiplies `queueRxBytes` calls |
| **Payload template** (`{temp}`, `{hum}`, `{n}`, `{ts}`) | This is what makes the simulator useful for testing a *real* rule: type your device's actual field names and check the parser handles them | A text input plus a safe expansion step — the result must still go through `encodeText`, never `innerHTML` |
| **Seed / pattern** (sine, sawtooth, random walk, constant) | Sine and constant look identical after 3 samples; random walk and step changes expose parser edge cases | One `<select>` |

I would ship **interval + burst + template**, and skip seed/pattern — the
template with `{n}` covers most of what a pattern selector would demonstrate,
and pattern choice is the least discoverable control in the panel.

The template expansion is the one with a real risk: it must be a plain string
substitution on the encoded bytes, never HTML. Everything the simulator emits
goes through `queueRxBytes()`, so a template that produces binary frames would
need an encoding mode — I would keep templates text-only and let the binary
script stay fixed.

---

## 4. More keys on the bar, including Enter

Agreed. 34 keys, and Enter is the conspicuous absence.

### Enter is already handled correctly

`handleTermData` treats a bare `\r` specially:

```js
if (data === '\r') {
  return getTermLineEnding() || '\r';   // follows the user's newline setting
}
```

So an Enter button must send `\r`, and it will honour the 换行 dropdown
(`none` / `\r` / `\n` / `\r\n`) rather than hard-coding one. That is the right
behaviour and worth stating: **the button sends a carriage return, not a
"line ending", so the existing setting keeps working.**

### What to add

| Key | Byte | Why |
| --- | --- | --- |
| **Enter** | `\r` | the missing primary key |
| **Shift-Tab** | `\x1b[Z` | reverse tab — the only way past a completion menu in a readline context |
| **Ctrl-Enter** / **Alt-Enter** | `\x1b\r` / `\x1b\x0d` | shells bind these to accept-line without executing; useful when a multi-line command is staged |
| **Ctrl-Left / Ctrl-Right** | `\x1b[1;5D` / `\x1b[1;5C` | word motion; Alt-B/F already cover the classic binding but the arrows are what people actually press |
| **Insert** | `\x1b[2~` | the remaining navigation key xterm reports |
| **F1–F4** | `\x1bOP`–`\x1bOS` | xterm's application-mode form; some firmware menus bind these |

That takes the bar from 34 to **44**.

### Grouping

Current: 导航 / 编辑 / 历史与补全 / 控制字节. Add:

| Group | Keys |
| --- | --- |
| **提交** (new, first) | Enter, Ctrl-Enter, Alt-Enter |
| 导航 | + Ctrl-Left, Ctrl-Right, Insert, Shift-Tab, F1–F4 |

Enter goes first and alone: it is the only key that submits a line, and burying
it in a group would be a mistake. It should be the widest button on the bar.

### Two constraints that still hold

1. **No bare letters** — preset send claims single keypresses on `document`.
2. **The paste buffer is flushed first**, so ordering is preserved. Relevant
   here: Enter after a burst of text must not overtake it.

---

## 5. Not in this batch

- **Toolbar wrapping.** 3–4 lines at 1280–1440px, measured. An attempt to fix
  it this phase produced an overflowing control at 1280px and was reverted. It
  needs the wrapping decided first, not the heights.
- **The 69 remaining indigo literals** (`rgba(86, 114, 205, ...)`) in focus
  rings and menu highlights. Still Phase 2's rgba sweep.
- **`--danger-soft`**, referenced with a literal fallback in `5a48803`.

---

## Order

| # | Item | Risk |
| --- | --- | --- |
| 1 | A5 frame decodes (3a) | Low — and it is a defect, so it goes first |
| 2 | Toolbar heights (1) | Low |
| 3 | More keys (4) | Low — table extension |
| 4 | Simulator configuration (3b) | Medium — the template expansion needs care |
| 5 | Parser panel collapse (2) | Medium — needs a decision on the default |

3a first because it is a defect in something already shipped, and because its
verification (a changing number instead of `-`) is unambiguous.

---

## Open decisions

1. **Parser panel default** — collapsed or open? And is the simulator reachable
   from the collapsed strip?
2. **Simulator knobs** — interval + burst + template as proposed, or fewer?
3. **Template syntax** — `{temp}` / `{n}` style, or positional `%d`?
4. **Enter in the key bar** — as a wide primary button, or the same size as the
   rest?
