"""Legacy callback-style helpers.

These functions take a callback that is invoked with the result once the
"work" is done. In a real codebase the body would do I/O; here we simulate
it with a small computation so the test suite stays hermetic.
"""


def fetch_user(user_id, callback):
    """Simulate fetching a user record and pass it to ``callback``."""
    # Pretend we hit a database here.
    result = {"id": user_id, "name": "user-%d" % user_id}
    callback(result)


def save_data(payload, done):
    """Simulate persisting ``payload`` then invoking ``done`` with a receipt."""
    # Pretend we wrote to disk / DB here.
    receipt = {"ok": True, "size": len(payload)}
    done(receipt)
