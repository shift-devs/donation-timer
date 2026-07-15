# Future Improvements

Server hygiene backlog from the July 2026 stability investigation (stack dying ~daily on the
Arch/VirtualBox VM, remote access dying with it). Items are grouped by where the work happens.
Context: the VM currently runs `docker/dev.yml` under the `donationtimer` systemd user unit.

## In the repo

4. **Nightly `pg_dump` backup timer** — the timer's end time lives only in the `pgdata` volume;
   dump daily, keep ~7 days.
5. **SSH keys for the plink scripts** — replace the password auth used by `plink-podman/`
   (`.pwfile`, `-pw` flags) with an SSH keypair, remove the credential files from the repo, and
   rotate the VM password. **Must land before/with any switch to a bridged network adapter**, which
   would expose the VM's SSH to the LAN.
6. **Base image updates** — `node:18-alpine` is past end-of-life (no security patches since
   April 2025); bump to `node:22-alpine` with a test pass. `postgres:14.5-alpine` is a 2022 patch
   release; `postgres:14-alpine` is a drop-in within the same major (same data format).

## On the VM (one-time settings)

7. **Run the production stack** — the unit runs `dev.yml` in production: Vite dev server, watch
   mode, and `npm install` on every boot (the reason the watchdog needs a 10-minute grace window).
   `pro.yml` runs built images behind nginx: a fraction of the RAM, boots in seconds, no dependency
   surprises on unattended restarts.
8. **Persistent, capped journal** — `Storage=persistent`, `SystemMaxUse=200M` in
   `/etc/systemd/journald.conf`, so post-mortems survive the reboot that "fixes" an outage.
9. **Time sync** — `systemctl enable --now systemd-timesyncd`. VirtualBox guests drift, especially
   after host sleep, and this product is a wall clock.

## Opt-in automation (state-changing — client should sign off)

10. **Network self-heal timer** — root-level systemd timer: ping the gateway every minute; if dead
    for 3 minutes, bounce the DHCP client/interface; if still dead after 10, reboot the VM. A blunt
    instrument, but a VM reboot demonstrably cures the current failure, so this turns a
    next-morning outage into a ~2-minute blip until the root cause is fixed. Label it clearly and
    make it easy to disable.

## Priority

`5` is a pure win with zero behavior risk; `4` close behind; `6` is small but wants a test pass
first.

## Done already (for context)

- Container log caps (`max-size`) and per-container memory limits in both compose files, image
  pruning in `update.sh`. Note on the memory limits: rootless podman needs cgroup-v2 delegation —
  standard on current Arch, but if containers fail to start after pulling this, that's the first
  thing to check in the diagnostics dump.

- Global crash containment + port-probing watchdog (`266e608`)
- plink `update` restarting the stack again; exec bits on `systemd/*.sh` (`68f080c`)
- Diagnostics collector incl. network + previous-boot evidence (`68f080c`, `d6f9817`)
- HTTP keep-alive on all outbound API calls — ~17k connections/day of NAT churn down to a
  handful of long-lived connections (`b935232`)
