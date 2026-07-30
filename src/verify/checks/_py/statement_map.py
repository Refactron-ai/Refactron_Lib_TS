"""Map every physical line of a Python file to the STATEMENT that contains it.

Usage: statement_map.py            (NUL-separated file paths on stdin)

Emits one JSON object on stdout:

    {"files": {"<path>": [[first, last, owner], ...]},
     "errors": {"<path>": "<reason>"}}

<path> is echoed back exactly as it arrived on stdin, so the caller can map each
result to the shadow file it handed in. Paths arrive NUL-separated rather than on
argv because a mass reformat can touch hundreds of files and Windows caps a
command line at 32767 characters; a NUL separator also survives the (legal) POSIX
path containing a newline.

Each run is a half-open-free `[first, last, owner]` triple over PHYSICAL line
numbers (1-indexed, both ends inclusive). Runs are ascending and never overlap.
`owner` is the first line of the innermost statement containing those lines, which
is exactly the line coverage.py records execution against. Two owner values are
special:

  * A line in NO run is INERT: it carries no code token at all (blank line, or a
    line holding only a comment). Such a line can neither change behavior nor be
    proven by a test, so the caller must neither count it as exercised nor report
    it as uncovered.
  * owner == -1 marks a code line inside no statement. It should be unreachable
    (every code token belongs to some statement), and exists so that a shape we
    failed to anticipate degrades to "cannot attribute" (which the caller treats
    as never-exercised) instead of silently vanishing into the inert bucket.

WHY THIS EXISTS. coverage.py records execution against a statement's FIRST line
only, so a consumer cannot ask "did this physical line run?". The obvious repair,
"walk back to the nearest statement start at or above the line", is UNSOUND: it
cannot tell a continuation line of that statement from a blank, comment, or
dead-branch line that merely FOLLOWS it and belongs to a different, unexecuted
block. Measured on coverage 7.11, a `dead_code = 1` inside `if False:` appears in
NONE of executed_lines / missing_lines / excluded_lines while the `if False:`
header itself is in executed_lines, so the walk-back landed on an executed
statement and vouched for code the compiler had folded away. Real containment
from the AST is the only way to answer the question honestly.

Two rules do the work:

1. INERTNESS COMES FROM THE TOKENIZER, NOT FROM TEXT. A line is code iff at least
   one non-comment, non-whitespace token touches it. That is exact where a
   textual "is this line blank?" test is not: a blank line inside a triple-quoted
   string is part of a STRING token and therefore real content, while an indented
   `# note` inside a multi-line call carries no code and cannot change behavior.
2. INNERMOST WINS. Statements nest strictly, so the containing statement with the
   greatest start line is the innermost one. Attributing to the innermost is what
   closes the dead-branch hole: a change inside `if False:` lands on the folded
   statement (never executed) rather than on the `if False:` header (executed).

Stdlib only (Python 3.8+ floor; `end_lineno` landed in 3.8); no third-party
imports.
"""
import ast
import io
import json
import sys
import tokenize

# A code line inside no statement at all. See the module docstring.
UNATTRIBUTABLE = -1

# Token types that never carry code. Everything else (NAME, NUMBER, STRING, OP,
# and the 3.12+ f-string pieces) marks its rows as code. A multi-line STRING marks
# every row it spans, which is what keeps a blank line inside a docstring
# attributed to the docstring statement instead of being written off as inert.
_NON_CODE_TOKENS = frozenset(
    t
    for t in (
        getattr(tokenize, name, None)
        for name in ("COMMENT", "NL", "NEWLINE", "INDENT", "DEDENT", "ENDMARKER", "ENCODING")
    )
    if t is not None
)

# `match` statements are 3.10+. `ast.match_case` carries no lineno of its own, so
# the `case` line has to be recovered from its pattern. Without a unit per case,
# a change to a `case` arm that never matched would be vouched for by the `match`
# header, which executes on every dispatch. Measured on coverage 7.11: the case
# lines ARE tracked individually (executed [1,2,3,4], missing [5,6,7,8] for a
# three-arm match where only the first arm ran).
_MATCH_CASE = getattr(ast, "match_case", None)


def _code_lines(src):
    """Physical rows carrying at least one code token.

    Raises tokenize.TokenError / IndentationError / SyntaxError on input the
    tokenizer rejects; the caller turns that into an error entry, never into an
    empty set (an empty set would make every line inert, i.e. a silent free pass).
    """
    rows = set()
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type in _NON_CODE_TOKENS:
            continue
        for row in range(tok.start[0], tok.end[0] + 1):
            rows.add(row)
    return rows


def _match_case_unit(node):
    """`(start, end)` for a `case` arm, or None if its shape is unexpected."""
    pattern = getattr(node, "pattern", None)
    start = getattr(pattern, "lineno", None)
    if start is None:
        return None
    ends = [getattr(pattern, "end_lineno", None)]
    guard = getattr(node, "guard", None)
    if guard is not None:
        ends.append(getattr(guard, "end_lineno", None))
    for stmt in getattr(node, "body", ()):
        ends.append(getattr(stmt, "end_lineno", None))
    known = [e for e in ends if e is not None]
    if not known:
        return None
    return (start, max(known))


def _units(tree):
    """Every statement-like node as a `(start, end)` physical extent.

    `ast.excepthandler` is included because `except X:` is a line coverage.py
    tracks in its own right; without it, a change to an except clause that never
    fired would be attributed to the `try:` above, which did run. `else:` and
    `finally:` are NOT nodes in the grammar and coverage.py does not track them
    either, so they keep the enclosing `try:` as their owner: the closest honest
    answer available, and a line no diff can change on its own.
    """
    units = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.stmt, ast.excepthandler)):
            end = getattr(node, "end_lineno", None)
            if end is None:
                continue
            start = node.lineno
            # A decorator belongs to the def/class it decorates: `FunctionDef`
            # points at the `def` line, so without this the `@deco` line above it
            # would fall outside every statement. Decorators execute together with
            # the definition, so folding them into one unit stays truthful.
            for dec in getattr(node, "decorator_list", ()):
                dec_line = getattr(dec, "lineno", start)
                if dec_line < start:
                    start = dec_line
            units.append((start, end))
        elif _MATCH_CASE is not None and isinstance(node, _MATCH_CASE):
            unit = _match_case_unit(node)
            if unit is not None:
                units.append(unit)
    return units


def _owner_map(units, code_rows, nlines):
    """`owners[row]` for row in 1..nlines: statement start, -1, or 0 (inert)."""
    owners = [0] * (nlines + 2)
    # Ascending start, then widest first, so a nested statement is written AFTER
    # the statement enclosing it and wins the line. Statements nest strictly, so
    # the last writer for a row is exactly the innermost container.
    for start, end in sorted(units, key=lambda u: (u[0], -u[1])):
        for row in range(max(start, 1), min(end, nlines) + 1):
            owners[row] = start
    for row in range(1, nlines + 1):
        if row not in code_rows:
            # Blank or comment-only: semantically inert. This runs AFTER the fill
            # so it also clears the gap lines between a compound statement's
            # children, which the fill had handed to the enclosing `def`/`if`.
            owners[row] = 0
        elif owners[row] == 0:
            owners[row] = UNATTRIBUTABLE
    return owners


def _runs(owners, nlines):
    """Run-length encode the owner map, dropping inert stretches entirely."""
    runs = []
    row = 1
    while row <= nlines:
        owner = owners[row]
        if owner == 0:
            row += 1
            continue
        last = row
        while last + 1 <= nlines and owners[last + 1] == owner:
            last += 1
        runs.append([row, last, owner])
        row = last + 1
    return runs


def analyze(path):
    """Runs for one file. Raises on anything that makes the answer unknowable."""
    # tokenize.open honors a PEP 263 encoding cookie and strips a BOM, so the
    # decoded text keeps the same physical line numbering the diff used.
    with tokenize.open(path) as handle:
        src = handle.read()
    tree = ast.parse(src, filename=path)
    code_rows = _code_lines(src)
    nlines = len(src.splitlines())
    return _runs(_owner_map(_units(tree), code_rows, nlines), nlines)


def main(argv):
    if len(argv) > 1:
        sys.stderr.write("usage: statement_map.py  (NUL-separated paths on stdin)\n")
        return 2

    # Read BINARY and decode explicitly. On Windows, text-mode stdin applies
    # newline translation and the console code page, which can corrupt a
    # NUL-separated payload of native paths; the buffer is byte-exact.
    raw = sys.stdin.buffer.read().decode("utf-8", "surrogateescape")
    paths = [p for p in raw.split("\0") if p]
    files = {}
    errors = {}
    for path in paths:
        try:
            files[path] = analyze(path)
        except (OSError, SyntaxError, ValueError, tokenize.TokenError, RecursionError) as exc:
            # Never fall back to "no statements": that would make every changed
            # line inert and hand the file a free pass. The caller degrades the
            # whole assessment to UNKNOWN coverage on any error entry.
            errors[path] = f"{type(exc).__name__}: {exc}"
    payload = json.dumps({"files": files, "errors": errors}, separators=(",", ":"))
    # Byte-exact stdout for the same reason as stdin above.
    sys.stdout.buffer.write(payload.encode("utf-8", "surrogateescape"))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
