"""Certificates for General > Security (Python standard library only): reads X.509 certificates and private keys
(PEM / DER) with a small ASN.1 reader, and probes TLS endpoints for the versions and cipher suites they accept and the
chain they present. Nothing here keeps or returns key material: a private key is reduced to its type, size and
whether it belongs to a certificate next to it.
"""
import base64
import hashlib
import re
import socket
import ssl
import struct
from datetime import datetime, timezone

OIDS = {
    "2.5.4.3": "CN", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST",
    "1.2.840.113549.1.9.1": "emailAddress",
    "1.2.840.113549.1.1.1": "RSA", "1.2.840.10045.2.1": "EC", "1.3.101.112": "Ed25519", "1.3.101.113": "Ed448",
    "1.2.840.113549.1.1.5": "SHA1-RSA", "1.2.840.113549.1.1.11": "SHA256-RSA", "1.2.840.113549.1.1.12": "SHA384-RSA",
    "1.2.840.113549.1.1.13": "SHA512-RSA", "1.2.840.113549.1.1.10": "RSA-PSS",
    "1.2.840.10045.4.3.2": "ECDSA-SHA256", "1.2.840.10045.4.3.3": "ECDSA-SHA384", "1.2.840.10045.4.3.4": "ECDSA-SHA512",
    "1.2.840.10045.3.1.7": "P-256", "1.3.132.0.34": "P-384", "1.3.132.0.35": "P-521",
    "1.3.6.1.5.5.7.3.1": "server auth", "1.3.6.1.5.5.7.3.2": "client auth", "1.3.6.1.5.5.7.3.3": "code signing",
    "1.3.6.1.5.5.7.3.4": "e-mail protection", "1.3.6.1.5.5.7.3.9": "OCSP signing",
}
KEY_USAGE = ["digital signature", "non-repudiation", "key encipherment", "data encipherment", "key agreement",
             "certificate signing", "CRL signing", "encipher only", "decipher only"]


# --------------------------------------------------------------------------- ASN.1 DER
def _tlv(data, i):
    """(tag, value start, value end) of the element at i."""
    tag = data[i]
    i += 1
    length = data[i]
    i += 1
    if length & 0x80:
        n = length & 0x7F
        if n == 0 or n > 4:
            raise ValueError("unsupported DER length")
        length = int.from_bytes(data[i:i + n], "big")
        i += n
    if i + length > len(data):
        raise ValueError("truncated DER")
    return tag, i, i + length


def _children(data, start, end):
    out, i = [], start
    while i < end:
        tag, s, e = _tlv(data, i)
        out.append((tag, s, e))
        i = e
    return out


def _oid(b):
    first = b[0]
    parts = [str(min(first // 40, 2)), str(first - 40 * min(first // 40, 2))]
    v = 0
    for byte in b[1:]:
        v = (v << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(str(v))
            v = 0
    return ".".join(parts)


def _text(tag, b):
    if tag == 0x1E:   # BMPString
        return b.decode("utf-16-be", "replace")
    return b.decode("utf-8", "replace")


def _time(tag, b):
    s = b.decode("ascii")
    if tag == 0x17:   # UTCTime YYMMDDHHMMSSZ
        year = int(s[:2])
        s = ("19" if year >= 50 else "20") + s
    return datetime.strptime(s[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def _name(data, s, e):
    parts = []
    for _, rs, re_ in _children(data, s, e):            # RDN SET
        for _, as_, ae in _children(data, rs, re_):     # AttributeTypeAndValue SEQ
            (t1, os_, oe), (t2, vs, ve) = _children(data, as_, ae)[:2]
            parts.append((OIDS.get(_oid(data[os_:oe]), _oid(data[os_:oe])), _text(t2, data[vs:ve])))
    return parts


def _name_str(parts):
    return ", ".join("%s=%s" % kv for kv in parts)


def _public_key(data, s, e):
    """(algorithm, size or curve, comparable public value) of a SubjectPublicKeyInfo."""
    (_, als, ale), (_, bs, be) = _children(data, s, e)[:2]
    alg = _children(data, als, ale)
    algo = OIDS.get(_oid(data[alg[0][1]:alg[0][2]]), "unknown")
    bits = data[bs + 1:be]   # BIT STRING: skip the unused-bits byte
    if algo == "RSA":
        (_, ms, me) = _children(bits, *_tlv(bits, 0)[1:])[0]
        modulus = bits[ms:me].lstrip(b"\0")
        return algo, len(modulus) * 8 - (8 - modulus[0].bit_length()), modulus
    if algo == "EC":
        curve = OIDS.get(_oid(data[alg[1][1]:alg[1][2]]), "unknown curve") if len(alg) > 1 else "unknown curve"
        return algo, curve, bits
    if algo in ("Ed25519", "Ed448"):
        return algo, algo, bits
    return algo, None, bits


def parse_certificate(der):
    """The facts of one X.509 certificate (DER)."""
    _, cs, ce = _tlv(der, 0)
    tbs_tag, ts, te = _children(der, cs, ce)[0]
    _, sas, sae = _children(der, cs, ce)[1]
    fields = _children(der, ts, te)
    i = 1 if fields[0][0] == 0xA0 else 0   # [0] version
    serial = der[fields[i][1]:fields[i][2]].hex()
    issuer = _name(der, fields[i + 2][1], fields[i + 2][2])
    (t1, vs1, ve1), (t2, vs2, ve2) = _children(der, fields[i + 3][1], fields[i + 3][2])
    subject = _name(der, fields[i + 4][1], fields[i + 4][2])
    key_algo, key_size, key_value = _public_key(der, fields[i + 5][1], fields[i + 5][2])
    sig = _children(der, sas, sae)
    out = {
        "subject": _name_str(subject), "commonName": next((v for k, v in subject if k == "CN"), ""),
        "issuer": _name_str(issuer), "issuerCommonName": next((v for k, v in issuer if k == "CN"), ""),
        "serial": serial.lstrip("0") or "0", "notBefore": _time(t1, der[vs1:ve1]).isoformat(),
        "notAfter": _time(t2, der[vs2:ve2]).isoformat(),
        "signature": OIDS.get(_oid(der[sig[0][1]:sig[0][2]]), _oid(der[sig[0][1]:sig[0][2]])),
        "keyAlgorithm": key_algo, "keySize": key_size, "sans": [], "isCA": False, "keyUsage": [], "extendedKeyUsage": [],
        "selfSigned": subject == issuer, "sha256": hashlib.sha256(der).hexdigest(),
    }
    for tag, s, e in fields[i + 6:]:
        if tag != 0xA3:   # [3] extensions
            continue
        for _, xs, xe in _children(der, *_tlv(der, s)[1:]):
            parts = _children(der, xs, xe)
            oid = _oid(der[parts[0][1]:parts[0][2]])
            _, vs, ve = parts[-1]   # OCTET STRING with the extension's DER
            if oid == "2.5.29.17":   # subjectAltName
                for gtag, gs, ge in _children(der, *_tlv(der, vs)[1:]):
                    v = der[gs:ge]
                    if gtag == 0x82:
                        out["sans"].append("DNS:" + v.decode("ascii", "replace"))
                    elif gtag == 0x87:
                        out["sans"].append("IP:" + (socket.inet_ntop(socket.AF_INET6 if len(v) == 16 else socket.AF_INET, v)))
                    elif gtag == 0x81:
                        out["sans"].append("email:" + v.decode("ascii", "replace"))
                    elif gtag == 0x86:
                        out["sans"].append("URI:" + v.decode("ascii", "replace"))
            elif oid == "2.5.29.19":   # basicConstraints
                inner = _children(der, *_tlv(der, vs)[1:])
                out["isCA"] = bool(inner and inner[0][0] == 0x01 and der[inner[0][1]] != 0)
            elif oid == "2.5.29.15":   # keyUsage
                _, bs, be = _tlv(der, vs)
                bits = int.from_bytes(der[bs + 1:be] or b"\0", "big") if be > bs + 1 else 0
                width = (be - bs - 1) * 8
                out["keyUsage"] = [name for n, name in enumerate(KEY_USAGE) if n < width and bits >> (width - 1 - n) & 1]
            elif oid == "2.5.29.37":   # extKeyUsage
                out["extendedKeyUsage"] = [OIDS.get(_oid(der[s2:e2]), _oid(der[s2:e2]))
                                           for _, s2, e2 in _children(der, *_tlv(der, vs)[1:])]
    out["_public"] = key_value
    return out


def parse_private_key(kind, der):
    """Type and size of a private key (PEM label `kind`), and its public value to match a certificate. Never the key."""
    try:
        if kind == "ENCRYPTED PRIVATE KEY":
            return {"keyAlgorithm": "encrypted (PKCS#8)", "keySize": None, "_public": None}
        _, s, e = _tlv(der, 0)
        seq = _children(der, s, e)
        if kind == "RSA PRIVATE KEY":
            modulus = der[seq[1][1]:seq[1][2]].lstrip(b"\0")
            return {"keyAlgorithm": "RSA", "keySize": len(modulus) * 8 - (8 - modulus[0].bit_length()), "_public": modulus}
        if kind == "EC PRIVATE KEY":
            curve, public = None, None
            for tag, cs, ce in seq[2:]:
                if tag == 0xA0:
                    _, os_, oe = _tlv(der, cs)
                    curve = OIDS.get(_oid(der[os_:oe]), "unknown curve")
                elif tag == 0xA1:
                    _, bs, be = _tlv(der, cs)
                    public = der[bs + 1:be]
            return {"keyAlgorithm": "EC", "keySize": curve, "_public": public}
        if kind == "PRIVATE KEY":   # PKCS#8: version, algorithm, the inner key
            alg = _children(der, seq[1][1], seq[1][2])
            algo = OIDS.get(_oid(der[alg[0][1]:alg[0][2]]), "unknown")
            inner = der[seq[2][1]:seq[2][2]]
            if algo == "RSA":
                return parse_private_key("RSA PRIVATE KEY", inner)
            if algo == "EC":
                key = parse_private_key("EC PRIVATE KEY", inner)
                if len(alg) > 1:
                    key["keySize"] = OIDS.get(_oid(der[alg[1][1]:alg[1][2]]), key["keySize"])
                return key
            return {"keyAlgorithm": algo, "keySize": algo, "_public": None}
    except (ValueError, IndexError):
        pass
    return {"keyAlgorithm": "unreadable", "keySize": None, "_public": None}


PEM_RE = re.compile(rb"-----BEGIN ([A-Z0-9 ]+)-----\s+(.*?)-----END \1-----", re.S)


def read_bundle(name, data):
    """Every certificate and key in one file's bytes (PEM, or DER / PKCS#12 by content)."""
    items = []
    blocks = PEM_RE.findall(data)
    for kind, body in blocks:
        kind = kind.decode()
        try:
            der = base64.b64decode(re.sub(rb"\s+", b"", body))
        except ValueError:
            continue
        if kind in ("CERTIFICATE", "TRUSTED CERTIFICATE"):
            try:
                items.append({"kind": "certificate", **parse_certificate(der)})
            except (ValueError, IndexError) as e:
                items.append({"kind": "certificate", "error": "unreadable certificate (%s)" % e})
        elif kind.endswith("PRIVATE KEY"):
            items.append({"kind": "key", **parse_private_key(kind, der)})
    if not blocks and data[:1] == b"\x30":
        if name.lower().endswith((".p12", ".pfx")):
            items.append({"kind": "pkcs12", "bytes": len(data)})
        else:
            try:
                items.append({"kind": "certificate", **parse_certificate(data)})
            except (ValueError, IndexError):
                pass
    for key in (i for i in items if i["kind"] == "key"):
        match = next((c for c in items if c["kind"] == "certificate" and key["_public"] and c.get("_public") == key["_public"]), None)
        key["matches"] = match["commonName"] or match["subject"] if match else None
    return items


def public_items(items):
    return [{k: v for k, v in i.items() if not k.startswith("_")} for i in items]


# --------------------------------------------------------------------------- TLS probing
VERSIONS = [("TLS 1.0", ssl.TLSVersion.TLSv1), ("TLS 1.1", ssl.TLSVersion.TLSv1_1),
            ("TLS 1.2", ssl.TLSVersion.TLSv1_2), ("TLS 1.3", ssl.TLSVersion.TLSv1_3)]


def _context(version=None, ciphers=None):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        ctx.set_ciphers((ciphers or "ALL") + ":@SECLEVEL=0")   # so old versions / suites can be offered at all
    except ssl.SSLError:
        pass
    if version:
        ctx.minimum_version = ctx.maximum_version = version
    return ctx


def _connect(host, port, sni, ctx, postgres=False, timeout=5):
    raw = socket.create_connection((host, port), timeout=timeout)
    try:
        if postgres:   # SSLRequest first; the server answers "S" when it speaks TLS
            raw.sendall(struct.pack("!II", 8, 80877103))
            if raw.recv(1) != b"S":
                raise ssl.SSLError("the server does not offer TLS")
        return ctx.wrap_socket(raw, server_hostname=sni)
    except Exception:
        raw.close()
        raise


def probe(host, port, sni=None, postgres=False, trust=None):
    """TLS versions and TLS 1.2 cipher suites the endpoint accepts, what it negotiates by default, its chain, and
    whether it is trusted by `trust` (a CA file; else the system store)."""
    sni = sni or host
    out = {"host": host, "port": port, "versions": [], "ciphers12": [], "negotiated": None, "chain": [], "trusted": None}
    for label, version in VERSIONS:
        try:
            with _connect(host, port, sni, _context(version), postgres) as s:
                out["versions"].append({"version": label, "cipher": s.cipher()[0]})
        except (OSError, ssl.SSLError, ValueError):
            pass
    if any(v["version"] == "TLS 1.2" for v in out["versions"]):
        for c in _context(ssl.TLSVersion.TLSv1_2).get_ciphers():
            if c.get("protocol") != "TLSv1.2":
                continue
            try:
                with _connect(host, port, sni, _context(ssl.TLSVersion.TLSv1_2, c["name"]), postgres, timeout=3) as s:
                    out["ciphers12"].append(s.cipher()[0])
            except (OSError, ssl.SSLError, ValueError):
                pass
    try:
        with _connect(host, port, sni, _context(), postgres) as s:
            out["negotiated"] = {"version": s.version(), "cipher": s.cipher()[0], "bits": s.cipher()[2]}
            chain = s.get_unverified_chain() if hasattr(s, "get_unverified_chain") else None
            ders = [c if isinstance(c, bytes) else c.public_bytes(ssl._ssl.ENCODING_DER) for c in chain] if chain else [s.getpeercert(True)]
            for der in ders:
                try:
                    out["chain"].append({k: v for k, v in parse_certificate(der).items() if not k.startswith("_")})
                except (ValueError, IndexError) as e:
                    out["chain"].append({"error": "unreadable certificate (%s)" % e})
    except (OSError, ssl.SSLError, ValueError) as e:
        out["error"] = str(e)[:200]
    try:
        ctx = ssl.create_default_context()   # the system's trust store, plus the deployment's own CA
        if trust:
            try:
                ctx.load_verify_locations(cafile=trust)
            except (OSError, ssl.SSLError):
                pass
        with _connect(host, port, sni, ctx, postgres):
            out["trusted"] = True
    except ssl.SSLCertVerificationError as e:
        out["trusted"] = False
        out["trustError"] = e.verify_message or str(e)[:160]
    except (OSError, ssl.SSLError, ValueError):
        pass
    return out
