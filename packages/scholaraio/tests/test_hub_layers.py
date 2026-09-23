"""The dependency direction between the HTTP layer, the Hub services and the
upstream stores, checked from the import statements."""
from __future__ import annotations

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1] / "scholaraio"
ROUTES = PACKAGE / "interfaces" / "api" / "routes"
HUB = PACKAGE / "hub"


def imported_modules(path: Path) -> set[str]:
    modules = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
        elif isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
    return modules


def offending(directory: Path, forbidden: tuple[str, ...], *, skip: tuple[str, ...] = ()) -> dict[str, list[str]]:
    found = {}
    for path in sorted(directory.glob("*.py")):
        if path.name in skip:
            continue
        bad = sorted(m for m in imported_modules(path) if m.startswith(forbidden))
        if bad:
            found[path.name] = bad
    return found


def test_routes_reach_the_library_only_through_hub_services():
    """Controllers translate requests; reading files is the services' job."""
    assert offending(ROUTES, ("scholaraio.stores", "scholaraio.services", "scholaraio.projects")) == {}


def test_hub_services_never_depend_on_the_library_or_the_transport():
    """Services receive collaborators; only the composition root wires them."""
    forbidden = ("scholaraio.hub.library", "scholaraio.interfaces", "fastapi", "starlette")
    # The package entry re-exports the library; migration.py is a command-line
    # tool that starts a whole library to reindex.
    assert offending(HUB, forbidden, skip=("__init__.py", "library.py", "migration.py")) == {}
