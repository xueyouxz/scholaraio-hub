"""Library settings the browser owns, stored beside the configuration it overrides."""
from __future__ import annotations

import pytest
import yaml

from scholaraio.services.hub_library import HubLibrary


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
    assert "token-1" not in str(result)
    assert overlay(library)["ingest"]["mineru_api_key"] == "token-1"
    assert library.settings.path.stat().st_mode & 0o077 == 0


def test_a_change_takes_effect_without_restarting(library):
    library.settings.update({"extractor": "regex", "embedModel": "BAAI/bge-m3"})

    assert library.cfg.ingest.extractor == "regex"
    assert library.cfg.embed.model == "BAAI/bge-m3"
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
    with pytest.raises(ValueError, match="无法修改"):
        library.settings.update({"papersDir": "/tmp"})
    assert not library.settings.path.exists()
