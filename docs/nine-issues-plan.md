# Nine issues: diagnosis and plan

Written after `024fb70` on `feat/modernist-ui`. Every claim below was checked
against the source, not inferred. Line numbers are from `3c1734a` + the commits
listed above it.

The nine reports fall into three groups that must not be worked together:
regressions I introduced, design misplacement, and net-new features. One of
them (layout) is explicitly blocked by another (parameter ownership).

---

## Group A — regressions from this branch (DONE, `6d9a61a`)

### A1. Manual send/receive text is unreadable (issue 1)

**Confirmed.** Three containers paint `--bg-terminal` (dark in both themes now)
but set no `color` of their own, so they inherit the page foreground:

| Site | Line | Background | Colour |
| --- | --- | --- | --- |
| `.terminal` | 4031 | `var(--bg-terminal)` | inherited `--text` |
| `.insight-pre` | 3422 | `var(--bg-terminal)` | inherited `--text` |
| `.log-line .stamp` | 4086 | (inside `.terminal`) | inherited `--text` |
| `.log-line .payload` | 4113 | (inside `.terminal`) | inherited `--text` |

Light mode gives `rgb(32, 30, 29)` text on `rgb(27, 25, 24)` — the same 1.06
contrast measured for the xterm path in `eeb3b31`.

**This is the second half of a regression I fixed only once.** `eeb3b31` gave
the *xterm* surface its own palette. The DOM-log surface used by manual mode
was missed, because it does not go through `getTerminalTheme()`.

**Fix.** Reuse the tokens already added:

```css
.terminal { color: var(--terminal-text); }
.insight-pre { color: var(--terminal-text); }
.log-line .stamp { color: var(--terminal-dim); }
```

Add `--terminal-dim` for the timestamp / direction labels, since
`--text-soft` is a page colour and would be mid-grey on a dark ground. The
per-direction colours (`.rx .dir` uses `--signal`, etc.) already read fine and
need no change — verified against the dark ground, not the light one.

Verification must cover **manual mode specifically**, not just the terminal tab.
That is what made this slip: the earlier check switched to the terminal view.

### A2. Corner-radius highlight does not move (issue 3)

**Confirmed.** `applyCornerRadius()` toggles `is-active` but never the `pos-*`
class that positions the sliding `::before` indicator:

```js
// app.core.js — applyCornerRadius()
refs.cornerOpts.forEach(function(opt) {
  opt.classList.toggle('is-active', opt.dataset.corner === value);
});
// no pos-light / pos-dark / pos-second / pos-third
```

The theme switch does both (`app.core.js:1549`): `pos-light` for the middle
position, `pos-dark` for the third. The language switch uses `pos-second` /
`pos-third`. So the indicator sits at the first stop forever.

**Fix.** Mirror the theme pattern:

```js
refs.cornerGroup.classList.remove('pos-light', 'pos-dark');
if (value === 'soft') refs.cornerGroup.classList.add('pos-light');
else if (value === 'round') refs.cornerGroup.classList.add('pos-dark');
```

`pos-light` / `pos-dark` are just names for stops 2 and 3; reusing them avoids
adding CSS. Slightly ugly, but it is the existing vocabulary.

---

## Group B — design misplacement

### B1. Parameter ownership (issue 4)

**Agreed, and this is the most substantive of the nine.** The left rail is
"device connection management", but these live in it:

| Control | Line | Belongs to |
| --- | --- | --- |
| 字符编码 (`text-encoding`) | 280 | manual mode TX/RX codec |
| 换行符设置 (`newline-mode`) | 289 | manual TX append + terminal send |
| 十六进制接收 (`rx-ascii` and sibling) | ~300s | RX display |
| 显示时间 (`append-timestamp`) | 312 | RX display |
| 结尾换行 (`append-newline`) | 318 | TX append |

Only the connection parameters belong there: baud, data bits, stop bits,
parity, flow control, DTR/RTS/BREAK, auto-reconnect.

The correct split follows the existing `rxDisplayMode` / `sendMode` split that
already lives in `state.settings`:

- **Connection rail** — physical layer only.
- **Manual mode panel** — encoding, newline, hex/text, timestamp. These already
  gate `normalizeSendOptions()` (`app.core.js:967`) and the RX path.
- **Terminal mode panel** — newline mode (it has its own `getTermLineEnding()`,
  `app.terminal.js:232`), font, size, skin, scrollback.

Note `newline-mode` is currently shared by both: `getTermLineEnding()` reads
the same `#newline-mode` element that manual TX uses. Splitting means either
two controls or one control that both read. **Recommend two**, because the
right value differs — a getty wants `\r\n`, a serial device usually wants `\n`.

`state.settings` keys stay as they are; only the DOM location and the labels
change. The persistence and the config export/import paths need no change
because they snapshot `state.settings`, not the DOM.

### B2. Unify type scale and add size presets (issue 2)

**Confirmed inconsistent.** Three independent sizes exist:

| Where | Size | Source |
| --- | --- | --- |
| xterm terminal | `refs.termFontSize`, 8–48 | `<input type="number">`, line 459 |
| `.terminal` (manual log) | `12px` hardcoded | line 4038 |
| `.insight-pre` | `12px` hardcoded | line 3428 |

There is no shared scale token, and the size control is a free-text number box
rather than a preset list.

**Fix.**

1. Add a size scale that both the terminal and the log read:
   `--mono-size: 12px` (terminal default), `--log-size: 12px`. Keep them as
   separate tokens — a user who enlarges the terminal for a device session
   generally does not want the parsed-results panel to grow.
2. Replace the number input with a `<select>` of presets: 10 / 11 / 12 / 14 / 16 /
   18 / 20 px. Custom sizes were possible before; a pure `<select>` removes
   that. **Recommend keeping the presets but adding a trailing "自定义" option**
   that reveals the number input, so nothing is lost.
3. Apply the chosen size to `.terminal` and `.insight-pre` too, so all three
   surfaces track one setting.

`getTerminalFontSize()` (`app.terminal.js:98`) clamps 8–48; keep that range for
the custom path.

### B3. Layout redesign (issue 9) — blocked by B1

**Deliberately last.** Once the parameters move out of the left rail, that rail
holds only ~9 connection controls, and the whole left column shrinks. Designing
the layout before that happens means designing it twice.

What the current structure actually is (`index.html`):

```
.app-shell (grid: topbar / workspace)
  .workspace (grid: var(--rail-w) 1fr)
    .left-column  → 设备连接管理 + 解析协议设置
    .right-column → 串口监视器 (+ 定时/触发/预设发送)
  .expanded-left-top → 添加图框 / charts-panel
```

Three observations that should drive the redesign rather than a fresh sketch:

1. The left column holds **two different jobs**: connection setup and parser
   configuration. They are not related and are both long.
2. `charts-panel` sits outside `.workspace` (`index.html:383`), so it is a
   sibling of the two columns, not a child — that is why the layout resists
   straightforward grid work.
3. `--rail-w` is already fluid (from `dcde5b3`), so the redesign should reuse it
   rather than introduce a new width system.

Propose a direction once B1 lands, not before.

---

## Group C — net-new features

### C1. Terminal shortcut bar (issue 5)

picotty has `serialKeydown()` (`app.js:1429`) covering Enter, Backspace, Tab,
Esc, `Ctrl-C` / `D` / `Z`, plus a 40 ms flush debounce.

SerialWeb already has better: `term.onData(handleTermData)`
(`app.terminal.js:197`) gives every key xterm-native, so function keys and
arrows already work **inside the terminal**. What is missing is *discoverable
buttons* — you have to know the keys exist.

**Proposed bar** (bottom of terminal mode, before the input row):

| Group | Keys |
| --- | --- |
| Navigation | `←` `→` `↑` `↓` `Home` `End` `PgUp` `PgDn` |
| Editing | `Backspace` `Delete` `Ctrl-U` `Ctrl-W` `Ctrl-K` |
| Control | `Ctrl-C` (0x03) `Ctrl-D` (0x04) `Ctrl-Z` (0x1a) `Esc` (0x1b) `Tab` (0x09) |
| Recall | up/down through `terminalSession.history` |

Each button sends the same bytes xterm would produce, so behaviour does not
diverge. It calls `sendTerminalBytes()` directly rather than synthesising
keystrokes — a real button must not depend on focus being in the terminal.

picotty's genuinely useful detail is the **40 ms flush debounce** on printable
runs (`app.js:1411`): fast typing becomes a few frames per second instead of one
per character. xterm's `onData` fires per keystroke, so a paste of 500
characters is currently 500 writes. Worth adding regardless of the buttons.

### C2. Export + adjustable buffers (issue 6)

**All three sub-items are absent or hardcoded:**

| Item | Current state |
| --- | --- |
| xterm scrollback | `scrollback: 5000`, hardcoded (`app.terminal.js:193`) |
| live event buffer | `MAX_LIVE_EVENT_TOTAL_CHARS = 8192`, hardcoded (`app.core.js:25`) |
| export | No button exists anywhere for terminal or log output |

**Export.** A `导出` button next to the terminal toolbar writing the buffer as
a `.txt` (with optional timestamp prefix) or `.cast` (asciicast, which picotty
plays back inline). `.txt` first — it is one Blob and a download link; `.cast`
needs a writer for timing metadata that does not exist in this codebase.

**Buffers — sized from measurement, not guesswork.**

`renderMonitor()` (`app.main.js:1798`) rebuilds the entire log with
`refs.terminal.innerHTML = parts.join('')` (`app.main.js:1863`), so the DOM node
count and the rebuild cost both scale with the buffer. `scheduleRefresh()`
already coalesces to one `requestAnimationFrame`, which caps the *rate* but not
the *cost* of each rebuild.

Measured with `audit/measure-buffer.mjs` — median of five rebuilds, realistic
62-character RX lines:

| Buffer (chars) | Lines | DOM nodes | `innerHTML` rebuild | Verdict |
| --- | --- | --- | --- | --- |
| 8 192 (today) | 132 | 528 | 0.2 ms | generous headroom |
| 131 072 | 2 114 | 8 456 | 3.1 ms | fine |
| 262 144 | 4 228 | 16 912 | 7.0 ms | fine |
| 524 288 | 8 456 | 33 824 | 13.3 ms | at the frame budget |
| 1 048 576 | 16 913 | 67 652 | 26.6 ms | drops frames |

One frame at 60 Hz is 16.7 ms, and a rebuild has to fit inside it.

**So "as large as possible without stuttering" resolves to a specific number:
512 K characters is the ceiling, and 256 K is the largest value that still
leaves real headroom.** The current 8 K is far more conservative than the
rendering cost requires — it can go up by a factor of 32.

Options, all persisted next to `terminalFontSize`:

- **Live log buffer** — `64K / 256K / 512K` characters. **Default moves from
  8 K to 256 K.** The 512 K option carries a note that it approaches the frame
  budget, so the cost is stated rather than discovered.
- **xterm scrollback** — `5 000 / 20 000 / 100 000` lines. xterm's own buffer is
  far cheaper than the DOM log (text nodes only, no re-render on scrollback
  change), so it can be larger. Default moves from 5 000 to 20 000.

`trimLiveEvents()` (`app.core.js:582`) must read the setting instead of
`MAX_LIVE_EVENT_TOTAL_CHARS`, and the value is applied on the next append.

Keep the character-budget model rather than switching to a line count: line
widths vary by an order of magnitude, so a line budget would behave very
differently between a binary dump and short text replies.

**If a much larger buffer is wanted later**, the fix is incremental DOM
appending instead of `innerHTML` rebuild — `renderMonitor()` already knows the
append-only case, since RX only ever adds to the end. That change would move
the ceiling by roughly an order of magnitude. It is a real refactor though, and
it is not needed to reach 512 K.

### C3. Protocol simulation (issue 8)

**Nothing exists** — grep for `simulat|模拟|mock|demo` across the app returns
nothing. picotty's DEMO mode seeds fake nodes and can simulate an OTA flash.

This is the highest-value item and the largest. SerialWeb's demo would be more
useful than picotty's because the parser is the interesting part.

**Scope, smallest useful version:**

- A `模拟数据` toggle in the parser panel, off by default, persisted.
- When on and no serial port is open, RX is generated locally instead of read
  from a device: a `setInterval` walks a scripted protocol and feeds the bytes
  through `queueRxBytes()` — **the same RX entry point as real data.**
- One built-in script matching the documented text grammar
  (`/name0=… /int0 /float0`), plus one matching a binary schema so both parser
  modes are demonstrable.
- TX during simulation accepts input and does not throw.

Routing through `queueRxBytes()` matters: it means the simulation exercises
line splitting, parsing, charts and recording exactly as real traffic does,
rather than a parallel code path that could drift.

**Do not** build the OTA / firmware-flavoured part of picotty's demo. It is
Pico-specific and has no meaning here.

---

## Issue 7 — what else is worth borrowing

Assessed against what already exists:

| Idea | Verdict |
| --- | --- |
| **Custom tooltip singleton** | **Do it.** `app.js:64`–`132`. SerialWeb has 2 `help-icon` elements and 15 `title=` attributes. Native `title=` cannot host a link, and the existing CSS `::after` bubble cannot either. The singleton can carry a "Learn more" link and is the natural home for a shortcut-sheet link. It also fixes discoverability for C1 and B2 at zero extra cost. |
| **Prompt / target state badge** | Skip. picotty's badge answers "is the node alive / is the target machine up" — a fleet concept. SerialWeb has one port; the status pill already carries this. |
| **Offline send queue** | Consider. If C3 lands, a queue lets you type commands while the simulated or real device is reconnecting. Depends on C3. |
| **Session replay (asciicast)** | Defer. Pairs with the `.cast` half of C2; neither is useful alone. |
| **Macro / runbook system** | Skip. SerialWeb's preset send already covers the single-shot case; runbooks are a YAML orchestration layer SerialWeb has no use for. |
| **Firmware OTA** | Skip. Pico-specific. |
| **Control byte strip** | Covered by C1. |

So: **tooltip singleton is the one clear win.** Everything else either
duplicates an existing feature or does not apply to a single-port tool.

---

## Order of work

**Group A is done** — `6d9a61a`.

1. ~~**A1** terminal text~~ — **done**, `6d9a61a`. Manual 15.58 / 7.97.
2. ~~**A2** corner indicator~~ — **done**, `6d9a61a`. Indicator at 0 / 72.6 / 145.3 px.
3. **B1** parameter ownership — the largest structural change, and it unblocks B3.
4. **B2** size scale + presets.
5. **C3** simulation — fixed built-in scripts, highest value.
6. **C1** shortcut bar + paste debounce.
7. **C2** export + buffer settings.
8. **Issue 7 tooltip** singleton.
9. **B3** layout redesign — **after** the parameters have moved, as agreed.

## Decisions taken

| Question | Decision |
| --- | --- |
| Buffer sizing | **As large as measurement allows.** Live buffer default 8 K → **256 K**, ceiling 512 K (frame budget). xterm scrollback 5 000 → **20 000**, up to 100 000. Numbers derived from `audit/measure-buffer.mjs`, not guessed. |
| Size presets | **Keep both.** A preset `<select>` plus a trailing "自定义" option that reveals the existing number input, so free entry is not lost. |
| `newline-mode` | **Two controls.** One for manual mode (`#newline-mode`, unchanged id), one for the tty/terminal (`#term-newline`). They are read by different code paths already — `normalizeSendOptions()` vs `getTermLineEnding()` — so splitting is clean. |
| Simulation | **Fixed built-in scripts.** No user-editable protocol field in this pass. |
| Layout | **After B1.** Designing now means designing twice. |

### Note on B1 and the two newline controls

Splitting is easier than it looks, because the two consumers are already
separate: `normalizeSendOptions()` (`app.core.js:967`) reads `state.settings.newlineMode`
for manual TX, while `getTermLineEnding()` (`app.terminal.js:232`) reads the DOM
element directly for the terminal. So:

- Manual keeps `#newline-mode` and its existing state key.
- Terminal gets a new `#term-newline` bound to a new `state.ui.termNewline`,
  persisted in `layout` next to `terminalSkin`, defaulting to `rn`.

That also fixes a latent oddity: today both surfaces read one element, so
changing the setting for manual mode silently changed the terminal's line ending
too.