#!/usr/bin/env python3
"""Benchmark sandbox VM spin-up latency vs e2b's ~150ms target.

Measures:
  1. boot      - POST /sandbox returns (FC boot + agent ready)
  2. boot+exec - boot + first exec round-trip (realistic time-to-first-output)
  3. kill      - DELETE /sandbox/:id

Runs N iterations sequentially (cold-ish: previous VM killed first), then
reports min/mean/p50/p95/p99/max.

Usage:
  python3 bench-spinup.py [--url URL] [--n N] [--concurrency C] [--keep]

Defaults: URL=http://localhost:8080, N=20, concurrency=1.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field


@dataclass
class Sample:
    boot_ms: float
    exec_ms: float
    kill_ms: float
    err: str | None = None


@dataclass
class Series:
    name: str
    values: list[float] = field(default_factory=list)

    def add(self, v: float) -> None:
        self.values.append(v)

    def stats(self) -> dict[str, float]:
        if not self.values:
            return {}
        s = sorted(self.values)
        n = len(s)

        def pct(p: float) -> float:
            k = max(0, min(n - 1, int(round((p / 100.0) * (n - 1)))))
            return s[k]

        return {
            "n": n,
            "min": s[0],
            "mean": statistics.fmean(s),
            "p50": pct(50),
            "p95": pct(95),
            "p99": pct(99),
            "max": s[-1],
            "stdev": statistics.pstdev(s) if n > 1 else 0.0,
        }


def http(method: str, url: str, body: dict | None = None, timeout: float = 30.0) -> tuple[int, dict]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        status = resp.status
    if not raw:
        return status, {}
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, {"raw": raw.decode(errors="replace")}


def one_iter(base: str, keep: bool) -> Sample:
    s = Sample(boot_ms=float("nan"), exec_ms=float("nan"), kill_ms=float("nan"))
    sb_id: str | None = None
    try:
        t0 = time.perf_counter()
        _, body = http("POST", f"{base}/sandbox", {"timeout_ms": 60_000})
        s.boot_ms = (time.perf_counter() - t0) * 1000.0
        sb_id = body.get("id")
        if not sb_id:
            s.err = f"no id in create resp: {body!r}"
            return s

        t0 = time.perf_counter()
        _, _ = http(
            "POST",
            f"{base}/sandbox/{sb_id}/exec",
            {"lang": "bash", "code": "echo ok"},
        )
        s.exec_ms = (time.perf_counter() - t0) * 1000.0
    except urllib.error.HTTPError as e:
        s.err = f"HTTP {e.code}: {e.read().decode(errors='replace')[:200]}"
    except Exception as e:  # noqa: BLE001
        s.err = f"{type(e).__name__}: {e}"
    finally:
        if sb_id and not keep:
            try:
                t0 = time.perf_counter()
                http("DELETE", f"{base}/sandbox/{sb_id}")
                s.kill_ms = (time.perf_counter() - t0) * 1000.0
            except Exception as e:  # noqa: BLE001
                if not s.err:
                    s.err = f"kill: {type(e).__name__}: {e}"
    return s


def fmt_row(label: str, st: dict[str, float]) -> str:
    if not st:
        return f"  {label:<12} (no data)"
    return (
        f"  {label:<12} n={int(st['n']):<3} "
        f"min={st['min']:6.1f}  mean={st['mean']:6.1f}  "
        f"p50={st['p50']:6.1f}  p95={st['p95']:6.1f}  "
        f"p99={st['p99']:6.1f}  max={st['max']:6.1f}  "
        f"stdev={st['stdev']:5.1f}  (ms)"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8080")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--concurrency", type=int, default=1)
    ap.add_argument("--warmup", type=int, default=2, help="discarded warmup iters")
    ap.add_argument("--keep", action="store_true", help="don't delete VMs after each iter")
    ap.add_argument("--json", action="store_true", help="emit raw samples as JSON")
    args = ap.parse_args()

    base = args.url.rstrip("/")

    # Reachability check
    try:
        _, hb = http("GET", f"{base}/health", timeout=5)
        if not hb.get("ok"):
            print(f"health check unexpected: {hb!r}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"cannot reach {base}/health: {e}", file=sys.stderr)
        return 2

    print(f"target  : {base}")
    print(f"iters   : {args.n} (warmup={args.warmup}, concurrency={args.concurrency})")
    print(f"e2b ref : ~150-200 ms cold spinup")
    print()

    # Warmup
    for _ in range(args.warmup):
        one_iter(base, args.keep)

    boot = Series("boot")
    execs = Series("boot+exec")
    kill = Series("kill")
    boot_only = Series("exec_only")  # exec - 0; we report separately
    failures: list[str] = []
    samples: list[Sample] = []

    t_wall = time.perf_counter()
    if args.concurrency <= 1:
        for i in range(args.n):
            s = one_iter(base, args.keep)
            samples.append(s)
            if s.err:
                failures.append(f"iter {i}: {s.err}")
                continue
            boot.add(s.boot_ms)
            execs.add(s.boot_ms + s.exec_ms)
            boot_only.add(s.exec_ms)
            if s.kill_ms == s.kill_ms:  # not NaN
                kill.add(s.kill_ms)
            print(
                f"  [{i+1:2d}/{args.n}] boot={s.boot_ms:6.1f}  "
                f"exec={s.exec_ms:6.1f}  kill={s.kill_ms:6.1f}  ms"
            )
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            futs = [ex.submit(one_iter, base, args.keep) for _ in range(args.n)]
            for i, f in enumerate(as_completed(futs)):
                s = f.result()
                samples.append(s)
                if s.err:
                    failures.append(f"iter {i}: {s.err}")
                    continue
                boot.add(s.boot_ms)
                execs.add(s.boot_ms + s.exec_ms)
                boot_only.add(s.exec_ms)
                if s.kill_ms == s.kill_ms:
                    kill.add(s.kill_ms)
                print(
                    f"  [{i+1:2d}/{args.n}] boot={s.boot_ms:6.1f}  "
                    f"exec={s.exec_ms:6.1f}  kill={s.kill_ms:6.1f}  ms"
                )
    wall_s = time.perf_counter() - t_wall

    print()
    print(f"results (wall {wall_s:.1f}s, {args.n - len(failures)}/{args.n} ok)")
    print(fmt_row("boot", boot.stats()))
    print(fmt_row("exec_only", boot_only.stats()))
    print(fmt_row("boot+exec", execs.stats()))
    print(fmt_row("kill", kill.stats()))

    bs = boot.stats()
    if bs:
        p50 = bs["p50"]
        verdict = (
            "FASTER than e2b reference"
            if p50 < 150
            else "ON PAR with e2b (<200ms)"
            if p50 < 200
            else "SLOWER than e2b reference (>200ms)"
        )
        print()
        print(f"verdict : boot p50={p50:.1f}ms — {verdict}")

    if failures:
        print()
        print(f"failures ({len(failures)}):")
        for f in failures[:10]:
            print(f"  {f}")
        if len(failures) > 10:
            print(f"  ... +{len(failures) - 10} more")

    if args.json:
        print()
        print(json.dumps(
            {
                "boot": boot.stats(),
                "exec_only": boot_only.stats(),
                "boot_plus_exec": execs.stats(),
                "kill": kill.stats(),
                "raw": [s.__dict__ for s in samples],
            },
            indent=2,
        ))

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
