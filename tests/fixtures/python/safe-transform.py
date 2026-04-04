# tests/fixtures/python/safe-transform.py
# KNOWN-SAFE: removing unused imports is always safe — no behavior change

import os          # unused
import sys         # unused
import json        # used below

def load_config(path: str) -> dict:
    """Load config from JSON file."""
    with open(path) as f:
        return json.load(f)
