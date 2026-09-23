import json
from pathlib import Path
from unittest.mock import patch

import pytest

from scholaraio.hub.migration import apply, plan, rollback


def fixture(tmp_path):
    source, target = tmp_path / "old", tmp_path / "hub"
    paper = source / "data/libraries/papers/stable-id"
    paper.mkdir(parents=True)
    (paper / "meta.json").write_text(json.dumps({"id": "stable-id", "title": "Paper", "authors": []}))
    (paper / "paper.md").write_text("# Paper\n\nResearch evidence and attached image ![](images/a.png)")
    (paper / "images").mkdir()
    (paper / "images/a.png").write_bytes(b"attachment")
    (source / "workspace").mkdir()
    (source / "workspace/note.md").write_text("User notes")
    (source / "code.py").write_text("must not move")
    return source, target, paper


def test_verified_move_and_restore(tmp_path):
    source, target, paper = fixture(tmp_path)
    manifest = plan(source, target)
    apply(manifest)
    assert json.loads(manifest.read_text())["state"] == "complete"
    assert not (paper / "meta.json").exists()
    assert (source / "code.py").exists()
    assert (target / "data/libraries/papers/stable-id/images/a.png").read_bytes() == b"attachment"
    assert (target / "workspace/note.md").read_text() == "User notes"
    rollback(manifest)
    assert (paper / "images/a.png").read_bytes() == b"attachment"
    assert not (target / "config.yaml").exists()


@pytest.mark.parametrize("failure", ["conflict", "missing", "space"])
def test_preflight_never_moves_source_on_failure(tmp_path, failure):
    source, target, paper = fixture(tmp_path)
    manifest = plan(source, target)
    if failure == "conflict":
        conflict = target / "workspace/note.md"
        conflict.parent.mkdir(parents=True)
        conflict.write_text("Do not overwrite")
    elif failure == "missing":
        (paper / "paper.md").unlink()
    with patch("scholaraio.hub.migration.shutil.disk_usage") as disk:
        disk.return_value.free = 0 if failure == "space" else 10**12
        with pytest.raises((ValueError, OSError)):
            apply(manifest)
    assert (paper / "meta.json").exists()


def test_mid_move_failure_rolls_back_from_verified_backup(tmp_path):
    source, target, paper = fixture(tmp_path)
    manifest = plan(source, target)
    import shutil
    move = shutil.move
    calls = 0
    def fail_second(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("interrupted")
        return move(*args)
    with patch("scholaraio.hub.migration.shutil.move", side_effect=fail_second):
        with pytest.raises(OSError, match="interrupted"):
            apply(manifest)
    rollback(manifest)
    assert (paper / "meta.json").exists()
    assert (paper / "images/a.png").read_bytes() == b"attachment"


def test_rollback_refuses_to_overwrite_new_user_content(tmp_path):
    source, target, paper = fixture(tmp_path)
    manifest = plan(source, target)
    apply(manifest)
    (target / "workspace/note.md").write_text("Newer note")
    with pytest.raises(ValueError, match="changed"):
        rollback(manifest)
    assert (target / "workspace/note.md").read_text() == "Newer note"


def test_reindex_failure_and_config_change_rollback(tmp_path):
    source, target, paper = fixture(tmp_path)
    manifest = plan(source, target)
    with patch("scholaraio.hub.migration.HubLibrary", side_effect=RuntimeError("index failure")):
        with pytest.raises(RuntimeError):
            apply(manifest)
    assert manifest.stat().st_mode & 0o777 == 0o600
    original_config = (target / "config.yaml").read_text()
    (target / "config.yaml").write_text("changed: true")
    with pytest.raises(ValueError, match="before changing files"):
        rollback(manifest)
    assert not (paper / "meta.json").exists()
    (target / "config.yaml").write_text(original_config)
    rollback(manifest)
    assert (paper / "meta.json").exists()
    assert not (target / "config.yaml").exists()


def test_atomic_config_failure_rolls_back_files(tmp_path):
    source, target, paper = fixture(tmp_path)
    manifest = plan(source, target)
    with patch("scholaraio.hub.migration.os.link", side_effect=OSError("write failed")):
        with pytest.raises(OSError):
            apply(manifest)
    rollback(manifest)
    assert (paper / "meta.json").exists()
    assert not (target / "config.yaml").exists()
