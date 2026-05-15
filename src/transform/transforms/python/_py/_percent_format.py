"""Printf-grammar percent-format -> f-string converter for Refactron.

This is a proper printf-grammar converter that supersedes LibCST's
``ConvertPercentFormatStringCommand`` (which only handles plain ``%s``).
It walks ``BinaryOperation`` nodes whose operator is ``Modulo``, and when the
left-hand side is a string literal AND every printf specifier in it is
recognised AND the arity matches the right-hand side, it rewrites the whole
expression to an f-string.

It is deliberately all-or-nothing per string and conservative: any case it is
unsure about is left untouched (Refactron's downstream 3-gate verifier runs the
test suite, but this pass still avoids known-unsafe rewrites up front).

Behaviour note: ``%d`` is converted to a plain ``{expr}`` field. If ``expr`` is
a float at runtime, ``%d`` truncates while ``{expr}`` does not. This cannot be
known statically; flynt/pyupgrade make the same choice and rely on the test
gate. We do the same and document it here.
"""
import re

import libcst as cst

# printf conversion specifier grammar:
#   %[(key)][flags][width][.precision][length]conversion
# We capture each part. ``key`` and ``*`` lead to a skip (handled by callers).
_SPEC_RE = re.compile(
    r"%"
    r"(?P<key>\([^)]*\))?"  # mapping key: %(name)s
    r"(?P<flags>[-+ #0]*)"  # flags
    r"(?P<width>\*|\d+)?"  # width (may be *)
    r"(?P<prec>\.(?:\*|\d+))?"  # .precision (may be .*)
    r"(?P<length>[hlL])?"  # length modifier (ignored in Python)
    r"(?P<conv>[diouxXeEfFgGcrsa%])"  # conversion
)

# Conversions whose f-string format-spec letter equals the printf letter.
_NUMERIC_LETTERS = {"x", "X", "o", "e", "E", "f", "F", "g", "G"}


class _Unconvertible(Exception):
    """Raised when a percent-format site cannot be safely converted."""


def _build_field(spec: "re.Match[str]", expr_src: str) -> str:
    """Build a single f-string replacement field from a parsed specifier.

    ``expr_src`` is the already-rendered source of the argument expression.
    Raises ``_Unconvertible`` for anything outside the supported grammar.
    """
    key = spec.group("key")
    if key is not None:
        # Mapping syntax %(name)s -- different arg shape, skip the whole site.
        raise _Unconvertible("mapping specifier")

    flags = spec.group("flags") or ""
    width = spec.group("width")
    prec = spec.group("prec")
    conv = spec.group("conv")

    if width == "*" or (prec is not None and "*" in prec):
        raise _Unconvertible("dynamic (*) width/precision")

    # Conversion -> f-string conversion flag (!r / !a) and/or format letter.
    conversion_flag = ""  # !r, !a
    fmt_letter = ""  # trailing letter inside the format spec

    if conv == "s":
        pass  # plain str()
    elif conv == "r":
        conversion_flag = "!r"
    elif conv == "a":
        conversion_flag = "!a"
    elif conv in ("d", "i", "u"):
        # int -- %u is an obsolete alias of %d. A bare %d converts to a plain
        # field {expr}; but when a width/flag spec is present we keep the `d`
        # letter so the format spec stays type-correct (e.g. %05d -> {x:05d}).
        if width or flags or prec:
            fmt_letter = "d"
    elif conv == "c":
        # %c is rare and only safe when the arg already prints as one char.
        # We cannot prove that statically, so be conservative and skip.
        raise _Unconvertible("%c is not safely convertible")
    elif conv in _NUMERIC_LETTERS:
        fmt_letter = conv
    else:  # pragma: no cover - regex restricts conv, but stay defensive.
        raise _Unconvertible(f"unrecognised conversion %{conv}")

    # Translate printf flags into f-string format-spec syntax.
    align = ""
    fill_zero = ""
    sign = ""
    alt = "#" if "#" in flags else ""
    if "-" in flags:
        align = "<"  # left-align
    elif "0" in flags:
        fill_zero = "0"  # zero-pad
    if "+" in flags:
        sign = "+"
    elif " " in flags:
        sign = " "

    width_part = width or ""
    prec_part = prec or ""

    spec_body = f"{align}{sign}{alt}{fill_zero}{width_part}{prec_part}{fmt_letter}"

    field = "{" + expr_src + conversion_flag
    if spec_body:
        field += ":" + spec_body
    field += "}"
    return field


def _string_node_parts(node: cst.BaseExpression):
    """Return (prefix, quote, raw_inner_text) for a string literal LHS.

    Supports SimpleString and ConcatenatedString (adjacent literals). Raises
    ``_Unconvertible`` for anything else or for raw strings (whose escaping
    semantics differ from f-strings).
    """
    if isinstance(node, cst.SimpleString):
        prefix = node.prefix.lower()
        if "b" in prefix:
            raise _Unconvertible("bytes literal")
        if "r" in prefix:
            # Raw strings: converting could change backslash semantics. Skip.
            raise _Unconvertible("raw string literal")
        if "f" in prefix:
            raise _Unconvertible("already an f-string")
        return prefix, node.quote, node.raw_value
    if isinstance(node, cst.ConcatenatedString):
        # Concatenate the implicit-concatenation chain into one logical value.
        left_p, left_q, left_v = _string_node_parts(node.left)
        right_p, right_q, right_v = _string_node_parts(node.right)
        # Keep the first segment's quote style; reject mixed bytes/raw above.
        return left_p, left_q, left_v + right_v
    raise _Unconvertible("LHS is not a string literal")


def _escape_literal(text: str) -> str:
    """Escape braces in literal text destined for an f-string."""
    return text.replace("{", "{{").replace("}", "}}")


def _rhs_expressions(rhs: cst.BaseExpression):
    """Return the ordered list of argument expressions from the RHS.

    A tuple yields its elements; anything else yields a single-element list.
    A starred element inside the tuple makes arity unknowable -> skip.
    """
    if isinstance(rhs, cst.Tuple):
        exprs = []
        for el in rhs.elements:
            if isinstance(el, cst.StarredElement):
                raise _Unconvertible("starred element in RHS tuple")
            exprs.append(el.value)
        return exprs
    return [rhs]


def _convert(node: cst.BinaryOperation, module: cst.Module) -> cst.BaseExpression:
    """Attempt to convert a ``str % args`` BinaryOperation to an f-string.

    Raises ``_Unconvertible`` if the site must be left untouched.
    """
    prefix, quote, raw = _string_node_parts(node.left)

    # Find every specifier; verify the regex consumed all '%' occurrences.
    specs = list(_SPEC_RE.finditer(raw))

    # Reject any stray '%' the grammar did not match (malformed specifier).
    consumed = bytearray(len(raw))
    for m in specs:
        for i in range(m.start(), m.end()):
            consumed[i] = 1
    for i, ch in enumerate(raw):
        if ch == "%" and not consumed[i]:
            raise _Unconvertible("unrecognised/malformed % specifier")

    # Count field-consuming specifiers (everything except literal %%).
    field_specs = [m for m in specs if m.group("conv") != "%"]

    arg_exprs = _rhs_expressions(node.right)

    if len(field_specs) != len(arg_exprs):
        raise _Unconvertible(
            f"arity mismatch: {len(field_specs)} specifiers vs "
            f"{len(arg_exprs)} args"
        )

    # Build the f-string body, walking the raw literal left-to-right.
    out = []
    pos = 0
    arg_index = 0
    for m in specs:
        out.append(_escape_literal(raw[pos : m.start()]))
        pos = m.end()
        if m.group("conv") == "%":
            out.append("%")
            continue
        expr = arg_exprs[arg_index]
        arg_index += 1
        expr_src = module.code_for_node(expr).strip()
        # An expression containing a quote matching our chosen quote, or a
        # backslash, or a nested brace would break the f-string -- skip.
        if "\\" in expr_src or "{" in expr_src or "}" in expr_src:
            raise _Unconvertible("argument expression unsafe inside f-string")
        if quote in expr_src or quote[0] in expr_src:
            raise _Unconvertible("argument expression contains the quote char")
        out.append(_build_field(m, expr_src))
    out.append(_escape_literal(raw[pos:]))

    body = "".join(out)
    new_prefix = "f" + prefix
    fstring_code = f"{new_prefix}{quote}{body}{quote}"

    # Parse the assembled f-string so we hand back a proper CST node and let
    # LibCST validate it. A parse failure means our rewrite was unsafe.
    try:
        new_node = cst.parse_expression(fstring_code)
    except Exception as exc:  # pragma: no cover - defensive
        raise _Unconvertible(f"resulting f-string failed to parse: {exc}")
    if not isinstance(new_node, cst.FormattedString):
        raise _Unconvertible("conversion did not yield an f-string")
    return new_node


class PercentFormatToFString(cst.CSTTransformer):
    """Rewrites convertible ``str % args`` expressions into f-strings."""

    def __init__(self) -> None:
        super().__init__()
        self.module: "cst.Module | None" = None
        # Number of sites successfully converted (for diagnostics).
        self.converted = 0

    def leave_BinaryOperation(
        self, original: cst.BinaryOperation, updated: cst.BinaryOperation
    ) -> cst.BaseExpression:
        if not isinstance(updated.operator, cst.Modulo):
            return updated
        assert self.module is not None
        try:
            new_node = _convert(updated, self.module)
        except _Unconvertible:
            return updated
        except Exception:
            # Never let an unexpected error abort the whole transform.
            return updated
        self.converted += 1
        return new_node


def convert_percent_formats(module: cst.Module) -> cst.Module:
    """Apply the percent-format -> f-string conversion to a parsed module."""
    transformer = PercentFormatToFString()
    transformer.module = module
    return module.visit(transformer)
