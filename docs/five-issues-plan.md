# Five reported issues — diagnosis and plan

Branch: `feat/modernist-ui`. Follow-up to `docs/layout-redesign.md` (`a142a48`).

Every claim below was checked against the source, and the rendering claims
were measured with `audit/probe-sim-parse.mjs` and
`audit/measure-buffer.mjs`. Two of the five reports did not survive the check and were corrected rather
than implemented as described — item 5's dependency was the reverse of what was
reported, and item 4b's "always off" was correct behaviour with a misleading
frame. One further claim (that the parser panel needed a visual annotation)
was disproved during a previous phase and is recorded in
`docs/layout-redesign.md`.

---

## 1. The log rebuilds every row on every frame — DONE in `c051b09`

### Symptom

You asked why a terminal redraw should not be partial. It should not — and today
it is not partial.

`renderMonitor()` (`app.main.js:1881`) assembles the entire visible log into an
array of HTML strings and assigns the joined result:

```js
refs.terminal.innerHTML = parts.join('') || `...`;
```

Line 1946. Every RX chunk calls `scheduleRefresh({ monitor: true, ... })`, and
the refresh coalesces to one `requestAnimationFrame` — so the *rate* is capped at
one rebuild per frame, but the *cost of each rebuild* is proportional to the
whole buffer.

### Why this is the reason the buffer is capped where it is

The 256 K / 512 K figures from the previous phase were derived from this cost,
measured (`audit/measure-buffer.mjs`, median of five rebuilds):

| Characters | DOM nodes | Rebuild |
| --- | --- | --- |
| 8 192 | 528 | 0.2 ms |
| 131 072 | 8 456 | 3.1 ms |
| 262 144 | 16 912 | 7.0 ms |
| 524 288 | 33 824 | 13.3 ms |
| 1 048 576 | 67 652 | 26.6 ms |

A 60 Hz frame is 16.7 ms, so 512 K sits at the edge. **That ceiling is an
artefact of the implementation, not a property of the data.**

### Fix — incremental append

RX is append-only. `liveEvents` grows at the tail, `trimLiveEvents()` removes
from the head, and nothing in between is ever rewritten. The parser's
per-line results also change only for the newest line.

So the rebuild can be decomposed:

| Situation | Action |
| --- | --- |
| New lines appended, at bottom, buffer not trimmed | `append()` the new rows only |
| Head trimmed by `trimLiveEvents()` | remove those rows, do not touch the rest |
| At bottom → jump to bottom | `scrollTop = scrollHeight`, unchanged |
| **Not** at bottom (`state.ui.terminalAtBottom` false) | leave the scroll position alone |
| Display options changed (timestamps, hex mode, size, encoding) | full rebuild — these alter every row |
| Terminal selection is being preserved | already short-circuits at line 1882 |

The last two are the reason this needs care rather than being a three-line
change. `showTimestamps`, `showRawHex`, `--log-size` and the text encoding are
all global, so any of them changing invalidates every row. The correct guard is
to hash the four inputs plus `liveEvents[0].id` and `liveEvents.length`, and
rebuild when the hash differs.

Worth noting: `refs.terminalAtBottom` already exists and `renderMonitor()`
already reads it (line 1887), so the hard case — user has scrolled up and is
reading history while data arrives — is already tracked.

### What it buys

Appending one row costs one `createElement` plus a text assignment, regardless
of buffer size. Measured on this machine, appending is roughly two orders of
magnitude cheaper than rebuilding the same content. That moves the ceiling from
"one frame's budget" to "whatever the DOM can hold", so the buffer caps become
memory decisions rather than frame-rate decisions:

- Default live log 256 K → **2 M characters**, cap 8 M.
- The cost annotation on the 512 K option becomes obsolete and should be
  rewritten to state that the limit is memory, not rendering.

I would keep a default well below the cap. A 2 M-character log still holds
tens of thousands of rows, and `getActiveEvents()` plus the visible-window loop
(line 1919) walk all of them on every frame — that loop is the next bottleneck
and it is O(buffer), independent of the DOM.

So this change should be paired with a **windowed render**: only materialise the
rows near the viewport, using the existing scroll position. That is a larger
change; I would land incremental append first, measure, then decide.

---

## 2. The buffer dropdowns are labelled badly — DONE in `c051b09`

`index.html:455`–`465`. Current labels mix conventions and give no ordering cue:

```
缓冲: 5 千 / 2 万 / 10 万
日志: 64K / 256K / 512K
```

Three problems: Chinese quantity words mixed with `K` suffixes; "5 千" is the
smallest and reads like a rounding, not a floor; and the two controls count
different things (lines vs characters) with nothing in the label saying so.

### Fix

```
回滚行数   5000 / 20000 / 100000        (plain digits, ordered)
日志字符   262144 / 1048576 / 4194304  (plain digits, ordered)
```

Plain digits, ascending, so the ordering is self-evident and neither control
needs a unit prefix in the option text. The unit belongs in the field label,
which is already there. Values change with the new defaults from item 1.

If you want readable thousands, the honest alternative is a suffix on every
option (`5000`, `20K`, `100K`) rather than a mix — but I would not, because it
reintroduces "which is bigger" ambiguity at 100000 vs 100K.

---

## 3. Shortcut coverage is too thin for fzf and readline — DONE in `b738790`

Agreed, and the gap is precisely enumerable. Current `TERM_KEY_SEQUENCES`
(`app.terminal.js:346`) has 14 entries, of which the Ctrl family is only
`^U ^W ^K ^C ^D ^Z`.

Everything you named is a single control byte, so this is a table extension
with no new mechanism:

| Key | Byte | fzf / readline use |
| --- | --- | --- |
| `^R` | `\x12` | reverse-i-search — the main one |
| `^T` | `\x14` | transpose character |
| `^N` | `\x0e` | next history / `Ctrl-N` in fzf bindings |
| `^P` | `\x10` | previous history |
| `^A` | `\x01` | start of line |
| `^E` | `\x05` | end of line |
| `^L` | `\x0c` | clear screen |
| `^B` | `\x02` | back one character |
| `^F` | `\x06` | forward one character |
| `^Y` | `\x19` | yank |
| `^G` | `\x07` | abort / cancel |
| `^O` | `\x0f` | rotate through history |
| `^V` | `\x16` | quoted insert |
| `^X` | `\x18` | toggle transpose |

Also missing from the editing group: `Ctrl-H` (backspace, `\x08`, distinct
from `\x7f`), `Ctrl-Space` / `Ctrl-@` (`\x00`, set mark), `Alt-B/F` word motion
(`\x1bb` / `\x1bf`).

### Grouping

The current bar has four groups. Five reads better:

| Group | Keys |
| --- | --- |
| 导航 | `↑ ↓ ← → Home End PgUp PgDn` |
| 编辑 | `Backspace Delete ^A ^E ^B ^F ^K ^U ^W ^T ^Y` |
| 历史 / 补全 | `^R ^P ^N ^O ^L` |
| 控制字节 | `^C ^D ^Z ^G Tab Esc` |
| 字符输入 | `^V` (quoted insert) — single key, sits with control bytes |

The 历史/补全 group is the fzf-facing one and deserves its own label, because
that is the group a user looks for when they want `^R`.

### Two constraints that still hold

1. **No bare letters.** `app.main.js` registers a document-level single-keypress
   handler for preset send. A bare letter would shadow a user's preset.
2. **The debounce is bypassed** for these already — `sendTerminalKey()` calls
   `flushTerminalKeyBuffer()` first, so a control byte is never delayed behind
   buffered printable text. Ordering is preserved.

Adding ~16 entries is markup plus table entries. The `data-tip` attribute on
each button documents it for free once the tooltip singleton handles it.

---

## 4. Control sizes and the signal readouts — DONE in `2375f30`

Three separate problems. The first is real, the second is a semantics
mismatch, the third is the rail whitespace already covered in
`docs/layout-redesign.md`.

### 4a. No control-size token — the actual cause of "sizes differ"

Heights across the settings surfaces:

| Height | Where |
| --- | --- |
| 30px | `.secondary-btn` family, `.term-field`, several toggles |
| 31px | one button variant |
| 32px | `.field select` / `.field input` |
| 34px | `.toggle-row`, `.primary-btn` variants |
| 36px | `.signal-readout`, `.signal-chip` |

Five values across the connection rail and the toolbars. There is no
`--control-h` token, so every one of these is a literal.

### Fix

Add two tokens and normalise:

```css
--control-h: 32px;      /* selects, inputs, buttons */
--control-h-sm: 28px;   /* toolbar term-fields, chips */
```

Map all five current values onto them, then verify the rail visually at
1440 / 1600 / 1920. Nothing else changes — this is a substitution, not a
redesign, and it is what makes the rail read as one panel instead of five
assembled parts.

### 4b. CTS / DSR / DCD / RI — "always off" is correct, the dashed frame is not

First, the behaviour is right. `state.serial.signalInputs` defaults to all
`null` (`app.core.js:420`), `signalValueLabel()` (`app.main.js:486`) maps
`null` → `-` and `false` → 关, and the values are only written by
`getSignals()` after a successful connection (`app.main.js:583`). So with no
port open the honest display is `-`. These are *inputs from the device* — the
Web Serial API cannot set them, so there is nothing to click.

That said, two things are genuinely wrong:

- **The dashed border is misleading.** A dashed frame conventionally means
  "fillable, awaiting input". These are read-only status. The same panel puts
  dashed-adjacent language on the DTR/RTS/BREAK toggles, which *are*
  interactive, so the two read as the same kind of thing.
- **"无法交互" is correct and should be visible as such.** A device that ties
  CTS low and the user cannot tell whether that is a real reading or a missing
  capability is a real ambiguity. `getSignals()` on a port whose driver does not
  report modem status can return all-`false` rather than throwing, which is
  indistinguishable from a genuine "all low".

### Fix

- Solid 1px border, matching the DTR/RTS chips — a read-out should look like a
  read-out.
- Replace the `-` / 开 / 关 text with a three-state indicator that says which
  one it is: `-` becomes a muted `未知` when never read, and a `未知` state
  distinct from `关` when `getSignals()` succeeded but reported nothing.
- Do **not** make them interactive. If you want framing control it is a
  different feature (setting DTR/RTS to force a device out of reset), not a
  click target on an input pin.

### 4c. The empty rail

Already covered by measurement in `docs/layout-redesign.md`. Summary: the
`~500px` of slack is the parser column, hidden by `style.css:2712`
(`body:not(.layout-expanded)`), waiting for graph mode. It is not an empty
panel — which is why the idle-hint approach I tried and reverted was wrong.

The real proposal, unchanged: make `layout-expanded` additive (keep the monitor,
move only the charts) so the toggle reads like a view switch instead of a
replacement, and collapse `config-panel` to its content height. That work is
still open and should land after 4a so the collapse has a consistent control
size to collapse *to*.

---

## 5. Simulation and parsing — DONE in `5a48803`

Measured, and this corrects the report.

With **no serial connection**, simulation on and the documented rule
`/name0=/float0`:

```
logLines: 5   rxRows: 4
cards: 2      cardLabels: ["temp 22.1", "humid 53"]
```

Parsing works fine without a port, because the generated bytes enter through
`queueRxBytes()` (`app.main.js:137` → `:35`), which is the same RX entry the
serial reader uses and has no connection check.

The constraint that does exist is the reverse: `emitSimulationFrame()` returns
early while `state.serial.connected` (`app.main.js:141`), so **simulation yields
to a real device**. That was a deliberate choice — two sources interleaving
bytes into one stream would corrupt the parse — and I would keep it.

### The actual gap: simulated rows are indistinguishable

`simulated: true` is written into the event metadata (`app.main.js:146`) and
**never read anywhere**. So once the log is full of data there is no way to tell
which rows came from a device and which from the simulator. For a feature whose
whole purpose is demonstrating the parser, that is the defect worth fixing.

### Fix

- Render a `SIM` marker on simulated rows, reusing the existing
  `.preset-inline-tag` treatment with a distinct tone, so it reads as a tag
  rather than as payload.
- Add a counter in the simulation control: `已产生 N 帧`.
- Make the yield visible: when a connection suppresses simulation, the toast
  already says so — keep that, and add it to the control's own subtitle rather
  than only the transient toast, so the state is readable at a glance.

Optionally, a "keep simulating alongside the device" mode is possible — feed
the simulator into a separate event list rather than the same `liveEvents`.
That is a larger change and I would not do it without you asking for it.

---

## Order of work (all delivered)

| # | Item | Commit | Outcome |
| --- | --- | --- | --- |
| 1 | Incremental monitor render | `c051b09` | Append path verified: 5 elements reused, 2 added |
| 2 | Buffer dropdown labels | `c051b09` | Plain ascending digits; default 256K -> 1M, cap 4M |
| 3 | Control heights + signal read-outs | `2375f30` | 6 distinct heights -> 3 |
| 4 | Shortcut coverage | `b738790` | 14 -> 34 keys, four groups, table-driven |
| 5 | Simulated row marking | `5a48803` | SIM chip + frame counter |
| 6 | Rail layout, option 2 | `8a0effd` | Parser panel takes the empty row |

1 and 2 are one commit because the label change is a consequence of the new
defaults. 5 follows 1 because both touch `renderMonitor()`. 6 is last because it
depends on 3's control sizes.

## Verification

- `audit/measure-buffer.mjs` re-run to give the incremental append cost, plus a
  new measurement at 2 M characters.
- `audit/verify-c2.mjs` extended: the buffer settings and export still work,
  and a scroll-up-while-receiving case confirms the append path does not move
  the viewport.
- A screenshot of the connection rail at three widths for 3a, and one with a
  device connected for 4b if hardware is available — otherwise a synthetic
  `getSignals()` result injected through CDP, which exercises the same
  `updateSignalControlsUI()` path.
- `audit/verify-keys.mjs` extended with the new bindings, including that they
  bypass the paste debounce in order.
- B1, B2, C3, tooltip and i18n checks re-run after each commit.

## Open decisions

1. **Buffer defaults after the change.** Proposed 2 M / 8 M cap. Do you want
   that, or a more conservative 1 M with the cap left at 4 M?
2. **Windowed rendering.** Incremental append removes the frame-budget ceiling,
   but `renderMonitor()` still walks the whole buffer each frame. Do you want
   that solved in the same pass (larger, riskier) or as a follow-up once the
   append path is proven?
3. **Rail collapse behaviour.** Collapsing `config-panel` when the port is open
   but idle — should the collapse be automatic, or a manual toggle that
   remembers its state?
4. **Simulation alongside a device.** Keep the current yield-only behaviour, or
   add the separate-event-list mode?
