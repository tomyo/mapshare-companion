# MapShare Companion

A support-crew companion webapp for race rosters and solo tracking with public Garmin MapShare or SPOT sources.

The primary deliverable is a standalone Vercel webapp. The launcher can enter the Transcapixaba race mode or start solo tracking from a Garmin MapShare username/link or SPOT feed ID/link. It shows this race-support UX:

- racer location from Garmin public KML feeds or SPOT public feed JSON
- your phone location from browser GPS
- distance and bearing from you to the racer
- racer speed, course, GPS fix, elevation, and last update
- Street/topographic map with both markers and a connecting line
- solo Garmin/SPOT tracking, multi-racer Garmin/SPOT race rosters from Google Sheets, or Flymaster live groups
- Garmin MapShare waypoints and routes from `/<mapshare-name>/Waypoints` and `/<mapshare-name>/routes/`
- any track/history points present in the public KML feed
- quick header refresh button plus controls for Fit both, Racer, Me, Street/Topo map toggle, and Hide/Show KML
- auto-refresh of Garmin data every 60 seconds, with SPOT feeds throttled to roughly 2.5 minutes per feed
- race-mode Garmin MapShare history backfill via date-range KML, cached locally to avoid refetching full history on page refresh
- contextual map popups: tap the racer, a waypoint, your location, or any map point to open that point in Google Maps or OSM
- distance measuring: choose **Measure from here** in any location popup, then tap map points to update a straight-line distance until you close the measuring popup or click outside the map
- subtle distance label on the dotted line between your location and the racer
- remembered base map preference: Street uses OpenStreetMap, Topo uses OpenTopoMap elevation contours
- top-right menu can enter Transcapixaba 2026 race mode from solo mode, or leave race mode back to the launcher
- KML import from the top-right menu or supported Android share/open flows, persisted locally and toggleable from the action row
- Garmin/source features are separate from imported KML; when detected, they can be shown/hidden from the top-right menu
- race mode uses the race name as the app title, hides solo-only actions, and shows subtle racer name labels; racer popups can show/hide each racer's source history track locally

## Why this works

Garmin exposes public KML feeds at:

```text
https://share.garmin.com/feed/share/<mapshare-name>
```

The Vercel app fetches Garmin data through `/api/garmin`, an Edge Function proxy, so Chrome/mobile browsers do not hit Garmin CORS restrictions. Race sheet SPOT sources use `/api/spot` against SPOT Public Feed JSON endpoints.

The older bookmarklet/userscript fallback still runs directly on `share.garmin.com/<mapshare-name>`, infers `<mapshare-name>` from the current URL, and fetches `/feed/share/<mapshare-name>` from the same origin.

## Vercel webapp

Local dev:

```bash
npm run vercel:dev
```

Deploy:

```bash
npm run deploy
```

Production deployment:

```text
https://mapshare-companion.vercel.app/          # launcher: enter race or track solo
https://mapshare-companion.vercel.app/nhayes    # solo Garmin MapShare
https://mapshare-companion.vercel.app/spot/<spot-feed-id>  # solo SPOT
https://mapshare-companion.vercel.app/race/transcapixaba-2026
https://mapshare-companion.vercel.app/?sheet=<google-sheet-id>&gid=0
```

The Google Sheet must be public/readable by link. Race roster columns:

```text
Name | GarminLink | SPOT | GsmLink | FlymasterLink | UseMapFeatures | Notes
```

`GarminLink` / `Garmin` / `MapShare` columns and `SPOT` / `SpotLink` / `SpotId` columns are supported. Other source columns are preserved conceptually but ignored until providers are added. If a racer has multiple supported source columns, the app fetches all of them and uses the newest valid position. Set `UseMapFeatures` to `true` on one racer to use that racer's Garmin routes/waypoints/history as the race map features.

Generic usage pattern:

```text
https://<your-vercel-app>.vercel.app/          # launcher
https://<your-vercel-app>.vercel.app/?map=<mapshare-name>
https://<your-vercel-app>.vercel.app/?spot=<spot-feed-id>
https://<your-vercel-app>.vercel.app/<mapshare-name>
https://<your-vercel-app>.vercel.app/spot/<spot-feed-id>
```

Submitting a Garmin source in the root form saves the normalized MapShare name in `localStorage` and redirects to `/<mapshare-name>`. Reopening the launcher pre-fills that saved Garmin racer but does not auto-enter it, so the user can choose the race or a different solo source. Use solo mode's top-right **Change racer** action to clear the saved Garmin racer and return to the launcher.

## PWA install / Garmin link sharing

The app includes a web app manifest, install icons, and a service worker, so Chrome mobile can install it as a standalone PWA. The manifest launches the root launcher.

It also registers as a Web Share Target: share a Garmin MapShare URL such as `https://share.garmin.com/nhayes` to **MapShare Companion**, and the app will extract the racer name and redirect to `/nhayes`. KML files can also be shared/opened into the installed app on supported browsers; the app imports and persists them as the local KML layer.

Browsers do not let unrelated PWAs directly hijack normal `https://share.garmin.com/...` link clicks; sharing the Garmin link to the installed app is the supported path.

Flymaster group mode can follow public Flymaster Live Tracking groups, for example:

```text
https://mapshare-companion.vercel.app/race/flymaster/7801
```

It connects to Flymaster's live WebSocket for group positions and uses `/api/flymaster` for group metadata/history proxying.

The app uses Edge Function proxies:

```text
/api/garmin?name=<mapshare-name>&type=feed
/api/garmin?name=<mapshare-name>&type=feed&d1=<iso-start>&d2=<iso-end>
/api/garmin?name=<mapshare-name>&type=waypoints
/api/garmin?name=<mapshare-name>&type=routes
/api/garmin?name=<mapshare-name>&type=collections
/api/spot?id=<spot-feed-id>&type=message
/api/flymaster?type=group&grp=<group-id>
/api/flymaster?type=trace&grp=<group-id>&p=<pilot-sn>&d=<flymaster-timestamp>
```

That avoids Garmin/SPOT CORS problems and works directly in Chrome mobile without bookmarklets.

## Handoff / project spec

See [`HANDOFF.md`](./HANDOFF.md) for a compact project spec, deployment notes, known limitations, and next steps for future sessions.

## Build/check bookmarklet artifacts

```bash
npm run check
npm run build
```

Bookmarklet/userscript output files:

- `dist/garmin-bookmarklet.txt` — copy this into a phone browser bookmark URL
- `dist/garmin-mapshare.user.js` — Tampermonkey / Violentmonkey userscript
- `dist/garmin-console-paste.js` — paste into DevTools on desktop
- `dist/garmin-mapshare-overlay.gist.js` — script content to paste into a GitHub Gist
- `dist/garmin-gist-loader-bookmarklet.txt` — short Chrome-friendly loader bookmarklet

The older Flymaster artifacts are still built too, but Garmin is now the recommended target.

Note: Garmin exposes waypoints and routes through simple public JSON endpoints like `/<mapshare-name>/Waypoints` and `/<mapshare-name>/routes/`. Imported library track **IDs/counts** are visible in `/<mapshare-name>/Collections`, but their full geometry is not exposed by the simple public JSON endpoints I found. The overlay draws the blue racer/history track when those points are present in the KML feed.

## Debug locally on this computer

```bash
npm run serve
```

Open:

```text
http://localhost:8000/debug/garmin.html
```

The debug page uses `fixtures/nhayes.kml` plus a mock “Me” GPS location, so it works without phone GPS.

## Use on phone: bookmarklet

### Firefox/mobile browsers that accept long bookmarklets

1. Run `npm run build`.
2. Open `dist/garmin-bookmarklet.txt`.
3. Copy the single long `javascript:...` line.
4. Create a browser bookmark named something like `🏁 MapShare Companion`.
5. Edit the bookmark URL and paste the `javascript:...` line.
6. Open any public MapShare page, for example:

```text
https://share.garmin.com/nhayes
```

7. Run the bookmarklet. It will detect the name from the URL.
8. Allow location permission when asked.

### Chrome mobile: short public Gist loader bookmarklet

Chrome mobile may refuse or ignore the long bookmarklet. Use the short public Gist loader instead.

Public Gist:

```text
https://gist.github.com/tomyo/2df3c2295794932d4407e7460b52a6a1
```

Raw script URL:

```text
https://gist.githubusercontent.com/tomyo/2df3c2295794932d4407e7460b52a6a1/raw/garmin-mapshare-overlay.gist.js
```

The ready-to-use short bookmarklet is:

```text
dist/garmin-gist-loader-bookmarklet.txt
```

Use it like this:

1. Copy the single `javascript:...` line from `dist/garmin-gist-loader-bookmarklet.txt`.
2. Create a Chrome mobile bookmark named `🏁 MapShare Companion`.
3. Paste that line as the bookmark URL.
4. Open `https://share.garmin.com/<mapshare-name>`.
5. Tap the address bar, type `MapShare Companion`, and run the bookmarklet from Chrome's address bar suggestions.

The loader fetches the public Gist text and evaluates it inside `share.garmin.com`, so same-origin Garmin feed requests still work.

## Use on phone: userscript option

If bookmarklets are awkward on your mobile browser, use a userscript-capable browser:

- Android Firefox + Violentmonkey
- Kiwi Browser + Tampermonkey

Install:

```text
dist/garmin-mapshare.user.js
```

## Desktop console debug on the real Garmin page

1. Open a public MapShare page, for example `https://share.garmin.com/nhayes`
2. Open DevTools Console.
3. Paste `dist/garmin-console-paste.js`.
4. Allow location permission.

Useful console commands:

```js
GarminRaceTracker.getState()
GarminRaceTracker.refresh()
GarminRaceTracker.fitBoth()
GarminRaceTracker.centerRacer()
GarminRaceTracker.centerMe()
GarminRaceTracker.destroy()
```
