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
    return clampTerminalFontSize(refs.termFontSize?.value);
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
    applyTerminalMetrics();
  }

  function setTerminalFontSize(value) {
    if (refs.termFontSize) refs.termFontSize.value = String(clampTerminalFontSize(value));
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
      scrollback: 5000,
      convertEol: false,
      theme: getTerminalTheme()
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    term.onData(handleTermData);
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
