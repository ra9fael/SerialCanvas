(() => {
  const LOCAL_PREFS_KEY = 'serialweb:prefs';
  const browserThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const readInitialPrefs = () => {
    try {
      const raw = localStorage.getItem(LOCAL_PREFS_KEY);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      return payload && typeof payload === 'object' ? payload : null;
    } catch (error) {
      return null;
    }
  };
  const initialPrefs = readInitialPrefs();
  const getInitialTheme = () => {
    if (initialPrefs?.theme === 'system' || initialPrefs?.theme === 'dark' || initialPrefs?.theme === 'light') {
      return initialPrefs.theme === 'system' ? (browserThemeQuery.matches ? 'dark' : 'light') : initialPrefs.theme;
    }
    return browserThemeQuery.matches ? 'dark' : 'light';
  };
  const applyThemeClass = (theme) => {
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
  };
  // The authored UI language is Chinese, so a saved snapshot from before the
  // language switch existed must keep rendering Chinese rather than English.
  const getInitialLocaleSetting = () => {
    const saved = initialPrefs?.locale;
    if (saved === 'system' || saved === 'zh' || saved === 'en') return saved;
    return initialPrefs ? 'zh' : 'system';
  };
  const resolveLocale = (setting) => {
    if (setting === 'system') {
      return /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
    }
    return setting === 'en' ? 'en' : 'zh';
  };

  window.__serialWebInitialPrefs = initialPrefs;
  window.__serialWebInitialTheme = getInitialTheme();
  window.__serialWebResolveLocale = resolveLocale;
  window.__serialWebInitialLocale = getInitialLocaleSetting();
  // Read here, not at app boot: the stylesheet selects the corner radius from
  // data-corner, so a preference set by the app alone would render one frame at
  // the default and then snap.
  window.__serialWebInitialCorner = ['square', 'soft', 'round'].includes(initialPrefs?.cornerRadius)
    ? initialPrefs.cornerRadius
    : 'square';
  document.documentElement.lang = resolveLocale(window.__serialWebInitialLocale) === 'zh' ? 'zh-CN' : 'en';
  window.__applySerialCanvasInitialBodyClasses = () => {
    const body = document.body;
    if (!body) return;
    const compact = window.innerWidth <= 720;
    const layout = window.__serialWebInitialPrefs?.layout || {};
    const modules = window.__serialWebInitialPrefs?.modules || {};
    const host = window.location.hostname;
    const localRuntime = window.location.protocol === 'file:'
      || host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || host === '[::1]';
    const corner = ['square', 'soft', 'round'].includes(window.__serialWebInitialCorner)
      ? window.__serialWebInitialCorner
      : 'square';
    document.documentElement.setAttribute('data-corner', corner);
    body.setAttribute('data-corner', corner);
    body.classList.toggle('theme-dark', window.__serialWebInitialTheme === 'dark');
    body.classList.toggle('compact-single', compact);
    body.classList.toggle('layout-expanded', Boolean(layout.expanded));
    body.classList.toggle('sidebar-collapsed', !compact && Boolean(layout.sidebarCollapsed));
    body.classList.toggle('parser-results-expanded', Boolean(layout.parserResultsExpanded));
    body.classList.toggle('send-extension-restoring', Boolean(modules.autoSendOpen || modules.conditionSendOpen || modules.presetSendOpen));
    body.classList.toggle('send-auto-restoring', Boolean(modules.autoSendOpen));
    body.classList.toggle('send-condition-restoring', Boolean(modules.conditionSendOpen));
    body.classList.toggle('send-preset-restoring', Boolean(modules.presetSendOpen));
    body.classList.toggle('runtime-local', localRuntime);
  };

  window.__setSerialCanvasFavicon = () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect width="64" height="64" fill="#ffffff"></rect>
        <mask id="serialweb-mask" maskUnits="userSpaceOnUse">
          <rect width="64" height="64" fill="black"></rect>
          <path d="M12 16C12 13.79 13.79 12 16 12H28V20H20V44H28V52H16C13.79 52 12 50.21 12 48V16Z" fill="white"></path>
          <path d="M52 16C52 13.79 50.21 12 48 12H36V20H44V44H36V52H48C50.21 52 52 50.21 52 48V16Z" fill="white"></path>
          <rect x="28" y="28" width="8" height="8" rx="4" fill="white"></rect>
          <rect x="22" y="24" width="6" height="16" rx="2" fill="black"></rect>
          <rect x="36" y="24" width="6" height="16" rx="2" fill="black"></rect>
          <rect x="30.5" y="30" width="3" height="4" rx="1.5" fill="black"></rect>
        </mask>
        <rect width="64" height="64" fill="#000000" mask="url(#serialweb-mask)"></rect>
      </svg>
    `.trim();
    let favicon = document.getElementById('serialweb-favicon');
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.id = 'serialweb-favicon';
      favicon.rel = 'icon';
      favicon.type = 'image/svg+xml';
      document.head.appendChild(favicon);
    }
    favicon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };

  const syncDocumentTheme = () => {
    applyThemeClass(browserThemeQuery.matches ? 'dark' : 'light');
    window.__setSerialCanvasFavicon();
  };

  browserThemeQuery.addEventListener('change', () => {
    syncDocumentTheme();
  });

  applyThemeClass(window.__serialWebInitialTheme);
  window.__setSerialCanvasFavicon();
})();
