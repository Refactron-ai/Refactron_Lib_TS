#!/usr/bin/env python3
"""Emit operator and constant mutants for the changed lines of one Python file
(ADR-15, #116; constants #149).

stdin:  one JSON object {"path": str, "changed_lines": [int, ...]}
stdout: JSON list of {"line", "col", "endCol", "orig", "repl", "op", "kind"}, one
        per mutable token found on a changed line. `kind` is "operator" or
        "constant" so the runner can fill its budget operators-first (a constant
        must never evict a higher-signal operator mutant past the cap).

Tokenize, not regex or AST, for the mutation positions: token boundaries are
exact, string and comment contents are separate token types and so are never
mutated, and the operator's own position is what a swap needs (AST gives operand
positions, not the operator). AST is used ONLY to locate docstrings (below), which
tokenize cannot identify without reimplementing the grammar.

A mutant that turns out syntactically invalid is the runner's problem, not ours:
it simply runs and is classified as killed, which is the fail-safe direction. The
only failure mode a richer mutant set can add is a false SURVIVOR (an equivalent
mutant), i.e. a false UNPROVEN, never a false SAFE, since mutation is
downgrade-only.
"""
import ast
import io
import json
import sys
import tokenize

# One replacement per operator. Boundary, arithmetic, boolean — the classes that
# catch real regressions per unit of runtime (ADR-15).
OP_SWAP = {
    "<=": "<",
    "<": "<=",
    ">=": ">",
    ">": ">=",
    "==": "!=",
    "!=": "==",
    "+": "-",
    "-": "+",
    "*": "/",
    "/": "*",
    "//": "/",
}
NAME_SWAP = {"and": "or", "or": "and"}
# The keyword constants (#149). None -> True flips truthiness AND identity, so it
# is caught by both a boolean use and an `is None` check.
CONST_NAME_SWAP = {"True": "False", "False": "True", "None": "True"}

# Tokens that begin a logical line. A constant whose previous significant token is
# one of these AND whose next significant token is a NEWLINE is a standalone
# expression statement (a bare string, a bare literal) — inert, so mutating it
# manufactures a survivor no test can kill. Docstrings that are NOT this simple
# shape (inline `def f(): "doc"`, implicit-concatenated `"a" "b"`) are caught by
# the AST span check instead.
_LINE_START = frozenset(
    {tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENCODING}
)


def _num_repl(s: str) -> str:
    """A different, valid numeric literal. Zero-valued literals (0, 0.0, 0x0, 0j)
    map to 1 rather than 0 so the mutant is never numerically equal to the
    original; everything else maps to 0."""
    try:
        is_zero = ast.literal_eval(s) == 0
    except Exception:
        is_zero = s == "0"
    return "1" if is_zero else "0"


def _str_repl(s: str) -> str:
    """A different, valid string literal: empty string for a non-empty literal, a
    sentinel for an already-empty one.

    Fail-safe imprecision, documented rather than special-cased: a bytes literal
    maps to a str (`b"x"` -> `""`), a cross-type mutant that is never equivalent
    (so no false UNPROVEN) but is usually killed on sight. An EMPTY f-string on
    Python < 3.12 (`f""`, one STRING token there) maps to `""`, which is
    behaviourally equal -> an equivalent mutant -> a false UNPROVEN; on 3.12+ an
    f-string is FSTRING_* tokens and is not mutated at all. Both are downgrade-only
    and rare."""
    try:
        v = ast.literal_eval(s)
        empty = v == "" or v == b""
    except Exception:
        empty = False
    return '"__mut__"' if empty else '""'


def _docstring_spans(source: str) -> list:
    """(lineno, col, end_lineno, end_col) for every docstring, so the tokenize
    pass can skip string tokens that are (part of) one. A docstring is
    behaviour-inert, so mutating it manufactures a survivor no test could ever kill
    (a false UNPROVEN). AST identifies them exactly — inline, implicit-concatenated
    and multi-line alike — where a tokenize heuristic cannot. A parse failure
    yields no spans (the tokenize pass then also fails, or degrades fail-safe)."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return []
    spans = []
    holders = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    for node in ast.walk(tree):
        if not isinstance(node, holders):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, (str, bytes))
        ):
            c = first.value
            spans.append((c.lineno, c.col_offset, c.end_lineno, c.end_col_offset))
    return spans


def _in_docstring(spans: list, row: int, col: int) -> bool:
    for (l, c, el, ec) in spans:
        if l <= row <= el and (row > l or col >= c) and (row < el or col < ec):
            return True
    return False


def _significant(toks: list, i: int, step: int):
    """Nearest token before (step -1) or after (step +1) index i that is not a
    comment or a non-logical newline."""
    j = i + step
    while 0 <= j < len(toks):
        if toks[j].type not in (tokenize.COMMENT, tokenize.NL):
            return toks[j]
        j += step
    return None


def _is_bare_stmt(toks: list, i: int) -> bool:
    prev = _significant(toks, i, -1)
    nxt = _significant(toks, i, +1)
    at_line_start = prev is None or prev.type in _LINE_START
    ends_stmt = nxt is not None and nxt.type == tokenize.NEWLINE
    return at_line_start and ends_stmt


def _mutation_for(toks: list, i: int, spans: list):
    """(replacement, kind) for the token at index i, or None if it is not mutable.
    Constants are skipped when they are behaviour-inert (a bare expression
    statement, or any part of a docstring)."""
    tok = toks[i]
    if tok.type == tokenize.OP and tok.string in OP_SWAP:
        return OP_SWAP[tok.string], "operator"
    if tok.type == tokenize.NAME and tok.string in NAME_SWAP:
        return NAME_SWAP[tok.string], "operator"
    if tok.type == tokenize.NAME and tok.string in CONST_NAME_SWAP:
        if _is_bare_stmt(toks, i):
            return None
        return CONST_NAME_SWAP[tok.string], "constant"
    if tok.type == tokenize.NUMBER:
        if _is_bare_stmt(toks, i):
            return None
        return _num_repl(tok.string), "constant"
    if tok.type == tokenize.STRING:
        (row, col) = tok.start
        if _is_bare_stmt(toks, i) or _in_docstring(spans, row, col):
            return None
        return _str_repl(tok.string), "constant"
    return None


def mutants(source: str, changed: set) -> list:
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        # A file we cannot tokenize yields no mutants rather than crashing the
        # run. Mutation is opt-in evidence; its absence never grants SAFE.
        return []
    spans = _docstring_spans(source)
    out = []
    for i, tok in enumerate(toks):
        (row, col) = tok.start
        (erow, ecol) = tok.end
        if row not in changed or row != erow:
            continue
        res = _mutation_for(toks, i, spans)
        if res is None:
            continue
        repl, kind = res
        if repl == tok.string:
            # A mutant equal to the original is a survivor no test could ever
            # kill; never emit one.
            continue
        out.append(
            {
                "line": row,
                "col": col,
                "endCol": ecol,
                "orig": tok.string,
                "repl": repl,
                "op": tok.string + "->" + repl,
                "kind": kind,
            }
        )
    return out


def main() -> int:
    try:
        req = json.load(sys.stdin)
        path = req["path"]
        changed = set(int(x) for x in req.get("changed_lines", []))
    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        sys.stderr.write("mutate.py: bad request\n")
        return 2
    try:
        with open(path, "r", encoding="utf-8") as fh:
            source = fh.read()
    except OSError as e:
        sys.stderr.write("mutate.py: cannot read %s: %s\n" % (path, e))
        return 2
    json.dump(mutants(source, changed), sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
