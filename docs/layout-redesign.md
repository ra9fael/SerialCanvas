# B3 — layout redesign

Written after C1/C2 and the tooltip singleton landed. Every number below was
measured with the throwaway drivers in `audit/`, not estimated.

## Correction first

The plan assumed the layout had a vertical overflow problem. **It does not.**

`audit/measure-layout.mjs` reported `scrollHeight 1242 > clientHeight 1000`,
which looked like 242px of overflow. It was an artefact: `audit/find-overflow.mjs`
walks every element with `getBoundingClientRect()`, and the closed version modal
is `opacity: 0; pointer-events: none` rather than `display: none`, so its
1024px-tall changelog was counted. The dialog itself is fine —
`.version-modal` has `max-height: min(680px, calc(100vh - 44px))`,
`overflow: hidden` and `grid-template-rows: auto minmax(0, 1fr)`, so the body
scrolls internally.

The height chain is sound: `.app-shell` (grid `auto 1fr`) → `.workspace`
(`height: 100%`) → `.left-column` / `.right-column` (`height: 100%` +
`min-height: 0`). Measured `scrollHeight == clientHeight` once the closed modal
is excluded.

**This is the fourth time a probe artefact has been read as a product defect**
(the others: a hidden-field focus trap, a boot META line counted as data, and the
`.insight-pre` orphan). Check the measurement path before believing the number.

## What the measurements actually show

| Viewport | Rail | Left column | Right column | Config panel |
| --- | --- | --- | --- | --- |
| 1440 | 274 | 274×934 | 1142×934 | 274×432 |
| 1600 | 304 | 304×934 | 1278×934 | 304×432 |
| 1920 | 320 | 320×934 | 1576×934 | 320×432 |

### Correction: the rail has no "empty parser panel" to fill

The first proposal here was an idle hint in the parser panel, on the reasoning
that the rail was 46% empty and a blank panel looked broken. **That was wrong,
and implementing it proved it.**

`style.css:2705` hides `.parser-panel` and `.charts-panel` outright, and
`body:not(.layout-expanded)` hides them again with `!important`. So in the
default layout the rail shows **only** `config-panel` — the parser panel, the
parse results card and the charts are all absent. The ~500px of unused rail is
not an empty panel; it is the parser column waiting for the graph-parsing layout.

Confirmed by walking the parent chain at runtime: `#parser-idle-hint` measured
0×0 because every ancestor up to `.expanded-left-top` resolved to
`display: none`.

So there is no blank surface to annotate. The rail's spare height is a *mode*
difference, not wasted space.

## What the measurements do show

Two real observations:

1. **`config-panel` is 432px in a 934px column.** After B1 moved the manual
   parameters to the monitor toolbar, the connection panel is under half the
   rail's height, and the rest is empty. That is genuine slack in the default
   layout — but the fix is either a collapsed state for the panel or moving the
   signal readouts out, not an annotation.

2. **`layout-expanded` swaps the whole right column away.** Measured in expanded
   mode: `chartsPanel 1574×80`, `monitorPanel 0×0`. A control labelled "graph
   parsing mode" makes the serial monitor disappear entirely, which is a jarring
   swap for something that reads like a view toggle.

## Proposed changes, in priority order

### 1. Make `layout-expanded` additive rather than a swap

Keep the monitor visible and move only the charts into the rail. The serial view
should never vanish while switching modes.

This is a behavioural change to `arrangeWorkspacePanels()` (`app.core.js`) and
must keep the persisted `layout.expanded` flag working, so it wants its own
commit with before/after screenshots.

### 2. Fill the rail's slack in the default layout

Options, cheapest first:

- Collapse `config-panel` to its header when the port is open and idle, so the
  rail does not present 500px of nothing.
- Move the signal readouts (CTS/DSR/DCD/RI) to the bottom of the rail instead of
  inside the panel, letting the panel end where its content ends.
- Give the collapsed rail a summary line: port, baud, framing, and connection
  state — the four things you actually check at a glance.

### 3. Density pass on the topbar

Already done for the monitor toolbar (156px → 79–87px). The topbar still holds
the timeline ribbon at a fixed `--header-height: 52px`, which is 5% of a 1000px
viewport for a control that is idle most of the time. Consider collapsing the
ribbon to its strip when not recording.

## What is deliberately not proposed

- **An idle hint in the parser panel.** Measured to be unreachable in the default
  layout; see the correction above.
- **Moving the parser panel to the right column.** It belongs next to the log it
  explains, and the right column is already 1142–1576px wide.
- **A three-column layout like the reference.** picotty is a fleet console; this
  is a single-port instrument panel. The column count is not the lesson.
- **Anything that removes `min-height: 0`.** It is what lets the children scroll
  instead of pushing the shell taller.

## Verification for this phase

`audit/measure-layout.mjs` at 1440 / 1600 / 1920 in both `layout-expanded` states,
plus screenshots of each. The assertion that matters is
`scrollHeight == clientHeight` **with the closed modal excluded** — and any
assertion about a rail element must first check that its ancestors are visible,
which is what made the first attempt look like a bug.