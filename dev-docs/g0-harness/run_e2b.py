#!/usr/bin/env python3
"""
G0 Task 7 — re-run the SQLAlchemy migration coverage gate in an E2B sandbox,
against real SQLAlchemy 1.x APPLICATIONS (the 2026-06-19 STOP was measured on
libraries, whose tests don't exercise the data layer).

Flow (mirrors the 2026-06-18 phase-0 harness):
  1. spin up one E2B sandbox (node + python)
  2. upload the freshly-packed refactron tarball + driver.mjs
  3. npm i the tarball into a scratch dir (native deps rebuild for linux)
  4. per corpus: git clone (pinned) -> pip install (sqlalchemy<2 + pytest + coverage)
     -> HARD-GATE on a green `pytest -q` -> run driver.mjs -> collect SafetyReport
  5. aggregate readiness ratio = safe / (safe + unproven) and apply the G0 bands

Requires: E2B_API_KEY in the environment. Run:
    E2B_API_KEY=... python3 run_e2b.py
Results are written to ./results.json next to this script.
"""
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TGZ = HERE / "refactron-0.2.4.tgz"
DRIVER = HERE / "driver.mjs"
RESULTS = HERE / "results.json"

SANDBOX_TIMEOUT_S = 3000  # 50 min — CTFd's full-suite coverage run alone needs ~15-25 min
CMD_TIMEOUT_S = 900       # default per-command ceiling; per-corpus `driver_timeout` overrides

# --- CORPORA: vetted SQLAlchemy 1.x-idiom applications (research pass 2026-07-01).
#     `ref` pins a tag/commit. `pip` is install steps run in the repo dir.
#     `collect` is a fast collectability smoke (informational). Usability for the
#     aggregate is judged on the DRIVER's output (total>0 AND coverageAvailable),
#     not on a strict all-green pytest — a big real app shouldn't be excluded over
#     one stray failing test. The engine's own `coverage run -m pytest -q` (inside
#     the driver) is the measurement; these steps just get deps in place. ---
CORPORA = [
    {
        # HIGH confidence: SQLAlchemy 1.4.54 (pip-compiled on Py3.11), pervasive
        # `Users.query.filter_by(...)`, in-memory sqlite test suite, big query surface.
        "name": "CTFd",
        "url": "https://github.com/CTFd/CTFd",
        "ref": "3.8.6",
        "pip": [
            "pip install -q -r requirements.txt",
            "pip install -q -r development.txt || true",
            "pip install -q coverage pytest",
        ],
        "collect": "python3 -m pytest tests/ --co -q",
        "driver_timeout": 1800,  # 661 tests under coverage; 900s wasn't enough last run
    },
    {
        # HIGH confidence: sqlalchemy<2 (1.4.54), `session.query(model.Product).filter_by(...)`,
        # in-memory sqlite fixtures. Small query surface. e2e needs docker (skipped by --co scope).
        "name": "cosmicpython-code",
        "url": "https://github.com/cosmicpython/code",
        "ref": None,
        "pip": [
            "pip install -q -r requirements.txt",
            "pip install -q -e src/ || pip install -q -e . || true",
            "pip install -q coverage pytest",
        ],
        "collect": "python3 -m pytest tests/unit tests/integration --co -q",
    },
    {
        # MEDIUM: SQLAlchemy 1.4.23 pin (2021 era); force 3.11-safe wheels but stay on 1.4.
        # `Group.query.filter(...)` idioms, TestingConfig sqlite://.
        "name": "flaskbb",
        "url": "https://github.com/flaskbb/flaskbb",
        "ref": "v2.1.0",
        "pip": [
            "pip install -q -r requirements.txt || true",
            "pip install -q 'SQLAlchemy==1.4.54' 'greenlet>=2.0' 'Pillow>=9.5'",
            "pip install -q flask-login flask-babelplus flask-wtf flask-caching flask-debugtoolbar flask-limiter",
            "pip install -q -e . || true",
            "pip install -q coverage pytest",
        ],
        "collect": "python3 -m pytest --co -q",
    },
]

# G0 decision bands (readiness ratio = safe / (safe + unproven))
def band(ratio):
    if ratio is None:
        return "N/A (no usable corpora)"
    if ratio >= 0.50:
        return "PROCEED — an auto-rewriter is worth building"
    if ratio >= 0.25:
        return "FLAG-ONLY — preflight/detect-and-flag is the durable shape"
    return "STOP — auto-rewrite stays out of scope; double down on the verification/coverage product"


def main():
    if not os.environ.get("E2B_API_KEY"):
        sys.exit("E2B_API_KEY not set. Run:  E2B_API_KEY=... python3 run_e2b.py")
    if not TGZ.exists() or not DRIVER.exists():
        sys.exit(f"missing {TGZ.name} or {DRIVER.name} next to this script")

    try:
        from e2b import Sandbox
    except Exception as e:  # pragma: no cover
        sys.exit(f"e2b SDK import failed: {e}\n  pip install e2b")

    def log(m):
        print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    log("creating sandbox…")
    # Newer SDKs expose Sandbox.create(); older ones create on construction.
    try:
        sbx = Sandbox.create(timeout=SANDBOX_TIMEOUT_S)
    except AttributeError:
        sbx = Sandbox(timeout=SANDBOX_TIMEOUT_S)

    def run(cmd, cwd=None, timeout=CMD_TIMEOUT_S):
        """Run a shell command; never raise — return (exit_code, stdout, stderr)."""
        try:
            r = sbx.commands.run(cmd, cwd=cwd, timeout=timeout)
            return (r.exit_code, r.stdout, r.stderr)
        except Exception as e:  # CommandExitException carries the fields
            code = getattr(e, "exit_code", 1)
            return (code, getattr(e, "stdout", ""), getattr(e, "stderr", str(e)))

    results = {"corpora": [], "generated_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    try:
        # Toolchain sanity.
        for tool in ("node -v", "npm -v", "python3 --version", "git --version"):
            code, out, err = run(tool)
            log(f"  {tool} -> {(out or err).strip()}  (exit {code})")
            if code != 0 and tool.startswith("node"):
                sys.exit("node/npm not available in this sandbox template — need a node+python image")

        # Install refactron into a scratch dir so native deps rebuild for linux.
        log("uploading + installing refactron…")
        sbx.files.write("/home/user/refactron.tgz", TGZ.read_bytes())
        sbx.files.write("/home/user/driver.mjs", DRIVER.read_text())
        mc, mo, me = run("mkdir -p /home/user/rf && cd /home/user/rf && npm init -y")
        if mc != 0:
            log("  scratch-dir setup FAILED:\n" + (me or mo)[-800:])
            sys.exit("could not create scratch dir in sandbox")
        code, out, err = run("cd /home/user/rf && npm install /home/user/refactron.tgz", timeout=CMD_TIMEOUT_S)
        if code != 0:
            log("  npm install FAILED:\n" + (err or out)[-2000:])
            sys.exit("refactron install failed in sandbox")
        dist = "/home/user/rf/node_modules/refactron/dist"
        code, out, _ = run(f"test -f {dist}/analyze/engine.js && echo ok")
        log(f"  refactron dist present: {out.strip() or 'NO'}")

        # Per corpus.
        for c in CORPORA:
            entry = {"name": c["name"], "url": c["url"], "ref": c["ref"],
                     "status": None, "collectable": False, "report": None, "note": ""}
            log(f"=== corpus: {c['name']} ===")
            d = f"/home/user/corpora/{c['name']}"
            ref = f"--branch {c['ref']} " if c["ref"] else ""
            code, out, err = run(f"git clone --depth 1 {ref}{c['url']} {d}", timeout=CMD_TIMEOUT_S)
            if code != 0:
                entry["status"] = "clone-failed"; entry["note"] = (err or out)[-500:]
                results["corpora"].append(entry); log("  clone FAILED"); continue

            for step in c["pip"]:
                pc, po, pe = run(step, cwd=d, timeout=CMD_TIMEOUT_S)
                log(f"  pip step exit {pc}: {step[:60]}")

            # Collectability smoke (informational): can pytest import + collect the
            # suite? Distinguishes a runnable app from a broken/template repo. NOT a
            # hard gate — the driver's own coverage run is the real measurement.
            cc, co, ce = run(c["collect"], cwd=d, timeout=CMD_TIMEOUT_S)
            entry["collectable"] = (cc == 0)
            ctail = (co + "\n" + ce).strip().splitlines()[-2:]
            log(f"  collect exit {cc}: " + " | ".join(ctail))

            # Always run the driver (preflight logic). Its internal `coverage run -m
            # pytest -q` is what tags each site covered/uncovered.
            dc, do, de = run(f"node /home/user/driver.mjs {dist} {d}", cwd=d,
                             timeout=c.get("driver_timeout", CMD_TIMEOUT_S))
            if dc != 0:
                entry["status"] = "driver-failed"; entry["note"] = (de or do)[-800:]
                results["corpora"].append(entry); log("  driver FAILED"); continue
            try:
                entry["report"] = json.loads(do)
                entry["status"] = "ok"
                ct = entry["report"]["counts"]
                log(f"  -> total={entry['report']['total']} counts={ct} covAvail={entry['report']['coverageAvailable']}")
            except Exception as ex:
                entry["status"] = "bad-json"; entry["note"] = f"{ex}: {do[:400]}"
            results["corpora"].append(entry)

        # Usable for the aggregate = the driver produced a report with actual 1.x
        # sites AND real coverage data (coverageAvailable). This is what makes the
        # safe/unproven split meaningful — independent of stray test failures.
        # `collectable` is REQUIRED: if pytest couldn't even import the suite, the
        # coverage run executed nothing, so every site defaults to uncovered→unproven
        # — a FALSE signal (this is what a dep-broken repo like flaskbb produces).
        # Excluding it is what prevents a fake STOP.
        usable = [e for e in results["corpora"]
                  if e["status"] == "ok" and e["collectable"]
                  and e["report"]["total"] > 0 and e["report"]["coverageAvailable"]]
        agg_safe = sum(e["report"]["counts"]["safe-to-automate"] for e in usable)
        agg_unp = sum(e["report"]["counts"]["unproven"] for e in usable)
        agg_review = sum(e["report"]["counts"]["needs-review"] for e in usable)
        denom = agg_safe + agg_unp
        ratio = (agg_safe / denom) if denom > 0 else None
        results["aggregate"] = {
            "usable_corpora": [e["name"] for e in usable],
            "safe_to_automate": agg_safe, "unproven": agg_unp, "needs_review": agg_review,
            "readiness_ratio": ratio, "verdict": band(ratio),
        }
        log("================ G0 (app corpora) ================")
        log(f"usable corpora: {results['aggregate']['usable_corpora']}")
        log(f"safe={agg_safe} unproven={agg_unp} needs-review={agg_review}")
        log(f"readiness ratio = {ratio if ratio is None else round(ratio*100,1)}%  ->  {results['aggregate']['verdict']}")
    finally:
        RESULTS.write_text(json.dumps(results, indent=2))
        log(f"results written to {RESULTS}")
        try:
            sbx.kill()
        except Exception:
            pass


if __name__ == "__main__":
    main()
