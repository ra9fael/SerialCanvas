# SerialCanvas

A browser-based serial-port debugger and live data-plotting tool built on the Web Serial API,
delivered as **one self-contained HTML file** — no installer, no server, no CDN dependency.

**Documentation: [docs/](docs/README.md)** · 中文文档: [docs/zh-CN/](docs/zh-CN/README.md)
· Live app: <https://ra9fael.github.io/SerialCanvas/>

SerialCanvas began as [SerialWeb](https://github.com/Conductance-lab/SerialWeb) by
[Conductance-lab](https://conductance-lab.xyz) (upstream v1.6) and has since developed
independently — it is no longer a fork. The UI design borrows from SerialWeb and from
[PICOTTY](https://github.com/morpheuslord/PICOTTY);
[origin & credits](docs/acknowledgements.md) has the provenance and the AGPL-3.0 terms.

It replaces the four tools a bench session normally needs:

- **Serial monitor** — RX/TX log with timestamps and hex view, plus an xterm-based interactive
  terminal for shells and AT-command modules.
- **Structured parser** — turn each incoming line into named channels with a text template
  (`/name0=/float0`) or a byte-level frame schema (header / data / SUM8 checksum / footer).
- **Live charts** — time-domain, FFT and bar charts bound to parsed channels.
- **Timeline recorder** — record raw bytes, freeze the live view, scrub and replay archived
  captures, export/import them as `.bin` / `.csv` / `.txt`.

Auto-reconnect, release-on-blur, modem-signal control (DTR/RTS/CTS/DSR/DCD/RI/BREAK), timed /
trigger / hotkey-preset send, and a full configuration that copies to the clipboard for
reproducible setups. The interface switches between 中文 and English at runtime (☰ → 语言),
following the browser language by default.

## Try it

```sh
python build-release.py                      # -> dist/SerialCanvas.html
python -m http.server 8000                   # -> http://localhost:8000/dist/SerialCanvas.html
```

Use the hosted build, or serve a local copy — Web Serial needs `https://` or `localhost`, so a
plain `file://` open gives you the interface but no port access. Chrome or Edge required;
Firefox and Safari do not implement `navigator.serial`.

## Documentation

| Document | What is in it |
| --- | --- |
| [Getting started](docs/README.md) | Requirements, running from source or as a single file, first connection |
| [User guide](docs/user-guide.md) | Connection management, monitor, terminal, sending modes, timeline, layout, shortcuts, troubleshooting |
| [Parser reference](docs/parser.md) | Text rule grammar, hex frame schema, live results, automatic rule detection |
| [Charts reference](docs/charts.md) | Chart types, channel binding, zoom and scaling, FFT behaviour, retention limits |
| [Data formats](docs/data-formats.md) | `localStorage` keys, config snapshot schema, timeline BIN/TXT/CSV layout, analysis export |
| [Development](docs/development.md) | Repository layout, the shared-closure constraint, the build script, release checklist |
| [Changelog](docs/CHANGELOG.md) | Release notes, upstream v1.0 – v1.6 plus this project's v0.x series |
| [Origin & credits](docs/acknowledgements.md) | The original project (SerialWeb), the UI references (SerialWeb, PICOTTY), the license |

Every page has a Chinese counterpart under [`docs/zh-CN/`](docs/zh-CN/README.md) with the same
file names and section order; English is the source of truth.

## Repository

```
index.html      app.core.js  app.terminal.js  app.main.js   style.css
bootstrap.js    app.loader.js  app.lang.js  vendor/xterm/  build-release.py  docs/
```

Plain static files, no framework and no bundler: the three closure chunks (`app.core.js`,
`app.terminal.js`, `app.main.js`) share one IIFE and are concatenated at load time (source mode)
or inlined (release build); `app.lang.js` is a standalone dictionary of English strings keyed by
their Chinese source.
[Development](docs/development.md#the-shared-closure-constraint) explains the constraint and
how to extend the app safely.

## Links

**This fork**

- Online version: <https://ra9fael.github.io/SerialCanvas/>
- Source and issues: <https://github.com/ra9fael/SerialCanvas>

**Original project** — this is a fork of it, and the app's ☰ menu and About dialog link back to
every one of these.

- Source: <https://github.com/Conductance-lab/SerialWeb>
- Online version: <https://conductance-lab.xyz/SerialWeb/> ·
  GitHub Pages: <https://conductance-lab.github.io/SerialCanvas/>
- Manual & tutorials: <https://docs.conductance-lab.xyz/工具手册/SerialCanvas工具手册>
- Issue reports: <https://docs.qq.com/form/page/DU1B2RWVyZnJERHdq>
- Author home page: <https://conductance-lab.xyz>

Licensed under AGPL-3.0 — see [LICENSE](LICENSE) and
[origin & credits](docs/acknowledgements.md#license).
