"""The API's OpenAPI document, which the Hub's TypeScript types are generated from.

    python -m scholaraio.interfaces.api.openapi > library-openapi.json

``pnpm gen:library-types`` runs this and writes the document and the types into
``packages/shared/src/generated/``; ``tests/test_hub_openapi.py`` fails while the
committed document is behind the routes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from scholaraio.interfaces.api.app import create_app


def document() -> dict:
    # Describing the routes needs no library: the app is built, never started.
    described = create_app(Path("."), token="unused").openapi()
    for part in ("paths", "components"):
        without_titles(described.get(part, {}))
    return described


def without_titles(value) -> None:
    """Drop the titles Pydantic derives from every name (``hasPdf`` -> "Haspdf"):
    they would only become comments restating the names in the generated types.
    A title keyword is a string; a property called ``title`` is a schema."""
    if isinstance(value, dict):
        if isinstance(value.get("title"), str):
            del value["title"]
        for child in value.values():
            without_titles(child)
    elif isinstance(value, list):
        for child in value:
            without_titles(child)


def render(value: dict) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    sys.stdout.write(render(document()))
