"""f05.py — multi-line strings + format inside container literals."""


def multi_pct(name, age):
    return ("hi %s, you are %d" %
            (name, age))


def multi_fmt(name, age):
    return ("hi {}, you are {}".format(
        name, age))


def in_dict(name):
    d = {"greeting": "hello %s" % name, "tag": "static"}
    return d["greeting"]


def in_dict_fmt(name):
    d = {"greeting": "hello {}".format(name), "tag": "static"}
    return d["greeting"]


def in_list(a, b):
    items = ["%s" % a, "%s" % b]
    return ",".join(items)


def in_list_fmt(a, b):
    items = ["{}".format(a), "{}".format(b)]
    return ",".join(items)


def in_tuple(name):
    pair = ("hello %s" % name, "static")
    return pair[0]


def assigned_then_returned(name):
    msg = "hello %s" % name
    return msg


def assigned_fmt_then_returned(name):
    msg = "hello {}".format(name)
    return msg


def returned_directly(name):
    return "%s" % name
