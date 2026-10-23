"""Load test: many developers and admins with the dashboard open, as their browsers poll it (standard library only).

Each simulated user signs in with its own password account and polls what an open dashboard tab polls, at the
fork's intervals (site/src/api/queries/platform.ts) and upstream Coder's (the workspaces list):

  developer tab   workspaces list 5 s, classification 30 s, banner 60 s, schedule 60 s, me 30 s
  admin tab       + banner state 15 s, HUD 10 s, HUD history 10 s, cluster usage 3 s, announcement report 15 s,
                  quota 30 s, scheduler 30 s

--speed N divides every interval by N, so D developers at speed N load the services like D*N tabs.

  python3 load.py --url https://coder.example --ca ca.crt --admin-email admin@admin.com --admin-password admin \\
      --developers 100 --admins 5 --speed 10 --minutes 10 [--json out.json]

Users it creates are called load-dev-<n> / load-admin-<n> (kept for a re-run; --cleanup deletes them).
Exit status 1 when more than --max-error-rate of the requests fail or the p95 of any endpoint exceeds --max-p95.
"""
import argparse, json, random, ssl, statistics, sys, threading, time, urllib.error, urllib.request

DEV = [("workspaces", "/api/v2/workspaces?q=owner:me", 5), ("me", "/api/v2/users/me", 30),
       ("classification", "/__coder-ui/api/classification", 30), ("banner", "/__banner/banner.json", 60),
       ("schedule-me", "/__coder-ui/api/scheduler/me", 60)]
ADMIN = DEV + [("banner-state", "/__banner/api/state", 15), ("hud", "/__coder-ui/api/hud", 10),
               ("hud-history", "/__coder-ui/api/hud/history?range=1h", 10),
               ("cluster-usage", "/__coder-ui/api/cluster/usage", 3), ("acks", "/__coder-ui/api/acks", 15),
               ("quota", "/__coder-ui/api/quota", 30), ("scheduler", "/__coder-ui/api/scheduler", 30)]


class Client:
    def __init__(self, url, ctx, timeout):
        self.url, self.ctx, self.timeout = url.rstrip("/"), ctx, timeout

    def call(self, path, body=None, method=None, token=None):
        h = {"X-Requested-With": "coder-ui"}
        data = None
        if body is not None:
            data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
        if token:
            h["Coder-Session-Token"] = token
        req = urllib.request.Request(self.url + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()


def ensure_users(c, admin, prefix, n, owner, password):
    s, orgs = c.call("/api/v2/organizations", token=admin)
    org = json.loads(orgs)[0]["id"]
    tokens = []
    for i in range(n):
        name = "%s-%d" % (prefix, i)
        email = "%s@load.test" % name
        for _ in range(30):
            s, _ = c.call("/api/v2/users", {"email": email, "username": name, "password": password,
                                            "login_type": "password", "organization_ids": [org]}, token=admin)
            if s != 429:
                break
            time.sleep(5)
        if s not in (201, 409, 400):
            raise SystemExit("creating %s: %s" % (name, s))
        if owner:
            s, me = c.call("/api/v2/users/%s" % name, token=admin)
            c.call("/api/v2/users/%s/roles" % name, {"roles": ["owner"]}, method="PUT", token=admin)
        # Coder limits sign-ins per address (60 a minute): every simulated user signs in from this one, so wait.
        for _ in range(30):
            s, b = c.call("/api/v2/users/login", {"email": email, "password": password})
            if s != 429:
                break
            time.sleep(5)
        if s != 201:
            raise SystemExit("signing in %s: %s %s" % (name, s, b[:200]))
        tokens.append(json.loads(b)["session_token"])
    return tokens


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True); ap.add_argument("--ca")
    ap.add_argument("--admin-email", default="admin@admin.com"); ap.add_argument("--admin-password", default="admin")
    ap.add_argument("--developers", type=int, default=50); ap.add_argument("--admins", type=int, default=3)
    ap.add_argument("--speed", type=float, default=1.0); ap.add_argument("--minutes", type=float, default=5)
    ap.add_argument("--timeout", type=float, default=30); ap.add_argument("--json")
    ap.add_argument("--max-error-rate", type=float, default=0.01); ap.add_argument("--max-p95", type=float, default=2.0)
    ap.add_argument("--cleanup", action="store_true")
    a = ap.parse_args()
    ctx = ssl.create_default_context(cafile=a.ca) if a.ca else ssl.create_default_context()
    c = Client(a.url, ctx, a.timeout)
    s, b = c.call("/api/v2/users/login", {"email": a.admin_email, "password": a.admin_password})
    if s != 201:
        raise SystemExit("admin sign-in: %s" % s)
    admin = json.loads(b)["session_token"]
    password = "Load-test-pw-%d!" % 7
    if a.cleanup:
        for prefix in ("load-dev", "load-admin"):
            for i in range(1000):
                s, _ = c.call("/api/v2/users/%s-%d" % (prefix, i), method="DELETE", token=admin)
                if s == 404:
                    break
        print("load users deleted"); return
    print("users: %d developers, %d admins (speed x%g = about %d tabs), %g minutes" % (
        a.developers, a.admins, a.speed, int((a.developers + a.admins) * a.speed), a.minutes), flush=True)
    devs = ensure_users(c, admin, "load-dev", a.developers, False, password)
    admins = ensure_users(c, admin, "load-admin", a.admins, True, password)

    lock, samples, errors = threading.Lock(), {}, {}
    stop = time.time() + a.minutes * 60

    def user(token, plan):
        due = {name: time.time() + random.uniform(0, iv / a.speed) for name, _, iv in plan}
        while time.time() < stop:
            name = min(due, key=due.get)
            wait = due[name] - time.time()
            if wait > 0:
                time.sleep(min(wait, max(0.0, stop - time.time())))
                if time.time() >= stop:
                    break
            path, iv = next((p, i) for n, p, i in plan if n == name)
            t0 = time.time()
            try:
                st, _ = c.call(path, token=token)
            except Exception as e:  # noqa: BLE001 - timeouts, resets: counted
                st = type(e).__name__
            dt = time.time() - t0
            with lock:
                samples.setdefault(name, []).append(dt)
                if st != 200:
                    errors.setdefault(name, {}).setdefault(str(st), 0)
                    errors[name][str(st)] += 1
            due[name] = time.time() + iv / a.speed

    threads = [threading.Thread(target=user, args=(t, DEV), daemon=True) for t in devs]
    threads += [threading.Thread(target=user, args=(t, ADMIN), daemon=True) for t in admins]
    t0 = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=a.minutes * 60 + a.timeout + 30)
    elapsed = time.time() - t0

    def pct(xs, p):
        xs = sorted(xs)
        return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]
    report = {"developers": a.developers, "admins": a.admins, "speed": a.speed, "seconds": round(elapsed),
              "endpoints": {}}
    total = sum(len(v) for v in samples.values()); failed = sum(sum(e.values()) for e in errors.values())
    print("\n%-16s %8s %8s %8s %8s %8s  %s" % ("endpoint", "requests", "p50 s", "p95 s", "p99 s", "max s", "errors"))
    worst = 0.0
    for name in sorted(samples):
        xs = samples[name]
        row = {"requests": len(xs), "p50": round(statistics.median(xs), 3), "p95": round(pct(xs, 95), 3),
               "p99": round(pct(xs, 99), 3), "max": round(max(xs), 3), "errors": errors.get(name, {})}
        report["endpoints"][name] = row; worst = max(worst, row["p95"])
        print("%-16s %8d %8.3f %8.3f %8.3f %8.3f  %s" % (name, row["requests"], row["p50"], row["p95"], row["p99"],
                                                        row["max"], row["errors"] or ""))
    report.update(requests=total, failed=failed, rps=round(total / elapsed, 1),
                  errorRate=round(failed / total, 4) if total else 1.0, worstP95=worst)
    print("\n%d requests in %ds (%.1f/s), %d failed (%.2f%%), worst p95 %.3fs" % (
        total, elapsed, total / elapsed, failed, 100 * report["errorRate"], worst))
    if a.json:
        json.dump(report, open(a.json, "w"), indent=2)
    ok = report["errorRate"] <= a.max_error_rate and worst <= a.max_p95
    print("LOAD %s (limits: error rate %.2f%%, p95 %.1fs)" % ("PASS" if ok else "FAIL", 100 * a.max_error_rate, a.max_p95))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
