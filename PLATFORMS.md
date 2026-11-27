# Installation platforms

## Docker Hub

The **Docker Hub mirror** workflow copies an existing stable, tested GHCR image without rebuilding it.
Before the first publish, create a public Docker Hub repository named `gibsons-broadband-monitor`.
In this GitHub repository, set the Actions variable `DOCKERHUB_USERNAME` to the Docker Hub username and the Actions secret `DOCKERHUB_TOKEN` to a Docker Hub token permitted to push that repository.
Never put the token in a file, issue or chat. Run **Actions → Docker Hub mirror → Run workflow**, version `v0.4.1`.
Use `dockerhub/README.md` for the Hub overview and the short description:

> Self-hosted broadband speed, latency, outage and server network usage monitoring.

Future stable GitHub releases trigger the mirror automatically. GHCR publishing remains independent.
No Docker Hub listing is implied until the mirror workflow has succeeded and public tags are visible.

## CasaOS / ZimaOS

Package: [`casaos/Apps/GibsonsBroadbandMonitor/docker-compose.yml`](casaos/Apps/GibsonsBroadbandMonitor/docker-compose.yml).
Import the Compose file through the platform's custom installation interface. Its default data path is `/DATA/AppData/$AppID/data`; the platform resolves `$AppID`. Confirm that the displayed path is a dedicated directory before installing.
The default web port is 8765; change the host port if already in use. Configure a dashboard password before remote use.
Submitted to the official ZimaOS store: [IceWhaleTech/CasaOS-AppStore #1188](https://github.com/IceWhaleTech/CasaOS-AppStore/pull/1188). The submission is open; it is not an approved catalogue listing.

## Runtipi community store

The official store is currently closed to new applications. This repository provides the supported community-store structure under `apps/`.
In Runtipi 4.5 or newer, use **Settings → App Stores → Add App Store**, with:

```text
https://github.com/gibbo1973/gibsons-broadband-monitor
```

Name it **Gibson's Broadband Monitor**, then select the app from that store.
Choose a dashboard password; Runtipi creates the session secret. App data stays under `${APP_DATA_DIR}/data`.
The package uses native Compose with `x-runtipi` metadata (schema version 2).

## Host counters and existing data

Both packages bind `/proc/1/net` read-only to `/host/proc/net`. This requires a Linux Docker host with that procfs directory available; the app reads its `dev` file. Do not change `HOST_NET_DEV` to a directory.
Monitoring covers one chosen host interface, including LAN traffic. Wait for two samples to see counter differences.

Each platform has its own data directory. These packages do not migrate, replace or reset an existing Unraid installation. To migrate deliberately, stop the source container and back up its complete appdata first; preserve the database and SQLite journal files together. Keep the source intact until the destination history has been checked.

## Validation scope

The distribution workflow checks metadata and Compose configuration, starts each package in Linux Docker, verifies health and host counter availability, and checks that seeded speed history and saved settings survive recreation. Store UI installation still needs validation on the target platform; passing these checks does not claim a completed CasaOS, ZimaOS or Runtipi UI install.

## TrueNAS SCALE

Source package: `platforms/truenas/ix-dev/community/gibsons-broadband-monitor`.
Official submission: [truenas/apps #6723](https://github.com/truenas/apps/pull/6723), currently a draft.
Requires TrueNAS SCALE 24.10.2.2 or newer. During installation select dedicated persistent storage, a dashboard password and a stable session secret. Host traffic counters are optional and disabled by default.

Official metadata and question schemas, library hash and two template/portal scenarios pass. Actual TrueNAS deployment, restart and persistence remain unverified. The expected icon CDN URL awaits maintainer upload from the source artwork linked in the PR.

## Umbrel

Source package: `platforms/umbrel/gibsons-broadband-monitor`.
Official submission: [getumbrel/umbrel-apps #6438](https://github.com/getumbrel/umbrel-apps/pull/6438), currently a draft.
Uses port 8766, Umbrel authentication, a per-install app password and session secret, and dedicated persistent SQLite storage. The image is pinned to the public v0.4.1 multi-architecture index.

Official lint with image checks passes with zero errors and three intentional warnings for the read-only host-counter mount, required startup capabilities and no-new-privileges setting; reasons are recorded in the PR. Installation, HTTPS, browser launch, restart and persistence through Umbrel's lifecycle remain unverified.

## YunoHost

A native package using the official example_ynh structure is prepared on the [`packaging/yunohost` branch](https://github.com/gibbo1973/gibsons-broadband-monitor/tree/packaging/yunohost). It uses a dedicated system user, Python virtual environment, systemd, nginx and YunoHost SSO, rather than Docker.

Manifest and test-definition schemas, shell syntax, the app source checksum and both upstream speedtest-go Linux binary checksums pass. Full YunoHost lifecycle testing is pending. The official catalogue requires a dedicated repository named `gibsons_broadband_monitor_ynh` before a catalogue entry can be submitted. This branch is prepared source, not a submitted or approved catalogue app.

## Synology and QNAP

The existing Linux amd64/arm64 image can be used with supported Container Manager or Container Station models, but container availability is separate from a native official Package Center/App Center listing. Synology requires developer onboarding and package verification; QNAP requires a signed-in developer account and package verification. No native SPK/QPKG validation or official listing is claimed.
