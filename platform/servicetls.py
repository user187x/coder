"""TLS for the authenticated platform service, with bounded handshakes."""
import os
import http.client
import ssl
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Service redirects are not allowed", headers, fp)


def service_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")
    ):
        raise ValueError("Internal service connections require HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("Service URL must not contain credentials")
    return parsed


def client_context():
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    if os.environ.get("SERVICE_CA_FILE"):
        context.load_verify_locations(os.environ["SERVICE_CA_FILE"])
    if os.environ.get("SERVICE_CA_PEM"):
        context.load_verify_locations(cadata=os.environ["SERVICE_CA_PEM"])
    return context


def service_connection(url, *, timeout):
    """Build a verified connection for streaming uploads without redirect handling."""
    parsed = service_url(url)
    if parsed.scheme == "https":
        return http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=timeout, context=client_context())
    return http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=timeout)


def open_service(request, *, timeout):
    """Call an internal service with certificate verification and no credential redirects."""
    service_url(request.full_url if isinstance(request, urllib.request.Request) else request)
    context = client_context()
    opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=context))
    return opener.open(request, timeout=timeout)


class TLSServer(ThreadingHTTPServer):
    def __init__(self, address, handler, *, certificate="", key=""):
        if bool(certificate) != bool(key):
            raise ValueError("Both SERVICE_TLS_CERT and SERVICE_TLS_KEY are required")
        if not certificate and address[0] not in ("127.0.0.1", "::1", "localhost"):
            raise ValueError("A public service listener requires TLS")
        self.tls = None
        if certificate:
            self.tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            self.tls.minimum_version = ssl.TLSVersion.TLSv1_2
            self.tls.load_cert_chain(certificate, key)
        super().__init__(address, handler)

    def process_request_thread(self, request, client_address):
        # Complete the handshake in the worker so a stalled client cannot block accepts.
        if self.tls:
            try:
                request.settimeout(10)
                request = self.tls.wrap_socket(request, server_side=True)
            except (OSError, ssl.SSLError):
                request.close()
                return
        request.settimeout(60)
        super().process_request_thread(request, client_address)
