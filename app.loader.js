'use strict';
/* ============================================================================
 * SerialCanvas - chunk loader
 * The application sources are split into three files that share ONE closure:
 *   app.core.js     (opens the IIFE: constants, state, refs, utils)
 *   app.terminal.js (terminal mode feature)
 *   app.main.js     (closes the IIFE: serial lifecycle, UI, init)
 * Browsers parse each <script> tag independently, so a closure cannot span
 * script tags. This loader fetches the three files, concatenates them and
 * executes the result as a single script, preserving the shared closure.
 * The single-file release build inlines the same concatenation directly.
 * ==========================================================================*/
(function () {
  const CHUNKS = ['app.core.js', 'app.terminal.js', 'app.main.js'];

  function showOverlay(message) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;'
      + 'align-items:center;justify-content:center;background:#101216;color:#e8e8ea;'
      + 'font:14px/1.7 Consolas, monospace;text-align:center;padding:24px;';
    overlay.innerHTML = '<div style="max-width:560px">' + message + '</div>';
    document.body.appendChild(overlay);
  }

  function reportFailure(file, error) {
    console.error(`[SerialCanvas] failed to load ${file}:`, error);
    if (window.location.protocol === 'file:') {
      showOverlay('SerialCanvas 的源码模式不支持直接双击打开（file:// 无法加载分片）。<br><br>'
        + '请使用：<b>dist/SerialCanvas.html</b>（单文件版，可直接打开），<br>'
        + '或通过本地 HTTP 服务访问 index.html（串口功能本身也要求 localhost/HTTPS）。');
      return;
    }
    document.documentElement.dataset.appLoadError = `${file}: ${error}`;
  }

  function execute(joined) {
    const script = document.createElement('script');
    script.textContent = joined;
    document.body.appendChild(script);
  }

  if (window.location.protocol === 'file:') {
    reportFailure(CHUNKS[0], new Error('file:// protocol is not supported for chunked sources'));
  } else {
    Promise.all(CHUNKS.map((file) =>
      fetch(file, { cache: 'no-cache' }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }).catch((error) => {
        reportFailure(file, error);
        throw error;
      })
    )).then((parts) => execute(parts.join('\n'))).catch(() => {});
  }
})();
