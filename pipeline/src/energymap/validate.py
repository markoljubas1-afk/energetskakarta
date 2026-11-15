"""Build gates: a build that fails these checks is never published."""

from __future__ import annotations

from collections.abc import Mapping


class BuildValidationError(RuntimeError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("Build rejected: " + "; ".join(problems))
        self.problems = problems


def check_counts(
    current: Mapping[str, int],
    previous: Mapping[str, int] | None,
    *,
    max_drop: float,
    allow_drop: bool = False,
) -> list[str]:
    """Return every problem found; an empty list means the build may be published.

    Empty layers are always an error. A drop larger than ``max_drop`` versus the previous build is an
    error unless ``allow_drop`` is set (for example after a deliberate change to the filtering rules).
    """
    problems = [f"layer '{layer}' is empty" for layer, count in current.items() if count == 0]
    if previous is None or allow_drop:
        return problems
    for layer, before in previous.items():
        now = current.get(layer)
        if now is None:
            problems.append(f"layer '{layer}' disappeared (was {before})")
        elif before > 0 and (before - now) / before > max_drop:
            problems.append(
                f"layer '{layer}' dropped from {before} to {now} (more than {max_drop:.0%}); "
                "rerun with --allow-drop if this is intended"
            )
    return problems
