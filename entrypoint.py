"""Prepare a writable Unraid/Docker data mount, then drop privileges.

Docker bind-mounted directories may initially be owned by root even when the
application should run as an unprivileged user. Only our dedicated data paths
are affected. This entrypoint requires CHOWN, SETUID and SETGID capabilities.
"""
import os
import pwd
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 2:
        raise SystemExit('No application command provided')
    app_user = pwd.getpwnam('app')
    uid, gid = app_user.pw_uid, app_user.pw_gid
    data_dir = Path(os.environ.get('DATA_DIR', '/data'))
    data_dir.mkdir(parents=True, exist_ok=True)

    # The application owns this dedicated mount; normalise the directory and
    # SQLite files if they were created by Docker/another container user.
    targets = [data_dir]
    targets.extend(data_dir.glob('monitor.sqlite3*'))
    for path in targets:
        if path.is_symlink():
            raise RuntimeError(f'Refusing symlink in data path: {path}')
        stat = path.stat()
        if (stat.st_uid, stat.st_gid) != (uid, gid):
            os.chown(path, uid, gid)
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == '__main__':
    main()
