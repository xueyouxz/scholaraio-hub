"""Library settings the browser owns, stored beside the configuration it overrides."""
from __future__ import annotations

import pytest
import yaml

from scholaraio.hub import HubLibrary


@pytest.fixture
def library(tmp_path):
    library = HubLibrary(tmp_path / "app")
    try:
        yield library
    finally:
        library.close()


def overlay(library) -> dict:
    return yaml.safe_load(library.settings.path.read_text(encoding="utf-8")) or {}


def test_a_key_is_stored_but_never_read_back(library):
    result = library.settings.update({"mineruApiKey": "token-1"})

    assert result["mineruConfigured"] is True
    assert result["mineruKeyLength"] == len("token-1")
    assert "token-1" not in str(result)
    assert overlay(library)["ingest"]["mineru_api_key"] == "token-1"
    assert library.settings.path.stat().st_mode & 0o077 == 0


def test_a_change_takes_effect_without_restarting(library):
    library.settings.update({"extractor": "regex", "embedModel": "BAAI/bge-m3"})

    assert library.runtime.cfg.ingest.extractor == "regex"
    assert library.runtime.cfg.embed.model == "BAAI/bge-m3"
    assert library.settings.read()["embedModel"] == "BAAI/bge-m3"


def test_one_field_at_a_time_keeps_the_others(library):
    library.settings.update({"llmApiKey": "key-1"})
    library.settings.update({"llmModel": "deepseek-reasoner"})

    stored = overlay(library)["llm"]
    assert stored == {"api_key": "key-1", "model": "deepseek-reasoner"}


def test_clearing_a_field_returns_to_the_underlying_configuration(library):
    library.settings.update({"llmApiKey": "key-1"})
    library.settings.update({"llmApiKey": ""})

    assert "llm" not in overlay(library)
    assert library.settings.read()["llmConfigured"] is False


def test_a_value_the_pipeline_cannot_use_is_refused(library):
    with pytest.raises(ValueError, match="extractor"):
        library.settings.update({"extractor": "magic"})
    with pytest.raises(ValueError, match="Cannot modify"):
        library.settings.update({"papersDir": "/tmp"})
    assert not library.settings.path.exists()


def test_the_page_is_told_where_papers_and_workspaces_live(library):
    settings = library.settings.read()

    assert settings["papersDir"] == str(library.runtime.cfg.papers_dir.resolve())
    assert settings["workspaceDir"] == str(library.runtime.cfg.workspace_dir.resolve())


def test_checking_the_llm_calls_it_once_and_reports_the_answer(library, monkeypatch):
    from scholaraio.services import metrics

    library.settings.update({"llmApiKey": "key-1", "llmModel": "deepseek-chat"})
    asked = []

    def answer(prompt, cfg, **options):
        asked.append(options)
        return metrics.LLMResult(content="OK", model="deepseek-chat")

    monkeypatch.setattr(metrics, "call_llm", answer)
    result = library.settings.check("llm")

    assert result == {"target": "llm", "ok": True, "level": "ok", "message": "deepseek-chat is responding"}
    assert asked[0]["max_tokens"] <= 16


def test_a_refused_llm_key_is_an_answer_not_an_error(library, monkeypatch):
    from scholaraio.services import metrics

    library.settings.update({"llmApiKey": "key-1"})

    def refuse(*_args, **_options):
        raise RuntimeError("401 Unauthorized")

    monkeypatch.setattr(metrics, "call_llm", refuse)
    result = library.settings.check("llm")

    assert result["ok"] is False
    assert "401" in result["message"]


def test_a_refused_mineru_token_is_reported(library, monkeypatch):
    import requests

    library.settings.update({"mineruApiKey": "token-1"})

    class Refused:
        status_code = 401
        text = '{"msg": "token error"}'

    monkeypatch.setattr(requests, "get", lambda *_args, **_kwargs: Refused())
    result = library.settings.check("mineru")

    assert result["level"] == "error"
    assert "token" in result["message"]


def test_an_unknown_check_is_refused(library):
    with pytest.raises(ValueError, match="check target"):
        library.settings.check("disk")


@pytest.mark.parametrize("backend", ["basic", "flash", "pipeline"])
def test_local_mineru_backend_persists(tmp_path, backend):
    library = HubLibrary(tmp_path)
    try:
        saved = library.settings.update({"mineruEndpoint": "http://parser:18000", "mineruBackend": backend})
        assert saved["mineruBackend"] == backend
        assert saved["mineruEndpoint"] == "http://parser:18000"
    finally:
        library.close()
