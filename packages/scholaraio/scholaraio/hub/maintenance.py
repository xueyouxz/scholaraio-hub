"""The library's optional, expensive work, one job per task kind.

Importing a paper makes it searchable by keyword straight away. Semantic
search, the topic map and LLM-written summaries each cost minutes of model
time, so they run as tasks with progress and a stop button rather than inside
an import.
"""
from __future__ import annotations

from pathlib import Path

from scholaraio.hub.artifacts import AnalysisArtifacts
from scholaraio.hub.errors import InvalidRequest
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.tasks import Job, Progress
from scholaraio.stores.papers import read_meta, write_meta


def needs_deep(directory: Path) -> bool:
    """Whether this paper still lacks the LLM-written table of contents or conclusion."""
    if not (directory / "paper.md").exists():
        return False
    meta = read_meta(directory)
    return not meta.get("toc") or not (meta.get("l3_conclusion") or "").strip()


def has_abstract(directory: Path) -> bool:
    return bool((read_meta(directory).get("abstract") or "").strip())


class MaintenanceJobs:
    def __init__(self, runtime: LibraryRuntime, artifacts: AnalysisArtifacts, model_dir: Path):
        self.runtime = runtime
        self.artifacts = artifacts
        self.model_dir = model_dir

    def lanes(self) -> dict[str, str]:
        """Which kinds must not run together: vectors feed topics; both others write meta.json."""
        return {"semantic": "vectors", "topics": "vectors", "deep": "metadata", "quality": "metadata"}

    def registry(self) -> dict[str, Job]:
        """Task kinds in the order the browser lists them."""
        return {
            "semantic": self.semantic,
            "topics": self.topics,
            "deep": self.deep,
            "quality": self.quality,
        }

    def semantic(self, progress: Progress) -> str:
        """Make semantic search usable: fetch the model, then embed every paper."""
        from scholaraio.services import vectors

        cfg = self.runtime.cfg
        if vectors.embedding_provider(cfg) == "none":
            raise InvalidRequest("当前配置关闭了向量嵌入（embed.provider=none）")
        if not vectors.runtime_available():
            raise InvalidRequest("向量依赖尚未安装，请先在前端安装语义检索运行时")
        progress.phase("model")
        vectors.prepare_model(cfg)
        if progress.stopped:
            return "已在下载模型后停止"
        progress.phase("embed")
        count = vectors.build_vectors(
            cfg.papers_dir,
            cfg.index_db,
            cfg=cfg,
            on_progress=progress.advance,
            should_stop=lambda: progress.stopped,
        )
        return f"新增 {count} 篇论文的向量"

    def topics(self, progress: Progress) -> str:
        """Cluster the existing vectors into topics and write what the dashboard reads."""
        from scholaraio.services.topics import build_topics

        cfg = self.runtime.cfg
        progress.phase("cluster")
        model = build_topics(cfg.index_db, cfg.papers_dir, cfg=cfg, save_path=self.model_dir)
        if progress.stopped:
            return "已在建模后停止"
        progress.phase("artifacts")
        return f"{self.artifacts.write(model)} 个主题"

    def deep(self, progress: Progress) -> str:
        """Ask the LLM for a table of contents and a conclusion, paper by paper."""
        from scholaraio.services.ingest import steps
        from scholaraio.services.ingest.types import StepResult

        cfg = self.runtime.cfg
        if not cfg.resolved_api_key():
            raise InvalidRequest("深度解析需要先配置 LLM API Key")
        pending = [directory for directory in self.runtime.papers.directories() if needs_deep(directory)]
        progress.phase("deep", done=0, total=len(pending))
        done = 0
        failed = 0
        for directory in pending:
            if progress.stopped:
                break
            meta_path = directory / "meta.json"
            results = [steps.step_toc(meta_path, cfg, {}), steps.step_l3(meta_path, cfg, {})]
            failed += 1 if any(result == StepResult.FAIL for result in results) else 0
            done += 1
            progress.advance(done)
        if done:
            self.runtime.reindex()
        return f"处理 {done} 篇" + (f"，其中 {failed} 篇未能完成" if failed else "")

    def quality(self, progress: Progress) -> str:
        """Fill in the abstracts the library is missing: from the DOI, else from the full text.

        Only papers without an abstract are touched, one at a time, so the
        count moves and the stop button takes effect between papers.
        """
        from scholaraio.services.ingest_metadata import extract_abstract_from_md, fetch_abstract_by_doi

        cfg = self.runtime.cfg
        # The full-text fallback asks the LLM only when one is configured.
        llm = cfg if cfg.resolved_api_key() else None
        pending = [directory for directory in self.runtime.papers.directories() if not has_abstract(directory)]
        progress.phase("abstracts", done=0, total=len(pending))
        filled = failed = 0
        for done, directory in enumerate(pending, start=1):
            if progress.stopped:
                break
            meta = read_meta(directory)
            doi = str(meta.get("doi") or "").strip()
            abstract = None
            try:
                if doi and doi != "null":
                    abstract = fetch_abstract_by_doi(doi)
                if not abstract and (directory / "paper.md").exists():
                    abstract = extract_abstract_from_md(directory / "paper.md", cfg=llm)
            except Exception:  # one paper's source being down must not stop the rest
                abstract = None
            if abstract:
                with self.runtime.lock:
                    current = read_meta(directory)
                    current["abstract"] = abstract
                    write_meta(directory, current)
                filled += 1
            else:
                failed += 1
            progress.advance(done)
        if filled:
            self.runtime.reindex()
            self.runtime.events.publish("papers")
        return f"补全 {filled} 篇摘要" + (f"，{failed} 篇未能补全" if failed else "")


__all__ = ["MaintenanceJobs", "has_abstract", "needs_deep"]
