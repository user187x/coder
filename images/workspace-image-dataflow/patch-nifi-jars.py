#!/usr/bin/env python3
"""Replaces the libraries of NiFi's binary distribution that have known vulnerabilities fixed in a compatible release
with that release, from Maven Central (each checked against the SHA-256 pinned below, which matches Maven Central's
published checksums): in lib/bootstrap, inside the NARs of lib/ (META-INF/bundled-dependencies) and inside the WARs
those NARs bundle (WEB-INF/lib). A replaced jar is renamed for its new version (jackson-core-2.22.2.jar becomes
jackson-core-2.22.4.jar); NiFi's class loaders take every jar of those directories, whatever its name.

Two jars bundle a relocated ("shaded") copy of a vulnerable library and have no newer release: parquet-jackson and
hazelcast (RESHADE below). They are rebuilt with the fixed release of that library relocated exactly as their own build
relocates it (their maven-shade-plugin rules, reimplemented here); everything else in them stays as published. Before
that, the same relocation of the library versions they were built with must reproduce the classes they ship (the same
class files; in each, every constant of theirs and the same string constants), or the build stops.

Run it on the unpacked distribution before NiFi's first start: NiFi then unpacks the patched NARs into its NAR working
directory (work/nar). It would also re-unpack, over an older unpacked copy, any NAR whose digest changed, but the
Dockerfile leaves no older copy (work/nar does not exist before that start), and `check` afterwards fails on any old
jar left anywhere: in a directory (work/nar's unpacked NARs), a NAR or a WAR, or an old library inside a re-shaded jar.

  patch-nifi-jars.py patch NIFI_HOME    download the jars below and replace (or re-shade) the old ones
  patch-nifi-jars.py check DIR          fail if any jar replaced below is still in DIR (recursively, NARs and WARs too)

MAVEN_REPO=<url> takes the jars from a Maven repository mirror instead of Maven Central (same checksums).
Only stdlib: it runs on the image's own python3.
"""
import fnmatch
import hashlib
import io
import os
import re
import struct
import sys
import tempfile
import time
import urllib.request
import zipfile

REPO = os.environ.get("MAVEN_REPO", "https://repo1.maven.org/maven2").rstrip("/")

# (groupId, artifactId, version in NiFi 2.12.0, fixed version, SHA-256 of the fixed jar). Patch releases unless noted.
JARS = [
    # lib/bootstrap; nifi-framework-nar, nifi-standard-shared-nar, nifi-amqp-nar, nifi-kafka-to-s3-nar,
    # nifi-update-attribute-nar's UI WAR
    ("com.fasterxml.jackson.core", "jackson-core", "2.22.2", "2.22.4",
     "2d30c375cddea9657a1e1ef97547a2694b663b355facb4de53a097782b312d1a"),
    ("com.fasterxml.jackson.core", "jackson-databind", "2.22.2", "2.22.4",
     "d4cbf8947087f305869826801913abdc50735a1fab2074a1993e7bc67ca974a3"),
    # nifi-standard-nar, nifi-jolt-nar and its UI WAR
    ("tools.jackson.core", "jackson-core", "3.2.2", "3.2.4",
     "494b9f5fccf008042d5a72c5bf00629b144c0ba7362a9864cbb02234c9772651"),
    ("tools.jackson.core", "jackson-databind", "3.2.2", "3.2.4",
     "c4af37223d5024f1294a5450598b01b65f30c53d9e906f02c3955ba1fb14a67d"),
    # nifi-aws-nar, nifi-kafka-3-service-nar, nifi-kafka-service-aws-nar
    ("at.yawk.lz4", "lz4-java", "1.11.2", "1.11.4",
     "58c8e0b813960d2a248e050c353baea73139b48a2ffc55382d42c69707e17325"),
    # nifi-amqp-nar; a minor release: the advisories' fix (5.36.1) was never published, 5.37.0 is the next one
    ("com.rabbitmq", "amqp-client", "5.35.0", "5.37.0",
     "b27134820890c5e56ed57d27cc50b70742fa2c31b36a6e9e28e14a43f34ff96f"),
    # nifi-aws-nar: Square Wire, which only the AWS Glue Schema Registry serde (schema-registry-serde 1.1.24, behind
    # the Kinesis Client Library) uses, for Protobuf schemas. A major release: the whole Wire family moves together to
    # 6.4.7, the version NiFi's own nifi-protobuf-services-nar ships (wire-runtime-jvm, wire-schema-jvm 6.4.7)
    ("com.squareup.wire", "wire-runtime", "5.2.0", "6.4.7",
     "6c8997423d5dd5e9fd01412a25f65d6bbea9497d531bf953354ac4305b0632e0"),
    ("com.squareup.wire", "wire-runtime-jvm", "5.2.0", "6.4.7",
     "83d56e2b348429ebc975aad62870c1b1e3dd1e9dc6eab6d618abacbeee66280f"),
    ("com.squareup.wire", "wire-schema", "5.2.0", "6.4.7",
     "2187d6f67875aca71c111ad6d8f002191253732f0a09132aa262ad7114b42d31"),
    ("com.squareup.wire", "wire-schema-jvm", "5.2.0", "6.4.7",
     "c676dc914a9ca64252c731f40ad1f9fe4cd263012272f326eaaba0b62cd1ba1a"),
    ("com.squareup.wire", "wire-compiler", "5.2.0", "6.4.7",
     "69ae4fdb5439b3c1514af9f0ac2a9f54813e40525b0c334510b03ede29c0856b"),
    ("com.squareup.wire", "wire-java-generator", "5.2.0", "6.4.7",
     "5dc1105e4d3095ad7de68ae353f1c20031f9d06d14cf9e80fafae777e8ed6a82"),
    ("com.squareup.wire", "wire-kotlin-generator", "5.2.0", "6.4.7",
     "e74cba1267580999f76c4b4da27dea3ab5e5ea00c9364b9e65a0a52ac08e41f1"),
    ("com.squareup.wire", "wire-swift-generator", "5.2.0", "6.4.7",
     "622c5cda05009e9fd1c67bef958cd42e3a6347ceb98d25f266817538e3ece74e"),
    ("com.squareup.wire", "wire-grpc-client-jvm", "5.2.0", "6.4.7",
     "65c80c03f71577ed4aa2ad6c5b081aee46705bad3dcfa9300b94acab7a39ff74"),
]
# old file name -> entry; the old versions differ, so the name alone tells com.fasterxml's jackson from tools.jackson's
OLD = {f"{a}-{old}.jar": (g, a, old, new, sha) for g, a, old, new, sha in JARS}

# Jars with a relocated vulnerable library inside and no newer release. Each: the published jar's SHA-256 (the one the
# rules were checked against), the relocations and the source-file exclusions of its maven-shade-plugin configuration
# (in order: the first relocation that applies wins), and the libraries to replace in it: (groupId, artifactId, package
# root, version inside, its SHA-256, fixed version, its SHA-256) - the newest patch of the same minor.
_FX, _TJ = "com.fasterxml.jackson.core", "tools.jackson.core"
_HZ = "com.hazelcast.shaded"
RESHADE = {
    # nifi-iceberg-parquet-writer-nar. apache/parquet-java 1.18.1, parquet-jackson/pom.xml: com.fasterxml.jackson to
    # shaded.parquet.com.fasterxml.jackson, and the multi-release directories it names; every file of the artifacts.
    "parquet-jackson-1.18.1.jar": dict(
        sha256="1914fed4ed18999ce98ad844aa5d0b09f31027be329ffd82d861d6f7c6f097c7",
        relocations=[("com.fasterxml.jackson", "shaded.parquet.com.fasterxml.jackson")] + [
            (f"META-INF.versions.{v}.com.fasterxml.jackson", f"META-INF.versions.{v}.shaded.parquet.com.fasterxml.jackson")
            for v in (9, 11, 17, 19, 21, 22)],
        drop=[],
        libs=[
            (_FX, "jackson-core", "com/fasterxml/jackson/core/",
             "2.22.2", "ff167a6317be15895706c26668f45b898efe40ab8780970658210fe1393d52a6",
             "2.22.4", "2d30c375cddea9657a1e1ef97547a2694b663b355facb4de53a097782b312d1a"),
            (_FX, "jackson-databind", "com/fasterxml/jackson/databind/",
             "2.22.2", "d0da14c12b16b5d54719aa172d83b542ff4abeb8b0fb7db476fde8ceece760ca",
             "2.22.4", "d4cbf8947087f305869826801913abdc50735a1fab2074a1993e7bc67ca974a3"),
        ]),
    # nifi-hazelcast-services-nar. hazelcast/hazelcast v5.7.0: hazelcast-parent/pom.xml (tools.jackson and
    # com.fasterxml.jackson but its annotation package; their multi-release classes by raw-string patterns - written
    # here with fixed-width lookbehinds, as Python's re needs) followed by hazelcast/pom.xml's own relocations; files
    # left out: module-info.class and the multi-release classes for Java 9 and 11.
    "hazelcast-5.7.0.jar": dict(
        sha256="241ec66cea8491787f68c3336f069ac463877af50bdb7676cd9d538f1940dc33",
        relocations=[
            ("tools.jackson", f"{_HZ}.tools.jackson"),
            ("com.fasterxml.jackson", f"{_HZ}.com.fasterxml.jackson", ["com.fasterxml.jackson.annotation.*"]),
            (r"(?:(?<=META-INF/versions/\d/)|(?<=META-INF/versions/\d\d/))com/fasterxml/jackson(?!/annotation)",
             "com/hazelcast/shaded/com/fasterxml/jackson", None, True),
            (r"(?:(?<=META-INF/versions/\d/)|(?<=META-INF/versions/\d\d/))tools/jackson(?!/annotation)",
             "com/hazelcast/shaded/tools/jackson", None, True),
        ] + [(p, f"{_HZ}.{p}") for p in ("org.snakeyaml", "org.jctools", "io.github.classgraph",
                                         "nonapi.io.github.classgraph", "org.everit.json.schema", "org.json",
                                         "org.objenesis", "com.zaxxer.hikari")],
        drop=["module-info.class", "**/module-info.class", "META-INF/versions/9/**", "META-INF/versions/11/**",
              "META-INF/MANIFEST.MF", "META-INF/LICENSE", "LICENSE", "NOTICE"],
        libs=[
            (_FX, "jackson-core", "com/fasterxml/jackson/core/",
             "2.21.2", "12e8655b100267b44d0f14d01b1f5082a5105e616174dc4307be1a761e92407b",
             "2.21.8", "604ef7765013daf5cde192e40bc4c8412c4ca93f4aaf7bf8e9a62fad1e1026bb"),
            (_FX, "jackson-databind", "com/fasterxml/jackson/databind/",
             "2.21.2", "8c982f01f148d805f0aaac2339011244757e0df7c6ff8951f2fa3f433b8ed849",
             "2.21.8", "ad77f2285717e2f34c319d988b7c85783a47d0b33f33a501d1fcbf196e61bbaa"),
            (_TJ, "jackson-core", "tools/jackson/core/",
             "3.1.2", "bbb00763f5998f03a26f21e47ed500f253c7fc5c158fa3e8a41dbf97aa7416fd",
             "3.1.8", "762caa009970e8c35527fcc2cfbde50afed0d6a195ee4a7fac22d80fea72c471"),
            (_TJ, "jackson-databind", "tools/jackson/databind/",
             "3.1.2", "0a366b1c2f6321e466c2970847b1251a5dc7201b680f320594230b77bfc8ddb2",
             "3.1.8", "2e7583c96f3eaf11591a727c75278b25a0f1227d29a7c5e8306f252f441bfb58"),
        ]),
}


def die(msg):
    print(f"patch-nifi-jars: {msg}", file=sys.stderr)
    sys.exit(1)


# ---- relocation, as maven-shade-plugin (3.x) does it: SimpleRelocator and its RelocatorRemapper ---------------------

def _match_path(pattern, path):
    """Ant-style path match (plexus SelectorUtils.matchPath): '*' within a segment, '**' across segments."""
    pp, sp = pattern.split("/"), path.split("/")

    def m(i, j):
        if i == len(pp):
            return j == len(sp)
        if pp[i] == "**":
            return any(m(i + 1, k) for k in range(j, len(sp) + 1))
        return j < len(sp) and fnmatch.fnmatchcase(sp[j], pp[i]) and m(i + 1, j + 1)
    return m(0, 0)


class Relocator:
    def __init__(self, pattern, shaded, excludes=None, raw=False):
        self.raw = raw
        if raw:
            self.regex, self.shaded_path = re.compile(pattern), shaded
        else:
            self.dot, self.path = pattern.replace("/", "."), pattern.replace(".", "/")
            self.shaded_dot, self.shaded_path = shaded.replace("/", "."), shaded.replace(".", "/")
        self.excludes = []
        for e in excludes or ():
            p = e.replace(".", "/")
            self.excludes.append(p)
            if p.endswith("/*") or p.endswith("/**"):
                self.excludes.append(p[: p.rindex("/")])

    def can_path(self, path):
        if self.raw:
            return self.regex.search(path) is not None
        if path.endswith(".class"):
            path = path[:-6]
        if path.startswith("/"):
            path = path[1:]
        return not any(_match_path(e, path) for e in self.excludes) and path.startswith(self.path)

    def can_class(self, name):
        return not self.raw and "/" not in name and self.can_path(name.replace(".", "/"))

    def relocate_path(self, path):
        return self.regex.sub(self.shaded_path, path) if self.raw else path.replace(self.path, self.shaded_path, 1)

    def relocate_class(self, name):
        return name if self.raw else name.replace(self.dot, self.shaded_dot, 1)


_CLASS_DESC = re.compile(r"(\[*)?L(.+);")
_DESC_NAME = re.compile(r"L([^;<>()\[\]\s.]+)(?=[;<])")


class Shader:
    def __init__(self, rules):
        self.rs = [Relocator(*r) for r in rules]

    def map(self, name):
        """Internal names and class descriptors (Remapper.map)."""
        prefix, suffix, n = "", "", name
        m = _CLASS_DESC.fullmatch(name)
        if m:
            prefix, suffix, n = (m.group(1) or "") + "L", ";", m.group(2)
        for r in self.rs:
            if r.can_path(n):
                return prefix + r.relocate_path(n) + suffix
        return name

    def map_value(self, s):
        """String constants (Remapper.mapValue): relocated only when the whole string starts with a pattern."""
        prefix, suffix, n = "", "", s
        m = _CLASS_DESC.fullmatch(s)
        if m:
            prefix, suffix, n = (m.group(1) or "") + "L", ";", m.group(2)
        for r in self.rs:
            if r.can_class(n):
                return prefix + r.relocate_class(n) + suffix
            if r.can_path(n):
                return prefix + r.relocate_path(n) + suffix
        return s

    def map_desc(self, s):
        """Descriptors and signatures: every class name in them."""
        return _DESC_NAME.sub(lambda m: "L" + self.map(m.group(1)), s)

    def map_service(self, s):
        for r in self.rs:
            if r.can_class(s):
                return r.relocate_class(s)
        return s

    def relocate_class_file(self, b):
        """The class file with every constant-pool string relocated for its use (class name, descriptor, string)."""
        n = struct.unpack(">H", b[8:10])[0]
        i, k, cp, roles = 10, 1, [None] * n, {}
        role = lambda idx, r: roles.setdefault(idx, set()).add(r)
        while k < n:
            t = b[i]
            if t == 1:
                ln = struct.unpack(">H", b[i + 1:i + 3])[0]
                cp[k] = (1, b[i + 3:i + 3 + ln])
                i += 3 + ln
            elif t in (3, 4):
                cp[k] = (t, b[i:i + 5]); i += 5
            elif t in (5, 6):
                cp[k] = (t, b[i:i + 9]); i += 9; k += 1
            elif t in (7, 8, 16, 19, 20):
                cp[k] = (t, b[i:i + 3])
                idx = struct.unpack(">H", b[i + 1:i + 3])[0]
                # (module and package names stay: ASM's Remapper leaves them, as the shaded module-info.class shows)
                role(idx, {7: "class", 8: "string", 16: "desc", 19: "keep", 20: "keep"}[t])
                i += 3
            elif t in (9, 10, 11, 17, 18):
                cp[k] = (t, b[i:i + 5]); i += 5
            elif t == 12:
                cp[k] = (t, b[i:i + 5])
                nm, ds = struct.unpack(">HH", b[i + 1:i + 5])
                role(nm, "keep"); role(ds, "desc")
                i += 5
            elif t == 15:
                cp[k] = (t, b[i:i + 4]); i += 4
            else:
                raise ValueError(f"constant pool tag {t}")
            k += 1
        out = [b[:10]]
        for idx in range(1, n):
            e = cp[idx]
            if e is None:
                continue
            if e[0] != 1:
                out.append(e[1])
                continue
            s = e[1].decode("latin-1")  # byte for byte: the patterns are ASCII
            results = set()
            for r in roles.get(idx, {"other"}):
                if r == "class":
                    results.add(self.map(s))
                elif r == "string":
                    results.add(self.map_value(s))
                elif r == "desc":
                    results.add(self.map_desc(s))
                elif r == "keep":
                    results.add(s)
                else:  # descriptors and signatures in attributes, annotation values
                    d = self.map_desc(s)
                    results.add(d if d != s else self.map_value(s))
            if len(results) != 1:
                raise ValueError(f"constant {s!r} relocates differently for its uses: {results}")
            v = results.pop().encode("latin-1")
            out.append(b"\x01" + struct.pack(">H", len(v)) + v)
        return b"".join(out) + b[i:]

    def shade(self, jar_bytes, drop):
        """The files maven-shade-plugin takes from one artifact, relocated: {name: bytes}."""
        out = {}
        z = zipfile.ZipFile(io.BytesIO(jar_bytes))
        for info in z.infolist():
            n = info.filename
            if n.endswith("/") or any(_match_path(p, n) for p in drop):
                continue
            data = z.read(info)
            if n.endswith(".class"):
                out[self.map(n[:-6]) + ".class"] = self.relocate_class_file(data)
            elif n.startswith("META-INF/services/"):
                lines = [self.map_service(ln.strip()) for ln in data.decode().splitlines()
                         if ln.strip() and not ln.startswith("#")]
                out["META-INF/services/" + self.map_service(n[len("META-INF/services/"):])] = lines
            else:
                out[self.map(n)] = data
        return out


def _constants(b):
    """(all constant-pool strings, the string constants) of a class file."""
    n = struct.unpack(">H", b[8:10])[0]
    i, k, utf, strs = 10, 1, {}, set()
    while k < n:
        t = b[i]
        if t == 1:
            ln = struct.unpack(">H", b[i + 1:i + 3])[0]
            utf[k] = b[i + 3:i + 3 + ln]
            i += 3 + ln
        elif t in (3, 4, 9, 10, 11, 12, 17, 18):
            i += 5
        elif t in (5, 6):
            i += 9; k += 1
        elif t == 8:
            strs.add(struct.unpack(">H", b[i + 1:i + 3])[0]); i += 3
        elif t in (7, 16, 19, 20):
            i += 3
        elif t == 15:
            i += 4
        k += 1
    return set(utf.values()), {utf[s] for s in strs}


def _owned(name, root):
    """Whether a class of the shaded jar belongs to the library whose relocated package root is `root`."""
    return name.endswith(".class") and re.sub(r"^META-INF/versions/\d+/", "", name).startswith(root)


def reshade(jar_name, data, artifacts):
    spec = RESHADE[jar_name]
    got = hashlib.sha256(data).hexdigest()
    if got != spec["sha256"]:
        die(f"{jar_name}: SHA-256 {got}, not the jar its relocation rules were checked against")
    sh = Shader(spec["relocations"])
    zin = zipfile.ZipFile(io.BytesIO(data))
    names = set(zin.namelist())
    remove, add, notes = set(), {}, []
    for g, a, root, old, _, new, _ in spec["libs"]:
        rroot = sh.map(root)
        pom = f"META-INF/maven/{g}/{a}/"
        # 1. The relocation of the version inside must reproduce what the jar ships.
        before = sh.shade(artifacts[(g, a, old)], spec["drop"])
        theirs = {n for n in names if _owned(n, rroot)}
        ours = {n for n in before if _owned(n, rroot)}
        if theirs != ours:
            die(f"{jar_name}: relocating {a} {old} does not give its classes "
                f"(only in the jar: {sorted(theirs - ours)[:3]}, only relocated: {sorted(ours - theirs)[:3]})")
        for n in sorted(theirs):
            tu, ts = _constants(zin.read(n))
            ou, os_ = _constants(before[n])
            if not tu <= ou or ts != os_:
                die(f"{jar_name}: {n} differs from {a} {old} relocated: "
                    f"{sorted(tu - ou)[:3]} / {sorted(ts ^ os_)[:3]}")
        if zin.read(pom + "pom.properties") != before[pom + "pom.properties"]:
            die(f"{jar_name}: its {g}:{a} is not {old}")
        for n, lines in before.items():
            if n.startswith("META-INF/services/") and n in names:
                if not set(lines) <= set(zin.read(n).decode().split()):
                    die(f"{jar_name}: {n} is not as {a} {old} relocated")
        mi = [n for n in before if n.endswith("module-info.class")]
        own_mi = [n for n in mi if n in names and _constants(zin.read(n))[0] <= _constants(before[n])[0]]
        # 2. The fixed version, relocated the same way, replaces those classes and that library's pom files.
        after = sh.shade(artifacts[(g, a, new)], spec["drop"])
        stray = [n for n in after if n.endswith(".class") and not n.endswith("module-info.class")
                 and not _owned(n, rroot)]
        if stray:
            die(f"{jar_name}: the relocation rules leave {a} {new}'s {stray[:3]} unrelocated")
        remove |= theirs | {pom + "pom.properties", pom + "pom.xml"} | set(own_mi)
        for n, v in after.items():
            if _owned(n, rroot) or n.startswith(pom) or n in own_mi:
                add[n] = v
            elif n.startswith("META-INF/services/"):
                if n not in names or not set(v) <= set(zin.read(n).decode().split()):
                    die(f"{jar_name}: {a} {new} brings a service file of its own: {n}")
            elif n not in names and not n.endswith(".class"):
                add[n] = v  # a notice or licence the fixed version adds
        notes.append(f"{a} {old} -> {new} ({len(theirs)} -> {len([n for n in after if _owned(n, rroot)])} classes)")
    dirs = set()
    for n in add:
        parts = n.split("/")[:-1]
        dirs |= {"/".join(parts[:i]) + "/" for i in range(1, len(parts) + 1)}
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            if info.filename in remove or (info.filename.endswith("/") and info.filename not in dirs and any(
                    _owned(info.filename + "x.class", sh.map(lib[2])) for lib in spec["libs"])):
                continue
            ni = zipfile.ZipInfo(info.filename, info.date_time)
            ni.compress_type, ni.external_attr, ni.create_system = info.compress_type, info.external_attr, info.create_system
            zout.writestr(ni, zin.read(info))
        stamp = zin.infolist()[0].date_time
        for n in sorted(dirs - names):
            ni = zipfile.ZipInfo(n, stamp)
            ni.external_attr = 0o40755 << 16 | 0x10
            zout.writestr(ni, b"")
        for n in sorted(add):
            ni = zipfile.ZipInfo(n, stamp)
            ni.compress_type, ni.external_attr = zipfile.ZIP_DEFLATED, 0o644 << 16
            zout.writestr(ni, add[n])
    return out.getvalue(), notes


# ---- downloads, replacement, check ----------------------------------------------------------------------------------

def group_of(jar_bytes, artifact):
    """The groupId the jar's own pom.properties gives for `artifact`, or None (a jar built without one, as Wire's)."""
    try:
        z = zipfile.ZipFile(io.BytesIO(jar_bytes))
    except zipfile.BadZipFile:
        return None
    for n in z.namelist():
        m = re.fullmatch(r"META-INF/maven/([^/]+)/([^/]+)/pom\.properties", n)
        if m and m.group(2) == artifact:
            return m.group(1)
    return None


def is_old(name, data):
    """The JARS entry when `name` (a jar's file name) with content `data` is one of the old jars."""
    e = OLD.get(name)
    if e is None:
        return None
    g = group_of(data, e[1])
    if g not in (None, e[0]):
        print(f"  note: {name} is {g}'s, not {e[0]}'s - left as is")
        return None
    return e


def old_inside(name, data):
    """For a re-shaded jar: the old libraries still inside it."""
    spec = RESHADE.get(name)
    if spec is None:
        return []
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return []
    left = []
    for g, a, _, old, _, _, _ in spec["libs"]:
        p = f"META-INF/maven/{g}/{a}/pom.properties"
        if p in z.namelist() and re.search(rf"(?m)^version={re.escape(old)}\s*$", z.read(p).decode()):
            left.append(f"{g}:{a}:{old}")
    return left


def download():
    wanted = {(g, a, new): sha for g, a, old, new, sha in JARS}
    for spec in RESHADE.values():
        for g, a, _, old, old_sha, new, new_sha in spec["libs"]:
            wanted[(g, a, old)], wanted[(g, a, new)] = old_sha, new_sha
    artifacts = {}
    for (g, a, v), sha in sorted(wanted.items()):
        url = f"{REPO}/{g.replace('.', '/')}/{a}/{v}/{a}-{v}.jar"
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    data = r.read()
                break
            except OSError as ex:
                if attempt == 3:
                    die(f"cannot download {url}: {ex}")
                time.sleep(5 * (attempt + 1))
        got = hashlib.sha256(data).hexdigest()
        if got != sha:
            die(f"{url}: SHA-256 {got}, expected {sha}")
        artifacts[(g, a, v)] = data
    print(f"downloaded {len(artifacts)} jars from {REPO}, SHA-256 verified")
    return artifacts


def patch_archive(data, label, artifacts, used):
    """The archive (NAR or WAR bytes) with the old jars of its own (and of the WARs in it) replaced; None if none."""
    zin = zipfile.ZipFile(io.BytesIO(data))
    if not any(os.path.basename(n) in OLD or os.path.basename(n) in RESHADE or n.endswith(".war")
               for n in zin.namelist()):
        return None
    new_entries, changed = [], False
    for info in zin.infolist():
        body = zin.read(info)
        name = info.filename
        base = os.path.basename(name)
        if base.endswith(".jar"):
            e = is_old(base, body)
            if e:
                g, a, old, new, _ = e
                name = name[: -len(base)] + f"{a}-{new}.jar"
                body = artifacts[(g, a, new)]
                used.add(base)
                changed = True
                print(f"  {label}: {base} -> {a}-{new}.jar")
            elif base in RESHADE:
                body, notes = reshade(base, body, artifacts)
                used.add(base)
                changed = True
                print(f"  {label}: {base} re-shaded: " + "; ".join(notes))
        elif base.endswith(".war"):
            patched = patch_archive(body, f"{label} {base}", artifacts, used)
            if patched is not None:
                body, changed = patched, True
        new_entries.append((info, name, body))
    if not changed:
        return None
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zout:
        for info, name, body in new_entries:
            ni = zipfile.ZipInfo(name, info.date_time)
            ni.compress_type = info.compress_type
            ni.external_attr = info.external_attr
            ni.create_system = info.create_system
            ni.comment = info.comment
            zout.writestr(ni, body)
    return out.getvalue()


def replace_file(path, data, new_path=None):
    mode = os.stat(path).st_mode & 0o7777
    target = new_path or path
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".patch-")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.chmod(tmp, mode)
    os.replace(tmp, target)
    if new_path and new_path != path:
        os.remove(path)


def patch(home):
    lib = os.path.join(home, "lib")
    if not os.path.isdir(lib):
        die(f"{lib}: no such directory")
    if os.path.exists(os.path.join(home, "work", "nar")):
        die(f"{home}/work/nar exists: patch the NARs before NiFi's first start (or remove it)")
    artifacts = download()
    used = set()
    for dirpath, dirnames, filenames in os.walk(lib):
        dirnames.sort()
        for fn in sorted(filenames):
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, home)
            if fn.endswith(".jar"):
                with open(path, "rb") as f:
                    body = f.read()
                e = is_old(fn, body)
                if e:
                    g, a, old, new, _ = e
                    replace_file(path, artifacts[(g, a, new)], os.path.join(dirpath, f"{a}-{new}.jar"))
                    used.add(fn)
                    print(f"  {rel} -> {a}-{new}.jar")
                elif fn in RESHADE:
                    patched, notes = reshade(fn, body, artifacts)
                    replace_file(path, patched)
                    used.add(fn)
                    print(f"  {rel} re-shaded: " + "; ".join(notes))
            elif fn.endswith((".nar", ".war")):
                with open(path, "rb") as f:
                    patched = patch_archive(f.read(), rel, artifacts, used)
                if patched is not None:
                    replace_file(path, patched)
    unused = sorted((set(OLD) | set(RESHADE)) - used)
    if unused:
        die("not found in this NiFi (update the lists for its version): " + ", ".join(unused))
    print(f"patched: {len(OLD)} libraries replaced, {len(RESHADE)} jars re-shaded")


def check(root):
    found = []

    def jar(name, data, label):
        if name in OLD and is_old(name, data):
            found.append(label)
        for lib in old_inside(name, data):
            found.append(f"{label} ({lib} inside)")

    def archive(data, label):
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            return
        for n in z.namelist():
            b = os.path.basename(n)
            if b.endswith(".jar") and (b in OLD or b in RESHADE):
                jar(b, z.read(n), f"{label}!/{n}")
            elif b.endswith(".war"):
                archive(z.read(n), f"{label}!/{n}")

    for dirpath, dirnames, filenames in os.walk(root):  # symbolic links are not followed
        for fn in filenames:
            path = os.path.join(dirpath, fn)
            if os.path.islink(path):
                continue
            if fn in OLD or fn in RESHADE:
                with open(path, "rb") as f:
                    jar(fn, f.read(), path)
            elif fn.endswith((".nar", ".war")):
                with open(path, "rb") as f:
                    archive(f.read(), path)
    if found:
        die("old jars left:\n  " + "\n  ".join(sorted(found)))
    print(f"check: none of the {len(JARS)} replaced jars, nor the old libraries of the {len(RESHADE)} re-shaded ones, "
          f"is left in {root}")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("patch", "check"):
        die("usage: patch-nifi-jars.py patch NIFI_HOME | check DIR")
    (patch if sys.argv[1] == "patch" else check)(sys.argv[2])
