"""Shrink a full country extract to power-related objects plus the nodes and ways they reference."""

from __future__ import annotations

import logging
from pathlib import Path

import osmium
import osmium.filter

from energymap.config import SourceFilter

log = logging.getLogger(__name__)


def filtered_path(filtered_dir: Path, region_id: str, md5: str, spec: SourceFilter) -> Path:
    """Name a filtered file after everything that determines its content: the source checksum and what
    the pass selects. Without the latter in the name, widening a pass would silently reuse a cached file
    that predates the change, and the new objects would simply never appear."""
    return filtered_dir / f"{region_id}-{md5[:12]}-{spec.name}-{spec.fingerprint()}.osm.pbf"


def prefilter(src: Path, dst: Path, spec: SourceFilter) -> Path:
    if dst.exists():
        log.info("filtered file up to date", extra={"file": dst.name})
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    part = dst.with_name(f"{dst.stem}.part.osm.pbf")
    try:
        with osmium.BackReferenceWriter(str(part), ref_src=str(src), overwrite=True) as writer:
            selection = (
                osmium.filter.KeyFilter(*spec.keys) if spec.keys else osmium.filter.TagFilter(*spec.pairs)
            )
            for obj in osmium.FileProcessor(str(src)).with_filter(selection):
                writer.add(obj)
        part.replace(dst)
    finally:
        part.unlink(missing_ok=True)
    log.info(
        "prefiltered source",
        extra={"src": src.name, "pass": spec.name, "dst": dst.name, "bytes": dst.stat().st_size},
    )
    return dst
