"""f09.py — straightforward sites with longer literal text around them."""


def render_user(name, role, score):
    return "User '%s' (role=%s) has score %d" % (name, role, score)


def render_user_fmt(name, role, score):
    return "User '{}' (role={}) has score {}".format(name, role, score)


def header_line(title, level):
    return "[L%d] %s" % (level, title)


def header_line_fmt(title, level):
    return "[L{}] {}".format(level, title)


def render_path(base, name, ext):
    return "%s/%s.%s" % (base, name, ext)


def render_path_fmt(base, name, ext):
    return "{}/{}.{}".format(base, name, ext)


def render_csv(a, b, c, d):
    return "%s,%s,%s,%s" % (a, b, c, d)


def render_csv_fmt(a, b, c, d):
    return "{},{},{},{}".format(a, b, c, d)


def render_msg(name, n):
    return "Hi %s, you have %d new messages." % (name, n)


def render_msg_fmt(name, n):
    return "Hi {}, you have {} new messages.".format(name, n)
