# Connection rail — measured sizes and the visual changes

Branch: `feat/modernist-ui`. Item 4a / 4b of `docs/five-issues-plan.md`.

All numbers below come from `audit/shot-rail.mjs` and
`audit/measure-controls.mjs` at 1440x1000 and 1920x1080. The screenshot is
`audit/rail-1440.png`.

---

## What is actually there

19 interactive controls in the connection rail, **6 distinct heights**:

| Height | Count | What |
| --- | --- | --- |
| 59.3px | 2 | `RELEASE ON BLUR`, `RTS/CTS FLOW CONTROL` — wrapped to two lines |
| 44.2px | 1 | the Connect button |
| 40px | 3 | DTR / RTS / BREAK signal chips |
| 31px | 6 | custom-select triggers, baud preset button |
| 30px | 2 | baud input |
| 15px | 5 | the checkboxes themselves |

Space: rail 274x934 at 1440, config-panel 432 tall.

**A measurement caveat worth recording.** The first probe reported the three
`data-bits` / `stop-bits` / `parity` selects as 16px tall, which looked like a
severe flattening bug. It is not. Each `<select>` is wrapped at runtime by a
custom select widget (`app.core.js:2279`) and the native element is hidden with
`position: absolute; inset: 0; width: 0; height: 0; opacity: 0`
(`style.css:752`). A hidden absolute element reports a collapsed box. The
visible control is `.custom-select-trigger` at 31px. **That is the seventh time
a probe artefact has been read as a defect in this project** — the check is
always the same: confirm the element the user actually sees is what you
measured.

---

## The changes

### 1. Two height tokens

```css
--control-h: 32px;      /* selects, inputs, inline buttons, toggle rows */
--control-h-lg: 44px;   /* the Connect button only */
```

Mapping the six current values: 30 / 31 / 40 / 59.3 -> `--control-h`,
44.2 -> `--control-h-lg`. The checkbox at 15x15 becomes 16x16.

**The Connect button keeps its height difference on purpose.** It is the only
primary action in the panel; making it the same height as a baud preset button
would flatten the hierarchy. Everything else becomes uniform.

### 2. Un-wrap the two labels

`RELEASE ON BLUR` (15 chars) and `RTS/CTS FLOW CONTROL` (20 chars) wrap because
the uppercase kicker treatment plus tracking needs roughly 8px per character,
and the label cell has about 100px next to the checkbox. **This is a structural
constraint of the English locale, not a one-off.**

Fixes, in order of preference:

- Give the label its own full-width row: checkbox on the right, label allowed to
  use the whole cell. Already the case for DTR/RTS/BREAK (which fit), so the
  change is to make the layout not depend on the text fitting.
- Shorten the English: `RTS/CTS flow` is unambiguous next to the DTR/RTS/BREAK
  row it sits in. `Blur release` is shorter than `Release on blur`.
- If a label still wraps, cap it at two lines with a fixed row height so the
  grid stays even — `min-height: var(--control-h)` plus
  `align-items: center` on `.toggle-row` already nearly does this; what is
  missing is that the row grows rather than the text truncating.

I would do the first (layout no longer depends on text length) and the second
(shorter English), and keep the third as the safety net.

### 3. Give the checkboxes a visible checked state

The screenshot shows five checkboxes that all read as empty outlines — the
state is legible only from the 15x15 box being there at all. Two contributors:

- 15px is small against a 32px row; it disappears rather than reads.
- `accent-color: var(--accent)` (`style.css:2627`) colours the native control,
  but the boxes in the screenshot are unchecked, so nothing is demonstrated.

At 16x16 with `accent-color` on the new `--accent` (`#ec3013` light,
`#ff563c` dark), a checked box will read clearly. I would also verify the
checked state in both themes — `accent-color` inherits from `color-scheme`, so
it should follow, but it is worth a screenshot rather than an assumption.

### 4. Signal read-outs: dashed -> solid

`border: 1px dashed var(--border)` (`style.css:2525`) on `.signal-readout`.
A dashed frame conventionally means "fillable, awaiting input". These are
read-only device inputs.

- Solid 1px, matching `.signal-chip` and `.toggle-row` — they become one visual
  family, which is correct because they are one kind of thing (a labelled
  control row) even though two are settable and two are not.
- Three-state indicator instead of text alone:
  - never read -> muted `未知` (today: `-`)
  - read, false -> `关`
  - read, true -> `开`, plus the existing `.is-on` treatment

  The distinction matters because `getSignals()` on a driver that does not
  report modem status returns all-`false` rather than throwing, which is
  currently indistinguishable from a genuine "all low".
- Keep them non-interactive. The Web Serial API cannot set an input pin.

### 5. VID / PID relocation

`index.html:151` — currently floated at the top right of the panel head,
baseline-misaligned with the two-line title, showing `-` before a connection.
It is device metadata, so it belongs with the connection state, not the title.

Move it below the Connect button as a single meta line:
`VID 2341  PID 0043`, muted, one line, right-aligned or full-width. That also
gives the panel a natural bottom edge above the signal rows.

---

## What this does not change

- **The rail's empty space.** Measured rail 934px vs config-panel 432px. The
  slack is the parser column, hidden by `style.css:2712`
  (`body:not(.layout-expanded)`), waiting for graph-parsing mode. Collapsing the
  panel and making `layout-expanded` additive are the proposals in
  `docs/layout-redesign.md` and are **not** part of this change. Doing the size
  unification first means the collapse has a consistent height to collapse to.
- **The toolbars.** `--control-h-sm` (28px) is defined for the monitor toolbar's
  `term-field` chips so the token exists for them, but their current sizing is
  left alone — they were already tuned for density at 1280px in `c9720e5` and
  changing them now would undo that measurement.

---

## Verification

- `audit/shot-rail.mjs` re-run: the distinct-height count must drop to 2
  (32 and 44), plus the 16px checkbox. The script is the assertion here.
- Same screenshot in both themes, and with a port connected so the checked
  state and the `开` / `未知` states are both visible. Without hardware, inject
  through CDP by assigning `state.serial.signalInputs` and calling
  `updateSignalControlsUI()` — the same path `getSignals()` drives.
- English locale specifically, at 1440 and at 1280, since the wrap is an
  English-width problem.
- B1 / B2 / C2 / C3 / tooltip / i18n checks re-run; the rail markup does not
  change, only CSS and two label strings, so they should be unaffected.

## Open decisions

1. **English label shortening.** `RTS/CTS flow control` -> `RTS/CTS flow` and
   `Release on blur` -> `Blur release`, or keep the descriptive wording and rely
   on the layout fix alone? The first is terser; the second is clearer to
   someone who has not read the changelog.
2. **`未知` for the never-read state.** Keep `-` and only distinguish the
   "read but all low" case, or make the unknown state explicit?
3. **Checkbox style.** Keep the native control with `accent-color`, or replace
   with a styled span so the checked state is a filled vermilion box with a
   check glyph? The native one is more accessible for free; the styled one is
   more consistent with the rest of the redesign.
