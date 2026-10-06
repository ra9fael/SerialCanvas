# Follow-up: terminal colour bug, corner-radius control, layout and shortcuts

Companion to `docs/modernist-ui-plan.md`. Written after Phase 1 (`53f7d0a`) landed
on `feat/modernist-ui`.

Three items, in priority order: one is a real bug that shipped, one is a
committed feature that was never wired up, and one is a design question.

---

## 1. Terminal foreground does not follow the theme (bug) — FIXED in `eeb3b31`

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

### Fix applied

```css
:root {
  --bg-terminal: #1b1918;
  --terminal-text: #f4f1ef;        /* NEW — always light */
  --terminal-cursor: #ff9783;
  --terminal-selection: rgba(255, 151, 131, 0.28);
}
```

`app.terminal.js:57` now reads:

```js
foreground: read('--terminal-text', '#f4f1ef'),
cursor: read('--terminal-cursor', '#ff9783'),
cursorAccent: read('--bg-terminal', '#1b1918'),
selectionBackground: read('--terminal-selection', 'rgba(255, 151, 131, 0.28)')
```

Declared once in `:root` and **deliberately not repeated** under `.theme-dark` —
the console is a fixed dark surface in both themes, so its palette is
theme-independent. A comment in the dark block says so, to stop a future override
reintroducing the bug.

The six explicit `TERMINAL_SKINS` entries carry their own literal colours and
never reach the `read()` path, so they are untouched.

### Verified

| Theme | foreground | background | Contrast |
| --- | --- | --- | --- |
| light | `rgb(244, 241, 239)` | `rgb(27, 25, 24)` | **15.58** ✅ |
| dark | `rgb(244, 241, 239)` | `rgb(18, 17, 16)` | 16.77 ✅ |

---

## 2. The corner-radius control — SHIPPED

Phase 1 shipped the token layer; the UI is now in place and verified end to end.

| Piece | Location |
| --- | --- |
| Markup | `index.html`, `menu-corner-group` after the language row |
| `refs` | `app.core.js` — `cornerGroup`, `cornerOpts` |
| State | `state.cornerRadius`, validated against `CORNER_SETTINGS` |
| Apply | `applyCornerRadius()` beside `applyTheme()`; sets `data-corner` on `<html>` and `<body>` |
| Handler | `handleCornerRadiusChange()` + `cycleCornerRadius()` |
| Persistence | `cornerRadius` in `buildLocalPrefsSnapshot()` and `applyLocalPrefsSnapshot()` |
| Reset | `cornerRadius: 'square'` added to `buildDefaultUserConfigSnapshot()` |
| First paint | `bootstrap.js` sets `data-corner` inside `__applySerialWebInitialBodyClasses()` |
| i18n | `圆角：` / `直角` / `微圆` / `圆润` in `app.lang.js` |

### Verified

- Default is `square`; a user with no stored value lands there too.
- All three settings move real elements: `.panel` 0 / 7 / 14px, `.online-mode-chip`
  0 / 499.5 / 999px.
- `.status-dot` stays `50%` at every setting.
- **First paint**: reloading with `round` saved renders 14px immediately — no
  one-frame snap back to the default.
- Persistence survives reload in both directions.
- Clearing settings via the app's own button returns to `square`.
- English labels read `Corner:` / `Square` / `Soft` / `Round`.

### Two bugs found while verifying this

1. **`buildDefaultUserConfigSnapshot()` omitted `cornerRadius`.** "Clear
   settings" therefore left `state.cornerRadius` at its previous value, so the
   reset did not reset. Added `cornerRadius: 'square'` alongside `theme` /
   `locale`.
2. **`.menu-corner-opt` was missing from the shared base rule.** Only the
   `.is-active` colour rule matched, so the inactive labels had no layout at all
   and the active label was invisible against the sliding indicator. Added it to
   the `.menu-theme-opt, .menu-lang-opt` block.

### Also fixed here: 10 stale `#eef2ff` labels

The active label colour was hardcoded `#eef2ff`, a pale blue chosen for the old
indigo accent. Against `#ec3013` it fell below the AA threshold, so "System",
"Square" and the active mode tabs were barely readable. All ten now use
`var(--bg)`, which reads cleanly on the accent.

One exception kept its own rule: `.timeline-freeze-btn` in the frozen state sits
on `--accent-soft`, not on `--accent`, so it uses `var(--accent)` instead.

### Note on ordering

This control was deliberately not shipped before the radius tokenisation
(`0eb7118`). With only 3 call sites following `--radius-scale`, flipping the
switch would have moved almost nothing — a dead control. Tokenising first was
the whole point of doing Phase 2 before Phase 5's UI work.

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

Status as of `eeb3b31` / `0eb7118`:

1. ~~**Fix the terminal foreground**~~ — **done**, `eeb3b31`.
2. ~~**Phase 2 radius tokenisation**~~ — **done** (radius half), `0eb7118`. The
   shadow / `rgba()` / gradient sweep is still open.
3. ~~**Ship the corner-radius control**~~ — **done**.
4. **Layout: the viewport-flex rail** (3a, one line) and the **status-pill
   relative age** (3a, small). Independent of everything else.
5. **Shortcut sheet + the chorded shortcuts** (3d, 3e). Largest new surface,
   lowest urgency.

Item 5 is deliberately last: shortcuts are the easiest thing to break silently,
and they are worth most once the layout they navigate is settled.

### Remaining Phase 2 work

| Item | Count | Note |
| --- | --- | --- |
| `box-shadow` | 87 | Reduce to overlays only: `.floating-menu`, modal backdrops, `.toast`, chart flyouts |
| `rgba()` | 198 | Convert to tokens. **Audit the terminal-adjacent ones** — some translucency is load-bearing and must stay deliberate |
| `gradient()` | 23 | Flat fills |
| `backdrop-filter` | 4 | Two already `none` |