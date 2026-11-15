"""Parse ENTSO-E Transparency Platform XML (IEC 62325 market documents) into plain time series.

Handles what the platform actually sends for A75 (actual generation per type) and A65 (total load):
* several ``TimeSeries``, each with one or more ``Period`` blocks;
* point time = period start + (position - 1) * resolution;
* curve type A01 lists every position; A03 omits positions whose value did not change, so a value holds
  until the next listed position (or the end of the period);
* in A75 a series with ``outBiddingZone_Domain.mRID`` is consumption (for example pumping), not generation.

Element names are matched without their XML namespace, which changes between document versions.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta

_DURATION = re.compile(r"^PT(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?$|^P(?P<d>\d+)D$")


class EntsoeParseError(ValueError):
    """The document is not an ENTSO-E market document this parser understands."""


@dataclass(frozen=True, slots=True)
class Interval:
    """One reported value: average MW for power series, EUR/MWh for price series."""

    start: datetime
    end: datetime
    value: float

    @property
    def hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600

    @property
    def mwh(self) -> float:
        """Energy, for power series."""
        return self.value * self.hours


@dataclass(frozen=True, slots=True)
class Series:
    psr_type: str | None
    consumption: bool
    intervals: tuple[Interval, ...]
    # position in a price document that lists several classification sequences
    sequence: int | None = None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(element: ET.Element, name: str) -> ET.Element | None:
    return next((c for c in element if _local(c.tag) == name), None)


def _children(element: ET.Element, name: str) -> Iterator[ET.Element]:
    return (c for c in element if _local(c.tag) == name)


def _text(element: ET.Element, *path: str) -> str | None:
    node: ET.Element | None = element
    for name in path:
        node = _child(node, name) if node is not None else None
    return node.text.strip() if node is not None and node.text else None


def _required(element: ET.Element, *path: str) -> str:
    value = _text(element, *path)
    if value is None:
        raise EntsoeParseError(f"missing {'/'.join(path)} in {_local(element.tag)}")
    return value


def parse_resolution(value: str) -> timedelta:
    match = _DURATION.match(value)
    if not match or not any(match.groupdict().values()):
        raise EntsoeParseError(f"unsupported resolution {value!r}")
    if match["d"]:
        return timedelta(days=int(match["d"]))
    return timedelta(hours=int(match["h"] or 0), minutes=int(match["m"] or 0))


def parse_time(value: str) -> datetime:
    """ENTSO-E writes UTC as ``2026-09-01T22:00Z``."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EntsoeParseError(f"invalid timestamp {value!r}") from exc
    if parsed.tzinfo is None:
        raise EntsoeParseError(f"timestamp without time zone {value!r}")
    return parsed


def _period(period: ET.Element, curve_type: str, value_element: str) -> Iterator[Interval]:
    start = parse_time(_required(period, "timeInterval", "start"))
    end = parse_time(_required(period, "timeInterval", "end"))
    step = parse_resolution(_required(period, "resolution"))
    slots = round((end - start) / step)
    points: dict[int, float] = {}
    for point in _children(period, "Point"):
        position = int(_required(point, "position"))
        if not 1 <= position <= slots:
            raise EntsoeParseError(f"position {position} outside period of {slots} steps")
        points[position] = float(_required(point, value_element))
    if curve_type == "A03":
        # a value holds until the next listed position
        ordered = sorted(points)
        for index, position in enumerate(ordered):
            stop = ordered[index + 1] if index + 1 < len(ordered) else slots + 1
            for slot in range(position, stop):
                yield Interval(start + (slot - 1) * step, start + slot * step, points[position])
    elif curve_type == "A01":
        for position in sorted(points):
            yield Interval(start + (position - 1) * step, start + position * step, points[position])
    else:
        raise EntsoeParseError(f"unsupported curveType {curve_type!r}")


def parse_document(xml: bytes, value_element: str = "quantity") -> list[Series]:
    """``value_element`` is "quantity" for power (A75, A65, A11) and "price.amount" for prices (A44)."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise EntsoeParseError(f"not XML: {exc}") from exc
    kind = _local(root.tag)
    if kind == "Acknowledgement_MarketDocument":
        reason = _text(root, "Reason", "text") or "no reason given"
        raise EntsoeParseError(f"acknowledgement instead of data: {reason}")
    if kind not in {"GL_MarketDocument", "Publication_MarketDocument"}:
        raise EntsoeParseError(f"unexpected document {kind}")

    series = []
    for element in _children(root, "TimeSeries"):
        curve_type = _text(element, "curveType") or "A01"
        intervals = [
            iv for period in _children(element, "Period") for iv in _period(period, curve_type, value_element)
        ]
        sequence = _text(element, "classificationSequence_AttributeInstanceComponent.position")
        series.append(
            Series(
                psr_type=_text(element, "MktPSRType", "psrType"),
                consumption=_child(element, "outBiddingZone_Domain.mRID") is not None
                and _child(element, "inBiddingZone_Domain.mRID") is None,
                intervals=tuple(sorted(intervals, key=lambda iv: iv.start)),
                sequence=int(sequence) if sequence and sequence.isdigit() else None,
            )
        )
    return series


def is_no_data(xml: bytes) -> bool:
    """ENTSO-E answers an empty range with an acknowledgement whose reason code is 999."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return False
    if _local(root.tag) != "Acknowledgement_MarketDocument":
        return False
    return any(_text(reason, "code") == "999" for reason in _children(root, "Reason"))
