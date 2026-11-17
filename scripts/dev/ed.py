"""Exact-string edits that keep a file's line endings (many files here are CRLF).

For a change too large or too awkward for one Edit call, write a small Python script outside the
repository, import this, and run it from anywhere:

    import sys
    sys.path.insert(0, "<checkout>/scripts/dev")
    from ed import edit, splice
    edit('src/core/Game.ts', [("old text", "new text"), ...])

Every `old` must occur exactly once, or the script stops before writing anything to that file.
Paths are relative to the checkout this file lives in.
"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def _read(rel):
    p = os.path.join(ROOT, rel)
    raw = open(p, 'rb').read().decode('utf-8')
    crlf = '\r\n' in raw
    return p, raw.replace('\r\n', '\n'), crlf


def _write(p, text, crlf):
    if crlf:
        text = text.replace('\n', '\r\n')
    open(p, 'wb').write(text.encode('utf-8'))


def edit(rel, pairs):
    p, s, crlf = _read(rel)
    for old, new in pairs:
        if s.count(old) != 1:
            raise SystemExit("expected exactly 1 match in %s, found %d: %r" % (rel, s.count(old), old[:80]))
        s = s.replace(old, new)
    _write(p, s, crlf)


def splice(rel, start, end, new):
    """Replaces from the first `start` up to (not including) the next `end` after it."""
    p, s, crlf = _read(rel)
    a = s.index(start)
    z = s.index(end, a + len(start))
    _write(p, s[:a] + new + s[z:], crlf)
