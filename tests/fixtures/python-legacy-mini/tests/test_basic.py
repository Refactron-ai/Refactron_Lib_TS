"""Baseline tests for the python-legacy-mini fixture.

These must pass on the UNMODIFIED legacy source. They are also the
post-refactor oracle for the Week 4 golden e2e test: after Refactron
transforms the code, this same suite must still pass unchanged.
"""

from unittest.mock import patch, MagicMock

import callbacks
import formatting
import legacy_http
import models
import typecheck
import utils


def test_fetch_user_invokes_callback():
    captured = {}

    def cb(result):
        captured.update(result)

    callbacks.fetch_user(42, cb)
    assert captured == {"id": 42, "name": "user-42"}


def test_save_data_invokes_callback():
    captured = {}

    def done(receipt):
        captured.update(receipt)

    callbacks.save_data([1, 2, 3], done)
    assert captured == {"ok": True, "size": 3}


def test_formatting_greet_and_value():
    assert formatting.greet("world") == "hello world"
    assert formatting.format_value(7) == "value is 7"


def test_typecheck_area_dispatch():
    assert typecheck.area(typecheck.Square(3)) == 9
    circle_area = typecheck.area(typecheck.Circle(1))
    assert round(circle_area, 5) == round(3.141592653589793, 5)


def test_legacy_http_fetch_json_uses_requests_get():
    fake_response = MagicMock()
    fake_response.json.return_value = {"hello": "world"}
    with patch("legacy_http.requests.get", return_value=fake_response) as mocked:
        result = legacy_http.fetch_json("http://example.test/api")
    assert result == {"hello": "world"}
    mocked.assert_called_once()


def test_legacy_http_submit_uses_requests_post():
    fake_response = MagicMock()
    fake_response.json.return_value = {"ok": True}
    with patch("legacy_http.requests.post", return_value=fake_response) as mocked:
        result = legacy_http.submit("http://example.test/api", {"x": 1})
    assert result == {"ok": True}
    mocked.assert_called_once()


def test_models_user_and_address():
    u = models.User(1, "Ada", "ada@example.test")
    assert (u.id, u.name, u.email) == (1, "Ada", "ada@example.test")
    a = models.Address("1 Main", "Townsville", "00000")
    assert (a.street, a.city, a.zip) == ("1 Main", "Townsville", "00000")


def test_utils_helpers():
    assert utils.slugify("  Hello, World!  ") == "hello-world"
    assert utils.clamp(5, 0, 10) == 5
    assert utils.clamp(-1, 0, 10) == 0
    assert utils.clamp(99, 0, 10) == 10
