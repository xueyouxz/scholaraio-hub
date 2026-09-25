"""What the API answers with: one model per response shape.

Routes declare these as ``response_model``, so FastAPI checks every answer
against them and the OpenAPI document describes it. That document is where the
Hub's TypeScript types come from (``pnpm gen:library-types``); a field changes
here, never in TypeScript. Only declared fields reach the caller.

A model with defaults answers with ``response_model_exclude_unset``: a field the
service left out stays out, so the model filters an answer but never adds to it.

Services build camelCase dicts; the fields are snake_case with camelCase
aliases, like the request bodies in :mod:`.schemas`.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from scholaraio.interfaces.api.schemas import CamelModel

TaskKind = Literal["semantic", "topics", "deep", "quality"]


class Health(CamelModel):
    status: Literal["ok"]


class RevealedDirectory(CamelModel):
    opened: bool
    path: str


class RuntimeInstallStatus(CamelModel):
    """How installing an optional runtime capability is going."""

    state: Literal["idle", "installing", "ready", "failed"]
    # Tail of the installer's output, so the browser can show what it is doing.
    log: list[str]
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


# ---- papers ---------------------------------------------------------------


class LibraryPaper(CamelModel):
    """One paper as every list, search and citation view shows it."""

    id: str
    title: str
    authors: str
    year: str
    doi: str
    journal: str
    abstract: str
    has_pdf: bool
    has_markdown: bool
    parse_status: Literal["ready", "pending", "failed"]
    error: str | None
    cover_image: str | None
    citation_count: int | None
    citation_counts: dict[str, int] | None
    paper_type: str
    metadata_status: Literal["complete", "incomplete"] = Field(
        description='"incomplete" when ingestion could not establish key metadata such as the DOI.'
    )
    missing_metadata: list[str]


class LibraryPaperDetail(LibraryPaper):
    markdown: str
    l3_conclusion: str


class PaperList(CamelModel):
    papers: list[LibraryPaper]


class ImageList(CamelModel):
    images: list[str]


class RefetchResult(CamelModel):
    changed: bool
    paper: LibraryPaper


class ReadingPosition(CamelModel):
    """Where the reader left off in a paper."""

    page: int
    line: int
    mode: Literal["pdf", "markdown"]


# ---- search and context ---------------------------------------------------


class SearchResult(CamelModel):
    paper: LibraryPaper


class LibrarySearchResponse(CamelModel):
    """The matching papers, best first."""

    results: list[SearchResult]
    notice: str | None = None
    unavailable: Literal["runtime_missing", "provider_none", "no_vectors"] | None = Field(
        default=None,
        description="Set when the mode itself cannot run, so the page can offer the remedy.",
    )


class DiscoveredPaper(CamelModel):
    """A paper found on the open web, with the locator the import queue fetches it by."""

    id: str
    title: str
    authors: list[str]
    year: int | None
    venue: str
    doi: str
    arxiv_id: str
    locator: str
    open_access: bool
    citations: int | None
    source: Literal["openalex", "arxiv"]
    paper_id: str | None = Field(description="Set when the library already holds this work.")


class DiscoverError(CamelModel):
    source: str
    error: str


class DiscoverResponse(CamelModel):
    results: list[DiscoveredPaper]
    errors: list[DiscoverError] = Field(
        description="Sources that could not answer; the others still did."
    )


class LibraryCitation(CamelModel):
    id: str
    paper_id: str
    chunk_id: str
    title: str
    start_line: int
    end_line: int
    text: str


class LibraryContext(CamelModel):
    citations: list[LibraryCitation]
    truncated: bool


class Scope(CamelModel):
    paper_ids: list[str] | None = Field(description="None means the whole library.")


# ---- citations ------------------------------------------------------------


class LibraryReference(CamelModel):
    """A work this paper cites; ``paper`` is set when the library holds it."""

    doi: str
    title: str
    year: str
    paper: LibraryPaper | None


class ReferenceList(CamelModel):
    references: list[LibraryReference]


class CitingList(CamelModel):
    citing: list[LibraryPaper]


class ExportFile(CamelModel):
    filename: str
    content_type: str
    content: str


# ---- projects -------------------------------------------------------------


class LiteratureProject(CamelModel):
    id: str
    name: str
    path: str = Field(description="Directory the agent works in.")
    paper_ids: list[str]
    paper_count: int


class ProjectList(CamelModel):
    projects: list[LiteratureProject]


class ArchivedProject(CamelModel):
    id: str
    archived_at: str
    path: str = Field(description="Where the archived project's directory now is.")


# ---- imports --------------------------------------------------------------


class ImportItem(CamelModel):
    id: str
    name: str
    title: str | None = Field(
        default=None,
        description="What the user knows a fetched paper by, when it is not the file name.",
    )
    status: Literal[
        "queued",
        "running",
        "completed",
        "completed_incomplete",
        "duplicate",
        "needs_review",
        "failed",
    ] = Field(description='"completed_incomplete": ingested, but key metadata such as the DOI is missing.')
    step: str | None = Field(
        default=None, description="Pipeline step currently running: mineru | extract | dedup | ingest."
    )
    paper_id: str | None = None
    missing_metadata: list[str] | None = None
    error: str | None = None
    project_error: str | None = Field(
        default=None, description="Why a paper that did arrive could not join the job's workspace."
    )


class ImportJob(CamelModel):
    id: str
    project_id: str | None = Field(
        default=None, description="Workspace each paper joins once it is in the library."
    )
    items: list[ImportItem]


class FetchedImportJob(ImportJob):
    source: Literal["arxiv", "patent", "doi"] = Field(description="What the locator was taken for.")


class ImportJobList(CamelModel):
    jobs: list[ImportJob]


# ---- tasks and readiness --------------------------------------------------


class LibraryTask(CamelModel):
    """Optional library work that costs model time: run it when the user asks."""

    id: str
    kind: TaskKind
    status: Literal["queued", "running", "completed", "cancelled", "failed"]
    phase: str | None = Field(
        default=None, description="Stage within the task, e.g. downloading the model before embedding."
    )
    done: int
    total: int
    summary: str | None = None
    error: str | None = None
    started_at: str
    finished_at: str | None = None
    waiting_for: TaskKind | None = Field(
        default=None, description="For a queued task: the running task it waits behind, if any."
    )


class LibraryCapabilities(CamelModel):
    """What the library can do right now, and what it would take to do more."""

    papers: int
    vectors: int
    embed_provider: str
    embed_model: str
    model_ready: bool
    vector_runtime_ready: bool = Field(
        description="Whether the optional embedding packages are installed in the Python env."
    )
    semantic_ready: bool
    topics_built: bool
    mapped_papers: int = Field(
        description="Papers the stored topic map places; behind `vectors` means the map is out of date."
    )
    deep_pending: int
    missing_abstracts: int
    llm_configured: bool
    mineru_configured: bool
    tasks: list[LibraryTask]


# ---- analytics ------------------------------------------------------------


class LibraryTopic(CamelModel):
    """A topic the library's topic map found."""

    id: int
    keywords: list[str]
    paper_count: int
    name: str


class TopicOverview(CamelModel):
    built: bool
    topics: list[LibraryTopic]


class ProjectionPoint(CamelModel):
    """One paper placed on the topic map."""

    id: str
    x: float
    y: float
    topic_id: int
    year: int
    title: str


class Projection(CamelModel):
    built: bool
    points: list[ProjectionPoint]


class LibraryAnalytics(CamelModel):
    """The topics, and where each paper sits on the map."""

    topics: TopicOverview
    projection: Projection


# ---- settings -------------------------------------------------------------


class LibrarySettings(CamelModel):
    """Library settings the browser owns; API keys are write-only."""

    extractor: str
    pdf_parser: str
    llm_backend: str
    llm_model: str
    llm_base_url: str
    embed_provider: str
    embed_model: str
    embed_source: str
    embed_device: str
    mineru_configured: bool
    mineru_key_length: int = Field(
        description="Length of the stored MinerU token, so the field can mask it at its real length."
    )
    llm_configured: bool
    llm_key_length: int = Field(description="Length of the stored LLM API key; 0 when none is configured.")
    embed_api_configured: bool
    config_path: str = Field(description="The documented file a user can still edit by hand.")
    papers_dir: str = Field(description="Where the library keeps its papers.")
    workspace_dir: str = Field(description="Where each workspace's directory is created.")


class SettingsCheck(CamelModel):
    """One service tried with the current settings."""

    target: Literal["mineru", "llm", "embed"]
    ok: bool
    level: Literal["ok", "warning", "error"]
    message: str
