from svc import covered_function


def test_covered():
    # Execute dynamically compiled code with a phantom co_filename. coverage.py
    # records "string" as a measured file; `coverage json` then exits non-zero
    # with "No source for code" unless invoked with --ignore-errors. Real
    # suites (e.g. Textualize/rich) do this, so the reporter must tolerate it.
    exec(compile("x = 1", "string", "exec"))
    assert covered_function() == 7
