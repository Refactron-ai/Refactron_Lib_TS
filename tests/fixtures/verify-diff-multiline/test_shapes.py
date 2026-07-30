from shapes import round_down, round_up


def test_round_up():
    assert round_up(1.2) == 2


def test_round_down():
    assert round_down(1.8) == 1
