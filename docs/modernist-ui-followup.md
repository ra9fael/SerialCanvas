# Follow-up: terminal colour bug, corner-radius control, layout and shortcuts

Companion to `docs/modernist-ui-plan.md`. Written after Phase 1 (`53f7d0a`) landed
on `feat/modernist-ui`.

Three items, in priority order: one is a real bug that shipped, one is a
committed feature that was never wired up, and one is a design question.

---

## 1. Terminal foreground does not follow the theme (bug)

### Symptom

In light mode the terminal is unreadable. Measured, not guessed:

| Theme | `--bg-terminal` | terminal foreground | Contrast | WCAG AA |
| --- | --- | --- | --- | --- |
| light | `#1b1918` | `rgb(32, 30, 29)` | **1.06** | fail |
| dark | `#121110` | `rgb(244, 241, 239)` | 16.77 | pass |

### Root cause

`getTerminalTheme()` (`app.terminal.js:57`) reads the **page's** foreground token
for the terminal foreground:

```js
background: read('--bg-terminal', '#101216'),
foreground: read('--text',        '#e8e8ea'),   // <-- page text colour
cursor:    read('--accent-strong', '#e8e8ea'),
```

This worked before Phase 1 by accident. The old light theme had
`--bg-terminal: #f6f6f7` (light) and `--text: #3c3c43` (dark) — light terminal,
dark text, contrast 8.9. The old dark theme had `--bg-terminal: #161618` (dark)
and `--text: #dfdfd6` (light) — also correct.

The new palette makes `--bg-terminal` dark in **both** themes (`#1b1918` light /
`#121110` dark), which is the right call for a serial console. But `--text`
still flips: `#201e1d` in light, `#f4f1ef` in dark. So light mode now pairs a
dark foreground with a dark background.

This is a phase-1 regression I introduced, and it is exactly the risk the plan
flagged in §3.4: colour owned by JS versus colour owned by CSS.

### Fix

Give the terminal its own foreground token instead of borrowing the page's. The
terminal is a fixed dark surface in both themes, so its palette should be
theme-independent:

```css
:root {
  --bg-terminal: #1b1918;
  --terminal-text: #f4f1ef;        /* NEW — always light */
  --terminal-cursor: #ff9783;
  --terminal-selection: #471d16;
}
```

`app.terminal.js:57` becomes:

```js
foreground: read('--terminal-text', '#f4f1ef'),
cursor: read('--terminal-cursor', '#ff9783'),
cursorAccent: read('--bg-terminal', '#1b1918'),
selectionBackground: read('--terminal-selection', 'rgba(255, 150, 131, 0.28)')
```

No dark-theme override needed — the values are the same in both themes by design.
This also fixes the `solarized-light` skin's interaction, which currently inherits
the same broken default when the `<select>` is empty.

Note the explicit `TERMINAL_SKINS` entries are unaffected: those six skins carry
their own literal colours and never reach the `read()` path.

### Verification

Re-run `audit/probe-terminal.mjs` in both themes. Light must reach ≥ 4.5, and
must match the dark-mode figure closely since the surfaces are now identical.

---

## 2. The corner-radius control does not exist (missing feature)

You are right that there is no control. Phase 1 shipped the **token layer only**
(`--radius-scale` plus the `data-corner` selectors, both verified working), and
the plan filed the UI under Phase 5. No markup, no state, no persistence.

So the current behaviour is: **radius is already off by default**
(`--radius-scale: 0`), it just cannot be turned on from the UI. Nothing is wrong
with the default; the switch is missing.

### What has to be added

| Piece | Location | Notes |
| --- | --- | --- |
| Markup | `index.html`, after the language row (~line 110) | Reuse `.menu-theme-line` / `.menu-theme-group`; the sliding `::before` already supports three stops |
| `refs` | `app.core.js:73` | `cornerGroup`, `cornerOpts` — mirroring `themeGroup` / `themeOpts` |
| State | `app.core.js:216` area | `cornerRadius: 'square'` |
| Apply | beside `applyTheme()` (`app.core.js:1469`) | `applyCornerRadius()` sets `data-corner` on `<html>` **and** `<body>`, toggles `is-active`, calls `refitTerminal()` |
| Handler | beside `handleThemeChange()` (`app.core.js:1499`) | `handleCornerRadiusChange()` ending in `scheduleLocalPrefsSave()` |
| Persistence | `buildLocalPrefsSnapshot()` (`app.main.js:6299`) | `cornerRadius` next to `theme` / `locale` |
| Wiring | `attachEventListeners()` (`app.main.js:7241`) | Three lines, `cornerOpts` pattern |
| **First paint** | `bootstrap.js:43` | **The one that is easy to miss** |
| i18n | `app.lang.js` | Chinese source: `圆角：` / `直角` / `微圆` / `圆润` |

### The first-paint trap, restated

`bootstrap.js` must read `prefs.cornerRadius` inside
`__applySerialWebInitialBodyClasses()` and set `data-corner` there. If only the
app sets it at boot, a saved `round` value renders one frame at `square` and then
snaps — visible flicker on every reload. The theme class is already set in
`bootstrap.js` for exactly this reason; the radius attribute needs the same
treatment.

### Also needed for the switch to be *visible*

Right now `--radius-scale` only drives `--radius` and `--radius-small`, which
have 3 call sites. The 94 hardcoded `border-radius` declarations ignore it, so
flipping to `round` would move almost nothing. **Phase 2 is a prerequisite for
this feature to look like it works.** Do not ship the control before Phase 2, or
it is a dead switch.

---

## 3. Layout and shortcut ideas worth borrowing

### 3a. Layout — what actually transfers

picotty is a three-column fleet console: `nodes │ console │ activity`. SerialWeb
is a two-column instrument panel: `config │ parser+monitor`. These are different
products, so the column count is not the lesson. Four things do transfer:

| Idea | Why it fits SerialWeb |
| --- | --- |
| **Collapsible side rails with a keyboard toggle** | SerialWeb has `layout-expanded` and `sidebar-collapsed` already, but only mouse-driven. Adding a toggle key makes the wide/narrow switch instant. |
| **A persistent control-byte strip** | picotty keeps serial control bytes (CR/LF/TAB/ESC/Ctrl-C…) visible in a dedicated row rather than hiding them in a menu. SerialWeb sends these through preset items. A visible strip would beat memorising hex. |
| **Status dot + relative timestamp per row** | picotty renders `online · 3s ago` inline. SerialWeb's timeline shows absolute stamps; a relative age on the status pill is cheap and answers "is it alive?" faster. |
| **Rail columns that flex with viewport** | picotty uses `clamp(228px, 20vw, 304px)` so the console never gets squeezed. SerialWeb pins `286px` (`style.css:1936`). Worth adopting for ultrawide. |

What does **not** transfer: the node list (SerialWeb has one port, not a fleet),
the hub/failover status, and the nav-as-tabs pattern (SerialWeb's mode switch is
already a segmented control in the brand block).

### 3b. Shortcuts — picotty's actual set

From `tmp/picotty/static/app.js`, the reference only has three:

| Key | Action | Line |
| --- | --- | --- |
| `Esc` | Hide the tooltip | 118 |
| `Enter` | Send the serial input line | 832 |
| `Ctrl-C` / `Ctrl-D` / `Ctrl-Z` | Send `0x03` / `0x04` / `0x1a`, flushing any pending text first | 1431–1437 |

Plus the streaming behaviour itself: printable keys accumulate and flush on a
**40 ms debounce** (`scheduleSerialFlush`, line 1411), so fast typing becomes a
handful of frames per second instead of one per character. `Enter`/`Backspace`/
`Esc` flush immediately and stay atomic with the pending buffer.

### 3c. What SerialWeb already has — do not duplicate

| Capability | Where | Note |
| --- | --- | --- |
| Full keyboard passthrough | `term.onData(handleTermData)` (`app.terminal.js:197`) | **Better than picotty's hand-rolled capture.** xterm owns the keyboard, so function keys, arrows, `Ctrl-]` etc. work without a custom handler. |
| Echo / passthrough split | `handleTermData()` (`app.terminal.js:246`) | `refs.termLocalEcho` chooses raw forwarding vs. local line editing |
| Line editing + history | `terminalSession`, `navigateTermHistory()` | `Ctrl-U` clears (`\x15`), `Backspace` deletes, arrows walk history |
| Single-key preset send | `app.main.js:7266` | A bare letter triggers a matching preset item, but only when focus is outside an input |

So the reference's serial keyboard handling is **already superseded**. Copying it
would be a regression.

### 3d. Proposed shortcut set

Additions only, all consistent with what exists:

| Key | Action | Why |
| --- | --- | --- |
| `Ctrl-\`` | Toggle the left config rail | Reaches picotty's rail-toggle goal without a new panel |
| `Ctrl-Alt-C` | Toggle the corner-radius setting | Makes the new switch discoverable; chorded so it cannot collide |
| `?` | Open the shortcut sheet | See below |
| `Esc` | Close any open sheet/menu | Already handled for the version modal; generalise |

Two rules before adding anything:

1. **Never bind a bare letter.** `app.main.js:7266` already owns bare letters for
   preset send. Bare-key shortcuts would silently break presets.
2. **Check `event.target` first.** The existing handler returns early for
   `INPUT` / `TEXTAREA` / `SELECT` / `contentEditable`. Every new binding must
   do the same or typing in the send box will fire commands.

### 3e. The shortcut sheet

picotty's genuinely good idea is its custom tooltip carrying a **"Learn more"**
link (`app.js:64`–`132`, singleton on `<body>`, delegated `mouseover`, hover-intent
delay, flip-above when it would overflow). SerialWeb has 2 `help-icon` elements
and 15 `title=` attributes using native tooltips and a CSS `::after` bubble that
cannot host a link.

Borrowing the singleton pattern is worthwhile, and it gives a natural home for
the shortcut sheet: a modal listing every binding, opened with `?`. Native
`title=` cannot do this; a singleton can.

---

## Recommended order

1. **Fix the terminal foreground** (§1). Small, self-contained, and it is a
   regression that makes light mode unusable.
2. **Phase 2 radius tokenisation.** Blocked by nothing, unblocks item 3.
3. **Ship the corner-radius control** (§2). Only meaningful after step 2.
4. **Layout: the viewport-flex rail** (3a, one line) and the **status-pill
   relative age** (3a, small). Independent of everything else.
5. **Shortcut sheet + the chorded shortcuts** (3d, 3e). Largest new surface,
   lowest urgency.

Item 5 is deliberately last: shortcuts are the easiest thing to break silently,
and they are worth most once the layout they navigate is settled.