"""Host network-interface traffic accounting for Gibson's Broadband Monitor.

Requires an explicit read-only bind of host /proc/1/net/dev into
/host/proc/net/dev. Never silently substitute the container's network
namespace: doing so would mislabel container traffic as server usage.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOST_COUNTERS_FILE = Path(os.getenv("HOST_NET_DEV", "/host/proc/net/dev"))
BOOT_ID_FILE = Path("/proc/sys/kernel/random/boot_id")
PERIODS = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90),
    "1y": timedelta(days=365),
    "all": None,
}
MAX_SAMPLE_GAP_SECONDS = 210
EXCLUDED_PREFIXES = ("veth", "docker", "br-", "virbr", "vnet", "tap", "ifb", "shim-", "cali", "flannel")


def read_counters(path: Path | str = HOST_COUNTERS_FILE) -> dict[str, tuple[int, int]]:
    """Read cumulative receive/transmit bytes for visible host interfaces."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    counters = {}
    for line in lines[2:]:
        if ":" not in line:
            continue
        name, raw = line.rsplit(":", 1)
        name = name.strip()
        fields = raw.split()
        if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,15}", name) or len(fields) < 16:
            continue
        try:
            rx, tx = int(fields[0]), int(fields[8])
        except ValueError:
            continue
        if rx >= 0 and tx >= 0:
            counters[name] = (rx, tx)
    if not counters:
        raise ValueError("Host network counters could not be read")
    return counters


def interfaces(counters: dict) -> list[str]:
    """Exclude loopback and Docker virtual links to avoid double counting."""
    return sorted(
        name for name in counters
        if name != "lo" and not name.startswith(EXCLUDED_PREFIXES)
    )


def auto_interface(available: list[str]) -> str | None:
    if not available:
        return None
    for name in ("br0", "bond0", "eth0"):
        if name in available:
            return name
    for prefix in ("en", "eth", "wlan", "wl"):
        match = next((name for name in available if name.startswith(prefix)), None)
        if match:
            return match
    return available[0]


def requested_interface(con) -> str:
    row = con.execute("SELECT value FROM settings WHERE key='network_interface'").fetchone()
    return row["value"] if row else "auto"


def choose_interface(con, available: list[str]) -> str | None:
    requested = requested_interface(con)
    return auto_interface(available) if requested == "auto" else (requested if requested in available else None)


def boot_id() -> str:
    try:
        return BOOT_ID_FILE.read_text(encoding="ascii").strip()
    except OSError:
        return ""


def capture(con, path: Path | str = HOST_COUNTERS_FILE, timestamp: str | None = None,
            current_boot: str | None = None) -> dict:
    """Capture one interface snapshot, recording only *verifiable* counter deltas.

    A fresh baseline is established when a counter resets, the host reboots,
    the chosen interface changes, or sampling pauses for more than 210 seconds.
    Thus missed periods are not invented or assigned to the wrong day.
    """
    counters = read_counters(path)
    available = interfaces(counters)
    chosen = choose_interface(con, available)
    if chosen is None:
        return {"available": available, "interface": None, "recorded": False}
    rx, tx = counters[chosen]
    ts = timestamp or datetime.now(timezone.utc).isoformat(timespec="seconds")
    identity = boot_id() if current_boot is None else current_boot
    previous = con.execute(
        "SELECT ts,rx_bytes,tx_bytes,boot_id FROM network_samples "
        "WHERE interface=? ORDER BY id DESC LIMIT 1", (chosen,)
    ).fetchone()
    incoming = outgoing = elapsed = 0
    if previous and previous["boot_id"] == identity:
        span = (datetime.fromisoformat(ts) - datetime.fromisoformat(previous["ts"])).total_seconds()
        if 0 < span <= MAX_SAMPLE_GAP_SECONDS and rx >= previous["rx_bytes"] and tx >= previous["tx_bytes"]:
            incoming = rx - previous["rx_bytes"]
            outgoing = tx - previous["tx_bytes"]
            elapsed = int(span)
    con.execute(
        "INSERT INTO network_samples(ts,interface,rx_bytes,tx_bytes,rx_delta,tx_delta,elapsed_seconds,boot_id) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (ts, chosen, rx, tx, incoming, outgoing, elapsed, identity),
    )
    return {"available": available, "interface": chosen, "recorded": True}


def summary(con, period: str = "30d", path: Path | str = HOST_COUNTERS_FILE) -> dict:
    if period not in PERIODS:
        raise ValueError("Unknown usage period")
    try:
        counters = read_counters(path)
        available = interfaces(counters)
        source_ready = bool(available)
    except (OSError, ValueError):
        available = []
        source_ready = False
    chosen = choose_interface(con, available)
    selected = requested_interface(con)

    # A previously selected interface may have been unplugged or renamed.
    # Do not silently substitute another interface and corrupt its history.
    if chosen is None and selected != "auto":
        chosen = selected
    result = {
        "period": period,
        "available": source_ready,
        "interfaces": available,
        "selected_interface": selected,
        "interface": chosen,
        "source": "host",
        "sample_count": 0,
        "first_sample": None,
        "last_sample": None,
        "coverage_seconds": 0,
        "download_bytes": 0,
        "upload_bytes": 0,
        "total_bytes": 0,
        "average_daily_bytes": None,
        "month_download_bytes": 0,
        "month_upload_bytes": 0,
        "month_total_bytes": 0,
        "buckets": [],
    }
    if not chosen:
        return result
    cutoff = (
        (datetime.now(timezone.utc) - PERIODS[period]).isoformat(timespec="seconds")
        if PERIODS[period] else None
    )
    where = "WHERE interface=?"
    params = [chosen]
    if cutoff:
        where += " AND ts>=?"
        params.append(cutoff)
    row = con.execute(
        "SELECT COUNT(*) n, MIN(ts) first, MAX(ts) last,"
        "COALESCE(SUM(rx_delta),0) down,COALESCE(SUM(tx_delta),0) up,"
        "COALESCE(SUM(elapsed_seconds),0) seconds "
        "FROM network_samples " + where, params
    ).fetchone()
    downloaded, uploaded = int(row["down"]), int(row["up"])
    result.update({
        "sample_count": row["n"],
        "first_sample": row["first"],
        "last_sample": row["last"],
        "coverage_seconds": row["seconds"],
        "download_bytes": downloaded,
        "upload_bytes": uploaded,
        "total_bytes": downloaded + uploaded,
        "average_daily_bytes": round((downloaded + uploaded) * 86400 / row["seconds"])
        if row["seconds"] >= 86400 else None,
    })
    group_len = 13 if period == "24h" else (7 if period in ("1y", "all") else 10)
    daily = con.execute(
        "SELECT substr(ts,1,?) bucket, SUM(rx_delta) down,SUM(tx_delta) up "
        "FROM network_samples " + where + " GROUP BY bucket ORDER BY bucket",
        [group_len, *params],
    ).fetchall()
    result["buckets"] = [{
        "bucket": row["bucket"], "download_bytes": int(row["down"]),
        "upload_bytes": int(row["up"])
    } for row in daily]
    month = datetime.now(timezone.utc).strftime("%Y-%m-01")
    totals = con.execute(
        "SELECT COALESCE(SUM(rx_delta),0) down,COALESCE(SUM(tx_delta),0) up "
        "FROM network_samples WHERE interface=? AND ts>=?", (chosen, month)
    ).fetchone()
    result["month_download_bytes"] = int(totals["down"])
    result["month_upload_bytes"] = int(totals["up"])
    result["month_total_bytes"] = result["month_download_bytes"] + result["month_upload_bytes"]
    return result
