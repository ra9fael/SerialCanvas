'use strict';
/* ============================================================================
 * SerialWeb - terminal mode (part 2 of 3)
 * xterm.js based terminal interaction mode: raw byte passthrough, optional
 * local echo/line editing, skins, fonts and view switching. Continues the
 * IIFE opened in app.core.js.
 * ==========================================================================*/
  function isTerminalViewActive() {
    return state.ui.monitorView === 'terminal';
  }

  /* Printable-run buffer for the paste debounce. Runtime-only, never persisted
     and never part of terminalSession (that is the local-echo line, which is a
     different thing). */
  const TERMINAL_KEY_FLUSH_MS = 40;
  let terminalKeyBuffer = '';
  let terminalKeyFlushTimer = 0;

  const TERMINAL_SKINS = {
    green: {
      background: '#0b0f0b',
      foreground: '#33ff66',
      cursor: '#33ff66',
      cursorAccent: '#0b0f0b',
      selectionBackground: 'rgba(51, 255, 102, 0.28)'
    },
    'black-white': {
      background: '#000000',
      foreground: '#e8e8ea',
      cursor: '#e8e8ea',
      cursorAccent: '#000000',
      selectionBackground: 'rgba(232, 232, 234, 0.28)'
    },
    dracula: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: '#44475a'
    },
    'solarized-dark': {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: '#073642'
    },
    'solarized-light': {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#586e75',
      cursorAccent: '#fdf6e3',
      selectionBackground: '#eee8d5'
    },
    'one-dark': {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#282c34',
      selectionBackground: '#3e4451'
    }
  };

  function getTerminalTheme() {
    const skin = TERMINAL_SKINS[refs.termSkin?.value || ''];
    if (skin) {
      return { ...skin };
    }
    const style = getComputedStyle(document.body);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    // The console keeps its own palette rather than borrowing the page's:
    // --bg-terminal is dark in both themes, so reading --text here paired a
    // dark foreground with a dark ground in light mode (contrast 1.06).
    return {
      background: read('--bg-terminal', '#1b1918'),
      foreground: read('--terminal-text', '#f4f1ef'),
      cursor: read('--terminal-cursor', '#ff9783'),
      cursorAccent: read('--bg-terminal', '#1b1918'),
      selectionBackground: read('--terminal-selection', 'rgba(255, 151, 131, 0.28)')
    };
  }

  function updateTerminalTheme() {
    const theme = getTerminalTheme();
    if (refs.termOutput) {
      refs.termOutput.style.background = theme.background;
    }
    if (terminalRuntime.term) {
      terminalRuntime.term.options.theme = theme;
    }
  }

  function getTerminalFontFamily() {
    const value = refs.termFont?.value || '';
    if (value) return value;
    return getComputedStyle(document.body).getPropertyValue('--font-mono').trim() || 'Consolas, monospace';
  }

  function clampTerminalFontSize(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return TERMINAL_FONT_SIZE_DEFAULT;
    return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(parsed)));
  }

  function getTerminalFontSize() {
    return clampTerminalFontSize(refs.monoSizeCustom?.value);
  }

  /* xterm scrollback, settable from the toolbar. Cheap compared with the DOM
     log: only text nodes are retained and changing it does not re-render. */
  function getTerminalScrollback() {
    var size = Number(state.settings.terminalScrollback);
    return TERMINAL_SCROLLBACK_SIZES.includes(size) ? size : TERMINAL_SCROLLBACK_DEFAULT;
  }

  function setTerminalScrollback(value) {
    var size = Number(value);
    if (!TERMINAL_SCROLLBACK_SIZES.includes(size)) return;
    state.settings.terminalScrollback = size;
    const term = terminalRuntime.term;
    if (term) term.options.scrollback = size;
  }

  function terminalHostVisible() {
    return Boolean(refs.termOutput && refs.termOutput.offsetParent !== null);
  }

  // xterm measures its cell size from the live host element, so a font or size
  // change made while the terminal is hidden (manual view, expanded layout) is
  // lost: the metrics come back as 0 and FitAddon quietly no-ops. Park the
  // change and re-apply it from applyMonitorView() once the host is shown.
  function applyTerminalMetrics() {
    const term = terminalRuntime.term;
    if (!term) return;
    const fontFamily = getTerminalFontFamily();
    const fontSize = getTerminalFontSize();
    const stale = term.options.fontFamily !== fontFamily || term.options.fontSize !== fontSize;
    if (stale) {
      term.options.fontFamily = fontFamily;
      term.options.fontSize = fontSize;
    }
    if (!terminalHostVisible()) {
      terminalRuntime.pendingApply = true;
      return;
    }
    const wasPending = terminalRuntime.pendingApply;
    terminalRuntime.pendingApply = false;
    if (wasPending) {
      // The options setter only re-measures on an actual value change, so the
      // cached 0 metrics survive a hidden edit; one step up and back forces it.
      term.options.fontSize = fontSize + 1;
      term.options.fontSize = fontSize;
    }
    if (stale || wasPending) {
      try {
        term.refresh(0, term.rows - 1);
      } catch (error) {}
    }
    refitTerminal();
  }

  function updateTerminalFont() {
    applyMonoSize();
    applyTerminalMetrics();
  }

  /* One size control feeds three surfaces: xterm, the manual log and the parse
     preview. The two CSS tokens stay separate on purpose (see style.css) but
     both follow this value. */
  function applyMonoSize() {
    const size = getTerminalFontSize();
    document.documentElement.style.setProperty('--mono-size', size + 'px');
    document.documentElement.style.setProperty('--log-size', size + 'px');
  }

  function setTerminalFontSize(value) {
    const size = clampTerminalFontSize(value);
    if (refs.monoSizeCustom) refs.monoSizeCustom.value = String(size);
    // A non-preset size has to leave the preset list on "custom", otherwise the
    // select would show the nearest preset and the two controls would disagree.
    if (refs.monoSizePreset) {
      const isPreset = Array.from(refs.monoSizePreset.options)
        .some((option) => option.value === String(size));
      refs.monoSizePreset.value = isPreset ? String(size) : 'custom';
      refs.monoSizeCustomField?.classList.toggle('hidden', isPreset);
    }
    applyMonoSize();
    applyTerminalMetrics();
  }

  function handleTerminalWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const next = getTerminalFontSize() + direction;
    if (clampTerminalFontSize(next) === getTerminalFontSize()) return;
    setTerminalFontSize(next);
    scheduleLocalPrefsSave();
  }

  // Every offered stack ends in `monospace`, so an uninstalled family renders
  // exactly like the default and the switch looks broken. Say so instead.
  function applyTerminalFontAvailability() {
    const select = refs.termFont;
    if (!select) return;
    Array.from(select.options).forEach((option) => {
      if (!option.value) {
        option.disabled = false;
        option.removeAttribute('title');
        return;
      }
      const available = fontStackAvailable(option.value);
      option.disabled = !available;
      if (available) option.removeAttribute('title');
      else option.setAttribute('title', '未检测到该字体，已回退为默认等宽字体');
    });
    syncCustomSelectShell(
      select.parentElement?.classList.contains('custom-select') ? select.parentElement : null,
      select
    );
  }

  function ensureTerminalInstance() {
    if (terminalRuntime.term || typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
      return terminalRuntime.term;
    }
    const host = refs.termOutput;
    if (!host) return null;
    const term = new Terminal({
      fontFamily: getTerminalFontFamily(),
      fontSize: getTerminalFontSize(),
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: getTerminalScrollback(),
      convertEol: false,
      theme: getTerminalTheme()
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    term.onData(queueTerminalKeyChunk);
    host.addEventListener('wheel', handleTerminalWheel, { passive: false });
    try {
      fitAddon.fit();
    } catch (error) {}
    terminalRuntime.term = term;
    terminalRuntime.fitAddon = fitAddon;
    if (typeof ResizeObserver !== 'undefined') {
      terminalRuntime.resizeObserver = new ResizeObserver(() => refitTerminal());
      terminalRuntime.resizeObserver.observe(host);
    }
    return term;
  }

  function refitTerminal() {
    const { term, fitAddon } = terminalRuntime;
    if (!term || !fitAddon || !isTerminalViewActive()) return;
    try {
      fitAddon.fit();
    } catch (error) {}
  }

  function termEchoText(text) {
    if (!text || !refs.termLocalEcho?.checked) return;
    terminalRuntime.term?.write(text);
  }

  function appendTermRx(text) {
    const term = terminalRuntime.term;
    if (!term || !text) return;
    // Normalize a bare \n to \r\n for xterm; keep a lone \r (devices may use it for in-place redraws)
    term.write(String(text).replace(/\r?\n/g, '\r\n'));
    termEchoText(terminalSession.buffer);
  }

  function getTermLineEnding() {
    const mode = refs.termNewline?.value || 'rn';
    return mode === 'none' ? '' : mode === 'r' ? '\r' : mode === 'n' ? '\n' : '\r\n';
  }

  function clearTerminalOutput() {
    const term = terminalRuntime.term;
    if (!term) return;
    term.clear();
    term.write('\x1b[2K');
  }

  function handleTermData(data) {
    if (!data) return;
    if (!refs.termLocalEcho?.checked) {
      // Passthrough mode: forward raw keystrokes to the device like a real terminal (Enter mapped to the selected line ending)
      const payload = data === '\r'
        ? (getTermLineEnding() || '\r')
        : data;
      sendTerminalBytes(payload);
      return;
    }
    // Local echo / line-editing mode (for devices that do not echo themselves)
    if (data === '\r') {
      commitTerminalLine();
      return;
    }
    if (data === '\x7f') {
      if (terminalSession.buffer.length) {
        terminalSession.buffer = terminalSession.buffer.slice(0, -1);
        termEchoText('\b \b');
      }
      return;
    }
    if (data === '\x15') {
      terminalSession.buffer = '';
      termEchoText('\r\x1b[2K');
      return;
    }
    if (data === '\x1b[A') {
      navigateTermHistory('up');
      return;
    }
    if (data === '\x1b[B') {
      navigateTermHistory('down');
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) < 32 && data !== '\t') {
      // Other control keys (Ctrl+C etc.) are sent raw, with a local ^X marker displayed
      const label = `^${String.fromCharCode(data.charCodeAt(0) + 64)}`;
      sendTerminalBytes(data);
      terminalSession.buffer = '';
      termEchoText(`${label}\r\n`);
      return;
    }
    if (data.startsWith('\x1b')) {
      sendTerminalBytes(data);
      return;
    }
    terminalSession.buffer += data;
    termEchoText(String(data).replace(/\r\n|\r|\n/g, '\r\n'));
  }

  /* Byte sequences for the toolbar buttons.

     These are the exact sequences xterm reports through onData for the same
     keys, so a button and a keypress take the identical path through
     handleTermData(). Nothing here re-implements the echo/passthrough split or
     the line editor. */
  const TERM_KEY_SEQUENCES = {
    up: '\x1b[A',
    down: '\x1b[B',
    right: '\x1b[C',
    left: '\x1b[D',
    home: '\x1b[H',
    end: '\x1b[F',
    delete: '\x1b[3~',
    backspace: '\x7f',
    'ctrl-u': '\x15',
    'ctrl-w': '\x17',
    'ctrl-k': '\x0b',
    'ctrl-c': '\x03',
    'ctrl-d': '\x04',
    'ctrl-z': '\x1a',
    tab: '\t',
    escape: '\x1b'
  };

  /* Buttons must work without the terminal holding focus, so this dispatches
     through handleTermData() rather than relying on xterm's onData. */
  function sendTerminalKey(key) {
    const sequence = TERM_KEY_SEQUENCES[key];
    if (!sequence) return;
    flushTerminalKeyBuffer();
    handleTermData(sequence);
    scheduleLocalPrefsSave();
  }

  /* ---- Paste debounce ---------------------------------------------------
     xterm's onData fires once per keystroke, so a 500-character paste becomes
     500 serial writes. Printable runs accumulate and flush after 40ms, so a
     burst becomes a handful of frames instead. Control characters and escape
     sequences bypass the buffer so they stay immediate, and the buffer is
     flushed before any of them so ordering is preserved. */
  function flushTerminalKeyBuffer() {
    if (!terminalKeyFlushTimer) return;
    clearTimeout(terminalKeyFlushTimer);
    terminalKeyFlushTimer = 0;
    const buffered = terminalKeyBuffer;
    terminalKeyBuffer = '';
    if (buffered) sendTerminalBytes(buffered);
  }

  function queueTerminalKeyChunk(data) {
    if (!data || typeof data !== 'string') return;
    // Local echo is a line editor: every keystroke must reach handleTermData so
    // terminalSession.buffer and the echo stay in step. Debouncing there would
    // break backspace, history and the draft. So the buffer only applies to
    // passthrough mode, which is the one that writes straight to the wire.
    if (refs.termLocalEcho?.checked) {
      flushTerminalKeyBuffer();
      handleTermData(data);
      return;
    }
    // Anything that is not plain printable text goes straight out, so control
    // bytes and escape sequences keep their immediate, ordered behaviour.
    if (data.length !== 1 || data.charCodeAt(0) < 32 || data.charCodeAt(0) === 127) {
      flushTerminalKeyBuffer();
      handleTermData(data);
      return;
    }
    terminalKeyBuffer += data;
    if (terminalKeyFlushTimer) return;
    terminalKeyFlushTimer = window.setTimeout(flushTerminalKeyBuffer, TERMINAL_KEY_FLUSH_MS);
  }

  function sendTerminalBytes(data) {
    if (!data) return Promise.resolve(false);
    let bytes;
    try {
      bytes = encodeText(data, state.settings.textEncoding);
    } catch (error) {
      bytes = new TextEncoder().encode(data);
    }
    return performSerialWrite(bytes).then((sent) => {
      if (sent) {
        state.session.txBytes += bytes.length;
        renderStats();
      } else {
        toast('发送失败', '串口未连接，无法发送终端输入。', 'warn', [], { key: 'term-send' });
      }
      return sent;
    });
  }

  async function commitTerminalLine() {
    const text = terminalSession.buffer;
    const ending = getTermLineEnding();
    terminalSession.buffer = '';
    terminalSession.historyIndex = -1;
    terminalSession.draft = '';
    if (text) {
      terminalSession.history.push(text);
      if (terminalSession.history.length > TERMINAL_HISTORY_MAX) terminalSession.history.shift();
    }
    if (refs.termLocalEcho?.checked) {
      terminalRuntime.term?.write('\r\n');
    }
    const payload = text + ending;
    if (!payload) return;
    await sendTerminalBytes(payload);
  }

  function navigateTermHistory(direction) {
    const term = terminalRuntime.term;
    if (!term || !terminalSession.history.length) return;
    const redraw = (value) => {
      terminalSession.buffer = value;
      termEchoText(`\r\x1b[2K${value}`);
    };
    if (direction === 'up') {
      if (terminalSession.historyIndex === -1) {
        terminalSession.draft = terminalSession.buffer;
        terminalSession.historyIndex = terminalSession.history.length - 1;
      } else if (terminalSession.historyIndex > 0) {
        terminalSession.historyIndex -= 1;
      }
    } else {
      if (terminalSession.historyIndex === -1) return;
      if (terminalSession.historyIndex < terminalSession.history.length - 1) {
        terminalSession.historyIndex += 1;
      } else {
        terminalSession.historyIndex = -1;
        redraw(terminalSession.draft || '');
        return;
      }
    }
    redraw(terminalSession.history[terminalSession.historyIndex] || '');
  }

  function applyMonitorView() {
    const terminal = isTerminalViewActive();
    refs.monitorPanel?.classList.toggle('view-terminal', terminal);
    refs.monitorViewSwitch?.classList.toggle('term-active', terminal);
    refs.monitorViewTabs?.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.monitorView === state.ui.monitorView);
    });
    if (terminal) {
      const term = ensureTerminalInstance();
      if (term && !terminalSession.hintShown) {
        terminalSession.hintShown = true;
        term.writeln(`\x1b[2m${t(TERMINAL_READY_HINT_TEXT)}\x1b[0m`);
      }
      applyTerminalMetrics();
      requestAnimationFrame(() => {
        refitTerminal();
        term?.focus();
      });
    }
  }

  function setMonitorView(view) {
    const next = view === 'terminal' ? 'terminal' : 'manual';
    if (state.ui.monitorView === next) return;
    state.ui.monitorView = next;
    applyMonitorView();
    scheduleLocalPrefsSave();
  }
