# SerialCanvas

SerialCanvas is a browser-based serial-port debugger and data-plotting tool built on the
Web Serial API. It ships as a **single HTML file** with no server, no installer and no
CDN dependency, so it runs from a local disk, a USB stick, or a web page.

It combines four jobs that normally need separate tools:

- **Serial monitor** — raw RX/TX log with timestamps, hex view, and an xterm-based
  interactive terminal.
- **Structured parser** — turn each incoming line into named channels, either with a
  text template (`/name0=/float0`) or with a byte-level hex frame schema.
- **Live charts** — time-domain, FFT (frequency-domain) and bar charts bound to parsed
  channels.
- **Timeline recorder** — record a session to raw bytes, freeze the live view, scrub and
  replay archived captures, and export/import them as `.bin` / `.csv` / `.txt`.

Current version: **v0.4.1**. This fork's home:
<https://ra9fael.github.io/SerialCanvas/> ·
<https://github.com/ra9fael/SerialCanvas>

SerialCanvas began as [SerialWeb](https://github.com/Conductance-lab/SerialWeb) by
[Conductance-lab](https://conductance-lab.xyz) (upstream `v1.6`) and has since developed
independently — it is no longer a fork. The UI design also borrows from
[PICOTTY](https://github.com/morpheuslord/PICOTTY). Details:
[Origin & credits](acknowledgements.md).

> The interface is bilingual: choose **中文 / English / 跟随系统 (follow the system)** in the ☰
> system menu; a first run follows the browser language. Every label in these English docs is
> still given as `English (中文)` so it can be found in either language. The Chinese
> documentation set mirrors this one file for file: [docs/zh-CN/README.md](zh-CN/README.md).

## Documentation

| Document | Contents |
| --- | --- |
| [Getting started](README.md#quick-start) | Requirements, running the app, first connection |
| [User guide](user-guide.md) | Connection management, monitor, terminal, sending modes, timeline, layout, shortcuts, troubleshooting |
| [Parser reference](parser.md) | Text rule grammar, hex frame schema, live results, auto-detect |
| [Charts reference](charts.md) | Chart types, channel binding, scaling and zoom, FFT math, retention limits |
| [Data formats](data-formats.md) | `localStorage` keys, config snapshot schema, timeline BIN/TXT/CSV layout, analysis export |
| [Development](development.md) | Repository layout, the shared-closure constraint, the build script, releasing |
| [Changelog](CHANGELOG.md) | Release notes per version |
| [Origin & credits](acknowledgements.md) | The original project, the UI references (SerialWeb, PICOTTY), the license |

## Requirements

Web Serial is only reachable from a **secure context**, and only Chromium-based browsers
implement it.

| | Support |
| --- | --- |
| Browser | Chrome or Edge (recent). Firefox and Safari do not implement `navigator.serial` — the app loads and shows `不支持 Web Serial API` instead. |
| Address | `https://…`, or `http://localhost` / `127.0.0.1`. Plain `http://<lan-ip>` cannot use the API. |
| OS | Windows / macOS / Linux, anything the browser itself supports. No driver is needed for the browser to claim the port, but the device must expose a serial (`CDC-ACM`-class) interface. |
| Privileges | None. The browser takes the port from the OS. |
| Storage | `localStorage` is used for settings; the app also reads the clipboard for config import. |

Opening `dist/SerialCanvas.html` directly with `file://` works for the interface, but the
browser will not grant a serial port from a `file://` page — serve it (see below) when you
need to connect.

## Quick start

**1 — Use the hosted build (easiest).** Open
<https://ra9fael.github.io/SerialCanvas/> — this repository's single-file build, published by GitHub
Actions. The [original project's build](https://conductance-lab.xyz/SerialWeb/) is a separate
program with its own version number.

**2 — Or run the single-file build locally.**

```sh
python build-release.py            # -> dist/SerialCanvas.html
```

Take the self-contained `dist/SerialCanvas.html`, then either double-click it
(interface only, no serial access) or serve the folder:

```sh
python -m http.server 8000         # -> http://localhost:8000/dist/SerialCanvas.html
```

**3 — Or run from source.** The repository is plain static files; any static server works.
Serve the project root and open `index.html`:

```sh
python -m http.server 8000         # -> http://localhost:8000/
```

Source mode loads `app.core.js`, `app.terminal.js` and `app.main.js` over `fetch()`, so
`file://` is refused with an overlay that points at the single-file build
([details](development.md#why-source-mode-needs-http)).

**4 — Connect a device.**

1. Plug in the board; close any other program holding the port (Serial monitor, PuTTY, an
   IDE).
2. Click **Connect device (连接设备)** in *Device connection management (设备连接管理)* and
   pick the port in the browser prompt. A USB permission dialog appears once per new port;
   the browser remembers the grant.
3. Set **Baud rate (波特率)** — the header shows `VID`/`PID` once identified. The status
   pill in the top-left reads **串口已连接**.
4. Type into the **Send (发送)** box and press **Send now (立即发送)**, or switch the monitor
   to **Terminal (终端)** and just type.

## Where to go next

- Your device prints `temperature=42.5 humidity=31` and you want it plotted →
  [Parser reference](parser.md#text-rules), then [Charts](charts.md).
- You want a scripted request/response exchange → [Sending modes](user-guide.md#sending).
- You want to hand a capture to a colleague → [Timeline export formats](data-formats.md#timeline-files).
- Something is misbehaving → [Troubleshooting](user-guide.md#troubleshooting).

## Offline copy

The system menu (☰, top-right) has **Download offline version (下载离线版到本地)**. When the
app is served over HTTP it re-fetches its own assets and hands you one self-contained HTML
file, equivalent to `dist/SerialCanvas.html`. This is unavailable inside a `file://` copy.

## Feedback

- Source, issues and feature requests: <https://github.com/ra9fael/SerialCanvas>
- Manual: these pages — the app's ☰ menu and About dialog link here too.

## Original project

SerialCanvas started from SerialWeb and has since developed independently;
[origin & credits](acknowledgements.md) has the provenance and the license. The original
project lives at <https://github.com/Conductance-lab/SerialWeb>.
