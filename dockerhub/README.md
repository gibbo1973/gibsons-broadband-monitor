# Gibson's Broadband Monitor

Self-hosted broadband speed, latency and reliability monitoring for Linux Docker hosts. Includes scheduled tests, historical graphs, outage tracking, server network usage, CSV exports, optional ntfy notifications and 16 interface languages.

Supports **linux/amd64** and **linux/arm64**. The dashboard listens on port **8765**.

## Install

Use the [Docker Compose installation](https://github.com/gibbo1973/gibsons-broadband-monitor/blob/main/compose.yaml) or the [installation guide](https://github.com/gibbo1973/gibsons-broadband-monitor/blob/main/README.md).

For Docker Hub, select this repository's `v0.4.1` tag in place of the image in the Compose file. Stable releases also have a `latest` tag.

Persist `/data` in a dedicated volume or host directory. Server traffic monitoring uses the read-only mapping `/proc/1/net:/host/proc/net:ro`. The app reads `/host/proc/net/dev` inside that directory. Host traffic includes local transfers and is not a whole-household or ISP billing meter.

Keep the dashboard on your trusted network. Set `DASHBOARD_PASSWORD` and a long random `SECRET_KEY` before remote use, and use HTTPS.

## Upgrades

Keep the existing `/data` volume and its contents. Do not delete the appdata directory or database when updating.
Existing Unraid users must replace the older single-file counters mapping with the directory mapping above.

[Source](https://github.com/gibbo1973/gibsons-broadband-monitor) · [Releases](https://github.com/gibbo1973/gibsons-broadband-monitor/releases) · [Support](https://github.com/gibbo1973/gibsons-broadband-monitor/issues) · [Upgrade guide](https://github.com/gibbo1973/gibsons-broadband-monitor/blob/main/RELEASE_GUIDE.md)

MIT licensed.
