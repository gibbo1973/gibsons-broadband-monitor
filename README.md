# Gibson's Broadband Monitor for YunoHost

Native package based on the official example_ynh format (helpers 2.1). Runs Flask/Waitress as a dedicated system user and the upstream speedtest-go 1.8.3 binary; Docker is not used.

Requires a dedicated domain at its root URL and YunoHost 12.1.17 or newer on amd64 or arm64. Access is restricted to YunoHost users by default. The backend listens only on loopback. History is kept in the app data directory; backups use SQLite's online backup API.

**Status: in progress.** Manifest/schema, source checksums and shell syntax can be checked here. Installation, SSO routing, real scheduled tests, restart, upgrade, backup/restore and domain changes require YunoHost package CI and have not been validated on a YunoHost system. Do not treat this as an approved or production-tested catalogue package.

Source: https://github.com/gibbo1973/gibsons-broadband-monitor

Speed tests use internet traffic. Server traffic includes LAN transfers and is not an ISP billing meter. All interface languages are bundled upstream.

Prepared with AI assistance; the package follows the example template and uses helpers verified against YunoHost's source.
