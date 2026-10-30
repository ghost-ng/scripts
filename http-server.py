#!/usr/bin/env python3

"""Python Web Server with upload capability and an in-memory self-signed HTTPS cert.

This server serves files from the current directory and supports basic upload via
multipart form POSTs. The HTTPS certificate is generated at runtime, stored only in
memory, and never written to disk.
"""

from __future__ import annotations

import argparse
import html
import http.server
import ipaddress
import mimetypes
import os
import posixpath
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from io import BytesIO

try:
    from OpenSSL import SSL, crypto
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit(
        "This server requires pyOpenSSL. Install it with: python -m pip install pyOpenSSL"
    ) from exc

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

__version__ = "2.0"
__all__ = ["SimpleHTTPRequestHandler", "main"]
__author__ = "bones7456, midnightseer, ghost-ng"


def generate_self_signed_certificate(hostname: str = "localhost", days: int = 365):
    """Create a self-signed TLS certificate and private key entirely in memory."""
    hostname = (hostname or "localhost").strip() or "localhost"

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)

    names = []
    if hostname:
        names.append(hostname)
    names.extend(["localhost", "127.0.0.1", "::1"])

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, hostname),
    ])

    san_entries = []
    for value in names:
        try:
            ip = ipaddress.ip_address(value)
        except ValueError:
            san_entries.append(x509.DNSName(value))
        else:
            san_entries.append(x509.IPAddress(ip))

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .sign(key, hashes.SHA256())
    )

    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    return key_pem, cert_pem


def create_ssl_context(hostname: str = "localhost", days: int = 365):
    """Build an OpenSSL context using certs that exist only in memory."""
    key_pem, cert_pem = generate_self_signed_certificate(hostname=hostname, days=days)

    ctx = SSL.Context(SSL.TLS_METHOD)
    ctx.set_options(SSL.OP_NO_SSLv2 | SSL.OP_NO_SSLv3 | SSL.OP_NO_COMPRESSION)
    ctx.use_privatekey(crypto.load_privatekey(crypto.FILETYPE_PEM, key_pem))
    ctx.use_certificate(crypto.load_certificate(crypto.FILETYPE_PEM, cert_pem))
    return ctx


class SimpleHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    """Simple HTTP request handler with GET/HEAD/POST commands."""

    server_version = "SimpleHTTPWithUpload/" + __version__

    def do_GET(self):
        f = self.send_head()
        if f:
            self.copyfile(f, self.wfile)
            f.close()

    def do_HEAD(self):
        f = self.send_head()
        if f:
            f.close()

    def do_POST(self):
        self.request.settimeout(10000)
        result, info = self.deal_post_data()
        print("[+] File Uploaded! {} --> {}".format(info, self.client_address))
        body = BytesIO()
        body.write(b'<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">')
        body.write(b"<html>\n<title>Upload Result Page</title>\n")
        body.write(b"<body>\n<h2>Upload Result Page</h2>\n")
        body.write(b"<hr>\n")
        body.write(b"<strong>Success:</strong>" if result else b"<strong>Failed:</strong>")
        body.write(info.encode("utf-8", "replace"))
        referer = self.headers.get("Referer", "/")
        body.write(("<br><a href=\"%s\">back</a>" % referer).encode("utf-8", "replace"))
        body.write(b"</body>\n</html>\n")
        length = body.tell()
        body.seek(0)
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        if body:
            self.copyfile(body, self.wfile)
            body.close()

    def deal_post_data(self):
        content_type = self.headers.get("Content-Type", "")
        if not content_type or "boundary=" not in content_type:
            return False, "Content-Type header doesn't contain boundary"

        boundary = ("--" + content_type.split("boundary=")[1].strip()).encode("utf-8")
        remaining = int(self.headers.get("Content-Length", "0"))

        line = self.rfile.readline()
        remaining -= len(line)
        if not boundary in line:
            return False, "Content NOT begin with boundary"

        line = self.rfile.readline()
        remaining -= len(line)
        fn_match = re.findall(r'Content-Disposition.*name="fil.*"; filename="(.*)"', line.decode("utf-8", "replace"))
        if not fn_match:
            return False, "Unable to locate file for upload..."

        path = self.translate_path(self.path)
        filename = os.path.join(path, fn_match[0])

        line = self.rfile.readline()
        remaining -= len(line)
        line = self.rfile.readline()
        remaining -= len(line)

        try:
            out = open(filename, "wb")
        except OSError:
            return False, "Can't create file to write, do you have permission to write?"

        preline = self.rfile.readline()
        remaining -= len(preline)
        while remaining > 0:
            line = self.rfile.readline()
            remaining -= len(line)
            if boundary in line:
                preline = preline.rstrip(b"\r\n")
                out.write(preline)
                out.close()
                return True, "File '%s' upload success!" % filename
            out.write(preline)
            preline = line

        out.close()
        return False, "Unexpected end of data."

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            if not self.path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", self.path + "/")
                self.end_headers()
                return None

            for index in ("index.html", "index.htm"):
                index_path = os.path.join(path, index)
                if os.path.exists(index_path):
                    path = index_path
                    break
            else:
                return self.list_directory(path)

        ctype = self.guess_type(path)
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        self.send_response(200)
        self.send_header("Content-type", ctype)
        fs = os.fstat(f.fileno())
        self.send_header("Content-Length", str(fs[6]))
        self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
        self.end_headers()
        return f

    def list_directory(self, path):
        try:
            listing = os.listdir(path)
        except os.error:
            self.send_error(404, "No permission to list directory")
            return None

        listing.sort(key=lambda a: a.lower())
        body = BytesIO()
        displaypath = html.escape(urllib.parse.unquote(self.path))
        body.write(b'<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">')
        body.write(("<html>\n<title>Directory listing for %s</title>\n" % displaypath).encode())
        body.write(("<body>\n<h2>Directory listing for %s</h2>\n" % displaypath).encode())
        body.write(b"<hr>\n")
        body.write(b'<form ENCTYPE="multipart/form-data" method="post">')
        body.write(b'<input name="file" type="file"/>')
        body.write(b'<input type="submit" value="upload"/></form>\n')
        body.write(b"<hr>\n<ul>\n")

        for name in listing:
            full_name = os.path.join(path, name)
            display_name = link_name = name
            if os.path.isdir(full_name):
                display_name = name + "/"
                link_name = name + "/"
            if os.path.islink(full_name):
                display_name = name + "@"
            body.write(
                ('<li><a href="%s">%s</a>\n' % (urllib.parse.quote(link_name), html.escape(display_name))).encode()
            )

        body.write(b"</ul>\n<hr>\n</body>\n</html>\n")
        length = body.tell()
        body.seek(0)
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        return body

    def translate_path(self, path):
        path = path.split("?", 1)[0]
        path = path.split("#", 1)[0]
        path = posixpath.normpath(urllib.parse.unquote(path))
        words = [word for word in path.split("/") if word not in ("", ".", "..")]
        base = os.getcwd()
        for word in words:
            drive, word = os.path.splitdrive(word)
            head, word = os.path.split(word)
            if word in (os.curdir, os.pardir):
                continue
            base = os.path.join(base, word)
        return base

    def copyfile(self, source, outputfile):
        shutil.copyfileobj(source, outputfile)

    def guess_type(self, path):
        base, ext = posixpath.splitext(path)
        if ext in self.extensions_map:
            return self.extensions_map[ext]
        ext = ext.lower()
        if ext in self.extensions_map:
            return self.extensions_map[ext]
        return self.extensions_map[""]

    if not mimetypes.inited:
        mimetypes.init()
    extensions_map = mimetypes.types_map.copy()
    extensions_map.update({
        "": "application/octet-stream",
        ".py": "text/plain",
        ".c": "text/plain",
        ".h": "text/plain",
    })


def run_server(host: str, port: int, use_ssl: bool = True, hostname: str = "localhost", cert_days: int = 365):
    handler = SimpleHTTPRequestHandler
    if use_ssl:
        context = create_ssl_context(hostname=hostname, days=cert_days)
        httpd = http.server.HTTPServer((host, port), handler)
        httpd.socket = SSL.Connection(context, httpd.socket)
        httpd.socket.set_accept_state()
        print(f"Serving HTTPS on {host} port {port} (https://{hostname}:{port}/) ...")
    else:
        httpd = http.server.HTTPServer((host, port), handler)
        print(f"Serving HTTP on {host} port {port} (http://{host}:{port}/) ...")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("^punch!")
    finally:
        try:
            httpd.server_close()
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="A standalone Python3 HTTP(S) server with upload support")
    parser.add_argument("-p", "--port", type=int, default=8000, dest="port", help="Port for the HTTP service")
    parser.add_argument("-l", "--listen", type=str, default="0.0.0.0", dest="listen", help="Interface to bind to")
    parser.add_argument("-n", "--no-ssl", action="store_true", default=False, dest="nossl", help="Serve plain HTTP instead of HTTPS")
    parser.add_argument("--hostname", type=str, default="localhost", help="Hostname used in the self-signed certificate")
    parser.add_argument("--cert-days", type=int, default=365, help="How long the self-signed cert stays valid")
    args = parser.parse_args()

    run_server(
        host=args.listen,
        port=args.port,
        use_ssl=not args.nossl,
        hostname=args.hostname,
        cert_days=args.cert_days,
    )


if __name__ == "__main__":
    main()
