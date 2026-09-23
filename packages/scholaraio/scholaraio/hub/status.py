"""What the library can do right now, and what is wrong with it."""
from __future__ import annotations

from scholaraio.hub.artifacts import AnalysisArtifacts
from scholaraio.hub.maintenance import has_abstract, needs_deep
from scholaraio.hub.runtime import LibraryRuntime
from scholaraio.hub.tasks import TaskRunner

# Papers listed under each audit rule; the count still covers all of them.
AUDIT_SAMPLE = 50


class LibraryStatus:
    def __init__(self, runtime: LibraryRuntime, tasks: TaskRunner, artifacts: AnalysisArtifacts):
        self.runtime = runtime
        self.tasks = tasks
        self.artifacts = artifacts

    def readiness(self) -> dict:
        """What the library can do right now, and what it would take to do more."""
        from scholaraio.services import vectors

        cfg = self.runtime.cfg
        with self.runtime.lock:
            directories = self.runtime.papers.directories()
            vector_count = vectors.vector_count(cfg.index_db)
            return {
                "papers": len(directories),
                "vectors": vector_count,
                "embedProvider": vectors.embedding_provider(cfg),
                "embedModel": cfg.embed.model,
                "modelReady": vectors.model_available(cfg),
                "vectorRuntimeReady": vectors.runtime_available(),
                "semanticReady": vector_count > 0,
                "topicsBuilt": self.artifacts.topics_built(),
                "deepPending": sum(1 for directory in directories if needs_deep(directory)),
                "missingAbstracts": sum(1 for directory in directories if not has_abstract(directory)),
                "llmConfigured": bool(cfg.resolved_api_key()),
                "mineruConfigured": bool(cfg.resolved_mineru_api_key()),
                "tasks": self.tasks.list(),
            }

    def audit(self) -> dict:
        """What is wrong with the library right now, as the audit sees it."""
        from scholaraio.services.audit import audit_papers

        with self.runtime.lock:
            issues = audit_papers(self.runtime.cfg.papers_dir)
            # The audit names papers by directory; the browser opens them by
            # the id the rest of the API uses, and shows them by title.
            known = {
                record.directory.name: (record.id, str(record.meta.get("title") or record.directory.name))
                for record in self.runtime.papers
            }
        grouped: dict[tuple[str, str], list[dict]] = {}
        for issue in issues:
            paper_id, title = known.get(issue.paper_id, (issue.paper_id, issue.paper_id))
            grouped.setdefault((issue.rule, issue.severity), []).append(
                {"paperId": paper_id, "title": title, "message": issue.message}
            )
        return {
            "total": len(issues),
            "groups": [
                {"rule": rule, "severity": severity, "count": len(entries), "papers": entries[:AUDIT_SAMPLE]}
                for (rule, severity), entries in sorted(grouped.items(), key=lambda item: -len(item[1]))
            ],
        }


__all__ = ["LibraryStatus"]
