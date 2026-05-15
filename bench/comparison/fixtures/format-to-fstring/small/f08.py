"""f08.py — edge cases that should arguably be skipped.

These are sites where a naive rewrite would change behavior or be unsafe.
A safety-conscious tool (Refactron, LibCST) should skip; a regex tool (Comby)
will likely over-rewrite.
"""


def percent_dict(d):
    # `%` with a dict argument — uses %(name)s syntax.
    # Naive `% (var,)` -> `f"{var}"` rewrite would break this.
    return "name=%(name)s age=%(age)d" % d


def percent_with_format_method(name):
    # Mixed: percent on a string that came from .format() — rare but real.
    base = "hello {}".format(name)
    return "%s!" % base


def format_with_starargs(args):
    # .format(*args) — codemod cannot statically know arity.
    return "{}-{}".format(*args)


def format_with_starkw(kwargs):
    # .format(**kwargs) — codemod cannot statically know names.
    return "{name}".format(**kwargs)


def percent_logger_style(template, name):
    # percent style on a template variable, not a literal — codemod can't rewrite.
    return template % name


def fmt_method_on_var(s, x):
    # .format() called on a non-literal string — codemod can't rewrite literally.
    return s.format(x)


def chained_format(name):
    # Nested .format() call.
    return "outer {}".format("inner {}".format(name))


def percent_on_non_str_const(n):
    # % on integers (modulo) — must NOT be rewritten.
    return n % 7


def good_one(name):
    # A single rewritable site to ensure tools that can rewrite, do.
    return "ok %s" % name


def good_two(name):
    return "ok {}".format(name)
