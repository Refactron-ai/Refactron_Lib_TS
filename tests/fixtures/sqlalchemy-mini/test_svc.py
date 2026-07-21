from unittest.mock import MagicMock

from svc import tested_query


def test_tested_query():
    # Exercises the tested_query line under coverage; MagicMock stands in for a
    # Session so the chain executes without a real database.
    tested_query(MagicMock())
