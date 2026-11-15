from __future__ import annotations

from typing import Any

from energymap import diff


def feature(key: str, *, name: str | None = None, country: str = "HR", mw: float = 10.0,
            retrieved: str = "2026-09-01T00:00:00+00:00", coords: tuple[float, float] = (15.0, 45.0)
            ) -> dict[str, Any]:  # fmt: skip
    return {
        "type": "Feature",
        "id": key,
        "geometry": {"type": "Point", "coordinates": list(coords)},
        "properties": {
            "id": key, "name": name, "country": country, "capacityMw": mw, "layer": "plants",
            "provenance": [{"sourceId": key.removeprefix("osm:"), "retrievedAt": retrieved}],
        },
    }  # fmt: skip


def test_provenance_only_change_is_not_a_change() -> None:
    before = diff.index([feature("osm:node/1", retrieved="2026-09-01T00:00:00+00:00")])
    after = diff.index([feature("osm:node/1", retrieved="2026-09-08T00:00:00+00:00")])
    result = diff.compare(before, after)
    assert (result.added, result.removed, result.changed, result.unchanged) == ([], [], [], 1)


def test_added_removed_changed_by_country() -> None:
    before = diff.index([
        feature("osm:node/1", name="A"),
        feature("osm:node/2", name="B", country="SI"),
        feature("osm:node/3", mw=10.0),
        feature("osm:node/4", coords=(15.0, 45.0)),
    ])  # fmt: skip
    after = diff.index([
        feature("osm:node/1", name="A"),
        feature("osm:node/3", mw=12.5),
        feature("osm:node/4", coords=(15.1, 45.0)),
        feature("osm:way/9", name="Nova", country="IT"),
    ])  # fmt: skip
    result = diff.compare(before, after)
    assert result.added == ["osm:way/9"]
    assert result.removed == ["osm:node/2"]
    assert result.changed == ["osm:node/3", "osm:node/4"]
    assert result.unchanged == 1
    assert result.by_country == {"IT": {"added": 1}, "SI": {"removed": 1}, "HR": {"changed": 2}}
    assert result.names["osm:node/2"] == "B"


def test_line_country_is_its_first_country() -> None:
    line = {
        "id": "osm:way/5",
        "geometry": {"type": "LineString", "coordinates": [[14.5, 45.5], [15.5, 45.5]]},
        "properties": {"id": "osm:way/5", "countries": ["SI", "HR"]},
    }
    assert diff.entry(line).country == "SI"


def test_first_publication_json_and_markdown() -> None:
    layers = {"plants": diff.compare({}, diff.index([feature("osm:node/1", name="Prva")]))}
    result = diff.BuildDiff("20260916T030000Z", None, layers)
    data = diff.to_json(result)
    assert data["baselineBuildId"] is None
    assert data["layers"]["plants"]["added"] == 1
    assert data["layers"]["plants"]["examples"]["added"] == [
        {"id": "osm:node/1", "name": "Prva", "lon": 15.0, "lat": 45.0}
    ]
    text = diff.to_markdown(result)
    assert "prva objava" in text
    assert "| Elektrane | 1 | 0 | 0 | 0 |" in text
    assert "Prva ([node/1](https://www.openstreetmap.org/node/1))" in text


def test_examples_are_capped() -> None:
    after = diff.index([feature(f"osm:node/{i}") for i in range(25)])
    result = diff.BuildDiff("b", "a", {"plants": diff.compare({}, after)})
    assert len(diff.to_json(result)["layers"]["plants"]["examples"]["added"]) == diff.MAX_EXAMPLES
    assert f"i još {25 - diff.MAX_EXAMPLES}" in diff.to_markdown(result)


def test_quiet_layers_have_no_detail_section() -> None:
    same = diff.index([feature("osm:node/1")])
    result = diff.BuildDiff("b", "a", {"plants": diff.compare(same, same)})
    text = diff.to_markdown(result)
    assert "### Elektrane" not in text
    assert "| Elektrane | 0 | 0 | 0 | 1 |" in text


def test_examples_carry_a_point_to_fly_to() -> None:
    line = {
        "id": "osm:way/5",
        "geometry": {"type": "LineString", "coordinates": [[14.5, 45.5], [15.5, 46.5]]},
        "properties": {"id": "osm:way/5", "countries": ["SI", "HR"]},
    }
    assert diff.entry(line).point == (15.0, 46.0)
    multi = {
        "id": "osm:way/6",
        "geometry": {
            "type": "MultiLineString",
            "coordinates": [[[14.0, 45.0], [14.2, 45.0]], [[16.0, 47.0]]],
        },
        "properties": {"id": "osm:way/6"},
    }
    assert diff.entry(multi).point == (15.0, 46.0)
    assert diff.entry({"id": "x", "geometry": None, "properties": {"id": "x"}}).point is None
    assert diff.representative_point({"type": "Point", "coordinates": []}) is None

    # a removed feature keeps the place it used to be, so it can still be looked at
    before = diff.index([feature("osm:node/1", coords=(16.0, 44.0))])
    result = diff.BuildDiff("b", "a", {"plants": diff.compare(before, {})})
    removed = diff.to_json(result)["layers"]["plants"]["examples"]["removed"]
    assert removed == [{"id": "osm:node/1", "name": None, "lon": 16.0, "lat": 44.0}]
