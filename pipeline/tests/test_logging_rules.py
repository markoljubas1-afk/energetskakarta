"""Structured logging rule: `extra` payloads must never collide with LogRecord attributes.

A collision raises KeyError at runtime, on exactly the code path being logged (it once broke the GEM
upload). Literal reserved keys are forbidden, and dictionaries are nested instead of spread, so a future
key such as "name" or "filename" cannot slip in unnoticed.
"""

from __future__ import annotations

import ast
import logging
from pathlib import Path

import pytest

SOURCE = Path(__file__).resolve().parents[1] / "src" / "energymap"
LOG_METHODS = {"debug", "info", "warning", "error", "exception", "critical", "log"}
RESERVED = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}


def extra_dicts() -> list[tuple[str, int, ast.expr]]:
    found = []
    for path in sorted(SOURCE.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call):
                for keyword in node.keywords:
                    if (
                        keyword.arg == "extra"
                        and isinstance(node.func, ast.Attribute)
                        and node.func.attr in LOG_METHODS
                    ):
                        found.append(
                            (f"{path.relative_to(SOURCE)}:{node.lineno}", node.lineno, keyword.value)
                        )
    return found


def test_there_are_log_calls_to_check() -> None:
    assert len(extra_dicts()) > 10


@pytest.mark.parametrize(
    ("where", "line", "payload"), extra_dicts(), ids=lambda v: v if isinstance(v, str) else ""
)
def test_extra_payload_is_safe(where: str, line: int, payload: ast.expr) -> None:
    assert isinstance(payload, ast.Dict), f"{where}: extra must be a literal dict so its keys can be checked"
    for key in payload.keys:
        assert key is not None, f"{where}: spread (**) into extra; nest the dictionary under a key instead"
        assert isinstance(key, ast.Constant) and isinstance(key.value, str), f"{where}: non-literal extra key"
        assert key.value not in RESERVED, f"{where}: '{key.value}' is a reserved LogRecord attribute"
