# MapShare Companion

A support-crew companion webapp for any public Garmin MapShare page like `https://share.garmin.com/<mapshare-name>`.

The primary deliverable is a standalone Vercel webapp. It asks for a Garmin username/shared URL, stores the normalized MapShare name in `localStorage`, and shows this race-support UX:

- racer/Garmin location from the public KML feed
- your phone location from browser GPS
- distance and bearing from you to the racer
- racer speed, course, GPS fix, elevation, and last update
- OpenStreetMap map with both markers and a connecting line
- Garmin MapShare waypoints and routes from `/<mapshare-name>/Waypoints` and `/<mapshare-name>/routes/`
- any track/history points present in the public KML feed
- buttons for Fit both, Racer, Me, Refresh, and a simple Show/Hide features toggle
- auto-refresh of the Garmin feed and map features every 60 seconds
- contextual map popups: tap the racer, a waypoint, your location, or any map point to open that point in Google Maps or OSM
- distance measuring: choose **Measure from here** in any location popup, then tap map points to update a straight-line distance until you close the measuring popup or click outside the map
- subtle distance label on the dotted line between your location and the racer

## Why this works

Garmin exposes public KML feeds at:

```text
https://share.garmin.com/feed/share/<mapshare-name>
```

The Vercel app fetches Garmin data through `/api/garmin`, an Edge Function proxy, so Chrome/mobile browsers do not hit Garmin CORS restrictions.

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
https://mapshare-companion.vercel.app/          # asks for username / shared URL
https://mapshare-companion.vercel.app/?map=nhayes
https://mapshare-companion.vercel.app/nhayes
```

Generic usage pattern:

```text
https://<your-vercel-app>.vercel.app/          # asks for username / shared URL
https://<your-vercel-app>.vercel.app/?map=<mapshare-name>
https://<your-vercel-app>.vercel.app/<mapshare-name>
```

Submitting the root form saves the MapShare name in `localStorage` and redirects to `/<mapshare-name>`. Reopening the app later redirects to the saved racer automatically, so the user does not need to re-enter it. Use the top-right menu's **Change racer** action to clear the saved racer and return to setup.

## PWA install / Garmin link sharing

The app includes a web app manifest, install icons, and a service worker, so Chrome mobile can install it as a standalone PWA. The manifest launches `/?launch=1`; if a racer was previously selected, the app redirects back to `/<mapshare-name>` using the saved `localStorage` value.

It also registers as a Web Share Target: share a Garmin MapShare URL such as `https://share.garmin.com/nhayes` to **MapShare Companion**, and the app will extract the racer name and redirect to `/nhayes`.

Browsers do not let unrelated PWAs directly hijack normal `https://share.garmin.com/...` link clicks; sharing the Garmin link to the installed app is the supported path.

The app uses an Edge Function proxy:

```text
/api/garmin?name=<mapshare-name>&type=feed
/api/garmin?name=<mapshare-name>&type=waypoints
/api/garmin?name=<mapshare-name>&type=routes
/api/garmin?name=<mapshare-name>&type=collections
```

That avoids Garmin CORS problems and works directly in Chrome mobile without bookmarklets.

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
