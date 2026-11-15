"""Local-only statistics and notification tests. Never contact ntfy or the internet."""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, Mock, patch

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="gibson-alert-test-"))
os.environ["DISABLE_SCHEDULER"] = "1"
from app import app as monitor  # noqa: E402


class AlertsAndStatsTests(unittest.TestCase):
    def setUp(self):
        self.client = monitor.app.test_client()
        with monitor.db() as con:
            for table in ("speed_tests", "probes", "outages", "alert_events"):
                con.execute(f"DELETE FROM {table}")
            for key, value in (("slow_threshold", "100"), ("alert_outage", "1"),
                               ("alert_restored", "1"), ("alert_slow", "0"),
                               ("slow_alert_active", "0")):
                con.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    @staticmethod
    def header():
        return {"X-Requested-With": "GibsonsDashboard"}

    def test_empty_statistics_do_not_invent_data(self):
        result = self.client.get("/api/statistics")
        self.assertEqual(result.status_code, 200)
        data = result.json
        self.assertEqual(data["samples"], 0)
        self.assertIsNone(data["download"]["average"])
        self.assertIsNone(data["jitter"]["maximum"])

    def test_statistics_show_real_averages_and_ignore_failed_tests(self):
        recent = monitor.now_iso()
        past = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat(timespec="seconds")
        with monitor.db() as con:
            con.execute("INSERT INTO speed_tests(ts,download,upload,ping,jitter,status) "
                        "VALUES(?,?,?,?,?,'ok')", (recent, 100, 20, 10, 1))
            con.execute("INSERT INTO speed_tests(ts,download,upload,ping,jitter,status) "
                        "VALUES(?,?,?,?,?,'ok')", (recent, 200, 40, 20, 3))
            con.execute("INSERT INTO speed_tests(ts,download,upload,ping,jitter,status) "
                        "VALUES(?,?,?,?,?,'ok')", (past, 500, 500, 500, 500))
            con.execute("INSERT INTO speed_tests(ts,status,error) VALUES(?,'failed','timeout')", (recent,))
        data = self.client.get("/api/statistics").json
        self.assertEqual(data["samples"], 2)
        self.assertEqual(data["failed_tests"], 1)
        self.assertEqual(data["download"], {"average": 150, "minimum": 100, "maximum": 200})
        self.assertEqual(data["upload"]["average"], 30)
        self.assertEqual(data["ping"]["minimum"], 10)
        self.assertEqual(data["jitter"]["maximum"], 3)

    def test_notification_settings_are_opt_in_and_validate_values(self):
        with patch.object(monitor, "NTFY_URL", ""):
            data = self.client.get("/api/status").json
            self.assertFalse(data["alerts_configured"])
        response = self.client.post("/api/settings", json={"alert_slow": 1, "alert_outage": 0},
                                    headers=self.header())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(monitor.setting("alert_slow", 0), 1)
        self.assertEqual(monitor.setting("alert_outage", 1), 0)
        self.assertEqual(self.client.post("/api/settings", json={"alert_slow": 3},
                                          headers=self.header()).status_code, 400)
        self.assertEqual(self.client.post("/api/alerts/test").status_code, 403)
        with patch.object(monitor, "NTFY_URL", ""):
            self.assertEqual(self.client.post("/api/alerts/test", headers=self.header()).status_code, 400)

    def test_outage_is_queued_until_two_successful_probes(self):
        with patch.object(monitor, "NTFY_URL", "https://ntfy.sh/a-long-private-topic"), \
             patch.object(monitor, "send_ntfy") as sender:
            with patch.object(monitor.urllib.request, "urlopen", side_effect=OSError("offline")):
                self.assertFalse(monitor.connection_probe())
                self.assertFalse(monitor.connection_probe())
            with monitor.db() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) FROM alert_events WHERE sent IS NULL").fetchone()[0], 1)
            sender.assert_not_called()
            response = MagicMock(status=204)
            response.read.return_value = b""
            response.__enter__ = Mock(return_value=response)
            response.__exit__ = Mock(return_value=False)
            with patch.object(monitor.urllib.request, "urlopen", return_value=response):
                self.assertTrue(monitor.connection_probe())
                sender.assert_not_called()
                self.assertTrue(monitor.connection_probe())
            self.assertEqual(sender.call_count, 2)
            self.assertEqual(sender.call_args_list[0].args[0], "outage")
            self.assertEqual(sender.call_args_list[1].args[0], "restored")
            with monitor.db() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) FROM alert_events WHERE sent IS NULL").fetchone()[0], 0)

    def test_outage_notifications_disabled_by_preference(self):
        with monitor.db() as con:
            con.execute("UPDATE settings SET value='0' WHERE key='alert_outage'")
        with patch.object(monitor, "NTFY_URL", "https://ntfy.sh/a-long-private-topic"), \
             patch.object(monitor.urllib.request, "urlopen", side_effect=OSError("offline")):
            monitor.connection_probe()
            monitor.connection_probe()
        with monitor.db() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0], 0)

    def test_failed_delivery_stays_queued_for_retry(self):
        with patch.object(monitor, "NTFY_URL", "https://ntfy.sh/a-long-private-topic"):
            with monitor.db() as con:
                monitor.queue_alert(con, "outage", "Test outage", "alert_outage")
            with patch.object(monitor, "send_ntfy", side_effect=OSError("unavailable")) as sender:
                monitor.flush_pending_alerts()
                monitor.flush_pending_alerts()
            sender.assert_called_once()
            with monitor.db() as con:
                row = con.execute("SELECT sent,attempts,last_attempt FROM alert_events").fetchone()
                self.assertIsNone(row["sent"])
                self.assertEqual(row["attempts"], 1)
                self.assertIsNotNone(row["last_attempt"])

    def test_slow_speed_alert_occurs_once_per_episode(self):
        with patch.object(monitor, "NTFY_URL", "https://ntfy.sh/a-long-private-topic"):
            with monitor.db() as con:
                con.execute("UPDATE settings SET value='1' WHERE key='alert_slow'")
            monitor.monitor_slow_speed(55)
            monitor.monitor_slow_speed(60)
            with monitor.db() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0], 1)
            monitor.monitor_slow_speed(180)
            monitor.monitor_slow_speed(70)
            with monitor.db() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0], 2)

    def test_test_notification_sends_without_storing_secret(self):
        with patch.object(monitor, "NTFY_URL", "https://ntfy.sh/a-long-private-topic"), \
             patch.object(monitor, "send_ntfy") as sender:
            response = self.client.post("/api/alerts/test", headers=self.header())
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json["sent"])
            sender.assert_called_once()
            self.assertNotIn("a-long-private-topic", str(self.client.get("/api/status").json))


if __name__ == "__main__":
    unittest.main()
