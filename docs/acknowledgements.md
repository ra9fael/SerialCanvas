# Origin & credits

SerialCanvas started as [SerialWeb](https://github.com/Conductance-lab/SerialWeb), created
and maintained by **Conductance-lab** (author home page <https://conductance-lab.xyz>,
original online version <https://conductance-lab.xyz/SerialWeb/>). This project began from
upstream `v1.6` (commit `e3f9200814`, 2026/9/6) and has since developed independently — it
is no longer a fork, and the histories share no upstream branch.

The UI design borrows from two projects:

- **SerialWeb** — the original interface this project started from.
- **[PICOTTY](https://github.com/morpheuslord/PICOTTY)** by morpheuslord — the three-column
  fleet console (nodes │ console │ activity) that the modernist layout derives from, plus
  smaller ideas: the visible control-byte strip, relative row timestamps, the flexible rail.

- [Provenance](#provenance)
- [License](#license)

Chinese mirror: [zh-CN/acknowledgements.md](zh-CN/acknowledgements.md).

## Provenance

| | |
| --- | --- |
| Original project | [`Conductance-lab/SerialWeb`](https://github.com/Conductance-lab/SerialWeb) |
| Starting point | upstream `v1.6`, commit `e3f9200814` (2026/9/6) |
| This repository | [`ra9fael/SerialCanvas`](https://github.com/ra9fael/SerialCanvas), versioned from `v0.2.0` as an independent project |
| UI references | SerialWeb · [PICOTTY](https://github.com/morpheuslord/PICOTTY) |

The design of SerialWeb and every line of code up to the starting point is the original
author's; everything after it is developed here. Both parts are covered by the same
[license](#license).

## License

SerialCanvas is **AGPL-3.0**, the license the original project declares. Renaming the
project does not change the obligations: the LICENSE file ships with the repository, the
original copyright stays attached, and this page is the required statement of changes from
the original. Internal identifiers (the `SerialWebUserConfig` clipboard-payload type, for
example) keep the original spelling on purpose, so configs exported by earlier builds
still import.
