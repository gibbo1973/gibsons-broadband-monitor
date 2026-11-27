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
The package is prepared for submission to [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore). A submission is not an approved catalogue listing.

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
