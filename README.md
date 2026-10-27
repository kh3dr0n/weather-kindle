# weather-kindle

Shows the Weather Underground 10-day forecast graph (`.ten-day-frame`) on a
jailbroken Kindle (11th gen 2024, FW 5.18.3), refreshed every 30 minutes.

## Server (home server, Docker)

```sh
cd server
docker compose up -d --build
curl -s http://localhost:8080/health       # last render status
open  http://localhost:8080/weather.png    # the image the Kindle downloads
curl -s http://localhost:8080/refresh      # force a re-render
```

Environment (see `docker-compose.yml`): `WU_URL`, `SELECTOR`, `REFRESH_MINUTES`,
`ROTATE` (90 = graph rotated to fill the portrait screen, 0 = unrotated),
`SCREEN_W`/`SCREEN_H` (default 1072x1448).

On Proxmox: run it in an LXC/VM that has Docker, same commands.

## Kindle (needs KUAL)

1. Edit `kindle/extensions/weathergraph/weathergraph.conf` and set `SERVER_URL`
   to your server's LAN IP.
2. Connect the Kindle over USB and copy `kindle/extensions/weathergraph` to
   `extensions/weathergraph` on the Kindle drive.
3. Open KUAL → Weather Graph → Start.

Menu: **Start** (loop every `INTERVAL_MIN` minutes), **Refresh now**, **Stop**
(restores screensaver and status bar). Logs: `/tmp/weathergraph.log`.

While running, the screensaver is disabled so WiFi stays up; expect the battery
to last roughly a day or two. Keep it on the charger for a permanent display.
Uses `fbink` if installed, otherwise the built-in `eips`.
