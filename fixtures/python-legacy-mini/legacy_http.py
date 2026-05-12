"""Legacy synchronous HTTP helpers using ``requests``.

Wrapped in try/except so tests can patch ``requests.get`` / ``requests.post``
without hitting the network and still exercise the happy path.
"""

import requests


def fetch_json(url):
    try:
        response = requests.get(url, timeout=5)
        return response.json()
    except Exception as exc:
        return {"error": str(exc)}


def submit(url, payload):
    try:
        response = requests.post(url, json=payload, timeout=5)
        return response.json()
    except Exception as exc:
        return {"error": str(exc)}
