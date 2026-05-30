import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _base import read_source, emit  # noqa: E402

import libcst as cst  # noqa: E402
import libcst.matchers as m  # noqa: E402

from _typing_cleanup import _top_insertion_index  # noqa: E402


def _bases_are_only_object(cls: cst.ClassDef) -> bool:
    if not cls.bases:
        return True
    if len(cls.bases) != 1:
        return False
    arg = cls.bases[0].value
    return isinstance(arg, cst.Name) and arg.value == "object"


def _check_class(cls: cst.ClassDef):
    """Return list of field names if convertible; otherwise None."""
    if not _bases_are_only_object(cls):
        return None

    if not isinstance(cls.body, cst.IndentedBlock):
        return None

    # Collect top-level class-body statements (FunctionDef / SimpleStatementLine).
    methods = []
    assignments = []
    for stmt in cls.body.body:
        if isinstance(stmt, cst.FunctionDef):
            methods.append(stmt)
        elif isinstance(stmt, cst.SimpleStatementLine):
            for small in stmt.body:
                # Reject __slots__ at class scope.
                if isinstance(small, cst.Assign):
                    for tgt in small.targets:
                        if (
                            isinstance(tgt.target, cst.Name)
                            and tgt.target.value == "__slots__"
                        ):
                            return None
                    assignments.append(small)

    if len(methods) != 1:
        return None
    init = methods[0]
    if init.name.value != "__init__":
        return None

    # Must not be async or have decorators (keep semantics simple).
    if init.asynchronous is not None:
        return None
    if init.decorators:
        return None

    params = init.params.params
    if not params:
        return None
    if params[0].name.value != "self":
        return None
    # Reject *args, **kwargs, kw-only.
    if init.params.star_arg is not None and not isinstance(
        init.params.star_arg, cst.MaybeSentinel
    ):
        return None
    if init.params.star_kwarg is not None:
        return None
    if init.params.kwonly_params:
        return None
    if init.params.posonly_params:
        return None
    field_names = [p.name.value for p in params[1:]]

    # Reject params with defaults to keep field generation simple.
    for p in params[1:]:
        if p.default is not None:
            return None

    # Inspect init body: must be exactly N self.x = x assignments, in order.
    if not isinstance(init.body, cst.IndentedBlock):
        return None
    body_stmts = []
    for stmt in init.body.body:
        if isinstance(stmt, cst.SimpleStatementLine):
            for small in stmt.body:
                if isinstance(small, cst.Pass):
                    continue
                body_stmts.append(small)
        else:
            return None  # nested if/for/etc not allowed

    if len(body_stmts) != len(field_names):
        return None

    for small, fname in zip(body_stmts, field_names):
        if not isinstance(small, cst.Assign):
            return None
        if len(small.targets) != 1:
            return None
        tgt = small.targets[0].target
        if not (
            isinstance(tgt, cst.Attribute)
            and isinstance(tgt.value, cst.Name)
            and tgt.value.value == "self"
            and tgt.attr.value == fname
        ):
            return None
        val = small.value
        if not (isinstance(val, cst.Name) and val.value == fname):
            return None

    return field_names


class Converter(cst.CSTTransformer):
    def __init__(self):
        self.converted_any = False

    def leave_ClassDef(
        self, original: cst.ClassDef, updated: cst.ClassDef
    ) -> cst.ClassDef:
        fields = _check_class(original)
        if fields is None:
            return updated

        # Build annotated assignments for each field.
        new_body_stmts = []
        for fname in fields:
            ann = cst.AnnAssign(
                target=cst.Name(fname),
                annotation=cst.Annotation(annotation=cst.Name("Any")),
                value=None,
            )
            new_body_stmts.append(cst.SimpleStatementLine(body=[ann]))

        if not new_body_stmts:
            # Empty classes can't be a meaningful dataclass conversion target here.
            return updated

        new_body = updated.body.with_changes(body=tuple(new_body_stmts))
        new_decorators = (cst.Decorator(decorator=cst.Name("dataclass")),) + tuple(
            updated.decorators
        )
        self.converted_any = True
        return updated.with_changes(body=new_body, decorators=new_decorators)


def _has_from_import(module: cst.Module, mod_name: str, name: str) -> bool:
    for imp in m.findall(module, m.ImportFrom()):
        if imp.module is None:
            continue
        if isinstance(imp.module, cst.Name) and imp.module.value == mod_name:
            if isinstance(imp.names, cst.ImportStar):
                return True
            for alias in imp.names:
                if isinstance(alias.name, cst.Name) and alias.name.value == name:
                    return True
    return False


def _inject_imports(module: cst.Module, needed) -> cst.Module:
    new_imports = []
    for mod_name, name in needed:
        if _has_from_import(module, mod_name, name):
            continue
        new_imports.append(
            cst.SimpleStatementLine(
                body=[
                    cst.ImportFrom(
                        module=cst.Name(mod_name),
                        names=[cst.ImportAlias(name=cst.Name(name))],
                    )
                ]
            )
        )
    if not new_imports:
        return module
    insertion_idx = _top_insertion_index(module)
    body = list(module.body)
    body[insertion_idx:insertion_idx] = new_imports
    return module.with_changes(body=tuple(body))


def main():
    if len(sys.argv) < 2:
        emit(ok=False, error="usage: class_to_dataclass.py <file>")
        return
    path = sys.argv[1]
    src = read_source(path)
    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        emit(ok=False, error=f"parse error: {e}")
        return

    # Determine if any class is a candidate (helps decide between "no-op silent"
    # and "preconditions failed, return null").
    classes = list(m.findall(module, m.ClassDef()))
    if not classes:
        emit(ok=True, new_content="", preconditions=[])
        return

    convertible = [c for c in classes if _check_class(c) is not None]

    if not convertible:
        # There were classes but none are convertible — surface a precondition so
        # the wrapper returns null (no change).
        preconditions = [
            {
                "id": "no-convertible-class",
                "satisfied": False,
                "reason": "no class met pure-init criteria",
            }
        ]
        emit(ok=True, new_content="", preconditions=preconditions)
        return

    visitor = Converter()
    new_module = module.visit(visitor)
    if not visitor.converted_any:
        emit(
            ok=True,
            new_content="",
            preconditions=[
                {"id": "no-conversion", "satisfied": False, "reason": "nothing changed"}
            ],
        )
        return

    new_module = _inject_imports(
        new_module, [("dataclasses", "dataclass"), ("typing", "Any")]
    )

    emit(
        ok=True,
        new_content=new_module.code,
        preconditions=[{"id": "converted", "satisfied": True}],
    )


if __name__ == "__main__":
    main()
