"""Turns the suites' JSON lines into a report: report.md (by suite, every check, failures first) and a summary line.
  python3 report.py results.jsonl [--title T] [--out report.md] [--load load.json]"""
import argparse, collections, json, sys, time

ORDER = ["static", "unit", "upstream", "fork", "ui", "imagebuilder", "rollback", "load"]
TITLES = {"static": "Deliverable (static: chart, bundle, images)", "unit": "Unit tests (fork, platform service)",
          "upstream": "Coder's own capabilities (upstream)", "fork": "The fork's additions",
          "ui": "Dashboard in a browser (incl. memory soak, egress)", "imagebuilder": "Image builder offline",
          "rollback": "Rollback to upstream Coder", "load": "Load"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl"); ap.add_argument("--title", default="Verification report"); ap.add_argument("--out")
    ap.add_argument("--load")
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(a.jsonl) if l.strip()]
    by = collections.OrderedDict()
    for s in ORDER + sorted({r["suite"] for r in rows} - set(ORDER)):
        if any(r["suite"] == s for r in rows):
            by[s] = [r for r in rows if r["suite"] == s]
    total, passed = len(rows), sum(r["ok"] for r in rows)
    out = ["# %s" % a.title, "", "%s · **%d/%d checks passed**" % (time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), passed, total), "",
           "| Suite | Passed | Failed |", "|---|---:|---:|"]
    for s, rs in by.items():
        out.append("| %s | %d | %d |" % (TITLES.get(s, s), sum(r["ok"] for r in rs), sum(not r["ok"] for r in rs)))
    for s, rs in by.items():
        out += ["", "## %s" % TITLES.get(s, s), ""]
        for r in sorted(rs, key=lambda r: r["ok"]):
            out.append("- %s %s%s" % ("✅" if r["ok"] else "❌", r["name"], (" — " + r["detail"].replace("\n", " ")) if r["detail"] else ""))
    if a.load:
        L = json.load(open(a.load))
        out += ["", "## Load figures", "", "%d developers + %d admins at speed ×%g (about %d open tabs), %d s: %d requests "
                "(%.1f/s), error rate %.2f%%, worst p95 %.3f s" % (L["developers"], L["admins"], L["speed"],
                (L["developers"] + L["admins"]) * L["speed"], L["seconds"], L["requests"], L["rps"], 100 * L["errorRate"], L["worstP95"]),
                "", "| Endpoint | Requests | p50 s | p95 s | p99 s | max s | Errors |", "|---|---:|---:|---:|---:|---:|---|"]
        for n, e in sorted(L["endpoints"].items()):
            out.append("| %s | %d | %.3f | %.3f | %.3f | %.3f | %s |" % (n, e["requests"], e["p50"], e["p95"], e["p99"], e["max"], e["errors"] or ""))
    text = "\n".join(out) + "\n"
    if a.out:
        open(a.out, "w").write(text)
    print("%d/%d checks passed%s" % (passed, total, (" -> " + a.out) if a.out else ""))
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
