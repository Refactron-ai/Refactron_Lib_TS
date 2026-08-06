"""Legacy string-formatting helpers.

Uses both ``%`` and ``str.format`` styles that predate f-strings.
"""


def greet(name):
    # Old percent-formatting style.
    return "hello %s" % name


def format_value(x):
    # Old str.format style.
    return "value is {}".format(x)
