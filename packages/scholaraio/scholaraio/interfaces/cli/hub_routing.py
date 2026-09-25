"""Which CLI commands may write the library while the Hub owns it.

Inside a Hub session the service is the single writer for the papers library,
its index and its import jobs. A CLI run that writes those files behind the
service's back races its jobs and leaves the browser showing stale state, so
such commands stop with an explanation instead.

Commands that only read, and commands that write the agent's own workspace
outputs, are unaffected.
"""
from __future__ import annotations

import argparse
from collections.abc import Callable

from scholaraio.interfaces.cli import hub_client

Predicate = Callable[[argparse.Namespace], bool]


def _always(_args: argparse.Namespace) -> bool:
    return True


def _building_topics(args: argparse.Namespace) -> bool:
    return bool(getattr(args, "build", False) or getattr(args, "reduce_to", None))


def _fetching_arxiv(args: argparse.Namespace) -> bool:
    return getattr(args, "arxiv_action", None) == "fetch"


def _fetching_explore(args: argparse.Namespace) -> bool:
    return getattr(args, "explore_action", None) in {"fetch", "embed", "topics"}


IMPORT_HINT = "请在前端导入文献，Hub 会按同一条流水线入库。"
LIBRARY_HINT = "请通过 Hub 界面或接口触发，由 Hub 统一排队执行。"

# command -> (applies to this invocation?, what to do instead)
MANAGED_COMMANDS: dict[str, tuple[Predicate, str]] = {
    "pipeline": (_always, IMPORT_HINT),
    "ingest-link": (_always, IMPORT_HINT),
    "attach-pdf": (_always, IMPORT_HINT),
    "fetch-pdf": (_always, IMPORT_HINT),
    "patent-fetch": (_always, IMPORT_HINT),
    "import-endnote": (_always, IMPORT_HINT),
    "import-zotero": (_always, IMPORT_HINT),
    "proceedings": (_always, IMPORT_HINT),
    "arxiv": (_fetching_arxiv, IMPORT_HINT),
    "index": (_always, LIBRARY_HINT),
    "embed": (_always, LIBRARY_HINT),
    "refetch": (_always, LIBRARY_HINT),
    "backfill-abstract": (_always, LIBRARY_HINT),
    "enrich-toc": (_always, LIBRARY_HINT),
    "enrich-l3": (_always, LIBRARY_HINT),
    "translate": (_always, LIBRARY_HINT),
    "rename": (_always, LIBRARY_HINT),
    "repair": (_always, LIBRARY_HINT),
    "topics": (_building_topics, LIBRARY_HINT),
    "explore": (_fetching_explore, LIBRARY_HINT),
    "backup": (_always, LIBRARY_HINT),
}


def _set(args: argparse.Namespace, *names: str) -> bool:
    """Whether any of these options was asked for."""
    return any(getattr(args, name, None) for name in names)


def _locators(args: argparse.Namespace) -> list[str]:
    """What this invocation asks the library to fetch, in Hub's own terms.

    Only the plain form delegates. An invocation carrying options the Hub's
    import does not offer — a dry run, a forced overwrite, a bulk refetch —
    falls through to the refusal, which says what to do instead.
    """
    command = getattr(args, "command", "")
    if command == "fetch-pdf" and not _set(args, "paper", "all", "force", "direct"):
        return [args.locator] if getattr(args, "locator", None) else []
    if command == "ingest-link" and not _set(args, "dry_run", "force", "no_index", "json"):
        return list(getattr(args, "urls", []) or [])
    if command == "patent-fetch":
        return [args.id_or_url]
    if command == "arxiv" and _fetching_arxiv(args) and not _set(args, "dry_run", "force"):
        return [args.arxiv_ref]
    return []


def _task(args: argparse.Namespace) -> str | None:
    """The Hub task this invocation corresponds to, if any."""
    command = getattr(args, "command", "")
    if command == "embed" and not _set(args, "rebuild"):
        return "semantic"
    if command == "topics" and getattr(args, "build", False) and not _set(args, "reduce_to"):
        return "topics"
    if command in ("enrich-toc", "enrich-l3") and not _set(args, "force"):
        return "deep"
    return None


def delegate(args: argparse.Namespace) -> str | None:
    """Run this invocation through the Hub, or return None if it has no equivalent.

    Fetching a paper and building an index are things the Hub can do on the
    agent's behalf; asking it is better than refusing an agent that only wants
    the outcome. Anything with options the Hub does not offer still stops.
    """
    if not hub_client.active():
        return None
    locators = _locators(args)
    if locators:
        for locator in locators:
            hub_client.request("POST", "/api/library/imports/fetch", {"locator": locator})
        return f"已交给 Hub 获取并入库（{len(locators)} 项），可在前端查看导入进度。"
    kind = _task(args)
    if kind is None:
        return None
    hub_client.request("POST", f"/api/library/tasks/{kind}")
    return f"已在 Hub 中启动 {kind} 任务，可在前端查看进度。"


def refusal(args: argparse.Namespace) -> str | None:
    """Return why this invocation must go through the Hub, or None."""
    if not hub_client.active():
        return None
    entry = MANAGED_COMMANDS.get(getattr(args, "command", ""))
    if entry is None:
        return None
    applies, hint = entry
    if not applies(args):
        return None
    return (
        f"`scholaraio {args.command}` 会直接写入 Hub 管理的文献库，"
        f"当前会话中已停用。{hint}"
    )
