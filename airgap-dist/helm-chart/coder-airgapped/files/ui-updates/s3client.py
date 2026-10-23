"""A small S3 client (standard library only): AWS Signature Version 4, path-style requests (MinIO, AWS S3, Ceph...),
streamed uploads and downloads. What the safe needs and nothing more: buckets, listing, objects, batch deletes, copies;
an encrypted Cloud Drive's objects with its key (SSE-C: sse=<32-byte key>; S3 keeps nothing of the key, and takes it
over TLS only).

    s3 = S3("http://minio:9000", "us-east-1", access_key, secret_key)
    s3.list("bucket", prefix="users/u1/", delimiter="/")
"""
import base64
import datetime
import hashlib
import hmac
import http.client
import ssl
import urllib.parse
import xml.etree.ElementTree as ET

NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
UNSIGNED = "UNSIGNED-PAYLOAD"
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


class S3Error(Exception):
    """An S3 error answer: HTTP status, S3 code (NoSuchKey, AccessDenied...), message."""

    def __init__(self, status, code="", message=""):
        super().__init__("S3 %s %s: %s" % (status, code, message))
        self.status, self.code, self.message = status, code, message


def _quote(text, safe="-_.~"):
    return urllib.parse.quote(text, safe=safe)


def _hmac(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


SSE_C = "x-amz-server-side-encryption-customer-"
COPY_LIMIT = 5 * 1024 ** 3  # one CopyObject; larger objects are copied in parts


def sse_headers(key, copy_source=False):
    """The headers of an object encrypted with the customer key `key` (SSE-C, AES-256): for the object itself, or for
    the source of a copy. None: none."""
    if not key:
        return {}
    if len(key) != 32:
        raise ValueError("an SSE-C key is 32 bytes")
    prefix = "x-amz-copy-source-server-side-encryption-customer-" if copy_source else SSE_C
    return {prefix + "algorithm": "AES256", prefix + "key": base64.b64encode(key).decode(),
            prefix + "key-md5": base64.b64encode(hashlib.md5(key).digest()).decode()}


class S3:
    def __init__(self, endpoint, region, access_key, secret_key, ca_file=None, timeout=60):
        u = urllib.parse.urlsplit(endpoint.rstrip("/"))
        if u.scheme not in ("http", "https") or not u.hostname:
            raise ValueError("S3 endpoint must be http(s)://host[:port]: %r" % endpoint)
        self.scheme, self.host, self.port = u.scheme, u.hostname, u.port
        self.netloc = u.netloc
        self.base_path = u.path or ""
        self.region = region or "us-east-1"
        self.access_key, self.secret_key = access_key, secret_key
        self.timeout = timeout
        self.ctx = ssl.create_default_context(cafile=ca_file) if self.scheme == "https" else None

    # ---- signing
    def _sign(self, method, path, query, headers, payload_hash, now=None):
        """The Authorization header for a request (headers: lower-case names, without Authorization)."""
        now = now or datetime.datetime.now(datetime.timezone.utc)
        amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        headers["x-amz-date"] = amz_date
        headers["x-amz-content-sha256"] = payload_hash
        headers["host"] = self.netloc
        canonical_query = "&".join(
            "%s=%s" % (_quote(k), _quote(v)) for k, v in sorted((k, v if v is not None else "") for k, v in query)
        )
        names = sorted(headers)
        canonical_headers = "".join("%s:%s\n" % (n, " ".join(str(headers[n]).split())) for n in names)
        signed = ";".join(names)
        canonical = "\n".join([method, _quote(path, safe="/-_.~"), canonical_query, canonical_headers, signed,
                               payload_hash])
        scope = "%s/%s/s3/aws4_request" % (day, self.region)
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
        key = _hmac(_hmac(_hmac(_hmac(("AWS4" + self.secret_key).encode(), day), self.region), "s3"), "aws4_request")
        signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
        return "AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s" % (
            self.access_key, scope, signed, signature)

    def _connect(self):
        if self.scheme == "https":
            return http.client.HTTPSConnection(self.host, self.port, timeout=self.timeout, context=self.ctx)
        return http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)

    def request(self, method, bucket, key="", query=(), body=None, length=None, headers=None):
        """The open response (the caller reads and closes it); S3Error for an error answer. body: bytes, or a
        file-like object streamed with its length (unsigned payload)."""
        path = self.base_path + "/" + bucket + ("/" + key if key else "")
        h = {k.lower(): v for k, v in (headers or {}).items()}
        if body is None:
            payload_hash = EMPTY_SHA256
        elif isinstance(body, (bytes, bytearray)):
            payload_hash = hashlib.sha256(body).hexdigest()
            length = len(body)
        else:
            payload_hash = UNSIGNED
        if length is not None:
            h["content-length"] = str(length)
        h["authorization"] = self._sign(method, path, list(query), h, payload_hash)
        url = _quote(path, safe="/-_.~")
        if query:
            url += "?" + "&".join("%s=%s" % (_quote(k), _quote(v)) if v is not None else _quote(k) for k, v in query)
        conn = self._connect()
        try:
            conn.putrequest(method, url, skip_host=True, skip_accept_encoding=True)
            for k, v in h.items():
                conn.putheader(k, v)
            conn.endheaders()
            if isinstance(body, (bytes, bytearray)):
                conn.send(body)
            elif body is not None:
                left = length
                while left > 0:
                    chunk = body.read(min(1024 * 1024, left))
                    if not chunk:
                        raise IOError("the upload ended %d bytes early" % left)
                    conn.send(chunk)
                    left -= len(chunk)
            resp = conn.getresponse()
        except Exception:
            conn.close()
            raise
        if resp.status >= 300:
            raw = resp.read()
            conn.close()
            code = message = ""
            try:
                root = ET.fromstring(raw)
                code, message = root.findtext("Code") or "", root.findtext("Message") or ""
            except ET.ParseError:
                message = raw[:200].decode(errors="replace")
            raise S3Error(resp.status, code, message)
        resp.conn = conn  # closed with the response by the caller (close())
        return resp

    def _done(self, resp):
        data = resp.read()
        resp.close()
        resp.conn.close()
        return data

    # ---- buckets
    def bucket_exists(self, bucket):
        try:
            self._done(self.request("HEAD", bucket))
            return True
        except S3Error as e:
            if e.status == 404:
                return False
            raise

    def create_bucket(self, bucket):
        body = b""
        if self.region != "us-east-1":
            body = ('<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                    "<LocationConstraint>%s</LocationConstraint></CreateBucketConfiguration>" % self.region).encode()
        try:
            self._done(self.request("PUT", bucket, body=body))
        except S3Error as e:
            if e.code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise

    # ---- objects
    def list(self, bucket, prefix="", delimiter=None, limit=None):
        """(objects [{key, size, modified}], prefixes [str]) under prefix, every page (up to limit objects)."""
        objects, prefixes, token = [], [], None
        while True:
            query = [("list-type", "2"), ("prefix", prefix)]
            if delimiter:
                query.append(("delimiter", delimiter))
            if token:
                query.append(("continuation-token", token))
            root = ET.fromstring(self._done(self.request("GET", bucket, query=query)))
            for c in root.findall(NS + "Contents"):
                objects.append({"key": c.findtext(NS + "Key"), "size": int(c.findtext(NS + "Size") or 0),
                                "modified": c.findtext(NS + "LastModified")})
            prefixes += [p.findtext(NS + "Prefix") for p in root.findall(NS + "CommonPrefixes")]
            if limit and len(objects) >= limit:
                return objects[:limit], prefixes
            if root.findtext(NS + "IsTruncated") != "true":
                return objects, prefixes
            token = root.findtext(NS + "NextContinuationToken")

    def put(self, bucket, key, body, length=None, content_type="application/octet-stream", sse=None):
        self._done(self.request("PUT", bucket, key, body=body, length=length,
                                headers={"content-type": content_type, **sse_headers(sse)}))

    def _multipart(self, bucket, key, content_type, sse, parts_of):
        """A multipart upload: parts_of(upload id) sends the parts and gives [(number, etag)]; then completed, or
        aborted if anything fails."""
        root = ET.fromstring(self._done(self.request("POST", bucket, key, query=[("uploads", "")], body=b"",
                                                     headers={"content-type": content_type, **sse_headers(sse)})))
        upload_id = root.findtext(NS + "UploadId")
        try:
            parts = parts_of(upload_id)
            xml = "<CompleteMultipartUpload>%s</CompleteMultipartUpload>" % "".join(
                "<Part><PartNumber>%d</PartNumber><ETag>%s</ETag></Part>" % (n, (etag or "").replace("&", "&amp;"))
                for n, etag in parts)
            answer = self._done(self.request("POST", bucket, key, query=[("uploadId", upload_id)], body=xml.encode(),
                                             headers={"content-type": "application/xml", **sse_headers(sse)}))
            if b"<Error>" in answer:  # S3 may answer 200 with an error in the body
                root = ET.fromstring(answer)
                raise S3Error(200, root.findtext("Code") or "", root.findtext("Message") or "")
        except Exception:
            try:
                self._done(self.request("DELETE", bucket, key, query=[("uploadId", upload_id)]))
            except Exception:  # noqa: BLE001 - the error that stopped it is the one to report
                pass
            raise

    def put_large(self, bucket, key, body, length, part_size=64 * 1024 * 1024, content_type="application/octet-stream",
                  progress=None, sse=None):
        """A stream of `length` bytes, in parts (multipart upload: S3 takes at most 5 GB in one PUT); small ones in
        one PUT. progress(bytes so far) after each part. The upload is aborted if anything fails."""
        if length <= part_size:
            self.put(bucket, key, body, length=length, content_type=content_type, sse=sse)
            if progress:
                progress(length)
            return

        def parts_of(upload_id):
            parts, done, number = [], 0, 1
            while done < length:
                size = min(part_size, length - done)
                data = bytearray()
                while len(data) < size:
                    chunk = body.read(min(1024 * 1024, size - len(data)))
                    if not chunk:
                        raise IOError("the upload ended %d bytes early" % (length - done - len(data)))
                    data += chunk
                resp = self.request("PUT", bucket, key, query=[("partNumber", str(number)), ("uploadId", upload_id)],
                                    body=bytes(data), headers=sse_headers(sse))
                parts.append((number, resp.headers.get("ETag")))
                self._done(resp)
                done += size
                number += 1
                if progress:
                    progress(done)
            return parts

        self._multipart(bucket, key, content_type, sse, parts_of)

    def put_stream(self, bucket, key, read, part_size=16 * 1024 * 1024, content_type="application/octet-stream"):
        """A stream of unknown length: read(n) gives up to n bytes, b"" at its end. In parts (multipart upload) as
        they fill, so at most one part is held; a stream shorter than a part in one PUT. Its size."""
        def fill():
            data = bytearray()
            while len(data) < part_size:
                chunk = read(part_size - len(data))
                if not chunk:
                    break
                data += chunk
            return bytes(data)

        first = fill()
        if len(first) < part_size:
            self.put(bucket, key, first, content_type=content_type)
            return len(first)
        total = [0]

        def parts_of(upload_id):
            parts, data, number = [], first, 1
            while data:
                resp = self.request("PUT", bucket, key, query=[("partNumber", str(number)), ("uploadId", upload_id)],
                                    body=data)
                parts.append((number, resp.headers.get("ETag")))
                self._done(resp)
                total[0] += len(data)
                number += 1
                data = fill()
            return parts

        self._multipart(bucket, key, content_type, None, parts_of)
        return total[0]

    def copy(self, bucket, src, dst, size, content_type="application/octet-stream", src_sse=None, dst_sse=None,
             part_size=1024 ** 3):
        """Copies an object of `size` bytes within the bucket (in place too: a new key, or none, re-encrypts it):
        src_sse its key now, dst_sse the copy's. Larger than one CopyObject takes, in parts."""
        source = "/%s/%s" % (bucket, _quote(src, safe="/-_.~"))
        headers = {"x-amz-copy-source": source, **sse_headers(src_sse, copy_source=True)}
        if size <= COPY_LIMIT:
            answer = self._done(self.request("PUT", bucket, dst, headers={
                **headers, **sse_headers(dst_sse), "x-amz-metadata-directive": "REPLACE",
                "content-type": content_type}))
            if b"<Error>" in answer:  # a copy may fail after its 200
                root = ET.fromstring(answer)
                raise S3Error(200, root.findtext("Code") or "", root.findtext("Message") or "")
            return

        def parts_of(upload_id):
            parts = []
            for number, start in enumerate(range(0, size, part_size), 1):
                end = min(size, start + part_size) - 1
                root = ET.fromstring(self._done(self.request(
                    "PUT", bucket, dst, query=[("partNumber", str(number)), ("uploadId", upload_id)],
                    headers={**headers, **sse_headers(dst_sse), "x-amz-copy-source-range": "bytes=%d-%d" % (start, end)})))
                parts.append((number, root.findtext(NS + "ETag")))
            return parts

        self._multipart(bucket, dst, content_type, dst_sse, parts_of)

    def get(self, bucket, key, sse=None):
        """The open response: .headers, .read(n); close() it and its .conn when done."""
        return self.request("GET", bucket, key, headers=sse_headers(sse))

    def head(self, bucket, key, sse=None):
        resp = self.request("HEAD", bucket, key, headers=sse_headers(sse))
        self._done(resp)
        return resp

    def delete(self, bucket, key):
        self._done(self.request("DELETE", bucket, key))

    def delete_many(self, bucket, keys):
        """Deletes keys in batches of 1000 (DeleteObjects); the keys S3 refused, with its errors."""
        failed = []
        for i in range(0, len(keys), 1000):
            batch = keys[i:i + 1000]
            root = ET.Element("Delete")
            ET.SubElement(root, "Quiet").text = "true"
            for k in batch:
                ET.SubElement(ET.SubElement(root, "Object"), "Key").text = k
            body = ET.tostring(root)
            md5 = base64.b64encode(hashlib.md5(body).digest()).decode()  # required by S3 for DeleteObjects
            answer = ET.fromstring(self._done(self.request("POST", bucket, query=[("delete", "")], body=body,
                                                           headers={"content-md5": md5,
                                                                    "content-type": "application/xml"})))
            failed += [(e.findtext(NS + "Key"), e.findtext(NS + "Code")) for e in answer.findall(NS + "Error")]
        return failed
