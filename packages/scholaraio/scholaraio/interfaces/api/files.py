"""File answers the browser can cache and read in ranges."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import Request, Response
from fastapi.responses import FileResponse


def file_response(request: Request, path: Path, *, media_type: str | None = None,
                  headers: dict[str, str] | None = None) -> Response:
    """The file, or 304 when the caller already has this version.

    Starlette serves ranges and ``If-Range`` but not ``If-None-Match``: the PDF
    reader revalidates on every open, which should not resend the whole file.
    """
    response = FileResponse(path, media_type=media_type, headers=headers, stat_result=os.stat(path))
    etag = response.headers.get("etag")
    if etag and etag in {tag.strip() for tag in request.headers.get("if-none-match", "").split(",")}:
        kept = {name: response.headers[name] for name in ("etag", "cache-control", "last-modified")
                if name in response.headers}
        return Response(status_code=304, headers=kept)
    return response


__all__ = ["file_response"]
