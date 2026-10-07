# Modernist UI migration plan

Branch: `feat/modernist-ui` (cut from `main` at `3c1734a`)

Adopt the visual language of the picotty dashboard (reference source:
`tmp/picotty/static/`) into SerialCanvas.

## 0. Decisions taken

| Question | Decision |
| --- | --- |
| Vendor Archivo? | **No.** Keep the `Segoe UI / PingFang SC / Microsoft YaHei` stack. Take only the typographic *treatment*: weight 800 headings, `-0.015em` tracking, uppercase letter-spaced kickers on section labels. No font is downloaded, no data URI is added, the single-file release does not grow. |
| Restyle dark mode too? | **Yes.** Both themes land in the same phase. Dark becomes a warm near-black ramp derived from the picotty neutral scale, not the current cool `#1b1b1f`. |
| Corner radius: fixed zero, or configurable? | **Configurable**, in the system menu, as a three-position switch. See §5. Default is zero (the faithful picotty look). |

Consequence of dropping Archivo: the *feel* of the reference survives through
weight, scale and rules rather than typeface. This is the right trade for a
Chinese-language UI anyway — Archivo has no CJK coverage, so headings would have
fallen back mid-string regardless.

## 1. What the reference actually is

The picotty frontend is three files, and the style is **not** in the JavaScript:

| File | Lines | Role |
| --- | --- | --- |
| `static/styles.css` | 234 | The entire design system: tokens + generic component classes |
| `static/app.css` | 149 | App shell only: tooltip singleton, responsive restacking |
| `static/app.js` | 2699 | Application logic. Consumes the tokens; owns almost no styling |

The style lives in `styles.css`. `app.js` uses inline `style` strings heavily, but
those strings only reference `var(--color-*)` and `var(--space-*)` — swap the
token block and the whole app restyles.

Three traits define the look:

1. **Zero radius.** `--radius-sm/md/lg` are all `0px`. Every corner is square.
2. **Structure drawn with 2px solid rules**, not shadows. `--color-divider` is
   `color-mix(in srgb, #201e1d 40%, transparent)`. 19 occurrences of
   `2px solid var(--color-divider)` in `app.js` alone.
3. **Flat opaque fills.** `--color-bg #f3f2f2`, `--color-surface #eae9e9`.
   No `backdrop-filter`, no translucent panels, no gradients.

Plus one strong typographic voice: `Archivo` at weight 800 for headings, 10–11px
uppercase letter-spaced kickers for labels, and a single warm-red accent
(`#ec3013`) used sparingly.

## 2. The gap in SerialCanvas

Measured on the current `main` (`3c1734a`), not estimated:

| Property | SerialCanvas today | Count in `style.css` |
| --- | --- | --- |
| Rounded corners | 8/10/12/14/16/18/20px, `999px`, `50%` | 112 `border-radius` declarations |
| Pills / circles | `999px` on chips, live bar, status chips | 18 |
| Shadows | `box-shadow` on nearly every surface | 87 |
| Translucent fills | `rgba(...)` backgrounds | 197 |
| Gradients | `linear-gradient(...)` | 23 |
| Blur backdrops | `backdrop-filter` | 4 |
| Hairline borders | `1px solid var(--border)` | 74 |
| Dark-theme overrides | `theme-dark` selectors | 49 |

The token layer at the top of `style.css` (lines 1–64) is genuinely well organised —
`--bg`, `--text`, `--accent`, `--radius`, `--shadow` and a `theme-dark` block.
That part migrates cleanly. **The 197 hardcoded `rgba()` fills and 87 shadows do
not**: they will not follow a token swap, so they have to be converted to tokens
or the two styles will sit on top of each other and fight.

Colour is the easy part. Geometry is the work.

## 3. Constraints specific to this repository

These are not negotiable and they shape the sequencing:

1. **Single-file release.** `build-release.py` inlines `style.css` and asserts no
   local `src=`/`href=` survives outside inlined blocks (`build-release.py:157`).
   Any new stylesheet must be registered in `INLINE_ASSETS` (`build-release.py:35`)
   or the build fails loudly. Any font must be inlined as a data URI — there is no
   network at runtime.
2. **Offline is a feature.** The vendored xterm under `vendor/xterm/` exists
   precisely because there is no CDN. picotty's `styles.css:4` pulls Archivo from
   `fonts.googleapis.com` — that line cannot come across as-is.
3. **The shared closure.** `app.core.js` opens the IIFE, `app.main.js` closes it,
   `app.terminal.js` is a fragment. Top-level names must stay unique across all
   three. No `import`/`export`.
4. **Terminal colours are JS-owned.** `TERMINAL_SKINS` (`app.terminal.js:12`) and
   `CHART_COLORS` (`app.core.js:39`) are hardcoded hex arrays in JS, not CSS. A
   palette change that misses these leaves the charts and the terminal in the old
   colour scheme while the panels move.
5. **Dark mode is a first-class feature** with persisted user preference
   (`bootstrap.js`, `app.core.js:1464`–`1507`) and a `theme-dark` class on both
   `<html>` and `<body>`. picotty has no dark theme at all. Dropping dark mode is
   a product decision, not an implementation detail.
6. **Bilingual UI.** `app.lang.js` translates `title`, `aria-label`, `data-tip` and
   other attributes at runtime. Chinese strings are the source language. Type
   sizing must survive longer CJK strings.

## 4. Proposed approach — token-first, then geometry, in five phases

The ordering matters: each phase leaves the app bootable and reviewable, and
deferring the geometry pass means the token change is visible on its own before
2000 lines of CSS churn land.

### Phase 0 — Baseline (no visual change)

- Screenshot the current light and dark themes via `tools/cdp-check.mjs` so every
  later phase has a before/after reference.
- Record the exact `CHART_COLORS` and `TERMINAL_SKINS` values in the commit
  message, so a regression is a diff, not an argument.

### Phase 1 — Token layer (highest impact, lowest risk)

Rewrite lines 1–64 of `style.css` as the picotty token set, re-expressed in
SerialCanvas's own variable names so the rest of the file keeps working:

| SerialCanvas token | New value | Source |
| --- | --- | --- |
| `--bg` | `#f3f2f2` | `--color-bg` |
| `--bg-panel`, `--bg-panel-strong` | `#eae9e9` | `--color-surface` |
| `--bg-terminal` | `#1b1918` | picotty's `.sc-term` inline colour |
| `--text` | `#201e1d` | `--color-text` |
| `--text-soft` | `#605d5d` | `--color-neutral-700` |
| `--accent` | `#ec3013` | `--color-accent` |
| `--accent-strong` | `#ae1800` | `--color-accent-700` |
| `--accent-soft` | `#ffe0d9` | `--color-accent-200` |
| `--border`, `--border-strong` | `rgba(32,30,29,.40)`, `rgba(32,30,29,.62)` | `--color-divider` scaled |
| `--radius`, `--radius-small` | driven by `--radius-scale` (see §5) | `--radius-*` |
| `--shadow`, `--shadow-soft` | `none` | dropped |

Also add a derived dark set (picotty has none, so this is new work — a warm
near-black ramp rather than the current cool `#1b1b1f`):

| Token | Dark value |
| --- | --- |
| `--bg` | `#1b1918` (picotty's terminal ground, reused as the page base) |
| `--bg-panel`, `--bg-panel-strong` | `#26241f` |
| `--text` | `#f4f1ef` |
| `--text-soft` | `#9b9797` |
| `--accent` | `#ff563c` (accent-500 — 600 is too dark on a near-black ground) |
| `--border`, `--border-strong` | `rgba(244,241,239,.22)`, `rgba(244,241,239,.38)` |

Only the ~40 `var(--…)` call sites react. Expect it to look *wrong* but
structurally intact: sharp corners, no shadows, warm palette.

### Phase 2 — Radius tokenisation and shadow sweep (mechanical)

The bulk of the diff, and it is deliberately boring. This phase exists to make
the corner-radius setting in §5 possible at all — **the 112 radius declarations
are hardcoded pixel values today, so they cannot follow a token until this
pass rewrites them.**

Current distribution, measured:

| Value | Count | Disposition |
| --- | --- | --- |
| `999px` | 18 | Pills. **Scale** with `--radius-scale`, floor at 0 |
| `14px` | 16 | → `--radius-md` |
| `10px` | 16 | → `--radius-sm` |
| `12px` | 12 | → `--radius-sm` |
| `18px` | 11 | → `--radius-lg` |
| `8px` | 7 | → `--radius-xs` |
| `16px` | 7 | → `--radius-lg` |
| `50%` | 6 | **Never scale.** Status dots and slider thumbs |
| `0` | 6 | Already square |
| `inherit` | 3 | Follows parent |
| `7px` / `6px` / `2px` | 6 | → `--radius-xs` |
| `20px` | 1 | → `--radius-lg` |

Then:

- Reduce `box-shadow` to overlays only: `.floating-menu`, modal backdrops,
  `.toast`, chart flyouts. Flat `none` elsewhere.
- Replace the 197 `rgba()` panel fills with the new opaque tokens. This is where
  the real risk is — some of those `rgba()` are meaningful translucency over the
  terminal, and they need to become deliberate, not blanket-removed.
- Remove the 4 `backdrop-filter` uses (two are already `none`).

### Phase 3 — Typography (no font file)

- Keep the system stack: `--font-ui` stays
  `"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`.
- Apply the reference's *treatment* instead of its typeface: heading weight
  800, tracking `-0.015em`, and `line-height: 1.12` on headings.
- Add the uppercase letter-spaced kicker to panel titles and section labels
  (`10px`, `letter-spacing: .1em`, `text-transform: uppercase`, accent colour).
  `.panel-title` is the main target. This is the single most recognisable
  picotty signal and it costs nothing.
- `.menu-theme-label` already uses this treatment (`style.css:989`) — extend it
  rather than inventing a second one.
- CJK note: Chinese strings never enter the uppercase path (`text-transform` is
  a no-op on Han characters), so kickers stay meaningful for the Latin/numeric
  labels while Chinese panel titles keep normal casing.

### Phase 4 — Structure lines

Promote the visual hierarchy from shadow-based to rule-based:

- `1px solid var(--border)` → `2px solid var(--color-divider)` on panel headers,
  the topbar, and section boundaries — the picotty `.nav` and rail pattern.
- Thicken the topbar's bottom edge and the timeline shell to match.
- Keep inner control borders at 1px; 2px everywhere would be noise.

### Phase 5 — JS-side colour, build, docs

- Re-tune `CHART_COLORS` (`app.core.js:39`) to a warm-compatible categorical ramp
  that still separates seven series.
- Re-check the six `ctx.strokeStyle` literals in `app.main.js` (lines ~4634–5299)
  that bypass CSS entirely — they will keep the old cool tint otherwise.
- Leave `TERMINAL_SKINS` alone unless the dark `--bg-terminal` change breaks the
  default skin. Terminal themes are a separate aesthetic contract.
- Re-run `build-release.py` and re-verify the leftover-reference assertion. No
  `INLINE_ASSETS` change is expected — the token work stays inside `style.css`.
- Update `docs/development.md` (layout section), `docs/user-guide.md` and the
  `zh-CN` mirror. `tools/docs-check.py` enforces EN/ZH parity.
- Add the corner-radius option to `app.lang.js` (Chinese is the source language,
  so the new labels are authored in Chinese and keyed from there).

## 5. The corner-radius setting

Answering the question directly: **yes, and it is worth doing — but it only
becomes possible after Phase 2.** All 112 radius declarations are currently
hardcoded pixels, so a setting would have nothing to drive. Phase 2 rewrites them
into four scale tokens; this section is the consumer.

### Token shape

One integer drives everything, with `data-corner` on `<html>`:

```css
:root {
  --radius-scale: 0;                    /* default: the faithful picotty look */
  --radius-xs: calc(2px  * var(--radius-scale));
  --radius-sm: calc(8px  * var(--radius-scale));
  --radius-md: calc(12px * var(--radius-scale));
  --radius-lg: calc(16px * var(--radius-scale));
  --radius-pill: calc(999px * var(--radius-scale));
  --radius-dot: 50%;                    /* never scales — see below */
}
:root[data-corner="soft"]  { --radius-scale: .5; }
:root[data-corner="round"] { --radius-scale: 1; }
```

`--radius-pill` is a multiplier, not a fixed `999px`, so at scale 0 the pills
become square and at scale 1 they return to their current shape. One knob, no
per-element branching.

### What must not scale

`--radius-dot` stays `50%` at every setting. The six `50%` sites are:

| Selector | What it is |
| --- | --- |
| `.status-dot` | Connection status pip in the brand block |
| `.status-dot::after` | Its pulse ring |
| `#timeline-slider::-webkit-slider-thumb` | Timeline scrubber thumb |
| `#timeline-slider::-moz-range-thumb` | Same, Firefox |
| `.reconnect-chip .reconnect-dot` | Reconnect indicator |

Squaring a status dot destroys the status language — a circle reads as "state",
a square reads as "decoration". `.help-icon` (`style.css:296` area) is likewise
a circle by intent and stays circular.

The `inherit` sites (3) follow their parent and need no token.

### Persistence

Rides the existing preference path, exactly like `theme` and `locale`:

| Concern | Where |
| --- | --- |
| Stored under | `state.cornerRadius`, snapshotted in `buildLocalPrefsSnapshot()` (`app.main.js:6299`) next to `theme` / `locale` |
| Applied by | `applyCornerRadius()`, mirroring `applyTheme()` (`app.core.js:1469`) — sets `data-corner` on `<html>` and `<body>`, toggles `is-active`, calls `refitTerminal()` |
| Handler | `handleCornerRadiusChange(value)`, mirroring `handleThemeChange()` (`app.core.js:1499`), ending in `scheduleLocalPrefsSave()` |
| First paint | `bootstrap.js` must read `prefs.cornerRadius` and set `data-corner` inside `__applySerialCanvasInitialBodyClasses()`, or the saved value flashes the default for one frame — the same problem `__applySerialCanvasInitialBodyClasses()` already solves for theme and layout |
| Clear/reset | `clearSerialCanvasStoredUserData()` (`app.main.js:6415`) already clears the whole prefs key, so no extra work |

`bootstrap.js` is the one that is easy to forget. The theme class is set there
precisely so the first painted frame is correct; the radius attribute needs the
same treatment.

### Markup and wiring

Three positions, in the system menu (`index.html:93`), modelled on the existing
theme switch — same `.menu-theme-line` / `.menu-theme-group` structure, same
sliding `::before` indicator, which already supports a three-stop layout:

```html
<div class="menu-theme-line">
  <span class="menu-theme-label">圆角：</span>
  <div id="menu-corner-group" class="menu-theme-group">
    <button class="menu-corner-opt is-active" data-corner="square">直角</button>
    <button class="menu-corner-opt" data-corner="soft">微圆</button>
    <button class="menu-corner-opt" data-corner="round">圆润</button>
  </div>
</div>
```

Wiring is three lines in `attachEventListeners()` (`app.main.js:7240`), following
the `themeOpts` pattern, plus two `refs` entries in `app.core.js:70`.

Note the menu is narrow and already carries 主题 / 语言 / 配置 rows. A fourth row
is fine vertically; the label uses the existing uppercase-kicker treatment so it
matches. The three option labels are short (2–3 Han characters) and will not
overflow the sliding indicator.

### Default

`square` (scale 0) — the faithful picotty look, and what the migration is for.
`soft` and `round` exist so a user who prefers the softer instrument-panel feel
is not forced out by an aesthetic opinion. A user upgrading from `main` has no
stored `cornerRadius`, so they land on `square` immediately.

## 6. Sequencing and verification

Each phase is one commit on `feat/modernist-ui`, verified before the next:

```sh
python -m http.server 8000        # source mode needs HTTP, fetch() rules out file://
python build-release.py           # must pass the leftover-reference assertion
node --check dist/SerialCanvas.html  # single-file sanity
python tools/docs-check.py        # when docs change
```

Manual checks that matter:

- Light **and** dark theme, both at `square` and at `round`.
- **Reload with a saved radius** — confirm no flash of the default. This is the
  `bootstrap.js` path and it is the most likely thing to get wrong.
- Status dots still circular at every setting.
- Floating menu, modal dialogs, chart flyout, toasts — the overlay shadows that
  Phase 2 kept.
- A live serial session in both terminal skins.
- The copy/paste config round-trip, since radius joins the snapshot.

A tool-assisted check via `tools/cdp-check.mjs` covers the static ones.

## 7. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A saved radius flashes the default on reload | Medium | `data-corner` is set in `bootstrap.js`, not just by the app at boot |
| Status dots squared at scale 0 | Medium | `--radius-dot` is a separate token, never multiplied; verified at all three settings |
| Blanket `rgba()` removal kills intentional translucency | Medium | Audit the 197 sites; the terminal-adjacent ones must stay deliberate |
| Radius tokens missed at a `border-radius` site | Low | Phase 2 is a mechanical full-file pass; `grep -c "border-radius: [0-9]"` in px must return 0 afterwards |
| `CHART_COLORS` / canvas literals drift out of sync | Low | Phase 5 is explicit about the five call sites |
| 5540-line CSS means a huge, hard-to-review diff | Low | Phase boundaries keep each commit reviewable |
| CJK strings look wrong under the new weight/tracking | Low | Verified in Phase 3 with real Chinese strings, not lorem |

## 8. Still open

1. **Terminal default skin** — follows the new dark `--bg-terminal`, or stays put?
   `TERMINAL_SKINS` (`app.terminal.js:12`) is a separate aesthetic contract; the
   default currently falls through to reading `--bg-terminal` from the body, so it
   will pick up the new value automatically. Worth confirming that is wanted.

## 9. Provenance

`tmp/picotty/` carries no `LICENSE` file, and its `styles.css:1`–`3` states the
tokens were imported from an external design project ("Raspberry Pi Dashboard UI
mockup"). The token values themselves — hex colours, spacing scales, `0px`
radii — are not protectable expression, so re-deriving them is straightforward.
But the file itself has no licence, so:

- **Re-derive the tokens, do not copy the file.** Every value in Phase 1 is
  written from scratch against SerialCanvas's own variable names.
- If any `app.js` logic is wanted later (the tooltip singleton is genuinely good),
  it gets reimplemented against SerialCanvas's structure, not pasted.
- Note the provenance in `docs/acknowledgements.md`, which already tracks what this project
  borrowed and from where.