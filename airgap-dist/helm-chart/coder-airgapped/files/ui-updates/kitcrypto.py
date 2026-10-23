"""The Cloud Drive's recovery kit (safe.py): its data key wrapped for its owner in a form openssl opens, with nothing
but the standard library here.

  - A password: openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter N -salt -a (PBKDF2-HMAC-SHA256 gives the AES-256
    key and IV from the password and an 8-byte salt; the file is "Salted__" + salt + the AES-256-CBC ciphertext,
    PKCS#7 padded, base64). Python has no AES: encryption only is here (FIPS-197), which is all the kit needs; the
    owner opens it with openssl.
  - A certificate (the owner's PKI): RSA-OAEP with SHA-256 (and MGF1-SHA256) to its public key, which
    openssl pkeyutl -decrypt opens with the private key (a PKCS#12 file's, for one).

    kitcrypto.openssl_enc(key, "password")       # the text openssl enc -d -a ... opens
    cert = kitcrypto.certificate(pem_or_der)     # its public key and what it says
    kitcrypto.rsa_oaep_encrypt(cert["key"], key)
"""
import base64
import datetime
import hashlib
import os
import re

# ---------------------------------------------------------------------------------------------------- AES-256
def _sbox():
    """The AES S-box (FIPS-197 5.1.1): the multiplicative inverse in GF(2^8), then the affine transform."""
    box, p, q = [0] * 256, 1, 1
    while True:
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)  # p * 3
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09  # q / 3
        x = q ^ (((q << 1) | (q >> 7)) & 0xFF) ^ (((q << 2) | (q >> 6)) & 0xFF) ^ \
            (((q << 3) | (q >> 5)) & 0xFF) ^ (((q << 4) | (q >> 4)) & 0xFF)
        box[p] = x ^ 0x63
        if p == 1:
            break
    box[0] = 0x63
    return box


SBOX = _sbox()


def _xtime(b):
    return ((b << 1) ^ 0x1B) & 0xFF if b & 0x80 else b << 1


def _expand(key):
    """AES-256's 15 round keys (FIPS-197 5.2), each 16 bytes."""
    if len(key) != 32:
        raise ValueError("AES-256 takes a 32-byte key")
    words = [list(key[i:i + 4]) for i in range(0, 32, 4)]
    rcon = 1
    for i in range(8, 60):
        t = list(words[i - 1])
        if i % 8 == 0:
            t = [SBOX[b] for b in t[1:] + t[:1]]
            t[0] ^= rcon
            rcon = _xtime(rcon)
        elif i % 8 == 4:
            t = [SBOX[b] for b in t]
        words.append([a ^ b for a, b in zip(words[i - 8], t)])
    return [sum(words[r * 4:r * 4 + 4], []) for r in range(15)]


def _encrypt_block(rounds, block):
    s = [b ^ k for b, k in zip(block, rounds[0])]  # the state, column by column
    for r in range(1, 15):
        s = [SBOX[b] for b in s]
        s = [s[(i + 4 * (i % 4)) % 16] for i in range(16)]  # ShiftRows
        if r != 14:
            mixed = []
            for c in range(4):
                a = s[4 * c:4 * c + 4]
                t = a[0] ^ a[1] ^ a[2] ^ a[3]
                mixed += [a[i] ^ t ^ _xtime(a[i] ^ a[(i + 1) % 4]) for i in range(4)]
            s = mixed
        s = [b ^ k for b, k in zip(s, rounds[r])]
    return bytes(s)


def aes256_cbc_encrypt(key, iv, data):
    """AES-256-CBC of data (a whole number of 16-byte blocks)."""
    if len(iv) != 16 or len(data) % 16:
        raise ValueError("CBC takes a 16-byte IV and whole blocks")
    rounds, prev, out = _expand(key), iv, bytearray()
    for i in range(0, len(data), 16):
        prev = _encrypt_block(rounds, bytes(a ^ b for a, b in zip(data[i:i + 16], prev)))
        out += prev
    return bytes(out)


OPENSSL_ITER = 600000


def openssl_enc(data, password, iterations=OPENSSL_ITER, salt=None):
    """data encrypted with the password as `openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter <iterations> -salt -a`
    writes it (base64, lines of 64); `openssl enc -d` with the same options and the password gives data back."""
    salt = salt or os.urandom(8)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations, 48)
    pad = 16 - len(data) % 16
    cipher = aes256_cbc_encrypt(derived[:32], derived[32:], bytes(data) + bytes([pad]) * pad)
    text = base64.b64encode(b"Salted__" + salt + cipher).decode()
    return "\n".join(text[i:i + 64] for i in range(0, len(text), 64)) + "\n"


# ---------------------------------------------------------------------------------------------------- DER
def _der(data, pos=0):
    """(tag, value, next position) of the DER element at pos."""
    tag, length = data[pos], data[pos + 1]
    pos += 2
    if length & 0x80:
        n = length & 0x7F
        if not 1 <= n <= 4:
            raise ValueError("unsupported DER length")
        length = int.from_bytes(data[pos:pos + n], "big")
        pos += n
    if pos + length > len(data):
        raise ValueError("truncated DER")
    return tag, data[pos:pos + length], pos + length


def _children(value):
    out, pos = [], 0
    while pos < len(value):
        tag, inner, pos = _der(value, pos)
        out.append((tag, inner))
    return out


def _oid(value):
    first = value[0]
    parts, n = [first // 40, first % 40], 0
    for b in value[1:]:
        n = (n << 7) | (b & 0x7F)
        if not b & 0x80:
            parts.append(n)
            n = 0
    return ".".join(map(str, parts))


RSA_OID = "1.2.840.113549.1.1.1"
NAME_OIDS = {"2.5.4.3": "CN", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST",
             "0.9.2342.19200300.100.1.1": "UID", "1.2.840.113549.1.9.1": "emailAddress"}


def _rsa_from_pkcs1(value):
    n, e = [int.from_bytes(v, "big") for tag, v in _children(_der(value)[1]) if tag == 0x02][:2]
    return {"n": n, "e": e, "bits": n.bit_length()}


def _rsa_from_spki(spki):
    """The RSA key of a SubjectPublicKeyInfo (its DER value), else ValueError."""
    algorithm, bits = _children(spki)[:2]
    oid = _oid(_children(algorithm[1])[0][1])
    if oid != RSA_OID:
        raise ValueError("The certificate's key is not RSA (%s): only RSA keys can wrap the Cloud Drive's key "
                         "(RSA-OAEP)." % {"1.2.840.10045.2.1": "elliptic curve", "1.3.101.112": "Ed25519"}.get(oid, oid))
    return _rsa_from_pkcs1(bits[1][1:])  # the BIT STRING's unused-bits byte first


def _name(value):
    parts = []
    for _, rdn in _children(value):
        for _, attr in _children(rdn):
            oid, text = _children(attr)[:2]
            parts.append("%s=%s" % (NAME_OIDS.get(_oid(oid[1]), _oid(oid[1])), text[1].decode("utf-8", "replace")))
    return ", ".join(parts)


def _time(tag, value):
    text = value.decode()
    fmt = "%y%m%d%H%M%SZ" if tag == 0x17 else "%Y%m%d%H%M%SZ"
    return datetime.datetime.strptime(text, fmt).replace(tzinfo=datetime.timezone.utc)


PEM_RE = re.compile(rb"-----BEGIN ([A-Z0-9 ]+)-----(.*?)-----END \1-----", re.S)


def certificate(data):
    """An X.509 certificate (PEM or DER), or an RSA public key (PEM: PUBLIC KEY / RSA PUBLIC KEY): {key: {n, e,
    bits}, subject, issuer, serial, notAfter, fingerprint (SHA-256 of the DER)}; ValueError for anything else (a
    private key is refused: only the public part is ever wanted)."""
    if isinstance(data, str):
        data = data.encode()
    kind, der = "CERTIFICATE", data
    m = PEM_RE.search(data)
    if m:
        kind = m.group(1).decode()
        der = base64.b64decode(re.sub(rb"\s+", b"", m.group(2)))
    elif b"PRIVATE KEY" in data:
        kind = "PRIVATE KEY"
    if "PRIVATE" in kind:
        raise ValueError("That is a private key: give the certificate (its public part) only.")
    try:
        if kind == "PUBLIC KEY":
            key = _rsa_from_spki(_der(der)[1])
            return {"key": key, "subject": "", "issuer": "", "serial": "", "notAfter": None,
                    "fingerprint": hashlib.sha256(der).hexdigest()}
        if kind == "RSA PUBLIC KEY":
            key = _rsa_from_pkcs1(der)
            return {"key": key, "subject": "", "issuer": "", "serial": "", "notAfter": None,
                    "fingerprint": hashlib.sha256(der).hexdigest()}
        if kind != "CERTIFICATE":
            raise ValueError("A %s is not a certificate." % kind.lower())
        tbs = _children(_children(_der(der)[1])[0][1])
        if tbs[0][0] == 0xA0:  # [0] version
            tbs = tbs[1:]
        serial, _, issuer, validity, subject, spki = tbs[:6]
        not_after = _children(validity[1])[1]
        return {"key": _rsa_from_spki(spki[1]), "subject": _name(subject[1]), "issuer": _name(issuer[1]),
                "serial": serial[1].hex(), "notAfter": _time(*not_after).isoformat(),
                "fingerprint": hashlib.sha256(der).hexdigest()}
    except ValueError:
        raise
    except (IndexError, TypeError, UnicodeDecodeError, base64.binascii.Error) as e:
        raise ValueError("That is not a certificate (PEM or DER) or an RSA public key: %s" % e) from None


# ---------------------------------------------------------------------------------------------------- RSA-OAEP
def _mgf1(seed, length):
    out, counter = b"", 0
    while len(out) < length:
        out += hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
        counter += 1
    return out[:length]


def rsa_oaep_encrypt(key, message, label=b""):
    """RSA-OAEP (RFC 8017 7.1.1) with SHA-256 and MGF1-SHA256: what `openssl pkeyutl -decrypt -pkeyopt
    rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256` opens."""
    n, e = key["n"], key["e"]
    k = (n.bit_length() + 7) // 8
    h = 32
    if k < 2048 // 8:
        raise ValueError("The key is too small (%d bits): at least 2048." % n.bit_length())
    if len(message) > k - 2 * h - 2:
        raise ValueError("message too long for the key")
    db = hashlib.sha256(label).digest() + b"\0" * (k - len(message) - 2 * h - 2) + b"\1" + message
    seed = os.urandom(h)
    masked_db = bytes(a ^ b for a, b in zip(db, _mgf1(seed, k - h - 1)))
    masked_seed = bytes(a ^ b for a, b in zip(seed, _mgf1(masked_db, h)))
    em = int.from_bytes(b"\0" + masked_seed + masked_db, "big")
    return pow(em, e, n).to_bytes(k, "big")
