# Gibson's Broadband Monitor

Track download and upload speeds, latency, outages and server network usage from a private dashboard.

- Scheduled speed tests and connection checks
- Historical charts, CSV export and optional ntfy alerts
- Sixteen interface languages
- SQLite measurements and settings retained in the app's persistent data directory

## Installation

Choose a dashboard password of at least 12 characters. Runtipi generates the session secret.
The web interface listens on port 8765 inside the container; Runtipi supplies routing and the host port.
Requires Runtipi 4.5 or newer on a Linux Docker host (amd64 or arm64).

The read-only `/proc/1/net` → `/host/proc/net` mapping exposes host interface counters.
Select one physical or bridge interface in **Network usage** and allow two samples about a minute apart.
Traffic includes local transfers, containers and internet activity on that interface; this is not an ISP billing meter.

## Updates and data

Keep the existing `${APP_DATA_DIR}/data` → `/data` mapping and its contents. Do not delete app data during updates.
Moving from Unraid requires a separate backed-up database transfer; adding this store does not move an existing installation.

[Source and support](https://github.com/gibbo1973/gibsons-broadband-monitor) · [Upgrade guide](https://github.com/gibbo1973/gibsons-broadband-monitor/blob/main/RELEASE_GUIDE.md)
