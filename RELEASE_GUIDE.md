# First public beta: Gibson's Broadband Monitor

This is a **ready-to-publish source release**, not an already published image.

## The simplest path on a Mac

1. Download and unzip the project.
2. Install GitHub CLI if needed: `brew install gh` (requires Homebrew).
3. Sign into your GitHub account: `gh auth login`.
4. Make sure Git is configured to identify your commits:
   `git config --global user.name "Glen Gibson"` and
   `git config --global user.email "YOUR_GITHUB_EMAIL"` (use your actual email).
5. From inside the unzipped folder run: `./scripts/publish-with-gh.sh`.
6. In GitHub, open the repository **Actions** tab and verify the **Docker image** build succeeded.
7. Find the new **gibsons-broadband-monitor** package under your GitHub profile/packages and set package visibility to **Public**.

The GitHub Actions workflow publishes images for `linux/amd64` and `linux/arm64` with a tag such as:
`ghcr.io/gibbo1973/gibsons-broadband-monitor:v0.1.0-beta.1`.

## Test on Unraid once the image has built

In Unraid's **Docker → Add Container** form:

- Name: `gibsons-broadband-monitor`
- Repository: `ghcr.io/gibbo1973/gibsons-broadband-monitor:v0.1.0-beta.1`
- Network: `bridge`
- Port: host `8765` → container `8765`
- Path: host `/mnt/user/appdata/gibsons-broadband-monitor` → container `/data` (read/write)
- Environment: `TZ=Europe/London`
- Extra parameters: `--security-opt=no-new-privileges --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID`

The app will be available at `http://192.168.1.191:8765` on the user's existing LAN configuration. Do not expose it directly to the public internet without a password and secure HTTPS proxy.

A full Unraid XML template is included at `unraid/gibsons-broadband-monitor.xml`.

## Public listing

Before submitting to Unraid Community Applications, validate the real image on Unraid: it must start without errors, write to the `/data` mount, survive a restart, produce valid speed readings, and show outages accurately. Then change the image tag in the XML to a stable release if needed and submit the repository using https://ca.unraid.net/submit/new.

## Limitations of this package

Local static code, JavaScript, Python syntax, YAML and XML have been checked. A full Docker image build, live speedtest, GitHub Actions run and Unraid installation have not yet been completed or verified. No repository/package has been created by the packaging process itself.
