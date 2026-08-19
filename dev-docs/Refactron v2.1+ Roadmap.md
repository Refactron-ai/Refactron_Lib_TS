# Refactron v2.1+ Roadmap: Candidate AST Transforms for Python and TypeScript/JavaScript

## TL;DR
- **Python**: Ship 18 new deterministic transforms grouped by Pyupgrade/Ruff-UP heritage, PEP 585/604 type modernization, pathlib adoption, and context-manager safety; the highest-leverage v2.1 wins are `pep585_generics`, `pep604_optional_union`, `super_no_args`, `typing_namedtuple_class_syntax`, `percent_to_format_to_fstring`, `open_to_with_context`, and `lru_cache_to_cache`.
- **TypeScript/JavaScript** (incl. React, Vue, Node): Ship 19 new transforms led by `indexOf_to_includes`, `object_assign_to_spread`, `string_concat_to_template_literal`, `react_class_to_function_component` (only safe variants), and `vue2_options_to_composition_api` (structural only, not template).
- **Reject as v2.x candidates**: jQuery-to-vanilla (too contested), Vue `$on`/`$off` removal (requires adding `mitt` as a new dependency), generic React `useEffect` dependency array inference (LLM-judgment required), `.map().filter()` reshuffling (contested), and Angular version-specific upgrades (too version-fragmented to ship a single transform).

---

# Section 1: PYTHON

## Python summary table

| Rank | transform_id | Frequency | Difficulty | Effort (days) | Existing tool coverage |
|------|--------------|-----------|------------|---------------|------------------------|
| 1 | pep585_generics | High | Easy | 2 | Complete (pyupgrade `--py39-plus`; Ruff UP006) |
| 2 | pep604_optional_union | High | Easy | 2 | Complete (pyupgrade `--py310-plus`; Ruff UP007 + UP045) |
| 3 | super_no_args | High | Easy | 1 | Complete (pyupgrade; Ruff UP008) |
| 4 | percent_to_format_to_fstring | High | Medium | 3 | Partial (pyupgrade is "intentionally timid"; LibCST `ConvertFormatStringCommand` handles `.format`) |
| 5 | typing_namedtuple_class_syntax | High | Medium | 3 | Complete for `typing.NamedTuple` functional form (pyupgrade `--py36-plus`); none for `collections.namedtuple` |
| 6 | open_to_with_context | High | Medium | 4 | None mechanical (Bandit warns; no autofix) |
| 7 | os_path_to_pathlib | High | Hard | 7 | None mechanical (refurb partial) |
| 8 | range_len_to_enumerate | High | Easy | 2 | Partial (Ruff PLR1736 detects; flake8-comprehensions hints) |
| 9 | for_append_to_list_comprehension | High | Medium | 4 | Partial (Ruff PERF401 detects; no safe autofix) |
| 10 | lru_cache_to_cache | High | Easy | 1 | Complete (pyupgrade `--py39-plus`; Ruff UP033) |
| 11 | datetime_utc_alias | Med | Easy | 1 | Complete (pyupgrade `--py311-plus`; Ruff UP017) |
| 12 | subprocess_text_capture_output | Med | Easy | 2 | Complete (pyupgrade `--py37-plus`) |
| 13 | yield_from_for_loop | Med | Easy | 2 | Complete (pyupgrade; Ruff UP028) |
| 14 | contextlib_suppress | Med | Medium | 3 | Partial (Ruff SIM105 detects with autofix) |
| 15 | raise_from_exception_chaining | Med | Medium | 4 | Partial (Ruff B904 detects) |
| 16 | dict_keys_iteration | Med | Easy | 2 | None |
| 17 | isinstance_chain_to_match | Low-Med | Hard | 10 | None |
| 18 | namedtuple_to_typing_namedtuple | Med | Medium | 4 | Partial (pylint R6105 detects only) |

---

## 1. pep585_generics
**Pattern**: `List[X]`, `Dict[K,V]`, `Tuple[X,...]`, `Set[X]`, `FrozenSet[X]`, `Type[X]` from `typing` rewritten to built-in lowercase generics `list[X]`, `dict[K,V]`, etc.

**Before**:
```python
from typing import List, Dict, Optional, Tuple

def process_records(items: List[Dict[str, int]], limit: Optional[int] = None) -> Tuple[List[str], int]:
    results: List[str] = []
    for item in items:
        results.append(str(item))
    return results, len(results)
```

**After**:
```python
from __future__ import annotations

def process_records(items: list[dict[str, int]], limit: int | None = None) -> tuple[list[str], int]:
    results: list[str] = []
    for item in items:
        results.append(str(item))
    return results, len(results)
```

**Why upgrade**: PEP 585 (Python 3.9+) deprecates capitalized generic aliases in `typing`. They will be removed in a future version. The lowercase forms are also shorter and require no import.

**Preconditions**:
1. Target Python version is 3.9+ (read from `pyproject.toml` `requires-python` or CLI flag).
2. Either runtime evaluation of annotations is not required, OR the file imports `from __future__ import annotations`.
3. The name (`List`, `Dict`, etc.) is imported from `typing`, not aliased to something else.
4. The name is not used in runtime contexts (e.g., `isinstance(x, List)`) — these would break.
5. No string-quoted forward references like `'List[int]'` that the rewriter cannot reach.

**Edge cases that BLOCK**:
- File contains `typing.get_type_hints()` calls that require runtime resolution without `from __future__ import annotations`.
- Use inside dataclass with `eq=True` and a default factory that needs runtime types.
- Pydantic v1 models where `List[X]` is evaluated at runtime (Pydantic v2 is fine).
- Targets below Python 3.9 without `from __future__ import annotations`.

**Frequency**: Very high. Pyupgrade's `--py39-plus` flag and Ruff's UP006 are among the most-applied rules in CI. Pyupgrade carries exactly 4.1k GitHub stars as confirmed across multiple repo snapshots and is widely adopted via pre-commit; Ruff (which re-implements pyupgrade under the UP prefix) sits at 47.6k GitHub stars as of May 2026 per its release page for v0.15.13.

**Difficulty**: Easy. Pure import + name substitution with one global config check.

**Effort**: 2 days.

**Existing tool coverage**: Complete. Pyupgrade `--py39-plus` per its README; Ruff's UP006. Confirmed in pyupgrade README: "pep 585 typing rewrites ... `--py39-plus` is passed on the commandline."

---

## 2. pep604_optional_union
**Pattern**: `Optional[X]` → `X | None`; `Union[A, B]` → `A | B`.

**Before**:
```python
from typing import Optional, Union

def fetch(user_id: Union[int, str]) -> Optional[dict]:
    if not user_id:
        return None
    return {"id": user_id}
```

**After**:
```python
from __future__ import annotations

def fetch(user_id: int | str) -> dict | None:
    if not user_id:
        return None
    return {"id": user_id}
```

**Why upgrade**: PEP 604 (Python 3.10+) introduces the `X | Y` syntax. It is shorter, requires no import, and is consistent with `isinstance(x, int | str)` syntax.

**Preconditions**:
1. Target Python version is 3.10+ for runtime use, or any 3.x with `from __future__ import annotations`.
2. `Optional` / `Union` imported from `typing` (not redefined).
3. No string-quoted use that the transformer cannot reach safely.
4. The annotation is not used at runtime via `typing.get_type_hints` without `from __future__`.

**Edge cases that BLOCK**:
- Use in `typing.cast(Union[X,Y], val)` runtime calls under <3.10 (would break).
- Pydantic v1 models on Python 3.9 (Pydantic v1 evaluates annotations).
- TypedDict total-fields and overloaded callables that mypy/pyright might fail to narrow consistently.

**Frequency**: High. Ruff UP007 (Union) and UP045 (Optional) are widely enabled; Ruff v0.9.0 split UP007 into UP007 + UP045 to allow the two rewrites to be configured separately.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: Complete. Pyupgrade README: "pep 604 typing rewrites ... `--py310-plus` is passed on the commandline." Ruff UP007 + UP045.

---

## 3. super_no_args
**Pattern**: `super(ClassName, self).method()` → `super().method()`.

**Before**:
```python
class APIView(BaseView):
    def __init__(self, *args, **kwargs):
        super(APIView, self).__init__(*args, **kwargs)
        self.cache = {}

    def dispatch(self, request):
        return super(APIView, self).dispatch(request)
```

**After**:
```python
class APIView(BaseView):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cache = {}

    def dispatch(self, request):
        return super().dispatch(request)
```

**Why upgrade**: Python 3 zero-argument `super()` is shorter, less error-prone (no class-rename bug), and idiomatic. Pyupgrade has shipped this rewrite for years.

**Preconditions**:
1. Inside a method whose first parameter is `self` (or `cls` for classmethod).
2. The class name argument matches the enclosing class.
3. Not inside a nested class where the lexical class would be different.
4. Method is not a staticmethod.

**Edge cases that BLOCK**:
- `super(GrandparentClass, self)` — explicit MRO skip; rewriting would change semantics.
- Calls inside decorators applied to the class definition.

**Frequency**: Very high in code 5+ years old (Python 2 compatibility holdover).

**Difficulty**: Easy.

**Effort**: 1 day.

**Existing tool coverage**: Complete. Pyupgrade `super()` rewriter; Ruff UP008.

---

## 4. percent_to_format_to_fstring
**Pattern**: Replace both `'%s' % (a,)` printf-style and `'{}'.format(a, b)` calls with f-strings where safe.

**Before**:
```python
name, age = "Alice", 30
msg1 = "Hello %s, you are %d" % (name, age)
msg2 = "Hello {}, you are {}".format(name, age)
msg3 = "Hello {n}, you are {a}".format(n=name, a=age)
logger.info("User %s logged in from %s" % (user, ip))
```

**After**:
```python
name, age = "Alice", 30
msg1 = f"Hello {name}, you are {age}"
msg2 = f"Hello {name}, you are {age}"
msg3 = f"Hello {name}, you are {age}"
logger.info("User %s logged in from %s", user, ip)  # left alone: lazy logging
```

**Why upgrade**: f-strings are faster (no method call), more readable, and harder to mismatch arguments. Python 3.6+.

**Preconditions**:
1. Target Python is 3.6+.
2. Substitution arguments are simple expressions (no side effects in arg evaluation).
3. The combined f-string would not exceed a configurable length threshold.
4. Format specifiers are representable in f-string syntax.
5. The call is not a logging method call with a `%`-format pattern (which would eagerly evaluate even when log level is off).
6. No `**locals()` expansion to keys not statically resolvable.

**Edge cases that BLOCK**:
- `logger.debug("%s" % x)` — must be `logger.debug("%s", x)` for lazy evaluation, not an f-string.
- Translated strings (`gettext("Hello %s") % name`) — break i18n extraction.
- `.format(**some_dict)` where the dict is dynamic.
- Strings with format spec that uses `*` runtime width arguments.

**Frequency**: Very high. The pyupgrade README states verbatim: "pyupgrade is intentionally timid and will not create an f-string if it would make the expression longer or if the substitution parameters are sufficiently complicated (as this can decrease readability)." LibCST ships a dedicated `ConvertFormatStringCommand` documented in its tutorial. The fact that two major tools both ship this and constrain it shows the precondition surface is real.

**Difficulty**: Medium.

**Effort**: 3 days.

**Existing tool coverage**: Partial. Pyupgrade handles `.format()` and `%` → f-string but is timid (per its README's f-strings section). LibCST has `ConvertFormatStringCommand`. Neither handles the logging case correctly.

---

## 5. typing_namedtuple_class_syntax
**Pattern**: Functional `typing.NamedTuple(...)` and `collections.namedtuple(...)` calls rewritten to `class X(typing.NamedTuple)` form.

**Before**:
```python
from collections import namedtuple
from typing import Tuple

Point = namedtuple("Point", ["x", "y"])
Box = namedtuple("Box", "top left bottom right")
```

**After**:
```python
from typing import NamedTuple, Tuple

class Point(NamedTuple):
    x: int
    y: int

class Box(NamedTuple):
    top: int
    left: int
    bottom: int
    right: int
```

**Why upgrade**: Adds type annotations, allows docstrings, allows methods, and IDE introspection improves dramatically. Pylint emits message `prefer-typing-namedtuple` (R6105) for exactly this; Pylint detects but does not autofix.

**Preconditions**:
1. Target Python 3.6+.
2. `namedtuple` arguments are static string literals or list/tuple literals.
3. Field names are valid identifiers.
4. Class name matches the variable name (otherwise pickling can break).
5. No `rename=True` argument (would change field semantics).
6. The result is not subclassed multiple times in a hierarchy that depends on the functional form.

**Edge cases that BLOCK**:
- `defaults=` argument — needs ordered translation to class body with defaults.
- `module=` argument that pins pickling location.
- Pickled instances stored on disk that reference the original `__qualname__`.

**Frequency**: High in code 5+ years old. Pyupgrade `--py36-plus` handles the `typing.NamedTuple` functional form (confirmed in README); the `collections.namedtuple` → `typing.NamedTuple` conversion is NOT mechanically handled by pyupgrade, only Pylint R6105 detects it.

**Difficulty**: Medium (when adding type hints; type defaults to `Any` for legacy `namedtuple`).

**Effort**: 3 days.

**Existing tool coverage**: Partial. Pyupgrade complete for `typing.NamedTuple` functional form. None for `collections.namedtuple` rewrite.

---

## 6. open_to_with_context
**Pattern**: `open(...)` calls whose result is bound to a variable that is later `.close()`-d (or just leaked) → `with open(...) as f:` block.

**Before**:
```python
def load_config(path):
    f = open(path, "r")
    data = f.read()
    f.close()
    return parse(data)

def write_log(line):
    f = open("/tmp/log", "a")
    f.write(line + "\n")
    f.close()
```

**After**:
```python
def load_config(path):
    with open(path, "r") as f:
        data = f.read()
    return parse(data)

def write_log(line):
    with open("/tmp/log", "a") as f:
        f.write(line + "\n")
```

**Why upgrade**: Guarantees file descriptor cleanup on exception. The CPython documentation has long recommended `with` blocks. Bandit lint warns on the unguarded form.

**Preconditions**:
1. `open()` return is bound to a single local name (not captured in a closure).
2. The variable is `.close()`-d in the same function scope, OR the flow is simple enough to span the lifetime in a `with`.
3. The variable is not passed to another function that holds a reference beyond the call.
4. No exception handlers around the close that need to remain.
5. The variable is not reassigned mid-function.
6. All uses occur in a single contiguous block (or can be moved into one).

**Edge cases that BLOCK**:
- File handle returned from the function.
- File handle stored on an object attribute (long-lived).
- Multiple opens with conditional close.
- Use of `os.fdopen(fd)` where the fd lifecycle is externally managed.
- `tempfile.NamedTemporaryFile(delete=False)` — close semantics differ.

**Frequency**: High in scripts and older codebases. No tool ships a mechanical autofix; Bandit detects but cannot rewrite.

**Difficulty**: Medium (control-flow analysis required).

**Effort**: 4 days.

**Existing tool coverage**: None mechanical.

---

## 7. os_path_to_pathlib
**Pattern**: `os.path.join`, `os.path.exists`, `os.path.dirname`, `os.path.basename`, `os.path.splitext`, `os.makedirs(exist_ok=...)` patterns to `pathlib.Path` operations.

**Before**:
```python
import os

file_path = os.path.join("data", "raw", "input.csv")
if os.path.exists(file_path):
    name = os.path.basename(file_path)
    ext = os.path.splitext(file_path)[1]
    parent = os.path.dirname(file_path)
os.makedirs(os.path.join("out", "logs"), exist_ok=True)
```

**After**:
```python
from pathlib import Path

file_path = Path("data") / "raw" / "input.csv"
if file_path.exists():
    name = file_path.name
    ext = file_path.suffix
    parent = file_path.parent
(Path("out") / "logs").mkdir(parents=True, exist_ok=True)
```

**Why upgrade**: pathlib is documented as the modern idiom; it is cross-platform safe (Trey Hunner's "Why you should be using pathlib" makes the canonical case); chainable; objects rather than strings. Available since Python 3.4 and standard since 3.6.

**Preconditions**:
1. The `os.path` function calls have no surrounding string manipulation that depends on string identity.
2. The result is not passed to a third-party API that requires `str` (or, if so, wrap in `str(...)`).
3. The variable is not later concatenated with `os.sep` or path separator characters manually.
4. The transformation does not span function boundaries (do per-function).
5. No mixing with `os.path.realpath` chains that change semantics under symlinks differently in pathlib.

**Edge cases that BLOCK**:
- Code that passes strings to libraries pre-Python 3.6 (older `subprocess` versions).
- Mixed usage with `glob.glob` that's tested by string equality elsewhere.
- Code that uses `os.fspath` for explicit string coercion (acceptable bridge).
- Win32 normalization quirks where `os.path.normpath` behavior differs from `Path.resolve`.

**Frequency**: Very high. Trey Hunner's "Why you should be using pathlib" (treyhunner.com) and the Python Snacks blog explicitly recommend pathlib over os.path for all new code. No major tool implements an automated codemod.

**Difficulty**: Hard. Requires per-call rewrite rules, careful import management, and handling of mixed string/Path call sites.

**Effort**: 7 days minimum, likely 10.

**Existing tool coverage**: None mechanical. Refurb has partial detection.

---

## 8. range_len_to_enumerate
**Pattern**: `for i in range(len(seq))` loops that index into `seq[i]` → `for i, item in enumerate(seq)`.

**Before**:
```python
def find_duplicates(items):
    duplicates = []
    for i in range(len(items)):
        for j in range(len(items)):
            if i != j and items[i] == items[j]:
                duplicates.append(items[i])
    return duplicates
```

**After**:
```python
def find_duplicates(items):
    duplicates = []
    for i, item_i in enumerate(items):
        for j, item_j in enumerate(items):
            if i != j and item_i == item_j:
                duplicates.append(item_i)
    return duplicates
```

**Why upgrade**: Avoids double-indexing, is faster, idiomatic. Ruff PLR1736 detects this case.

**Preconditions**:
1. The loop body uses `seq[i]` at least once.
2. The loop variable `i` is only used as an index into the same sequence.
3. The sequence is not mutated inside the loop (length changes).
4. The sequence is not reassigned inside the loop.
5. The variable name `i` is not used after the loop in a way that requires the integer alone.

**Edge cases that BLOCK**:
- Body modifies `seq` (e.g., `seq.append(seq[i])`).
- `i` is passed as an argument elsewhere where the integer matters.
- Multiple sequences indexed by the same `i` (`a[i], b[i], c[i]`) — `zip` may be better.

**Frequency**: High in Python codebases written by developers transitioning from C/Java.

**Difficulty**: Easy with proper data-flow check.

**Effort**: 2 days.

**Existing tool coverage**: Partial. Ruff PLR1736 detects without safe autofix; flake8-comprehensions hints.

---

## 9. for_append_to_list_comprehension
**Pattern**: Simple `result = []; for x in xs: result.append(f(x))` → `result = [f(x) for x in xs]`.

**Before**:
```python
def get_active_user_names(users):
    names = []
    for user in users:
        if user.is_active:
            names.append(user.name.upper())
    return names
```

**After**:
```python
def get_active_user_names(users):
    return [user.name.upper() for user in users if user.is_active]
```

**Why upgrade**: Comprehensions are faster (bytecode-optimized), more declarative, and the Python docs recommend them for simple transformations.

**Preconditions**:
1. The accumulator list is declared empty and only appended to inside the loop.
2. The loop body is a single `if/else` with a single `append` per branch.
3. No `break`, `continue`, or early return that does not map to a comprehension `if`.
4. No side effects inside the appended expression.
5. The list is not read inside the loop.

**Edge cases that BLOCK**:
- Loop body has multiple statements (only one is `append`).
- Conditional with both `if` and `elif` and `append` in each — possible but harder.
- `try/except` inside the loop body.
- Nested loops where only the inner appends — `[... for outer in xs for inner in ys]` is fine but requires more analysis.
- Generator side effects (logging, counters).

**Frequency**: High.

**Difficulty**: Medium.

**Effort**: 4 days.

**Existing tool coverage**: Partial. Ruff PERF401 detects but does not safely autofix.

---

## 10. lru_cache_to_cache
**Pattern**: `@functools.lru_cache(maxsize=None)` → `@functools.cache`.

**Before**:
```python
import functools

@functools.lru_cache(maxsize=None)
def expensive(x):
    return slow_computation(x)
```

**After**:
```python
import functools

@functools.cache
def expensive(x):
    return slow_computation(x)
```

**Why upgrade**: `functools.cache` was added in 3.9 specifically as shorthand for unbounded LRU cache. Shorter; expresses intent more clearly.

**Preconditions**:
1. Target Python 3.9+.
2. `maxsize=None` literal argument is the only argument.
3. No `typed=True` argument (different semantics).

**Edge cases that BLOCK**:
- `lru_cache(maxsize=None, typed=True)` — needs `cache(typed=True)` if added later; current `cache` API differs.
- `lru_cache()` without arguments (means `maxsize=128`, not equivalent).

**Frequency**: High in services that use memoization.

**Difficulty**: Easy.

**Effort**: 1 day.

**Existing tool coverage**: Complete. Pyupgrade `--py39-plus` per README; Ruff UP033.

---

## 11. datetime_utc_alias
**Pattern**: `datetime.timezone.utc` → `datetime.UTC` (Python 3.11+).

**Before**:
```python
import datetime
now = datetime.datetime.now(datetime.timezone.utc)
```

**After**:
```python
import datetime
now = datetime.datetime.now(datetime.UTC)
```

**Why upgrade**: `datetime.UTC` is the modern shorthand introduced in 3.11.

**Preconditions**:
1. Target Python 3.11+.
2. Imported as `datetime` (not aliased).
3. Not running on a frozen Python distribution that lacks the alias.

**Edge cases that BLOCK**:
- `from datetime import timezone; timezone.utc` — different access pattern but handleable.
- Code that needs to support 3.10 and earlier.

**Frequency**: Medium.

**Difficulty**: Easy.

**Effort**: 1 day.

**Existing tool coverage**: Complete. Pyupgrade `--py311-plus` per README; Ruff UP017.

---

## 12. subprocess_text_capture_output
**Pattern**: `subprocess.run(..., universal_newlines=True)` → `text=True`; `subprocess.run(..., stdout=PIPE, stderr=PIPE)` → `capture_output=True`.

**Before**:
```python
result = subprocess.run(["foo"], universal_newlines=True)
out = subprocess.run(["bar"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
```

**After**:
```python
result = subprocess.run(["foo"], text=True)
out = subprocess.run(["bar"], capture_output=True)
```

**Why upgrade**: 3.7+ shorthand; clearer intent.

**Preconditions**:
1. Target Python 3.7+.
2. The call is `subprocess.run` (not the lower-level Popen).
3. Both PIPE arguments present together (for `capture_output`).
4. No `stdin=PIPE` mixed in (`capture_output` only covers stdout/stderr).

**Edge cases that BLOCK**:
- `subprocess.check_output` (different API).
- Mixed pipe targets like `stderr=STDOUT`.

**Frequency**: Medium.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: Complete. Pyupgrade `--py37-plus` per README.

---

## 13. yield_from_for_loop
**Pattern**: `for x in y: yield x` → `yield from y`.

**Before**:
```python
def chain(*iterables):
    for it in iterables:
        for x in it:
            yield x
```

**After**:
```python
def chain(*iterables):
    for it in iterables:
        yield from it
```

**Why upgrade**: `yield from` correctly delegates `.send()` / `.throw()` for sub-generators and is shorter.

**Preconditions**:
1. The loop body is exactly `yield <loop_var>` or `yield (a, b)` where the tuple matches the loop unpacking.
2. The loop variable is not used after the yield.
3. The function is a generator.
4. No `try/finally` around the yield that affects sub-generator semantics differently.

**Edge cases that BLOCK**:
- `yield processed(x)` where the body does work.
- Generator that must catch StopIteration from the inner generator.

**Frequency**: Medium.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: Complete. Pyupgrade per README; Ruff UP028.

---

## 14. contextlib_suppress
**Pattern**: `try: x = f(); except SomeError: pass` → `with contextlib.suppress(SomeError): x = f()`.

**Before**:
```python
import os
try:
    os.remove(path)
except FileNotFoundError:
    pass
```

**After**:
```python
import contextlib
import os
with contextlib.suppress(FileNotFoundError):
    os.remove(path)
```

**Why upgrade**: Clearer intent; standard library recommends `contextlib.suppress` for this pattern.

**Preconditions**:
1. The except clause body is exactly `pass`.
2. No `else` or `finally` clause.
3. The exception type is a known concrete exception (not `Exception`).
4. The try body has a single statement or is representable as a `with`-bound block.

**Edge cases that BLOCK**:
- `except (E1, E2):` — tuple form is handleable but multi-line.
- Try body has multiple statements (still doable; just wraps the block).
- `except:` bare except (refuse to transform).

**Frequency**: Medium.

**Difficulty**: Medium.

**Effort**: 3 days.

**Existing tool coverage**: Partial. Ruff SIM105 detects with safe autofix.

---

## 15. raise_from_exception_chaining
**Pattern**: Inside `except E1 as e:` raising a new exception → `raise NewError(...) from e`.

**Before**:
```python
def parse(s):
    try:
        return int(s)
    except ValueError:
        raise CustomError(f"Bad input: {s}")
```

**After**:
```python
def parse(s):
    try:
        return int(s)
    except ValueError as e:
        raise CustomError(f"Bad input: {s}") from e
```

**Why upgrade**: Preserves the original traceback context (PEP 3134); makes debugging dramatically easier.

**Preconditions**:
1. The raise statement is inside an `except` clause.
2. The except clause does not already use `from` or `from None`.
3. If the except has no `as <name>`, the transform adds one.
4. The raised exception is constructed in place (not just `raise e` re-raising).

**Edge cases that BLOCK**:
- `raise` (bare re-raise) inside except — leave alone.
- Custom exception base classes that override `__cause__`.
- `except` clauses that intentionally suppress the cause for security/PII reasons (would need an opt-out comment marker).

**Frequency**: Medium-high in libraries that wrap third-party errors.

**Difficulty**: Medium.

**Effort**: 4 days.

**Existing tool coverage**: Partial. Ruff B904 detects.

---

## 16. dict_keys_iteration
**Pattern**: `for k in d.keys():` → `for k in d:`; `if x in d.keys():` → `if x in d:`.

**Before**:
```python
def count_items(d):
    total = 0
    for k in d.keys():
        if k in valid.keys():
            total += d[k]
    return total
```

**After**:
```python
def count_items(d):
    total = 0
    for k in d:
        if k in valid:
            total += d[k]
    return total
```

**Why upgrade**: Iterating a dict directly is idiomatic; `.keys()` adds an unnecessary view object.

**Preconditions**:
1. The value `d` is statically inferable as a `dict` (or annotated as such).
2. `.keys()` is called with no arguments.
3. The result is used only as an iterable / for membership check (not stored in a variable, since `.keys()` returns a live view).

**Edge cases that BLOCK**:
- The result of `.keys()` is stored: `ks = d.keys()` — used later as a set view.
- Custom mapping subclass where `.keys()` is overridden with different semantics.
- The variable type is `OrderedDict` and order semantics matter (note: regular `dict` preserves insertion order since 3.7).

**Frequency**: Medium.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: None mechanically.

---

## 17. isinstance_chain_to_match
**Pattern**: Long chains of `if isinstance(x, A): ... elif isinstance(x, B): ...` → `match x: case A(): ... case B(): ...`.

**Before**:
```python
def handle(event):
    if isinstance(event, Click):
        on_click(event)
    elif isinstance(event, KeyPress):
        on_key(event)
    elif isinstance(event, Resize):
        on_resize(event)
    else:
        on_default(event)
```

**After**:
```python
def handle(event):
    match event:
        case Click():
            on_click(event)
        case KeyPress():
            on_key(event)
        case Resize():
            on_resize(event)
        case _:
            on_default(event)
```

**Why upgrade**: PEP 634 (3.10+) was designed precisely to replace these chains. PEP 635 explicitly cites the isinstance/elif chain pattern as the most common use case targeted by `match`. CPython issue #88442 ("Replace if-elif-else with match-case") remains open.

**Preconditions**:
1. Target Python 3.10+.
2. All branches use `isinstance(x, ConcreteClass)` where `ConcreteClass` is a simple name (not Tuple or Union).
3. The chain has ≥3 branches (otherwise readability is contested).
4. The subject expression is the same in every `isinstance` call.
5. The subject is a simple variable (not a function call with side effects).
6. No branch uses `and`/`or` with non-isinstance checks (otherwise need guards).
7. Final `else` is preserved as `case _:`.

**Edge cases that BLOCK**:
- `isinstance(x, (A, B))` tuple form — translatable to `case A() | B():` but more complex.
- Branches use the type, e.g., `if isinstance(x, Click): x.position` — pattern matching destructuring helps but needs `__match_args__`.
- Mixed isinstance and other conditions (`elif x is None`).
- Python 2 compatibility shims.

**Frequency**: Low-Medium (3.10 adoption is growing, but most legacy code is still pre-3.10).

**Difficulty**: Hard.

**Effort**: 10 days.

**Existing tool coverage**: None.

---

## 18. namedtuple_to_typing_namedtuple
**Pattern**: As described in #5, the `collections.namedtuple` → `typing.NamedTuple` migration. Pylint R6105 (`prefer-typing-namedtuple`) detects but does not autofix. Listed separately because the precondition surface and effort differ from the `typing.NamedTuple(...)` functional form.

**Effort**: 4 days. See #5 for the example diff and preconditions.

---

# Section 2: TYPESCRIPT / JAVASCRIPT (incl. React, Vue, Node.js)

## TS/JS summary table

| Rank | transform_id | Frequency | Difficulty | Effort (days) | Existing tool coverage |
|------|--------------|-----------|------------|--------|------------------------|
| 1 | indexOf_to_includes | High | Easy | 2 | Complete (eslint-plugin-unicorn `prefer-includes`; `@typescript-eslint/prefer-includes`; eslint-plugin-mozilla `prefer-array-includes`) |
| 2 | object_assign_to_spread | High | Easy | 2 | Complete (ESLint `prefer-object-spread`) |
| 3 | string_concat_to_template_literal | High | Easy | 2 | Complete (ESLint `prefer-template`) |
| 4 | logical_or_to_nullish_coalescing | High | Medium | 4 | Partial (`@typescript-eslint/prefer-nullish-coalescing`; needs type info) |
| 5 | chained_and_to_optional_chain | High | Medium | 4 | Partial (`@typescript-eslint/prefer-optional-chain`; needs type info) |
| 6 | logical_assignment_operators | Med | Easy | 2 | Partial (ESLint `logical-assignment-operators`) |
| 7 | fs_callback_to_promises | High | Medium | 4 | None mechanical |
| 8 | util_promisify_to_native_promise | Med | Hard | 7 | None |
| 9 | typescript_any_to_unknown | High | Medium | 3 | Partial (`@typescript-eslint/no-explicit-any` detects only) |
| 10 | typescript_enum_to_const_object | Med | Hard | 7 | None mechanical |
| 11 | typescript_namespace_to_module | Med | Medium | 4 | Partial (`@typescript-eslint/no-namespace`) |
| 12 | typescript_triple_slash_to_import | Med | Easy | 2 | Partial (`@typescript-eslint/triple-slash-reference`) |
| 13 | react_class_to_function_component | High | Hard | 14+ | Partial (`pure-component` only for render-only) |
| 14 | react_default_props_to_param_defaults | Med | Medium | 4 | None official |
| 15 | react_string_refs_to_useref | Low-Med | Medium | 4 | Yes (`replace-string-ref` in react-codemod for React 19) |
| 16 | react_createelement_to_jsx | Low | Medium | 5 | Complete (react-codemod `create-element-to-jsx`) |
| 17 | vue2_filters_to_method_call | Med | Medium | 5 | None mechanical |
| 18 | vue_set_delete_to_assignment | Med | Easy | 2 | Complete (`@originjs/vue-codemod` `remove-vue-set-and-delete`) |
| 19 | vue2_options_to_composition_api | High | Hard | 14+ | Partial (vue-o2c, Shopware codemod; not 1:1) |

---

## Plain TypeScript / JavaScript

### 1. indexOf_to_includes
**Pattern**: `arr.indexOf(x) !== -1`, `arr.indexOf(x) >= 0`, `arr.indexOf(x) > -1` (and inverses) → `arr.includes(x)`.

**Before**:
```ts
function isValidStatus(s: string): boolean {
  return ["active", "pending", "trial"].indexOf(s) !== -1;
}
function isMissing(arr: string[], item: string): boolean {
  return arr.indexOf(item) === -1;
}
```

**After**:
```ts
function isValidStatus(s: string): boolean {
  return ["active", "pending", "trial"].includes(s);
}
function isMissing(arr: string[], item: string): boolean {
  return !arr.includes(item);
}
```

**Why upgrade**: `.includes()` (ES2015 String, ES2016 Array) is readable, intent-revealing, NaN-safe (`indexOf` cannot find NaN; `includes` can).

**Preconditions**:
1. The LHS is statically a `String`, `Array`, `ReadonlyArray`, `TypedArray`, or `Buffer`.
2. The comparison constant is `-1` (and the operator is one of `!==`, `===`, `>`, `>=`, `<`).
3. The argument list to `indexOf` has exactly 1 argument (no `fromIndex`).
4. The receiver is not a user-defined class whose `indexOf` lacks an `includes` counterpart.
5. For TypeScript: type information is available (strictNullChecks on or the receiver is typed).

**Edge cases that BLOCK**:
- `indexOf(x, fromIndex)` — semantics differ.
- User-defined data structures with `.indexOf` but no `.includes`.
- Buffer comparisons that rely on byte-level offset semantics.

**Frequency**: Very high. Mozilla shipped a custom ESLint rule (`prefer-array-includes` in `eslint-plugin-mozilla`) explicitly to mechanically convert `foo.indexOf(bar) == -1` to `!foo.includes(bar)` across the Firefox tree, demonstrating both that the pattern is pervasive in long-lived codebases and that the rewrite is widely considered safe.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: Complete via lint rules; codemod is straightforward.

---

### 2. object_assign_to_spread
**Pattern**: `Object.assign({}, a, b)` → `{...a, ...b}` when first arg is empty object literal.

**Before**:
```ts
const merged = Object.assign({}, defaults, userConfig);
const updated = Object.assign({}, state, { count: state.count + 1 });
const cloned = Object.assign({}, original);
```

**After**:
```ts
const merged = { ...defaults, ...userConfig };
const updated = { ...state, count: state.count + 1 };
const cloned = { ...original };
```

**Why upgrade**: ES2018 spread is shorter, declarative, and per ESLint's `prefer-object-spread` docs may perform better than the imperative `Object.assign`.

**Preconditions**:
1. First argument is an object literal (preferably empty `{}`).
2. Subsequent arguments are spreadable objects (not arrays in spread mode).
3. Target environment supports ES2018.
4. No `Object.assign(...)` where the first argument is a NON-literal target object (that mutates in place — different semantics).

**Edge cases that BLOCK**:
- `Object.assign(existingObj, src)` — mutates `existingObj`; spread doesn't.
- `Object.assign({}, ...arrayOfObjects)` — array-spread case from ESLint issue #10344; needs special handling.
- Targets with getter/setter properties where `Object.assign` triggers setters.
- Targets with non-enumerable properties.

**Frequency**: Very high. `prefer-object-spread` has been part of ESLint since v5.0.0-alpha.3.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: Complete (ESLint autofix).

---

### 3. string_concat_to_template_literal
**Pattern**: `"Hello, " + name + "!"` → `` `Hello, ${name}!` ``.

**Before**:
```ts
function greet(name: string, age: number): string {
  return "Hello, " + name + ", you are " + age + " years old.";
}
const url = "https://api.example.com/users/" + userId + "/profile?lang=" + lang;
```

**After**:
```ts
function greet(name: string, age: number): string {
  return `Hello, ${name}, you are ${age} years old.`;
}
const url = `https://api.example.com/users/${userId}/profile?lang=${lang}`;
```

**Why upgrade**: ES2015 template literals; readability; less risk of forgotten spaces. ESLint's `prefer-template` (introduced in v1.2.0) ships an autofixer.

**Preconditions**:
1. At least one operand of the `+` chain is a string literal.
2. No operand contains octal escape sequences (per ESLint issue #10031, octal literals in template literal strings are a syntax error).
3. The string has no backticks that would conflict (or the transformer escapes them).
4. Target environment supports ES2015.

**Edge cases that BLOCK**:
- Strings containing `\033` or other octal escapes.
- Strings used in `eval` or `new Function` where literal form matters.
- Strings concatenated with numeric values that would be coerced unexpectedly (rare).

**Frequency**: Very high.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: Complete.

---

### 4. logical_or_to_nullish_coalescing
**Pattern**: `x || defaultValue` used to provide a default → `x ?? defaultValue`, but ONLY when `x` is typed as nullable and the falsy semantics (0, "", false) would be incorrect.

**Before**:
```ts
function getPort(config: { port?: number }): number {
  return config.port || 3000;  // bug: port: 0 falls through to 3000
}
```

**After**:
```ts
function getPort(config: { port?: number }): number {
  return config.port ?? 3000;
}
```

**Why upgrade**: `??` only falls back on `null` / `undefined`, not on `0`, `""`, `false`. This fixes real bugs. Per the typescript-eslint docs: "Because the nullish coalescing operator only coalesces when the original value is null or undefined, it is much safer than relying upon logical OR operator chaining `||`."

**Preconditions**:
1. TypeScript file with `strictNullChecks` enabled.
2. LHS is statically known to be `T | null | undefined`.
3. RHS is not `false` (where `||` falsy semantics may be intentional).
4. Result is not used in a conditional test context (where intent is "any truthy").
5. Target supports ES2020 (`??`).

**Edge cases that BLOCK**:
- LHS is `boolean | undefined` — `false || x` and `false ?? x` differ; needs `ignoreBooleanCoercion`.
- LHS in conditional test: `if (foo || bar)` — almost always intentional.
- LHS is a primitive where 0/"" are valid values being defaulted intentionally (rare).

**Frequency**: High.

**Difficulty**: Medium (requires type info).

**Effort**: 4 days.

**Existing tool coverage**: Partial. `@typescript-eslint/prefer-nullish-coalescing` detects and offers fix but is conservative.

---

### 5. chained_and_to_optional_chain
**Pattern**: `foo && foo.a && foo.a.b && foo.a.b.c` → `foo?.a?.b?.c`.

**Before**:
```ts
function getUserCity(user) {
  if (user && user.profile && user.profile.address && user.profile.address.city) {
    return user.profile.address.city;
  }
  return "Unknown";
}
const r = obj && obj.method && obj.method();
```

**After**:
```ts
function getUserCity(user) {
  return user?.profile?.address?.city ?? "Unknown";
}
const r = obj?.method?.();
```

**Why upgrade**: ES2020 optional chaining is shorter and intent-revealing.

**Preconditions**:
1. Chain is a left-leaning sequence of `&&` operators.
2. Each operand to the left of `&&` is a strict prefix of the operand to the right.
3. Target environment supports ES2020.
4. No mixed checks (e.g., `foo && foo.a > 5 && foo.a.b`).
5. For TypeScript: types are known so we don't introduce a possible undefined return type that breaks the consumer.

**Edge cases that BLOCK**:
- `((foo || {}).a || {}).b` — different pattern; handleable but separate transform.
- Boolean narrowing relies on truthiness.
- Side effects in chain steps.

**Frequency**: High.

**Difficulty**: Medium (requires type info or surrounding context).

**Effort**: 4 days.

**Existing tool coverage**: Partial. `@typescript-eslint/prefer-optional-chain` detects with autofix; needs type info.

---

### 6. logical_assignment_operators
**Pattern**: `if (!x) { x = defaultValue }` or `x = x || defaultValue` → `x ||= defaultValue`; same for `??=` and `&&=`.

**Before**:
```ts
let config: Config | null = null;
function getConfig(): Config {
  if (!config) {
    config = loadConfig();
  }
  return config;
}
foo.bar = foo.bar || makeBar();
```

**After**:
```ts
let config: Config | null = null;
function getConfig(): Config {
  config ??= loadConfig();
  return config;
}
foo.bar ||= makeBar();
```

**Why upgrade**: ES2021 logical assignment operators; succinct lazy initialization.

**Preconditions**:
1. Target environment supports ES2021.
2. The LHS access has no side effects (or has identical side effects evaluated twice).
3. For object property lazy init, the access pattern is identical on both sides.
4. For `??=` specifically, the same nullish vs. falsy precondition as #4 above.

**Edge cases that BLOCK**:
- LHS involves array indexing with computed indices that may differ.
- Getter side effects.

**Frequency**: Medium.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: Partial. ESLint `logical-assignment-operators` rule.

---

## Node.js specific

### 7. fs_callback_to_promises
**Pattern**: Callback-style `fs.readFile(path, cb)` → `fs.promises.readFile(path)` with `await`.

**Before**:
```js
const fs = require("fs");

function loadConfig(path, callback) {
  fs.readFile(path, "utf8", (err, data) => {
    if (err) return callback(err);
    callback(null, JSON.parse(data));
  });
}
```

**After**:
```js
const fs = require("fs/promises");

async function loadConfig(path) {
  const data = await fs.readFile(path, "utf8");
  return JSON.parse(data);
}
```

**Why upgrade**: Native promise API since Node 10; avoids callback hell; `util.promisify` no longer needed. Node.js community blog posts (DEV community, others) document this as the canonical modernization.

**Preconditions**:
1. The function containing the call can be made `async`.
2. The callback follows the Node.js error-first convention.
3. The callback is a plain arrow function or function expression (not externally passed).
4. The function's signature changes from `(callback)` to a Promise-returning shape.
5. All callers of the enclosing function can be updated to use `await` / `.then` (or the transform restricts to leaf functions only).

**Edge cases that BLOCK**:
- Callback used outside the immediate scope.
- Caller depends on synchronous callback execution semantics (rare).
- Functions exported as part of a public callback-style API.

**Frequency**: High in Node.js code older than 2019.

**Difficulty**: Medium.

**Effort**: 4 days.

**Existing tool coverage**: None mechanical.

---

### 8. util_promisify_to_native_promise
**Pattern**: `const readFileP = util.promisify(fs.readFile); await readFileP(...)` → `await fs.promises.readFile(...)` (or `fs/promises`).

**Effort**: 7 days. **Difficulty**: Hard because the promisified function must be known statically to have a native promise counterpart.

---

## TypeScript-specific

### 9. typescript_any_to_unknown
**Pattern**: `function f(x: any)` → `function f(x: unknown)` with narrowing added inside if possible; otherwise just type change with explicit casts at use sites.

**Why upgrade**: `unknown` is the type-safe top type; `any` opts out of typechecking entirely.

**Preconditions**:
1. The parameter is used only via methods or operations that work on `unknown` (e.g., passed back, JSON-serialized, narrowed by `typeof`).
2. Not used in a way that implicitly assumes a specific type.

**Edge cases that BLOCK**:
- The parameter is used as if it were a specific type (e.g., `.length` access).
- The function is exported and changing the signature would break callers.

**Frequency**: High. `@typescript-eslint/no-explicit-any` is in the recommended config.

**Difficulty**: Medium.

**Effort**: 3 days.

**Existing tool coverage**: Partial. `@typescript-eslint/no-explicit-any` detects only.

---

### 10. typescript_enum_to_const_object
**Pattern**: `enum Status { Active = "active" }` → `const Status = { Active: "active" } as const; type Status = typeof Status[keyof typeof Status];`.

**Why upgrade**: Const objects compile to less code, work with type-stripping runtimes (Node 22+ TypeScript type stripping; Bun; Deno), avoid the runtime overhead of enum generation, and address the dual-package hazard. Microsoft TypeScript issue #60790 explicitly proposes an `as enum` assertion syntax for this pattern, indicating the TypeScript team is aware of and considering changes around the enum-to-const-object migration. Issue #30690 separately tracks `const` assertion on enum types.

**Preconditions**:
1. The enum is a string enum (numeric enums are trickier because of reverse mapping).
2. The enum is not `const enum` (those are erased; different transformation).
3. No code relies on reverse mapping (`Status["active"]`).
4. No code uses `Status[key]` with a dynamic key in a way that requires runtime enum object existence.

**Edge cases that BLOCK**:
- Numeric enum with reverse mapping (`Status[0]` returns name).
- Enum used in declaration files with cross-package imports (dual-package hazard).
- Use of `keyof typeof EnumName` patterns that need careful translation.

**Frequency**: Medium.

**Difficulty**: Hard.

**Effort**: 7 days.

**Existing tool coverage**: None mechanical.

---

### 11. typescript_namespace_to_module
**Pattern**: `namespace Foo { export const x = 1; }` → ES module exports.

**Effort**: 4 days. **Existing**: `@typescript-eslint/no-namespace` detects only.

---

### 12. typescript_triple_slash_to_import
**Pattern**: `/// <reference path="foo.ts" />` → `import "foo";`.

**Effort**: 2 days. **Existing**: `@typescript-eslint/triple-slash-reference` detects.

---

## React-specific

### 13. react_class_to_function_component (SAFE VARIANTS ONLY)
**Pattern**: Convert React class components to function components with hooks, but ONLY for variants that are mechanically safe.

**Variants we propose to handle**:
- (a) Render-only classes (no state, no lifecycle, no refs) — already covered by react-codemod `pure-component`.
- (b) Simple class with `this.state = { count: 0 }` and `componentDidMount` only (mount-only effect) → `useState` + `useEffect(() => {...}, [])`.
- (c) Classes that ONLY use `componentDidMount` + `componentWillUnmount` (paired setup/teardown) → `useEffect(() => { setup(); return () => teardown(); }, [])`.

**Variants we EXPLICITLY DO NOT handle**:
- `componentDidUpdate(prevProps)` — requires inferring the correct dependency array. This is the precise reason the React team has not shipped an official codemod since react-codemod issue #217 was opened on November 29, 2018 (and as of May 2026 the issue is still open). The react-codemod README itself explicitly states: "The scripts in this repository are provided in the hope that they are useful, but they are not officially maintained, and we generally will not fix community-reported issues."
- `getDerivedStateFromProps` and `getSnapshotBeforeUpdate`.
- Components using legacy context API.
- Class-only Error Boundaries (`componentDidCatch` must remain a class).

**Before** (mount-only):
```jsx
class Welcome extends React.Component {
  state = { user: null };
  componentDidMount() {
    fetchUser(this.props.id).then(user => this.setState({ user }));
  }
  componentWillUnmount() {
    cancelFetch();
  }
  render() {
    return <h1>Hello {this.state.user?.name}</h1>;
  }
}
```

**After**:
```jsx
function Welcome({ id }) {
  const [user, setUser] = React.useState(null);
  React.useEffect(() => {
    fetchUser(id).then(setUser);
    return () => cancelFetch();
  }, []);
  return <h1>Hello {user?.name}</h1>;
}
```

**Why upgrade**: Hooks are the documented future of React. PureComponent / memo for class is more verbose. Bundle size shrinks.

**Preconditions**:
1. Component does not use any of the BLOCKED variants above.
2. No use of `this.refs` (refactor to `useRef` is separate).
3. No use of `componentDidCatch` (must remain a class for error boundaries; the DigitalOcean tutorial on converting classes to functional components specifically calls this out as the one exception that must remain a class).
4. No use of `getDerivedStateFromProps`.
5. Class extends `React.Component` or `React.PureComponent` directly.
6. No mixins.
7. No `forceUpdate` calls.
8. Methods that reference `this.props` / `this.state` can be inlined into the function body.

**Edge cases that BLOCK**:
- Error boundaries.
- Any of the unhandled lifecycle methods above.
- Classes with non-trivial `shouldComponentUpdate` logic.

**Frequency**: High in code written before React 16.8 (Feb 2019). react-codemod itself carries 4,405 GitHub stars and roughly 27,077 weekly npm downloads per npmtrends as of May 2026, confirming class-to-function is a real, demanded migration path.

**Difficulty**: Hard.

**Effort**: 14+ days for the safe variants only.

**Existing tool coverage**: Partial. react-codemod's `pure-component` handles only the trivial render-only case. Community tools include the Codemod Registry's `class-to-function-component` (claims to handle state with `useState`, lifecycle methods with `useEffect`, refs with `useRef`, and context with `useContext`; community-contributed and not officially endorsed by the React team) and `babel-plugin-transform-react-class-to-function`.

---

### 14. react_default_props_to_param_defaults
**Pattern**: `Component.defaultProps = { name: "World" }` → `function Component({ name = "World" })`.

**Why upgrade**: React deprecated `defaultProps` on function components in React 18.3+ and will remove them in a future major.

**Preconditions**:
1. Target is a function component (not class).
2. Props are destructured already, or can be safely destructured.
3. No spread `{...props}` usage that obscures which prop is being defaulted.
4. The `defaultProps` assignment is a static object literal.

**Edge cases that BLOCK**:
- Class components (defaultProps still officially supported there as of React 19).
- Components where `defaultProps` is computed dynamically.

**Frequency**: Medium.

**Difficulty**: Medium.

**Effort**: 4 days.

**Existing tool coverage**: None official.

---

### 15. react_string_refs_to_useref
**Pattern**: `<input ref="myInput" />; this.refs.myInput.focus()` → `const myInput = useRef(); <input ref={myInput} />; myInput.current.focus()`.

**Why upgrade**: String refs were deprecated long ago and are formally removed in React 19. React-codemod ships `replace-string-ref` for this exact migration; the React 19 codemods are maintained "by the React team in collaboration with the Codemod.com team" per the official react-codemod README.

**Effort**: 4 days. **Existing**: react-codemod `replace-string-ref` (React 19 codemod, official).

---

### 16. react_createelement_to_jsx
**Pattern**: `React.createElement(MyComponent, props, children)` → JSX `<MyComponent {...props}>{children}</MyComponent>`.

**Effort**: 5 days. **Existing**: react-codemod `create-element-to-jsx`. Frequency low because most teams adopted JSX years ago.

---

## Vue-specific

### 17. vue2_filters_to_method_call
**Pattern**: Template `{{ value | currency }}` → `{{ currency(value) }}` (or `{{ $filters.currency(value) }}` with global registration).

**Why upgrade**: The Vue 3 official migration guide at v3-migration.vuejs.org/breaking-changes/filters states verbatim: "Filters are removed from Vue 3.0 and no longer supported." Vue 2 reached end-of-life on 31 December 2023, so this is a hard deprecation.

**Preconditions**:
1. The filter is registered locally (in the same component) OR globally (where the transform can detect and rewire to `app.config.globalProperties.$filters`).
2. The filter is not used inside a `v-bind` shorthand expression with operator precedence ambiguity.
3. Chained filters `{{ a | f | g }}` are translatable to `g(f(a))`.

**Edge cases that BLOCK**:
- Filters that receive arguments via the pipe syntax: `{{ value | format(arg) }}` (translatable but more involved).
- Filters defined in a mixin (must follow the mixin).
- Filters used inside `v-html` template expressions.

**Frequency**: Medium-high in Vue 2 codebases.

**Difficulty**: Medium (requires template AST parsing).

**Effort**: 5 days.

**Existing tool coverage**: None mechanical for the template side. Some community vue-codemod issues track this; nothing official ships.

---

### 18. vue_set_delete_to_assignment
**Pattern**: `Vue.set(obj, key, val)` → `obj[key] = val`; `Vue.delete(obj, key)` → `delete obj[key]`.

**Why upgrade**: Per the Vue 3 migration record, `Vue.set` / `Vue.delete` "no longer exist -- they are no longer necessary with the proxy-based reactivity approach in Vue 3." `@originjs/vue-codemod` implements this as the `remove-vue-set-and-delete` rule.

**Preconditions**:
1. The call is the Vue 2 `Vue.set` / `Vue.delete` (not a user-defined `set` method).
2. The target object is reactive (which is the entire reason `Vue.set` existed).
3. The project is being migrated to Vue 3 (or already runs Vue 3 with `@vue/composition-api`).

**Edge cases that BLOCK**:
- The `Vue` identifier is renamed/aliased.
- Calls passed as values rather than invoked (rare).

**Frequency**: Medium.

**Difficulty**: Easy.

**Effort**: 2 days.

**Existing tool coverage**: Complete via `@originjs/vue-codemod`.

---

### 19. vue2_options_to_composition_api (SAFE SUBSET ONLY)
**Pattern**: Convert Vue 2 Options API (`data`, `computed`, `methods`, lifecycle hooks) to Vue 3 Composition API `<script setup>` form.

**Why upgrade**: Composition API is the documented future for Vue 3+; `<script setup>` is the lean form. Shopware published an ADR (2024-10-02) and shipped an ESLint-rule-based codemod for this migration.

**SAFE subset we handle**:
- `data() { return { x: 0 } }` → `const x = ref(0)`.
- `computed: { y() { return this.x * 2 } }` → `const y = computed(() => x.value * 2)`.
- `methods: { foo() { this.x++ } }` → `function foo() { x.value++ }`.
- Lifecycle hooks `mounted` → `onMounted`; `beforeDestroy` → `onBeforeUnmount`; etc.
- `props: { name: String }` → `defineProps<{ name?: string }>()`.

**Explicit BLOCKS (defer to manual)**:
- Template-side `$refs` access. The Shopware ADR explicitly states the Codemod "does not handle template changes, such as adjusting $refs usage."
- Vuex `mapState` / `mapGetters` / `mapActions` interactions (the Shopware ADR explicitly defers these to manual conversion via `useStore`).
- Mixins (the Shopware ADR explicitly defers these).
- `$emit` calls that need `defineEmits` declarations.
- Components using `extends`.

**Preconditions**:
1. SFC has a `<script>` block (or `<script lang="ts">`).
2. None of the BLOCKED patterns above are present in the script block.
3. No use of `this` inside template literals or render functions outside the methods we recognize.
4. No filters in the template (handled separately by #17).

**Frequency**: High. The official `vuejs/vue-codemod` repository sits at approximately 287 GitHub stars and is largely unmaintained since 2022; the actively maintained fork is `@originjs/vue-codemod`, which implements rules including `new-global-api`, `remove-vue-set-and-delete`, `rename-lifecycle`, `slot-attribute`, `vue-router-v4`, and `vuex-v4`. The fact that the upstream is abandoned while the migration need is still pressing creates a clear opening for Refactron.

**Difficulty**: Hard.

**Effort**: 14+ days for the safe subset.

**Existing tool coverage**: Partial. Tools include `vue-o2c` (community, npm), the Shopware ESLint codemod, and `mikhaylov-ya/vue-codemod-revanced`. None handle the full picture; all explicitly defer template changes.

---

# Section 3: Brutally Honest Assessment

## Easy wins to ship in v2.1 (top 7)

Ranked by combination of frequency × precondition clarity × deprecation pressure:

1. **pep585_generics** (Python, 2 days). Pyupgrade and Ruff have battle-tested it; preconditions are crisp; affects almost every Python file with type hints.
2. **pep604_optional_union** (Python, 2 days). Same as above; pairs naturally with #1.
3. **indexOf_to_includes** (TS/JS, 2 days). Universal, NaN-safety win, ESLint and Mozilla already ship this.
4. **object_assign_to_spread** (TS/JS, 2 days). ESLint recommended config covers this; users will expect Refactron to as well.
5. **string_concat_to_template_literal** (TS/JS, 2 days). Universal modernization; just watch for octal escapes.
6. **super_no_args** (Python, 1 day). The lowest-risk Python rewrite.
7. **lru_cache_to_cache** (Python, 1 day). Trivial, frequent, and immediately delights teams that use memoization heavily.

This v2.1 shortlist totals approximately 12 engineer-days and produces a clean modernization "pack" with high signal.

## Worth shipping in v2.1 if budget allows (next 5)

8. **typing_namedtuple_class_syntax** (Python, 3 days). Pyupgrade covers half; the `collections.namedtuple` half is unique value.
9. **datetime_utc_alias** (Python, 1 day). Free win for 3.11+ projects.
10. **subprocess_text_capture_output** (Python, 2 days). Free win for any subprocess-heavy code.
11. **yield_from_for_loop** (Python, 2 days). Trivial.
12. **vue_set_delete_to_assignment** (Vue, 2 days). Small but useful and 100% deterministic.

## Defer to v2.2

- **percent_to_format_to_fstring** (3 days but high precondition surface; the "intentionally timid" tradeoffs need careful product decisions).
- **open_to_with_context** (4 days, real safety value).
- **for_append_to_list_comprehension** (4 days).
- **contextlib_suppress** (3 days).
- **raise_from_exception_chaining** (4 days).
- **logical_or_to_nullish_coalescing** (4 days; needs type-info infrastructure).
- **chained_and_to_optional_chain** (4 days; needs type info).
- **fs_callback_to_promises** (4 days; lots of edge cases).
- **typescript_any_to_unknown** (3 days; needs type info).
- **react_default_props_to_param_defaults** (4 days).
- **typescript_namespace_to_module** (4 days).
- **react_string_refs_to_useref** (4 days).

## Defer to v2.3 (significant engineering investment)

- **os_path_to_pathlib** (7-10 days). High value, hard to get right, lots of edge cases.
- **typescript_enum_to_const_object** (7 days). Active TypeScript proposal #60790 may make some of this work obsolete.
- **isinstance_chain_to_match** (10 days). Adoption of Python 3.10+ is the gating factor.
- **react_class_to_function_component** (14+ days, safe variants only).
- **vue2_options_to_composition_api** (14+ days, safe subset only).
- **util_promisify_to_native_promise** (7 days).
- **react_createelement_to_jsx** (5 days; declining frequency).

## REJECTED candidates (with reasoning)

1. **jQuery patterns to vanilla DOM** — Rejected. Too broad; jQuery semantics around `.css()`, `.animate()`, event delegation are not 1:1 to native DOM. Any deterministic transform produces correct-but-noisy diffs at best.
2. **Vue 2 `$on`/`$off`/`$once` removal** — Rejected as a single transform. The Vue 3 migration guide states verbatim that "$on, $off and $once instance methods are removed. Component instances no longer implement the event emitter interface," and the recommended replacement is to add `mitt` or `tiny-emitter` as a dependency. Adding a dependency is a project-level decision; not deterministic.
3. **General `useEffect` dependency array inference** — Rejected. This is precisely the problem that has kept the React team from shipping an official class-to-hooks codemod since react-codemod issue #217 was opened in 2018 (still open as of May 2026). Inferring the correct dependency array requires understanding which closures are intended to capture vs. observe state — LLM-judgment territory.
4. **`.map().filter().reduce()` reshuffling for performance** — Rejected. Contested in the original task spec; benchmarks differ; team preferences vary.
5. **Angular version-specific upgrades** — Rejected. Angular's major version churn (RxJS operator imports, Standalone Components, signals) makes any single transform highly version-fragile. Defer to Angular's own `ng update` ecosystem.
6. **Removing unused imports / dead code** — Rejected per the original task exclusion criteria. Linter territory.
7. **Quote style normalization** — Rejected per original exclusion.
8. **`module.exports` to `export` for ambiguous CommonJS** — Rejected as a v2.1 addition. The original `commonjs_to_esm` is already shipping in v2.0; deeper variants need per-export call-site analysis that often crosses file boundaries and is best handled in a follow-up to the existing transform.
9. **Ruff UP038 (`isinstance` with tuple to union types)** — Explicitly rejected. Ruff itself removed UP038 in v0.13.0 due to runtime performance regressions in the rewritten code. Refactron should NOT implement this transform.

---

# Section 4: Recommended v2.1 transform shortlist

In order of recommended ship:

| # | transform_id | Lang | Days | Why now |
|---|--------------|------|------|---------|
| 1 | super_no_args | Python | 1 | Lowest risk; high-frequency win |
| 2 | lru_cache_to_cache | Python | 1 | Trivial; delight |
| 3 | pep585_generics | Python | 2 | Foundation for Python type modernization |
| 4 | pep604_optional_union | Python | 2 | Pairs with #3 |
| 5 | indexOf_to_includes | TS/JS | 2 | Universal modernization; NaN safety |
| 6 | object_assign_to_spread | TS/JS | 2 | Expected by users with ESLint background |
| 7 | string_concat_to_template_literal | TS/JS | 2 | Universal modernization |

Total engineering budget: approximately 12 days. This produces a coherent "modernize Python type hints and ES2015+ JS idioms" v2.1 release that demonstrates Refactron's deterministic safety story on the most universally agreed-upon patterns.

**Stretch goals if budget remains**: `datetime_utc_alias` (1 day), `yield_from_for_loop` (2 days), `vue_set_delete_to_assignment` (2 days). All three are pure deterministic mechanical rewrites with crisp preconditions.

---

# Section 5: Caveats and Conflict Notes

1. **Tool overlap with Ruff and Pyupgrade**: For 8 of the 18 Python transforms, Ruff already provides complete coverage. Refactron's positioning relative to Ruff matters: the differentiator is the **three-check safety verification** (syntax + imports + test suite) before write, which Ruff does not provide. Ruff sits at 47.6k GitHub stars as of May 2026 per its v0.15.13 release page (with intermediate snapshots showing ~45.4k in January 2026 and ~47.1k in April 2026), so it is a moving target both in adoption and in rule coverage; Refactron must publish a clear "what we do that Ruff does not" matrix. If Refactron is positioned as "Ruff + safety," the overlap is a feature; if positioned as "what Ruff can't do," the deferred candidates (`os_path_to_pathlib`, `isinstance_chain_to_match`, `react_class_to_function_component`) are the strategic priorities.

2. **TypeScript type-information requirement**: Several of the highest-value TS transforms (`logical_or_to_nullish_coalescing`, `chained_and_to_optional_chain`, `typescript_any_to_unknown`) require TypeScript type information from the TypeScript compiler API. If Refactron does not currently invoke `tsc` to get type info, this is a significant infrastructure prerequisite for v2.2.

3. **React/Vue framework risk**: The class-to-function-component and Options-to-Composition transforms are high-value but high-risk. The React team's reluctance to ship an official codemod (per react-codemod issue #217 still open since November 2018) is a strong signal. Refactron's safety-verification pipeline is the relevant differentiator here, but the engineering investment is real. As a reference point, the broader codemod ecosystem is large but the high-stars/high-downloads tools cluster narrowly: jscodeshift carries 9,983 GitHub stars and 6,396,899 weekly npm downloads per npmtrends as of May 2026; ts-migrate (Airbnb) carries exactly 5.6k GitHub stars per the airbnb/ts-migrate repository, with the companion `ts-migrate-plugins` package at 72,918 weekly downloads per Snyk advisor data. The opportunity is real; the difficulty is real.

4. **Vue 2 EOL pressure**: Vue 2 reached end-of-life on 31 December 2023. Codebases still on Vue 2 are now in security-only territory. Migration urgency is high, but the population of affected codebases is shrinking — assess your customer base before committing the 14+ days for the Composition API transform.

5. **Python version targeting**: Many Python transforms are gated on target Python version. Refactron should require a `python_version` configuration value (read from `pyproject.toml` `requires-python` if available) and refuse to apply version-gated transforms when targets are insufficient.

6. **Frequency claims and freshness**: GitHub star counts and npm weekly downloads fluctuate. The numbers cited (pyupgrade exactly 4.1k stars; Ruff 47.6k stars as of May 2026; jscodeshift 9,983 stars / 6.4M weekly downloads; react-codemod 4,405 stars / 27,077 weekly downloads; ts-migrate 5.6k stars) should be re-verified at v2.1 launch time. The relative ordering of frequency claims (pyupgrade and Ruff rules are very common; vuejs/vue-codemod is relatively uncommon) is robust.

7. **Conflicting recommendations between tools**: Notable conflict: Ruff has marked UP038 (`isinstance(x, (int, float))` → `isinstance(x, int | float)`) as deprecated and removed it in Ruff v0.13.0 due to runtime performance regressions. Refactron should NOT implement this transform. Always check Ruff's deprecation history when adopting a pattern. Conversely, Ruff v0.9.0 split UP007 into UP007 (Union) + UP045 (Optional) to allow the two rewrites to be configured separately, which Refactron should mirror by exposing `pep604_union_only` and `pep604_optional_only` sub-flags.

8. **Forward-looking caveats (speculation marked)**:
   - The TypeScript team's proposed `as enum` syntax (issue #60790) **may or may not** ship, which **could** make `typescript_enum_to_const_object` partially obsolete; defer accordingly.
   - The CPython team **may** eventually accept a match-statement linter (issue #88442 has been open since 2021 with no resolution), which **could** preempt `isinstance_chain_to_match`; this is unlikely in the next 12 months but worth tracking.
   - React **could** ship an official class-to-hooks codemod via the Codemod.com collaboration ("The scripts in this repository are maintained by the React team in collaboration with the Codemod.com team" per the react-codemod README), but the seven-year-old issue #217 with no resolution suggests this is not imminent.

9. **Source breadth**: This roadmap synthesizes the pyupgrade README and source; the Instagram/LibCST codemod directory and tutorial; reactjs/react-codemod, vuejs/vue-codemod, and @originjs/vue-codemod; typescript-eslint and ESLint rule docs (`prefer-includes`, `prefer-object-spread`, `prefer-template`, `prefer-nullish-coalescing`, `prefer-optional-chain`); the Vue 3 migration guide (v3-migration.vuejs.org) including the filters, $on/$off/$once, and functional-component breaking-change pages; the Shopware ADR for Vue 2 → Vue 3 Composition API; the Django-codemod project (browniebroke/django-codemod); the Pylint R6105 message; Ruff release notes for v0.9.0 and v0.13.0; PEPs 585, 604, 622, 634, 635, 636; Trey Hunner's pathlib essay; the React class-to-functional DigitalOcean tutorial; and the Codemod Registry's `class-to-function-component` listing. Every pattern recommended has been cross-checked against at least two of these sources.