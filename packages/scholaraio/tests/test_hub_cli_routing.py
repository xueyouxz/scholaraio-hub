"""The CLI must not write the library behind a running Hub's back."""
from __future__ import annotations

import argparse

import pytest

from scholaraio.core.config import Config
from scholaraio.interfaces.cli import hub_client, hub_routing
from scholaraio.interfaces.cli import workspace as workspace_cli
from scholaraio.projects import workspace as workspace_mod


@pytest.fixture
def hub_session(monkeypatch):
    monkeypatch.setenv(hub_client.ENDPOINT_VARIABLE, "http://127.0.0.1:3500")


def command(name: str, **fields) -> argparse.Namespace:
    return argparse.Namespace(command=name, **fields)


def test_library_writes_are_refused_while_the_hub_owns_them(hub_session):
    assert "pipeline" in (hub_routing.refusal(command("pipeline")) or "")
    assert hub_routing.refusal(command("index")) is not None
    assert hub_routing.refusal(command("arxiv", arxiv_action="fetch")) is not None
    assert hub_routing.refusal(command("topics", build=True, reduce_to=None)) is not None


def test_reads_and_agent_outputs_stay_available(hub_session):
    assert hub_routing.refusal(command("search")) is None
    assert hub_routing.refusal(command("usearch")) is None
    assert hub_routing.refusal(command("export")) is None
    assert hub_routing.refusal(command("arxiv", arxiv_action="search")) is None
    assert hub_routing.refusal(command("topics", build=False, reduce_to=None)) is None


def test_outside_a_hub_session_nothing_is_refused(monkeypatch):
    monkeypatch.delenv(hub_client.ENDPOINT_VARIABLE, raising=False)
    assert hub_routing.refusal(command("pipeline")) is None


def add_arguments(name: str, refs: list[str]) -> argparse.Namespace:
    return argparse.Namespace(
        command="ws",
        ws_action="add",
        name=name,
        paper_refs=refs,
        add_all=False,
        add_topic=None,
        add_search=None,
    )


def test_workspace_writes_go_through_the_hub(tmp_path, hub_session, monkeypatch):
    calls: list[tuple[str, str, dict | None]] = []

    def fake_request(method: str, path: str, payload: dict | None = None):
        calls.append((method, path, payload))
        if method == "GET":
            raise hub_client.HubUnavailable("Hub 拒绝了请求 (404): 文献项目不存在：review")
        if path.endswith("/papers"):
            return {"id": "review", "name": "review", "paperIds": ["uuid-1"], "paperCount": 1}
        return {"id": "review", "name": "review", "paperIds": [], "paperCount": 0}

    monkeypatch.setattr(hub_client, "request", fake_request)
    monkeypatch.setattr(
        "scholaraio.services.index.lookup_paper",
        lambda _db, ref: {"id": "uuid-1", "dir_name": ref},
    )
    cfg = Config(_root=tmp_path)

    workspace_cli.cmd_ws(add_arguments("review", ["Smith-2024-Spectroscopy"]), cfg)

    assert [(method, path) for method, path, _ in calls] == [
        ("GET", "/api/library/projects/review"),
        ("POST", "/api/library/projects"),
        ("POST", "/api/library/projects/review/papers"),
    ]
    assert calls[-1][2] == {"paperIds": ["uuid-1"], "action": "add"}
    # The Hub owns the files: nothing was written next to them.
    assert not workspace_mod.has_paper_index(cfg.workspace_dir / "review")


def test_an_unknown_paper_stops_before_calling_the_hub(tmp_path, hub_session, monkeypatch):
    monkeypatch.setattr(hub_client, "request", lambda *_args, **_kwargs: {"paperCount": 0})
    monkeypatch.setattr("scholaraio.services.index.lookup_paper", lambda _db, _ref: None)

    with pytest.raises(hub_client.HubUnavailable, match="未找到论文"):
        workspace_cli.cmd_ws(add_arguments("review", ["missing"]), Config(_root=tmp_path))


def test_renaming_a_workspace_goes_through_the_hub(tmp_path, hub_session, monkeypatch):
    calls: list[tuple[str, str, dict | None]] = []
    monkeypatch.setattr(
        hub_client,
        "request",
        lambda method, path, payload=None: (
            calls.append((method, path, payload)),
            {"project": {"id": "survey", "name": "survey"}, "sessions": 2},
        )[1],
    )

    workspace_cli.cmd_ws(
        argparse.Namespace(command="ws", ws_action="rename", old_name="review", new_name="survey"),
        Config(_root=tmp_path),
    )

    assert calls == [("POST", "/api/library/projects/review/rename", {"name": "survey"})]
    assert not (Config(_root=tmp_path).workspace_dir / "survey").exists()
