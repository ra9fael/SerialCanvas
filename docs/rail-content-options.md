# The empty rail — what it actually is, and what could go there

Branch: `feat/modernist-ui`. Companion to `docs/layout-redesign.md` and
`docs/rail-ui-changes.md`.

---

## The empty space is a reserved grid row, not unused space

`.left-column` (`style.css:1996`) is:

```css
grid-template-rows: auto minmax(0, 1fr);
```

Two rows. It has **one** child element — `.expanded-left-top`, which wraps
`.config-panel`. The second row, sized `1fr`, was for `.parser-panel`, which
`style.css:2712` hides:

```css
body:not(.layout-expanded):not(.compact-single) .parser-panel,
body:not(.layout-expanded):not(.compact-single) .charts-panel {
  display: none !important;
}
```

Measured: rail 934px, config-panel 432px. The 502px difference is the `1fr`
row with nothing in it.

**So the honest framing is: the parser panel belongs there and is deliberately
hidden, not that the rail has room for new panels.** That distinction decides
the whole question, so it is worth being precise about it.

### Why the parser panel is hidden by default

`layout-toggle-btn` (`index.html:279`) is labelled 图形解析模式 / graph parsing
mode (`app.core.js:2450`). Graph parsing is an opt-in workflow: binary framing
plus charts. Text parsing — the rule box, the live result cards — works in the
default view, and `C3`'s simulator feeds it there. Only the graph-parsing
*configuration* (binary schema table, chart list) lives behind the toggle.

That is a defensible product decision. It also produces the two problems below.

---

## Two real problems in the current arrangement

### 1. The mode toggle is inside the panel it switches

`layout-toggle-btn` is at `index.html:279`, inside `.config-panel`
(lines 145–286). Reaching graph-parsing mode therefore requires opening the
connection panel first — the control that leaves the connection view is
buried in it. And once expanded, the left rail holds config + parser +
charts while `monitor-panel` is measured at `0x0`: the toggle reads like a
view switch but replaces the entire right column.

### 2. `layout-expanded` is a replacement, not an addition

Measured in the previous phase: `chartsPanel 1574x80`, `monitorPanel 0x0`.
A serial session's live view disappears entirely. For a control named "graph
parsing mode" that is surprising — the user did not ask to stop monitoring.

This is why the rail feels wrong even apart from the empty row: the layout has
two shapes rather than a continuous space, and the taller shape hides the
monitor.

---

## Options, honestly ranked

### Option 1 — Single-row rail, space goes back to the monitor

```css
.left-column { grid-template-rows: auto; }
```

The rail shrinks to roughly 440px and the monitor gains the ~490px.

**What it costs.** Graph parsing loses its entry point in the default view,
because the toggle that reveals the parser config is itself inside the
connection panel, and the panel that holds it would now be the full height of
the column. This is a genuine chicken-and-egg: you need the parser settings
to use graph parsing, and the route to those settings is buried in the panel
you just made shorter.

Cheapest to implement, and it makes the empty row *disappear* rather than
filling it.

### Option 2 — Parser panel visible by default, rail becomes two real panels

Remove the `display: none` for `.parser-panel`, keep only the chart list
behind the toggle. The `1fr` row gets its intended occupant, and the rail
reads as "connection + parsing", which is what the space was reserved for.

**What it costs.** The parser config panel is tall (rule editor plus binary
schema table). At 432px of connection panel plus a parser panel, the column
will scroll on shorter viewports — need to verify at 1000px height, which is
the measured case.

This is the option I would recommend, because it makes the layout mean
something rather than making it smaller.

### Option 3 — Move the mode toggle out of the connection panel

Put it in the topbar or the corner block, so it is reachable regardless of
which panel the rail is showing, and make `layout-expanded` additive: keep the
monitor visible, move only the charts.

**Independent of 1 and 2.** It fixes the "buried control" and "my session
disappeared" problems. Worth doing either way.

---

## What could genuinely fill the space

If the answer to the rail question is "add something", these are the
candidates — all already implemented, all currently without a reachable entry
point in the default view. Each is **new surface**, not filling a gap, so
each deserves its own decision rather than being bundled into a layout fix.

| Candidate | State in the code | Why it would earn the space |
| --- | --- | --- |
| **Send module entries** | 定时发送 / 触发发送 / 预设发送 fully implemented (`module-card`, `index.html:532/552/566`), toggles at `index.html:592–600` inside the monitor's send strip, all collapsed by default | Automation is a primary reason to use this tool, and finding it requires scrolling the monitor. A rail entry per module would also let each keep its own settings visible |
| **Chart strip** | 时域图 / 频域图 / 柱状图 at `index.html:357` in `charts-panel`, which is a **sibling of `.workspace`**, not a child | Charts are the only visualisation in the app and currently have no entry point in the default view at all |
| **Session statistics** | `stats-grid` exists in CSS (`style.css:2386`) with **no element in `index.html`** — orphan CSS. `state.session` already tracks `rxBytes`, event count, duration | The status pill shows connection age but not volume. A live byte/event counter answers "is this link actually passing data" |
| **Device profiles** | VID/PID are two floating `-` spans (`index.html:151`). No storage exists | Serial devices are few and revisited. Remembering baud + flow control per VID/PID is the real usage path, and it turns VID/PID from decoration into a key |

My ranking: **device profiles** first (highest real value, smallest surface —
the data is already being displayed), then **session statistics** (the orphan
CSS is already there), then **send module entries** (largest win, largest
surface), then the **chart strip** (already handled by making
`layout-expanded` additive).

Note this is the **eighth** orphan-CSS / no-entry-point finding in this
project. The pattern is consistent: `stats-grid` was written for a panel that
was never built, exactly as `.insight-pre` was styled for an element that
was never created.

---

## Recommendation

Do **Option 3 plus one of 1/2**, in that order, and treat device profiles as a
separate feature commit.

- **Option 3 first.** It is a behaviour fix (additive instead of
  replacement, reachable toggle) and does not depend on the row decision.
- **Then Option 2.** Making the parser panel the default occupant is what
  turns the empty row into meaning. Option 1 is the fallback if the parser
  panel turns out not to fit at 1000px height.
- **Device profiles** afterwards, as its own commit — it is a new feature
  with storage, not a layout change.

## Open decisions

1. **Option 1 or 2?** Option 2 needs a height check at 1000px; option 1 costs
   the graph-parsing entry point unless Option 3 lands first.
2. **Does graph parsing need to stay opt-in?** If the answer is no, both
   problems dissolve — the panel is visible and the toggle disappears. That is
   a product question I cannot answer from the code.
3. **Device profiles: localStorage or a file?** The config export already
   produces JSON, so profiles could ride along in it. Scope differs a lot.
