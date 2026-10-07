'use strict';
/* ============================================================================
 * SerialCanvas - app core (part 1 of 3)
 * Opens the application IIFE. Contains constants, application state, DOM
 * references and shared utility helpers. The IIFE closure continues in
 * app.terminal.js and is closed by app.main.js - load order matters:
 *   bootstrap.js -> vendor/xterm/* -> app.core.js -> app.terminal.js -> app.main.js
 * ==========================================================================*/
(() => {
  const VERSION = '0.4.0';
  const ONLINE_VERSION_URL = 'https://ra9fael.github.io/SerialCanvas/';
  const VERSION_MODAL_SEEN_KEY = 'serialweb:version-modal-seen';
  const MAX_DERIVED_LOG_LINES = 320;
  const SERIAL_BUFFER_SIZE = 65536;
  const PRESET_EXPECTATION_TIMEOUT_MS = 1800;
  const PLAYER_STEP_MS = 250;
  const PLAYER_FAST_STEP_MS = 1000;
  const HIGH_RES_TIME_EPOCH_MS = (typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin))
    ? performance.timeOrigin
    : (Date.now() - (typeof performance !== 'undefined' ? performance.now() : 0));
  const MAX_CHART_HISTORY_MS = 60000;
  const MAX_TIME_CHART_HISTORY_MS = 30000;
  const MAX_CHART_POINTS = 180000;
  const MAX_CHART_RENDER_POINTS = 6000;
  const MAX_RX_OPEN_EVENT_BYTES = 2048;
  const MAX_RX_OPEN_EVENT_TEXT_CHARS = 2048;
  const LOCAL_PREFS_KEY = 'serialweb:prefs';
  const LOCAL_PREFS_DEBOUNCE_MS = 500;
  const RECEIVE_CONTENT_SCHEMA_VERSION = 1;
  const SERIAL_RECONFIGURE_DEBOUNCE_MS = 420;
  const SEND_EXTENSION_DEFAULT_HEIGHT = 252;
  const SEND_EXTENSION_MIN_HEIGHT = 120;
  const SEND_MONITOR_MIN_HEIGHT = 150;
  const DOWNLOAD_HTML_FILENAME = 'SerialCanvas串口调试.html';
  const CHART_ZOOM_MIN = 0.02;
  const CHART_ZOOM_MAX = 240;
  const MODE_PULSE_MS = 500;
  const CHART_COLORS = ['#1d7af2', '#0e9f6e', '#d97706', '#c2410c', '#8b5cf6', '#ef4444', '#14b8a6'];
  const TIMELINE_BIN_MAGIC = new Uint8Array([0x57, 0x53, 0x4c, 0x42, 0x49, 0x4e, 0x31, 0x00]);
  const appEl = document.body;

  /* Binary frame template.

     A binary frame has no textual shape, so a text payload template cannot
     describe one — which is why the payload template used to be disabled for
     binary scripts and the A5 layout was hard-coded in the script. This is the
     replacement: a whitespace-separated list of hex byte groups and
     placeholders, expanded per tick.

       A5            hex byte group, one or more bytes
       {t}           temperature x10, clamped to one byte
       {h}           humidity, rounded and clamped to one byte
       {n}           tick counter, low byte
       {sum}         SUM8 of the placeholder-produced bytes so far

     {sum} deliberately covers the placeholder bytes and NOT the literal hex
     groups. That is the rule the parser applies to a checksum row ("仅覆盖
     data 行的字节"), and the two have to agree or every simulated frame would
     decode with a red checksum. Summing everything emitted so far looks more
     natural and is wrong: it folds the frame header into the checksum.

     The default expands to the exact bytes the A5 script used to hard-code —
     A5, temp*10, humidity, SUM8 of those two, 5A — and therefore still matches
     the script's schema byte for byte. */
  const SIMULATION_FRAME_TEMPLATE_DEFAULT = 'A5 {t} {h} {sum} 5A';
  const SIMULATION_FRAME_TEMPLATE_MAX = 160;
  const SIMULATION_FRAME_PLACEHOLDERS = ['{t}', '{h}', '{n}', '{sum}'];

  /* Expands a frame template into bytes.

     Returns the default frame when the template is empty or expands to nothing,
     so a half-typed template degrades to "still sending the built-in frame"
     rather than to silence — silence reads as a stalled simulator. */
  function buildSimulationFrame(template, tick) {
    const source = String(template || '').trim() || SIMULATION_FRAME_TEMPLATE_DEFAULT;
    const temp = 21 + Math.sin(tick / 9) * 3.5;
    const hum = 48 + Math.cos(tick / 7) * 6;
    const clampByte = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    const bytes = [];
    // Placeholder bytes only: the checksum domain, matching the parser.
    const checksumBytes = [];
    const pushValue = (value) => {
      bytes.push(value);
      checksumBytes.push(value);
    };
    source.split(/\s+/).forEach((token) => {
      if (!token) return;
      if (token === '{t}') {
        pushValue(clampByte(temp * 10));
        return;
      }
      if (token === '{h}') {
        pushValue(clampByte(hum));
        return;
      }
      if (token === '{n}') {
        pushValue(((Number(tick) || 0) % 256 + 256) % 256);
        return;
      }
      if (token === '{sum}') {
        pushValue(checksumBytes.reduce((sum, byte) => (sum + byte) & 0xff, 0));
        return;
      }
      const literal = safeHexBytes(token);
      // Literal bytes are framing, not payload: outside the checksum domain.
      if (literal.length) bytes.push(...literal);
    });
    if (!bytes.length) return buildSimulationFrame(SIMULATION_FRAME_TEMPLATE_DEFAULT, tick);
    return Uint8Array.from(bytes);
  }

  /* Protocol simulation.

     Generates RX locally so the parser, the live results and the charts can be
     exercised without a device attached. The bytes go through queueRxBytes() -
     the same entry point the serial reader uses - so line splitting, parsing,
     recording and chart painting all behave exactly as they do for real
     traffic. Nothing here re-implements any of that.

     Scripts are fixed rather than user-editable for now; what each frame
     contains is configurable (see the frame template above and the payload
     template in app.main.js). Three are provided: two text grammars and one
     binary schema. */
  const SIMULATION_SCRIPTS = {
    'text-sensor': {
      label: '文本：传感器读数',
      /* Matches the documented rule "/name0=/float0,/name1=/int0". The
         trailing \n matters: frames are split on CR/LF, so without it every tick
         would concatenate into one ever-growing display event instead of one
         line per reading. Real devices terminate their frames too. */
      textRule: '/name0=/float0,/name1=/int0',
      // Seeds the payload box. It expands to exactly what build() emits, so
      // seeding it changes no bytes — it only makes the format visible and
      // editable. That is the whole point: a template the user cannot see is a
      // template the user cannot use.
      templateDefault: 'temp={temp},humid={hum};',
      build: (tick) => {
        const temp = 21 + Math.sin(tick / 9) * 3.5;
        const hum = 48 + Math.cos(tick / 7) * 6;
        return encodeText(`temp=${temp.toFixed(1)},humid=${Math.round(hum)};\n`, 'utf-8');
      }
    },
    'text-json': {
      label: '文本：JSON 负载',
      // With an empty rule box the parser tries JSON, so this script
      // demonstrates that fallback rather than a text rule.
      // Same idea as above; {temp} carries one decimal where build() writes
      // two, which JSON parsing does not care about.
      templateDefault: '{"device":"sim-01","uptime":{n},"temp":{temp}}',
      build: (tick) => {
        const temp = 21 + Math.sin(tick / 9) * 3.5;
        return encodeText(
          JSON.stringify({ device: 'sim-01', uptime: tick, temp: Number(temp.toFixed(2)) }) + '\n',
          'utf-8'
        );
      }
    },
    'binary-frame': {
      label: '二进制：A5 帧',
      /* Frame layout: A5 / payload / SUM8 / 5A.

         The payload is ONE uint16 little-endian field packing temp*10 and
         humidity, so it decodes under a single schema row. The previous
         version emitted two separate bytes, which cannot match a one-row
         schema and therefore produced empty parse cards — the comment here
         used to claim it "matches the default seeded schema" and that was
         false, because state.parser.binarySchema defaults to [] and no schema
         exists until the binary pane is rendered.

         schema below is what this script needs. Selecting it fills the table,
         so the simulator demonstrates the parser instead of requiring the user
         to hand-build a structure to see a decoded value.

         Float16 is avoided deliberately: a software decoder plus a hand-built
         encoder is a lot of surface for a demo.

         The bytes come from frameTemplate rather than from hard-coded literals,
         so the frame format is something the user can actually configure. The
         default expands to exactly the bytes this script used to hard-code:
         A5, temp*10, humidity, SUM8 of those two, 5A — and it therefore still
         matches the schema above byte for byte. */
      schema: [
        { kind: 'header', value: 'A5' },
        // nameAuto false: this is a semantic name the script chose, not one
        // derived from the type. updateBinaryRowAutoName() would otherwise
        // rewrite it to "uint0" the first time the table renders.
        { kind: 'data', value: '', dataType: 'uint16le', name: 'reading', nameAuto: false },
        { kind: 'checksum', value: 'SUM8', name: 'checksum', nameAuto: false },
        { kind: 'footer', value: '5A' }
      ],
      frameTemplate: SIMULATION_FRAME_TEMPLATE_DEFAULT,
      build: (tick) => buildSimulationFrame(state.settings.simulation.frameTemplate, tick)
    }
  };
  const SIMULATION_SCRIPT_IDS = Object.keys(SIMULATION_SCRIPTS);
  const SIMULATION_MAX_TICKS = 10000;

  /* Simulator pacing.

     700ms was arbitrary and unreachable in either direction: a fast protocol
     demo wants tens of milliseconds, a slow sensor wants seconds. Burst size
     covers the other common shape, where a device answers several frames per
     poll and the parser has to cope with the backlog. */
  const SIMULATION_INTERVALS = [
    { value: 60, label: '60 毫秒' },
    { value: 200, label: '200 毫秒' },
    { value: 700, label: '700 毫秒' },
    { value: 2000, label: '2 秒' },
    { value: 5000, label: '5 秒' }
  ];
  const SIMULATION_INTERVAL_DEFAULT = 700;
  const SIMULATION_BURSTS = [1, 4, 8, 16];
  const SIMULATION_BURST_DEFAULT = 1;

  /* Payload template placeholders. Text-only by design: the result is always run
     through encodeText() before queueRxBytes(), and a template that produced
     binary would need an encoding mode. Substitution happens on the plain
     string, never on markup. */
  const SIMULATION_TEMPLATE_DEFAULT = '';
  const SIMULATION_TEMPLATE_MAX = 200;
  const SIMULATION_PLACEHOLDERS = ['{n}', '{temp}', '{hum}', '{tick}', '{ts}'];

  /* What the template boxes show when the user has not typed in them.

     SIMULATION_TEMPLATE_DEFAULT stays '' because that is the persisted
     "never touched" value and applySimulationTemplate() reads it as "send the
     script's own output". The UI seeds `templateDefault` instead, so neither
     box is ever empty: a format you cannot see is a format you cannot edit,
     which is exactly why the payload template went unused. Each default
     expands to what the script emits anyway, so seeding it changes no bytes.

     The frame default is the same idea for the binary script, which has no
     text shape to template and is configured through the frame template. */
  function simulationTemplateDefault(scriptId) {
    return String(SIMULATION_SCRIPTS[scriptId]?.templateDefault || '');
  }

  function simulationFrameTemplateDefault(scriptId) {
    const script = SIMULATION_SCRIPTS[scriptId];
    if (!script?.schema) return SIMULATION_FRAME_TEMPLATE_DEFAULT;
    return String(script.frameTemplate || SIMULATION_FRAME_TEMPLATE_DEFAULT);
  }

  /* Keyboard shortcuts.

     One table drives both the dispatcher and the shortcut sheet, so the
     documented bindings and the working bindings cannot drift apart.

     Every binding is chorded (Ctrl and/or Alt). Bare letters are deliberately
     NOT used: the existing preset-send handler at app.main.js owns single
     keypresses, and a bare letter here would silently shadow a user's preset.
     The preset handler runs on document too, so a chord must additionally
     consume the event or both handlers fire. */
  const SHORTCUT_GROUPS = [
    {
      title: '应用',
      items: [
        { id: 'toggle-sidebar', keys: ['Ctrl', '`'], desc: '折叠 / 展开左侧配置栏', scope: '紧凑模式下切换浮层' },
        { id: 'cycle-corner', keys: ['Ctrl', 'Alt', 'C'], desc: '切换圆角：直角 → 微圆 → 圆润' },
        { id: 'shortcut-sheet', keys: ['?'], desc: '打开本快捷键列表', chorded: false },
        { id: 'close-overlay', keys: ['Esc'], desc: '关闭弹窗 / 菜单', scope: '输入框与终端内不处理' }
      ]
    },
    {
      title: '串口终端',
      items: [
        { id: 'term-clear-line', keys: ['Ctrl', 'U'], desc: '清空当前输入行', scope: '仅本地回显模式' },
        { id: 'term-history-prev', keys: ['↑'], desc: '上一条历史输入', scope: '仅本地回显模式' },
        { id: 'term-history-next', keys: ['↓'], desc: '下一条历史输入', scope: '仅本地回显模式' }
      ]
    },
    {
      title: '预设发送',
      items: [
        { id: 'preset-letter', keys: ['A–Z'], desc: '发送匹配的预设项', scope: '在预设发送开启且焦点不在输入框时' }
      ]
    }
  ];

  /* True when the event target is a text-entry surface, where app-level
     chords must not fire. The xterm host counts: xterm owns the keyboard
     there and turns chords into bytes on the wire. */
  function isTypingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    var tag = target.tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.closest && target.closest('.xterm')) return true;
    return false;
  }

  const terminalSession = {
    buffer: '',
    history: [],
    historyIndex: -1,
    draft: '',
    hintShown: false
  };
  const terminalRuntime = {
    term: null,
    fitAddon: null,
    resizeObserver: null,
    pendingApply: false
  };
  const TERMINAL_HISTORY_MAX = 200;
  const TERMINAL_FONT_SIZE_MIN = 8;
  const TERMINAL_FONT_SIZE_MAX = 48;
  const TERMINAL_FONT_SIZE_DEFAULT = 12;

  /* Buffer sizes.

     The log budget is a CHARACTER count, not a line count, because line widths
     vary by an order of magnitude between a binary dump and a short text reply.

     These numbers changed when renderMonitor() stopped assigning innerHTML over
     the whole log. The previous table below was measured against a full
     rebuild per frame, which made the cap a frame-budget decision:

       128K chars ->  8.5k DOM nodes ->  3.1ms
       256K       -> 17k             ->  7.0ms
       512K       -> 34k             -> 13.3ms   (a 60Hz frame is 16.7ms)
        1M        -> 68k             -> 26.6ms   dropped frames

     Appending a row costs one createElement regardless of buffer size, so that
     ceiling no longer exists and the limit is memory instead. The default moves
     from 256K to 1M.

     Note the remaining cost is O(buffer) but not DOM work: getActiveEvents()
     plus the visible-window loop still walk every entry each frame. That is why
     the default sits well below the 4M cap rather than at it. */
  const LIVE_BUFFER_SIZES = [262144, 1048576, 4194304];
  const LIVE_BUFFER_DEFAULT = 1048576;
  const TERMINAL_SCROLLBACK_SIZES = [5000, 20000, 100000];
  const TERMINAL_SCROLLBACK_DEFAULT = 20000;
  const TERMINAL_READY_HINT_TEXT = '—— 串口终端已就绪：直接键入即发送（Ctrl+C/Ctrl+D/方向键等原样透传给设备）；如设备不回显，请打开“回显” ——';

  const refs = {
    topbar: document.getElementById('app-topbar'),
    serialModeBtn: document.getElementById('serial-mode-btn'),
    parserModeBtn: document.getElementById('parser-mode-btn'),
    statusPill: document.querySelector('.status-pill'),
    logoModeSwitch: document.getElementById('logo-mode-switch'),
    serialStatusDot: document.getElementById('serial-status-dot'),
    serialStatusText: document.getElementById('serial-status-text'),
    themeGroup: document.getElementById('menu-theme-group'),
    themeOpts: document.querySelectorAll('#menu-theme-group .menu-theme-opt'),
    langGroup: document.getElementById('menu-language-group'),
    langOpts: document.querySelectorAll('#menu-language-group .menu-lang-opt'),
    cornerGroup: document.getElementById('menu-corner-group'),
    cornerOpts: document.querySelectorAll('#menu-corner-group .menu-corner-opt'),
    timelineSelect: document.getElementById('timeline-select'),
    stopRecordBtn: document.getElementById('stop-record-btn'),
    timelinePickerBtn: document.getElementById('timeline-picker-btn'),
    timelinePickerPanel: document.getElementById('timeline-picker-panel'),
    timelineLabel: document.getElementById('timeline-label'),
    timelineStamp: document.getElementById('timeline-stamp'),
    timelineRibbonShell: document.getElementById('timeline-ribbon-shell'),
    timelineHistoryStrip: document.getElementById('timeline-history-strip'),
    timelineLiveIndicator: document.getElementById('timeline-live-indicator'),
    timelineFreezeHub: document.getElementById('timeline-freeze-hub'),
    timelineFreezeBtn: document.getElementById('timeline-freeze-btn'),
    timelineFreezeIcon: document.getElementById('timeline-freeze-icon'),
    timelineSlider: document.getElementById('timeline-slider'),
    timelineProgress: document.getElementById('timeline-progress'),
    systemMenuBtn: document.getElementById('system-menu-btn'),
    systemMenu: document.getElementById('system-menu'),
    configMenuRow: document.getElementById('config-menu-row'),
    configMenuConfirmRow: document.getElementById('config-menu-confirm-row'),
    copyUserConfigBtn: document.getElementById('copy-user-config-btn'),
    pasteUserConfigBtn: document.getElementById('paste-user-config-btn'),
    resetUserConfigBtn: document.getElementById('reset-user-config-btn'),
    confirmUserConfigBtn: document.getElementById('confirm-user-config-btn'),
    cancelUserConfigBtn: document.getElementById('cancel-user-config-btn'),
    downloadLocalLink: document.getElementById('download-local-link'),
    versionInfoBtn: document.getElementById('version-info-btn'),
    runtimeModeLabel: document.getElementById('runtime-mode-label'),
    onlineModeChip: document.getElementById('online-mode-chip'),
    versionModalBackdrop: document.getElementById('version-modal-backdrop'),
    versionModalClose: document.getElementById('version-modal-close'),
    versionModalTitle: document.getElementById('version-modal-title'),
    versionCurrentLabel: document.getElementById('version-current-label'),
    versionOnlineBox: document.getElementById('version-online-box'),
    shortcutModalBackdrop: document.getElementById('shortcut-modal-backdrop'),
    shortcutModalClose: document.getElementById('shortcut-modal-close'),
    shortcutGroups: document.getElementById('shortcut-groups'),
    connectBtn: document.getElementById('connect-btn'),
    baudRate: document.getElementById('baud-rate'),
    baudRateAnchor: document.getElementById('baud-rate-anchor'),
    baudRatePresetBtn: document.getElementById('baud-rate-preset-btn'),
    baudRatePresetMenu: document.getElementById('baud-rate-preset-menu'),
    dataBits: document.getElementById('data-bits'),
    stopBits: document.getElementById('stop-bits'),
    parity: document.getElementById('parity'),
    releaseOnBlur: document.getElementById('release-on-blur'),
    releaseOnBlurChip: document.getElementById('release-on-blur-chip'),
    flowControl: document.getElementById('flow-control'),
    flowControlChip: document.getElementById('flow-control-chip'),
    autoReconnect: document.getElementById('auto-reconnect'),
    deviceVid: document.getElementById('device-vid'),
    devicePid: document.getElementById('device-pid'),
    signalDtr: document.getElementById('signal-dtr'),
    signalRts: document.getElementById('signal-rts'),
    signalBreak: document.getElementById('signal-break'),
    signalDtrChip: document.getElementById('signal-dtr-chip'),
    signalRtsChip: document.getElementById('signal-rts-chip'),
    signalBreakChip: document.getElementById('signal-break-chip'),
    signalCtsReadout: document.getElementById('signal-cts-readout'),
    signalDsrReadout: document.getElementById('signal-dsr-readout'),
    signalDcdReadout: document.getElementById('signal-dcd-readout'),
    signalRiReadout: document.getElementById('signal-ri-readout'),
    signalCtsValue: document.getElementById('signal-cts-value'),
    signalDsrValue: document.getElementById('signal-dsr-value'),
    signalDcdValue: document.getElementById('signal-dcd-value'),
    signalRiValue: document.getElementById('signal-ri-value'),
    rxDisplayMode: document.getElementById('rx-display-mode'),
    textEncoding: document.getElementById('text-encoding'),
    appendTimestamp: document.getElementById('append-timestamp'),
    sendMode: document.getElementById('send-mode'),
    newlineMode: document.getElementById('newline-mode'),
    appendNewline: document.getElementById('append-newline'),
    layoutToggleBtn: document.getElementById('layout-toggle-btn'),
    layoutToggleLabel: document.getElementById('layout-toggle-label'),
    leftColumn: document.querySelector('.left-column'),
    rightColumn: document.querySelector('.right-column'),
    expandedLeftTop: document.querySelector('.expanded-left-top'),
    configPanel: document.querySelector('.config-panel'),
    parserPanel: document.querySelector('.parser-panel'),
    chartsPanel: document.querySelector('.charts-panel'),
    monitorPanel: document.querySelector('.monitor-panel'),
    mobileConfigBackdrop: document.getElementById('mobile-config-backdrop'),
    textParserPane: document.getElementById('text-parser-pane'),
    binaryParserPane: document.getElementById('binary-parser-pane'),
    parserModeSwitch: document.querySelector('.parser-mode-switch'),
    parserPanelToggle: document.getElementById('parser-panel-toggle'),
    parserPanelBody: document.getElementById('parser-panel-body'),
    simulatorPanelToggle: document.getElementById('simulator-panel-toggle'),
    simulatorPanelBody: document.getElementById('simulator-panel-body'),
    textRuleOverlay: document.getElementById('text-rule-overlay'),
    textParseRule: document.getElementById('text-parse-rule'),
    addBinaryRowBtn: document.getElementById('add-binary-row-btn'),
    binarySchemaList: document.getElementById('binary-schema-list'),
    applyRecommendedRuleBtn: document.getElementById('apply-recommended-rule-btn'),
    toggleParserResultsBtn: document.getElementById('toggle-parser-results-btn'),
    parserPreview: document.getElementById('parser-preview'),
    simulationEnabled: document.getElementById('simulation-enabled'),
    simulationScript: document.getElementById('simulation-script'),
    simulationStatus: document.getElementById('simulation-status'),
    simulationInterval: document.getElementById('simulation-interval'),
    simulationBurst: document.getElementById('simulation-burst'),
    simulationTemplate: document.getElementById('simulation-template'),
    simulationTemplateReset: document.getElementById('simulation-template-reset'),
    simulationFrameTemplate: document.getElementById('simulation-frame-template'),
    simulationFrameTemplateReset: document.getElementById('simulation-frame-template-reset'),
    simulationPreview: document.getElementById('simulation-preview'),
    simulationMonitorChip: document.getElementById('simulation-monitor-chip'),
    addTimeChartBtn: document.getElementById('add-time-chart-btn'),
    addFftChartBtn: document.getElementById('add-fft-chart-btn'),
    addBarChartBtn: document.getElementById('add-bar-chart-btn'),
    clearChartsBtn: document.getElementById('clear-charts-btn'),
    chartList: document.getElementById('chart-list'),
    monitorMetaMode: document.getElementById('monitor-meta-mode'),
    monitorMetaTx: document.getElementById('monitor-meta-tx'),
    monitorMetaRx: document.getElementById('monitor-meta-rx'),
    clearLiveLogBtn: document.getElementById('clear-live-log-btn'),
    terminalJumpBtn: document.getElementById('terminal-jump-btn'),
    terminal: document.getElementById('terminal'),
    sendPanel: document.getElementById('send-panel'),
    sendResizeHandle: document.getElementById('send-resize-handle'),
    sendExtensionShell: document.getElementById('send-extension-shell'),
    sendManualPanel: document.getElementById('send-manual-panel'),
    sendInput: document.getElementById('send-input'),
    sendNowBtn: document.getElementById('send-now-btn'),
    monitorViewSwitch: document.getElementById('monitor-view-switch'),
    monitorViewTabs: document.querySelectorAll('[data-monitor-view]'),
    termInteraction: document.getElementById('term-interaction'),
    termOutput: document.getElementById('term-output'),
    termNewline: document.getElementById('term-newline'),
    termFont: document.getElementById('term-font'),
    monoSizePreset: document.getElementById('mono-size-preset'),
    monoSizeCustom: document.getElementById('mono-size-custom'),
    monoSizeCustomField: document.getElementById('mono-size-custom-field'),
    termSkin: document.getElementById('term-skin'),
    termScrollback: document.getElementById('term-scrollback'),
    liveBufferSize: document.getElementById('live-buffer-size'),
    exportLogBtn: document.getElementById('export-log-btn'),
    termLocalEcho: document.getElementById('term-local-echo'),
    termKeyBar: document.getElementById('term-key-bar'),
    termKeyBarBody: document.getElementById('term-key-bar-body'),
    termKeyBarToggle: document.getElementById('term-key-bar-toggle'),
    autoSendTile: document.getElementById('auto-send-tile'),
    conditionSendTile: document.getElementById('condition-send-tile'),
    presetSendTile: document.getElementById('preset-send-tile'),
    toggleAutoSendBtn: document.getElementById('toggle-auto-send-btn'),
    toggleAutoSendEnableBtn: document.getElementById('toggle-auto-send-enable-btn'),
    toggleConditionSendBtn: document.getElementById('toggle-condition-send-btn'),
    toggleConditionSendEnableBtn: document.getElementById('toggle-condition-send-enable-btn'),
    togglePresetSendBtn: document.getElementById('toggle-preset-send-btn'),
    togglePresetSendEnableBtn: document.getElementById('toggle-preset-send-enable-btn'),
    autoSendModule: document.getElementById('auto-send-module'),
    conditionSendModule: document.getElementById('condition-send-module'),
    presetSendModule: document.getElementById('preset-send-module'),
    autoSendSwitch: document.getElementById('auto-send-switch'),
    conditionSendSwitch: document.getElementById('condition-send-switch'),
    presetSendSwitch: document.getElementById('preset-send-switch'),
    autoSendInterval: document.getElementById('auto-send-interval'),
    addAutoItemBtn: document.getElementById('add-auto-item-btn'),
    autoSendQueue: document.getElementById('auto-send-queue'),
    addConditionRuleBtn: document.getElementById('add-condition-rule-btn'),
    conditionRuleList: document.getElementById('condition-rule-list'),
    addPresetItemBtn: document.getElementById('add-preset-item-btn'),
    presetSendList: document.getElementById('preset-send-list'),
    timelineFileInput: document.getElementById('timeline-file-input'),
    toastLayer: document.getElementById('toast-layer')
  };

  const browserThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const initialSavedTheme = (window.__serialWebInitialPrefs && (window.__serialWebInitialPrefs.theme === 'system' || window.__serialWebInitialPrefs.theme === 'dark' || window.__serialWebInitialPrefs.theme === 'light'))
    ? window.__serialWebInitialPrefs.theme
    : 'system';
  const initialSavedLocale = ['zh', 'en', 'system'].includes(window.__serialWebInitialLocale)
    ? window.__serialWebInitialLocale
    : 'system';
  // Square by default: the reference design this fork adopted has no radius.
  // A user upgrading from a build without this key lands on square too.
  const CORNER_SETTINGS = ['square', 'soft', 'round'];
  const CORNER_LABELS = { square: '直角', soft: '微圆', round: '圆润' };
  const initialSavedCorner = CORNER_SETTINGS.includes(window.__serialWebInitialCorner)
    ? window.__serialWebInitialCorner
    : 'square';
  const state = {
    version: VERSION,
    theme: initialSavedTheme,
    locale: initialSavedLocale,
    cornerRadius: initialSavedCorner,
    layoutExpanded: false,
    parserMode: 'text',
    serial: {
      supported: isWebSerialApiAvailable(),
      connected: false,
      port: null,
      portHint: null,
      portInfoHint: null,
      disconnectedPortRef: null,
      reader: null,
      writer: null,
      disconnecting: false,
      reconnectTask: null,
      reconnectWakeResolve: null,
      reconnectSession: 0,
      reconnectCandidate: null,
      reconnectPending: false,
      reconnectWanted: false,
      reconnectPhase: 'idle',
      reconnectReason: 'none',
      reconnectFailureKind: '',
      reconnectFailureDetail: '',
      reconnectNoticeShown: false,
      reconnectSince: 0,
      reconnectResumeElapsedMs: 0,
      activeOpenSignature: '',
      pendingOpenSignature: '',
      reconfigureTimer: 0,
      reconfigureTask: null,
      reconfigureQueued: false,
      signalPollTimer: null,
      sendBusy: false,
      sendInFlight: Promise.resolve(),
      keepReading: false,
      connectedAt: 0,
      activeFlowControl: 'none',
      blurReleaseElapsedMs: 0,
      blurReleaseActive: false,
      connectionEpoch: 0,
      rxActiveEvent: null,
      pendingCR: false,
      deviceInfo: {
        vid: '-',
        pid: '-',
        description: '浏览器未提供',
        online: '离线'
      },
      signalInputs: {
        cts: null,
        dsr: null,
        dcd: null,
        ri: null
      }
    },
    settings: {
      baudRate: '115200',
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      releaseSignalsOnBlur: false,
      flowControl: 'none',
      signalDtr: false,
      signalRts: false,
      signalBreak: false,
      autoReconnect: true,
      liveBufferSize: LIVE_BUFFER_DEFAULT,
      terminalScrollback: TERMINAL_SCROLLBACK_DEFAULT,
      simulation: {
        enabled: false,
        scriptId: 'text-sensor',
        timerId: 0,
        tick: 0,
        // Cumulative frames emitted, shown next to the switch so a mixed log
        // can be accounted for. Session-scoped, not persisted.
        totalFrames: 0,
        intervalMs: SIMULATION_INTERVAL_DEFAULT,
        burst: SIMULATION_BURST_DEFAULT,
        // Empty means "use the script's own output". When set, only text
        // scripts use it; a binary frame has no meaningful text template.
        template: SIMULATION_TEMPLATE_DEFAULT,
        // Binary frame layout, in the SIMULATION_FRAME_PLACEHOLDERS notation.
        frameTemplate: SIMULATION_FRAME_TEMPLATE_DEFAULT,
        /* Whether the user has typed in each box. While false, switching
           scripts re-seeds the box with the new script's default; once the user
           has written their own template, it survives script switches — a
           template they wrote is not something to overwrite because they
           looked at another script. Cleared by 恢复默认. */
        templateDirty: false,
        frameTemplateDirty: false
      },
      rxDisplayMode: 'text',
      textEncoding: 'utf-8',
      appendTimestamp: true,
      sendMode: 'ascii',
      newlineMode: 'rn',
      appendNewline: true
    },
    sendDraft: {
      text: '',
      hex: ''
    },
    session: {
      startMs: Date.now(),
      txBytes: 0,
      rxBytes: 0,
      rawChunks: [],
      liveEvents: []
    },
    recording: {
      active: false,
      startedAt: 0,
      rawChunks: []
    },
    timelines: [],
    activeTimelineId: 'realtime',
    playback: {
      playing: false,
      positionMs: 0,
      lastTick: 0
    },
    parser: {
      textRule: '',
      // True while the rule box holds the simulator's suggested rule rather
      // than something the user typed. Selecting a simulator script may
      // overwrite it; a hand-written rule is never touched.
      textRuleIsAuto: false,
      binarySchema: []
    },
    derived: {
      availableFields: [],
      recommendedRule: '',
      numericSeries: {},
      chartSeries: {},
      chartIntervalMs: 1,
      resultCards: []
    },
    derivedRuntime: {
      viewSignature: '',
      parserSignature: '',
      mode: 'text',
      sourceKind: 'realtime',
      lastRealtimeRawChunkIndex: 0,
      textBaseTimestamp: 0,
      binaryBaseTimestamp: 0,
      numericSeries: {},
      chartFrameCount: 0,
      chartFrameFirstTimestamp: 0,
      chartFrameLastTimestamp: 0,
      chartBatchTimestamp: 0,
      chartBatchFrameCount: 0,
      chartIntervalAccumMs: 0,
      chartIntervalAccumFrames: 0,
      chartFrameIntervalMs: 0,
      successfulFrames: [],
      fieldTypes: new Map(),
      latestCards: [],
      binaryRemainders: { rx: [], tx: [] }
    },
    charts: [],
    modules: {
      autoSendOpen: false,
      conditionSendOpen: false,
      presetSendOpen: false
    },
    autoSend: {
      enabled: false,
      intervalMs: 1000,
      queue: [],
      timerId: null,
      nextIndex: 0
    },
    conditionSend: {
      enabled: false,
      rules: []
    },
    presetSend: {
      enabled: false,
      items: [],
      pendingExpectations: []
    },
    ui: {
      pendingRefresh: false,
      clockTimerId: null,
      binarySchemaReparseTimerId: null,
      dirty: {
        status: true,
        timelineSelect: true,
        stats: true,
        timelineBar: true,
        derived: true,
        monitor: true,
        extensionButtons: true,
        extensionPanel: true,
        extensionHeights: true,
        charts: true
      },
      activeViewCache: {
        signature: '',
        timeline: null,
        events: [],
        rawChunks: [],
      range: { startTs: 0, endTs: 0, durationMs: 1 }
    },
    frozenRealtimeView: null,
    liveFreezeMode: 'none',
    liveFreezeHoverSuppressed: false,
    chartRenderSignature: '',
    chartPaintPending: false,
    chartPaintForce: false,
    timelinePickerSignature: '',
    timelineExportOpenId: null,
    chartPickerOpenId: '',
    pendingConfigAction: '',
    versionModalMarkOnClose: false,
      terminalAtBottom: true,
      windowFocused: document.hasFocus(),
      textRuleGhostVisible: false,
      connectHintUntil: 0,
      connectHintText: '',
      connectHintKind: 'default',
      compactSingle: false,
      compactConfigOpen: false,
      monitorView: 'terminal',
      sidebarCollapsed: false,
      parserResultsExpanded: false,
      // Open by default now. It was collapsed because the settings took a
      // third of the RAIL; they live in the graph view's wide column now, where
      // that reasoning does not apply, and arriving at the parse view to find
      // it folded away is the same "where is the thing I came for" problem the
      // simulator disclosure had. Still collapsible, and still remembered.
      parserPanelOpen: true,
      // Same reasoning as the parser panel: the simulator is one of the three
      // things the parse view is for, and it is the one that cannot be found
      // when it starts folded — the whole point of this part is that the user
      // can see what is about to be sent.
      simulatorPanelOpen: true,
      // Terminal key bar starts open; the collapse is a per-user choice about
      // panel height, not a default the app should make for them.
      termKeyBarOpen: true,
      parserResultsCanExpand: false,
      chartDrag: null,
      sendExtensionHeightOverride: 0,
      sendExtensionResize: null,
      modePulse: {
        auto: { until: 0, tone: 'success', rafId: 0, timerId: 0 },
        condition: { until: 0, tone: 'success', rafId: 0, timerId: 0 },
        preset: { until: 0, tone: 'success', rafId: 0, timerId: 0 }
      },
      parserRecommendPromptRule: '',
      parserRecommendPromptConnectionEpoch: -1
    }
  };

  let eventIdCounter = 0;
  let chartIdCounter = 0;
  let queueIdCounter = 0;
  let ruleIdCounter = 0;
  let schemaRowIdCounter = 0;
  let timelineIdCounter = 0;
  let playerFrame = null;
  let localPrefsTimerId = 0;
  let restoringLocalPrefs = false;
  let activeReorderDrag = null;

  function markUiDirty(next = null) {
    const dirty = state.ui.dirty;
    if (!next) {
      Object.keys(dirty).forEach((key) => { dirty[key] = true; });
      return;
    }
    Object.entries(next).forEach(([key, value]) => {
      if (key in dirty && value) dirty[key] = true;
    });
  }

  function uid(prefix) {
    if (prefix === 'evt') return `${prefix}-${++eventIdCounter}`;
    if (prefix === 'chart') return `${prefix}-${++chartIdCounter}`;
    if (prefix === 'queue') return `${prefix}-${++queueIdCounter}`;
    if (prefix === 'rule') return `${prefix}-${++ruleIdCounter}`;
    if (prefix === 'schema') return `${prefix}-${++schemaRowIdCounter}`;
    return `${prefix}-${++timelineIdCounter}`;
  }

  function resetDerivedRuntime() {
    state.derivedRuntime = createDerivedRuntimeSeed(
      state.parserMode,
      state.activeTimelineId === 'realtime' ? 'realtime' : 'timeline'
    );
    return state.derivedRuntime;
  }

  function invalidateDerivedCaches() {
    resetDerivedRuntime();
    state.ui.activeViewCache.signature = '';
    state.ui.chartRenderSignature = '';
    if (refs.chartList) delete refs.chartList.dataset.rendered;
    state.charts.forEach((chart) => {
      chart.fftCache = {};
    });
  }

  function invalidateDerivedDataCaches() {
    resetDerivedRuntime();
    state.ui.activeViewCache.signature = '';
    state.charts.forEach((chart) => {
      chart.fftCache = {};
    });
  }

  function clearRealtimeHistoryData() {
    state.session.rawChunks = [];
    state.session.liveEvents = [];
    state.session.txBytes = 0;
    state.session.rxBytes = 0;
    state.serial.rxActiveEvent = null;
    invalidateDerivedCaches();
    if (state.activeTimelineId === 'realtime') scheduleRefresh();
    requestAnimationFrame(forceTerminalToLatest);
  }

  /* Current live-buffer budget in characters. Read from state so the toolbar
     select can change it; falls back to the default for an unknown value. */
  function liveBufferLimit() {
    var size = Number(state.settings.liveBufferSize);
    return LIVE_BUFFER_SIZES.includes(size) ? size : LIVE_BUFFER_DEFAULT;
  }

  function trimRealtimeRawChunks() {
    const chunks = state.session.rawChunks;
    if (!chunks.length) return;
    const limit = liveBufferLimit();
    let totalChars = 0;
    let keepFrom = chunks.length;
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      totalChars += getRawChunkDisplayLength(chunks[index]);
      keepFrom = index;
      if (totalChars > limit) {
        break;
      }
    }
    if (keepFrom > 0) {
      chunks.splice(0, keepFrom);
    }
  }

  function trimLiveEvents() {
    const events = state.session.liveEvents;
    if (!events.length) return;
    const limit = liveBufferLimit();
    let totalChars = events.reduce((sum, event) => sum + getEventDisplayText(event).length, 0);
    while (events.length > 1 && totalChars > limit) {
      totalChars -= getEventDisplayText(events[0]).length;
      events.shift();
    }
  }

  function hasDynamicClockUi() {
    return Boolean(
      state.serial.connected
      || state.serial.blurReleaseActive
      || state.serial.reconnectPhase === 'trying'
      || state.recording.active
      || state.activeTimelineId === 'realtime'
    );
  }

  function ensureUiClockTimer() {
    if (state.ui.clockTimerId) return;
    state.ui.clockTimerId = window.setInterval(() => {
      if (!hasDynamicClockUi()) return;
      scheduleRefresh({
        status: true,
        stats: true,
        timelineBar: true
      });
    }, 250);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function clamp(num, min, max) {
    return Math.min(max, Math.max(min, num));
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  /* Compact "time since" for the status pill: 3s / 12m / 4h. Deliberately
     coarser than formatDuration -- the pill answers "is it alive?", not
     "exactly when did it connect". */
  function formatRelativeAge(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  function nowPreciseMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return HIGH_RES_TIME_EPOCH_MS + performance.now();
    }
    return Date.now();
  }

  function normalizeTimestampMs(value, fallback = nowPreciseMs()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function formatStamp(ts) {
    const date = new Date(normalizeTimestampMs(ts));
    const tenths = Math.floor(date.getMilliseconds() / 100);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}.${tenths}`;
  }

  function formatTimelineClock(ms) {
    const total = Math.max(0, Math.floor(ms));
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const millis = total % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  function shouldWaitForBlurReconnect() {
    return Boolean(state.settings.releaseSignalsOnBlur)
      && (!state.ui.windowFocused || document.visibilityState === 'hidden');
  }

  function enterBlurReconnectWait(elapsedMs = state.serial.blurReleaseElapsedMs) {
    state.serial.reconnectWanted = false;
    state.serial.reconnectPending = false;
    state.serial.reconnectPhase = 'idle';
    state.serial.reconnectReason = 'blur-release';
    state.serial.reconnectCandidate = null;
    state.serial.blurReleaseActive = true;
    state.serial.blurReleaseElapsedMs = Math.max(0, elapsedMs || 0);
    wakeReconnectLoop();
    updateSerialStatus();
  }

  function bytesToHex(bytes) {
    return Array.from(bytes || []).map((value) => value.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  }

  function normalizeHexString(input) {
    return input.replace(/0x/gi, ' ').replace(/[^0-9a-fA-F]/g, ' ').trim();
  }

  function parseHexString(input) {
    const normalized = normalizeHexString(String(input || ''));
    if (!normalized) return new Uint8Array();
    const parts = normalized.split(/\s+/).filter(Boolean);
    const values = [];
    for (const part of parts) {
      if (part.length > 2) {
        for (let i = 0; i < part.length; i += 2) {
          const piece = part.slice(i, i + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(piece)) {
            throw new Error(t('非法 HEX 字节: {{byte}}', { byte: piece }));
          }
          values.push(parseInt(piece, 16));
        }
        continue;
      }
      if (!/^[0-9a-fA-F]{1,2}$/.test(part)) {
        throw new Error(t('非法 HEX 字节: {{byte}}', { byte: part }));
      }
      values.push(parseInt(part, 16));
    }
    return Uint8Array.from(values);
  }

  function appendLineEnding(bytes, newlineMode) {
    const suffix = newlineMode === 'r' ? [0x0d] : newlineMode === 'n' ? [0x0a] : [0x0d, 0x0a];
    const merged = new Uint8Array(bytes.length + suffix.length);
    merged.set(bytes, 0);
    merged.set(suffix, bytes.length);
    return merged;
  }

  function createRawChunk(direction, bytes, timestamp = nowPreciseMs(), metadata = {}) {
    const normalizedBytes = Array.from(bytes || []);
    return {
      id: uid('raw'),
      timestamp: normalizeTimestampMs(timestamp),
      direction,
      type: direction,
      bytes: normalizedBytes,
      metadata: { ...metadata }
    };
  }

  function getRawChunkDisplayLength(chunk) {
    const bytes = Uint8Array.from(chunk?.bytes || []);
    if (!bytes.length) return 0;
    const text = decodeBytes(bytes, state.settings.textEncoding);
    return String(text || '').length || bytes.length;
  }

  function recordRawChunk(direction, bytes, timestamp = nowPreciseMs(), metadata = {}) {
    const chunk = createRawChunk(direction, bytes, timestamp, metadata);
    if (state.recording.active) {
      state.recording.rawChunks.push(chunk);
    }
    state.session.rawChunks.push(chunk);
    trimRealtimeRawChunks();
    return chunk;
  }

  function shouldUseFrozenRealtimeView() {
    return state.activeTimelineId === 'realtime' && state.ui.liveFreezeMode !== 'none';
  }

  function isRealtimeFreezeAvailable() {
    return state.activeTimelineId === 'realtime'
      && state.serial.connected
      && !state.recording.active
      && !state.serial.blurReleaseActive
      && state.serial.reconnectPhase !== 'trying';
  }

  function snapshotRealtimeView() {
    const liveEvents = state.session.liveEvents || [];
    const rawChunks = state.session.rawChunks || [];
    const lastEvent = liveEvents[liveEvents.length - 1];
    const endTs = lastEvent ? lastEvent.timestamp : nowPreciseMs();
    state.ui.frozenRealtimeView = {
      signature: [
        'realtime-freeze',
        liveEvents.length,
        lastEvent?.id || '',
        rawChunks.length,
        rawChunks[rawChunks.length - 1]?.id || '',
        state.session.startMs,
        Number(endTs).toFixed(3)
      ].join('|'),
      timeline: null,
      events: liveEvents.map((event) => ({
        ...event,
        bytes: Array.isArray(event?.bytes) ? event.bytes.slice() : [],
        metadata: event?.metadata ? { ...event.metadata } : {}
      })),
      rawChunks: rawChunks.map((chunk) => ({
        ...chunk,
        bytes: Array.isArray(chunk?.bytes) ? chunk.bytes.slice() : [],
        metadata: chunk?.metadata ? { ...chunk.metadata } : {}
      })),
      range: {
        startTs: state.session.startMs,
        endTs,
        durationMs: Math.max(1, endTs - state.session.startMs)
      }
    };
  }

  function refreshRealtimeFreezeView() {
    invalidateDerivedDataCaches();
    scheduleRefresh({ stats: true, timelineBar: true, derived: true, monitor: true, charts: true });
  }

  function resetRealtimeFreezeState(rearm = true) {
    const changed = state.ui.liveFreezeMode !== 'none'
      || Boolean(state.ui.frozenRealtimeView)
      || state.ui.liveFreezeHoverSuppressed === rearm;
    state.ui.liveFreezeMode = 'none';
    state.ui.liveFreezeHoverSuppressed = !rearm;
    state.ui.frozenRealtimeView = null;
    return changed;
  }

  function clearRealtimeFreezeHover(rearm = true) {
    if (state.ui.liveFreezeMode === 'locked') return;
    if (shouldPreserveTerminalSelectionDuringFreeze()) return;
    const changed = state.ui.liveFreezeMode !== 'none'
      || Boolean(state.ui.frozenRealtimeView)
      || state.ui.liveFreezeHoverSuppressed === rearm;
    state.ui.liveFreezeMode = 'none';
    state.ui.liveFreezeHoverSuppressed = !rearm;
    state.ui.frozenRealtimeView = null;
    if (changed) {
      refreshRealtimeFreezeView();
    }
  }

  function hasTerminalTextSelection() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    return Boolean(
      refs.terminal
      && ((anchor && refs.terminal.contains(anchor)) || (focus && refs.terminal.contains(focus)))
    );
  }

  function shouldPreserveTerminalSelectionDuringFreeze() {
    if (state.activeTimelineId !== 'realtime' || state.ui.liveFreezeMode === 'none') return false;
    return hasTerminalTextSelection();
  }

  function shouldPreserveTerminalSelectionForMonitor() {
    if (!hasTerminalTextSelection()) return false;
    if (state.activeTimelineId === 'realtime') return state.ui.liveFreezeMode !== 'none';
    return !state.playback.playing;
  }

  function syncRealtimeFreezeState() {
    if (!isRealtimeFreezeAvailable()) {
      if (resetRealtimeFreezeState(true)) {
        refreshRealtimeFreezeView();
      }
      return;
    }
    if (shouldUseFrozenRealtimeView()) {
      if (!state.ui.frozenRealtimeView) snapshotRealtimeView();
      return;
    }
    state.ui.frozenRealtimeView = null;
  }

  function newlineText(mode) {
    if (mode === 'r') return '\r';
    if (mode === 'n') return '\n';
    return '\r\n';
  }

  function normalizeTextLineEndings(text, newlineMode) {
    return String(text ?? '').replace(/\r\n|\r|\n/g, newlineText(newlineMode));
  }

  function decodeBytes(bytes, encoding) {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch (error) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  function encodeText(text, encoding) {
    const value = String(text || '');
    if (encoding === 'ascii') {
      return Uint8Array.from(Array.from(value).map((char) => char.charCodeAt(0) & 0x7f));
    }
    if (encoding === 'latin1') {
      return Uint8Array.from(Array.from(value).map((char) => char.charCodeAt(0) & 0xff));
    }
    if (encoding === 'utf-16le') {
      const buffer = new Uint8Array(value.length * 2);
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        buffer[index * 2] = code & 0xff;
        buffer[index * 2 + 1] = code >> 8;
      }
      return buffer;
    }
    return new TextEncoder().encode(value);
  }

  function safeHexBytes(value) {
    try {
      return Array.from(parseHexString(value));
    } catch (error) {
      return [];
    }
  }

  function encodeBase64Utf8(text) {
    return btoa(unescape(encodeURIComponent(String(text ?? ''))));
  }

  function decodeBase64Utf8(text) {
    return decodeURIComponent(escape(atob(text)));
  }

  function bytesToCompactHex(bytes) {
    return bytesToHex(bytes).replace(/\s+/g, '');
  }

  function formatFileTimestamp(ts) {
    const date = new Date(normalizeTimestampMs(ts));
    const pad2 = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  }

  function sanitizeFileStem(name, fallback = 'timeline') {
    const normalized = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    return normalized || fallback;
  }

  function formatReadableTimestamp(ts) {
    const date = new Date(normalizeTimestampMs(ts));
    const pad2 = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function toast(title, body, kind = 'success', actions = [], options = {}) {
    const toastKey = String(options.key || `${kind}::${title}::${body}`);
    let item = Array.from(refs.toastLayer.querySelectorAll('.toast')).find((node) => node._toastKey === toastKey) || null;
    if (!item) {
      item = document.createElement('div');
      refs.toastLayer.appendChild(item);
    } else {
      refs.toastLayer.appendChild(item);
    }
    item._toastKey = toastKey;
    item.className = `toast ${kind}`;
    const actionsHtml = actions.length
      ? `<div class="toast-actions">${actions.map((action, index) => `<button class="toast-action-btn ${escapeHtml(action.kind || '')}" type="button" data-toast-action="${index}">${escapeHtml(action.label)}</button>`).join('')}</div>`
      : '';
    item.innerHTML = `<div class="toast-head"><div class="toast-title">${escapeHtml(title)}</div><button class="toast-close" type="button" aria-label="${escapeHtml(t('关闭提示'))}">×</button></div><div class="toast-body">${escapeHtml(body)}</div>${actionsHtml}`;
    translateDom(item);
    const close = () => {
      if (item._toastTimer) {
        clearTimeout(item._toastTimer);
        item._toastTimer = 0;
      }
      item.remove();
    };
    item.querySelector('.toast-close')?.addEventListener('click', close);
    item.querySelectorAll('[data-toast-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = actions[Number(button.getAttribute('data-toast-action'))];
        if (action?.onClick) action.onClick();
        if (!action?.keepOpen) close();
      });
    });
    if (item._toastTimer) {
      clearTimeout(item._toastTimer);
    }
    item._toastTimer = setTimeout(close, 10000);
  }

  function getSerialErrorInfo(error, fallback = '串口操作失败') {
    const message = String(error?.message || '').trim();
    if (error?.name === 'NotFoundError') {
      return { kind: 'cancelled', detail: t('未选择串口设备') };
    }
    if (message && /access denied|permission|denied/i.test(message)) {
      return { kind: 'permission', detail: t('串口访问被拒绝，请检查系统权限') };
    }
    if (error?.name === 'InvalidStateError') {
      return { kind: 'occupied', detail: t('串口已被占用或当前状态不可操作') };
    }
    if (message && /busy|in use|claimed|resource busy|already open/i.test(message)) {
      return { kind: 'occupied', detail: t('串口已被占用，请关闭其他串口软件后重试') };
    }
    if (
      error?.name === 'NetworkError'
      || (message && /device has been lost|disconnected|not found|failed to open|port is closed|network error/i.test(message))
    ) {
      return { kind: 'missing', detail: t('串口设备已断开或不可用') };
    }
    return { kind: 'generic', detail: message || t(fallback) };
  }

  function isWebSerialApiAvailable() {
    return Boolean(
      navigator?.serial
      && typeof navigator.serial.requestPort === 'function'
      && typeof navigator.serial.getPorts === 'function'
    );
  }

  function getUnifiedConnectionFailureDetail() {
    return t('串口可能被占用，请关闭其他串口软件后重试');
  }

  function showConnectButtonHint(text, kind = 'default', durationMs = 2000) {
    state.ui.connectHintText = text;
    state.ui.connectHintKind = kind;
    state.ui.connectHintUntil = Date.now() + durationMs;
    updateSerialStatus();
    window.setTimeout(() => {
      if (Date.now() >= state.ui.connectHintUntil) {
        state.ui.connectHintUntil = 0;
        state.ui.connectHintText = '';
        state.ui.connectHintKind = 'default';
        updateSerialStatus();
      }
    }, durationMs + 20);
  }

  function shortConnectHint(action) {
    return t('{{action}} | 串口可能被占用', { action: t(action) });
  }

  function normalizeSendOptions(sendOptions = state.settings) {
    return {
      sendMode: sendOptions.sendMode === 'hex' ? 'hex' : 'ascii',
      textEncoding: sendOptions.textEncoding || state.settings.textEncoding,
      appendNewline: typeof sendOptions.appendNewline === 'boolean' ? sendOptions.appendNewline : Boolean(state.settings.appendNewline),
      newlineMode: ['r', 'n', 'rn'].includes(sendOptions.newlineMode) ? sendOptions.newlineMode : (['r', 'n', 'rn'].includes(state.settings.newlineMode) ? state.settings.newlineMode : 'rn')
    };
  }

  function getSendInputPlaceholder() {
    return state.settings.sendMode === 'hex'
      ? '输入原始十六进制内容'
      : '输入发送内容';
  }

  function sanitizeHexInputValue(value) {
    return String(value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  }

  function formatHexInputDisplay(raw) {
    const groups = String(raw || '').match(/.{1,2}/g);
    return groups ? groups.join(' ') : '';
  }

  function bytesToRawHex(bytes) {
    return sanitizeHexInputValue(bytesToHex(bytes));
  }

  function textToRawHex(text) {
    return bytesToRawHex(encodeText(String(text || ''), state.settings.textEncoding));
  }

  function rawHexToText(raw) {
    const normalized = sanitizeHexInputValue(raw);
    if (!normalized) return '';
    try {
      return decodeBytes(parseHexString(normalized), state.settings.textEncoding);
    } catch (error) {
      return '';
    }
  }

  function preservedRawHexAttrs(raw, displayText) {
    const normalized = sanitizeHexInputValue(raw);
    if (!normalized) return '';
    return ` data-raw-hex="${escapeHtml(normalized)}" data-preserved-text="${escapeHtml(displayText)}"`;
  }

  function getTextInputRawHex(input) {
    const preservedRaw = sanitizeHexInputValue(input.dataset.rawHex || '');
    if (preservedRaw && input.value === (input.dataset.preservedText || '')) {
      return preservedRaw;
    }
    return textToRawHex(input.value);
  }

  function getFieldDisplayForMode(record, valueKey, rawKey, mode) {
    if (mode === 'hex') {
      const raw = sanitizeHexInputValue(record?.[rawKey] || record?.[valueKey] || '');
      return formatHexInputDisplay(raw);
    }
    return String(record?.[valueKey] || '');
  }

  function getFieldPreservedRawAttrs(record, rawKey, displayText, mode) {
    return mode === 'hex' ? '' : preservedRawHexAttrs(record?.[rawKey] || '', displayText);
  }

  function setFieldFromRawHex(record, valueKey, rawKey, raw, mode) {
    const normalized = sanitizeHexInputValue(raw);
    record[rawKey] = normalized;
    record[valueKey] = mode === 'hex'
      ? formatHexInputDisplay(normalized)
      : rawHexToText(normalized);
  }

  function convertFieldForMode(record, valueKey, rawKey, previousMode, nextMode) {
    const raw = previousMode === 'hex'
      ? sanitizeHexInputValue(record?.[rawKey] || record?.[valueKey] || '')
      : (sanitizeHexInputValue(record?.[rawKey] || '') || textToRawHex(record?.[valueKey] || ''));
    setFieldFromRawHex(record, valueKey, rawKey, raw, nextMode);
  }

  function hasByteBackedValue(displayValue, rawHex = '') {
    return Boolean(String(displayValue || '').trim() || sanitizeHexInputValue(rawHex).length);
  }

  function getSendPayloadArgs(displayValue, rawHex = '', sendOptions = state.settings) {
    const raw = sanitizeHexInputValue(rawHex || '');
    if (raw && sendOptions.sendMode === 'hex') {
      return {
        payload: raw,
        sendOptions: {
          ...sendOptions,
          displayTextOverride: String(displayValue || '')
        }
      };
    }
    return {
      payload: String(displayValue || ''),
      sendOptions
    };
  }

  function getSendRecordPayloadArgs(record, valueKey = 'payload', rawKey = 'payloadRawHex', sendOptions = state.settings) {
    const displayValue = String(record?.[valueKey] || '');
    const raw = sanitizeHexInputValue(record?.[rawKey] || '')
      || (sendOptions.sendMode === 'hex' ? sanitizeHexInputValue(displayValue) : '');
    return getSendPayloadArgs(displayValue, raw, sendOptions);
  }

  function countHexCharsBefore(text, index) {
    if (index <= 0) return 0;
    return sanitizeHexInputValue(String(text || '').slice(0, index)).length;
  }

  function getDisplayCaretFromRawIndex(rawIndex) {
    if (rawIndex <= 0) return 0;
    return rawIndex + Math.floor((rawIndex - 1) / 2);
  }

  function getSendModePlaceholder() {
    return state.settings.sendMode === 'hex'
      ? 'HEX 内容，例如 AA 55 01'
      : '发送内容';
  }

  function getSendDisplayBytes(value, mode = state.settings.sendMode) {
    return mode === 'hex'
      ? parseHexString(String(value || ''))
      : encodeText(String(value || ''), state.settings.textEncoding);
  }

  function formatSendBytesForMode(bytes, mode = state.settings.sendMode) {
    return mode === 'hex'
      ? bytesToHex(bytes)
      : decodeBytes(bytes, state.settings.textEncoding);
  }

  function convertSendDisplayValue(value, fromMode, toMode) {
    if (fromMode === toMode) {
      return toMode === 'hex'
        ? formatHexInputDisplay(sanitizeHexInputValue(value))
        : String(value || '');
    }
    try {
      return formatSendBytesForMode(getSendDisplayBytes(value, fromMode), toMode);
    } catch (error) {
      return '';
    }
  }

  function normalizeSendContentForMode(value, mode = state.settings.sendMode) {
    return mode === 'hex'
      ? formatHexInputDisplay(sanitizeHexInputValue(value))
      : String(value || '');
  }

  function looksLikeHexDisplayValue(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    if (!/^[0-9a-fA-FxX\s,;:_-]+$/.test(text)) return false;
    return sanitizeHexInputValue(text).length > 0;
  }

  function normalizePersistedSendContent(value, mode = state.settings.sendMode) {
    const text = String(value || '');
    if (mode !== 'hex') return text;
    if (looksLikeHexDisplayValue(text)) {
      try {
        return bytesToHex(parseHexString(text));
      } catch (error) {
        return formatHexInputDisplay(sanitizeHexInputValue(text));
      }
    }
    return formatSendBytesForMode(encodeText(text, state.settings.textEncoding), 'hex');
  }

  function normalizeHexInputElement(input) {
    const originalValue = input.value;
    const selectionStart = input.selectionStart ?? originalValue.length;
    const rawCursor = countHexCharsBefore(originalValue, selectionStart);
    const raw = sanitizeHexInputValue(originalValue);
    const display = formatHexInputDisplay(raw);
    input.dataset.rawHex = raw;
    if (input.value !== display) {
      input.value = display;
    }
    const displayCaret = Math.min(display.length, getDisplayCaretFromRawIndex(rawCursor));
    input.setSelectionRange?.(displayCaret, displayCaret);
    return display;
  }

  function normalizeSendContentInputValue(input) {
    if (state.settings.sendMode === 'hex') {
      return normalizeHexInputElement(input);
    }
    const raw = getTextInputRawHex(input);
    input.dataset.rawHex = raw;
    input.dataset.preservedText = input.value;
    return input.value;
  }

  function getDefaultSendContent(text) {
    return normalizeSendContentForMode(
      state.settings.sendMode === 'hex'
        ? formatSendBytesForMode(encodeText(text, state.settings.textEncoding), 'hex')
        : text
    );
  }

  function getReceiveModePlaceholder() {
    return state.settings.rxDisplayMode === 'hex'
      ? 'HEX 匹配内容，例如 4F 4B'
      : '匹配内容';
  }

  function receiveModeToDisplayMode(mode = state.settings.rxDisplayMode) {
    return mode === 'hex' ? 'hex' : 'ascii';
  }

  function convertReceiveDisplayValue(value, fromMode, toMode) {
    return convertSendDisplayValue(value, receiveModeToDisplayMode(fromMode), receiveModeToDisplayMode(toMode));
  }

  function normalizeReceiveContentForMode(value, mode = state.settings.rxDisplayMode) {
    return mode === 'hex'
      ? formatHexInputDisplay(sanitizeHexInputValue(value))
      : String(value || '');
  }

  function normalizePersistedReceiveContent(value, mode = state.settings.rxDisplayMode) {
    const text = String(value || '');
    if (mode !== 'hex') return text;
    if (looksLikeHexDisplayValue(text)) {
      try {
        return bytesToHex(parseHexString(text));
      } catch (error) {
        return formatHexInputDisplay(sanitizeHexInputValue(text));
      }
    }
    return formatSendBytesForMode(encodeText(text, state.settings.textEncoding), 'hex');
  }

  function normalizeSnapshotReceiveContent(value, mode = state.settings.rxDisplayMode, schemaVersion = 0) {
    const text = String(value || '');
    if (Number(schemaVersion) >= RECEIVE_CONTENT_SCHEMA_VERSION) {
      return normalizePersistedReceiveContent(text, mode);
    }
    return mode === 'hex'
      ? convertReceiveDisplayValue(text, 'text', 'hex')
      : text;
  }

  function normalizeReceiveContentInputValue(input) {
    if (state.settings.rxDisplayMode === 'hex') {
      return normalizeHexInputElement(input);
    }
    const raw = getTextInputRawHex(input);
    input.dataset.rawHex = raw;
    input.dataset.preservedText = input.value;
    return input.value;
  }

  function getDefaultReceiveContent(text) {
    return normalizeReceiveContentForMode(
      state.settings.rxDisplayMode === 'hex'
        ? formatSendBytesForMode(encodeText(text, state.settings.textEncoding), 'hex')
        : text
    );
  }

  function captureReceiveContentInputsFromRefs(mode = state.settings.rxDisplayMode) {
    refs.conditionRuleList?.querySelectorAll('[data-rule-id]').forEach((row) => {
      const rule = state.conditionSend.rules.find((entry) => entry.id === row.dataset.ruleId);
      const input = row.querySelector('[data-rule-pattern]');
      if (rule && input) {
        rule.pattern = mode === 'hex' ? normalizeReceiveContentInputValue(input) : input.value;
        rule.patternRawHex = mode === 'hex'
          ? sanitizeHexInputValue(input.dataset.rawHex || input.value)
          : getTextInputRawHex(input);
      }
    });
    refs.presetSendList?.querySelectorAll('[data-preset-id]').forEach((row) => {
      const item = state.presetSend.items.find((entry) => entry.id === row.dataset.presetId);
      const input = row.querySelector('[data-preset-expected]');
      if (item && input) {
        item.expected = mode === 'hex' ? normalizeReceiveContentInputValue(input) : input.value;
        item.expectedRawHex = mode === 'hex'
          ? sanitizeHexInputValue(input.dataset.rawHex || input.value)
          : getTextInputRawHex(input);
      }
    });
  }

  function switchReceiveDisplayMode(nextMode) {
    nextMode = nextMode === 'hex' ? 'hex' : 'text';
    const previousMode = state.settings.rxDisplayMode === 'hex' ? 'hex' : 'text';
    if (previousMode === nextMode) return;
    captureReceiveContentInputsFromRefs(previousMode);
    state.conditionSend.rules.forEach((rule) => {
      convertFieldForMode(rule, 'pattern', 'patternRawHex', previousMode, nextMode);
    });
    state.presetSend.items.forEach((item) => {
      convertFieldForMode(item, 'expected', 'expectedRawHex', previousMode, nextMode);
    });
    state.settings.rxDisplayMode = nextMode;
    renderSendConfigLists('condition');
    renderSendConfigLists('preset');
    scheduleLocalPrefsSave();
    scheduleRefresh({ monitor: true, extensionPanel: true });
  }

  function syncSendInputModeUI() {
    refs.sendInput.placeholder = getSendInputPlaceholder();
    if (state.settings.sendMode === 'hex') {
      const raw = sanitizeHexInputValue(
        state.sendDraft.hex
        || convertSendDisplayValue(state.sendDraft.text, 'ascii', 'hex')
        || refs.sendInput.dataset.rawHex
        || refs.sendInput.value
      );
      state.sendDraft.hex = raw;
      refs.sendInput.dataset.rawHex = raw;
      delete refs.sendInput.dataset.preservedText;
      refs.sendInput.value = formatHexInputDisplay(raw);
    } else {
      const displayText = String(state.sendDraft.text || rawHexToText(state.sendDraft.hex) || '');
      refs.sendInput.value = displayText;
      if (state.sendDraft.hex) {
        refs.sendInput.dataset.rawHex = sanitizeHexInputValue(state.sendDraft.hex);
        refs.sendInput.dataset.preservedText = displayText;
      } else {
        delete refs.sendInput.dataset.rawHex;
        delete refs.sendInput.dataset.preservedText;
      }
      state.sendDraft.text = refs.sendInput.value;
    }
  }

  function normalizeSendInputValue() {
    if (state.settings.sendMode !== 'hex') {
      state.sendDraft.text = refs.sendInput.value;
      state.sendDraft.hex = getTextInputRawHex(refs.sendInput);
      refs.sendInput.dataset.rawHex = state.sendDraft.hex;
      refs.sendInput.dataset.preservedText = refs.sendInput.value;
      return;
    }
    const display = normalizeHexInputElement(refs.sendInput);
    const raw = refs.sendInput.dataset.rawHex || sanitizeHexInputValue(display);
    state.sendDraft.hex = raw;
  }

  function captureSendDraftFromInput() {
    if (!refs.sendInput) return;
    if (state.settings.sendMode === 'hex') {
      state.sendDraft.hex = sanitizeHexInputValue(refs.sendInput.dataset.rawHex || refs.sendInput.value);
      return;
    }
    state.sendDraft.text = refs.sendInput.value;
    state.sendDraft.hex = getTextInputRawHex(refs.sendInput);
  }

  function captureSendContentInputsFromRefs(mode = state.settings.sendMode) {
    if (refs.sendInput) {
      captureSendDraftFromInput();
    }
    refs.autoSendQueue?.querySelectorAll('[data-queue-id]').forEach((row) => {
      const item = state.autoSend.queue.find((entry) => entry.id === row.dataset.queueId);
      const input = row.querySelector('[data-queue-payload]');
      if (item && input) {
        item.payload = mode === 'hex' ? normalizeSendContentInputValue(input) : input.value;
        item.payloadRawHex = mode === 'hex'
          ? sanitizeHexInputValue(input.dataset.rawHex || input.value)
          : getTextInputRawHex(input);
      }
    });
    refs.conditionRuleList?.querySelectorAll('[data-rule-id]').forEach((row) => {
      const rule = state.conditionSend.rules.find((entry) => entry.id === row.dataset.ruleId);
      const input = row.querySelector('[data-rule-response]');
      if (rule && input) {
        rule.response = mode === 'hex' ? normalizeSendContentInputValue(input) : input.value;
        rule.responseRawHex = mode === 'hex'
          ? sanitizeHexInputValue(input.dataset.rawHex || input.value)
          : getTextInputRawHex(input);
      }
    });
    refs.presetSendList?.querySelectorAll('[data-preset-id]').forEach((row) => {
      const item = state.presetSend.items.find((entry) => entry.id === row.dataset.presetId);
      const input = row.querySelector('[data-preset-payload]');
      if (item && input) {
        item.payload = mode === 'hex' ? normalizeSendContentInputValue(input) : input.value;
        item.payloadRawHex = mode === 'hex'
          ? sanitizeHexInputValue(input.dataset.rawHex || input.value)
          : getTextInputRawHex(input);
      }
    });
  }

  function switchSendDisplayMode(nextMode) {
    const previousMode = state.settings.sendMode === 'hex' ? 'hex' : 'ascii';
    if (previousMode === nextMode) return;
    captureSendContentInputsFromRefs(previousMode);
    if (nextMode === 'hex') {
      state.sendDraft.hex = sanitizeHexInputValue(state.sendDraft.hex || textToRawHex(state.sendDraft.text));
    } else {
      state.sendDraft.text = rawHexToText(state.sendDraft.hex);
    }
    state.autoSend.queue.forEach((item) => {
      convertFieldForMode(item, 'payload', 'payloadRawHex', previousMode, nextMode);
    });
    state.conditionSend.rules.forEach((rule) => {
      convertFieldForMode(rule, 'response', 'responseRawHex', previousMode, nextMode);
    });
    state.presetSend.items.forEach((item) => {
      convertFieldForMode(item, 'payload', 'payloadRawHex', previousMode, nextMode);
    });
    state.settings.sendMode = nextMode;
    syncSendInputModeUI();
    renderSendConfigLists();
    scheduleLocalPrefsSave();
  }

  function captureSettingsInputsFromRefs() {
    if (!refs.baudRate) return;
    const serialOptions = syncSerialOptionState(getSerialOpenOptions());
    state.settings.baudRate = String(serialOptions.baudRate);
    state.settings.dataBits = serialOptions.dataBits;
    state.settings.stopBits = serialOptions.stopBits;
    state.settings.parity = serialOptions.parity;
    state.settings.releaseSignalsOnBlur = Boolean(refs.releaseOnBlur?.checked);
    state.settings.flowControl = serialOptions.flowControl;
    state.settings.signalDtr = Boolean(refs.signalDtr?.checked);
    state.settings.signalRts = Boolean(refs.signalRts?.checked);
    state.settings.signalBreak = Boolean(refs.signalBreak?.checked);
    state.settings.autoReconnect = Boolean(refs.autoReconnect?.checked);
    state.settings.rxDisplayMode = refs.rxDisplayMode?.checked ? 'hex' : 'text';
    state.settings.textEncoding = refs.textEncoding?.value || state.settings.textEncoding;
    state.settings.appendTimestamp = Boolean(refs.appendTimestamp?.checked);
    state.settings.sendMode = refs.sendMode?.checked ? 'hex' : 'ascii';
    state.settings.newlineMode = refs.newlineMode?.value || state.settings.newlineMode;
    state.settings.appendNewline = Boolean(refs.appendNewline?.checked);
  }

  function buildPayloadFrame(payload, sendOptions = state.settings) {
    const displayTextOverride = typeof sendOptions?.displayTextOverride === 'string'
      ? sendOptions.displayTextOverride
      : null;
    const options = normalizeSendOptions(sendOptions);
    let bytes;
    let displayText = String(payload ?? '');
    if (options.sendMode === 'hex') {
      bytes = parseHexString(displayText);
      displayText = displayTextOverride ?? bytesToHex(bytes);
    } else {
      const normalizedText = normalizeTextLineEndings(displayText, options.newlineMode);
      bytes = encodeText(normalizedText, options.textEncoding);
      displayText = displayTextOverride ?? displayText;
    }
    if (options.appendNewline) {
      bytes = appendLineEnding(bytes, options.newlineMode);
    }
    return { bytes, displayText, options };
  }

  function applyParserGraphStateSnapshot(snapshot) {
    if (!snapshot) return;
    state.parserMode = snapshot.mode === 'binary' ? 'binary' : 'text';
    state.parser.textRule = String(snapshot.text?.rule || snapshot.textRule || '');
    // Restored, not typed: treat it as replaceable by a simulator script so a
    // saved suggestion does not block applying the matching one.
    state.parser.textRuleIsAuto = true;
    state.parser.binarySchema = Array.isArray(snapshot.binary?.rows)
      ? snapshot.binary.rows.map((row) => normalizeBinarySchemaRowFromConfig(row))
      : Array.isArray(snapshot.binarySchema)
        ? snapshot.binarySchema.map((row) => normalizeBinarySchemaRowFromConfig(row))
        : [];
    ensureBinarySchemaRow();
    state.charts = Array.isArray(snapshot.charts)
      ? snapshot.charts.map((chart) => hydrateChartFromConfig(chart))
      : Array.isArray(snapshot.items)
        ? snapshot.items.map((chart) => hydrateChartFromConfig(chart))
        : [];
    state.ui.chartPickerOpenId = '';
    invalidateDerivedCaches();
    syncParserInputs();
  }

  function snapshotTimelineGraphConfig() {
    return {
      version: 2,
      userConfig: buildLocalPrefsSnapshot()
    };
  }

  function applyTimelineGraphConfig(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    applyUserConfigSnapshot(snapshot.userConfig, { persist: false });
  }

  function resolveTheme(theme) {
    if (theme === 'system') return browserThemeQuery.matches ? 'dark' : 'light';
    return theme;
  }

  function applyTheme() {
    var resolved = resolveTheme(state.theme);
    document.documentElement.classList.toggle('theme-dark', resolved === 'dark');
    appEl.classList.toggle('theme-dark', resolved === 'dark');
    updateTerminalTheme();
    if (refs.themeGroup) {
      refs.themeGroup.classList.remove('pos-light', 'pos-dark');
      if (state.theme === 'light') refs.themeGroup.classList.add('pos-light');
      else if (state.theme === 'dark') refs.themeGroup.classList.add('pos-dark');
      refs.themeOpts.forEach(function(opt) {
        opt.classList.toggle('is-active', opt.dataset.theme === state.theme);
      });
    }
    window.__setSerialCanvasFavicon?.();
    refitTerminal();
  }

  /* Corner radius. One integer drives every radius in the stylesheet via
     --radius-scale; `data-corner` on <html> and <body> selects the value.
     bootstrap.js sets the same attribute from the saved preference before the
     first paint, so this only has to keep it in sync afterwards. */
  function applyCornerRadius() {
    var value = CORNER_SETTINGS.indexOf(state.cornerRadius) >= 0 ? state.cornerRadius : 'square';
    document.documentElement.setAttribute('data-corner', value);
    appEl.setAttribute('data-corner', value);
    if (refs.cornerGroup) {
      // Both halves of the pattern, same as applyTheme(): the pos-* class moves
      // the sliding indicator, is-active marks the label. Setting only
      // is-active leaves the indicator parked at the first stop.
      refs.cornerGroup.classList.remove('pos-light', 'pos-dark');
      if (value === 'soft') refs.cornerGroup.classList.add('pos-light');
      else if (value === 'round') refs.cornerGroup.classList.add('pos-dark');
      refs.cornerOpts.forEach(function(opt) {
        opt.classList.toggle('is-active', opt.dataset.corner === value);
      });
    }
    refitTerminal();
  }

  function syncThemeFromBrowser() {
    if (state.theme === 'system') {
      applyTheme();
      renderCharts();
    }
  }

  if (typeof browserThemeQuery.addEventListener === 'function') {
    browserThemeQuery.addEventListener('change', syncThemeFromBrowser);
  } else if (typeof browserThemeQuery.addListener === 'function') {
    browserThemeQuery.addListener(syncThemeFromBrowser);
  }

  function handleThemeChange(theme) {
    state.theme = theme;
    applyTheme();
    renderCharts();
    scheduleLocalPrefsSave();
  }

  function toggleTheme() {
    var next = state.theme === 'system' ? 'light' : state.theme === 'light' ? 'dark' : 'system';
    handleThemeChange(next);
  }

  function handleCornerRadiusChange(value) {
    state.cornerRadius = CORNER_SETTINGS.indexOf(value) >= 0 ? value : 'square';
    applyCornerRadius();
    scheduleLocalPrefsSave();
  }

  function cycleCornerRadius() {
    var index = CORNER_SETTINGS.indexOf(state.cornerRadius);
    handleCornerRadiusChange(CORNER_SETTINGS[(index + 1) % CORNER_SETTINGS.length]);
  }

  /* --------------------------------------------------------------------------
   * i18n. The authored UI language is Chinese, so English is keyed by the
   * Chinese source text (dictionary in app.lang.js). A missing key therefore
   * degrades to Chinese - a visible gap, never a raw key on screen.
   * Two mechanisms, deliberately compatible:
   *   t()              for strings produced by JavaScript
   *   translateDom()   for the static markup, which is only ever Chinese
   * Text nodes are only taken over when they contain CJK, so a node already
   * rendered in English by t() can never be mistaken for its own source.
   * ------------------------------------------------------------------------*/
  const I18N_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'data-tip', 'data-short', 'data-hover'];
  const I18N_SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };
  const I18N_VALID_LOCALES = ['zh', 'en', 'system'];
  const i18nTextSources = new WeakMap();
  const i18nAttrSources = new WeakMap();

  function i18nHasCjk(text) {
    return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
  }

  function resolveLocale() {
    if (state.locale === 'zh' || state.locale === 'en') return state.locale;
    if (typeof window.__serialWebResolveLocale === 'function') {
      return window.__serialWebResolveLocale(state.locale);
    }
    return (/^zh\b/i.test(navigator.language || '') ? 'zh' : 'en');
  }

  function i18nDictionary() {
    return resolveLocale() === 'en' ? (window.SERIALWEB_I18N && window.SERIALWEB_I18N.en) || null : null;
  }

  function tr(source) {
    const dict = i18nDictionary();
    if (!dict) return source;
    // Markup and long template literals wrap, so a lookup that misses the raw
    // text still gets a chance against the whitespace-collapsed form.
    let value = dict[source];
    if (typeof value !== 'string') value = dict[source.replace(/\s+/g, ' ').trim()];
    return typeof value === 'string' ? value : source;
  }

  function t(source, vars) {
    const text = tr(String(source));
    if (!vars) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
    ));
  }

  function translateTextNode(node) {
    let source = i18nTextSources.get(node);
    if (source === undefined) {
      if (!i18nHasCjk(node.nodeValue)) return;
      source = node.nodeValue;
      i18nTextSources.set(node, source);
    }
    const next = tr(source);
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function translateElementAttributes(el) {
    const cached = i18nAttrSources.get(el);
    for (const attr of I18N_ATTRIBUTES) {
      const current = el.getAttribute(attr);
      if (current === null) continue;
      let source = cached ? cached.get(attr) : undefined;
      if (source === undefined) {
        if (!i18nHasCjk(current)) continue;
        source = current;
        if (cached) cached.set(attr, source);
        else i18nAttrSources.set(el, new Map([[attr, source]]));
      }
      const next = tr(source);
      if (current !== next) el.setAttribute(attr, next);
    }
  }

  /* ---- Tooltip singleton -------------------------------------------------
     One box on <body>, driven by delegation, replacing both the native title
     tooltip and the per-element CSS bubble. It exists because neither of those
     can host a link, and because a native tooltip cannot be styled at all.

     Elements opt in with data-tip="..." (preferred) or title="...". A tip that
     starts with "docs:" also renders a "Learn more" link, using the value as a
     key into the doc set - the same trick the reference dashboard uses.

     Built with createElement/textContent throughout, never innerHTML: tip text
     comes from attributes, and there is no reason to hand the parser any of it. */
  const TOOLTIP_HIDE_DELAY_MS = 180;
  let tooltipEl = null;
  let tooltipArrow = null;
  let tooltipHideTimer = 0;
  let tooltipAnchor = null;

  function ensureTooltipEl() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'sw-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.hidden = true;
    tooltipArrow = document.createElement('div');
    tooltipArrow.className = 'sw-tooltip-arrow';
    tooltipEl.appendChild(tooltipArrow);
    const body = document.createElement('div');
    body.className = 'sw-tooltip-body';
    tooltipEl.appendChild(body);
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function tooltipTextFor(target) {
    const tip = target.getAttribute('data-tip');
    if (tip) return tip;
    // While a tip is showing the trigger carries no title; the backup is the
    // only place the text still lives.
    return target.getAttribute('title') || target.getAttribute('data-tip-swapped-title') || '';
  }

  function positionTooltip(target) {
    const box = ensureTooltipEl();
    const rect = target.getBoundingClientRect();
    const margin = 8;
    // Measure after content is set, then place: below by default, flipped above
    // when there is no room, clamped horizontally to the viewport.
    box.hidden = false;
    const size = box.getBoundingClientRect();
    let top = rect.bottom + margin;
    let flipped = false;
    if (top + size.height > window.innerHeight - margin && rect.top - margin - size.height > 0) {
      top = rect.top - margin - size.height;
      flipped = true;
    }
    let left = rect.left + rect.width / 2 - size.width / 2;
    left = Math.min(Math.max(margin, left), window.innerWidth - size.width - margin);
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
    box.classList.toggle('is-flipped', flipped);
    const arrow = tooltipArrow;
    if (arrow) {
      // Keep the arrow on the trigger, clamped inside the box.
      const center = rect.left + rect.width / 2 - left;
      arrow.style.left = Math.round(Math.min(Math.max(14, center), size.width - 14)) + 'px';
      arrow.classList.toggle('is-top', flipped);
    }
  }

  function showTooltip(target) {
    if (!target) return false;
    const text = tooltipTextFor(target);
    if (!text) return false;
    const box = ensureTooltipEl();
    const body = box.querySelector('.sw-tooltip-body');
    body.textContent = '';
    const lines = text.split('\n');
    const main = document.createElement('div');
    main.className = 'sw-tooltip-text';
    main.textContent = lines.join('\n');
    body.appendChild(main);
    const docs = target.getAttribute('data-tip-docs');
    if (docs) {
      const foot = document.createElement('a');
      foot.className = 'sw-tooltip-link';
      foot.href = docs;
      foot.target = '_blank';
      foot.rel = 'noopener noreferrer';
      foot.textContent = t('了解更多');
      body.appendChild(foot);
    }
    tooltipAnchor = target;
    positionTooltip(target);
    return true;
  }

  function hideTooltip() {
    if (tooltipHideTimer) {
      clearTimeout(tooltipHideTimer);
      tooltipHideTimer = 0;
    }
    if (tooltipEl) tooltipEl.hidden = true;
    tooltipAnchor = null;
  }

  function scheduleTooltipHide() {
    if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
    tooltipHideTimer = window.setTimeout(hideTooltip, TOOLTIP_HIDE_DELAY_MS);
  }

  function cancelTooltipHide() {
    if (tooltipHideTimer) {
      clearTimeout(tooltipHideTimer);
      tooltipHideTimer = 0;
    }
  }

  /* The trigger must ignore its own title, otherwise the native tooltip shows
     on top of this one a moment later. Restored on hide so the attribute is
     still available for anything reading it. */
  function installTooltip() {
    ensureTooltipEl();
    const suppressTitle = (target) => {
      const pending = target.getAttribute('data-tip-swapped-title');
      // A previous hover may have removed the title without restoring it (an
      // element removed mid-hover, a cancelled mouseout). Keep the first backup
      // rather than overwriting it with nothing.
      if (!pending) {
        const title = target.getAttribute('title');
        if (title) target.setAttribute('data-tip-swapped-title', title);
      }
      target.removeAttribute('title');
    };
    const restoreTitle = (target) => {
      const title = target.getAttribute('data-tip-swapped-title');
      if (title) {
        target.setAttribute('title', title);
        target.removeAttribute('data-tip-swapped-title');
      }
    };
    /* The selector must include the backup attribute: while a tip is showing, the
       trigger has no title, so matching on [title] alone would stop finding it
       on the next hover. */
    const resolve = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return null;
      return target.closest('[data-tip],[title],[data-tip-swapped-title]');
    };
    document.addEventListener('mouseover', (event) => {
      const target = resolve(event);
      if (!target || target === tooltipAnchor) return;
      if (target.closest('.sw-tooltip')) return;
      cancelTooltipHide();
      // Render BEFORE suppressing the title: suppressTitle() removes the
      // attribute the text was just read from, so doing it first would leave
      // the element permanently without a tooltip when showTooltip declines.
      if (showTooltip(target)) suppressTitle(target);
    });
    document.addEventListener('mouseout', (event) => {
      const target = resolve(event);
      if (!target || target !== tooltipAnchor) return;
      // Moving onto the tooltip itself must not dismiss it - the link needs to
      // be clickable.
      const to = event.relatedTarget;
      if (to && typeof to.closest === 'function' && to.closest('.sw-tooltip')) return;
      restoreTitle(target);
      scheduleTooltipHide();
    });
    document.addEventListener('focusin', (event) => {
      const target = resolve(event);
      if (!target) return;
      cancelTooltipHide();
      if (showTooltip(target)) suppressTitle(target);
    });
    document.addEventListener('focusout', (event) => {
      const target = resolve(event);
      if (!target || target !== tooltipAnchor) return;
      restoreTitle(target);
      hideTooltip();
    });
    tooltipEl.addEventListener('mouseenter', cancelTooltipHide);
    tooltipEl.addEventListener('mouseleave', hideTooltip);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideTooltip();
    });
    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
  }

  function translateDom(root = document.body) {
    if (!root || !root.ownerDocument) return;
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // data-i18n-off marks device data: the node itself is still eligible
        // (its aria-label is UI), but nothing below it is.
        if (node.nodeType === 1 && I18N_SKIP_TAGS[node.tagName]) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('[data-i18n-off]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === 3) translateTextNode(node);
      else translateElementAttributes(node);
      node = walker.nextNode();
    }
  }

  /* Renderers replace DOM subtrees and set tooltips after a locale switch, so
   * freshly written Chinese would otherwise stay untranslated until the next
   * switch. Watching childList plus the translatable attributes is enough: our
   * own edits write the value back unchanged, and an attribute write with an
   * identical value produces no mutation record, so this cannot loop. */
  let i18nWatchFrame = 0;
  const i18nWatchedNodes = new Set();

  function flushI18nDomWatch() {
    i18nWatchFrame = 0;
    const nodes = Array.from(i18nWatchedNodes);
    i18nWatchedNodes.clear();
    if (resolveLocale() !== 'en') return;
    nodes.forEach((node) => {
      if (node.isConnected) translateDom(node);
    });
  }

  function startI18nDomWatcher() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) i18nWatchedNodes.add(node);
            else if (node.nodeType === 3 && node.parentElement) i18nWatchedNodes.add(node.parentElement);
          }
        } else if (mutation.target.nodeType === 1) {
          i18nWatchedNodes.add(mutation.target);
        }
      }
      if (i18nWatchedNodes.size && !i18nWatchFrame) {
        i18nWatchFrame = requestAnimationFrame(flushI18nDomWatch);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: I18N_ATTRIBUTES });
  }

  function applyLanguage() {
    const locale = resolveLocale();
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    translateDom(document.body);
    if (refs.langGroup) {
      refs.langGroup.classList.remove('pos-second', 'pos-third');
      if (state.locale === 'en') refs.langGroup.classList.add('pos-second');
      else if (state.locale === 'system') refs.langGroup.classList.add('pos-third');
      refs.langOpts.forEach((opt) => {
        opt.classList.toggle('is-active', opt.dataset.locale === state.locale);
      });
    }
    return locale;
  }

  function setLocale(next) {
    if (!I18N_VALID_LOCALES.includes(next) || next === state.locale) return;
    state.locale = next;
    applyLanguage();
    renderTranslatedViews();
    scheduleLocalPrefsSave();
  }

  /* --------------------------------------------------------------------------
   * Font availability. Every stack offered by the terminal font picker ends in
   * `monospace`, so an uninstalled family renders exactly like the default and
   * reads as a failed switch. Measure instead of guessing: a family is present
   * only when it changes the probe width against BOTH generic baselines, since
   * it could coincidentally match one of them.
   * ------------------------------------------------------------------------*/
  const GENERIC_FONT_FAMILIES = ['monospace', 'sans-serif', 'serif', 'cursive', 'fantasy', 'system-ui', 'ui-monospace'];
  const fontAvailabilityCache = new Map();
  let fontProbeElement = null;

  function measureFontProbeWidth(font) {
    if (!fontProbeElement) {
      fontProbeElement = document.createElement('span');
      fontProbeElement.setAttribute('data-i18n-off', '');
      fontProbeElement.setAttribute('aria-hidden', 'true');
      fontProbeElement.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;'
        + 'white-space:pre;font-variant-ligatures:none;';
      document.body.appendChild(fontProbeElement);
    }
    fontProbeElement.style.font = font;
    fontProbeElement.textContent = 'iiiiWWMM00@#%&|/\\_';
    const width = fontProbeElement.getBoundingClientRect().width;
    fontProbeElement.textContent = '';
    return width;
  }

  function hasFontFamily(family) {
    const key = family.toLowerCase();
    if (fontAvailabilityCache.has(key)) return fontAvailabilityCache.get(key);
    const quoted = `"${family.replace(/"/g, '')}"`;
    const available = ['monospace', 'sans-serif'].some((baseline) => (
      measureFontProbeWidth(`12px ${baseline}`) !== measureFontProbeWidth(`12px ${quoted}, ${baseline}`)
    ));
    fontAvailabilityCache.set(key, available);
    return available;
  }

  function fontStackAvailable(cssStack) {
    const families = String(cssStack || '').split(',')
      .map((part) => part.trim().replace(/^["']|["']$/g, ''))
      .filter((part) => part && !GENERIC_FONT_FAMILIES.includes(part.toLowerCase()));
    return families.length > 0 && families.some(hasFontFamily);
  }

  function shouldEnhanceSelect(select) {
    if (!select || select.tagName !== 'SELECT') return false;
    if (select.id === 'timeline-select') return false;
    if (select.classList.contains('hidden')) return false;
    if (select.multiple) return false;
    const size = Number(select.getAttribute('size'));
    if (Number.isFinite(size) && size > 1) return false;
    return true;
  }

  function closeCustomSelectMenus(exceptShell = null) {
    document.querySelectorAll('.custom-select.open').forEach((shell) => {
      if (exceptShell && shell === exceptShell) return;
      shell.classList.remove('open');
      const trigger = shell.querySelector('.custom-select-trigger');
      const menu = shell._customSelectMenu || shell.querySelector('.custom-select-menu');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (menu) menu.classList.remove('open');
    });
  }

  function disposeCustomSelects(root = document) {
    root.querySelectorAll?.('.custom-select').forEach((shell) => {
      const menu = shell._customSelectMenu || shell.querySelector('.custom-select-menu');
      if (menu && menu.parentElement === document.body) {
        menu.remove();
      }
      shell._customSelectMenu = null;
    });
  }

  function getCustomSelectMenu(shell) {
    return shell?._customSelectMenu || shell?.querySelector('.custom-select-menu') || null;
  }

  function positionCustomSelectMenu(shell) {
    const trigger = shell?.querySelector('.custom-select-trigger');
    const menu = getCustomSelectMenu(shell);
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const viewportGap = 12;
    const offset = 8;
    const belowSpace = window.innerHeight - rect.bottom - viewportGap;
    const aboveSpace = rect.top - viewportGap;
    const preferTop = belowSpace < 180 && aboveSpace > belowSpace;
    const maxHeight = Math.max(120, Math.min(240, preferTop ? aboveSpace - offset : belowSpace - offset));
    const naturalHeight = menu.scrollHeight || 0;
    const menuHeight = Math.min(naturalHeight || maxHeight, maxHeight);
    const top = preferTop
      ? Math.max(viewportGap, rect.top - offset - menuHeight)
      : Math.min(window.innerHeight - viewportGap - menuHeight, rect.bottom + offset);
    menu.style.top = `${Math.round(top)}px`;
    // Fit the menu to the widest option so names never wrap. Layout-based
    // measurement (scrollWidth) is unreliable here because options use
    // width:100%, so measure text widths via canvas instead.
    const naturalWidth = measureCustomSelectMenuWidth(menu);
    const widthCap = Math.min(400, window.innerWidth - 24);
    const menuWidth = Math.min(Math.max(Math.ceil(rect.width), naturalWidth), widthCap);
    menu.style.width = `${menuWidth}px`;
    // Keep the menu fully inside the viewport horizontally.
    const left = Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - 8 - menuWidth));
    menu.style.left = `${left}px`;
    menu.style.maxHeight = `${Math.round(maxHeight)}px`;
    menu.dataset.placement = preferTop ? 'top' : 'bottom';
  }

  // Measure the pixel width of the widest option label (canvas text metrics).
  // Returns a value that already includes option padding (2x10), menu padding
  // (2x8), borders and a small buffer.
  function measureCustomSelectMenuWidth(menu) {
    const canvas = measureCustomSelectMenuWidth._canvas
      || (measureCustomSelectMenuWidth._canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    let widest = 0;
    menu.querySelectorAll('.custom-select-option').forEach((option) => {
      const style = getComputedStyle(option);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      widest = Math.max(widest, context.measureText(option.textContent.trim()).width);
    });
    return widest > 0 ? Math.ceil(widest) + 42 : 0;
  }

  function syncOpenCustomSelectMenus() {
    document.querySelectorAll('.custom-select.open').forEach((shell) => {
      positionCustomSelectMenu(shell);
    });
  }

  function syncCustomSelectShell(shell, select) {
    if (!shell || !select) return;
    const trigger = shell.querySelector('.custom-select-trigger');
    const label = shell.querySelector('.custom-select-label');
    const menu = getCustomSelectMenu(shell);
    const selectedOption = select.options[select.selectedIndex] || select.options[0] || null;
    const labelText = selectedOption ? selectedOption.textContent.trim() : '';
    shell.classList.toggle('compact', select.classList.contains('compact-select'));
    shell.classList.toggle('is-disabled', !!select.disabled);
    trigger.disabled = !!select.disabled;
    label.textContent = labelText;
    trigger.title = labelText;
    menu.innerHTML = '';
    Array.from(select.options).forEach((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'custom-select-option';
      if (option.selected) item.classList.add('active');
      item.disabled = !!option.disabled;
      if (option.title) item.title = option.title;
      item.dataset.selectIndex = String(index);
      item.textContent = option.textContent;
      menu.appendChild(item);
    });
  }

  function toggleCustomSelect(shell) {
    const willOpen = !shell.classList.contains('open');
    closeBaudRateMenu();
    closeTimelinePicker();
    document.querySelectorAll('.floating-menu.open').forEach((menu) => menu.classList.remove('open'));
    closeCustomSelectMenus(willOpen ? shell : null);
    shell.classList.toggle('open', willOpen);
    const trigger = shell.querySelector('.custom-select-trigger');
    const menu = getCustomSelectMenu(shell);
    if (trigger) trigger.setAttribute('aria-expanded', String(willOpen));
    if (menu) {
      menu.classList.toggle('open', willOpen);
      if (willOpen) {
        positionCustomSelectMenu(shell);
      }
    }
  }

  function ensureCustomSelect(select) {
    if (!shouldEnhanceSelect(select)) return;
    let shell = select.parentElement && select.parentElement.classList.contains('custom-select')
      ? select.parentElement
      : null;

    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'custom-select';
      if (select.id) shell.classList.add(`select-${select.id}`);
      select.parentNode.insertBefore(shell, select);
      shell.appendChild(select);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'custom-select-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      const label = document.createElement('span');
      label.className = 'custom-select-label';

      const caret = document.createElement('span');
      caret.className = 'custom-select-caret';
      caret.setAttribute('aria-hidden', 'true');
      caret.textContent = '▾';

      const menu = document.createElement('div');
      menu.className = 'floating-menu custom-select-menu';
      document.body.appendChild(menu);
      shell._customSelectMenu = menu;

      trigger.append(label, caret);
      shell.append(trigger);

      select.classList.add('custom-select-native');
      select.tabIndex = -1;

      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        if (select.disabled) return;
        toggleCustomSelect(shell);
      });

      menu.addEventListener('click', (event) => {
        const optionButton = event.target.closest('[data-select-index]');
        if (!optionButton || optionButton.disabled) return;
        event.stopPropagation();
        const nextIndex = Number(optionButton.dataset.selectIndex);
        if (!Number.isFinite(nextIndex)) {
          shell.classList.remove('open');
          return;
        }
        if (select.selectedIndex !== nextIndex) {
          select.selectedIndex = nextIndex;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          syncCustomSelectShell(shell, select);
        }
        shell.classList.remove('open');
        menu.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      });

      select.addEventListener('change', () => {
        syncCustomSelectShell(shell, select);
      });
    }

    const detachedMenu = getCustomSelectMenu(shell);
    if (detachedMenu && detachedMenu.parentElement !== document.body) {
      document.body.appendChild(detachedMenu);
      shell._customSelectMenu = detachedMenu;
    }
    syncCustomSelectShell(shell, select);
  }

  function syncCustomSelects(root = document) {
    root.querySelectorAll('select').forEach((select) => {
      ensureCustomSelect(select);
    });
    disableSpellcheck(root);
  }

  function disableSpellcheck(root = document) {
    const apply = (element) => {
      element.setAttribute('spellcheck', 'false');
      element.spellcheck = false;
    };
    if (root instanceof Element && root.matches('input, textarea, [contenteditable]')) {
      apply(root);
    }
    root.querySelectorAll?.('input, textarea, [contenteditable]').forEach(apply);
  }

  function isCompactSingleViewport() {
    return window.innerWidth <= 720;
  }

  function closeBaudRateMenu() {
    refs.baudRateAnchor.classList.remove('open');
    refs.baudRatePresetMenu.classList.remove('open');
  }

  function toggleBaudRateMenu() {
    const willOpen = !refs.baudRatePresetMenu.classList.contains('open');
    closeTimelinePicker();
    closeCustomSelectMenus();
    document.querySelectorAll('.floating-menu.open').forEach((menu) => {
      if (menu !== refs.baudRatePresetMenu) menu.classList.remove('open');
    });
    refs.baudRateAnchor.classList.toggle('open', willOpen);
    refs.baudRatePresetMenu.classList.toggle('open', willOpen);
  }

  function syncCompactLayoutState() {
    const compact = isCompactSingleViewport();
    state.ui.compactSingle = compact;
    if (!compact) {
      state.ui.compactConfigOpen = false;
    }

    appEl.classList.toggle('compact-single', compact);
    appEl.classList.toggle('sidebar-collapsed', !compact && state.ui.sidebarCollapsed);
    appEl.classList.toggle('compact-config-open', compact && state.ui.compactConfigOpen);
    appEl.classList.toggle('config-collapsed', false);

    if (refs.topbar) {
      const top = Math.round(refs.topbar.getBoundingClientRect().bottom + 12);
      document.documentElement.style.setProperty('--compact-float-top', `${top}px`);
    }

    syncOverlayBackdropState();
    refs.serialModeBtn?.classList.toggle('is-active', !state.layoutExpanded);
    refs.parserModeBtn?.classList.toggle('is-active', state.layoutExpanded);
    refs.logoModeSwitch?.classList.toggle('parser-active', state.layoutExpanded);
  }

  function setCompactConfigOpen(open) {
    if (!state.ui.compactSingle) {
      state.ui.compactConfigOpen = false;
      syncCompactLayoutState();
      return;
    }
    if (open) {
      closeTimelinePicker();
    }
    state.ui.compactConfigOpen = open;
    syncCompactLayoutState();
    if (open && state.layoutExpanded) {
      requestAnimationFrame(() => requestAnimationFrame(forceTerminalToLatest));
    }
  }

  function toggleSidebarCollapse() {
    if (state.ui.compactSingle) {
      setCompactConfigOpen(!state.ui.compactConfigOpen);
      return;
    }
    state.ui.compactConfigOpen = false;
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    syncCompactLayoutState();
    scheduleLocalPrefsSave();
  }

  function toggleLayoutMode() {
    state.layoutExpanded = !state.layoutExpanded;
    if (!state.ui.compactSingle) {
      state.ui.compactConfigOpen = false;
    }
    applyLayout();
    scheduleRefresh();
    scheduleLocalPrefsSave();
  }

  /* Panel placement per layout mode.

     The rail is device connection management and nothing else.

     The parse view owns everything derived from the byte stream: how to decode
     it, a source to decode when no device is attached, the decoded values, and
     the charts. Those four are one pipeline and they now live together in one
     column, in that order. The simulator was briefly in the rail beside the
     connection, which was defensible — it is a data source — but it split
     "generate bytes" and "decode bytes" across two screens, and the rail was
     carrying a panel that only matters while parsing.

     The monitor view is the byte stream itself: log, terminal, send. The parse
     panel is not in it at all, rather than present-but-partly-hidden, so there
     is exactly one place to look for anything parse-related. */
  function arrangeWorkspacePanels() {
    const {
      leftColumn,
      rightColumn,
      expandedLeftTop,
      configPanel,
      parserPanel,
      chartsPanel,
      monitorPanel
    } = refs;
    if (!leftColumn || !rightColumn || !expandedLeftTop || !configPanel || !parserPanel || !chartsPanel || !monitorPanel) {
      return;
    }

    expandedLeftTop.appendChild(configPanel);
    leftColumn.appendChild(expandedLeftTop);
    if (state.layoutExpanded) {
      // Graph mode hides the monitor (see style.css), so the parser panel and
      // the charts are the whole right column.
      rightColumn.appendChild(parserPanel);
      rightColumn.appendChild(chartsPanel);
    } else {
      rightColumn.appendChild(monitorPanel);
    }
  }

  /* The parse panel belongs to the parse view.

     The CSS keys off `layout-expanded` (see the .parser-panel rule), so this
     only has to do the two things CSS cannot: keep the settings collapse
     consistent with the persisted state, and hide the monitor chip, which is
     the one piece of simulator UI that crosses over into the monitor view. */
  function applyLayoutModePanels() {
    applySimulationMonitorChip();
    applyParserPanelOpen();
    applySimulatorPanelOpen();
  }

  function applyLayout(animate = true) {
    arrangeWorkspacePanels();
    appEl.classList.toggle('layout-expanded', state.layoutExpanded);
    refs.layoutToggleLabel.textContent = t('图形解析模式');
    refs.layoutToggleBtn.title = t('图形解析模式');
    if (animate && refs.layoutToggleBtn) {
      refs.layoutToggleBtn.animate([
        { transform: 'scale(0.98)' },
        { transform: 'scale(1)' }
      ], { duration: 180, easing: 'ease-out' });
    }
    // After the class is on the body, so the panel body and the mode switch
    // hide/show in the same frame as the rest of the mode change.
    applyLayoutModePanels();
    syncCompactLayoutState();
    renderCharts();
    requestAnimationFrame(() => {
      refreshParserResultsExpansionAvailability();
      refitTerminal();
    });
  }

  function updateParserModeUI() {
    refs.parserModeSwitch?.classList.toggle('parser-active', state.parserMode === 'binary');
    document.querySelectorAll('[data-parser-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.parserMode === state.parserMode);
    });
    refs.textParserPane.classList.toggle('hidden', state.parserMode !== 'text');
    refs.binaryParserPane.classList.toggle('hidden', state.parserMode !== 'binary');
  }

  /* Parse-settings collapse.

     The body is configuration only — the simulator and the live results sit
     outside it — so collapsing hides the rule and the structure table and
     nothing else. The panel itself is parse-view-only now (see
     applyLayoutModePanels), so this no longer has to reason about the view:
     what is left is the user's own choice, and it is remembered. */
  function applyParserPanelOpen() {
    const open = Boolean(state.ui.parserPanelOpen);
    refs.parserPanelBody?.classList.toggle('hidden', !open);
    refs.parserPanelToggle?.setAttribute('aria-expanded', String(open));
    const label = refs.parserPanelToggle?.querySelector('.parser-panel-toggle-text');
    if (label) label.textContent = open ? t('收起') : t('展开');
  }

  function toggleParserPanel() {
    state.ui.parserPanelOpen = !state.ui.parserPanelOpen;
    applyParserPanelOpen();
  }

  /* Simulator collapse.

     Same control as the parser panel, for the same reason: it is one of the
     three parts of the parse view and it costs vertical space. Open by
     default — this part exists to be looked at (what is about to be sent, in
     what shape), and a part that starts closed is a part nobody finds. */
  function applySimulatorPanelOpen() {
    const open = Boolean(state.ui.simulatorPanelOpen);
    refs.simulatorPanelBody?.classList.toggle('hidden', !open);
    refs.simulatorPanelToggle?.setAttribute('aria-expanded', String(open));
    const label = refs.simulatorPanelToggle?.querySelector('.parser-panel-toggle-text');
    if (label) label.textContent = open ? t('收起') : t('展开');
  }

  function toggleSimulatorPanel() {
    state.ui.simulatorPanelOpen = !state.ui.simulatorPanelOpen;
    applySimulatorPanelOpen();
  }

  function toggleMenu(menuEl) {
    const willOpen = !menuEl.classList.contains('open');
    closeTimelinePicker();
    closeBaudRateMenu();
    closeCustomSelectMenus();
    if (!willOpen) {
      setPendingUserConfigAction('');
    }
    document.querySelectorAll('.floating-menu.open').forEach((menu) => {
      if (menu !== menuEl) menu.classList.remove('open');
    });
    menuEl.classList.toggle('open', willOpen);
    syncOverlayBackdropState();
  }

  function syncOverlayBackdropState() {
    const pickerOpen = refs.timelineRibbonShell?.classList.contains('picker-open');
    const systemMenuOpen = refs.systemMenu?.classList.contains('open');
    const showBackdrop = Boolean(state.ui.compactConfigOpen || pickerOpen || systemMenuOpen);
    appEl.classList.toggle('ui-backdrop-open', showBackdrop);
    refs.mobileConfigBackdrop.setAttribute('aria-hidden', showBackdrop ? 'false' : 'true');
  }

  function closeTimelinePicker() {
    refs.timelineRibbonShell.classList.remove('picker-open');
    if (state.ui.timelineExportOpenId) {
      state.ui.timelineExportOpenId = null;
      renderTimelineSelect();
    }
    syncOverlayBackdropState();
  }

  function toggleTimelinePicker() {
    const willOpen = !refs.timelineRibbonShell.classList.contains('picker-open');
    closeBaudRateMenu();
    closeCustomSelectMenus();
    document.querySelectorAll('.floating-menu.open').forEach((menu) => menu.classList.remove('open'));
    if (!willOpen) {
      closeTimelinePicker();
      return;
    }
    if (state.ui.compactSingle && state.ui.compactConfigOpen) {
      state.ui.compactConfigOpen = false;
      syncCompactLayoutState();
    }
    renderTimelineSelect();
    refs.timelineRibbonShell.classList.add('picker-open');
    syncOverlayBackdropState();
  }

  function openVersionModal() {
    refs.versionModalBackdrop?.classList.add('open');
    refs.versionModalBackdrop?.setAttribute('aria-hidden', 'false');
    document.querySelectorAll('.floating-menu.open').forEach((menu) => menu.classList.remove('open'));
    syncOverlayBackdropState();
    refs.versionModalClose?.focus();
  }

  /* ---- Shortcut sheet -----------------------------------------------------
     Rendered from SHORTCUT_GROUPS so the list always matches the dispatcher.
     Built with DOM calls and textContent, never innerHTML: the strings are
     authored, but there is no reason to hand the parser any of them. */
  function renderShortcutSheet() {
    var host = refs.shortcutGroups;
    if (!host) return;
    host.textContent = '';
    SHORTCUT_GROUPS.forEach(function(group) {
      var section = document.createElement('section');
      section.className = 'shortcut-group';
      var title = document.createElement('div');
      title.className = 'shortcut-group-title';
      title.textContent = t(group.title);
      section.appendChild(title);
      group.items.forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'shortcut-row';
        row.dataset.shortcutId = item.id;
        var keys = document.createElement('div');
        keys.className = 'shortcut-keys';
        item.keys.forEach(function(part) {
          var kbd = document.createElement('kbd');
          kbd.textContent = part;
          keys.appendChild(kbd);
        });
        var desc = document.createElement('div');
        desc.className = 'shortcut-desc';
        desc.textContent = t(item.desc);
        if (item.scope) {
          var scope = document.createElement('span');
          scope.className = 'shortcut-scope';
          scope.textContent = t(item.scope);
          desc.appendChild(scope);
        }
        row.appendChild(keys);
        row.appendChild(desc);
        section.appendChild(row);
      });
      host.appendChild(section);
    });
  }

  function openShortcutModal() {
    renderShortcutSheet();
    refs.shortcutModalBackdrop?.classList.add('open');
    refs.shortcutModalBackdrop?.setAttribute('aria-hidden', 'false');
    document.querySelectorAll('.floating-menu.open').forEach((menu) => menu.classList.remove('open'));
    syncOverlayBackdropState();
    refs.shortcutModalClose?.focus();
  }

  function closeShortcutModal() {
    refs.shortcutModalBackdrop?.classList.remove('open');
    refs.shortcutModalBackdrop?.setAttribute('aria-hidden', 'true');
  }

  function isShortcutModalOpen() {
    return Boolean(refs.shortcutModalBackdrop?.classList.contains('open'));
  }

  function closeVersionModal() {
    refs.versionModalBackdrop?.classList.remove('open');
    refs.versionModalBackdrop?.setAttribute('aria-hidden', 'true');
    if (state.ui.versionModalMarkOnClose) {
      state.ui.versionModalMarkOnClose = false;
      markVersionModalSeen();
    }
  }

  function hasSeenVersionModal() {
    try {
      return localStorage.getItem(VERSION_MODAL_SEEN_KEY) === VERSION;
    } catch (error) {
      return true;
    }
  }

  function markVersionModalSeen() {
    try {
      localStorage.setItem(VERSION_MODAL_SEEN_KEY, VERSION);
    } catch (error) {
      console.warn('save version modal flag failed', error);
    }
  }

  function openInitialVersionModalIfNeeded() {
    if (hasSeenVersionModal()) return;
    markVersionModalSeen();
    requestAnimationFrame(() => openVersionModal());
  }

  function openVersionModalAfterReset() {
    state.ui.versionModalMarkOnClose = true;
    requestAnimationFrame(() => openVersionModal());
  }

  function isLocalOfflineRuntime() {
    const host = window.location.hostname;
    return window.location.protocol === 'file:'
      || host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || host === '[::1]';
  }

  function syncVersionDisplay() {
    const localMode = isLocalOfflineRuntime();
    const versionLabel = t(localMode ? '离线版本 v{{version}}' : '在线版本 v{{version}}', { version: VERSION });
    appEl.classList.toggle('runtime-local', localMode);
    refs.versionInfoBtn?.classList.toggle('is-local', localMode);
    if (refs.runtimeModeLabel) {
      refs.runtimeModeLabel.textContent = t('关于 v{{version}}', { version: VERSION });
    }
    if (refs.onlineModeChip) {
      refs.onlineModeChip.textContent = localMode ? t('访问在线模式') : t('当前在线最新');
      refs.onlineModeChip.setAttribute('aria-hidden', 'false');
      refs.onlineModeChip.title = localMode ? t('打开在线版本') : t('当前已是在线版本');
    }
    if (refs.versionModalTitle) {
      refs.versionModalTitle.textContent = t(localMode
        ? 'SerialCanvas 离线版本 v{{version}}'
        : 'SerialCanvas 在线版本 v{{version}}', { version: VERSION });
    }
    if (refs.versionCurrentLabel) {
      refs.versionCurrentLabel.textContent = versionLabel;
    }
    refs.versionOnlineBox?.classList.toggle('visible', isLocalOfflineRuntime());
    refs.versionOnlineBox?.querySelector('a')?.setAttribute('href', ONLINE_VERSION_URL);
  }

  function closeMenus(event) {
    const target = event?.target instanceof Element ? event.target : null;
    if (!target || (!target.closest('.chart-config') && !target.closest('.chart-axis-binding-picker') && !target.closest('.chart-toolbar') && !target.closest('.chart-order-tools') && !target.closest('[data-chart-view-chip]'))) {
      let closedChartConfig = false;
      state.charts.forEach((chart) => {
        if (!chart.open) return;
        chart.open = false;
        closedChartConfig = true;
        const panel = refs.chartList?.querySelector(`[data-chart-id="${chart.id}"]`);
        if (panel) {
          panel.classList.remove('is-open');
          const config = panel.querySelector('.chart-config');
          if (config) config.classList.remove('open');
        }
      });
      if (closedChartConfig) scheduleChartPaint();
    }
    if (!target || (!target.closest('.chart-axis-binding-picker') && !target.closest('[data-chart-view-chip]'))) {
      state.ui.chartPickerOpenId = '';
      state.charts.forEach((chart) => syncChartViewUi(chart));
    }
    if (target?.closest('.menu-anchor')) return;
    if (target?.closest('#timeline-ribbon-shell')) return;
    if (target?.closest('#baud-rate-anchor')) return;
    if (target?.closest('.custom-select')) return;
    if (!target.closest('.menu-anchor')) {
      setPendingUserConfigAction('');
    }
    document.querySelectorAll('.floating-menu.open').forEach((menu) => menu.classList.remove('open'));
    refs.baudRateAnchor?.classList.remove('open');
    closeCustomSelectMenus();
    closeTimelinePicker();
  }

  function addSystemLog(message, level = 'sys') {
    console.info(`[${level}] ${message}`);
    const text = String(message || '');
    const timestamp = nowPreciseMs();
    const event = buildEvent(level, [], text, {
      timestamp,
      metadata: { level }
    });
    state.session.liveEvents.push(event);
    trimLiveEvents();
    if (state.activeTimelineId === 'realtime') {
      scheduleRefresh({
        stats: false,
        timelineBar: false,
        derived: false,
        monitor: true,
        charts: false,
        extensionButtons: false,
        extensionPanel: false
      });
    }
  }

  function addInitialWebSerialStatusLog() {
    state.serial.supported = isWebSerialApiAvailable();
    if (state.serial.supported) {
      addSystemLog(t('Web Serial API 已就绪，等待连接。'), 'meta');
    } else {
      addSystemLog(t('不支持 Web Serial API。推荐使用 Chrome 或 Edge，并访问在线最新版本：{{url}}', { url: ONLINE_VERSION_URL }), 'error');
    }
    updateSerialStatus();
  }

  let serialWebViewTracked = false;

  // Upstream's own page counter: its KV endpoint only exists on the author's host.
  function trackSerialCanvasView() {
    if (serialWebViewTracked) return;
    const host = window.location.hostname;
    if (host !== 'conductance-lab.xyz' && host !== 'www.conductance-lab.xyz') return;
    if (typeof fetch !== 'function') return;
    serialWebViewTracked = true;
    fetch('/api/serialweb_page-view', {
      method: 'POST',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {});
  }

  function resetRxSegmentationState() {
    state.serial.rxActiveEvent = null;
    state.serial.pendingCR = false;
  }

  function resetSerialSendQueue() {
    state.serial.sendBusy = false;
    state.serial.sendInFlight = Promise.resolve();
  }

  async function performSerialWrite(bytes) {
    if (!state.serial.connected || !state.serial.writer || state.serial.disconnecting) {
      return false;
    }
    state.serial.sendBusy = true;
    try {
      await state.serial.writer.ready;
      if (!state.serial.connected || !state.serial.writer || state.serial.disconnecting) {
        return false;
      }
      await state.serial.writer.write(bytes);
      return true;
    } finally {
      state.serial.sendBusy = false;
    }
  }

  function normalizeRxSegmentText(text) {
    return String(text ?? '').replace(/\r\n|\r|\n$/, '');
  }
