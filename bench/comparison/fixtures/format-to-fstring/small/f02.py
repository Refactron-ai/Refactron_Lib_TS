"""f02.py — straightforward .format() calls; every site is f-string-ready."""


def greet(name):
    return "hello {}".format(name)


def kv(key, value):
    return "{}={}".format(key, value)


def label(name, age):
    return "{} is {}".format(name, age)


def header(title):
    return "=== {} ===".format(title)


def repeat(name):
    return "{}, {}, {}".format(name, name, name)


def numbered(a, b, c):
    return "{0}-{1}-{2}".format(a, b, c)


def colon(name):
    return "user: {}".format(name)


def two(a, b):
    return "{} + {}".format(a, b)


def three(a, b, c):
    return "{}/{}/{}".format(a, b, c)


def with_call(items):
    return "len={}".format(len(items))
