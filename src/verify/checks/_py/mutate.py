#!/usr/bin/env python3
"""Emit operator and constant mutants for the changed lines of one Python file
(ADR-15, #116; constants #149).

stdin:  one JSON object {"path": str, "changed_lines": [int, ...]}
stdout: JSON list of {"line", "col", "endCol", "orig", "repl", "op"}, one per
        mutable token found on a changed line.

Tokenize, not regex or AST: token boundaries are exact, string and comment
contents are separate token types and so are never mutated, and the operator's
own position is what a swap needs (AST gives operand positions, not the operator).
A mutant that turns out syntactically invalid is the runner's problem, not ours:
it simply runs and is classified as killed, which is the fail-safe direction.

Constants are a whole token too, so the same tokenize discipline holds: a number
or `<=` INSIDE a string or comment is part of that STRING/COMMENT token and is
never emitted, while a string or number used as a VALUE is its own token and is a
legitimate target. Only failure mode a richer mutant set can add is a false
SURVIVOR (an equivalent mutant), i.e. a false UNPROVEN, never a false SAFE, since
mutation is downgrade-only.
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
# expression statement (a docstring, a bare string, a bare literal) — inert, so
# mutating it manufactures a survivor no test can kill.
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
    sentinel for an already-empty one. An f-string (no literal value) maps to the
    empty string, which drops its interpolation and so changes behaviour."""
    try:
        v = ast.literal_eval(s)
        empty = v == "" or v == b""
    except Exception:
        empty = False
    return '"__mut__"' if empty else '""'


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


def _repl_for(toks: list, i: int):
    """The replacement string for the token at index i, or None if it is not
    mutable. Constants are skipped when they form a bare expression statement."""
    tok = toks[i]
    if tok.type == tokenize.OP and tok.string in OP_SWAP:
        return OP_SWAP[tok.string]
    if tok.type == tokenize.NAME and tok.string in NAME_SWAP:
        return NAME_SWAP[tok.string]
    if tok.type == tokenize.NAME and tok.string in CONST_NAME_SWAP:
        return None if _is_bare_stmt(toks, i) else CONST_NAME_SWAP[tok.string]
    if tok.type == tokenize.NUMBER:
        return None if _is_bare_stmt(toks, i) else _num_repl(tok.string)
    if tok.type == tokenize.STRING:
        return None if _is_bare_stmt(toks, i) else _str_repl(tok.string)
    return None


def mutants(source: str, changed: set) -> list:
    out = []
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        # A file we cannot tokenize yields no mutants rather than crashing the
        # run. Mutation is opt-in evidence; its absence never grants SAFE.
        return []
    for i, tok in enumerate(toks):
        (row, col) = tok.start
        (erow, ecol) = tok.end
        if row not in changed or row != erow:
            continue
        repl = _repl_for(toks, i)
        if repl is None or repl == tok.string:
            # `repl == tok.string` guards against a no-op mutant (a mutant equal
            # to the original is a survivor no test could ever kill).
            continue
        out.append(
            {
                "line": row,
                "col": col,
                "endCol": ecol,
                "orig": tok.string,
                "repl": repl,
                "op": tok.string + "->" + repl,
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
