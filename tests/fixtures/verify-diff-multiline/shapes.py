from math import (
    ceil,
    floor,
)


def round_up(x):
    return ceil(x)


def round_down(x):
    return floor(x)


def unused_join(a, b, c):
    return "-".join(
        [
            a,
            b,
            c,
        ]
    )
