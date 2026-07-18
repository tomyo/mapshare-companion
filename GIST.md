# Legacy Garmin bookmarklet Gist

Public Gist page:

```text
https://gist.github.com/tomyo/2df3c2295794932d4407e7460b52a6a1
```

Raw URL used by the Chrome-mobile loader bookmarklet fallback:

```text
https://gist.githubusercontent.com/tomyo/2df3c2295794932d4407e7460b52a6a1/raw/garmin-mapshare-overlay.gist.js
```

Ready bookmarklet:

```text
dist/garmin-gist-loader-bookmarklet.txt
```

The standalone Vercel webapp is the primary recommended interface. If the legacy `src/garmin-mapshare-overlay.js` bookmarklet changes, rebuild and update the gist:

```bash
GARMIN_GIST_RAW_URL='https://gist.githubusercontent.com/tomyo/2df3c2295794932d4407e7460b52a6a1/raw/garmin-mapshare-overlay.gist.js' npm run build
gh gist edit 2df3c2295794932d4407e7460b52a6a1 dist/garmin-mapshare-overlay.gist.js
```
