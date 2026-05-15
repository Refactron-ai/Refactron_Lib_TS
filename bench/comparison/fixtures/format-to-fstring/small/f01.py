"""f01.py — straightforward percent-formatting; every site is f-string-ready."""


def greet(name):
    return "hello %s" % name


def squared(x):
    return "%d squared is %d" % (x, x * x)


def label(name, age):
    return "%s is %d" % (name, age)


def render_pair(a, b):
    return "(%s, %s)" % (a, b)


def percent_msg(pct):
    return "value: %d%%" % pct


def header(title):
    return "=== %s ===" % title


def kv(key, value):
    return "%s = %s" % (key, value)


def with_int(n):
    return "n=%d" % n


def with_float(f):
    return "f=%.2f" % f


def repeat_one(name):
    return "%s, %s, %s" % (name, name, name)
