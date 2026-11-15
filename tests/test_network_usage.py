"""Test host-only server traffic accounting with synthetic interface counters.

No live host network interface, Docker socket or external service is touched.
"""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

os.environ["DISABLE_SCHEDULER"] = "1"
from app import app as monitor  # noqa: E402
from app import network  # noqa: E402


class NetworkUsageTests(unittest.TestCase):
    def setUp(self):
        self.client = monitor.app.test_client()
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.path = Path(self.tempdir.name) / "dev"
        with monitor.db() as con:
            con.execute("DELETE FROM network_samples")
            con.execute(
                "INSERT INTO settings(key,value) VALUES('network_interface','auto') "
                "ON CONFLICT(key) DO UPDATE SET value='auto'"
            )
            con.execute(
                "INSERT INTO settings(key,value) VALUES('network_monthly_limit_gb','0') "
                "ON CONFLICT(key) DO UPDATE SET value='0'"
            )

    def write_dev(self, **counters):
        self.path.write_text(
            "Inter-| Receive | Transmit\n"
            " face |bytes packets errs drop fifo frame compressed multicast"
            " |bytes packets errs drop fifo colls carrier compressed\n"
            + "\n".join(
                f" {name}: {rx} 0 0 0 0 0 0 0 {tx} 0 0 0 0 0 0 0"
                for name, (rx, tx) in counters.items()
            ) + "\n", encoding="utf-8"
        )

    def time(self, minutes=0, days=0):
        return (datetime.now(timezone.utc) - timedelta(minutes=minutes, days=days)).isoformat(timespec="seconds")

    def headers(self):
        return {"X-Requested-With": "GibsonsDashboard"}

    def test_parsing_prefers_br0_and_omits_docker_virtual_links(self):
        self.write_dev(lo=(100, 100), eth0=(500, 250), br0=(900, 450),
                       docker0=(9999, 9999), veth123=(9999, 9999))
        found = network.read_counters(self.path)
        self.assertEqual(found["br0"], (900, 450))
        usable = network.interfaces(found)
        self.assertEqual(usable, ["br0", "eth0"])
        self.assertEqual(network.auto_interface(usable), "br0")

    def test_first_sample_baseline_and_correct_counter_differences(self):
        self.write_dev(br0=(1000, 3000), eth0=(2000, 4000))
        with monitor.db() as con:
            self.assertTrue(network.capture(con, self.path, self.time(minutes=2), "boot1")["recorded"])
        self.write_dev(br0=(8000, 12000), eth0=(200000, 400000))
        with monitor.db() as con:
            network.capture(con, self.path, self.time(minutes=1), "boot1")
        with monitor.db() as con:
            stats = network.summary(con, "24h", self.path)
        self.assertEqual(stats["interface"], "br0")
        self.assertEqual(stats["download_bytes"], 7000)
        self.assertEqual(stats["upload_bytes"], 9000)
        self.assertEqual(stats["total_bytes"], 16000)
        self.assertEqual(stats["sample_count"], 2)
        self.assertEqual(stats["coverage_seconds"], 60)
        self.assertIsNone(stats["average_daily_bytes"])  # Not enough history to extrapolate.
        self.assertEqual(stats["buckets"][-1]["download_bytes"], 7000)

    def test_average_daily_only_after_full_day_coverage(self):
        self.write_dev(br0=(1000, 2000))
        with monitor.db() as con:
            con.execute(
                "INSERT INTO network_samples(ts,interface,rx_bytes,tx_bytes,rx_delta,tx_delta,elapsed_seconds,boot_id) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (self.time(minutes=3), "br0", 1000, 2000, 1000000000, 0, 72000, "boot"),
            )
            stats = network.summary(con, "30d", self.path)
            self.assertIsNone(stats["average_daily_bytes"])  # Only 20 hours observed.
            con.execute(
                "INSERT INTO network_samples(ts,interface,rx_bytes,tx_bytes,rx_delta,tx_delta,elapsed_seconds,boot_id) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (self.time(minutes=1), "br0", 2000, 3000, 200000000, 0, 14400, "boot"),
            )
            stats = network.summary(con, "30d", self.path)
            self.assertEqual(stats["coverage_seconds"], 86400)
            self.assertEqual(stats["average_daily_bytes"], 1200000000)

    def test_reboot_reset_long_pause_and_interface_switch_do_not_invent_usage(self):
        self.write_dev(br0=(100, 100), eth0=(1000, 1000))
        with monitor.db() as con:
            network.capture(con, self.path, self.time(minutes=20), "boot1")
        self.write_dev(br0=(900, 900), eth0=(1000, 1000))
        with monitor.db() as con:
            network.capture(con, self.path, self.time(minutes=19), "boot1")
        self.write_dev(br0=(2000, 2000), eth0=(1000, 1000))
        with monitor.db() as con:
            network.capture(con, self.path, self.time(minutes=12), "boot1")  # Too long
        self.write_dev(br0=(40, 40), eth0=(1000, 1000))
        with monitor.db() as con:
            network.capture(con, self.path, self.time(minutes=11), "boot1")  # Counter reset
        self.write_dev(br0=(10000, 10000), eth0=(1000, 1000))
        with monitor.db() as con:
            network.capture(con, self.path, self.time(minutes=10), "boot2")  # Host reboot
        with monitor.db() as con:
            con.execute("UPDATE settings SET value='eth0' WHERE key='network_interface'")
            network.capture(con, self.path, self.time(minutes=9), "boot2")  # New interface baseline
            con.execute("UPDATE settings SET value='br0' WHERE key='network_interface'")
            network.capture(con, self.path, self.time(minutes=8), "boot2")  # First sample for br0 after boot2
        with monitor.db() as con:
            rows = con.execute("SELECT rx_delta,tx_delta FROM network_samples WHERE interface='br0' ORDER BY id").fetchall()
        self.assertEqual([x["rx_delta"] for x in rows], [0, 800, 0, 0, 0, 0])
        self.assertEqual([x["tx_delta"] for x in rows], [0, 800, 0, 0, 0, 0])

    def test_api_selects_rolling_periods_and_exports_real_bytes(self):
        self.write_dev(br0=(1000, 2000))
        with monitor.db() as con:
            con.execute(
                "INSERT INTO network_samples(ts,interface,rx_bytes,tx_bytes,rx_delta,tx_delta,elapsed_seconds,boot_id) "
                "VALUES(?,?,?,?,?,?,?,?)", (self.time(minutes=2), "br0", 100, 200, 100, 200, 60, "one")
            )
            con.execute(
                "INSERT INTO network_samples(ts,interface,rx_bytes,tx_bytes,rx_delta,tx_delta,elapsed_seconds,boot_id) "
                "VALUES(?,?,?,?,?,?,?,?)", (self.time(days=40), "br0", 500, 600, 300, 400, 60, "one")
            )
        with patch.object(network, "read_counters", return_value={"br0": (1000, 2000)}):
            recent = self.client.get("/api/network/usage?period=30d")
            self.assertEqual(recent.status_code, 200)
            self.assertEqual(recent.json["download_bytes"], 100)
            self.assertEqual(recent.json["total_bytes"], 300)
            self.assertEqual(recent.json["sample_count"], 1)
            self.assertIsNotNone(recent.json["first_sample"])
            year = self.client.get("/api/network/usage?period=1y").json
            self.assertEqual(year["download_bytes"], 400)
            self.assertEqual(year["upload_bytes"], 600)
            self.assertEqual(self.client.get("/api/network/usage?period=unknown").status_code, 400)
            export = self.client.get("/api/network/export.csv?period=1y")
            self.assertEqual(export.status_code, 200)
            self.assertIn("Downloaded bytes", export.get_data(as_text=True))
            self.assertIn("br0", export.get_data(as_text=True))

    def test_interface_selection_and_limit_auth_validation(self):
        with patch.object(network, "read_counters", return_value={"br0": (100, 200), "eth0": (100, 200)}):
            self.assertEqual(self.client.post("/api/network/interface", json={"interface": "eth0"}).status_code, 403)
            invalid = self.client.post("/api/network/interface", json={"interface": "../secrets"}, headers=self.headers())
            self.assertEqual(invalid.status_code, 400)
            valid = self.client.post("/api/network/interface", json={"interface": "eth0"}, headers=self.headers())
            self.assertEqual(valid.status_code, 200)
            self.assertEqual(self.client.get("/api/network/usage").json["interface"], "eth0")
            self.assertEqual(self.client.post("/api/network/interface", json={"interface": "auto"}, headers=self.headers()).status_code, 200)
        self.assertEqual(self.client.post("/api/network/limit", json={"limit_gb": 100}).status_code, 403)
        self.assertEqual(self.client.post("/api/network/limit", json={"limit_gb": -1}, headers=self.headers()).status_code, 400)
        saved = self.client.post("/api/network/limit", json={"limit_gb": 500}, headers=self.headers())
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(monitor.setting("network_monthly_limit_gb", 0), 500)

    def test_missing_host_mount_never_falls_back_to_container(self):
        with patch.object(network, "read_counters", side_effect=FileNotFoundError("missing")):
            result = self.client.get("/api/network/usage")
            self.assertEqual(result.status_code, 200)
            self.assertFalse(result.json["available"])
            self.assertIsNone(result.json["interface"])
            self.assertEqual(result.json["sample_count"], 0)
            self.assertEqual(
                self.client.post("/api/network/interface", json={"interface": "eth0"},
                                 headers=self.headers()).status_code, 400
            )
        self.write_dev(br0=(10, 20))
        with monitor.db() as con:
            self.assertEqual(
                network.capture(con, self.path, self.time(), "new")["interface"], "br0"
            )


if __name__ == "__main__":
    unittest.main()
