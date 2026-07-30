from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from decimal import (
        Context,
        Decimal,
    )


def live(x):
    return x + 1
