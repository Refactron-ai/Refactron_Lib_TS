"""Legacy isinstance-chain dispatch over a small shape hierarchy."""

import math


class Circle:
    def __init__(self, radius):
        self.radius = radius


class Square:
    def __init__(self, side):
        self.side = side


def area(shape):
    if isinstance(shape, Circle):
        return math.pi * shape.radius * shape.radius
    elif isinstance(shape, Square):
        return shape.side * shape.side
    else:
        raise TypeError("unknown shape: %r" % shape)
