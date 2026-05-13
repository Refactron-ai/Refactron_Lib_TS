import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402

import libcst as cst  # noqa: E402
import libcst.matchers as m  # noqa: E402

CALLBACK_ALIASES = {"callback", "cb", "done"}


def _has_yield(body) -> bool:
    for _node in m.findall(body, m.Yield()):
        return True
    return False


def _count_callback_calls(body, name: str) -> int:
    count = 0
    for _node in m.findall(body, m.Call(func=m.Name(value=name))):
        count += 1
    return count


def _param_names(params: cst.Parameters):
    return [p.name.value for p in params.params]


class CallbackToAsyncTransformer(cst.CSTTransformer):
    def __init__(self):
        self.preconditions = []
        self.changed = False

    def leave_FunctionDef(
        self, original: cst.FunctionDef, updated: cst.FunctionDef
    ) -> cst.FunctionDef:
        if updated.asynchronous is not None:
            # already async — caller's pre-flight records the precondition when applicable
            return updated

        names = _param_names(updated.params)
        if not names:
            return updated

        # find a callback-aliased parameter anywhere in the positional list
        alias_indices = [i for i, n in enumerate(names) if n in CALLBACK_ALIASES]
        if not alias_indices:
            return updated

        # If a callback alias exists but is not the last positional param, record precondition.
        if alias_indices[-1] != len(names) - 1:
            self.preconditions.append(
                {
                    "id": f"last-positional:{updated.name.value}",
                    "satisfied": False,
                    "reason": "callback must be the last positional parameter",
                }
            )
            return updated

        # callback is the last positional param
        name = names[-1]

        if _has_yield(updated.body):
            self.preconditions.append(
                {
                    "id": f"not-generator:{updated.name.value}",
                    "satisfied": False,
                    "reason": "function is a generator (contains yield)",
                }
            )
            return updated

        n_calls = _count_callback_calls(updated.body, name)
        if n_calls != 1:
            self.preconditions.append(
                {
                    "id": f"single-call:{updated.name.value}",
                    "satisfied": False,
                    "reason": f"callback called {n_calls} times, must be exactly once",
                }
            )
            return updated

        # Strip callback param and clear trailing comma on the new last param.
        kept = list(updated.params.params[:-1])
        if kept:
            kept[-1] = kept[-1].with_changes(comma=cst.MaybeSentinel.DEFAULT)
        new_params = updated.params.with_changes(params=tuple(kept))

        # Replace callback(X) with return X anywhere in body.
        class Replacer(cst.CSTTransformer):
            def leave_SimpleStatementLine(self, orig, upd):
                if len(upd.body) == 1 and isinstance(upd.body[0], cst.Expr):
                    expr = upd.body[0].value
                    if (
                        isinstance(expr, cst.Call)
                        and isinstance(expr.func, cst.Name)
                        and expr.func.value == name
                    ):
                        if len(expr.args) >= 1:
                            return cst.SimpleStatementLine(
                                body=[cst.Return(value=expr.args[0].value)]
                            )
                return upd

        new_body = updated.body.visit(Replacer())
        self.changed = True
        self.preconditions.append(
            {"id": f"converted:{updated.name.value}", "satisfied": True}
        )
        return updated.with_changes(
            asynchronous=cst.Asynchronous(),
            params=new_params,
            body=new_body,
        )


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: callback_to_async_await.py <file>")
        return
    path = sys.argv[1]
    src = read_source(path)
    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    # Pre-flight: if a function is already async and has a callback alias as last
    # positional param, record `not-already-async` precondition (skip).
    early_pre = []
    for func in m.findall(module, m.FunctionDef()):
        if func.asynchronous is not None and func.params.params:
            last = func.params.params[-1].name.value
            if last in CALLBACK_ALIASES:
                early_pre.append(
                    {
                        "id": f"not-already-async:{func.name.value}",
                        "satisfied": False,
                        "reason": "function is already async",
                    }
                )

    visitor = CallbackToAsyncTransformer()
    new_module = module.visit(visitor)
    preconditions = early_pre + visitor.preconditions
    if not visitor.changed and not early_pre and not visitor.preconditions:
        # No callback patterns matched at all.
        emit(ok=True, new_content="", preconditions=preconditions)
        return
    if not visitor.changed:
        # Patterns matched but preconditions failed — return empty newContent.
        emit(ok=True, new_content="", preconditions=preconditions)
        return
    emit(ok=True, new_content=new_module.code, preconditions=preconditions)


if __name__ == "__main__":
    main()
