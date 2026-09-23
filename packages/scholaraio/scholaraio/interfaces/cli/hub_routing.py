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
