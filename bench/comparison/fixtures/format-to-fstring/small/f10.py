"""f10.py — broad mix: simple sites used inside loops, conditionals, and lambdas."""


def loop_pct(names):
    out = []
    for n in names:
        out.append("name=%s" % n)
    return out


def loop_fmt(names):
    out = []
    for n in names:
        out.append("name={}".format(n))
    return out


def cond_pct(name, important):
    if important:
        return "!! %s !!" % name
    return "%s" % name


def cond_fmt(name, important):
    if important:
        return "!! {} !!".format(name)
    return "{}".format(name)


def comp_pct(names):
    return ["%s" % n for n in names]


def comp_fmt(names):
    return ["{}".format(n) for n in names]


def lambda_pct():
    return (lambda n: "v=%s" % n)(7)


def lambda_fmt():
    return (lambda n: "v={}".format(n))(7)


def assert_msg(x):
    assert x > 0, "bad x=%d" % x
    return x


def assert_msg_fmt(x):
    assert x > 0, "bad x={}".format(x)
    return x
