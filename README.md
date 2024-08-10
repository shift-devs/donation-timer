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
> If this is indeed the case, change them to use the HTTPS / WSS protocols.

> [!NOTE]
> If you're accessing this locally, but not on the same computer, skip steps 4-6, and leave CLIENT_ID and VITE_CLIENT_ID empty.
> This must be done because Twitch Applications only allow OAuth HTTP redirects to localhost. 

## Updating

- **Windows:** `docker/wscripts/update.bat`
- **Linux:** `docker/lscripts/update.sh`

## Starting in Production Environments

- **Windows:** `docker/wscripts/pro-start.bat`
- **Linux:** `docker/lscripts/pro-start.sh`
- If internet accessible, reverse proxy on your domain to the `3080` (frontend) and `3003` (backend) ports

## Starting in Development Environments

> The development environment uses Docker Volumes and Vite without building.\
> This will allow you to make edits to the source code without needing to rebuild the images.\
> However, this may result in much slower startup times.

- **Windows:** `docker/wscripts/dev-start.bat`
- **Linux:** `docker/lscripts/dev-start.sh`

## Using the Timer
- You can access the timer at: http://localhost:3080
- You can access the WebSocket backend on port `3003`
- You can access the PostgreSQL database on port `5432` (Development Environment Only)