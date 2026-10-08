# Key-bar additions and editable preset combos

Status: implemented. The row split landed as planned and was measured at
4.6% width skew; audit/verify-combo.mjs (20 assertions) and the updated
verify-keybar/verify-sim-config hold the contract. All findings were read out
of the working tree at `233e3a6`.

Two asks from the 2026-10-08 review:

- Eight more terminal quick keys: ^S, ^Q, ^\, ^H, ^M, ^J, Alt-D, Alt-Bksp.
- Five select-only controls (font size, scrollback, log chars, sim interval,
  sim burst) should become baud-style combos: type a value OR pick a preset.

<a id="keys"></a>

## 1. Eight key-bar buttons

Current state: 44 keys in 6 groups, byte map in `TERM_KEY_SEQUENCES`
(app.terminal.js:365). One latent entry: `ctrl-h: '\x08'` is already in the
map but no button references it — left over from an earlier shuffle.

| Key | Bytes | Lands in | Why there |
| --- | --- | --- | --- |
| ^Q | `0x11` | flow (new, 2 keys) | XON. Resumes output frozen by ^S |
| ^S | `0x13` | flow | XOFF. The classic "screen froze" — worth a button pair |
| ^\\ | `0x1C` | control (amber) | SIGQUIT — the one real interrupt missing from ^C ^D ^Z ^G |
| ^H | `0x08` | edit | BS byte. Bksp sends 0x7F; some firmware only honours 0x08. Mapping exists already |
| ^M | `0x0D` | submit | Raw CR, bypassing the newline-mode setting |
| ^J | `0x0A` | submit | Raw LF. With Enter bound to the newline mode, one of the two bytes is always unreachable |
| Alt-D | `ESC d` | edit | Delete word forward. ^W only covers the backward direction |
| Alt-Bksp | `ESC 0x7F` | edit | Delete word backward (readline binding) |

Grouping notes:

- Flow gets its own two-key group instead of joining control, because the
  control group is styled amber (`term-key-control`, applied wholesale at
  app.terminal.js:592) and amber is reserved for bytes that interrupt
  something. ^Q/^S freeze nothing permanently; they must not shout danger.
- ^M/^J sit next to Enter because they are line endings — the submit group is
  "how a line ends", which is exactly what they are.
- Order in edit: deletion by granularity, as before — Bksp, ^H (same function,
  other byte), Del, ^W, Alt-Bksp, Alt-D, then ^K/^U.

Row balance: 52 keys total. Preliminary split
`[submit, history, move, flow] / [edit, page, control]` ≈ 25 vs 27 keys
(~740 / ~810 px at the usual per-key width); the final row assignment is
decided by measurement, not arithmetic — `audit/measure` + verify-keybar get
run after the change and `TERM_KEY_ROWS` adjusted to keep the bar two rows at
1440 px without a wrapped third line.

Out of scope (rejected for now): F5–F8 (needs keydown mapping work beyond
sequences), BREAK signal (not a byte; needs a `setSignals` action path).

<a id="combos"></a>

## 2. Baud-style combos for five selects

The pattern already exists once: `.baud-rate-anchor` → input + ▾ button +
`.floating-menu` preset list (index.html:174-190), toggled by
`toggleBaudRateMenu()` (app.core.js:2550) which closes every other open
floating menu first. It is baud-specific only in naming; the mechanism is
generic.

Current state of the five controls:

| Control | Id | Options | Handler today |
| --- | --- | --- | --- |
| 字号 | `mono-size-preset` + hidden `mono-size-custom` | 10–20 + 自定义 | two-step: pick 自定义, then type. Replaced by combo; the hidden-field dance is deleted |
| 回滚行数 | `term-scrollback` | 5000 / 20000 / 100000 | `setTerminalScrollback()` — whitelist `TERMINAL_SCROLLBACK_SIZES`, silently ignores non-members |
| 日志字符 | `live-buffer-size` | 256K / 1M / 4M | whitelist `LIVE_BUFFER_SIZES` at apply and at restore (app.main.js:6632) |
| 间隔 | `simulation-interval` | 60ms–5s | whitelist `SIMULATION_INTERVALS`, silent fallback to default |
| 每次帧数 | `simulation-burst` | 1 / 4 / 8 / 16 | whitelist `SIMULATION_BURSTS`, silent fallback |

The whitelists are the real blocker, not the markup: a typed value is
silently discarded by every one of these paths. Plan:

1. **Generalize the component.** One `wireCombo({ input, button, menu,
   parse, clamp, apply })` helper in app.core.js. HTML gets the same
   anchor/combo/menu triple per control; CSS: rename shared rules to
   `.combo-*` with `.baud-rate-combo` kept as an alias so nothing else moves.
   The toggle closes other combos via the existing
   `.floating-menu.open` sweep.
2. **Replace clamp-with-fallback by clamp-to-range.** Each control gets an
   explicit range instead of a membership test:

   | Control | Range | Presets (menu) |
   | --- | --- | --- |
   | 字号 | 8–48 (existing `clampTerminalFontSize`) | 10 11 12 14 16 18 20 |
   | 回滚行数 | 100–1,000,000 lines | 5000 20000 100000 |
   | 日志字符 | 64K–32M chars | 262144 1048576 4194304 |
   | 间隔 | 10–60000 ms | 60 200 700 2000 5000 (labels 60 毫秒…5 秒) |
   | 每次帧数 | 1–100 | 1 4 8 16 |

   Rationale for the caps: scrollback and log chars are pure memory, and a
   typo like 50000000 lines is a tab freeze, not a feature; interval below
   10 ms floods the RX path faster than the parser renders; burst > 100 is
   not a shape any polled device has.
3. **Restore paths clamp, not reject.** app.main.js:6632 (liveBufferSize),
   :245 (burst), :312 (intervalMs) and `getTerminalScrollback` /
   `clampTerminalFontSize` all switch to range clamps so a saved custom value
   survives reload. The whitelist constants stay as the preset lists for the
   menus.
4. **菜单 labels keep their units** (60 毫秒, 2 秒); the input stays a bare
   number in ms with the unit in the field label, matching how the baud
   input is a bare number.
5. **i18n**: new tips and unit labels go into app.lang.js both languages.

<a id="audits"></a>

## 3. Verification

- `verify-keybar.mjs`: group ids/counts (7 groups, 52 keys), row split, every
  new key present, byte bindings intact.
- New `verify-combo.mjs`: per control — type an off-preset value → applied;
  type an out-of-range value → clamped; preset click → applied + menu closed;
  invalid input does not throw; localStorage restore of a custom value
  survives reload.
- `verify-sim-clarity.mjs` / `verify-sim-config.mjs`: they drive
  `simulation-interval`/`simulation-burst` as selects — updated to set input
  value + dispatch input/change like the rest.
- Full regression suite + `build-release.py` + docs check.

<a id="risks"></a>

## 4. Risks and gotchas

- ^M/^J in local-echo mode route through `handleTermData` like every other
  button, where `\r` commits the edited line — same semantics as pressing
  Enter. In passthrough they go straight to the wire. No new behaviour, but
  the tips should say "raw byte" so nobody expects the newline setting to
  apply.
- Scrollback changes are applied to a live xterm instance
  (`term.options.scrollback`) — already proven safe by the existing handler.
- The key bar is a fixed two-row layout; 8 extra keys eat ~240 px. If
  measurement shows a third line at 1440 px, the fallback is dropping the
  divider gaps between groups, not shrinking keys below the 28 px hit target.
