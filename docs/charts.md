# Charts reference

Charts plot the numeric channels produced by the
[parser](parser.md#channels) — `parsed.<label>` for hex frames, `parsed.<name>` or
`parsed.intN`/`parsed.floatN` for text rules. Add one from **Add chart frame (添加图框)**:

| Button | Chart | X axis | Y axis |
| --- | --- | --- | --- |
| 时域图 | **Time domain** | Relative time, seconds | Value |
| 频域图 | **FFT / frequency** | Frequency, Hz (0 … Nyquist) | Amplitude |
| 柱状图 | **Bar** | Channel | Latest value |

Titles default to `时域图 N` / `频域图 N` / `柱状图 N`, numbering across all charts. Panels are
appended below each other and can be removed or moved up/down with the hover tools.

- [Binding channels](#binding-channels)
- [Per-chart controls](#per-chart-controls)
- [Navigation](#navigation)
- [FFT behaviour](#fft-behaviour)
- [Rendering and retention](#rendering-and-retention)

## Binding channels

**数据绑定** lists every selectable numeric channel, colour-coded to match its curve.
Channels appear as soon as the parser emits them; a checkbox adds the series.

Two restrictions are worth knowing:

- **FFT and bar charts can only bind channels that the configuration declares statically** —
  configured rule tags (`parsed.int0`, `parsed.float1`), hex row labels, and `bool8` bit
  children. A channel that only exists because a dynamic `/nameN` captured a label is
  disabled in the FFT picker (`opacity` drop, not-allowed cursor), because a spectrum needs a
  continuous series. Time-domain charts accept them.
- Binding a channel that has no data yet draws nothing rather than a flat line, and bindings
  that stop existing are pruned automatically.

**统一量程 (shared scale)** puts every bound channel on one Y axis. It is forced on (and the
checkbox disabled) while one or zero channels are bound. Turning it off gives each channel its
own Y range and reveals a **Y-axis owner** picker — 全部通道 or a single channel — which
decides which channel's scale the left axis labels and the axis title
(`幅值（<channel>）`) describe; the other channels are still drawn, just unscaled to the labels.
The chip reads 统一量程 / 差异量程 / 调整通道:<key>.

## Per-chart controls

| Control | Where | Detail |
| --- | --- | --- |
| 数据绑定 | all charts | Channel checkboxes. |
| 统一量程 | multi-channel | Shared vs per-channel Y scaling. |
| Y-axis owner | multi-channel, shared scale off | Which channel the axis labels refer to. |
| FFT 窗口 | FFT, bar | Samples in the analysis window; `min 16`, step 16, default **4096**. |
| 帧间隔 ms | FFT, bar | Frame period for the frequency axis. Empty = auto-detect (placeholder 自动识别). |
| AUTO | header | Restore the automatic range — clears manual zoom/pan. |
| Panel height | drag top/bottom edge | `heightPx`, default 220, minimum 140. Persisted. |
| Open / close, remove, reorder | header + hover tools | Panel state and order are persisted. |

Axis tick steps are "nice" 1/2/5×10ⁿ values; value labels carry 0–4 decimals depending on
magnitude. Series colours cycle through seven fixed hues
(`#1d7af2 #0e9f6e #d97706 #c2410c #8b5cf6 #ef4444 #14b8a6`) by channel order, and the
results-panel cards use the same mapping.

## Navigation

All charts are canvas-based and device-pixel-ratio aware; a resize re-renders them.

| Gesture | Effect |
| --- | --- |
| Drag inside the plot | Pan X and Y. Panning X releases "follow latest", so the view stops tracking live data. |
| Drag along the X axis | Zoom X (`exp(dx/160)`). |
| Drag along the Y axis | Zoom Y (`exp(-dy/160)`). |
| Wheel over the plot / axis | Zoom, factor 0.96 per notch; X for the plot and X axis, Y for the Y axis. |
| **AUTO** | Back to the automatic window. |

Zoom is clamped to `0.02 … 240` on X (Y is effectively unbounded). The first manual gesture
snapshots the automatic range as the base for subsequent zoom/pan maths — that is what **AUTO**
restores. **FFT charts always keep the frequency offset locked at 0**, so you can zoom into a
band but not slide past DC.

Time charts track the newest sample while "follow latest" is on and show a value label at the
end of each curve; FFT charts label the peak bin instead.

## FFT behaviour

The spectrum is computed from the chart's own re-sampled series:

1. Take the last `FFT 窗口` points (≥ 4 required) of the channel's 30-second track.
2. Apply a **Hann window**.
3. Zero-pad up to `n = nextPowerOfTwo(min(4 × samples, 65536))` — 4× oversampling for
   interpolating peaks, capped at 65 536 complex points (≤ 32 768 bins).
4. Run an in-place radix-2 Cooley–Tukey transform.
5. Report the single-sided amplitude spectrum: `2·|X| / Σwindow` (DC unhalved). **Units are
   the original signal units — peak amplitude, not dB.**
6. Bin *k* sits at `k × sampleRate / n`; the axis ends at the Nyquist frequency.

The **sample rate** is `1000 / frame interval`. The interval comes from 帧间隔 ms if set,
otherwise SerialCanvas estimates it: frames sharing a timestamp are batched, the batch gap is
divided by the batch's frame count, and the estimate is smoothed with an EMA
(`0.25 previous + 0.75 new`, kept when the drift is under 0.2 %). With nothing to measure it
falls back to 1 Hz.

Consequences worth remembering:

- Set **帧间隔 ms** whenever the device's cadence is known. A wrong interval scales the whole
  frequency axis, and an irregularly-timed source has no single correct answer.
- Amplitude is only trustworthy for a signal that fills the window; a value that changes
  mid-window is smeared, as with any windowed transform.
- The window length is not clamped to the retained data; a 4096-point window on a 10-sample
  channel yields nothing.
- Only the most recently computed channel is cached, so many channels on one FFT chart
  recompute every frame.

## Rendering and retention

Charts are **not** a chart recorder. The windows are fixed:

| Stage | Cap |
| --- | --- |
| Raw numeric series | 180 000 points **and** 60 seconds per channel |
| Chart track (what is plotted) | last **30 seconds**, re-indexed to a uniform grid |
| Time-domain auto window | the last **10 seconds**, newest sample pinned at the right edge |
| Points actually drawn | ~1.5 × plot width (pixel-bin decimation, last point of each bin kept) |
| FFT transform | ≤ 65 536 points |

Two effects follow. First, chart X values are the **re-indexed grid** (`index × frame
interval`), not the original timestamps — jitter is removed, which is what makes the FFT
meaningful, but the axis is an approximation of wall time. Second, pixel-bin decimation keeps
one point per bin rather than min/max, so a **narrow spike can be silently dropped** from the
line while still being present in the data. Zoom in if a reading looks suspicious, or export
the [analysis table](data-formats.md#analysis-export) and inspect it numerically.

Rendering is coalesced into one `requestAnimationFrame` per frame for all charts; a separate
250 ms clock refreshes only status text and the timeline bar.

**清空缓存** under 添加图框 does **not** delete your charts — it clears the live session
history (raw bytes, log events, counters, derived data), which wipes the curves while keeping
every chart's configuration and bindings intact. Removing a chart is the per-panel ✕.

## Timeline interaction

Charts are re-derived from the archive's own embedded configuration when you
[replay a capture](user-guide.md#replay): scrubbing the playhead re-runs the parser over the
visible prefix and repaints. Chart panels you added while replaying stay in the working set,
and the archive's snapshot replaces the whole chart list when selected — see
[user guide § Timeline](user-guide.md#import-and-export).
