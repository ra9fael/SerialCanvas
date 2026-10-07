'use strict';
/* ============================================================================
 * SerialCanvas - terminal mode (part 2 of 3)
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
     the line editor.

     The Ctrl entries are single bytes, which is what makes a binding like ^R
     meaningful over a serial line: it reaches the device as 0x12 and is
     interpreted by whatever readline is running there — including fzf, where
     ^R is reverse-i-search and ^T/^N/^P drive the selection. These are the
     bytes, not browser keybindings, so the browser never sees them.

     Every sequence below was read out of vendor/xterm/xterm.js rather than
     assumed, because a wrong guess would send bytes the device never sees:

       Ctrl-arrows  o.key = ESC + "[1;" + (modifier + 1) + "D"   -> 1;5
       Shift-Tab    case 9: if (e.shiftKey) o.key = ESC + "[Z"
       Insert       ESC + "[2~"
       F1-F4        ESC + "OP" / "OQ" / "OR" / "OS"
       Enter        case 13: o.key = e.altKey ? ESC + CR : CR

     That last line is also why there is no Ctrl-Enter binding: xterm's case 13
     never consults the ctrl flag, so Ctrl+Enter and Enter produce identical
     bytes. A button for it would claim a distinction that does not exist. */
  const TERM_KEY_SEQUENCES = {
    // Submission
    enter: '\r',
    'alt-enter': '\x1b\r',
    // Navigation
    up: '\x1b[A',
    down: '\x1b[B',
    right: '\x1b[C',
    left: '\x1b[D',
    'ctrl-right': '\x1b[1;5C',
    'ctrl-left': '\x1b[1;5D',
    home: '\x1b[H',
    end: '\x1b[F',
    pageup: '\x1b[5~',
    pagedown: '\x1b[6~',
    insert: '\x1b[2~',
    delete: '\x1b[3~',
    'shift-tab': '\x1b[Z',
    'alt-b': '\x1bb',
    'alt-f': '\x1bf',
    f1: '\x1bOP',
    f2: '\x1bOQ',
    f3: '\x1bOR',
    f4: '\x1bOS',
    // Editing
    backspace: '\x7f',
    'ctrl-h': '\x08',
    'ctrl-a': '\x01',
    'ctrl-e': '\x05',
    'ctrl-b': '\x02',
    'ctrl-f': '\x06',
    'ctrl-k': '\x0b',
    'ctrl-u': '\x15',
    'ctrl-w': '\x17',
    'ctrl-t': '\x14',
    'ctrl-y': '\x19',
    'ctrl-d': '\x04',
    // History and completion — the fzf-facing group
    'ctrl-r': '\x12',
    'ctrl-p': '\x10',
    'ctrl-n': '\x0e',
    'ctrl-o': '\x0f',
    'ctrl-l': '\x0c',
    // Control bytes
    'ctrl-c': '\x03',
    'ctrl-z': '\x1a',
    'ctrl-g': '\x07',
    'ctrl-v': '\x16',
    'ctrl-x': '\x18',
    tab: '\t',
    escape: '\x1b'
  };

  /* Button grouping for the key bar.

     Grouped by what the key DOES rather than by what it is called, which the
     previous five groups did not:

       - 历史 ↑↓ sat in "nav" while ^P/^N — the same function — sat in
         "history" on the other row, with the whole edit group between them;
       - ^T 转置字符 sat in "edit" while ^X 切换转置 sat in "control";
       - ^A/^E/^B/^F are movement but were filed under "edit" between Bksp and
         ^K, because the Emacs letter made them look like editing keys;
       - "control" carried ^V, ^X, Tab and Esc, none of which interrupt
         anything, while that group's amber styling exists precisely to mark the
         bytes that do. Four of its eight keys were false alarms.

     Order is reading order: submit first, because Enter is the only key that
     sends the line; then recall, movement, editing; then the screen/function
     keys; and the interrupts last, so muscle memory reaching for an editing
     key cannot land on ^C. Within a group the order is one the user can
     predict: history is arrows then their Emacs equivalents then search;
     movement goes character → word → line → Emacs → Alt; editing goes by
     deletion granularity, smallest first, with ^X beside ^T because both are
     transpose. */
  const TERM_KEY_GROUPS = [
    {
      id: 'submit',
      buttons: [
        { key: 'enter', label: 'Enter ⏎', tip: 'Enter 回车（遵循换行设置）', wide: true },
        { key: 'alt-enter', label: 'Alt-⏎', tip: 'Alt-Enter 发送 ESC + CR' }
      ]
    },
    {
      id: 'history',
      buttons: [
        { key: 'up', label: '↑', tip: '↑ 上一个历史' },
        { key: 'down', label: '↓', tip: '↓ 下一个历史' },
        { key: 'ctrl-p', label: '^P', tip: '^P 上一条历史' },
        { key: 'ctrl-n', label: '^N', tip: '^N 下一条历史' },
        { key: 'ctrl-r', label: '^R', tip: '^R 反向增量搜索（fzf 常用）' },
        { key: 'ctrl-o', label: '^O', tip: '^O 轮换历史' },
        { key: 'ctrl-l', label: '^L', tip: '^L 清屏' }
      ]
    },
    {
      id: 'move',
      buttons: [
        { key: 'left', label: '←', tip: '← 光标左移' },
        { key: 'right', label: '→', tip: '→ 光标右移' },
        { key: 'ctrl-left', label: '^←', tip: '^← 按词左移' },
        { key: 'ctrl-right', label: '^→', tip: '^→ 按词右移' },
        { key: 'home', label: 'Home', tip: 'Home 行首' },
        { key: 'end', label: 'End', tip: 'End 行尾' },
        { key: 'ctrl-b', label: '^B', tip: '^B 左移一字符' },
        { key: 'ctrl-f', label: '^F', tip: '^F 右移一字符' },
        { key: 'ctrl-a', label: '^A', tip: '^A 行首' },
        { key: 'ctrl-e', label: '^E', tip: '^E 行尾' },
        { key: 'alt-b', label: 'Alt-B', tip: 'Alt-B 按词左移（经典绑定）' },
        { key: 'alt-f', label: 'Alt-F', tip: 'Alt-F 按词右移（经典绑定）' }
      ]
    },
    {
      id: 'edit',
      buttons: [
        { key: 'backspace', label: 'Bksp', tip: 'Backspace 退格' },
        { key: 'delete', label: 'Del', tip: 'Delete 删除' },
        { key: 'ctrl-k', label: '^K', tip: '^K 删到行尾' },
        { key: 'ctrl-u', label: '^U', tip: '^U 删到行首' },
        { key: 'ctrl-w', label: '^W', tip: '^W 删前一个词' },
        { key: 'ctrl-t', label: '^T', tip: '^T 转置字符' },
        { key: 'ctrl-x', label: '^X', tip: '^X 切换转置' },
        { key: 'ctrl-y', label: '^Y', tip: '^Y 召回' },
        { key: 'ctrl-v', label: '^V', tip: '^V 引号插入' }
      ]
    },
    {
      id: 'page',
      buttons: [
        { key: 'pageup', label: 'PgUp', tip: 'PgUp 上翻一屏' },
        { key: 'pagedown', label: 'PgDn', tip: 'PgDn 下翻一屏' },
        { key: 'insert', label: 'Ins', tip: 'Insert 插入模式' },
        { key: 'shift-tab', label: '⇧Tab', tip: 'Shift-Tab 反向补全（越过补全菜单）' },
        { key: 'tab', label: 'Tab', tip: 'Tab 制表符' },
        { key: 'escape', label: 'Esc', tip: 'Esc ESC' },
        { key: 'f1', label: 'F1', tip: 'F1（部分固件菜单绑定）' },
        { key: 'f2', label: 'F2', tip: 'F2' },
        { key: 'f3', label: 'F3', tip: 'F3' },
        { key: 'f4', label: 'F4', tip: 'F4' }
      ]
    },
    {
      id: 'control',
      buttons: [
        { key: 'ctrl-c', label: '^C', tip: '^C 中断前台进程（0x03）' },
        { key: 'ctrl-d', label: '^D', tip: '^D EOF / 注销（0x04）' },
        { key: 'ctrl-z', label: '^Z', tip: '^Z 挂起到后台（0x1A）' },
        { key: 'ctrl-g', label: '^G', tip: '^G 中止' }
      ]
    }
  ];


  /* Which row of the key bar each group lands on.

     44 keys in one row wrapped wherever the window happened to end, so the bar
     changed height as the window resized and shoved the terminal around. Two
     fixed rows keep the bar's height roughly constant — and "roughly" only
     holds if the two rows carry comparable width, because each row still wraps
     on its own.

     Hence this split rather than the obvious "hot keys on top": by measured
     button width the chosen pair is ~790px / ~815px, while putting submit +
     edit + history on top leaves the bottom row at ~960px against ~650px, i.e.
     a row that wraps while the other does not. The cost is that Bksp and Del
     sit at the head of the second row instead of beside Enter; they are the
     first thing on it, which is where the eye goes next anyway. */
  const TERM_KEY_ROWS = [
    ['submit', 'history', 'move'],
    ['edit', 'page', 'control']
  ];

  /* Buttons must work without the terminal holding focus, so this dispatches
     through handleTermData() rather than relying on xterm's onData. */
  function sendTerminalKey(key) {
    const sequence = TERM_KEY_SEQUENCES[key];
    if (!sequence) return;
    flushTerminalKeyBuffer();
    handleTermData(sequence);
    scheduleLocalPrefsSave();
  }

  /* Key bar collapse.

     The bar is ~44 buttons and takes real vertical space in a panel whose
     height the user is usually trying to give to the terminal, so it has to be
     collapsible. Open by default: the keys are the reason to be in this view,
     and hiding them behind a control that starts closed reads as a missing
     feature. Persisted, because the choice is per-user, not per-session. */
  function applyTermKeyBarOpen(open = Boolean(state.ui.termKeyBarOpen)) {
    state.ui.termKeyBarOpen = Boolean(open);
    const body = refs.termKeyBarBody;
    if (!body) return;
    body.classList.toggle('hidden', !state.ui.termKeyBarOpen);
    refs.termKeyBarToggle?.setAttribute('aria-expanded', String(state.ui.termKeyBarOpen));
    const label = refs.termKeyBarToggle?.querySelector('.term-key-bar-toggle-text');
    if (label) label.textContent = state.ui.termKeyBarOpen ? t('收起') : t('展开');
  }

  /* Builds the key bar from TERM_KEY_GROUPS.

     One source for both the byte table and the buttons: a binding cannot exist
     in the bar without a byte, or send bytes without a way to press them. The
     control group gets the amber treatment because those bytes interrupt the
     foreground process on the device — they are the ones worth reading twice
     before clicking. */
  function renderTerminalKeyBar() {
    const bar = refs.termKeyBar;
    if (!bar) return;
    // Everything is generated, so clear both rows unconditionally. Keeping the
    // label is no longer needed: the head is static markup in index.html.
    const rows = Array.from(bar.querySelectorAll('[data-term-row]'));
    rows.forEach((row) => { row.replaceChildren(); });
    const rowFor = new Map();
    TERM_KEY_ROWS.forEach((groupIds, index) => {
      groupIds.forEach((id) => rowFor.set(id, index));
    });
    TERM_KEY_GROUPS.forEach((group) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'term-key-bar-group';
      if (group.id === 'control') groupEl.classList.add('is-control');
      groupEl.dataset.termGroup = group.id;
      group.buttons.forEach((spec) => {
        if (!TERM_KEY_SEQUENCES[spec.key]) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'term-key';
        if (group.id === 'control') button.classList.add('term-key-control');
        if (group.id === 'submit') button.classList.add('term-key-submit');
        if (spec.wide) button.classList.add('term-key-wide');
        button.dataset.termKey = spec.key;
        // Translated here rather than in the constant: TERM_KEY_GROUPS is
        // evaluated once at load, so a t() call inside it would keep the
        // language it was built in.
        button.dataset.tip = t(spec.tip);
        button.textContent = spec.label;
        groupEl.appendChild(button);
      });
      // A group missing from TERM_KEY_ROWS is a table bug, not a layout one:
      // dropping it silently would hide bindings the byte table still has.
      const rowIndex = rowFor.get(group.id);
      const row = Number.isInteger(rowIndex) ? rows[rowIndex] : null;
      if (!row) return;
      if (row.childElementCount) {
        const divider = document.createElement('span');
        divider.className = 'term-key-bar-divider';
        divider.setAttribute('aria-hidden', 'true');
        row.appendChild(divider);
      }
      row.appendChild(groupEl);
    });
    applyTermKeyBarOpen();
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
