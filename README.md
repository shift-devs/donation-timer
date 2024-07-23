# Donation Timer

A timer controlled by Twitch / Streamlabs donations. It is intended for use in subathons.

# Preparations

* Clone / Download the repository.
* Inside of the `docker` directory, create a copy of `.env_template`, and rename it to `.env`
* Create a [Twitch Application](https://dev.twitch.tv/console)
* Edit the `.env` file to use your new Twitch Application's Client ID.
    * If in production, change the URLs to point to your internet accessible domain, and use HTTPS / WSS.
* Add an OAuth Redirect URL to your Twitch Application, and set it to the value that's in `VITE_REDIRECT_URL`
* Add your username to the `allowedUsers` array in `back/src/index.ts:17`

# Use in Production Environments

* Start with: `docker compose -f docker/pro.yml up`
* Set up a reverse proxy on your domain to the `:3080` (frontend) and `:3003` (backend) ports.

# Use in Development Environments

* Start with: `docker compose -f docker/dev.yml up`
* Access the timer: http://localhost:3080
* Access the backend: http://localhost:3003
* Access the database: http://localhost:5432

In comparison, the development environment uses Volumes and Vite without building.
This should allow you to edit the source code without needing to rebuild the images, but it may end up having a slower runtime.