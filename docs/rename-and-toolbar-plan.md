# Polish round: corner segments, chip scope, de-fork, rename, toolbar overflow

Status: landed in v0.4.0 (SerialCanvas rename, corner fix, chip scope,
two-row toolbar; the new repository itself is created outside this repo).
All findings were read out of the working tree at `872a0ba`.

Four items from the 2026-10-08 review, plus the naming question for the new
repository.

1. Corner segment buttons are not styled like theme/language
2. Simulation chip: manual view only, no frame count
3. De-fork the docs, credit the two UI sources
4. New repository and a new name
5. Monitor toolbar: what happens when the row runs out of room
6. Suggested order

## 1. Corner segment buttons are not styled like theme/language

The screenshot is right, and the cause is precise: the two `:not()` exclusion
lists that carve the segmented buttons out of the generic floating-menu styles
list theme and language but **forget corner**.

`style.css:983` (base rule, specificity (0,3,1) — it beats `.menu-corner-opt`
(0,1,0) regardless of source order):

```css
.floating-menu button:not(.menu-theme-opt):not(.menu-lang-opt),
```

`style.css:1241` (hover/focus rule):

```css
.floating-menu button:not(.menu-theme-opt):not(.menu-lang-opt):hover,
```

So every `#menu-corner-group .menu-corner-opt` button also gets, from the
generic rule: `width:100%`, `justify-content:flex-start`, `padding:8px 10px`,
`min-height:36px` and a `background` transition — overriding the segmented
`min-height:28px; padding:4px 6px` from the shared rule at 1192 — and it gets
`background:var(--accent-soft)` on hover, which the theme/language buttons
deliberately do not have (they ride the sliding accent indicator instead).

**Fix**: add `:not(.menu-corner-opt)` to both selectors. Two lines, no new
rules. Theme, language and corner then share exactly one segmented styling.

**Verify**: new `audit/verify-menu-segments.mjs` — per group, assert computed
`min-height:28px`, `width` NOT 100% of the group, and hover `background`
transparent (simulate `:hover` via CDP or a `matches` check on the selector
list); assert all three groups agree. ~6 assertions.

## 2. Simulation chip: manual view only, no frame count

Current behaviour (`app.main.js:404-424`): the chip is hidden in the parse
view and shows `模拟中 · N 帧` / `模拟已让位 · N 帧` in **both** monitor
sub-views (manual and terminal).

Requested:

1. Show it only in the **manual** sub-view: add
   `state.ui.monitorView === 'manual'` to the visibility condition (the
   terminal sub-view keeps the xterm clean).
2. Drop the frame count: text becomes `模拟中` / `模拟已让位`. The count is
   already visible as the RX counter it drives; the chip answers "is this
   real", not "how much".

Touch points:

- `app.main.js` `applySimulationMonitorChip()` — condition + text.
- `app.lang.js` — replace the two `{{count}}` keys with plain `模拟中` /
  `模拟已让位` (English: `Simulated` / `Sim. yielded`).
- `index.html` — the long comment above the chip (it explains the count).
- `audit/verify-sim-tag.mjs` — its assertions read the chip text with the
  count; rewrite for the new contract (visible in manual, hidden in terminal
  and parse views, no digits).

## 3. De-fork the docs, credit the two UI sources

The user's position: the app has diverged far enough that calling it a fork is
no longer accurate. The docs should say "independent project that started from
X", keep **only the original repo link**, and state that the UI derives from
the original SerialWeb and from picotty.

Plan:

- Replace `docs/fork.md` + `docs/zh-CN/fork.md` with
  `docs/acknowledgements.md` (+ mirror): origin (`Conductance-lab/SerialWeb`,
  link only), UI design derived from the original SerialWeb and
  [PICOTTY](https://github.com/morpheuslord/PICOTTY) (verified: morpheuslord's
  Pico-based fleet console, GPL-3.0), divergence summary in three sentences,
  license section.
- `README.md` (+ `docs/README.md` mirrors): replace the fork paragraph with
  two sentences — independent project, UI derived from SerialWeb and picotty,
  original project linked.
- About dialog (`app.core.js` version text) — same wording, both locales.
- Menu links in `index.html` (`问题反馈` / `工具手册`) — repoint to the new
  repository once it exists.
- **Honest note**: AGPL-3.0 obligations do not change with the name. The
  LICENSE file, the original copyright notice, and a "changes from the
  original" statement stay, in the acknowledgements doc and the license
  headers where they exist. Renaming is fine; silent re-licensing is not.

## 4. New repository and a new name

Name candidates, checked against the GitHub search API on 2026-10-07:

| Candidate | GitHub collisions | Note |
| --- | --- | --- |
| **SerialCanvas** | **0** | canvas = parser + charts; the strongest fit |
| **PortCanvas** | 0 | same idea, shorter |
| SerialScope | taken ×4+ | oscilloscope tools |
| SerialBench / SerialLens / PortLens / WireLens | taken | various |

Recommended: **SerialCanvas**. Chinese display name:
串口画布（SerialCanvas）— to be confirmed.

Mechanical rename scope (whatever the name):

- `index.html`: `<title>`, `<meta>` description, `download="SerialWeb串口调试.html"`,
  menu links, About dialog strings, i18n entries in `app.lang.js`.
- `build-release.py`: output `dist/SerialWeb.html` → `dist/<New>.html`; the
  dist smoke-test audit invocations change with it.
- `.github/workflows/pages.yml`: artifact/page paths.
- `README.md`, `docs/**` prose, `docs/CHANGELOG.md` entry.
- Internal identifiers (`wsl-layout` localStorage keys, module names) stay —
  renaming them would drop every user's saved layout for no visible gain;
  noted in the acknowledgements doc.

Repository move (user decision needed on the shape):

- **Option R1 — fresh repo, current history carried over (recommended)**:
  create `<user>/<New>`, push the existing branch as `main`, archive the old
  repo. History preserved, no fork claim.
- **Option R2 — rename in place**: GitHub Settings → rename `SerialWeb` →
  `<New>`; GitHub redirects the old URL. Simplest, but the repo keeps the
  fork lineage metadata and the user asked for a *new* repository.

## 5. Monitor toolbar: what happens when the row runs out of room

Current state, measured from the CSS: `.monitor-toolbar` is `flex-wrap:nowrap`
and only switches to wrap under `@media (max-width:1280px)`;
`#manual-toolbar-controls` is nowrap and its fields compress — label ellipsis
first, padding second. The screenshot (wide window, ten controls + the
HB/meta chip + export/clear on the right) shows the end state of that policy:
`按键 HB: NaN` truncated, `模式` truncated, every field at minimum width, no
more room to give.

Options:

- **T1 (recommended) — fixed two rows, always.** Same decision the key bar
  already made. Row 1: title + status chip/meta + 手动收发/终端 switch +
  导出日志/清空缓存. Row 2: the parameter fields (编码 / 字号 / 回滚行数 /
  日志字节数 / 换行 / 字体 / 主题). Deterministic height at every window
  width, no truncation, no JS, and the 1280px media-query special case goes
  away. Cost: +1 row (~34px) even when the window is very wide; both manual
  and terminal toolbars get the same treatment.
- **T2 — overflow menu.** Measure with a `ResizeObserver`; below a width
  threshold move low-frequency fields (字体 / 主题 / 回滚行数 / 日志字节数)
  into a `更多 ⋯` popover. One row retained on wide screens. Cost: measured
  JS + duplicated state sync for popover controls, and a control whose
  location moves is harder to build muscle memory for.
- **T3 — status quo plus longer tooltips.** Cheapest, does not solve it.

T1 is recommended for the same reason the key bar went to fixed rows: a
constant layout beats an adaptive one that changes height or moves controls.

## Suggested order

1. Corner `:not()` fix + menu-segments audit (two lines, isolated).
2. Chip scope + text (small, has an existing audit to update).
3. Toolbar T1 (CSS + `index.html` re-order inside the toolbar; update
   `verify-three-issues` / layout assertions if they count toolbar children).
4. Rename + de-fork + new repo (widest blast radius: build, workflows, docs,
   i18n — do it last, once, with its own commit).
