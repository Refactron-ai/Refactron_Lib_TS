"""f06.py — sites with embedded expressions (attribute access, indexing).

These are all valid f-string targets; correctness requires the expression
inside {} to evaluate the same way.
"""


class P:
    def __init__(self, name, age):
        self.name = name
        self.age = age


def attr_pct(p):
    return "%s/%d" % (p.name, p.age)


def attr_fmt(p):
    return "{}/{}".format(p.name, p.age)


def idx_pct(items):
    return "first=%s" % items[0]


def idx_fmt(items):
    return "first={}".format(items[0])


def call_pct(items):
    return "len=%d" % len(items)


def call_fmt(items):
    return "len={}".format(len(items))


def expr_pct(a, b):
    return "sum=%d" % (a + b)


def expr_fmt(a, b):
    return "sum={}".format(a + b)


def chained_attr(p):
    return "name=%s" % p.name


def chained_attr_fmt(p):
    return "name={}".format(p.name)
