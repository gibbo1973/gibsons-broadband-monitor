"""Isolated API and engine tests; does not perform real internet speed tests."""
import os
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='gibson-monitor-tests-')
os.environ['DISABLE_SCHEDULER'] = '1'
from app import app as module  # noqa: E402

class BroadbandMonitorTests(unittest.TestCase):
    def setUp(self):
        self.client = module.app.test_client()
        with module.db() as con:
            con.execute('DELETE FROM speed_tests')
            con.execute('DELETE FROM probes')
            con.execute('DELETE FROM outages')

    def test_engine_json_units_are_correct(self):
        sample = {'timestamp':'2026-10-13 08:30:15.123', 'servers':[
            {'name':'Test server', 'dl_speed':12500000, 'ul_speed':2500000, 'latency':4500000, 'jitter':300000}]}
        dl, ul, ping, jitter, server = module.parse_speed_result(sample)
        self.assertEqual((dl, ul, ping, jitter, server), (100.0,20.0,4.5,0.3,'Test server'))

    def test_nested_rate_format_supported(self):
        dl, ul, ping, jitter, server = module.parse_speed_result({
            'download':{'bandwidth':12500000}, 'upload':{'bandwidth':2500000},
            'ping':{'latency':5.3}, 'server':{'name':'Example'}})
        self.assertEqual((dl,ul,ping,server),(100,20,5.3,'Example'))

    def test_status_and_history_without_results(self):
        self.assertEqual(self.client.get('/health').status_code,200)
        self.assertEqual(self.client.get('/api/status').status_code,200)
        self.assertEqual(self.client.get('/api/history?period=bad').status_code,400)
        self.assertEqual(self.client.get('/api/history?period=30d').json['points'], [])

    def test_save_settings_requires_expected_header(self):
        res=self.client.post('/api/settings',json={'speed_interval':45})
        self.assertEqual(res.status_code,403)
        res=self.client.post('/api/settings',json={'speed_interval':45},headers={'X-Requested-With':'GibsonsDashboard'})
        self.assertEqual(res.status_code,200)
        self.assertEqual(module.setting('speed_interval', 60),45)
        invalid=self.client.post('/api/settings',json={'speed_interval':1},headers={'X-Requested-With':'GibsonsDashboard'})
        self.assertEqual(invalid.status_code,400)

    def test_failed_speed_test_is_recorded(self):
        output=Mock(returncode=1,stderr='server unavailable',stdout='')
        with patch.object(module.subprocess,'run',return_value=output):
            self.assertTrue(module.run_speedtest())
        rows=self.client.get('/api/results').json['results']
        self.assertEqual(rows[0]['status'],'failed')

    def test_successful_speed_test_is_recorded(self):
        output=Mock(returncode=0,stderr='',stdout='{"servers":[{"name":"Local test","dl_speed":12500000,"ul_speed":2500000,"latency":4500000,"jitter":300000}]}')
        with patch.object(module.subprocess,'run',return_value=output):
            self.assertTrue(module.run_speedtest())
        rows=self.client.get('/api/results').json['results']
        self.assertEqual(rows[0]['status'],'ok')
        self.assertEqual(rows[0]['download'],100.0)

    def test_outage_debounced_and_restored(self):
        with patch.object(module.urllib.request,'urlopen',side_effect=OSError('offline')):
            module.connection_probe()
            module.connection_probe()
        records=self.client.get('/api/outages').json['outages']
        self.assertEqual(len(records),1)
        self.assertIsNone(records[0]['ended'])
        response=MagicMock(status=204)
        response.read.return_value=b''
        response.__enter__=Mock(return_value=response)
        response.__exit__=Mock(return_value=False)
        with patch.object(module.urllib.request,'urlopen',return_value=response):
            module.connection_probe()
            module.connection_probe()
        records=self.client.get('/api/outages').json['outages']
        self.assertIsNotNone(records[0]['ended'])

if __name__=='__main__':
    unittest.main()
