"""f04.py — .format() with kwargs and named placeholders.

LibCST's ConvertFormatStringCommand intentionally skips named-keyword forms
in some cases. We mark these as 'skip' acceptable and 'f-string' optimal so
each tool gets credit for whichever choice it makes consistently.
"""


def named(name):
    return "hi {n}".format(n=name)


def named_two(first, last):
    return "{a} {b}".format(a=first, b=last)


def named_int(count):
    return "count={c}".format(c=count)


def kw_dict():
    return "k={k}, v={v}".format(k="key", v="val")


def named_path(base, name):
    return "{b}/{n}".format(b=base, n=name)


def mixed_pos_kw(a, name):
    # Mixed positional + kwargs -- highly likely to be skipped by codemods.
    return "{} -> {n}".format(a, n=name)


def kw_repeat(name):
    return "{n} {n} {n}".format(n=name)


def kw_int_str(n, s):
    return "{i}-{x}".format(i=n, x=s)


def kw_with_call(items):
    return "len={l}".format(l=len(items))


def kw_pair(k, v):
    return "{key}={val}".format(key=k, val=v)
