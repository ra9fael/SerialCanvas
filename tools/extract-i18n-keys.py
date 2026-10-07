"""Extract translatable UI strings from SerialCanvas.

Approximates what the runtime sees, so the result can be pasted into
app.lang.js as a key list:

  keys_ui.txt    - merged candidate keys (index.html + JS)
  keys_noise.txt - captured strings that still contain markup; they need a
                   human pass because they are template bodies, not text nodes

Writes UTF-8 files; nothing is printed, the Windows console cannot encode CJK.
"""
import io
import re
import sys
from html.parser import HTMLParser

ATTRS = ('title', 'aria-label', 'placeholder', 'data-tip', 'data-short', 'data-hover')
CJK = re.compile(r'[㐀-䶿一-鿿豈-﫿]')
INTERP = '{{}}'


class Probe(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.strings = set()
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        for name, value in attrs:
            if name in ATTRS and value and CJK.search(value):
                self.strings.add(normalize(value))

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if self.skip:
            return
        text = normalize(data)
        if text and CJK.search(text):
            self.strings.add(text)


def normalize(text):
    return ' '.join(text.split())


def strip_comments(source):
    """Drop // and block comments while ignoring slashes inside literals."""
    out = []
    i = 0
    quote = None
    n = len(source)
    while i < n:
        ch = source[i]
        if quote:
            out.append(ch)
            if ch == '\\':
                if i + 1 < n:
                    out.append(source[i + 1])
                    i += 2
                    continue
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in ('"', "'", '`'):
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == '/' and i + 1 < n and source[i + 1] == '/':
            while i < n and source[i] != '\n':
                i += 1
            continue
        if ch == '/' and i + 1 < n and source[i + 1] == '*':
            i += 2
            while i + 1 < n and not (source[i] == '*' and source[i + 1] == '/'):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return ''.join(out)


LITERAL = re.compile(r"""(['"`])((?:\\.|(?!\1)[^\\])*)\1""")
NESTED_LITERAL = re.compile(r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)\"""")
TEMPLATE_CALL = re.compile(r"""\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1""")


def unescape(body, quote):
    if quote == '`':
        return body.replace('\\`', '`').replace('\\$', '$').replace('\\\\', '\\')
    return body.replace("\\'", "'").replace('\\"', '"').replace('\\\\', '\\')


def collapse_interp(body):
    return re.sub(r'\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', INTERP, body)


def text_node_pieces(body):
    """Text runs a template would produce, i.e. the parts outside tags."""
    parts = re.split(r'<[^>]*>', body)
    runs = []
    for part in parts:
        for chunk in part.split(INTERP):
            chunk = normalize(chunk)
            if chunk and CJK.search(chunk):
                runs.append(chunk)
    return runs


def js_keys(paths):
    nodes = set()
    calls = set()
    noise = set()
    for path in paths:
        source = strip_comments(io.open(path, encoding='utf-8').read())
        for match in TEMPLATE_CALL.finditer(source):
            body = collapse_interp(unescape(match.group(2), match.group(1)))
            if CJK.search(body):
                calls.add(normalize(body))
        for match in LITERAL.finditer(source):
            body = match.group(2)
            if match.group(1) == '`' and '${' in body:
                body = collapse_interp(body)
            body = unescape(body, match.group(1))
            # A capture that long means the quote matcher ran past the end of a
            # literal (an apostrophe in prose, a quote inside a regex).
            if len(body) > 1200:
                continue
            if not CJK.search(body):
                continue
            if '<' in body or '>' in body:
                for run in text_node_pieces(body):
                    nodes.add(run)
                noise.add(normalize(body))
                continue
            if INTERP in body:
                # Interpolated and not already wrapped in t() - a reviewer has
                # to decide whether the pieces form one text node.
                noise.add(normalize(body))
                continue
            nodes.add(normalize(body))
        # A quote inside a template expression is swallowed by the outer
        # literal above, so scan single/double-quoted strings separately.
        for nested in NESTED_LITERAL.finditer(source):
            body = unescape(nested.group(1) or nested.group(2) or '', "'")
            if len(body) > 200 or '\n' in body or '<' in body or '>' in body:
                continue
            if '${' in body or not CJK.search(body):
                continue
            nodes.add(normalize(body))
    return nodes, calls, noise


def main():
    parser = Probe()
    parser.feed(io.open('index.html', encoding='utf-8').read())
    html = parser.strings
    nodes, calls, noise = js_keys(
        ['app.core.js', 'app.terminal.js', 'app.main.js', 'bootstrap.js'])
    merged = sorted(html | nodes | calls)
    io.open('keys_ui.txt', 'w', encoding='utf-8', newline='\n').write(
        '\n'.join(merged) + '\n')
    io.open('keys_noise.txt', 'w', encoding='utf-8', newline='\n').write(
        '\n'.join(sorted(noise)) + '\n')
    io.open('keys_html.txt', 'w', encoding='utf-8', newline='\n').write(
        '\n'.join(sorted(html)) + '\n')
    print('html=%d js=%d calls=%d merged=%d noise=%d' % (
        len(html), len(nodes), len(calls), len(merged), len(noise)))


if __name__ == '__main__':
    sys.exit(main())
