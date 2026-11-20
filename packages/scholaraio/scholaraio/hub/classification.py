"""Conservative venue classification, with an explicit manual override."""
from __future__ import annotations

import re

from scholaraio.hub.repository import PaperRecord

VENUES = {
    "CVPR": r"\bCVPR\b|conference on computer vision and pattern recognition",
    "ICCV": r"\bICCV\b|international conference on computer vision",
    "ECCV": r"\bECCV\b|european conference on computer vision",
    "NeurIPS": r"\b(?:NeurIPS|NIPS)\b|advances in neural information processing systems",
    "ICML": r"\bICML\b|international conference on machine learning",
    "ICLR": r"\bICLR\b|international conference on learning representations",
    "ACL": r"\bACL\b|annual meeting of the association for computational linguistics",
    "EMNLP": r"\bEMNLP\b|empirical methods in natural language processing",
    "NAACL": r"\bNAACL\b|north american chapter of the association for computational linguistics",
    "AAAI": r"\bAAAI\b|aaai conference on artificial intelligence",
    "IJCAI": r"\bIJCAI\b|international joint conference on artificial intelligence",
    "SIGGRAPH": r"\bSIGGRAPH\b",
    "SIGIR": r"\bSIGIR\b|research and development in information retrieval",
    "KDD": r"\bKDD\b|knowledge discovery and data mining",
    "WWW": r"\bWWW\b|the web conference|international world wide web conference",
    "CHI": r"\bCHI\b|human factors in computing systems",
    "VIS": r"\bIEEE VIS\b|ieee transactions on visualization and computer graphics|\bTVCG\b",
}


def category(record: PaperRecord) -> dict:
    conference = None
    journal = str(record.meta.get("journal") or "")
    # Metadata has precedence. Only inspect the header before Abstract/Introduction,
    # avoiding conference names cited in the main text and bibliography.
    sources = [journal]
    path = record.directory / "paper.md"
    if path.is_file():
        with path.open(encoding="utf-8") as stream:
            header = stream.read(6000)
        sources.append(re.split(r"(?im)^\s*#*\s*(?:abstract|1[. ]+introduction|references)\b", header)[0][:2500])
    for source in sources:
        matches = [name for name, pattern in VENUES.items() if re.search(pattern, source, re.I)]
        if len(matches) == 1:
            conference = matches[0]
            break
    manual = record.meta.get("hub", {}).get("category")
    return {"category": manual or conference or "待分类", "conference": conference,
            "categorySource": "manual" if manual else "conference" if conference else "unknown"}
