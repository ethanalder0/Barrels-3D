"""The built frontend, served by the same process as the API.

In development Vite serves the app and proxies /api here. In production there
is no Vite: `npm run build` writes the app to dist/, and this serves it. One
process and one origin means the browser's EventSource needs no CORS and the
deploy is a single service.

Files are read once and kept in memory -- the whole build is a few megabytes,
most of it the player model -- along with a gzipped copy of anything that
compresses, so each request is a dictionary lookup rather than disk and zlib
work. Vite puts a content hash in every filename under assets/, so those are
cached by browsers for a year; index.html is not, so a deploy is picked up on
the next load. Everything else (the player model, fonts, audio) keeps its
name across builds, so it carries an ETag and is revalidated rather than
downloaded again.

Anything that is not a file falls back to index.html. The app keeps its screen
in state rather than in the URL, so in practice that is "/" with a query string.
"""

from __future__ import annotations

import gzip
import hashlib
import mimetypes
import os
import threading
from pathlib import Path

ROOT = Path(os.environ.get("STATIC_DIR") or Path(__file__).parent.parent / "dist").resolve()

# Worth compressing: text, and the glTF binary, which is mostly float arrays
# and shrinks by a third. Already-compressed formats (mp3, woff2, png) are not.
COMPRESSIBLE = {
    "text/html", "text/css", "text/javascript", "application/javascript",
    "application/json", "image/svg+xml", "model/gltf-binary",
}

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("font/woff2", ".woff2")

_cache: dict[Path, tuple[bytes, bytes | None, str, str]] = {}
_lock = threading.Lock()


def available() -> bool:
    """Is there a build to serve? Locally, usually not -- Vite is serving."""
    return (ROOT / "index.html").is_file()


def _load(path: Path) -> tuple[bytes, bytes | None, str, str]:
    with _lock:
        hit = _cache.get(path)
        if hit:
            return hit
        body = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        zipped = gzip.compress(body, 6) if ctype in COMPRESSIBLE else None
        if zipped is not None and len(zipped) >= len(body):
            zipped = None
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json", "svg+xml")):
            ctype += "; charset=utf-8"
        etag = '"' + hashlib.sha1(body).hexdigest()[:20] + '"'
        _cache[path] = (body, zipped, ctype, etag)
        return _cache[path]


def resolve(url_path: str) -> Path | None:
    """The file for a URL path, or index.html. None if there is no build."""
    if not available():
        return None
    candidate = (ROOT / url_path.lstrip("/")).resolve()
    # Never outside the build, whatever ../ the request tried.
    if candidate.is_relative_to(ROOT) and candidate.is_file():
        return candidate
    return ROOT / "index.html"


def serve(handler, url_path: str, head_only: bool = False) -> bool:
    """Write the response for a static path. False if there is nothing to serve."""
    path = resolve(url_path)
    if path is None:
        return False

    body, zipped, ctype, etag = _load(path)
    immutable = path.parent.name == "assets" and path.parent.parent == ROOT

    if handler.headers.get("If-None-Match") == etag:
        handler.send_response(304)
        handler.send_header("ETag", etag)
        handler.end_headers()
        return True

    use_gzip = zipped is not None and "gzip" in handler.headers.get("Accept-Encoding", "")
    payload = zipped if use_gzip else body

    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(payload)))
    handler.send_header(
        "Cache-Control",
        "public, max-age=31536000, immutable" if immutable else "no-cache",
    )
    handler.send_header("ETag", etag)
    if zipped is not None:
        handler.send_header("Vary", "Accept-Encoding")
    if use_gzip:
        handler.send_header("Content-Encoding", "gzip")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
    handler.end_headers()
    if not head_only:
        handler.wfile.write(payload)
    return True
