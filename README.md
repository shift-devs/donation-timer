# Donation Timer

A timer controlled by Twitch / Streamlabs donations. It is intended for use in subathons.

## Preparations

1. Install [Git](https://git-scm.com/) and [Docker](https://www.docker.com/products/docker-desktop/)
2. Clone the repository
3. Inside of the `docker` directory, create a copy of `.env_template`, and rename it to `.env`
4. Create a [Twitch Application](https://dev.twitch.tv/console/)
5. Edit the `.env` file to use your new Twitch Application's Client ID
6. Add an "OAuth Redirect URL" to your Twitch Application. Set it to the value that's in `VITE_REDIRECT_URL`
7. Add your username to the `ALLOWED_USERS` array in `back/src/index.ts:17`

> [!NOTE]
> If you're using this in production, you might be changing the URLs in `.env` to point to an internet accessible domain.
> If this is indeed the case, change them to use the HTTPS protocol.

> [!NOTE]
> If you're accessing this locally, but not on the same computer, skip steps 4-6, and leave CLIENT_ID and VITE_CLIENT_ID empty.
> This must be done because Twitch Applications only allow OAuth HTTP redirects to localhost. 

## Updating

Deploy the latest code to the server (podman + systemd, the `donationtimer` user unit): run
`./update.sh` in the repo root. It stops the stack, pulls, refreshes the watchdog, and starts it
again (migrations and `npm install` run on startup).

> [!WARNING]
> `update.sh` restarts the stack, so there's a short downtime — run it between streams, not during one.

## Auto-Restart (Podman + systemd)

`./update.sh` also installs a watchdog (`systemd/install-watchdog.sh`, safe to rerun by hand) that keeps the stack up:

- systemd restarts the `donationtimer` unit if the compose process dies (`Restart=on-failure` drop-in)
- a user timer probes ports `3003`/`3080` every minute and restarts the unit if the app stops
  answering for 3 checks in a row — this also catches a wedged stack that systemd still sees as running
- a unit stuck in the `failed` state is reset and started again
- login lingering is enabled so everything keeps running after logout/reboot

A manual `systemctl --user stop donationtimer` (or `stop.bat`) is respected — the watchdog never
starts a unit that was stopped on purpose. New starts get a 10 minute grace window before probing,
since `npm install` on first boot can be slow. Watch it work with:
`journalctl --user -u donationtimer-watchdog -f`

## Starting in Development Environments

> The development environment uses Docker Volumes and Vite without building.\
> This will allow you to make edits to the source code without needing to rebuild the images.\
> However, this may result in much slower startup times.

From the repo root (needs a `.env` there — copy `docker/.env_template`):

```
docker compose up        # start everything
docker compose down      # stop
```

The root `compose.yaml` just includes `docker/dev.yml`, so it's the same stack and shares the
`pgdata` volume. To wipe the local dev database and start fresh, use `docker/lscripts/reset-db.sh`
(or `docker/wscripts/reset-db.bat`).

## Using the Timer
- You can access the timer at: http://localhost:3080
- The WebSocket backend is served on the same port at `/ws` (also directly on port `3003` in the Development Environment)
- You can access the PostgreSQL database on port `5432` (Development Environment Only)