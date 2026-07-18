# MapShare Companion implementation plan

## Current webapp plan

1. Use a standalone Vercel webapp as the main Chrome/Safari/Firefox-compatible UX.
2. Root `/` shows a setup form and does not auto-start from saved session state.
3. Accept a Garmin MapShare username or shared URL, normalize it, and store it in `sessionStorage`.
4. Auto-start only for explicit targets: `/<mapshare-name>` or `?map=<mapshare-name>`.
5. Fetch Garmin data through a Vercel Edge Function proxy to avoid browser CORS.
6. Render the race-support map UX: racer, observer, distance/bearing, waypoints, routes, and KML history.

## Bookmarklet fallback plan

1. Use any public `share.garmin.com/<mapshare-name>` page as the entry page.
2. Infer `<mapshare-name>` from the current URL and fetch Garmin's same-origin KML feed from `/feed/share/<mapshare-name>`.
3. Parse the KML with `DOMParser`, not regex.
4. Pick the newest usable placemark using `Time UTC` and `Id`.
5. Inject a fullscreen overlay that loads Leaflet/OpenStreetMap.
6. Draw:
   - racer marker with course arrow
   - phone/observer marker with heading arrow
   - phone GPS accuracy circle
   - line between observer and racer
   - MapShare waypoints from `/<mapshare-name>/Waypoints`
   - MapShare routes from `/<mapshare-name>/routes/`
   - KML history/track points when present
7. Compute distance and bearing from observer to racer.
8. Auto-refresh Garmin feed every 60 seconds.
9. Provide:
   - phone bookmarklet
   - userscript
   - desktop console paste
   - local debug harness with fixture KML and mock observer GPS

## Validated findings

- `https://share.garmin.com/nhayes` is public and useful as a test case.
- `https://share.garmin.com/feed/share/nhayes` returns public KML.
- The implementation is generic and derives `nhayes` (or any other MapShare name) from the current URL.
- The feed includes `Latitude`, `Longitude`, `Velocity`, `Course`, `Time`, `Time UTC`, `Elevation`, and `Valid GPS Fix`.
- `https://share.garmin.com/<mapshare-name>/Waypoints` returns public MapShare waypoints.
- `https://share.garmin.com/<mapshare-name>/routes/` returns public MapShare route geometry.
- `https://share.garmin.com/<mapshare-name>/Collections` returns collection metadata and track IDs/counts, but not simple public track geometry.
- Running on the Garmin page avoids CORS because the bookmarklet fetches the feed from the same origin.

## Current implementation

Primary webapp sources:

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `api/garmin.js`
- `vercel.json`

Legacy bookmarklet source: `src/garmin-mapshare-overlay.js`

Build outputs:

- `dist/garmin-bookmarklet.txt`
- `dist/garmin-mapshare.user.js`
- `dist/garmin-console-paste.js`

Debug page:

- `debug/garmin.html`
