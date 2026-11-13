# Gibson's Broadband Monitor

![Gibson's Broadband Monitor logo](app/static/brand.png)

**Beautiful, lightweight, self-hosted broadband monitoring.** A simple Unraid/Docker dashboard with digital readings, smooth historical speed graphs, latency tracking, real connection checks, unlimited local history and CSV export.

> **v0.1.0-beta.1 — source package.** The app is not yet published to a Docker registry or Unraid Community Applications. Test locally and review any speedtest measurement differences before releasing publicly.

## What's included

- Clean responsive navy dashboard, cyan download and mint upload readings, purple ping readings
- Smooth **monotone curved** time-series charts: no invented peaks, and failed tests break chart lines
- 24h, 7d, 30d, 90d, 1y, all-time and custom date ranges
- Hourly full speed tests by default, powered by [speedtest-go](https://github.com/showwin/speedtest-go) v1.8.3
- Lightweight dual-endpoint HTTPS availability tests every 30 seconds
- Outage start/end detection with two consecutive failures required to begin an event
- 30-day uptime and outage totals (based on probe samples)
- SQLite storage in `/data`, with no automatic deletion
- Recent test and outage tables; export all speed-test results as CSV
- Adjustable test interval and low-speed warning threshold from the UI
- Optional password for dashboard access; no external account or analytics service
- Separate icon.svg/icon.png for small icons and original chosen brand graphic in `brand.png`

**Requirements:** Docker (or Unraid with Docker), internet connectivity, and storage for the SQLite database. Builds for amd64 and arm64 with the supplied Dockerfile.

## First install on Unraid — from this source package

Because the image isn't on Docker Hub/GHCR yet, you must **build it once** from the extracted source. On Unraid, put the extracted `gibsons-broadband-monitor` folder somewhere persistent, e.g. `/mnt/user/appdata/gbm-source`, then open the Unraid terminal:

```sh
cd /mnt/user/appdata/gbm-source
docker build -t gibsons-broadband-monitor:local .
docker run -d \
  --name gibsons-broadband-monitor \
  --restart unless-stopped \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add SETUID \
  --cap-add SETGID \
  -p 8765:8765 \
  -v /mnt/user/appdata/gibsons-broadband-monitor:/data \
  -e TZ=Europe/London \
  -e SPEED_INTERVAL_MINUTES=60 \
  -e PROBE_INTERVAL_SECONDS=30 \
  gibsons-broadband-monitor:local
```

Open **`http://YOUR-UNRAID-IP:8765`** in your browser. It begins availability testing immediately and attempts its first speed test shortly after startup. The graphs start blank and build up with real data.

The host port `8765` is a suggested default. If another container already uses it, change the **left-hand** side of `-p 8765:8765` to another free port.

For optional password access, add these environment variables to the `docker run` command **before starting** the container:

```sh
-e DASHBOARD_PASSWORD='your-own-long-password' \
-e SECRET_KEY='your-own-long-random-secret' \
```

Keep the password and signing key private. Use HTTPS and a secure reverse proxy for external access. Do not expose an unauthenticated dashboard directly to the public internet.

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

### Repository / public release steps

1. Upload these files to a public GitHub repository named `gibsons-broadband-monitor` (MIT project licence).
2. The Unraid XML and Community Applications profile have been prepared for the GitHub account `gibbo1973`.
3. Create a version tag (e.g. `v0.1.0-beta.1`) to run the supplied GitHub Actions multi-architecture build and push to `ghcr.io/gibbo1973/gibsons-broadband-monitor`. Make the GHCR package public.
4. Confirm the actual Docker image boots, stores data across restarts, plots actual results and records genuine outages on an Unraid test server.
5. After making the image public, submit the repository with its Unraid XML and `ca_profile.xml` according to the [Unraid Community Applications submission guide](https://ca.unraid.net/submit/help/repository-xml).

The Unraid template includes the intended `gibbo1973` links, but it is a **draft until the public registry image exists and has been tested**. It cannot be installed from Community Applications yet.

## Project status

Initial beta prototype. Before sharing publicly, verify the GitHub Actions multi-platform image build and test a running container. Planned improvements: optional notifications, data import, advanced server comparison, and exportable monthly reports. Contributions and issues will be welcome once the repository is published.

## Credits and licences

Gibson's Broadband Monitor is MIT licensed (see `LICENSE`). The broadband testing engine is the independent MIT-licensed [showwin/speedtest-go](https://github.com/showwin/speedtest-go), built from upstream during the Docker build. Flask and Waitress retain their respective licences. No third-party runtime CDN is needed for the dashboard.

## Fast publication via GitHub CLI

The intended GitHub account is `gibbo1973`. From a Mac with Git and GitHub CLI installed and authenticated run:

```sh
cd gibsons-broadband-monitor
./scripts/publish-with-gh.sh
```

This publishes the **source code publicly** and pushes a beta tag, which should
trigger the included GitHub Actions image build. The workflow does **not** make
the GHCR package public automatically; you must change the package's visibility
under its GitHub package settings once the build has succeeded. Do **not** submit
to Unraid Community Applications until the built image has been installed and
tested successfully.
