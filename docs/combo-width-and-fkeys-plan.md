# Combo widths and F1–F12

Status: implemented. Rows landed as planned (862/682/614px — the balance
assertion became a no-wrap assertion at 1440 and 1100px, which is the actual
height-constancy contract for three rows). One extra root cause surfaced
during implementation: `.term-field input[type="number"] { width: 46px }`
(a legacy rule, higher specificity) was pinning every combo input — combos
now reset it, each combo has its own digit-width floor, and toolbar selects
shrink before the row wraps. Measured at `81ee635`. Two asks from the 2026-10-08 review:

- The combo inputs (scrollback, log chars, font size…) are too narrow: the
  number clips.
- The key bar should carry F1–F12; three rows are acceptable.

<a id="width"></a>

## 1. Combo inputs clip their numbers

Measured with audit/probe-combo-width.mjs, at 1440px and 1100px alike:

| Input | Actual width | Width needed for `33554432` |
| --- | --- | --- |
| `mono-size-input` | 46px | ~76px |
| `term-scrollback` | 46px | ~76px |
| `live-buffer-size` | 46px | ~76px |

Not a narrow-window squeeze — the inputs are 46px at every width. The combo
grid is `minmax(0, 1fr) 32px` and nothing gives the text column a floor, so
the toolbar's field sizing starves it. Six digits fit in 46px by luck; seven
(`1000000`, `33554432`) do not.

Fix: `min-width: 78px` on `.combo > input` (8 digits + the 20px horizontal
padding). The 32px ▾ button is unchanged, so each combo grows ~32px. The
buffer toolbar holds two of them (+64px in row 2), and verify-toolbar-rows
asserts no overflow/no truncation at 1100px — if that trips, the fallback is
trimming the two field labels (回滚行数 → 回滚) rather than shrinking the
input below the digits it must show. A geometry assertion goes into
verify-combo.mjs: for every combo, input width ≥ rendered width of its own
`max` attribute value.

<a id="fkeys"></a>

## 2. F1–F12 and the three-row bar

Sequences are the standard xterm set and xterm already emits them from the
physical keyboard, so this is button-side only — no keydown work:

```
f5  ESC[15~   f6  ESC[17~   f7  ESC[18~   f8  ESC[19~
f9  ESC[20~   f10 ESC[21~   f11 ESC[23~   f12 ESC[24~
```

Grouping: F1–F4 move out of `page` into a new `fkeys` group holding all
twelve. "Function keys" is one concept; splitting it 4/8 across two groups
was an artifact of F5+ being rejected earlier. `page` keeps the six keys that
are really about the screen or the editor: PgUp, PgDn, Ins, ⇧Tab, Tab, Esc.

60 keys, 8 groups:

| Group | Keys | Count |
| --- | --- | --- |
| submit | Enter Alt-⏎ ^M ^J | 4 |
| history | ↑ ↓ ^P ^N ^R ^O ^L | 7 |
| move | ←→ ^←^→ Home End ^B^F ^A^E Alt-B Alt-F | 12 |
| edit | Bksp ^H Del ^K ^U ^W Alt-⌫ Alt-D ^T ^X ^Y ^V | 12 |
| page | PgUp PgDn Ins ⇧Tab Tab Esc | 6 |
| flow | ^S ^Q | 2 |
| control | ^C ^D ^Z ^G ^\\ | 5 |
| fkeys | F1–F12 | 12 |

Three rows (preliminary, decided by measurement like last time):

```
row0: submit, history, move        (23 keys, ~700px)
row1: edit, page                   (18 keys, ~560px)
row2: flow, control, fkeys         (19 keys, ~580px)
```

Row 0 is line input and navigation; row 1 is text and screen manipulation;
row 2 ends the bar with the device-affecting keys — flow, the amber
interrupts, and the function keys the firmware eats. Amber stays at the very
end, which is where the "read twice before pressing" keys belong. The render
loop (`TERM_KEY_ROWS.forEach`) already supports any row count; bar height goes
from two rows to three (~34px), and the key bar remains collapsible.

Audit updates: verify-keybar (60 keys, 8 groups, three rows, all F-sequences
present), verify-three-issues (total 52 → 60), verify-combo (new width
assertion). Full regression + build + docs check, then v0.4.2.

<a id="risks"></a>

## 3. Risks

- The +34px of bar height comes out of the terminal canvas in the default
  view; the collapse toggle already exists for users who mind.
- Row 2 at ~580px is the lightest; if the measurement pass shows the three
  rows too ragged (the assertion threshold is 25% max/min), the fallback is
  moving `flow` up to row 1 (edit, flow, control / page, fkeys) — semantics
  slightly worse, balance better.
- f10 in some terminals is menu-key bound; xterm.js emits ESC[21~ and that is
  what the button sends. No special casing planned.
