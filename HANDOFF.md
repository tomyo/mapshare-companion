# MapShare Companion handoff

Last updated: 2026-07-18

## Purpose

MapShare Companion is a standalone Vercel webapp for support crews following racers who publish a Garmin MapShare page. It works with any public `https://share.garmin.com/<mapshare-name>` page.

Primary production URL:

```text
https://mapshare-companion.vercel.app/
https://mapshare-companion.vercel.app/nhayes
https://mapshare-companion.vercel.app/?map=nhayes
https://mapshare-companion.vercel.app/race/transcapixaba-2026
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
- The manifest includes a POST Web Share Target at `/share-target`. Sharing a Garmin URL to the installed PWA passes `url`/`text`; sharing a KML file passes a `kml` file. `public/sw.js` stores shared data in Cache API and redirects to `/?share-target=1`; `public/app.js` imports KML and/or extracts the MapShare name.
- Directly hijacking normal `https://share.garmin.com/...` link clicks is not possible without Garmin/origin association; use Web Share Target instead.
- External map links are contextual popup actions, not fixed toolbar buttons. Google Maps links use point search (`/maps/search/?api=1&query=lat,lon`), not directions/navigation.
- Base map preference is stored in `localStorage` under `garminRaceTracker.baseMap`; valid values are `street` and `topo`. Topo uses OpenTopoMap public tiles.
- Imported KML is stored in `localStorage` under `garminRaceTracker.importedKml`, rendered as an independent map layer, and toggled from the action row. KML can be imported from the menu, Android/browser share target, and supported File Handling API launches.
- Garmin/source features are separate from imported KML. If source features are detected, the top-right menu shows `Hide/Show Garmin features`; its visibility preference is stored under `garminRaceTracker.sourceFeaturesVisible`.
- Flymaster group mode is available at `/race/flymaster/<group-id>` (for example `/race/flymaster/7801`). It connects directly to Flymaster's public live WebSocket (`wss://lb.flymaster.net:8081`), decodes MessagePack via Flymaster's `msgpack.min.js`, and normalizes `pilot_list`/`tick` messages into the existing multi-racer race position shape. Sheet race mode can also read `Config.FlymasterGroup` and map live Flymaster positions into roster racers by `Racers.FlymasterId`. In race mode, Flymaster task JSON (`/api/flymaster?type=task&task=<tk>`) is the race path/turnpoint source; Garmin source features are only loaded in solo mode.
- The top-right `⋮` tracker menu currently has `Enter/Exit race`, `Import KML`, conditional `Hide/Show Garmin features`, and `Change racer`; Change racer clears the saved `localStorage` racer and navigates back to `/`. Enter race opens `/race/transcapixaba-2026`; Exit race returns to the saved solo racer or `/`.
- Explicit single-racer targets auto-start:
  - `/<mapshare-name>`
  - `?map=<mapshare-name>`
- Hardcoded race routes auto-start:
  - `/race/transcapixaba-2026`
- Google Sheet race rosters load with `?sheet=<google-sheet-id-or-url>&gid=<gid>`. Preferred layout is a `Config` tab (`RaceName`, `RaceStart`, `RaceEnd`, `RaceTimezone`, `FlymasterGroup`) plus a `Racers` tab. `RaceStart`/`RaceEnd` without an explicit UTC offset are interpreted in `RaceTimezone` (default `America/Sao_Paulo`). The first row of `Racers` is treated as headers. Expected columns are a racer name column (`Name`, `Racer`, `Pilot`, etc.) plus source columns such as `GarminLink`, `SPOT`, `SpotLink`, `SpotId`, `FlymasterId`, and optional `UseMapFeatures`. Garmin/MapShare, SPOT Public Feed IDs, and Flymaster IDs are actively fetched; unknown source columns are retained on the racer object for future providers.
- In sheet race mode, each racer can have multiple Garmin/SPOT/Flymaster source columns. The app refreshes all supported sources and uses the newest valid position per racer. Flymaster group data is fetched once per race and distributed to source rows by `FlymasterId`. For `/race/transcapixaba-2026`, Garmin MapShare sources backfill KML history for the configured race start/end and cache source history in `localStorage` under `garminRaceTracker.sourceHistory.*` to avoid full history refetches after page refresh. SPOT sources are throttled client-side to ~2.5 minutes per feed. If one racer has `UseMapFeatures=true`/`yes`/`1`/`x`, that racer's first Garmin source is used for Garmin routes/waypoints/history map features.
- The normalized MapShare name is stored in `localStorage` under `garminRaceTracker.mapName`.
- The setup and tracker headers include a small `Donate` link to `https://ko-fi.com/mapsharecompanion`.
- The tracker shows:
  - single racer/Garmin position from public KML or multi-racer Google Sheet roster
  - observer phone GPS location
  - distance and bearing from observer to racer
  - prominent speed/elevation plus GPS fix/last-update metadata; course remains in racer popup/info where available
  - Street/topographic map with racer marker, observer marker, accuracy circle, and connector line
  - Garmin waypoints/routes and KML history/track points when available
  - imported KML points/lines as a source-independent map/course layer
  - quick header refresh button plus controls: Fit all/selected, Racer(s), Me, Street/Topo base map toggle, Hide/Show KML
  - race mode racer markers have subtle always-visible name labels; labels open the racer popup unless measurement mode is active
  - race mode racer popups can Show/Hide that racer's Garmin history track; visible track IDs are stored locally per race under `garminRaceTracker.visibleTracks.<raceId>`
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
api/spot.js            Vercel Edge Function SPOT public feed proxy
api/flymaster.js       Vercel Edge Function Flymaster group/task/trace proxy
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

## Race roster / provider model

The current multi-racer implementation is in `public/app.js` and is provider-shaped with Garmin and SPOT fetchers active.

Important functions/structures:

```text
parseRaceSheetParams()     detects ?sheet=... and /race/transcapixaba-2026
loadRaceFromSheet()        loads Google Sheets gviz JSON and builds race/racers
rowToRacer()               maps one sheet row into { id, name, sources, unsupportedSources }
parseGarminSource()        detects Garmin links/usernames and creates garmin-mapshare sources
parseSpotSource()          detects SPOT feed IDs/shared URLs and creates spot sources
refreshRaceRacers()        refreshes all racers
refreshRaceRacer()         refreshes all supported sources for one racer and chooses newest position
race.position shape        normalized Garmin/SPOT object: lat/lon/ele/speedText/course/utcMs/history/sourceLabel/sourceName/sourceType
```

Sheet columns are treated as source labels. Name columns and metadata columns are reserved; non-empty source columns become either supported `sources[]` or `unsupportedSources[]`.

Current hardcoded race:

```text
/race/transcapixaba-2026
sheet id: 1h-iNS8rby-P8WkEKP98rxMRpEMdOrUjznQxjr9weH8g
gid: 0
```

Garmin links are normalized from forms like:

```text
https://share.garmin.com/<name>
https://share.garmin.com/Feed/Share/<name>
https://share.garmin.com/Feed/ShareLoader/<name>
https://live.garmin.com/<name>
<name>
```

## SPOT source support

Sheet columns such as `SPOT`, `SpotLink`, `SpotId`, or `SPOTLink` can contain a SPOT Public Feed ID or a FindMeSPOT shared/API URL. The browser calls `/api/spot?id=<feed-id>&type=message`, normalizes the latest message into the same position shape as Garmin, keeps message history when available, and selects the newest valid source per racer by `utcMs`.

SPOT polling is throttled client-side to `SPOT_REFRESH_MS` (150 seconds) per feed to follow SPOT's public API guidance.

Potential design note: do not make colors/source preferences part of the shared sheet. Keep racer colors and followed racers client-local.

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
- GitHub repo: `https://github.com/tomyo/mapshare-companion`
- Current branch: `main`; keep semantic commits and push after each completed change.
- Latest known commit before this handoff update: `f5d1b06 fix: make racer labels clickable outside measurement mode`.

## Suggested next steps

1. Verify SPOT behavior in production with the Transcapixaba sheet feeds.
2. Run `npm run check` after any changes.
3. Commit semantically and push to `origin/main`.
4. Deploy with `vercel --prod --yes`, then re-alias if Vercel still aliases production to the legacy name:
   ```bash
   vercel alias set <deployment-url> mapshare-companion.vercel.app
   ```
5. If bookmarklet source changes, run `npm run build` and update the public gist documented in `GIST.md`.
