"""Rolling statistics periods are computed from actual stored observations."""
import os
import unittest
from datetime import datetime, timedelta, timezone

os.environ["DISABLE_SCHEDULER"] = "1"
from app import app as monitor  # noqa: E402


class RollingStatisticsTests(unittest.TestCase):
    def setUp(self):
        self.client = monitor.app.test_client()
        with monitor.db() as con:
            for table in ("speed_tests", "probes", "outages"):
                con.execute(f"DELETE FROM {table}")

    def timestamp(self, days=0, hours=0):
        return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).isoformat(timespec="seconds")

    def test_default_and_invalid_statistics_periods(self):
        default = self.client.get("/api/statistics")
        self.assertEqual(default.status_code, 200)
        self.assertEqual(default.json["period"], "30d")
        self.assertEqual(default.json["samples"], 0)
        self.assertIsNone(default.json["uptime"])
        self.assertEqual(default.json["outages"], 0)
        self.assertEqual(self.client.get("/api/statistics?period=tomorrow").status_code, 400)
        self.assertEqual(self.client.get("/api/statistics?period=").status_code, 400)
        self.assertEqual(self.client.get("/api/statistics?period=1y").status_code, 200)
        self.assertEqual(self.client.get("/api/statistics?period=all").status_code, 200)

    def test_windows_use_real_history_without_estimating_a_year(self):
        now, last10, last150, last400 = (
            self.timestamp(), self.timestamp(days=10),
            self.timestamp(days=150), self.timestamp(days=400),
        )
        with monitor.db() as con:
            for ts, download in (
                (now, 100), (last10, 200), (last150, 300), (last400, 400)
            ):
                con.execute(
                    "INSERT INTO speed_tests(ts,download,upload,ping,jitter,status) "
                    "VALUES(?,?,?,?,?,'ok')",
                    (ts, download, 20, 9, 1),
                )
            con.execute("INSERT INTO speed_tests(ts,status,error) VALUES(?,'failed','unavailable')", (now,))
            for ts, online in ((now, 1), (last10, 0), (last400, 1)):
                con.execute("INSERT INTO probes(ts,online,latency) VALUES(?,?,?)", (ts, online, 10))

        expectations = [
            ("24h", 1, 100, 100.0, 1),
            ("7d", 1, 100, 100.0, 1),
            ("30d", 2, 150, 50.0, 2),
            ("90d", 2, 150, 50.0, 2),
            ("1y", 3, 200, 50.0, 2),
            ("all", 4, 250, 66.67, 3),
        ]
        for period, count, expected_avg, uptime, probes in expectations:
            with self.subTest(period=period):
                response = self.client.get(f"/api/statistics?period={period}")
                self.assertEqual(response.status_code, 200)
                data = response.json
                self.assertEqual(data["period"], period)
                self.assertEqual(data["samples"], count)
                self.assertEqual(data["download"]["average"], expected_avg)
                self.assertAlmostEqual(data["uptime"], uptime, places=2)
                self.assertEqual(data["probe_samples"], probes)
                self.assertIsNotNone(data["first_sample"])
                self.assertEqual(data["failed_tests"], 1)

        # A 1-year window does not invent measurements for the missing months.
        year = self.client.get("/api/statistics?period=1y").json
        self.assertEqual(year["first_sample"], last150)

    def test_outages_spanning_window_are_not_lost(self):
        with monitor.db() as con:
            # This incident began long ago but ended within the last year.
            con.execute(
                "INSERT INTO outages(started,ended,duration_seconds) VALUES(?,?,?)",
                (self.timestamp(days=450), self.timestamp(days=180), 100),
            )
            # This incident ended more than one year ago, so only All includes it.
            con.execute(
                "INSERT INTO outages(started,ended,duration_seconds) VALUES(?,?,?)",
                (self.timestamp(days=700), self.timestamp(days=500), 100),
            )
            # A recent completed incident overlaps 7/30/90 day windows.
            con.execute(
                "INSERT INTO outages(started,ended,duration_seconds) VALUES(?,?,?)",
                (self.timestamp(days=3), self.timestamp(days=2), 100),
            )
            # An open incident that started long ago overlaps every range.
            con.execute(
                "INSERT INTO outages(started) VALUES(?)", (self.timestamp(days=500),),
            )
        expected = {"24h": 1, "7d": 2, "30d": 2, "90d": 2, "1y": 3, "all": 4}
        for period, count in expected.items():
            with self.subTest(period=period):
                result = self.client.get(f"/api/statistics?period={period}")
                self.assertEqual(result.json["outages"], count)


if __name__ == "__main__":
    unittest.main()
