"""Check platform metadata and optionally run both packages in disposable Linux Docker."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

import jsonschema
import yaml

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = (
    ROOT / 'casaos/Apps/GibsonsBroadbandMonitor/docker-compose.yml',
    ROOT / 'apps/gibsons-broadband-monitor/docker-compose.yml',
)


def check_metadata():
    config = json.loads((ROOT / 'apps/gibsons-broadband-monitor/config.json').read_text())
    schema = json.loads((ROOT / 'apps/app-info-schema.json').read_text())
    jsonschema.validate(config, schema)
    for path in PACKAGES:
        compose = yaml.safe_load(path.read_text())
        service = compose['services']['gibsons-broadband-monitor']
        assert service['image'].endswith(':v0.4.1'), path
        mounts = service['volumes']
        host = next(v for v in mounts if isinstance(v, dict) and v['target'] == '/host/proc/net')
        assert host['source'] == '/proc/1/net' and host['read_only'] is True
        assert host['bind']['create_host_path'] is False
        assert not service.get('privileged', False)
        assert service['cap_drop'] == ['ALL']
        assert set(service['cap_add']) == {'CHOWN', 'SETUID', 'SETGID'}
        assert 'no-new-privileges:true' in service['security_opt']
    assert yaml.safe_load(PACKAGES[1].read_text())['x-runtipi']['schema_version'] == 2
    print('Platform metadata, pinned images, persistent mounts and read-only host paths: passed')


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def smoke(path):
    with tempfile.TemporaryDirectory(prefix='gbm-platform-') as tmp:
        tmp = Path(tmp)
        data = tmp / 'data'
        data.mkdir()
        os.environ['DATA_DIR'] = str(data)
        os.environ['DISABLE_SCHEDULER'] = '1'
        sys.path.insert(0, str(ROOT))
        from app import app as monitor
        from unittest.mock import patch
        with patch.object(monitor, 'DB_PATH', data / 'monitor.sqlite3'):
            monitor.initialize()
            with monitor.db() as con:
                con.execute("INSERT INTO speed_tests(ts,download,upload,ping,status) VALUES(?,123,45,6,'ok')", (monitor.now_iso(),))
                con.execute("UPDATE settings SET value='321' WHERE key='slow_threshold'")
        doc = yaml.safe_load(path.read_text())
        service = doc['services']['gibsons-broadband-monitor']
        # Only test-specific host directory, auth, scheduler and port are substituted.
        # The packaged image, entrypoint, capabilities and procfs mount are exercised unchanged.
        service['volumes'][0] = {'type': 'bind', 'source': str(data), 'target': '/data'}
        service['environment'] = {'DISABLE_SCHEDULER': '1', 'TZ': 'UTC', 'DASHBOARD_PASSWORD': ''}
        service['ports'] = ['127.0.0.1::8765']
        compose_path = tmp / 'compose.yml'
        compose_path.write_text(yaml.safe_dump(doc, sort_keys=False))
        project = 'gbm-' + tmp.name.lower()
        cmd = ['docker', 'compose', '-p', project, '-f', str(compose_path)]
        def get_json(route):
            with urllib.request.urlopen(base + route, timeout=5) as response:
                return json.load(response)
        try:
            for attempt in range(2):
                run(*cmd, 'up', '-d', '--wait', '--wait-timeout', '90')
                port = run(*cmd, 'port', 'gibsons-broadband-monitor', '8765', capture_output=True).stdout.strip()
                base = 'http://' + port
                assert get_json('/health') == {'status': 'ok', 'version': '0.4.1'}
                usage = get_json('/api/network/usage')
                assert usage['available'] is True and usage['source'] == 'host', usage
                assert usage['interfaces'], usage
                results = get_json('/api/results')['results']
                assert len(results) == 1 and results[0]['download'] == 123, results
                status = get_json('/api/status')
                assert status['slow_threshold'] == 321, status
                run(*cmd, 'down')
            print(f'{path.relative_to(ROOT)}: startup, host counters and data/settings after recreation passed')
        except BaseException:
            subprocess.run([*cmd, 'logs', '--tail', '80'], check=False)
            raise
        finally:
            subprocess.run([*cmd, 'down'], check=False)
            # The container intentionally owns its dedicated data directory.
            # Tests run on disposable CI storage; return ownership before cleanup.
            subprocess.run(['sudo', 'chown', '-R', f'{os.getuid()}:{os.getgid()}', str(data)], check=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--docker', action='store_true')
    args = parser.parse_args()
    check_metadata()
    if args.docker:
        for package in PACKAGES:
            smoke(package)
