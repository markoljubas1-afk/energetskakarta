"""Repository rule: the ignore files must not hide source. A pattern like ``data/`` matches every directory
of that name, and ``web/src/data/`` is source; the site would then not build from a fresh clone."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIRS = ("web/src/data", "web/src/map", "pipeline/src/energymap", "pipeline/tests/fixtures")


@pytest.mark.skipif(not (ROOT / ".gitignore").exists(), reason="no .gitignore at the root")
def test_source_directories_are_not_ignored(tmp_path: Path) -> None:
    """Ask git itself: a scratch repository with the project's ignore files and a probe file per directory."""
    for name in (".gitignore", "web/.gitignore"):
        source = ROOT / name
        if source.exists():
            target = tmp_path / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    probes = []
    for directory in SOURCE_DIRS:
        probe = tmp_path / directory / "probe.txt"
        probe.parent.mkdir(parents=True, exist_ok=True)
        probe.write_text("", encoding="utf-8")
        probes.append(f"{directory}/probe.txt")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    result = subprocess.run(
        ["git", "check-ignore", *probes], cwd=tmp_path, capture_output=True, text=True, check=False
    )
    assert result.stdout.strip() == "", f"ignored source: {result.stdout.strip()}"
