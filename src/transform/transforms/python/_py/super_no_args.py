"""super(Class, self).method(...) -> super().method(...).

Conservative scope for v0.3.0:
- Only rewrites `super(X, self)` where X is a bare Name matching the
  immediately enclosing class. Dotted refs (`super(mod.X, self)`),
  classmethod usage (`super(X, cls)`), and the rare `super(type(self), self)`
  pattern are out of scope — leave them untouched. `super(__class__, self)`
  is also skipped (the magic `__class__` cell would need its own handling).
  # TODO: handle super(__class__, self) in v0.4
- The "enclosing class" is the INNERMOST class in the lexical stack at the
  `super(...)` site — i.e. the class `super()` (with no args) would default
  to via its `__class__` cell. A nested class shadow
  (`class Outer: class Inner: super(Outer, self)`) is NOT rewritten,
  because the innermost lexical class is `Inner`, so zero-arg `super()`
  would bind to `Inner`'s MRO, not `Outer`'s — different semantics.
  Over-skip beats under-skip.
- Static / module-level `super(X, self)` (no enclosing class) is skipped —
  that code is already broken at runtime, no point rewriting it.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402

import libcst as cst  # noqa: E402


class SuperNoArgsTransformer(cst.CSTTransformer):
    def __init__(self):
        # Stack of class names we are lexically inside. The innermost entry
        # (top of stack) is the class `super()` would default to.
        self._class_stack: list[str] = []
        self.changed = False

    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        self._class_stack.append(node.name.value)

    def leave_ClassDef(
        self, original: cst.ClassDef, updated: cst.ClassDef
    ) -> cst.ClassDef:
        self._class_stack.pop()
        return updated

    def leave_Call(self, original: cst.Call, updated: cst.Call) -> cst.BaseExpression:
        if not isinstance(updated.func, cst.Name) or updated.func.value != "super":
            return updated
        if not self._class_stack:
            # Module-level / inside a free function with no enclosing class.
            # Cannot safely rewrite -- leave as-is.
            return updated
        # The class super() defaults to is the innermost lexical class. If the
        # first arg names a different (outer) class, we MUST NOT rewrite.
        innermost_class = self._class_stack[-1]

        args = updated.args
        if len(args) != 2:
            return updated

        first = args[0].value
        second = args[1].value

        # First arg: bare Name matching the innermost enclosing class.
        if not isinstance(first, cst.Name) or first.value != innermost_class:
            return updated
        # Second arg: literally `self`. classmethods (`cls`) and static
        # contexts are deferred -- their semantics differ enough that the
        # zero-arg form is not a drop-in.
        if not isinstance(second, cst.Name) or second.value != "self":
            return updated

        # Drop both args. Preserve `func` (the `super` Name) so existing
        # whitespace / leading lines are kept.
        self.changed = True
        return updated.with_changes(args=[])


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: super_no_args.py <file>")
        return
    path_ = sys.argv[1]
    src = read_source(path_)
    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    tx = SuperNoArgsTransformer()
    new_module = module.visit(tx)
    if not tx.changed or new_module.code == src:
        emit(ok=True, new_content="", preconditions=[])
        return

    emit(
        ok=True,
        new_content=new_module.code,
        preconditions=[{"id": "rewritten", "satisfied": True}],
    )


if __name__ == "__main__":
    main()
