"""f03.py — mixed % and .format() in the same file."""


def via_pct(name):
    return "hi %s" % name


def via_fmt(name):
    return "hi {}".format(name)


def pct_two(a, b):
    return "%s and %s" % (a, b)


def fmt_two(a, b):
    return "{} and {}".format(a, b)


def pct_int(n):
    return "n=%d" % n


def fmt_int(n):
    return "n={}".format(n)


def pct_label(k, v):
    return "%s: %s" % (k, v)


def fmt_label(k, v):
    return "{}: {}".format(k, v)


def pct_path(base, name):
    return "%s/%s" % (base, name)


def fmt_path(base, name):
    return "{}/{}".format(base, name)
