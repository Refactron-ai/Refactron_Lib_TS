def live(x):
    return x + 1


def dead(a, b):  # pragma: no cover
    return "-".join(
        [
            a,
            b,
        ]
    )
