"""The committed OpenAPI document, which the Hub's TypeScript types come from,
is the one the routes describe."""
from __future__ import annotations

import json
from pathlib import Path

from scholaraio.interfaces.api.openapi import document

COMMITTED = Path(__file__).resolve().parents[2] / "shared" / "src" / "generated" / "library-openapi.json"


def test_the_committed_document_matches_the_routes():
    committed = json.loads(COMMITTED.read_text(encoding="utf-8"))
    assert committed == document(), "The routes changed: run pnpm gen:library-types"
