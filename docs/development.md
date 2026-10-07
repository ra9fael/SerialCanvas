# Development

## Repository layout

```
index.html              Document shell: every panel, control and dialog. No inline app logic.
bootstrap.js            Runs before first paint: theme, body classes, favicon. Only pre-read script.
app.loader.js           Dev-mode chunk loader (fetch + concat + eval as one script).
app.lang.js             (~420 lines) Locale dictionaries: Chinese source string -> English.
                        Standalone script, not part of the shared closure.
app.core.js             (~2100 lines) Constants, `state`, `refs`, formatting, encoding, hex,
                        theme, layout, toasts, buffers, version/offline detection, analytics.
app.terminal.js         (~300 lines) xterm.js lifecycle, skins, echo/history, view switching.
app.main.js             (~8000 lines) Serial lifecycle, RX pipeline, monitor rendering, send
                        modules, timeline, parser, charts, persistence, wiring.
style.css               All styling, light/dark themes, compact layout.
vendor/xterm/           Vendored xterm.js + fit addon + css (no CDN, so offline works).
LICENSE                 AGPL-3.0, the license the upstream project declares.
build-release.py        Verifies the version, then produces dist/SerialCanvas.html.
.github/workflows/      pages.yml — builds the artifact on every push to main and deploys
                        it to GitHub Pages.
tools/                  Optional development helpers: set-version.py (cut a release),
                        cdp-check.mjs (headless-browser audit driver),
                        extract-i18n-keys.py (dictionary key lister),
                        docs-check.py (doc links, anchors, en/zh mirror parity). Not shipped.
docs/                   This documentation set (English at the root, zh-CN mirror),
                        including acknowledgements.md (provenance).
```

There is no bundler, no framework, no build step for development — the sources are the
delivered files. `node_modules/`, `dist/` and `.venv/` are git-ignored; `dist/` is always
reproducible from `build-release.py`.

## The shared-closure constraint

`app.core.js` **opens** an IIFE on line 1 (`(() => {`), `app.main.js` **closes** it
(`})();`), and `app.terminal.js` is a fragment in between. Concatenated, they are one
function body with one lexical scope.

This has consequences the moment you touch the sources:

- The three files **cannot be loaded separately** — a `<script>` tag per file fails, because
  a closure cannot span tags. That is why `app.loader.js` exists and why the build inlines a
  single concatenation.
- A top-level `const`/`let`/`function` name must be unique across all three files; redeclaring
  one is a `SyntaxError` in the concatenated result and the app silently never boots.
- Order matters for temporal-dead-zone reasons: `app.main.js` may reference a `const` from
  `app.core.js` inside a function (fine at call time), but not at top level in the other
  direction. Keep new top-level constants in `app.core.js`.
- Never introduce `import`/`export` or a second `(function(){` wrapper — it breaks the
  concatenation contract and the build.

### Why source mode needs HTTP

Browsers treat each `<script src>` as an independent program, so `app.loader.js` fetches the
three chunks, joins them with `\n`, and injects the result as one inline `<script>`. `fetch()`
does not work from `file://`, so opening `index.html` by double-clicking shows an overlay
pointing at `dist/SerialCanvas.html`. Web Serial additionally requires a secure context, so
`file://` could not connect a port anyway. For development, serve the root:

```sh
python -m http.server 8000     # http://localhost:8000/
```

## Globals and wiring

`bootstrap.js` defines the only intentional `window.*` surface:
`__serialWebInitialPrefs`, `__serialWebInitialTheme`,
`__applySerialCanvasInitialBodyClasses()` (called by the inline script at the top of `<body>`, so
the first painted frame already has the right theme/panel classes and does not flash) and
`__setSerialCanvasFavicon()`. The app bundle exports nothing — there is no console API, and
nothing is reachable from a DevTools snippet. When adding a startup-time concern, extend
`bootstrap.js` rather than attaching to `window` from the app.

DOM access is centralised in the `refs` map (`app.core.js`, roughly lines 58–205): one entry
per element id, resolved once at startup. **Adding an element to `index.html` requires adding
the matching `refs` entry** — the app does not query the DOM elsewhere for panel elements. A
few `refs.*` names are read with optional chaining but have no entry and no element (e.g.
`refs.statUptime`, `refs.extensionPanel`); they are inert leftovers, safe to remove.

Boot order at the end of the IIFE: `initializeDefaults()` → `attachEventListeners()` →
`trackSerialCanvasView()` → `tryInitialSerialConnectPrompt()`.

## Extension points

Two functions are the seams of the whole application:

| Direction | Entry point | Guarantees |
| --- | --- | --- |
| TX | `sendPayload(payload, source, options, meta)` | Byte counting, log event, tag metadata, `sendBusy` serialisation, and raw-chunk recording. Any new sender must go through it. |
| RX | `queueRxBytes(bytes, timestamp, meta)` | Line splitting, live-event trimming, recording, dirty flags for parser/chart refresh. |

The actual `writer.write()` lives in `performSerialWrite()`; `buildPayloadFrame()` is the one
place that turns box text + hex mode + newline option into bytes. `scheduleRefresh()`
coalesces all rendering into a single `requestAnimationFrame`.

Note that the terminal view deliberately bypasses `queueRxBytes` and `sendPayload` (it writes
through `sendTerminalBytes`) and therefore opts out of parsing, plotting and recording. If you
want a new feature to see terminal traffic, you have to add it to that second path.

Timers you should know before reasoning about performance or races:

| Interval | Purpose |
| --- | --- |
| 250 ms | Status/counter clock. |
| 800 ms | `getSignals()` input polling. |
| 420 ms | Baud-field debounce before a port re-open. |
| 500 ms | `localStorage` write debounce. |
| 80 ms | Binary schema re-parse debounce. |
| 1800 ms | Preset expected-reply timeout. |
| 500 ms | Send-mode tile pulse. |
| ≥ 100 ms | Auto-send period. |
| rAF | Derived data, monitor and chart painting. |

## Building the release artifact

Prerequisites: Python 3, plus

| Tool | Needed for | Without it |
| --- | --- | --- |
| `esbuild` (`npm install`) | Minifying the concatenated JS | JS inlined verbatim, `WARN: esbuild not found`; the file still works. |
| `minify_html` (`pip install minify-html`) | Minifying HTML and CSS | Unminified output with a warning. |
| `node` | Validating minified inline scripts | Validation skipped (with a warning). |

```sh
npm install                                   # provides node_modules/.bin/esbuild
pip install minify-html                       # optional, further compression
python build-release.py                       # -> dist/SerialCanvas.html
python build-release.py --no-minify           # readable output, fastest
```

What the script does:

1. Checks the version: `const VERSION` in `app.core.js`, the newest `## v<version>` heading in
   [CHANGELOG.md](CHANGELOG.md) and the newest 更新日志 block in `index.html` must name the same
   release, or the build stops before writing anything. See
   [version numbering](#version-numbering).
2. Reads `index.html` and replaces each known asset tag in `INLINE_ASSETS` with an inline
   `<style>`/`<script>` block. The three app chunks are concatenated **before** minification so
   esbuild parses them as one closure.
3. Escapes `</script` inside JS to `<\/script` so inline string literals cannot terminate the
   block.
4. Asserts that no local `src=`/`href=` reference survives outside inlined blocks — a new
   stylesheet or script must be added to `INLINE_ASSETS`, or the build fails loudly.
5. Minifies HTML/CSS with `minify_html`, deliberately with `minify_js=False`: minify-html's own
   JS minifier broke scoped `const`/`let` ("Cannot access before initialization"). JS minification
   belongs to esbuild, which runs earlier, on the concatenated source.
6. Runs `node --check` over every inline script in the minified document; **any failure falls
   back to the unminified document** rather than shipping something broken.

The result is one self-contained file that runs from `file://` (interface only — see
[why](#why-source-mode-needs-http)).

## Verifying a change

The app has no automated tests. The practical pass is:

1. Rebuild, then serve the root and load both `index.html` (source mode) and
   `dist/SerialCanvas.html` (release mode) — a minification-only bug shows up in the second only.
2. Check the console first: a broken closure surfaces as one `SyntaxError` and an empty page;
   `app.loader.js` sets `document.documentElement.dataset.appLoadError` when a chunk fails.
3. Exercise the loop with a device, or with the browser's virtual serial port / a loop-backed
   COM pair: connect, framing change while connected, DTR/RTS, hex send round-trip, both
   monitor tabs.
4. Parser: apply a rule, confirm cards and charts, then 自动识别 on live data.
5. Timeline: REC → stop → select → scrub → export BIN/TXT/CSV → re-import → export analysis
   CSV.
6. Persistence: reload the page and confirm layout/theme/queues/charts restore; then 复制配置 →
   reload → 粘贴导入.
7. Layout: drag the window under 720 px, and check both layouts plus the send-panel resize
   handle.
8. Both locales: switch ☰ → 语言 → English and look for any Chinese left in the chrome (the
   language option itself, font and skin names are expected), then back to 中文 and look for
   English. Widened labels are a layout risk — the monitor title/meta row and the ☰ menu are the
   two places that ran out of room first.

`tools/cdp-check.mjs` automates 1, 2 and 8: it drives a headless Edge over CDP with no
dependencies — `node tools/cdp-check.mjs --url http://127.0.0.1:8731/dist/SerialCanvas.html --out
audit --scenario i18n` — and writes a JSON trace plus a screenshot, reporting console errors.
The scenarios are `i18n` (locale round-trip and residual audit), `term` (font availability,
size, ctrl+wheel, applying while hidden), `roundtrip` and `reset`.
`tools/extract-i18n-keys.py` regenerates the candidate key list for
`app.lang.js` from `index.html` and the chunks.

## Version numbering

`const VERSION` in `app.core.js` is the only version the app reads: it drives the ☰ **关于** label,
the dialog title and current-version line, the `serialweb:version-modal-seen` flag, and the
`appVersion` field written into prefs. Because `syncVersionDisplay()` overwrites those strings at
boot, their markup copies are deliberately neutral (`关于`, `SerialCanvas`, `—`) — do not put a number
back into them. Two places still carry a literal version, because they have to be right before any
script runs: the 更新日志 blocks in `index.html` and the docs.

This repository tags from `v0.1.0`, and the entries below it keep the upstream `1.x` numbers they
shipped with — which is why the changelog reads `0.2.0, 0.1.0, 1.5, 1.4, …`. From here on the
format is `vMAJOR.MINOR.PATCH` and the tag equals `VERSION` with a `v` prefix.

`package.json` / `package-lock.json` carry the same number so `npm ci` in CI stays consistent, but
nothing reads it: it exists only to pin the esbuild dev-dependency.

## Cutting a release

Write the notes first, under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md) and `## 未发布` in
[zh-CN/CHANGELOG.md](zh-CN/CHANGELOG.md) — mirrored, same number of bullets — then:

```sh
python tools/set-version.py 0.2.0 --date 2026/10/1 --dry-run
python tools/set-version.py 0.2.0 --date 2026/10/1
python build-release.py
git commit -a -m "chore(release): v0.2.0" && git tag v0.2.0
```

`set-version.py` promotes both changelog headings, rewrites `const VERSION`, rewrites the version
field in `package.json` and `package-lock.json`, inserts the new dialog block (keeping the newest
`--keep 5`), derives its English header and bullet translations into `app.lang.js` from the English
changelog, and updates the current-version mention in
[README.md](README.md) plus the `appVersion` example in [data-formats.md](data-formats.md). It
commits nothing; review the diff. Since the dialog lines are dictionary keys, hand-writing them
into `index.html` instead would show Chinese in the English UI — the script is what keeps the
English changelog and the dialog in step. `build-release.py` then refuses to build while the three
copies disagree, so a skipped step fails the build instead of shipping a stale dialog.

## Publishing on GitHub Pages

`.github/workflows/pages.yml` runs `build-release.py` on Python 3.12 and Node 22, copies
`dist/SerialCanvas.html` to `dist/index.html`, uploads `dist/` as the Pages artifact, and the
`deploy` job publishes it to <https://ra9fael.github.io/SerialCanvas/>. The site is therefore always
exactly the artifact of the commit it was built from — nothing is uploaded by hand and `dist/`
stays out of Git. The version guard runs first, so a drifted tree fails the build instead of
publishing a stale dialog.

Pages defaults a new repository to `main:/` as its source, so this needs to be switched once:

```sh
gh api -X POST repos/ra9fael/SerialCanvas/pages -f build_type=workflow
gh api repos/ra9fael/SerialCanvas/pages --jq .build_type   # -> workflow
```

After that every push to `main`, or a manually dispatched run, redeploys. The lockfile resolves
esbuild from a mirror registry; the workflow falls back to `registry.npmjs.org` when that install
fails, and the build still emits a working (unminified) file if esbuild is missing entirely.

The published page makes no analytics request: `trackSerialCanvasView()` posts the page-view count
only when the hostname is `conductance-lab.xyz`, which is the upstream author's host, so neither a
Pages deployment nor a local `http://localhost` one contacts it.

## Release checklist

1. Write the notes into both changelogs under `Unreleased` / `未发布`, then cut the version as in
   [cutting a release](#cutting-a-release). Do not edit `VERSION` or the dialog by hand.
2. Smoke-test `dist/SerialCanvas.html`: console clean, both locales, and the ☰ **关于** dialog showing
   the new version.
3. Push `main` and the tag. The [Pages workflow](#publishing-on-github-pages) then rebuilds and
   redeploys <https://ra9fael.github.io/SerialCanvas/> from that commit. The offline
   **下载离线版到本地** link and `ONLINE_VERSION_URL` are static — no update feed exists, so a
   version check happens only when the page is loaded.
4. Check the deployed page: console clean, version label correct, and ☰ → 关于 showing the new
   block in both languages.

## Documentation

Docs live in `docs/`, English at the root and mirrored under `docs/zh-CN/` with identical file
names. Keep the two trees in lockstep: a new section should appear in both, and the anchors
above are linked from other files, so renaming a heading means updating the links that point at
it. The interface is bilingual — 中文 / English / 跟随系统 picked in the ☰ menu — so English docs
still quote each label as `English (中文)`. The English strings live in `app.lang.js`, keyed by the
Chinese source text (a missing entry degrades to Chinese rather than showing a key); the engine is
`t()` / `translateDom()` / `setLocale()` in `app.core.js` plus `renderTranslatedViews()` in
`app.main.js`, which re-runs every view that can hold a label after a switch.

`python tools/docs-check.py` verifies the tree: every relative link and heading anchor resolves,
and each English page has a `docs/zh-CN/` mirror with the same heading counts. Run it after moving
or renaming a heading. [origin & credits](acknowledgements.md) is the page to keep accurate when the project's
identity changes — the divergence point, what this fork adds and the license terms; the About
dialog in `index.html` carries the same facts in compressed form, so the two are edited together.
