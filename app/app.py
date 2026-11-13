"""Gibson's Broadband Monitor — self-hosted broadband testing and outage history.

One application process/one scheduler. All timestamps are stored in UTC.
"""
from __future__ import annotations

import csv
import hmac
import io
import json
import logging
import os
import re
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from functools import wraps
from contextlib import contextmanager
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, render_template, request, session, url_for

VERSION = "0.1.0-beta.1"
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "monitor.sqlite3"
PORT = int(os.getenv("PORT", "8765"))
PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
SECRET = os.getenv("SECRET_KEY", "")
DEFAULT_SPEED_INTERVAL = max(15, min(int(os.getenv("SPEED_INTERVAL_MINUTES", "60")), 1440))
DEFAULT_PROBE_INTERVAL = max(15, min(int(os.getenv("PROBE_INTERVAL_SECONDS", "30")), 3600))
DEFAULT_THRESHOLD = max(1, min(int(os.getenv("SLOW_DOWNLOAD_MBPS", "100")), 100000))
TIMEZONE_NAME = os.getenv("TZ", "Europe/London")
SPEEDTEST_BIN = os.getenv("SPEEDTEST_BIN", "/usr/local/bin/speedtest-go")
SPEEDTEST_TIMEOUT = 180
CHECK_URLS = ["https://www.google.com/generate_204", "https://www.cloudflare.com/cdn-cgi/trace"]

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = SECRET or os.urandom(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Strict")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("gibsons")

DATA_DIR.mkdir(parents=True, exist_ok=True)
_lock = threading.Lock()
_speed_running = threading.Event()
_stop = threading.Event()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=15)
    try:
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA busy_timeout=15000")
        con.execute("PRAGMA journal_mode=WAL")
        yield con
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()


def initialize():
    with db() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS speed_tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                download REAL,
                upload REAL,
                ping REAL,
                jitter REAL,
                server TEXT,
                status TEXT NOT NULL CHECK(status IN ('ok','failed')),
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS speed_ts_idx ON speed_tests(ts);
            CREATE TABLE IF NOT EXISTS probes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                online INTEGER NOT NULL CHECK(online IN (0,1)),
                latency REAL
            );
            CREATE INDEX IF NOT EXISTS probe_ts_idx ON probes(ts);
            CREATE TABLE IF NOT EXISTS outages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started TEXT NOT NULL,
                ended TEXT,
                duration_seconds INTEGER
            );
            CREATE INDEX IF NOT EXISTS outage_started_idx ON outages(started);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        for key, value in {
            "speed_interval": DEFAULT_SPEED_INTERVAL,
            "probe_interval": DEFAULT_PROBE_INTERVAL,
            "slow_threshold": DEFAULT_THRESHOLD,
        }.items():
            con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (key, str(value)))


def setting(key: str, fallback: int):
    with db() as con:
        row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    try:
        return int(row["value"]) if row else fallback
    except ValueError:
        return fallback


def parse_rate(value):
    """Return Mbps. Numeric primary output for speedtest-go is in Mbps.

    Handle Speedtest-compatible nested payloads for resilience to CLI output changes.
    """
    if isinstance(value, dict):
        if "bandwidth" in value:  # Speedtest.net format reports bytes per second
            return round(float(value["bandwidth"]) * 8 / 1_000_000, 2)
        for key in ("mbps", "Mbps", "speed", "value", "download_speed", "upload_speed"):
            if key in value:
                return parse_rate(value[key])
        return None
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.strip().lower()
        number = re.search(r"-?\d+(?:\.\d+)?", value)
        if not number:
            return None
        parsed = float(number.group())
        if "gbps" in value:
            return round(parsed * 1000, 2)
        if "kbps" in value:
            return round(parsed / 1000, 2)
        if "bps" in value and "mbps" not in value:
            return round(parsed / 1_000_000, 2)
        return round(parsed, 2)
    parsed = float(value)
    return round(parsed / 1_000_000 if parsed > 1_000_000 else parsed, 2)


def parse_ms(value):
    if isinstance(value, dict):
        for field in ("latency", "ping", "jitter", "duration", "value", "avg"):
            if field in value:
                return parse_ms(value[field])
        return None
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        match = re.search(r"(\d+(?:\.\d+)?)\s*(ns|µs|us|ms|s)?", value)
        if not match:
            return None
        amount = float(match.group(1))
        unit = match.group(2)
        if unit in ("µs", "us"):
            amount /= 1000
        elif unit == "ns":
            amount /= 1_000_000
        elif unit == "s":
            amount *= 1000
        return round(amount, 2)
    return round(float(value), 2)


def parse_speed_result(payload):
    if isinstance(payload, list):
        payload = payload[-1] if payload else {}
    if not isinstance(payload, dict):
        raise ValueError("Speedtest response was not a JSON object")
    # speedtest-go v1.8.x --json uses snake_case `dl_speed` / `ul_speed`
    # in bytes/second and `latency` / `jitter` as nanosecond durations.
    servers = payload.get("servers")
    if isinstance(servers, list) and servers:
        data = servers[0]
    else:
        # An ordinary Speedtest-compatible record may include `server` metadata
        # alongside top-level download/upload values; do not parse metadata as
        # though it were the measurement object.
        data = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    if any(k in data for k in ("dl_speed", "ul_speed", "dlSpeed", "ulSpeed")):
        # Keep legacy camelCase compatibility with alternate JSON emitters.
        dl_raw = data.get("dl_speed", data.get("dlSpeed"))
        ul_raw = data.get("ul_speed", data.get("ulSpeed"))
        dl = round(float(dl_raw) * 8 / 1_000_000, 2) if dl_raw is not None else None
        ul = round(float(ul_raw) * 8 / 1_000_000, 2) if ul_raw is not None else None
        ping = round(float(data["latency"]) / 1_000_000, 2) if data.get("latency") is not None else None
        jitter = round(float(data["jitter"]) / 1_000_000, 2) if data.get("jitter") is not None else None
    else:
        dl = parse_rate(data.get("download", data.get("download_speed")))
        ul = parse_rate(data.get("upload", data.get("upload_speed")))
        ping = parse_ms(data.get("latency", data.get("ping")))
        jitter = parse_ms(data.get("jitter"))
    server = data.get("name") or data.get("server") or data.get("test_server") or "Automatic"
    if isinstance(server, dict):
        server = server.get("name") or server.get("sponsor") or server.get("host") or "Automatic"
    if dl is None or ul is None or dl < 0 or ul < 0:
        raise ValueError("Missing valid download/upload measurements")
    return (dl, ul, ping, jitter, str(server)[:180])


def run_speedtest():
    if _speed_running.is_set():
        return False
    with _lock:
        if _speed_running.is_set():
            return False
        _speed_running.set()
    started = now_iso()
    try:
        command = [SPEEDTEST_BIN, "--json", "--mask-isp"]
        server_id = os.getenv("SPEEDTEST_SERVER_ID", "").strip()
        if server_id.isdecimal():
            command += ["--server", server_id]
        log.info("Starting broadband test")
        result = subprocess.run(command, text=True, capture_output=True, timeout=SPEEDTEST_TIMEOUT, check=False)
        if result.returncode:
            raise RuntimeError((result.stderr or result.stdout or "Speedtest exited with an error")[-400:])
        raw = result.stdout.strip()
        # Some CLI versions add informational text before the JSON object.
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            begin, end = raw.find("{"), raw.rfind("}")
            if begin < 0 or end < begin:
                raise ValueError("Speedtest did not return JSON")
            payload = json.loads(raw[begin:end + 1])
        dl, ul, ping, jitter, server = parse_speed_result(payload)
        with db() as con:
            con.execute("INSERT INTO speed_tests(ts,download,upload,ping,jitter,server,status) VALUES(?,?,?,?,?,?,'ok')", (started, dl, ul, ping, jitter, server))
        log.info("Speed test: down=%s Mbps up=%s Mbps ping=%s ms", dl, ul, ping)
    except Exception as exc:
        msg = str(exc)[:500]
        log.warning("Speed test failed: %s", msg)
        with db() as con:
            con.execute("INSERT INTO speed_tests(ts,status,error) VALUES(?,'failed',?)", (started, msg))
    finally:
        _speed_running.clear()
    return True


def connection_probe():
    """Use two unrelated HTTPS endpoints; neither service alone defines an outage."""
    began = time.monotonic()
    successful = False
    latency = None
    for url in CHECK_URLS:
        try:
            req = urllib.request.Request(url, method="GET", headers={"User-Agent": "GibsonsBroadbandMonitor/0.1"})
            with urllib.request.urlopen(req, timeout=4) as response:
                successful = 200 <= response.status < 400
                response.read(256)
                if successful:
                    latency = round((time.monotonic() - began) * 1000, 1)
                    break
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            log.debug("Probe %s failed: %s", url, exc)
    timestamp = now_iso()
    with db() as con:
        con.execute("INSERT INTO probes(ts, online, latency) VALUES(?,?,?)", (timestamp, int(successful), latency))
        # Debounce events using two consecutive failed or successful probes.
        rows = con.execute("SELECT online,ts FROM probes ORDER BY id DESC LIMIT 2").fetchall()
        open_event = con.execute("SELECT id,started FROM outages WHERE ended IS NULL ORDER BY id DESC LIMIT 1").fetchone()
        if len(rows) >= 2 and all(not row["online"] for row in rows) and not open_event:
            con.execute("INSERT INTO outages(started) VALUES(?)", (rows[-1]["ts"],))
            log.warning("Connectivity outage detected")
        elif len(rows) >= 2 and all(row["online"] for row in rows) and open_event:
            first = datetime.fromisoformat(open_event["started"])
            duration = max(0, int((datetime.fromisoformat(timestamp) - first).total_seconds()))
            con.execute("UPDATE outages SET ended=?,duration_seconds=? WHERE id=?", (timestamp, duration, open_event["id"]))
            log.info("Connectivity restored after %s seconds", duration)
    return successful


def record_status():
    with db() as con:
        latest = con.execute("SELECT * FROM speed_tests WHERE status='ok' ORDER BY id DESC LIMIT 1").fetchone()
        attempt = con.execute("SELECT ts,status,error FROM speed_tests ORDER BY id DESC LIMIT 1").fetchone()
        probe = con.execute("SELECT ts,online,latency FROM probes ORDER BY id DESC LIMIT 1").fetchone()
        open_event = con.execute("SELECT started FROM outages WHERE ended IS NULL ORDER BY id DESC LIMIT 1").fetchone()
        today = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(timespec="seconds")
        counts = con.execute("SELECT COUNT(*) total, SUM(online) online FROM probes WHERE ts>=?", (today,)).fetchone()
        down_count = con.execute("SELECT COUNT(*) n FROM outages WHERE started>=?", (today,)).fetchone()["n"]
        total_speed = con.execute("SELECT COUNT(*) n FROM speed_tests WHERE status='ok'").fetchone()["n"]
        total_probe = con.execute("SELECT COUNT(*) n FROM probes").fetchone()["n"]
    return {
        "version": VERSION,
        "online": bool(probe["online"]) if probe else None,
        "last_probe": dict(probe) if probe else None,
        "current_outage": dict(open_event) if open_event else None,
        "latest": dict(latest) if latest else None,
        "last_attempt": dict(attempt) if attempt else None,
        "running": _speed_running.is_set(),
        "uptime30": round(100 * counts["online"] / counts["total"], 2) if counts["total"] else None,
        "outages30": down_count,
        "speed_samples": total_speed,
        "probe_samples": total_probe,
        "speed_interval": setting("speed_interval", DEFAULT_SPEED_INTERVAL),
        "probe_interval": setting("probe_interval", DEFAULT_PROBE_INTERVAL),
        "slow_threshold": setting("slow_threshold", DEFAULT_THRESHOLD),
        "timezone": TIMEZONE_NAME,
        "password_protected": bool(PASSWORD),
    }


def authorized():
    return not PASSWORD or session.get("logged_in") is True


def protected(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        if not authorized():
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for("login"))
        return handler(*args, **kwargs)
    return wrapped


@app.route("/login", methods=["GET", "POST"])
def login():
    if not PASSWORD:
        return redirect(url_for("index"))
    message = None
    if request.method == "POST":
        if hmac.compare_digest(request.form.get("password", ""), PASSWORD):
            session.clear()
            session["logged_in"] = True
            return redirect(url_for("index"))
        message = "Incorrect password"
    return render_template("login.html", message=message)


@app.post("/logout")
@protected
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/")
@protected
def index():
    return render_template("index.html", version=VERSION)


@app.get("/health")
def health():
    # Docker healthcheck checks web service readiness, not internet availability.
    return jsonify({"status": "ok", "version": VERSION})


@app.get("/api/status")
@protected
def api_status():
    return jsonify(record_status())


@app.get("/api/history")
@protected
def api_history():
    period = request.args.get("period", "7d")
    intervals = {"24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365}
    cutoff = None
    if period == "24h":
        cutoff = now_iso_from_delta(hours=24)
    elif period in intervals:
        cutoff = now_iso_from_delta(days=intervals[period])
    elif period == "custom":
        raw = request.args.get("from", "")
        try:
            cutoff = datetime.fromisoformat(raw).astimezone(timezone.utc).isoformat(timespec="seconds") if raw else None
        except ValueError:
            return jsonify({"error": "Invalid start date"}), 400
    elif period != "all":
        return jsonify({"error": "Unknown period"}), 400
    query = "SELECT ts,download,upload,ping,jitter,status,error FROM speed_tests"
    params = []
    conditions = []
    if cutoff:
        conditions.append("ts>=?")
        params.append(cutoff)
    if period == "custom" and request.args.get("to"):
        try:
            end = datetime.fromisoformat(request.args["to"]).astimezone(timezone.utc).isoformat(timespec="seconds")
        except ValueError:
            return jsonify({"error": "Invalid end date"}), 400
        conditions.append("ts<=?")
        params.append(end)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY ts ASC"
    with db() as con:
        rows = [dict(r) for r in con.execute(query, params).fetchall()]
    # Keep spike/drop information: retain extremes rather than averaging away outages.
    if len(rows) > 2400:
        bucket_size = max(1, (len(rows) + 1199) // 1200)
        selected = []
        for start in range(0, len(rows), bucket_size):
            bucket = rows[start:start + bucket_size]
            selected.extend([bucket[0], min(bucket, key=lambda r: r["download"] if r["download"] is not None else -1)])
        rows = sorted({row["ts"]: row for row in selected}.values(), key=lambda r: r["ts"])
    return jsonify({"points": rows, "period": period})


def now_iso_from_delta(**kwargs):
    return (datetime.now(timezone.utc) - timedelta(**kwargs)).isoformat(timespec="seconds")


@app.get("/api/outages")
@protected
def api_outages():
    with db() as con:
        items = [dict(r) for r in con.execute("SELECT * FROM outages ORDER BY id DESC LIMIT 250")]
    return jsonify({"outages": items})


@app.get("/api/results")
@protected
def api_results():
    with db() as con:
        items = [dict(r) for r in con.execute("SELECT * FROM speed_tests ORDER BY id DESC LIMIT 100")]
    return jsonify({"results": items})


@app.post("/api/run")
@protected
def api_run():
    if request.headers.get("X-Requested-With") != "GibsonsDashboard":
        return jsonify({"error": "Invalid request"}), 403
    if _speed_running.is_set():
        return jsonify({"error": "Test already running"}), 409
    threading.Thread(target=run_speedtest, daemon=True, name="manual-speedtest").start()
    return jsonify({"started": True}), 202


@app.post("/api/settings")
@protected
def api_settings():
    if request.headers.get("X-Requested-With") != "GibsonsDashboard":
        return jsonify({"error": "Invalid request"}), 403
    fields = {"speed_interval": (15, 1440), "probe_interval": (15, 3600), "slow_threshold": (1, 100000)}
    payload = request.get_json(silent=True) or {}
    updates = {}
    for key, (low, high) in fields.items():
        if key in payload:
            try:
                value = int(payload[key])
            except (ValueError, TypeError):
                return jsonify({"error": f"{key} must be an integer"}), 400
            if not low <= value <= high:
                return jsonify({"error": f"{key} must be between {low} and {high}"}), 400
            updates[key] = str(value)
    with db() as con:
        for key, value in updates.items():
            con.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
    return jsonify({"saved": True, "settings": updates})


@app.get("/api/export.csv")
@protected
def api_export():
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Timestamp UTC", "Download Mbps", "Upload Mbps", "Ping ms", "Jitter ms", "Test server", "Status", "Error"])
    with db() as con:
        for row in con.execute("SELECT ts, download, upload, ping, jitter, server, status, error FROM speed_tests ORDER BY id"):
            # Prefix unsafe spreadsheet characters to prevent formula execution on import.
            writer.writerow([("'" + value if isinstance(value, str) and value[:1] in "=+-@" else value) for value in row])
    return Response(out.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=gibsons-speed-history.csv"})


def scheduler_loop():
    # Give the web interface a moment to become available on first boot.
    time.sleep(3)
    next_probe = time.monotonic()
    next_speed = time.monotonic() + 12
    while not _stop.is_set():
        current = time.monotonic()
        if current >= next_probe:
            try:
                connection_probe()
            except Exception:
                log.exception("Connectivity probe failed unexpectedly")
            next_probe = time.monotonic() + setting("probe_interval", DEFAULT_PROBE_INTERVAL)
        if current >= next_speed:
            if not _speed_running.is_set():
                threading.Thread(target=run_speedtest, daemon=True, name="scheduled-speedtest").start()
            next_speed = time.monotonic() + 60 * setting("speed_interval", DEFAULT_SPEED_INTERVAL)
        _stop.wait(1)


def start_scheduler():
    threading.Thread(target=scheduler_loop, daemon=True, name="monitor-scheduler").start()


initialize()
if os.getenv("DISABLE_SCHEDULER", "0") != "1":
    start_scheduler()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=False)
