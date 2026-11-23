# Gibson's Broadband Monitor — release and Unraid upgrade guide

This repository publishes Docker images automatically to `ghcr.io/gibbo1973/gibsons-broadband-monitor:latest` when changes are merged into `main`. GitHub Actions publishes both `linux/amd64` and `linux/arm64` and runs backend/browser tests before pushing the image.

## Before saying a release is ready

1. Check **Tests** on the pull request: all checks must pass.
2. Merge the reviewed PR into `main`.
3. Open the **Docker image** workflow in [GitHub Actions](https://github.com/gibbo1973/gibsons-broadband-monitor/actions/workflows/docker-publish.yml). Verify that the newest run is **successful** and built the merged commit. A green test run alone does **not** mean the image has published.
4. Update the container in Unraid through **Docker → Check for Updates**.
5. Confirm the displayed version, that navigation works, that speed history persists, and that the new feature shows valid data.

## Existing Unraid container: update the network counters mount

Version `0.4.1` mounts the host network directory to fix a startup failure some Unraid installations encountered with the previous single-file mount. Unraid keeps the saved path mappings when you update an existing container image.

| Unraid setting | Value |
| --- | --- |
| Network type | `bridge` (unchanged) |
| Image | `ghcr.io/gibbo1973/gibsons-broadband-monitor:latest` |
| Host path | `/proc/1/net` |
| Container path | `/host/proc/net` |
| Access mode | **Read Only** |
| Existing appdata | `/mnt/user/appdata/gibsons-broadband-monitor` → `/data` (preserve) |

Use **Docker → your container → Edit** in Unraid. Replace the old `/proc/1/net/dev` → `/host/proc/net/dev` mapping with the paths above. If no counters mapping exists, choose **Add another Path**. Select **Apply**. The app does not require `host` network mode, the Docker socket, privileged mode or extra kernel capabilities.

The first counter read establishes a baseline. Downloads/uploads appear as differences between subsequent reads. Long pauses, reboots and resets create new baselines, so missing traffic is never estimated.

**Important distinction:** these counters represent **one server network interface**, including local network file transfers, not broadband traffic for an entire household. `br0` is often the appropriate interface on Unraid, but select the interface matching the host's actual connection.

## Other notes

- Changes to the Unraid Community Applications **screenshots, overview or description** are made in `unraid/gibsons-broadband-monitor.xml`. These do not require a new Docker image by themselves.
- Community Apps catalogue review/blacklist status is managed by Unraid, separately from GitHub Docker builds.
- Existing measurements are retained in `/data/monitor.sqlite3`; never delete the appdata mapping or its directory to perform an upgrade.
- Do not expose this dashboard directly to the public internet without `DASHBOARD_PASSWORD` and a secure HTTPS reverse proxy.
