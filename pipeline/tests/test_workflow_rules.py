"""Workflow rule: a scheduled workflow must be switched on deliberately.

A fresh repository has no secrets. Without the switch, `live-hourly` alone would fail 24 times a day until
the ENTSO-E token arrives, and the noise would bury the first real failure. Every job of a workflow with a
`schedule` trigger therefore runs on schedule only when its repository variable says so; manual runs are
never gated, so a missing secret still fails loudly when a person starts the run.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
GATE = re.compile(r"^github\.event_name != 'schedule' \|\| vars\.(SCHEDULE_[A-Z]+) == 'true'$")
# which switch a workflow belongs to: the secrets it needs arrive together
EXPECTED = {
    "osm-scheduled.yml": "SCHEDULE_OSM",
    "emodnet-update.yml": "SCHEDULE_OSM",
    "geothermal-update.yml": "SCHEDULE_OSM",
    "eurostat-update.yml": "SCHEDULE_OSM",
    "energy-daily.yml": "SCHEDULE_ENTSOE",
    "live-hourly.yml": "SCHEDULE_ENTSOE",
    "gas-daily.yml": "SCHEDULE_GAS",
    "hep-daily.yml": "SCHEDULE_HEP",
    "prices-daily.yml": "SCHEDULE_ENTSOE",
}
# keepalive keeps every schedule alive, so it runs when any switch is on
KEEPALIVE = "keepalive.yml"


def load(path: Path) -> dict[Any, Any]:
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return document


def triggers(document: dict[Any, Any]) -> dict[str, Any]:
    # YAML 1.1 reads the key `on` as the boolean True
    on = document.get("on", document.get(True))
    assert isinstance(on, dict)
    return on


def scheduled() -> list[Path]:
    return [path for path in sorted(WORKFLOWS.glob("*.yml")) if "schedule" in triggers(load(path))]


def test_the_scheduled_workflows_are_the_known_ones() -> None:
    # a new scheduled workflow has to be given a switch here, on purpose
    assert {path.name for path in scheduled()} == {*EXPECTED, KEEPALIVE}


@pytest.mark.parametrize("name", sorted({*EXPECTED, KEEPALIVE}))
def test_every_job_runs_on_schedule_only_when_switched_on(name: str) -> None:
    document = load(WORKFLOWS / name)
    assert "workflow_dispatch" in triggers(document), "a gated workflow must stay startable by hand"
    jobs = document["jobs"]
    assert jobs
    if name == KEEPALIVE:
        condition = " ".join(str(jobs["keepalive"]["if"]).split())
        assert condition.startswith("github.event_name != 'schedule' ||")
        for switch in set(EXPECTED.values()):
            assert f"vars.{switch} == 'true'" in condition, f"keepalive ignores {switch}"
        return
    for job_id, job in jobs.items():
        match = GATE.match(str(job.get("if", "")))
        assert match is not None, f"{name}: job {job_id} has no schedule switch"
        assert match.group(1) == EXPECTED[name]


def test_the_pages_deploy_waits_for_its_project_name() -> None:
    deploy = load(WORKFLOWS / "web.yml")["jobs"]["deploy"]
    assert "vars.PAGES_PROJECT != ''" in deploy["if"]
    jobs = load(WORKFLOWS / "web.yml")["jobs"]
    # the checks are never gated by the project name; they run whenever the code may have changed
    assert jobs["check"]["if"] == "github.event_name != 'workflow_run'"
    assert "if" not in jobs["e2e"]  # follows the check through `needs`


def test_a_data_run_deploys_without_repeating_the_tests_but_never_untested_code() -> None:
    """After a data workflow the code is unchanged: the pages are rebuilt and deployed without the 25
    minutes of e2e. The commit must still have passed them at its own push, and a code run deploys only
    when its own e2e succeeded."""
    deploy = load(WORKFLOWS / "web.yml")["jobs"]["deploy"]
    condition = " ".join(str(deploy["if"]).split())
    assert condition.startswith("always() &&")  # otherwise skipped tests would skip the deploy too
    assert "github.event.workflow_run.conclusion == 'success'" in condition
    assert "needs.e2e.result == 'success'" in condition
    guard = next(step for step in deploy["steps"] if "passed its own tests" in str(step.get("name", "")))
    assert guard["if"] == "github.event_name == 'workflow_run'"
    assert '--commit "$GITHUB_SHA"' in guard["run"] and "--status success" in guard["run"]
    assert deploy["steps"].index(guard) < next(
        index for index, step in enumerate(deploy["steps"]) if "wrangler-action" in str(step.get("uses", ""))
    )
    assert deploy["permissions"]["actions"] == "read"


def test_code_runs_and_data_runs_cannot_cancel_one_another() -> None:
    """Three concurrency groups: a push's tests are not cancelled by a data refresh, and a data workflow
    that failed or was skipped (its schedule switch is off) cancels nothing at all."""
    group = load(WORKFLOWS / "web.yml")["concurrency"]["group"]
    assert "github.event_name != 'workflow_run' && 'code'" in group
    assert "github.event.workflow_run.conclusion == 'success' && 'data' || 'idle'" in group
