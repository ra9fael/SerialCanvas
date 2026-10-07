# Plan: parse view in three parts, plus a key-bar reorder

Written after `854ae77` on `feat/modernist-ui`. Two asks in one pass:

1. the parse view should be three parts — **simulator source / parser settings +
   live results / charts**;
2. the terminal key bar's ordering is wrong.

Everything below was read out of the source, not inferred. Line numbers are from
`854ae77` unless stated.

**Status: landed.** Both parts shipped in one commit. Three things differed from
the plan and are recorded where they happened: the preview element was renamed
`#simulation-preview` because it now serves both script kinds; the simulator
panel got its own collapse control; and an unrelated latent bug turned up — an
unclosed comment at `style.css:6578` had been disabling every rule after it to
the end of the file, the parser-panel toggle's whole appearance included.

---

## Part 1 — the parse view is currently 1.5 panels, not three

### What is actually in the DOM

```
(index.html)
  285  <section class="panel parser-panel">          <- "解析协议设置"
  305    <div id="parser-panel-body">                 (collapsible)
  307      #text-parser-pane
  325      #binary-parser-pane
  344    </div>
  355    <section class="simulator-panel"> … </section>   <- nested, not a panel
  400    <section class="parser-results-card"> … </section>
  407  </section>
  410  <section class="charts-panel"> … </section>
```

So the reading order today is **settings → simulator → results → charts**, and
the simulator is a *section inside* the parser panel rather than a part of its
own. That is the gap between "four things stacked" and "three parts": the
simulator has no panel head of its own, no border, and lives inside the thing it
only feeds.

`style.css:2087` says so explicitly:

```css
/* Simulator: a section inside the parse panel, not a panel of its own, so it
   has no border or padding of its own and reads as part of the pipeline. */
```

### Change 1 — lift the simulator out, order it first

```
<section class="panel simulator-panel">   1. 模拟数据源   (default: open, collapsible)
<section class="panel parser-panel">      2. 解析协议设置 + 实时解析结果
<section class="charts-panel">            3. 图表
```

- Move `index.html:355-398` to sit immediately before `index.html:285`.
- Give it a real `.panel-head`: title `模拟数据源`, the enable toggle, the
  `#simulation-status` text, and a collapse button. The head currently only has
  the toggle + status (`.simulator-head`, `index.html:356-366`).
- `#parser-results-card` **stays inside** `parser-panel` — that is the merge the
  ask describes: settings and results in one part.
- Charts are already their own section; no move needed.

**Trap:** the simulator is hidden in monitor view today only because it is a
child of `.parser-panel`:

```css
/* style.css:2079 */
body:not(.layout-expanded) .parser-panel { display: none !important; }
```

Once it is a sibling, it must be added to that rule, or the simulator leaks into
the monitor view. `.charts-panel` already has its own rule at `style.css:2933` —
follow that shape.

- `style.css:2089` `.simulator-panel` changes from "inner group" to "top-level
  panel": panel border/radius/padding like `.parser-panel`, plus a head layout.
  `.simulator-panel .simulation-config` (2117) keeps its 2-column grid.

### Change 2 — the payload template is unusable

Measured with `audit/probe-sim-clarity.mjs` (headless, all three scripts):

| Symptom | Evidence |
| --- | --- |
| The default is invisible | `#simulation-template` has `placeholder="使用脚本默认"` (index.html:389) and value `""`; `SIMULATION_TEMPLATE_DEFAULT = ''` (app.core.js:211). Nothing on screen shows a template. |
| A dead-end field | for the binary script the text field is `disabled` + dimmed (`syncSimulationUi`, app.main.js:342-345). Disabled, unexplained, and the frame template it should use is two rows below. |
| Only one side has a preview | `#simulation-frame-preview` is binary-only (`app.main.js:275-283`); text scripts show nothing at all. |
| Two placeholders, one value | `{n}` and `{tick}` both expand to the tick (`applySimulationTemplate`, app.main.js:227-232). Documented as if they differed. |
| No legend | placeholders are only in a `title` tooltip (index.html:387), i.e. hover-only. |

Fix, in the order it pays off:

1. **Per-script defaults, filled in — not hinted.** Add `templateDefault` to
   each script in `SIMULATION_SCRIPTS` (app.core.js:124-186) and write it into
   the input on load/script-switch, so a newcomer sees an editable example:
   - `text-sensor` → `temp={temp},humid={hum};`
   - `text-json` → `{"device":"sim-01","uptime":{n},"temp":{temp}}`
   - `binary-frame` → `A5 {t} {h} {sum} 5A` (already
     `SIMULATION_FRAME_TEMPLATE_DEFAULT`, app.core.js:65)
2. **Dirty tracking.** Track `simulation.templateDirty` (and a frame-template
   twin). Switching scripts replaces the template only while the user has not
   typed in it; a hand-written template survives a script switch. Persisted like
   the rest of `state.settings.simulation` (app.main.js:6936).
3. **恢复默认 button** beside each template field — one click back to the
   script default. Cheap, and it makes "I broke it" recoverable.
4. **Show only the field that applies.** Text script → payload template;
   binary script → frame template. Hide the other instead of disabling it,
   which removes the dead end entirely (`syncSimulationUi`, app.main.js:341-352).
5. **Visible placeholder legend** under each field (not a tooltip):
   `{temp} 温度 · {hum} 湿度 · {n} 帧号 · {ts} 总帧数 · {tick} 同 {n}` and
   `{t} 温度×10 · {h} 湿度 · {n} 帧号 · {sum} SUM8(占位符字节)`. Keep a `?`
   help icon for the long form — the pattern exists (`data-tip`,
   index.html:310/329).
6. **Preview for both paths.** Reuse `#simulation-frame-preview` as one
   `下一帧预览` line and switch its source: `buildSimulationFrame()` for binary,
   `applySimulationTemplate()` on the script's own text for text scripts.
7. **A sample line per script**, e.g. `该脚本默认发出：temp=21.0,humid=48;` —
   the cheapest answer to "what will this send".

### Open decision

`{n}` and `{tick}` are the same value today.

- **(A, chosen)** keep both, label `{tick}` as an alias of `{n}` in the legend
  and in `docs/parser.md`. Zero risk to saved templates. Done: the legend reads
  `{n}/{tick} 帧号`.
- **(B)** make them genuinely different (`{n}` global frame counter, `{tick}`
  index within the current burst). More useful for burst testing, but it changes
  what an existing template expands to.

---

## Part 2 — the key bar is miscategorised, not merely long

### What is actually rendered

`TERM_KEY_GROUPS` (app.terminal.js:422-492) — 5 groups, 44 keys:

| Group | Keys | Row (TERM_KEY_ROWS, 504-507) |
| --- | --- | --- |
| `submit` | Enter⏎ (wide), Alt-⏎ — 2 | 0 |
| `nav` | ↑ ↓ ← → Home End PgUp PgDn Ins ⇧Tab ^← ^→ Alt-B Alt-F F1 F2 F3 F4 — 18 | 0 |
| `edit` | Bksp Del ^A ^E ^B ^F ^K ^U ^W ^T ^Y — 11 | 1 |
| `history` | ^R ^P ^N ^O ^L — 5 | 1 |
| `control` | ^C ^D ^Z ^G ^V ^X Tab Esc — 8 | 1 |

Row 0 = 20 keys, row 1 = 24 keys across three groups.

### What is actually wrong (beyond the count)

1. **History is split in two.** ↑ ↓ are in `nav` on row 0; ^P ^N — *the same
   function* — are in `history` on row 1, with the whole edit group between
   them.
2. **Transpose is split in two.** ^T 转置字符 is in `edit`; ^X 切换转置 is in
   `control`.
3. **Amber means nothing.** `.term-key-control` (style.css:6088) is styled as a
   warning because those bytes interrupt the device's foreground process — but
   the group contains ^V (引号插入), ^X, Tab and Esc, none of which interrupt
   anything. Four of eight amber keys are false alarms.
4. **Movement keys are filed under editing.** ^A/^E (行首/行尾) and ^B/^F
   (左/右一字符) sit between Bksp and ^K in `edit`.
5. **The rarest keys hold the best slot.** F1-F4 close out row 0; PgUp/PgDn/Ins
   sit in the middle of the everyday movement keys.

### Change — six groups, ordered by what a session actually presses

| # | Group | Keys | n | Why here |
| --- | --- | --- | --- | --- |
| 1 | `submit` | Enter⏎ (wide), Alt-⏎ | 2 | Enter first; unchanged |
| 2 | `history` | ↑ ↓ ^P ^N ^R ^O ^L | 7 | recall right after submit; arrows + emacs equivalents together |
| 3 | `move` | ← → ^← ^→ Home End ^A ^E ^B ^F Alt-B Alt-F | 12 | char → word → line, then emacs, then alt |
| 4 | `edit` | Bksp Del ^K ^U ^W ^T ^X ^Y ^V | 9 | delete granularity ascending; ^X next to ^T |
| 5 | `page` | PgUp PgDn Ins ⇧Tab Tab Esc F1 F2 F3 F4 | 10 | screen/function keys, lowest frequency |
| 6 | `control` | ^C ^D ^Z ^G | 4 | only real interrupts, so amber means interrupt again |

44 keys preserved, no binding lost. `TERM_KEY_ROWS` becomes:

```js
const TERM_KEY_ROWS = [
  ['submit', 'history', 'move'],   // ~21 keys
  ['edit', 'page', 'control']      // ~23 keys
];
```

**Why this split and not "hot keys on top".** Rough rendered widths
(`min-width:28px` + padding, wide labels for Home/End/Alt-B/PgUp/⇧Tab, ~70px
for the wide Enter):

| Assignment | Row 0 | Row 1 |
| --- | --- | --- |
| **(chosen)** submit+history+move / edit+page+control | ≈790 px | ≈815 px |
| submit+edit+history / move+page+control | ≈650 px | ≈960 px |

Rows are `flex-wrap: wrap` (`style.css:6033`), so an unbalanced pair is exactly
what makes the bar change height as the window resizes — the thing the two-row
split was introduced to stop. The chosen split is within ~3%.

Trade-off, stated: Bksp/Del land on row 1. They are the first group there, which
is where the eye goes after Enter, but they are below ↑↓ rather than beside
them. The alternative is a 48% width imbalance.

Optional (say if you want it): a tiny group caption before each group
(提交 / 历史 / 移动 / 编辑 / 翻页 / 控制). It costs ~40-60 px per group and makes
the categories self-explanatory; the current dividers alone do not explain
anything. My default is to skip it and keep the width for keys.

---

## Files touched

| File | Change |
| --- | --- |
| `index.html` | simulator section moved out of `parser-panel` and given a panel head; template help legend + preview + 恢复默认 buttons (~285, ~355, ~387) |
| `style.css` | `.simulator-panel` becomes a top-level panel; add it to the `body:not(.layout-expanded)` hide rule; styles for the legend/preview/restore button; `.term-key-bar-group` caption only if wanted |
| `app.core.js` | `templateDefault` per script; `simulationDefaultTemplate(scriptId)` helper |
| `app.main.js` | `syncSimulationUi()` — show/hide by script type instead of disabling, fill defaults, dirty tracking, text-side preview, restore handler |
| `app.terminal.js` | `TERM_KEY_GROUPS` regrouped and reordered; `TERM_KEY_ROWS` updated |
| `docs/parser.md` | payload/frame template section: defaults, placeholders, `{tick}` alias |
| `audit/` | see below |

## Verification

- New `audit/verify-sim-clarity.mjs` — promote the existing probe to assertions:
  every script has a non-empty visible template, only the applicable field is
  rendered, both previews update, 恢复默认 restores, a hand-written template
  survives a script switch.
- `audit/verify-keybar.mjs` — 5 groups → 6, row assignment, **44 keys and every
  byte binding still present** (its "missing key" list at line 61 must stay
  empty for all 12 sampled keys), ^C stays amber, Enter stays the wide primary.
- `audit/verify-parse-view.mjs` — assert three top-level panels in order, and
  that the simulator is absent from the monitor view (use `checkVisibility()`,
  not `getComputedStyle` on a child).
- Re-run: `verify-parser-collapse`, `verify-binary`, `verify-sim-config`,
  `verify-sim-tag`, `verify-incremental`, then `build-release.py` and the docs
  check.

## Order of work

1. Key bar (one file, self-contained, no layout risk).
2. Simulator lift + panel head (structure only; verify nothing leaks into the
   monitor view).
3. Template clarity (the part with real behaviour).
4. Verify, build, docs, commit — one commit per step if you want them separable.
