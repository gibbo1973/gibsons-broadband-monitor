# Gibson's Broadband Monitor

[![Docker Hub pulls](https://img.shields.io/docker/pulls/gibbo73/gibsons-broadband-monitor?label=Docker%20Hub%20pulls&logo=docker)](https://hub.docker.com/r/gibbo73/gibsons-broadband-monitor)
[![GitHub Container Registry pulls](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Fgibbo1973%2Fgibsons-broadband-monitor&query=downloadCount&label=GitHub%20GHCR%20pulls&logo=github&color=blue)](https://github.com/users/gibbo1973/packages/container/package/gibsons-broadband-monitor)

*Pull counts are tracked separately for Docker Hub and GitHub Container Registry (GHCR). They include image downloads and updates, not unique users or active installations. Counts may be cached; the GHCR badge uses a third-party statistics service and may lag or be temporarily unavailable.*

> [!IMPORTANT]
> **Unraid startup error mentioning `/proc/1/net/dev`?** Go to **Docker → Gibson’s Broadband Monitor → Edit**. Edit the **Host Network Counters** path and select **Apply**.
>
> - **Host Path** `/proc/1/net`
> - **Container Path** `/host/proc/net`
> - **Access Mode** Read Only
>
> Keep your `/data` mapping to preserve your history. You can also remove the old counters mapping to get speed tests and outage tracking running while you leave Server Network Usage disabled. See the [upgrade guide](RELEASE_GUIDE.md#existing-unraid-container-update-the-network-counters-mount).

![Gibson's Broadband Monitor logo](app/static/brand.png)

**Beautiful, lightweight, self-hosted broadband monitoring.** A simple Unraid/Docker dashboard with digital readings, smooth historical speed graphs, latency tracking, real connection checks, unlimited local history and CSV export.

> **Public beta:** The Docker image is published at `ghcr.io/gibbo1973/gibsons-broadband-monitor:latest` and has been tested on Unraid. Community Applications catalogue availability is managed separately by Unraid. This is early software; test speeds against another reference and report issues.

## What's included

- Clean responsive navy dashboard, cyan download and mint upload readings, purple ping readings
- Smooth **monotone curved** time-series charts: no invented peaks, and failed tests break chart lines
- 24h, 7d, 30d, 90d, 1y, all-time and custom date ranges
- Hourly full speed tests by default, powered by [speedtest-go](https://github.com/showwin/speedtest-go) v1.8.3
- Lightweight dual-endpoint HTTPS availability tests every 30 seconds
- Outage start/end detection with two consecutive failures required to begin an event
- Selectable **24h, 7d, 30d, 90d, 1y and all-time uptime/outage totals**, based on recorded connectivity probes and outages that overlap each period
- **Selectable historical statistics (24h to all time):** actual average, minimum and maximum download, upload, ping and jitter across successful measurements
- **Server Network Usage:** full-size dashboard with downloaded/uploaded/total bytes, daily or monthly traffic graphs, month-to-date and observed daily averages, selected physical/bridge interface, and optional visual monthly usage warning; read-only host counter mount required
- Optional **ntfy phone alerts** for connection outages, restorations and slow download speeds; queued while offline and sent on reconnection
- SQLite storage in `/data`, with no automatic deletion
- Recent test and outage tables; export all speed-test results as CSV
- Adjustable test interval and low-speed warning threshold from the UI
- Optional password for dashboard access; no external account or analytics service
- Dashboard and sign-in screen localized in **16 languages**, with automatic browser detection and a manual language selector
- Square-cropped app icon derived from the original brand graphic (original proportions preserved; no stretching)

**Requirements:** Docker (or Unraid with Docker), internet connectivity, and storage for the SQLite database. Builds for amd64 and arm64 with the supplied Dockerfile.

## Languages

Version **0.2.0-beta.1** supports **16 interface languages**:

English, French, German, Spanish, Italian, Dutch, Portuguese, Polish, Japanese, Simplified Chinese, Traditional Chinese, Swedish, Korean, Arabic, Danish and Norwegian Bokmål.

- The dashboard opens in the user's preferred **browser language**, falling back to English for unsupported languages.
- Users can choose a language manually under **Settings → Language** or on the password sign-in page. This preference is saved in the browser, not in the monitoring database.
- Dates, times and relative-time labels follow the selected language.
- All interface translation files are bundled locally in the same Docker image. No internet translation API, additional container, or third-party frontend dependency is needed.
- The application name **Gibson's Broadband Monitor** stays the same in every language. The Unraid Community Applications listing uses a separate template and may continue to appear in English.

Translations are maintained in `app/static/locales/`. Please report any wording or layout issues in GitHub Issues, particularly for languages that read right-to-left.

## Other installation platforms

Docker Hub publishing and CasaOS/ZimaOS and Runtipi packages are described in the [platform guide](PLATFORMS.md). Catalogue review and Docker Hub account setup are separate from the existing Unraid installation.

## Install on Unraid (prebuilt image)

Use the Unraid **Docker > Add Container** interface (no local image build required), or import the prepared template in `unraid/gibsons-broadband-monitor.xml`.

- **Name:** `gibsons-broadband-monitor`
- **Repository:** `ghcr.io/gibbo1973/gibsons-broadband-monitor:latest`
- **Network:** `bridge`; **Privileged:** off
- **Port:** host `8765` -> container `8765/tcp`
- **Persistent app data:** host `/mnt/user/appdata/gibsons-broadband-monitor` -> container `/data` (read/write)
- **Host network directory:** host `/proc/1/net` → container `/host/proc/net` (**read-only**, required for host-wide traffic logging)
- **Environment:** `TZ=Europe/London` (change timezone as appropriate)
- **WebUI:** `http://[IP]:[PORT:8765]/`

Open `http://YOUR-UNRAID-IP:8765`. The first speed test runs soon after startup. Graphs build up with actual test history. A different free **host** port can be used if 8765 is occupied.

For any public or remote access, set `DASHBOARD_PASSWORD` and a long random `SECRET_KEY`, and use HTTPS through a secure reverse proxy. Keep the dashboard on a trusted private network by default.

Update the image through Unraid Docker's **Check for Updates**. The `/data` mapping preserves measurements across container updates. Do not delete the appdata directory unless you intend to delete recorded results.

**Existing Unraid installations:** Version 0.4.1 uses a read-only directory mount for **Server Network Usage**. Updating the image alone leaves existing container paths in place. In **Unraid → Docker → Edit**, replace the old `/proc/1/net/dev` → `/host/proc/net/dev` mapping with host `/proc/1/net` → container `/host/proc/net` and set the access mode to **Read Only**. If there is no existing counters mapping, choose **Add another Path**. Keep the existing `/data` mapping and bridge networking, then select **Apply**.

## Alerts and notifications (optional)

Version **0.3.0-beta.1** adds optional phone notifications through [ntfy](https://ntfy.sh/), an open-source push notification service. Notifications are **disabled until you configure an ntfy topic URL**.

1. Install the **ntfy** mobile app, or use a trusted self-hosted ntfy server.
2. Create a long, difficult-to-guess topic name or use an authenticated self-hosted topic. Public ntfy topics are not private merely because their names are obscure.
3. In Unraid, go to **Docker → Gibson's Broadband Monitor → Edit**, switch to advanced view if necessary, and add an **environment variable**:
   - Name: `ALERT_NTFY_URL`
   - Value: `https://ntfy.sh/YOUR-LONG-UNIQUE-TOPIC` (or your self-hosted ntfy topic URL)
4. Apply the container change, open the dashboard, and visit **Settings → Notifications**.
5. Choose outage, restoration and/or slow-speed alerts, save settings, and use **Send test notification**. Subscribe to that same topic in the ntfy mobile app.

The URL is read only from the container's environment and is **not returned by the dashboard API**. Use HTTPS for notification transport. The app does not store any credentials in the monitoring database.

**Important:** A broadband outage also prevents the server from reaching internet notification services. The app **queues outage notifications locally** and delivers them **after two successful connectivity checks** once service returns. Do not rely on these delayed notifications for safety-critical or time-sensitive outage detection. Notifications are retried after failed delivery; queue records remain in the local SQLite database.

Slow-speed alerts trigger once when a successful speed test falls below the threshold configured in Settings, and re-arm after a normal-speed result. They are disabled by default; outage and recovery alerts are enabled by default once a topic URL is configured.

## Statistics

The dashboard's **Connection statistics** section supports **24 hours, 7 days, 30 days, 90 days, 1 year (rolling 365 days), and all time**, with 30 days selected by default. It shows arithmetic averages and recorded minima/maxima for download, upload, ping and jitter using successful tests; missing readings appear as dashes. These are actual measurements, not estimated speeds. The statistics area also updates the **uptime percentage and number of outages** at the top of the overview for the selected period (outages include those overlapping the period, even if they began earlier). Uptime is the proportion of successful HTTP connectivity probes among recorded checks, **not an ICMP packet-loss measurement or time-weighted SLA guarantee**. When less than a year's history exists, the 1-year and all-time views use only the measurements actually collected and display the date of the oldest test in the period.

## Server Network Usage (v0.4.0-beta.1)

The **Network usage** tab uses the same dark navy layout as the rest of the dashboard and shows real bytes received (**downloaded**) and transmitted (**uploaded**) by **one selected host network interface**. Choose **Auto** (prefers Unraid's `br0`, then `bond0`, then `eth0`) or select another interface. The interface selection and monthly warning level are stored locally in `/data/monitor.sqlite3`.

- **Graph and totals:** 24 hours (hourly buckets), 7/30/90 days (daily buckets), one rolling year or all time (monthly buckets), plus CSV export of actual recorded buckets.
- **Sampling:** readings every 60 seconds from `/host/proc/net/dev` inside the read-only host directory mount. Counter differences are retained in SQLite. Reboots, counter resets and monitoring gaps longer than 210 seconds start a fresh baseline rather than inventing usage. The first sample establishes a baseline, so meaningful totals start after the next sample. Data is not backfilled.
- **Monthly totals:** current UTC calendar month, plus average daily transfer after at least 24 hours of actively observed sample intervals (the dashboard shows a collecting state until then, rather than extrapolating a daily rate from the first few minutes). You can set an optional monthly warning level in GB (0 to disable); a progress bar highlights the threshold. This is an **in-dashboard warning**, not a phone notification.
- **Scope:** server network traffic (including SMB/NFS LAN file copies, Docker traffic and internet transfers), **not whole-home internet usage or an ISP billing meter**. For accurate totals, use **one** host interface; summing a bridge and its underlying physical interface can double-count traffic.
- **Security:** the read-only mount exposes the host procfs network directory to the container. The app reads only its `dev` counters file. It requires no Docker socket, privilege escalation, host networking, router credentials or external account. Without the mount, the dashboard marks host-usage logging as unavailable.

## Screenshots

Current overview screenshots are referenced by the Unraid Community Apps XML template. A new screenshot of the Network Usage tab can be added after the feature is deployed to a running Unraid server.

## Docker Compose install

If Docker Compose is available on your host, from the project folder:

```sh
docker compose up -d --build
```

Compose persists the database in the Docker named volume `gbm-data`. Do not delete that volume if you want to retain historical data. This Compose example is for a local/LAN installation; set a dashboard password before remote access.

## Application configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8765` | App listening port (Docker image starts Waitress on 8765) |
| `DATA_DIR` | `/data` | Persistent SQLite directory |
| `HOST_NET_DEV` | `/host/proc/net/dev` | Path inside the container to the host interface counters file |
| `SPEED_INTERVAL_MINUTES` | `60` | Initial full speed-test interval (min 15, max 1440) |
| `PROBE_INTERVAL_SECONDS` | `30` | Initial availability-test interval (min 15, max 3600) |
| `SLOW_DOWNLOAD_MBPS` | `100` | Initial low-speed flag, editable in UI |
| `SPEEDTEST_SERVER_ID` | blank | Optional numerical speedtest.net server ID |
| `DASHBOARD_PASSWORD` | blank | Password protection for the dashboard/API |
| `SECRET_KEY` | random per start | Session cookie signing secret, recommended when password is set |
| `TZ` | `Europe/London` | Container timezone; displayed dates use the browser's local timezone |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

UI changes are saved in SQLite and override the initial defaults. An already scheduled test may run once at its previous interval after you save new settings.

## How outages are measured

Each connectivity check attempts Google's `generate_204` HTTPS endpoint, then Cloudflare's diagnostic endpoint. If **both** are unreachable, that probe fails. Two consecutive failures open an outage event, and two consecutive successes close it. This reduces false alarms but isn't proof that your ISP itself was at fault: DNS, upstream services, or the monitor's host may be responsible.

The *ping* digital reading comes from the speedtest server and is different from the lightweight HTTPS probe response time. Tests use real traffic; frequent tests can consume a lot of data and temporarily affect other internet users. The recorded performance belongs to the selected third-party test server and can differ from the broadband line's nominal speed.

## Development & tests

```sh
python -m pip install -r requirements.txt
DISABLE_SCHEDULER=1 python -m unittest discover -s tests -v
node --check app/static/app.js
```

The `--json` output from `speedtest-go` includes `servers[0].dl_speed` and `.ul_speed` as bytes/second and `latency`/`jitter` in nanoseconds; the application converts them to Mbps and milliseconds. These are checked in tests with documented fixture-shaped records.

### Community Applications status

The source code is public, the image is built and public, and the Unraid template is prepared. The app has been tested on an Unraid server, but is **not yet listed in Community Applications**. The maintainer can submit the repository URL at [Unraid Community Apps submission](https://ca.unraid.net/submit/new), choose **Validate** then **Scan**, and complete the review. Listing approval is managed by Unraid; an image published on GHCR is not automatically listed.

The app is still a beta. Planned features include optional notifications, richer reporting and data import. Contributions and issue reports are welcome.

## Credits and licences

Gibson's Broadband Monitor is MIT licensed (see `LICENSE`). The broadband testing engine is the independent MIT-licensed [showwin/speedtest-go](https://github.com/showwin/speedtest-go), built from upstream during the Docker build. Flask and Waitress retain their respective licences. No third-party runtime CDN is needed for the dashboard.

