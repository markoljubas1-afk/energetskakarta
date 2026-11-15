"""Build ENTSO-E documents the way the platform shapes them (IEC 62325-451-6), for tests."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta

GL_NS = "urn:iec62325.351:tc57wg16:451-6:generationloaddocument:3:0"
ACK_NS = "urn:iec62325.351:tc57wg16:451-1:acknowledgementdocument:7:0"


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%MZ")


def period(start: datetime, resolution: str, values: Sequence[float | None], step: timedelta) -> str:
    end = start + step * len(values)
    points = "".join(
        f"<Point><position>{i}</position><quantity>{v:g}</quantity></Point>"
        for i, v in enumerate(values, start=1)
        if v is not None
    )
    return (
        f"<Period><timeInterval><start>{iso(start)}</start><end>{iso(end)}</end></timeInterval>"
        f"<resolution>{resolution}</resolution>{points}</Period>"
    )


def series(
    periods: Sequence[str],
    *,
    psr: str | None = None,
    consumption: bool = False,
    curve: str = "A01",
    area: str = "10YHR-HEP------M",
) -> str:
    domain = "outBiddingZone_Domain.mRID" if consumption else "inBiddingZone_Domain.mRID"
    psr_xml = f"<MktPSRType><psrType>{psr}</psrType></MktPSRType>" if psr else ""
    return (
        f"<TimeSeries><mRID>1</mRID><businessType>A01</businessType>"
        f'<{domain} codingScheme="A01">{area}</{domain}>'
        f"<quantity_Measure_Unit.name>MW</quantity_Measure_Unit.name><curveType>{curve}</curveType>"
        f"{psr_xml}{''.join(periods)}</TimeSeries>"
    )


def document(*timeseries: str, kind: str = "A75") -> bytes:
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><GL_MarketDocument xmlns="{GL_NS}">'
        f"<mRID>x</mRID><type>{kind}</type>{''.join(timeseries)}</GL_MarketDocument>"
    ).encode()


def no_data() -> bytes:
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><Acknowledgement_MarketDocument xmlns="{ACK_NS}">'
        "<mRID>ack</mRID><Reason><code>999</code>"
        "<text>No matching data found for Data item ACTUAL_GENERATION_PER_PRODUCTION_TYPE</text></Reason>"
        "</Acknowledgement_MarketDocument>"
    ).encode()


def hourly(start: datetime, values: Sequence[float | None]) -> str:
    return period(start, "PT60M", values, timedelta(hours=1))
