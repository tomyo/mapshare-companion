# MapShare Companion handoff

Last updated: 2026-07-15

## Purpose

MapShare Companion is a standalone Vercel webapp for support crews following racers who publish a Garmin MapShare page. It works with any public `https://share.garmin.com/<mapshare-name>` page.

Primary production URL:

```text
https://mapshare-companion.vercel.app/
https://mapshare-companion.vercel.app/nhayes
https://mapshare-companion.vercel.app/?map=nhayes
```

Public Garmin test target:

```text
https://share.garmin.com/nhayes
```

## UX / behavior spec

- Root `/` shows a setup form asking for either:
  - Garmin MapShare username, e.g. `nhayes`
  - Shared Garmin URL, e.g. `https://share.garmin.com/nhayes`
- Root `/` auto-redirects to the saved racer when `localStorage` has a valid saved MapShare name.
- If there is no saved racer, root `/` shows the setup form.
- Submitting the root form stores the normalized name in `localStorage` and redirects to `/<mapshare-name>` so the page can be bookmarked/installed standalone.
- The app is installable as a PWA via `public/manifest.webmanifest`, icons in `public/icons/`, and `public/sw.js`. Manifest `start_url` is `/?launch=1`; if `localStorage` has a saved racer, `public/app.js` redirects to `/<mapshare-name>` on launch.
- The manifest includes a Web Share Target. Sharing a Garmin URL to the installed PWA passes `?url=...` or `?text=...`; `public/app.js` extracts the MapShare name and redirects to `/<mapshare-name>`.
- Directly hijacking normal `https://share.garmin.com/...` link clicks is not possible without Garmin/origin association; use Web Share Target instead.
- External map links are contextual popup actions, not fixed toolbar buttons. Google Maps links use point search (`/maps/search/?api=1&query=lat,lon`), not directions/navigation.
- Base map preference is stored in `localStorage` under `garminRaceTracker.baseMap`; valid values are `street` and `topo`. Topo uses OpenTopoMap public tiles.
- The top-right `⋮` tracker menu currently has one uncommon action: `Change racer`, which clears the saved `localStorage` racer and navigates back to `/`.
- Explicit targets auto-start:
  - `/<mapshare-name>`
  - `?map=<mapshare-name>`
- The normalized MapShare name is stored in `localStorage` under `garminRaceTracker.mapName`.
- The setup and tracker headers include a small `Donate` link to `https://ko-fi.com/mapsharecompanion`.
- The tracker shows:
  - racer/Garmin position from public KML
  - observer phone GPS location
  - distance and bearing from observer to racer
  - prominent speed/elevation plus GPS fix/last-update metadata; course remains in racer popup/info where available
  - Street/topographic map with racer marker, observer marker, accuracy circle, and connector line
  - waypoints, routes, and KML history/track points when available
  - quick header refresh button plus controls: Fit both, Racer, Me, simple Show/Hide features toggle, Street/Topo base map toggle
  - contextual map popups: tap racer, observer, waypoint, or any map point to open that point in Google Maps or OSM
  - popup action `Measure from here`: enters measuring mode, then map taps update a straight-line distance line/label until the measurement popup is closed or the user clicks outside the map
  - the dotted observer→racer connector includes a subtle permanent distance label in km
- Garmin feed/features auto-refresh every 60 seconds.

## Architecture

```text
public/index.html      Static app shell
public/app.js          Main browser app logic and KML/feature parsing
public/styles.css      Mobile-friendly UI styling
public/manifest.webmanifest  PWA metadata, icons, Web Share Target
public/sw.js           Service worker for install/offline app shell
public/icon.svg        Source icon; PNG icons live in public/icons/
api/garmin.js          Vercel Edge Function Garmin proxy
vercel.json            Rewrites all non-/api paths to /index.html
src/*                  Legacy bookmarklet/userscript code
runtime dist/*         Generated bookmarklet/userscript artifacts
```

Vercel rewrite rule:

```json
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

This allows `/nhayes` to load the app while preserving `/api/garmin`.

## Garmin proxy API

The browser calls the local Vercel API to avoid Garmin CORS:

```text
/api/garmin?name=<mapshare-name>&type=feed
/api/garmin?name=<mapshare-name>&type=waypoints
/api/garmin?name=<mapshare-name>&type=routes
/api/garmin?name=<mapshare-name>&type=collections
```

Upstream Garmin endpoints:

```text
https://share.garmin.com/feed/share/<mapshare-name>
https://share.garmin.com/<mapshare-name>/Waypoints
https://share.garmin.com/<mapshare-name>/routes/
https://share.garmin.com/<mapshare-name>/Collections
```

MapShare names are restricted to `^[A-Za-z0-9_-]{1,100}$`.

## Known limitations / findings

- Imported library track IDs/counts are visible in `/<mapshare-name>/Collections`, but full imported track geometry was not found through simple public JSON endpoints.
- The app draws the blue racer/history track only when points are present in the public KML feed.
- Browser geolocation requires HTTPS and user permission; production Vercel URLs satisfy HTTPS.
- Bookmarklets were unreliable in Chrome mobile, so the Vercel webapp is now primary. Bookmarklet/userscript artifacts remain as legacy fallbacks.

## Commands

Install is not currently necessary beyond Node/Vercel CLI; there are no package dependencies.

Syntax check:

```bash
npm run check
```

Build legacy bookmarklet artifacts:

```bash
npm run build
```

Local Vercel dev server:

```bash
npm run vercel:dev
```

Production deploy:

```bash
npm run deploy
# or: vercel --prod --yes
```

Check deployed pages quickly:

```bash
curl -fsSL https://mapshare-companion.vercel.app/ | rg "MapShare Companion"
curl -fsSL https://mapshare-companion.vercel.app/nhayes | rg "MapShare Companion"
```

Headless root-form verification:

```bash
tmp=$(mktemp -d)
chromium-browser --headless --disable-gpu --no-sandbox --user-data-dir="$tmp" \
  --virtual-time-budget=3000 --dump-dom https://mapshare-companion.vercel.app/ > /tmp/msc-root.dom
rm -rf "$tmp"
rg '<main id="setup" class="setup"|<main id="tracker" class="tracker hidden"|<input id="map-input"' /tmp/msc-root.dom
```

## Vercel project state

Linked project metadata:

```text
projectId: prj_crb19QjnYcul5LmyndokZKPJPAnO
orgId: team_crom7PWZ7Fc3zf1ZQ01LD2Eg
projectName: mapshare-companion
```

Deployment protection as last checked:

```json
{
  "name": "mapshare-companion",
  "ssoProtection": null,
  "gitForkProtection": true
}
```

Important: after aliasing `mapshare-companion.vercel.app`, root initially showed a Vercel login page because SSO deployment protection was enabled. It was disabled with:

```bash
vercel project protection disable mapshare-companion --sso
```

## Current cleanup status

- README, PLAN, GIST, webapp, and legacy bookmarklet source/tooling have been updated to prefer MapShare Companion naming.
- The project directory is `/var/home/tomyo/projects/mapshare-companion`.
- This directory is currently **not a git repository** (`git status` fails), so there is no local commit history/status to preserve here.

## Suggested next steps

1. Run `npm run check` after any changes.
2. If bookmarklet source changes, run `npm run build` and update the public gist documented in `GIST.md`.
