# tests/fixtures/python/bad-transform.py
# KNOWN-BAD: extracting this function changes the return type from int to None
# The verification engine MUST block any autofix that touches this file

def calculate_total(items: list) -> int:
    """Calculate total price."""
    total = 0
    for item in items:
        total += item['price']
    return total  # if this line is removed/changed, return type becomes None — behavior change
