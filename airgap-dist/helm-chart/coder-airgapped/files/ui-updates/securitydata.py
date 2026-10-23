"""Security data for the image builder's grades, kept current in an air gap: trivy's vulnerability database (and its
Java database, for .jar / .war / .ear) and the FIPS rules the FIPS check grades against.

The bundle has them all (the tools image's trivy cache, fips-rules.json next to this file). A newer set comes as a
security data file, made on a machine with internet access by development/tools/build-security-data.sh
(coder-security-data-<date>.tar.gz) and uploaded by an admin in Templates > Images > Settings:

  manifest.json                 {"format": 1, "createdAt", "trivy": {"version"}, "files": {path: sha256}}
  trivy/db/trivy.db, trivy/db/metadata.json             the vulnerability database (required)
  trivy/java-db/trivy-java.db, trivy/java-db/metadata.json   the Java database (optional)
  fips-rules.json               the FIPS rules (required)

Every file is checked against the manifest, the database against this trivy's schema, before the set becomes the
active one; the previous one is kept, and the bundled data can be restored. Scan Jobs fetch the active set from the
service (`python3 securitydata.py fetch URL DIR`) and report which data graded the image.
"""
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLED_RULES = os.path.join(HERE, "fips-rules.json")
BUNDLED_TRIVY_CACHE = os.environ.get("TRIVY_CACHE_DIR", "/opt/trivy-cache")
TRIVY_DB_SCHEMA = 2           # trivy 0.74's vulnerability database schema
MAX_BUNDLE = 6 * 1024 ** 3
AGING_DAYS, STALE_DAYS = 14, 30            # the vulnerability database
RULES_AGING_DAYS, RULES_STALE_DAYS = 180, 365
SMALL = 1024 * 1024
REQUIRED = ("trivy/db/trivy.db", "trivy/db/metadata.json", "fips-rules.json")
ALLOWED = set(REQUIRED) | {"trivy/java-db/trivy-java.db", "trivy/java-db/metadata.json"}

ROOT = None  # <builder volume>/security, set by setup()
TRIVY_VERSION = None  # read once at start (running trivy costs ~150 MB; the service's limit is small)


def trivy_version():
    try:
        p = subprocess.run(["trivy", "version", "--format", "json", "--cache-dir", "/nonexistent"],
                           capture_output=True, timeout=30)
        return json.loads(p.stdout or b"{}").get("Version")
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def setup(files_dir):
    global ROOT, TRIVY_VERSION
    TRIVY_VERSION = trivy_version()
    ROOT = os.path.join(files_dir, "security")
    os.makedirs(ROOT, exist_ok=True)
    for name in os.listdir(ROOT):  # half-finished uploads of a previous run
        if name.endswith(".upload"):
            os.remove(os.path.join(ROOT, name))


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _age_days(ts):
    try:
        t = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=datetime.timezone.utc)
    return max(0, (datetime.datetime.now(datetime.timezone.utc) - t).days)


def _level(days, aging, stale):
    return "unknown" if days is None else "stale" if days > stale else "aging" if days > aging else "current"


def _json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def job_stamp(security_dir):
    """In the scan Job: which data grades this scan (the fetched set's, else the bundled)."""
    trivy_dir = os.path.join(security_dir, "trivy") if security_dir else None
    fetched = bool(trivy_dir and os.path.isfile(os.path.join(trivy_dir, "db", "metadata.json")))
    cache = trivy_dir if fetched else BUNDLED_TRIVY_CACHE
    db = _json(os.path.join(cache, "db", "metadata.json")) or {}
    java = _json(os.path.join(cache, "java-db", "metadata.json"))
    r = (_json(os.path.join(security_dir, "fips-rules.json")) if fetched else None) or _json(BUNDLED_RULES) or {}
    version = trivy_version()
    return {"cacheDir": cache, "java": bool(java) and os.path.isfile(os.path.join(cache, "java-db", "trivy-java.db")),
            "rules": r, "stamp": {"source": "uploaded" if fetched else "bundled", "trivyVersion": version,
                                  "vulnerabilityDbUpdatedAt": db.get("UpdatedAt"),
                                  "javaDbUpdatedAt": (java or {}).get("UpdatedAt"),
                                  "fipsRules": {"version": r.get("version"), "published": r.get("published")}}}


def check_rules(rules):
    """A FIPS rules file as this version reads it, or ValueError."""
    if not isinstance(rules, dict) or rules.get("format") != 1:
        raise ValueError("fips-rules.json: not a format 1 rules file.")
    for key in ("version", "published", "standard"):
        if not isinstance(rules.get(key), str) or not rules[key]:
            raise ValueError("fips-rules.json: '%s' is missing." % key)
    ssh = rules.get("ssh") or {}
    for key in ("ciphers", "macs", "kex"):
        if not (isinstance(ssh.get(key), list) and ssh[key] and all(
                isinstance(x, str) and re.match(r"^[A-Za-z0-9@._-]+$", x) for x in ssh[key])):
            raise ValueError("fips-rules.json: ssh.%s must be a list of algorithm names." % key)
    if not re.match(r"^TLSv1\.[23]$", str((rules.get("tls") or {}).get("minProtocol", ""))):
        raise ValueError("fips-rules.json: tls.minProtocol must be TLSv1.2 or TLSv1.3.")
    re.compile(rules.get("providerPath") or "")
    for key in ("validatedPackages", "nonFipsLibraries"):
        if not (isinstance(rules.get(key), list) and all(isinstance(x, str) for x in rules[key])):
            raise ValueError("fips-rules.json: %s must be a list." % key)
    return rules


# --------------------------------------------------------------------------- the active set
def active_id():
    if not ROOT:
        return None
    a = _json(os.path.join(ROOT, "active.json")) or {}
    sid = a.get("id")
    return sid if sid and os.path.isfile(os.path.join(ROOT, sid, "bundle.tar.gz")) else None


def active_bundle():
    sid = active_id()
    return os.path.join(ROOT, sid, "bundle.tar.gz") if sid else None


def rules():
    """The FIPS rules in force: the uploaded set's, else the bundled ones."""
    sid = active_id()
    r = _json(os.path.join(ROOT, sid, "fips-rules.json")) if sid else None
    return r or _json(BUNDLED_RULES)


def _bundled_trivy():
    """The bundle's databases, from their metadata files (no trivy run: the service's memory is small)."""
    java = os.path.join(BUNDLED_TRIVY_CACHE, "java-db")
    return {"version": TRIVY_VERSION,
            "db": _json(os.path.join(BUNDLED_TRIVY_CACHE, "db", "metadata.json")),
            "javaDb": _json(os.path.join(java, "metadata.json")) if os.path.isfile(
                os.path.join(java, "trivy-java.db")) else None}


def _dated(meta):
    if not meta:
        return None
    days = _age_days(meta.get("UpdatedAt"))
    return {"updatedAt": meta.get("UpdatedAt"), "nextUpdate": meta.get("NextUpdate"),
            "downloadedAt": meta.get("DownloadedAt"), "ageDays": days,
            "level": _level(days, AGING_DAYS, STALE_DAYS)}


def status():
    """What grades images now, and how old it is: for the dashboard, and for each report."""
    sid = active_id()
    if sid:
        info = _json(os.path.join(ROOT, sid, "info.json")) or {}
        trivy = {"version": (info.get("manifest") or {}).get("trivy", {}).get("version"),
                 "db": info.get("db"), "javaDb": info.get("javaDb")}
        source = {"kind": "uploaded", "id": sid, "installedAt": info.get("installedAt"),
                  "installedBy": info.get("installedBy"), "createdAt": (info.get("manifest") or {}).get("createdAt"),
                  "file": info.get("file"), "sha256": info.get("sha256"), "size": info.get("size")}
    else:
        trivy = _bundled_trivy()
        source = {"kind": "bundled"}
    r = rules() or {}
    rules_days = _age_days(r.get("published"))
    db = _dated(trivy.get("db"))
    java = _dated(trivy.get("javaDb"))
    levels = [x["level"] for x in (db,) if x] + [_level(rules_days, RULES_AGING_DAYS, RULES_STALE_DAYS)]
    overall = "stale" if "stale" in levels else "aging" if "aging" in levels else (
        "unknown" if "unknown" in levels or not db else "current")
    history = []
    for name in sorted(os.listdir(ROOT) if ROOT else [], reverse=True):
        i = _json(os.path.join(ROOT, name, "info.json"))
        if i:
            history.append({"id": name, "installedAt": i.get("installedAt"), "installedBy": i.get("installedBy"),
                            "dbUpdatedAt": (i.get("db") or {}).get("UpdatedAt"), "active": name == sid})
    return {"source": source, "trivyVersion": trivy.get("version"), "vulnerabilityDb": db, "javaDb": java,
            "fipsRules": {"version": r.get("version"), "published": r.get("published"), "standard": r.get("standard"),
                          "summary": r.get("summary"), "sources": r.get("sources") or [], "ageDays": rules_days,
                          "level": _level(rules_days, RULES_AGING_DAYS, RULES_STALE_DAYS)},
            "level": overall, "history": history[:5],
            "thresholds": {"agingDays": AGING_DAYS, "staleDays": STALE_DAYS}}


def stamp():
    """What a report records about the data that graded it."""
    s = status()
    return {"source": s["source"]["kind"], "id": s["source"].get("id"), "trivyVersion": s["trivyVersion"],
            "vulnerabilityDbUpdatedAt": (s["vulnerabilityDb"] or {}).get("updatedAt"),
            "javaDbUpdatedAt": (s["javaDb"] or {}).get("updatedAt"),
            "fipsRules": {"version": s["fipsRules"]["version"], "published": s["fipsRules"]["published"]}}


# --------------------------------------------------------------------------- installing an uploaded set
def _safe_name(name):
    while name.startswith("./"):
        name = name[2:]
    if not name or name.startswith("/") or ".." in name.split("/"):
        raise ValueError("The file holds an unsafe path: %s" % name[:120])
    return name


def verify(path):
    """Reads the uploaded .tar.gz once (streamed), hashing every file: (manifest, small files' contents)."""
    hashes, small, sizes = {}, {}, {}
    try:
        with tarfile.open(path, mode="r|gz") as tf:
            for m in tf:
                if m.isdir():
                    continue
                if not m.isfile():
                    raise ValueError("The file holds a link or a device (%s): not a security data file." % m.name[:80])
                name = _safe_name(m.name)
                if name != "manifest.json" and name not in ALLOWED:
                    raise ValueError("Unexpected file in the security data: %s" % name[:120])
                f = tf.extractfile(m)
                digest = hashlib.sha256()
                buf = bytearray()
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    if len(buf) < SMALL:
                        buf += chunk[: SMALL - len(buf)]
                hashes[name], sizes[name] = digest.hexdigest(), m.size
                if m.size <= SMALL:
                    small[name] = bytes(buf)
    except (tarfile.TarError, EOFError, OSError) as e:
        raise ValueError("Not a readable .tar.gz security data file: %s" % e)
    try:
        manifest = json.loads(small.get("manifest.json") or b"")
    except ValueError:
        raise ValueError("The file has no manifest.json: make it with build-security-data.sh.")
    if manifest.get("format") != 1:
        raise ValueError("manifest.json: not a format 1 security data file.")
    listed = manifest.get("files") or {}
    for name in REQUIRED:
        if name not in hashes:
            raise ValueError("The security data lacks %s." % name)
    for name, h in hashes.items():
        if name == "manifest.json":
            continue
        if listed.get(name) != h:
            raise ValueError("%s does not match the manifest's checksum: the file is damaged or was changed." % name)
    for name in listed:
        if name not in hashes:
            raise ValueError("The manifest lists %s, which the file does not hold." % name)
    db = json.loads(small["trivy/db/metadata.json"])
    if db.get("Version") != TRIVY_DB_SCHEMA:
        raise ValueError("The vulnerability database is schema %s; this trivy reads schema %d. Make the file with "
                         "the same tools image (build-security-data.sh)." % (db.get("Version"), TRIVY_DB_SCHEMA))
    java = json.loads(small["trivy/java-db/metadata.json"]) if "trivy/java-db/metadata.json" in small else None
    if ("trivy/java-db/trivy-java.db" in hashes) != bool(java):
        raise ValueError("The Java database needs both trivy-java.db and its metadata.json.")
    fips = check_rules(json.loads(small["fips-rules.json"]))
    return manifest, db, java, fips


def install(upload_path, user, file_name):
    """Verifies an uploaded file and makes it the active set (the previous one is kept; older ones go)."""
    manifest, db, java, fips = verify(upload_path)
    digest = hashlib.sha256()
    with open(upload_path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    sid = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder = os.path.join(ROOT, sid)
    os.makedirs(folder)
    shutil.move(upload_path, os.path.join(folder, "bundle.tar.gz"))
    with open(os.path.join(folder, "fips-rules.json"), "w") as f:
        json.dump(fips, f, indent=2)
    info = {"id": sid, "installedAt": now(), "installedBy": user, "file": file_name, "sha256": digest.hexdigest(),
            "size": os.path.getsize(os.path.join(folder, "bundle.tar.gz")), "manifest": manifest,
            "db": db, "javaDb": java}
    with open(os.path.join(folder, "info.json"), "w") as f:
        json.dump(info, f, indent=2)
    activate(sid)
    return info


def activate(sid):
    """sid: an installed set, or None for the bundled data. Keeps the active set and the one before it."""
    prev = active_id()
    if sid and not os.path.isfile(os.path.join(ROOT, sid, "bundle.tar.gz")):
        raise ValueError("No such security data.")
    with open(os.path.join(ROOT, "active.json.tmp"), "w") as f:
        json.dump({"id": sid, "at": now()}, f)
    os.replace(os.path.join(ROOT, "active.json.tmp"), os.path.join(ROOT, "active.json"))
    keep = {sid, prev}
    sets = sorted(n for n in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, n)))
    for name in sets[:-2]:
        if name not in keep:
            shutil.rmtree(os.path.join(ROOT, name), ignore_errors=True)


# --------------------------------------------------------------------------- the scan Job's side
def fetch(url, dest):
    """The active set from the service, unpacked: DEST/trivy (the cache directory) and DEST/fips-rules.json."""
    os.makedirs(dest, exist_ok=True)
    with urllib.request.urlopen(url, timeout=600) as r, tarfile.open(fileobj=r, mode="r|gz") as tf:
        for m in tf:
            if not m.isfile():
                continue
            name = _safe_name(m.name)
            if name not in ALLOWED:
                continue
            target = os.path.join(dest, name)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with tf.extractfile(m) as src, open(target, "wb") as out:
                # flushed and dropped from the page cache as it goes: dirty pages count against the Job's memory
                written = 0
                for chunk in iter(lambda: src.read(1024 * 1024), b""):
                    out.write(chunk)
                    written += len(chunk)
                    if written >= 64 * 1024 * 1024:
                        out.flush()
                        os.fsync(out.fileno())
                        os.posix_fadvise(out.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
                        written = 0
    print("security data in %s" % dest)


if __name__ == "__main__":
    if sys.argv[1:2] == ["fetch"]:
        fetch(sys.argv[2], sys.argv[3])
    elif sys.argv[1:2] == ["check-rules"]:
        check_rules(_json(sys.argv[2]))
        print("ok")
    else:
        sys.exit(__doc__)
