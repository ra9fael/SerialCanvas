#!/usr/bin/env python3
"""Build a single-file release of SerialCanvas.

Inlines every referenced local asset (style.css, bootstrap.js, vendor/xterm/*,
app.core.js, app.terminal.js, app.main.js) into index.html and writes the
output to dist/SerialCanvas.html. The produced file runs standalone from file://.

JS chunks are concatenated (they share one IIFE closure) and minified with
esbuild (node_modules/.bin or PATH); the escaped result is then inlined.
HTML/CSS are minified with minify_html when importable. Minified inline
scripts are validated with `node --check` before being written; on any
validation failure the build falls back to the unminified document.

Before anything is inlined the version is checked for consistency: app.core.js
`const VERSION` must equal the newest `## v<semver>` heading in
docs/CHANGELOG.md and must head the newest About-dialog release block. Use
tools/set-version.py to cut a release, which writes all three at once.

Usage:  python build-release.py            (full minification when tools are available)
        python build-release.py --no-minify
"""

import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, 'dist')
OUTPUT = os.path.join(DIST, 'SerialCanvas.html')

INLINE_ASSETS = [
    ('<link rel="stylesheet" href="style.css">', 'style.css', 'style'),
    ('<link rel="stylesheet" href="vendor/xterm/xterm.css">', 'vendor/xterm/xterm.css', 'style'),
    ('<script src="bootstrap.js"></script>', 'bootstrap.js', 'script'),
    ('<script src="vendor/xterm/xterm.js"></script>', 'vendor/xterm/xterm.js', 'script'),
    ('<script src="vendor/xterm/xterm-addon-fit.js"></script>', 'vendor/xterm/xterm-addon-fit.js', 'script'),
    # The locale dictionary is a standalone script: it must be inlined above the
    # app chunks because the engine in app.core.js reads window.SERIALWEB_I18N.
    ('<script src="app.lang.js"></script>', 'app.lang.js', 'script'),
    # The loader tag is replaced by the three app chunks concatenated into ONE
    # inline script: they share a single closure and must be parsed together.
    ('<script src="app.loader.js"></script>', ['app.core.js', 'app.terminal.js', 'app.main.js'], 'script'),
]


def read(path):
    with io.open(path, encoding='utf-8') as handle:
        return handle.read()


def find_esbuild():
    """Locate the esbuild launcher (node_modules/.bin first, then PATH)."""
    for name in ('esbuild.cmd', 'esbuild.exe', 'esbuild'):
        candidate = os.path.join(ROOT, 'node_modules', '.bin', name)
        if os.path.exists(candidate):
            return candidate
    return shutil.which('esbuild')


def minify_js_with_esbuild(source):
    """Minify JS via esbuild. Returns (js, minified). Falls back to the input
    unchanged when esbuild is unavailable or fails; correctness is re-checked
    later by validate_inline_scripts()."""
    esbuild = find_esbuild()
    if not esbuild:
        print('WARN: esbuild not found, JS left unminified')
        return source, False
    tmp_dir = tempfile.mkdtemp(prefix='serialweb-build-')
    src_path = os.path.join(tmp_dir, 'combined.js')
    out_path = os.path.join(tmp_dir, 'combined.min.js')
    with io.open(src_path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(source)
    try:
        # Tool output is decoded as UTF-8 on purpose: esbuild prints a "⚡ Done" summary that
        # crashes the locale codec (e.g. cp936 on zh-CN Windows) inside the capture thread.
        result = subprocess.run(
            [esbuild, src_path, '--minify', '--format=iife', f'--outfile={out_path}'],
            capture_output=True, text=True, encoding='utf-8', errors='replace')
        if result.returncode != 0:
            print('WARN: esbuild failed, JS left unminified:\n%s' % result.stderr[:800])
            return source, False
        return read(out_path), True
    except OSError as error:
        print('WARN: esbuild invocation failed, JS left unminified: %s' % error)
        return source, False
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def check_version_consistency():
    """VERSION, the changelog and the About dialog must name the same release."""
    core = read(os.path.join(ROOT, 'app.core.js'))
    match = re.search(r"const VERSION = '([^']*)'", core)
    if not match:
        raise SystemExit('ERROR: no `const VERSION` in app.core.js')
    version = match.group(1)
    problems = []
    if not re.match(r'^\d+\.\d+\.\d+$', version):
        problems.append('app.core.js VERSION is %s, expected bare semver such as 0.2.0'
                        % ascii(version))
    headings = re.findall(r'^## v(\d+\.\d+\.\d+)',
                          read(os.path.join(ROOT, 'docs', 'CHANGELOG.md')), re.M)
    if not headings:
        problems.append('docs/CHANGELOG.md has no versioned section, only Unreleased')
    elif headings[0] != version:
        problems.append('docs/CHANGELOG.md newest section is %s but VERSION is %s'
                        % (ascii(headings[0]), ascii(version)))
    dialog = re.search(r'<div class="version-release">\s*<strong>([^<]*)</strong>',
                       read(os.path.join(ROOT, 'index.html')))
    header = u'v%s 版本' % version
    if dialog is None:
        problems.append('index.html has no release block in the About dialog')
    elif not dialog.group(1).startswith(header):
        problems.append('the dialog newest release block is %s, expected it to start with %s'
                        % (ascii(dialog.group(1)), ascii(header)))
    if problems:
        raise SystemExit('ERROR: version drift, cut the release with tools/set-version.py:\n  - %s'
                         % '\n  - '.join(problems))


def main():
    check_version_consistency()
    html = read(os.path.join(ROOT, 'index.html'))

    for tag, filename, kind in INLINE_ASSETS:
        if tag not in html:
            raise SystemExit('ERROR: tag not found in index.html: %s' % tag)
        if isinstance(filename, list):
            # The app chunks share a single IIFE closure: concatenate them into
            # one script BEFORE minifying so esbuild parses them as a whole.
            source = '\n'.join(read(os.path.join(ROOT, name)) for name in filename)
            if '--no-minify' not in sys.argv:
                original_kb = len(source.encode('utf-8')) / 1024
                source, js_minified = minify_js_with_esbuild(source)
                if js_minified:
                    print('OK: JS minified with esbuild (%.1f KB -> %.1f KB)'
                          % (original_kb, len(source.encode('utf-8')) / 1024))
        else:
            source = read(os.path.join(ROOT, filename))
        if kind == 'style':
            replacement = '<style>\n%s\n</style>' % source
        else:
            # Escape closing script sequences so inline JS string literals
            # (e.g. the offline-download asset tags) cannot terminate the block.
            source = source.replace('</script', '<\\/script')
            replacement = '<script>\n%s\n</script>' % source
        html = html.replace(tag, replacement, 1)

    # Sanity: no local asset references left behind in markup (script bodies may
    # legitimately contain tag strings for the offline-download feature).
    markup_only = re.sub(r'<script>.*?</script>', '', html, flags=re.S)
    markup_only = re.sub(r'<style>.*?</style>', '', markup_only, flags=re.S)
    leftovers = re.findall(r'(?:src|href)="(?!https?:|data:|#|mailto:)([^"]+)"', markup_only)
    leftovers = [ref for ref in leftovers if not ref.startswith('favicon') and ref != 'index.html']
    if leftovers:
        raise SystemExit('ERROR: un-inlined local references remain: %s' % leftovers)

    if '--no-minify' not in sys.argv:
        try:
            import minify_html
        except ImportError:
            print('WARN: minify_html not available, writing unminified output')
        else:
            original_size = len(html.encode('utf-8'))
            # NOTE: minify_js is intentionally disabled - minify-html's builtin
            # JS minifier broke scoped const/let code ("Cannot access before
            # initialization"), so JS is kept verbatim.
            minified = minify_html.minify(
                html,
                keep_closing_tags=True,
                keep_comments=False,
                minify_css=True,
                minify_js=False,
            )
            if validate_inline_scripts(minified):
                html = minified
                print('OK: minified %.1f KB -> %.1f KB'
                      % (original_size / 1024, len(html.encode('utf-8')) / 1024))
            else:
                print('WARN: minified scripts failed validation, keeping unminified output')

    os.makedirs(DIST, exist_ok=True)
    with io.open(OUTPUT, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(html)
    print('OK: wrote %s (%.1f KB)' % (OUTPUT, len(html.encode('utf-8')) / 1024))


def validate_inline_scripts(html):
    """Run `node --check` on every inline <script> body; False on any failure."""
    node = shutil.which('node')
    if not node:
        print('WARN: node not found, skipping minified script validation')
        return True

    scripts = re.findall(r'<script>(.*?)</script>', html, flags=re.S)
    for index, body in enumerate(scripts):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                         encoding='utf-8') as handle:
            handle.write(body)
            path = handle.name
        try:
            result = subprocess.run([node, '--check', path],
                                    capture_output=True, text=True,
                                    encoding='utf-8', errors='replace')
            if result.returncode != 0:
                print('ERROR: inline script #%d failed node --check:\n%s'
                      % (index, (result.stderr or result.stdout or '')[:800]))
                return False
        finally:
            os.unlink(path)
    return True


if __name__ == '__main__':
    main()
