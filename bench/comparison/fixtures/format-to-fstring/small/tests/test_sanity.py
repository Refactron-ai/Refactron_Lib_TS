"""Safety suite for format-to-fstring fixture.

Each fixture file's functions must continue to return the same strings after
any tool's rewrite. Any differing output -> safety failure for that tool.
"""

import f01
import f02
import f03
import f04
import f05
import f06
import f07
import f08
import f09
import f10


def test_f01():
    assert f01.greet("ada") == "hello ada"
    assert f01.squared(3) == "3 squared is 9"
    assert f01.label("ada", 36) == "ada is 36"
    assert f01.render_pair(1, 2) == "(1, 2)"
    assert f01.percent_msg(50) == "value: 50%"
    assert f01.header("hi") == "=== hi ==="
    assert f01.kv("a", "b") == "a = b"
    assert f01.with_int(7) == "n=7"
    assert f01.with_float(1.20) == "f=1.20"
    assert f01.repeat_one("x") == "x, x, x"


def test_f02():
    assert f02.greet("ada") == "hello ada"
    assert f02.kv("a", "b") == "a=b"
    assert f02.label("ada", 36) == "ada is 36"
    assert f02.header("hi") == "=== hi ==="
    assert f02.repeat("x") == "x, x, x"
    assert f02.numbered("a", "b", "c") == "a-b-c"
    assert f02.colon("ada") == "user: ada"
    assert f02.two(1, 2) == "1 + 2"
    assert f02.three("a", "b", "c") == "a/b/c"
    assert f02.with_call([1, 2, 3]) == "len=3"


def test_f03():
    assert f03.via_pct("x") == "hi x"
    assert f03.via_fmt("x") == "hi x"
    assert f03.pct_two("a", "b") == "a and b"
    assert f03.fmt_two("a", "b") == "a and b"
    assert f03.pct_int(7) == "n=7"
    assert f03.fmt_int(7) == "n=7"
    assert f03.pct_label("k", "v") == "k: v"
    assert f03.fmt_label("k", "v") == "k: v"
    assert f03.pct_path("a", "b") == "a/b"
    assert f03.fmt_path("a", "b") == "a/b"


def test_f04():
    assert f04.named("x") == "hi x"
    assert f04.named_two("a", "b") == "a b"
    assert f04.named_int(3) == "count=3"
    assert f04.kw_dict() == "k=key, v=val"
    assert f04.named_path("a", "b") == "a/b"
    assert f04.mixed_pos_kw("X", "Y") == "X -> Y"
    assert f04.kw_repeat("x") == "x x x"
    assert f04.kw_int_str(1, "z") == "1-z"
    assert f04.kw_with_call([1, 2]) == "len=2"
    assert f04.kw_pair("k", "v") == "k=v"


def test_f05():
    assert f05.multi_pct("ada", 36) == "hi ada, you are 36"
    assert f05.multi_fmt("ada", 36) == "hi ada, you are 36"
    assert f05.in_dict("ada") == "hello ada"
    assert f05.in_dict_fmt("ada") == "hello ada"
    assert f05.in_list("a", "b") == "a,b"
    assert f05.in_list_fmt("a", "b") == "a,b"
    assert f05.in_tuple("ada") == "hello ada"
    assert f05.assigned_then_returned("ada") == "hello ada"
    assert f05.assigned_fmt_then_returned("ada") == "hello ada"
    assert f05.returned_directly("ada") == "ada"


def test_f06():
    p = f06.P("ada", 36)
    assert f06.attr_pct(p) == "ada/36"
    assert f06.attr_fmt(p) == "ada/36"
    assert f06.idx_pct([10, 20]) == "first=10"
    assert f06.idx_fmt([10, 20]) == "first=10"
    assert f06.call_pct([1, 2, 3]) == "len=3"
    assert f06.call_fmt([1, 2, 3]) == "len=3"
    assert f06.expr_pct(2, 3) == "sum=5"
    assert f06.expr_fmt(2, 3) == "sum=5"
    assert f06.chained_attr(p) == "name=ada"
    assert f06.chained_attr_fmt(p) == "name=ada"


def test_f07():
    assert f07.width(7) == "    7"
    assert f07.width_fmt(7) == "    7"
    assert f07.precision(1.2345) == "1.234" or f07.precision(1.2345) == "1.235"  # rounding
    assert f07.precision_fmt(1.2345) == "1.234" or f07.precision_fmt(1.2345) == "1.235"
    assert f07.width_precision(1.2345).endswith("1.234") or f07.width_precision(1.2345).endswith("1.235")
    assert f07.width_precision_fmt(1.2345).endswith("1.234") or f07.width_precision_fmt(1.2345).endswith("1.235")
    assert f07.left_align("hi") == "hi        "
    assert f07.right_align("hi") == "        hi"
    assert f07.hex_pct(255) == "0xff"
    assert f07.hex_fmt(255) == "0xff"
    assert f07.zero_pad(7) == "00007"
    assert f07.zero_pad_fmt(7) == "00007"


def test_f08():
    assert f08.percent_dict({"name": "ada", "age": 36}) == "name=ada age=36"
    assert f08.percent_with_format_method("ada") == "hello ada!"
    assert f08.format_with_starargs(["a", "b"]) == "a-b"
    assert f08.format_with_starkw({"name": "ada"}) == "ada"
    assert f08.percent_logger_style("hi %s", "ada") == "hi ada"
    assert f08.fmt_method_on_var("hello {}", "ada") == "hello ada"
    assert f08.chained_format("ada") == "outer inner ada"
    assert f08.percent_on_non_str_const(10) == 3
    assert f08.good_one("ada") == "ok ada"
    assert f08.good_two("ada") == "ok ada"


def test_f09():
    assert f09.render_user("ada", "admin", 100) == "User 'ada' (role=admin) has score 100"
    assert f09.render_user_fmt("ada", "admin", 100) == "User 'ada' (role=admin) has score 100"
    assert f09.header_line("Intro", 1) == "[L1] Intro"
    assert f09.header_line_fmt("Intro", 1) == "[L1] Intro"
    assert f09.render_path("a", "b", "py") == "a/b.py"
    assert f09.render_path_fmt("a", "b", "py") == "a/b.py"
    assert f09.render_csv("1", "2", "3", "4") == "1,2,3,4"
    assert f09.render_csv_fmt("1", "2", "3", "4") == "1,2,3,4"
    assert f09.render_msg("ada", 3) == "Hi ada, you have 3 new messages."
    assert f09.render_msg_fmt("ada", 3) == "Hi ada, you have 3 new messages."


def test_f10():
    assert f10.loop_pct(["a", "b"]) == ["name=a", "name=b"]
    assert f10.loop_fmt(["a", "b"]) == ["name=a", "name=b"]
    assert f10.cond_pct("ada", True) == "!! ada !!"
    assert f10.cond_pct("ada", False) == "ada"
    assert f10.cond_fmt("ada", True) == "!! ada !!"
    assert f10.cond_fmt("ada", False) == "ada"
    assert f10.comp_pct(["a", "b"]) == ["a", "b"]
    assert f10.comp_fmt(["a", "b"]) == ["a", "b"]
    assert f10.lambda_pct() == "v=7"
    assert f10.lambda_fmt() == "v=7"
    assert f10.assert_msg(1) == 1
    assert f10.assert_msg_fmt(1) == 1
