"""Request bodies the API accepts.

Python attributes are snake_case; the wire format is the browser's camelCase.
``MetadataInput`` is the exception: its fields are ``meta.json`` field names and
travel as they are stored.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import Query
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from scholaraio.hub.collections import NAME_LIMIT

# A collection is named by its id, or by its name (which agents use).
CollectionId = Annotated[str, Field(min_length=1, max_length=NAME_LIMIT)]
# One collection that limits a query, given as a query parameter.
CollectionQuery = Annotated[str | None, Query(alias="collectionId", min_length=1, max_length=NAME_LIMIT)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ScopeInput(CamelModel):
    """Papers to work with: every paper of the collections, plus the papers named."""

    paper_ids: list[str] = Field(default_factory=list, max_length=100)
    collection_ids: list[CollectionId] = Field(default_factory=list, max_length=20)


class ContextInput(ScopeInput):
    query: str = Field(max_length=20000)


class CollectionInput(CamelModel):
    name: str = Field(min_length=1, max_length=NAME_LIMIT)


class CollectionPapersInput(CamelModel):
    paper_ids: list[str] = Field(max_length=100)
    action: Literal["add", "remove"] = "add"


class MetadataInput(BaseModel):
    title: str | None = Field(default=None, max_length=2000)
    doi: str | None = Field(default=None, max_length=300)
    authors: list[str] | None = Field(default=None, max_length=200)
    year: int | None = Field(default=None, ge=1000, le=2200)
    journal: str | None = Field(default=None, max_length=500)
    abstract: str | None = Field(default=None, max_length=20000)
    paper_type: str | None = Field(default=None, max_length=100)


class SettingsInput(CamelModel):
    """Library settings the browser may change; keys are write-only."""

    extractor: str | None = Field(default=None, max_length=40)
    pdf_parser: str | None = Field(default=None, max_length=40)
    llm_backend: str | None = Field(default=None, max_length=40)
    llm_model: str | None = Field(default=None, max_length=200)
    llm_base_url: str | None = Field(default=None, max_length=500)
    llm_api_key: str | None = Field(default=None, max_length=500)
    mineru_endpoint: str | None = Field(default=None, max_length=500)
    mineru_backend: str | None = Field(default=None, max_length=40)
    mineru_api_key: str | None = Field(default=None, max_length=500)
    embed_provider: str | None = Field(default=None, max_length=40)
    embed_model: str | None = Field(default=None, max_length=200)
    embed_source: str | None = Field(default=None, max_length=40)
    embed_device: str | None = Field(default=None, max_length=40)
    embed_api_base: str | None = Field(default=None, max_length=500)
    embed_api_key: str | None = Field(default=None, max_length=500)


class ExportInput(CamelModel):
    paper_ids: list[str] = Field(default_factory=list, max_length=1000)
    collection_id: CollectionId | None = None
    format: Literal["bibtex", "ris", "markdown"] = "bibtex"
    style: Literal["apa", "vancouver", "chicago-author-date", "mla"] = "apa"


class AcquireInput(CamelModel):
    locator: str = Field(min_length=1, max_length=2000)
    collection_id: CollectionId | None = None
    title: str | None = Field(default=None, max_length=500)


class SettingsCheckInput(CamelModel):
    target: Literal["mineru", "llm", "embed"]


class ReadingPositionInput(CamelModel):
    page: int = Field(default=1, ge=1)
    line: int = Field(default=1, ge=1)
    mode: Literal["pdf", "markdown"] = "pdf"


class CategoryInput(CamelModel):
    paper_ids: list[str] = Field(min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=120)


class BundleExportInput(CamelModel):
    paper_ids: list[str] = Field(min_length=1, max_length=500)
    format: Literal["bundle", "pdf", "markdown"] = "bundle"
