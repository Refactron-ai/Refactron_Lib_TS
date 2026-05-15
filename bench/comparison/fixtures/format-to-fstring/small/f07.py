"""f07.py — format spec edge cases: width, precision, alignment."""


def width(n):
    return "%5d" % n


def width_fmt(n):
    return "{:5d}".format(n)


def precision(f):
    return "%.3f" % f


def precision_fmt(f):
    return "{:.3f}".format(f)


def width_precision(f):
    return "%8.3f" % f


def width_precision_fmt(f):
    return "{:8.3f}".format(f)


def left_align(s):
    return "{:<10}".format(s)


def right_align(s):
    return "{:>10}".format(s)


def hex_pct(n):
    return "0x%x" % n


def hex_fmt(n):
    return "0x{:x}".format(n)


def zero_pad(n):
    return "%05d" % n


def zero_pad_fmt(n):
    return "{:05d}".format(n)
