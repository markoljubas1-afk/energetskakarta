"""Official renewable shares (Eurostat ``nrg_ind_ren``) against a mocked Statistics API.

The answers are built here in the shape the API documents for JSON-stat 2.0: dimensions in the order
freq, nrg_bal, unit, geo, time; ``value`` and ``status`` as objects keyed by the flat position, with empty
cells left out; flag labels under ``extension.status.label``; ``updated`` with an offset like "+0100".
**The numbers are invented** (a straight line per area and indicator); they test the reading, not Croatia's
statistics.
"""

from __future__ import annotations

import copy
import json
import math
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from energymap import cli, publish
from energymap.eurostat import renewables
from energymap.eurostat.renewables import EurostatDataError, EurostatSourceError

NOW = datetime(2026, 11, 15, 4, 17, tzinfo=UTC)
YEARS = list(range(2010, 2025))
Cells = dict[tuple[str, str, int], float]


def invented(geos: tuple[str, ...] = ("HR", "SI", "BA", "EU27_2020"), years: list[int] = YEARS) -> Cells:
    """Invented shares: 20 % in the first year plus one point a year, offset per area and indicator."""
    cells: Cells = {}
    for g, geo in enumerate(geos):
        for i, indicator in enumerate(renewables.INDICATORS):
            for year in years:
                cells[(geo, indicator, year)] = round(20 + g + 5 * i + (year - years[0]) + 0.123, 3)
    return cells


def answer(
    cells: Cells,
    *,
    flags: dict[tuple[str, str, int], str] | None = None,
    as_array: bool = False,
    unit: str = "PC",
) -> dict[str, Any]:
    """A JSON-stat 2.0 dataset as the API returns it, for the areas and years that occur in ``cells``."""
    geos = list(dict.fromkeys(geo for geo, _, _ in cells))
    years = sorted({year for _, _, year in cells})
    order = [
        ("freq", ["A"]),
        ("nrg_bal", list(renewables.INDICATORS)),
        ("unit", [unit]),
        ("geo", geos),
        ("time", [str(y) for y in years]),
    ]
    sizes = [len(codes) for _, codes in order]
    strides = [math.prod(sizes[i + 1 :]) for i in range(len(sizes))]

    def position(geo: str, indicator: str, year: int) -> int:
        at = [0, renewables.INDICATORS.index(indicator), 0, geos.index(geo), years.index(year)]
        return sum(i * s for i, s in zip(at, strides, strict=True))

    values = {str(position(*key)): value for key, value in cells.items()}
    status = {str(position(*key)): flag for key, flag in (flags or {}).items()}
    total = math.prod(sizes)
    return {
        "version": "2.0",
        "class": "dataset",
        "label": "Share of energy from renewable sources",
        "source": "ESTAT",
        "updated": "2026-01-09T23:00:00+0100",
        "value": [values.get(str(p)) for p in range(total)] if as_array else values,
        "status": status,
        "id": [name for name, _ in order],
        "size": sizes,
        "dimension": {
            name: {"label": name, "category": {"index": {c: i for i, c in enumerate(codes)}, "label": {}}}
            for name, codes in order
        },
        "extension": {
            "lang": "EN",
            "status": {"label": {"p": "provisional", "e": "estimated", "b": "break in time series"}},
        },
    }


class Api:
    """The Statistics API: one JSON answer (or an error) and the requests it was asked."""

    def __init__(self, body: object, status: int = 200) -> None:
        self.body = body
        self.status = status
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, json=self.body)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handle))


def collected(body: object) -> dict[str, Any]:
    with Api(body).client() as client:
        return renewables.collect(client, NOW)


# ---------------------------------------------------------------- reading JSON-stat


def test_cells_follow_the_flat_positions_last_dimension_fastest() -> None:
    cells = {("HR", "REN", 2023): 28.1, ("SI", "REN_TRA", 2024): 11.5, ("SI", "REN", 2023): 25.0}
    found = {
        (c.codes["geo"], c.codes["nrg_bal"], int(c.codes["time"])): c.value
        for c in renewables.cells(answer(cells))
    }
    # every cell lands where it was put; the empty ones (left out of the object) yield nothing
    assert found == cells


def test_an_array_of_values_reads_like_the_sparse_object() -> None:
    cells = invented(("HR", "SI"), [2023, 2024])
    by_object = [(c.codes, c.value) for c in renewables.cells(answer(cells))]
    by_array = [(c.codes, c.value) for c in renewables.cells(answer(cells, as_array=True))]
    assert by_object == by_array and len(by_array) == len(cells)


def test_one_request_asks_for_every_indicator_and_area() -> None:
    api = Api(answer(invented()))
    with api.client() as client:
        renewables.collect(client, NOW)
    (request,) = api.requests
    assert str(request.url).startswith(renewables.API_URL + "?")
    params = request.url.params
    assert params.get_list("nrg_bal") == ["REN", "REN_ELC", "REN_HEAT_CL", "REN_TRA"]
    assert params.get_list("geo") == ["HR", "SI", "HU", "RS", "BA", "ME", "IT", "AT", "EU27_2020"]
    assert (params.get("format"), params.get("unit"), params.get("freq")) == ("JSON", "PC", "A")
    assert len(params.get_list("nrg_bal")) + len(params.get_list("geo")) + 2 < 50  # Eurostat's limit


# ---------------------------------------------------------------- the document


def test_the_document_aligns_every_series_with_the_years() -> None:
    cells = invented()
    del cells[("BA", "REN", 2024)]  # an Energy Community party a year behind
    flags = {("HR", "REN", 2024): "p", ("HR", "REN_TRA", 2020): "b", ("SI", "REN", 2024): "e"}
    doc = collected(answer(cells, flags=flags))
    renewables.validate(doc)
    assert doc["years"] == YEARS
    assert doc["series"]["HR"]["REN"][0] == 20.123 and doc["series"]["HR"]["REN"][-1] == 34.123
    assert doc["series"]["BA"]["REN"][-1] is None and doc["series"]["BA"]["REN"][-2] is not None
    assert renewables.last_year(doc, "BA") == 2023 and renewables.last_year(doc) == 2024
    assert doc["flags"]["HR"] == {"REN": {"2024": "p"}, "REN_TRA": {"2020": "b"}}
    # Eurostat's words for the flags in use, and only those
    assert doc["flagLabels"] == {"b": "break in time series", "e": "estimated", "p": "provisional"}
    # the areas that did not answer are named, in the map's order
    assert doc["missing"] == ["HU", "RS", "ME", "IT", "AT"]
    assert list(doc["series"]) == ["HR", "SI", "BA", "EU27_2020"]
    assert doc["updated"] == "2026-01-09T23:00:00+01:00"
    assert (doc["source"], doc["license"], doc["dataset"]) == ("Eurostat", "CC-BY-4.0", "nrg_ind_ren")


def test_a_flag_without_a_value_is_left_out() -> None:
    cells = invented(("HR",))
    del cells[("HR", "REN_TRA", 2024)]
    doc = collected(answer(cells, flags={("HR", "REN_TRA", 2024): ":"}))
    assert doc["series"]["HR"]["REN_TRA"][-1] is None
    assert doc["flags"] == {}


def test_an_error_answer_fails_with_its_message() -> None:
    error = {"error": [{"status": 400, "id": 100, "label": "Invalid query parameter geo"}]}
    with Api(error, status=400).client() as client, pytest.raises(EurostatSourceError, match="Invalid query"):
        renewables.collect(client, NOW)
    # an error object with HTTP 200 is still an error
    with pytest.raises(EurostatSourceError, match="error"):
        collected({"class": "error", "status": "404", "label": "No data"})


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda a: a.pop("value"), "no values"),
        (lambda a: a["id"].remove("time"), "id, size and dimension"),
        (lambda a: a.update(size=[1, 4, 1, 4, 99]), "do not match"),
        (lambda a: a["value"].update({"999999": 1.0}), "outside"),
        (lambda a: a["value"].update({"0": "28,1"}), "not a number"),
        (lambda a: a.update({"class": "collection"}), "not a JSON-stat dataset"),
        (lambda a: a["dimension"]["time"]["category"]["index"].update({"2010": 7}), "positions"),
        (lambda a: a.update(updated="yesterday"), "not a date"),
    ],
)
def test_a_changed_format_fails_loudly(change: Callable[[dict[str, Any]], object], message: str) -> None:
    body = answer(invented())
    change(body)
    with pytest.raises(EurostatSourceError, match=message):
        collected(body)


def test_the_unit_must_be_percent() -> None:
    with pytest.raises(EurostatSourceError, match="unit"):
        collected(answer(invented(), unit="KTOE"))


def test_a_value_that_is_no_share_is_refused() -> None:
    cells = invented()
    cells[("HR", "REN_ELC", 2024)] = 250.0
    with pytest.raises(EurostatDataError, match="not a share"):
        collected(answer(cells))


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda d: d["series"]["HR"].pop("REN_HEAT_CL"), "must have all"),
        (lambda d: d["series"]["HR"].update(REN=[None] * 10 + [30.0] * 5), "at least 10"),
        (lambda d: d["series"]["SI"]["REN"].append(1.0), "one value per year"),
        (lambda d: d["series"].update(DE={"REN": [1.0] * 15}), "keyed by"),
        (lambda d: d.update(years=[2010, 2012]), "consecutive"),
        (lambda d: d["flags"].update(HR={"REN": {"1999": "p"}}), "do not match"),
        (lambda d: d["series"]["SI"]["REN"].__setitem__(0, 20.5), "contentHash"),
    ],
)
def test_validation_refuses_a_broken_document(
    change: Callable[[dict[str, Any]], object], message: str
) -> None:
    doc = collected(answer(invented()))
    change(doc)
    with pytest.raises(EurostatDataError, match=message):
        renewables.validate(doc)


# ---------------------------------------------------------------- publishing


@pytest.fixture
def store(tmp_path: Path) -> Iterator[publish.DirectoryStore]:
    yield publish.DirectoryStore(tmp_path / "bucket")


def published(store: publish.DirectoryStore) -> dict[str, Any]:
    raw = store.get_bytes(renewables.KEY)
    assert raw is not None
    loaded: dict[str, Any] = json.loads(raw)
    return loaded


def test_publish_writes_once_and_skips_an_unchanged_answer(store: publish.DirectoryStore) -> None:
    doc = collected(answer(invented()))
    assert renewables.publish_renewables(store, doc) is True
    assert published(store)["contentHash"] == doc["contentHash"]
    later = copy.deepcopy(doc) | {"retrievedAt": "2026-12-12T04:17:00+00:00"}
    assert renewables.publish_renewables(store, later) is False
    assert published(store)["retrievedAt"] == doc["retrievedAt"]


def test_a_revision_or_a_new_year_is_published(store: publish.DirectoryStore) -> None:
    renewables.publish_renewables(store, collected(answer(invented())))
    revised = invented()
    revised[("HR", "REN", 2023)] = 29.0
    assert renewables.publish_renewables(store, collected(answer(revised))) is True
    assert published(store)["series"]["HR"]["REN"][-2] == 29.0
    newer = collected(answer(invented(years=[*YEARS, 2025])))
    assert renewables.publish_renewables(store, newer) is True
    assert renewables.last_year(published(store)) == 2025


def test_an_answer_that_lost_the_latest_year_is_refused(store: publish.DirectoryStore) -> None:
    renewables.publish_renewables(store, collected(answer(invented())))
    truncated = collected(answer(invented(years=YEARS[:-1])))
    with pytest.raises(EurostatDataError, match="HR REN: 2023 after 2024"):
        renewables.publish_renewables(store, truncated)
    assert renewables.last_year(published(store)) == 2024


def test_an_answer_that_lost_a_neighbour_or_an_indicator_is_refused(store: publish.DirectoryStore) -> None:
    renewables.publish_renewables(store, collected(answer(invented())))
    only_croatia = collected(answer(invented(("HR",))))
    with pytest.raises(EurostatDataError, match="SI REN: None after 2024"):
        renewables.publish_renewables(store, only_croatia)
    cells = invented()
    del cells[("SI", "REN_ELC", 2024)]
    with pytest.raises(EurostatDataError, match="1 published series"):
        renewables.publish_renewables(store, collected(answer(cells)))
    assert list(published(store)["series"]) == ["HR", "SI", "BA", "EU27_2020"]
    # a real withdrawal goes through on purpose
    assert renewables.publish_renewables(store, only_croatia, allow_drop=True) is True


# ---------------------------------------------------------------- command line


def test_cli_fetch_and_publish(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out = tmp_path / "mirror"
    publish_dir = ["eurostat", "publish-dir", "--data-dir", str(tmp_path), "--out", str(out)]
    assert cli.main(publish_dir) == cli.EXIT_REJECTED  # nothing fetched yet
    api = Api(answer(invented()))
    monkeypatch.setattr("energymap.cli.make_client", api.client)
    assert cli.main(["eurostat", "fetch", "--data-dir", str(tmp_path)]) == cli.EXIT_OK
    assert (tmp_path / "eurostat" / "renewables.json").exists()
    assert cli.main(publish_dir) == cli.EXIT_OK
    assert json.loads((out / renewables.KEY).read_text(encoding="utf-8"))["years"] == YEARS
    api.status, api.body = 503, {"error": [{"status": 503, "label": "Service unavailable"}]}
    assert cli.main(["eurostat", "fetch", "--data-dir", str(tmp_path)]) == cli.EXIT_FAILED
