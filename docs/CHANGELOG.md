# Changelog

Versions match the **About** dialog inside the app. Dates are `YYYY/M/D`.
Chinese mirror: [zh-CN/CHANGELOG.md](zh-CN/CHANGELOG.md).
This repository is tagged from `v0.1.0`; the entries below it keep the upstream `1.x` numbers
they shipped with. `tools/set-version.py` writes every section but those.
Everything numbered `1.x` is an upstream release by the original author,
[Conductance-lab](https://conductance-lab.xyz) — see [origin & credits](acknowledgements.md).

## v0.4.1 — 2026/10/8

- Eight new terminal quick keys: ^S / ^Q (XOFF/XON flow control, in a new non-amber group),
  ^\ (SIGQUIT, completing the interrupt set), ^H (BS 0x08 — the mapping existed, the button
  did not), ^M / ^J (raw CR/LF that ignore the newline-mode setting) and Alt-D / Alt-Backspace
  (kill word forward/backward). 52 keys in 7 groups; the row split re-measured at 4.6% skew.
- The five select-only controls — font size, scrollback lines, log character budget, simulator
  interval and frames-per-tick — are baud-style combos now: type a value or pick a preset.
  Their handlers were membership whitelists that silently dropped any typed value; they clamp
  into explicit ranges instead (font 8–48, scrollback 100–1M, log 64K–32M chars, interval
  10–60000 ms, burst 1–100), and saved custom values survive a reload. The two-step
  "自定义" font-size flow is gone.

## v0.4.0 — 2026/10/8

- The project is renamed **SerialCanvas**: it started from SerialWeb `v1.6` and has developed
  independently, so the fork framing is retired. `docs/fork.md` becomes
  [origin & credits](acknowledgements.md), the About dialog keeps only the original repo link,
  and the UI credit now also names [PICOTTY](https://github.com/morpheuslord/PICOTTY). The
  build output (`dist/SerialCanvas.html`), the offline download filename and the Pages
  workflow follow the new name; AGPL-3.0 and the original copyright are unchanged.
- The three ☰-menu segmented rows (theme / language / corner) now share one style: two CSS
  `:not()` lists forgot `.menu-corner-opt`, so the corner buttons were laid out as list
  buttons (36px tall, generic hover background) instead of segmented ones. The sliding accent
  indicator also carried its 1px border outside `border-box`, so at the third position it
  slid past the group's right border — visible on 深色模式 / 跟随系统 / 圆润.
- The simulation chip in the monitor toolbar drops the frame count — it answers "is this stream
  real", and the RX counter already says how much. It shows in both monitor sub-views, including
  the terminal: the chip sits in the toolbar row above the log, not inside the terminal canvas.
- The monitor toolbar is a fixed two-row layout (identity and actions / parameter fields),
  replacing the 1280px wrap, 1440px term break and 1560px label-hide patches; labels no
  longer truncate at common window widths.

## v0.3.0 — 2026/10/1

- The interface now states that this is a **fork**: the About dialog names the upstream project,
  the divergence commit (`e3f9200814`, upstream v1.6, 2026/9/6) and where each build lives, and the
  ☰ menu and dialog links point at this repository instead of the original author's host.
- Added a **License** row to the About dialog plus a `LICENSE` file: SerialCanvas is AGPL-3.0, the
  license the upstream project declares.
- The hosted build no longer sends the upstream page-view request — it fires only on the original
  author's host, so a GitHub Pages or localhost deployment makes no analytics call.
- Added a GitHub Actions workflow that builds `dist/SerialCanvas.html` and publishes it to GitHub
  Pages as `index.html`.
- Documentation: new [origin & credits](acknowledgements.md) page in both languages, and
  `tools/docs-check.py` verifies doc links, heading anchors and the English/Chinese mirror.

## v0.2.0 — 2026/10/1

- Added **language switching**: 中文 / English / Follow system in the system menu (`☰`). The
  choice is applied instantly, needs no reload and persists; only the interface is translated,
  captured log lines and terminal history keep the language they were written in.
- The terminal **font picker is now honest**: families that are not installed on the machine are
  greyed out with a tooltip, instead of silently rendering like the default monospace font.
- Font and theme changes now apply reliably, including while the terminal is hidden (manual view or
  the collapsed monitor) — the pending change is applied when the terminal becomes visible again.
- Added a terminal **font size** field (8–48 px, default 12) and `Ctrl` + mouse wheel zoom over
  the terminal. Both persist.
- **Clear config** now also resets the language and the terminal font/size, and re-applies them live.

## v0.1.0 — 2026/9/30（原 v1.6）

Upstream `1.6` (`e3f9200814`, 2026/9/6) taken into this fork, with the single `index.html` split
into the source files this repository uses today. Its own additions — notably the xterm terminal
view, which upstream `1.6` does not have — are described in
[origin & credits](acknowledgements.md#provenance).

- Fixed the monitor occasionally inserting blank lines for certain receive patterns.
- Refined the display of components in device connection management.
- Refined chart panel display and interaction logic.

## v1.5 — 2026/7/9

- Renamed "automatic hardware flow control" to **RTS/CTS 流控** to describe what it actually
  does.
- Rewrote TX/RX and newline-handling logic; improved monitor rendering and event handling.

## v1.4 — 2026/7/4

- Reworked the palette and flat-design styling, with light and dark themes separated.
- Reworked preset-send interaction: a switch now gates the global hotkeys.
- Added hover help for the parsing configuration.

## v1.3 — 2026/6/30

- Added **bar charts** with channel selection, axis scaling and auto range.
- `name` tag binding switched to trailing-number matching (`name0` ↔ `int0`), making rule
  syntax more flexible.
- Preset send accepts single-character hotkeys: press to send, inputs auto-select so replacing
  a value takes effect immediately.
- Fixed the historical version repository on GitHub; improved the offline experience and
  offline detection.
- Improved compact mode, spacing and panel consistency.
- Improved channel interaction, chart rendering, FFT channel filtering, and dynamic `name`
  field tracking.
- Improved timeline replay and the syncing/persistence of chart state during config import and
  export.
- Improved template parsing, send-data filtering, and checkbox styling.

## v1.2 — 2026/6/11

- Timed, trigger and preset send now preserve original bytes in hex mode; send matching and
  display logic unified.
- The advanced send area is height-adjustable by dragging, and module rows can be reordered by
  dragging.
- Preset items accept a description; the monitor shows send and match status markers.
- Improved hex-structure parsing: separator placeholders and footer-less wide matching.
- Improved the live results display: horizontal scrolling, expand and collapse.
- Fixed serial parameter changes not taking effect while connected.
- Added global configuration export, import and reset covering device, send, parser and chart
  settings.

## v1.1 — 2026/5/30

- Settings and input state are saved automatically and restored on the next load.
- Added the offline build: download it, run it anywhere, and the app detects that it is
  offline.
- Visual polish: dialogs, dropdown states, blurred backgrounds for floating panels on narrow
  screens.
- Added the About dialog with release notes, plus manual, GitHub and feedback links.

## v1.0 — 2026/5/24

- Initial release: serial monitor, device connection management with VID/PID display, framing
  configuration, hardware flow control and signal control.
- Automatic light/dark theming, and separate wide and narrow layouts.
- Auto-reconnect after unplug or connection loss.
- Release-on-blur, so other tools can take the port while the tab is unfocused.
- Structured parsing: text rules, hex structure tables, automatic rule detection, live results.
- Time-domain and frequency-domain (FFT) charts bound to parsed channels, with view range and
  auto-range controls.
- The timeline system: live freeze, recording, replay, import/export, and reusable parser
  configuration per capture.
- Timeline import/export of raw data as BIN/TXT/CSV and of parsed results as TXT/CSV.
- Manual, timed, trigger and preset send workflows.
