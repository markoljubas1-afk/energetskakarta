from __future__ import annotations

from energymap.validate import check_counts


def test_first_build_only_checks_empty_layers() -> None:
    assert check_counts({"lines": 5, "plants": 0}, None, max_drop=0.1) == ["layer 'plants' is empty"]


def test_small_drop_is_accepted() -> None:
    assert check_counts({"lines": 95}, {"lines": 100}, max_drop=0.1) == []


def test_large_drop_is_rejected() -> None:
    problems = check_counts({"lines": 80}, {"lines": 100}, max_drop=0.1)
    assert len(problems) == 1 and "dropped from 100 to 80" in problems[0]


def test_large_drop_allowed_explicitly() -> None:
    assert check_counts({"lines": 80}, {"lines": 100}, max_drop=0.1, allow_drop=True) == []


def test_missing_layer_is_rejected() -> None:
    assert check_counts({"lines": 100}, {"lines": 100, "plants": 3}, max_drop=0.1) == [
        "layer 'plants' disappeared (was 3)"
    ]


def test_growth_is_fine() -> None:
    assert check_counts({"lines": 150}, {"lines": 100}, max_drop=0.1) == []
