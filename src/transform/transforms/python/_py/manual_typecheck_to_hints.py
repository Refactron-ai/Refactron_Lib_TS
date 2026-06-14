import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402

import libcst as cst  # noqa: E402
import libcst.matchers as m  # noqa: E402


def is_isinstance_call(node) -> bool:
    return (
        isinstance(node, cst.Call)
        and isinstance(node.func, cst.Name)
        and node.func.value == "isinstance"
        and len(node.args) >= 2
        and isinstance(node.args[0].value, cst.Name)
        and isinstance(node.args[1].value, cst.Name)
    )


def extract_chain(if_stmt: cst.If):
    """Walk an if/elif chain; return (param_name, [type_name, ...]) or None.

    The chain must consist exclusively of ``isinstance(<same_param>, <Type>)``
    checks. A trailing ``else`` clause is allowed and ignored. An ``elif`` with
    a non-isinstance test, or an isinstance check against a different param,
    causes the chain to be rejected.
    """
    if not is_isinstance_call(if_stmt.test):
        return None
    param_name = if_stmt.test.args[0].value.value
    type_names = [if_stmt.test.args[1].value.value]

    cur = if_stmt
    while cur.orelse is not None:
        nxt = cur.orelse
        if isinstance(nxt, cst.If):
            if not is_isinstance_call(nxt.test):
                return None
            if nxt.test.args[0].value.value != param_name:
                return None
            type_names.append(nxt.test.args[1].value.value)
            cur = nxt
        elif isinstance(nxt, cst.Else):
            # Trailing else is fine; stop walking.
            break
        else:
            return None

    return param_name, type_names


def _body_stmts_no_pass(body: cst.IndentedBlock):
    out = []
    for stmt in body.body:
        if (
            isinstance(stmt, cst.SimpleStatementLine)
            and len(stmt.body) == 1
            and isinstance(stmt.body[0], cst.Pass)
        ):
            continue
        out.append(stmt)
    return out


def _has_typing_union_import(module: cst.Module) -> bool:
    for node in m.findall(module, m.ImportFrom()):
        mod_name = node.module
        if isinstance(mod_name, cst.Name) and mod_name.value == "typing":
            if isinstance(node.names, cst.ImportStar):
                return True
            for alias in node.names:
                if isinstance(alias.name, cst.Name) and alias.name.value == "Union":
                    return True
    return False


def _function_has_isinstance_signal(func: cst.FunctionDef) -> bool:
    """True iff the function body contains at least one ``isinstance(<Name>, <Name>)``
    call — the shape the rewriter knows how to convert into a ``Union[...]``
    annotation. Gates precondition emission so unrelated siblings in the same
    file stay silent (otherwise a 50-function file would log 49 spurious
    refusals around the one real candidate, drowning the signal).
    """
    for call in m.findall(func, m.Call(func=m.Name("isinstance"))):
        if is_isinstance_call(call):
            return True
    return False


class Annotator(cst.CSTTransformer):
    def __init__(self):
        self.preconditions = []
        self.changed = False
        self.needs_union_import = False

    def leave_FunctionDef(
        self, original: cst.FunctionDef, updated: cst.FunctionDef
    ) -> cst.FunctionDef:
        # Only emit refusal records for functions that LOOK like candidates
        # (have at least one isinstance(Name, Name) call). Without this gate
        # every silently-walked-past function would generate noise.
        is_candidate = _function_has_isinstance_signal(updated)
        funcname = updated.name.value

        body = updated.body
        if not isinstance(body, cst.IndentedBlock):
            if is_candidate:
                self.preconditions.append(
                    {
                        "id": f"non-block-body:{funcname}",
                        "satisfied": False,
                        "reason": f"function {funcname} body is not a standard indented block",
                    }
                )
            return updated
        meaningful = _body_stmts_no_pass(body)
        if len(meaningful) != 1:
            if is_candidate:
                self.preconditions.append(
                    {
                        "id": f"body-not-pure-dispatcher:{funcname}",
                        "satisfied": False,
                        "reason": (
                            f"function {funcname} body has {len(meaningful)} statements; "
                            "rewriter requires the isinstance chain to be the sole body "
                            "statement (a docstring or guard clause blocks the rewrite)"
                        ),
                    }
                )
            return updated
        only = meaningful[0]
        if not isinstance(only, cst.If):
            if is_candidate:
                self.preconditions.append(
                    {
                        "id": f"lone-statement-not-if:{funcname}",
                        "satisfied": False,
                        "reason": (
                            f"function {funcname}'s lone body statement is not an "
                            "if/elif chain — isinstance check appears outside a dispatcher"
                        ),
                    }
                )
            return updated

        chain = extract_chain(only)
        if chain is None:
            self.preconditions.append(
                {
                    "id": f"single-param-chain:{funcname}",
                    "satisfied": False,
                    "reason": "isinstance chain does not discriminate a single parameter",
                }
            )
            return updated
        param_name, type_names = chain

        # Locate the matching parameter and verify it's not already annotated.
        params = list(updated.params.params)
        target_idx = None
        for i, p in enumerate(params):
            if p.name.value == param_name:
                target_idx = i
                break
        if target_idx is None:
            self.preconditions.append(
                {
                    "id": f"param-not-in-signature:{funcname}:{param_name}",
                    "satisfied": False,
                    "reason": (
                        f"isinstance chain discriminates '{param_name}' which is not "
                        f"a parameter of {funcname}"
                    ),
                }
            )
            return updated

        target = params[target_idx]
        if target.annotation is not None:
            self.preconditions.append(
                {
                    "id": f"already-annotated:{updated.name.value}:{param_name}",
                    "satisfied": False,
                    "reason": f"parameter {param_name} already has a type annotation",
                }
            )
            return updated

        # Build Union[T1, T2, ...] (or a bare type if only one).
        if len(type_names) == 1:
            anno_value = cst.Name(type_names[0])
        else:
            anno_value = cst.Subscript(
                value=cst.Name("Union"),
                slice=tuple(
                    cst.SubscriptElement(slice=cst.Index(value=cst.Name(t)))
                    for t in type_names
                ),
            )
            self.needs_union_import = True

        new_param = target.with_changes(annotation=cst.Annotation(annotation=anno_value))
        params[target_idx] = new_param
        new_params = updated.params.with_changes(params=tuple(params))
        self.changed = True
        self.preconditions.append(
            {
                "id": f"annotated:{updated.name.value}:{param_name}",
                "satisfied": True,
            }
        )
        return updated.with_changes(params=new_params)


def _prepend_union_import(module: cst.Module) -> cst.Module:
    import_line = cst.SimpleStatementLine(
        body=[
            cst.ImportFrom(
                module=cst.Name("typing"),
                names=[cst.ImportAlias(name=cst.Name("Union"))],
            )
        ]
    )
    return module.with_changes(body=(import_line, *module.body))


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: manual_typecheck_to_hints.py <file>")
        return
    path = sys.argv[1]
    src = read_source(path)
    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    visitor = Annotator()
    new_module = module.visit(visitor)

    if not visitor.changed:
        emit(ok=True, new_content="", preconditions=visitor.preconditions)
        return

    if visitor.needs_union_import and not _has_typing_union_import(new_module):
        new_module = _prepend_union_import(new_module)

    emit(ok=True, new_content=new_module.code, preconditions=visitor.preconditions)


if __name__ == "__main__":
    main()
