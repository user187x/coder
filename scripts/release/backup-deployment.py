#!/usr/bin/env python3
"""Save a private rollback snapshot and verify its databases in disposable PostgreSQL."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True)
    parser.add_argument("--namespace", default="coder")
    parser.add_argument("--release", default="coder")
    parser.add_argument("--cluster", default="coder-db")
    parser.add_argument("--postgres-image", default="ghcr.io/cloudnative-pg/postgresql:18.4-system-trixie")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.out or ROOT / "build/deployment-backups" / stamp
    output.mkdir(parents=True, exist_ok=False)
    kube = ["kubectl", "--context", args.context, "-n", args.namespace]
    helm = ["helm", "--kube-context", args.context, "-n", args.namespace]

    def save(name, command):
        with (output / name).open("wb") as stream:
            subprocess.run(command, stdout=stream, check=True)

    save("helm-values.yaml", helm + ["get", "values", args.release, "-o", "yaml"])
    save("helm-manifest.yaml", helm + ["get", "manifest", args.release])
    save("helm-history.json", helm + ["history", args.release, "-o", "json"])
    save("resources.json", kube + ["get", "deployments,statefulsets,pods,persistentvolumeclaims,configmaps", "-o", "json"])
    save("secrets.json", kube + ["get", "secrets", "-o", "json"])
    save("database-cluster.json", kube + ["get", "clusters.postgresql.cnpg.io", args.cluster, "-o", "json"])
    cluster = json.loads((output / "database-cluster.json").read_text())
    primary = cluster["status"]["currentPrimary"]
    execute = kube + ["exec", primary, "-c", "postgres", "--"]
    databases = subprocess.check_output(execute + ["psql", "-U", "postgres", "-Atc",
        "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname"], text=True).splitlines()
    save("globals.sql", execute + ["pg_dumpall", "-U", "postgres", "--globals-only"])
    dumps = []
    for index, database in enumerate(databases):
        name = f"database-{index}.dump"
        save(name, execute + ["pg_dump", "-U", "postgres", "-d", database, "-Fc"])
        dumps.append({"database": database, "file": name})
    (output / "databases.json").write_text(json.dumps(dumps, indent=2) + "\n")
    container = "coder-backup-check-" + uuid.uuid4().hex[:12]
    command = "initdb -D /tmp/db -U postgres --auth=trust >/dev/null && exec postgres -D /tmp/db -c listen_addresses='' -c unix_socket_directories=/tmp"
    with (output / "restore.log").open("wb") as log:
        subprocess.run(["docker", "run", "-d", "--name", container, "--network", "none",
                        "--entrypoint", "bash", args.postgres_image, "-c", command], stdout=log, check=True)
        try:
            subprocess.run(["docker", "exec", container, "bash", "-c",
                "for i in {1..60}; do pg_isready -h /tmp -U postgres -q && exit 0; sleep 1; done; exit 1"], check=True)
            globals_sql = (output / "globals.sql").read_bytes().replace(b"CREATE ROLE postgres;\n", b"")
            subprocess.run(["docker", "exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres",
                            "-v", "ON_ERROR_STOP=1"], input=globals_sql, stdout=log, stderr=log, check=True)
            for dump in dumps:
                database = dump["database"]
                if database != "postgres":
                    subprocess.run(["docker", "exec", container, "createdb", "-h", "/tmp", "-U", "postgres", database],
                                   stdout=log, stderr=log, check=True)
                with (output / dump["file"]).open("rb") as stream:
                    subprocess.run(["docker", "exec", "-i", container, "pg_restore", "-h", "/tmp", "-U", "postgres",
                                    "--exit-on-error", "-d", database], stdin=stream, stdout=log, stderr=log, check=True)
        finally:
            subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, check=True)
    (output / "VERIFIED.json").write_text(json.dumps({"context": args.context, "release": args.release,
        "primary": primary, "databases": databases, "restore_verified": True}, indent=2) + "\n")
    hashes = []
    for path in sorted(output.iterdir()):
        with path.open("rb") as stream:
            hashes.append(f"{hashlib.file_digest(stream, 'sha256').hexdigest()}  {path.name}\n")
    (output / "SHA256SUMS").write_text("".join(hashes))
    print(f"Verified rollback snapshot for {len(databases)} databases: {output}")


if __name__ == "__main__":
    main()
