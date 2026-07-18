window.GARMIN_TRACKER_CONFIG = Object.assign({}, window.GARMIN_TRACKER_CONFIG || {});
(function () {
  'use strict';

  const VERSION = '0.1.0';
  const GLOBAL = 'GarminRaceTracker';
  const DEFAULTS = {
    mapName: '',
    refreshMs: 60000,
    staleAfterMin: 15,
    feedUrl: '',
    waypointsUrl: '',
    routesUrl: '',
    collectionsUrl: '',
    showMapFeatures: true,
    mockMe: false,
    autoFit: true,
    leafletCss: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    leafletJs: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  };

  const cfg = Object.assign({}, DEFAULTS, window.GARMIN_TRACKER_CONFIG || {});
  cfg.mapName = cfg.mapName || inferMapName();
  if (!cfg.mapName) {
    console.warn('MapShare Companion: open a public MapShare page like https://share.garmin.com/<name> first.');
    return;
  }
  cfg.feedUrl = cfg.feedUrl || `/feed/share/${encodeURIComponent(cfg.mapName)}`;
  cfg.waypointsUrl = cfg.waypointsUrl || `/${encodeURIComponent(cfg.mapName)}/Waypoints`;
  cfg.routesUrl = cfg.routesUrl || `/${encodeURIComponent(cfg.mapName)}/routes/`;
  cfg.collectionsUrl = cfg.collectionsUrl || `/${encodeURIComponent(cfg.mapName)}/Collections`;

  if (window[GLOBAL] && typeof window[GLOBAL].destroy === 'function') {
    window[GLOBAL].destroy();
  }

  const state = {
    overlay: null,
    map: null,
    layers: null,
    featureLayers: null,
    waypointLayer: null,
    routeLayer: null,
    trackLayer: null,
    racerMarker: null,
    meMarker: null,
    accuracyCircle: null,
    connector: null,
    racerTrail: null,
    refreshTimer: null,
    geoWatch: null,
    mockTimer: null,
    racer: null,
    me: null,
    mapFeatures: { waypoints: [], routes: [], collections: null },
    featuresVisible: true,
    firstFitDone: false,
    closed: false,
  };

  const api = {
    version: VERSION,
    refresh,
    fitBoth,
    centerRacer,
    centerMe,
    loadMapFeatures,
    toggleMapFeatures,
    destroy,
    getState: () => ({ racer: state.racer, me: state.me, mapName: cfg.mapName, mapFeatures: state.mapFeatures }),
  };
  window[GLOBAL] = api;

  boot().catch((err) => {
    console.error(err);
    alert(`MapShare Companion error: ${err.message || err}`);
  });

  async function boot() {
    injectCss();
    createOverlay();
    await loadLeaflet();
    initMap();
    startOwnLocation();
    await Promise.all([refresh(), loadMapFeatures()]);
    state.refreshTimer = setInterval(() => {
      refresh();
      loadMapFeatures();
    }, cfg.refreshMs);
  }

  function inferMapName() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'feed' && parts[1] === 'share' && parts[2]) return parts[2];
    if (parts[0] && !['feed', 'css', 'js', 'Content', 'Account', 'Home', 'bundles', 'scripts'].includes(parts[0])) return parts[0];
    return '';
  }

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'grt-overlay';
    overlay.innerHTML = `
      <div class="grt-top">
        <div>
          <div class="grt-title">MapShare Companion</div>
          <div class="grt-subtitle">Garmin MapShare: <b>${escapeHtml(cfg.mapName)}</b></div>
        </div>
        <button class="grt-close" type="button" title="Close">×</button>
      </div>
      <div class="grt-stats">
        <div><span>Racer</span><b data-grt="racer-status">loading…</b></div>
        <div><span>Speed</span><b data-grt="speed">—</b></div>
        <div><span>Course</span><b data-grt="course">—</b></div>
        <div><span>Me → Racer</span><b data-grt="range">GPS…</b></div>
      </div>
      <div class="grt-actions">
        <button type="button" data-action="fit">Fit both</button>
        <button type="button" data-action="racer">Racer</button>
        <button type="button" data-action="me">Me</button>
        <button type="button" data-action="refresh">Refresh</button>
        <button type="button" data-action="features">Features</button>
        <a data-grt="google" target="_blank" rel="noopener">Google Maps</a>
        <a data-grt="osm" target="_blank" rel="noopener">OSM</a>
      </div>
      <div class="grt-info" data-grt="info">Loading Garmin feed…</div>
      <div id="grt-map"></div>
    `;
    document.body.appendChild(overlay);
    state.overlay = overlay;

    overlay.querySelector('.grt-close').addEventListener('click', destroy);
    overlay.querySelector('[data-action="fit"]').addEventListener('click', fitBoth);
    overlay.querySelector('[data-action="racer"]').addEventListener('click', centerRacer);
    overlay.querySelector('[data-action="me"]').addEventListener('click', centerMe);
    overlay.querySelector('[data-action="refresh"]').addEventListener('click', () => { refresh(); loadMapFeatures(); });
    overlay.querySelector('[data-action="features"]').addEventListener('click', toggleMapFeatures);
  }

  async function loadLeaflet() {
    if (window.L && window.L.map) return;
    if (!document.querySelector('link[data-grt-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cfg.leafletCss;
      link.dataset.grtLeaflet = '1';
      document.head.appendChild(link);
    }
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-grt-leaflet]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = cfg.leafletJs;
      script.dataset.grtLeaflet = '1';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Leaflet.'));
      document.head.appendChild(script);
    });
  }

  function initMap() {
    const L = window.L;
    state.map = L.map('grt-map', { zoomControl: true }).setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(state.map);
    state.layers = L.layerGroup().addTo(state.map);
    state.featureLayers = L.layerGroup().addTo(state.map);
    state.routeLayer = L.layerGroup().addTo(state.featureLayers);
    state.trackLayer = L.layerGroup().addTo(state.featureLayers);
    state.waypointLayer = L.layerGroup().addTo(state.featureLayers);
    state.racerTrail = L.polyline([], { color: '#0b73ff', weight: 4, opacity: 0.9 }).addTo(state.trackLayer);
    state.connector = L.polyline([], { color: '#ffd43b', weight: 3, opacity: 0.9, dashArray: '8 8' }).addTo(state.layers);
  }

  async function refresh() {
    setText('racer-status', 'refreshing…');
    try {
      const res = await fetch(addCacheBust(cfg.feedUrl), { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Garmin feed HTTP ${res.status}`);
      const xmlText = await res.text();
      const racer = parseKml(xmlText);
      if (!racer) throw new Error('No usable location found in Garmin KML.');
      state.racer = racer;
      updateRacerLayer();
      updatePanel();
      updateLinks();
      maybeInitialFit();
    } catch (err) {
      console.error(err);
      setText('racer-status', 'feed error');
      setText('info', err.message || String(err));
    }
  }

  async function loadMapFeatures() {
    if (!cfg.showMapFeatures || !state.map || !state.featureLayers) return;
    try {
      const [waypointsRes, routesRes, collectionsRes] = await Promise.allSettled([
        fetchJson(cfg.waypointsUrl),
        fetchJson(cfg.routesUrl),
        fetchJson(cfg.collectionsUrl),
      ]);
      const waypoints = waypointsRes.status === 'fulfilled' ? normalizeWaypoints(waypointsRes.value) : [];
      const routes = routesRes.status === 'fulfilled' ? normalizeRoutes(routesRes.value) : [];
      const collections = collectionsRes.status === 'fulfilled' ? collectionsRes.value : null;
      state.mapFeatures = { waypoints, routes, collections };
      renderMapFeatures();
      updateFeatureButton();
    } catch (err) {
      console.warn('Map feature load failed', err);
    }
  }

  async function fetchJson(url) {
    const res = await fetch(addCacheBust(url), { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.json();
  }

  function normalizeWaypoints(data) {
    const arr = Array.isArray(data) ? data : (data && data.Waypoints) || [];
    return arr.map((w) => ({
      id: w.D ?? w.ID ?? w.Id,
      name: w.X || w.Name || w.Label || 'WP',
      lat: Number(w.L ?? w.Latitude),
      lon: Number(w.N ?? w.Longitude),
      icon: w.I ?? w.IconIndex,
    })).filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon));
  }

  function normalizeRoutes(data) {
    const arr = Array.isArray(data) ? data : (data && data.Routes) || [];
    return arr.map((r) => ({
      id: r.RouteID ?? r.ID ?? r.Id,
      name: r.Label || r.Name || 'Route',
      color: r.ColorHex || '#ff0000',
      points: (r.Points || []).map((p) => [Number(p.L ?? p.Latitude), Number(p.N ?? p.Longitude)]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    })).filter((r) => r.points.length >= 2);
  }

  function renderMapFeatures() {
    const L = window.L;
    if (!L || !state.routeLayer || !state.waypointLayer) return;
    state.routeLayer.clearLayers();
    state.waypointLayer.clearLayers();

    for (const route of state.mapFeatures.routes) {
      const line = L.polyline(route.points, { color: route.color || '#ff0000', weight: 5, opacity: 0.9 }).addTo(state.routeLayer);
      line.bindPopup(`<b>Route</b><br>${escapeHtml(route.name)}<br>${route.points.length} points`);
      const first = route.points[0];
      const last = route.points[route.points.length - 1];
      L.circleMarker(first, { radius: 5, color: '#003b85', fillColor: '#0b73ff', fillOpacity: 1, weight: 2 }).addTo(state.routeLayer);
      L.circleMarker(last, { radius: 5, color: '#003b85', fillColor: '#0b73ff', fillOpacity: 1, weight: 2 }).addTo(state.routeLayer);
    }

    for (const wp of state.mapFeatures.waypoints) {
      const marker = L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({
          className: 'grt-waypoint-wrap',
          iconSize: [30, 30],
          iconAnchor: [11, 28],
          popupAnchor: [0, -28],
          html: `<div class="grt-waypoint-flag">⚑</div><div class="grt-waypoint-label">${escapeHtml(wp.name)}</div>`,
        }),
        title: wp.name,
      }).addTo(state.waypointLayer);
      marker.bindPopup(`<b>Waypoint</b><br>${escapeHtml(wp.name)}<br>${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}`);
    }
  }

  function toggleMapFeatures() {
    if (!state.map || !state.featureLayers) return;
    state.featuresVisible = !state.featuresVisible;
    if (state.featuresVisible) state.featureLayers.addTo(state.map);
    else state.map.removeLayer(state.featureLayers);
    updateFeatureButton();
  }

  function updateFeatureButton() {
    const btn = state.overlay && state.overlay.querySelector('[data-action="features"]');
    if (!btn) return;
    const w = state.mapFeatures.waypoints.length;
    const r = state.mapFeatures.routes.length;
    btn.textContent = state.featuresVisible ? `Features ${w}/${r}` : 'Features off';
    btn.title = `${w} waypoints, ${r} routes. Garmin track geometry is not exposed by the simple public JSON endpoints; the blue line uses any history present in the KML feed.`;
  }

  function parseKml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Garmin feed XML parse error.');
    const placemarks = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'));
    const points = placemarks.map(parsePlacemark).filter(Boolean);
    points.sort((a, b) => {
      const at = a.utcMs || 0;
      const bt = b.utcMs || 0;
      if (at !== bt) return bt - at;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
    const latest = points[0] || null;
    if (latest) latest.history = dedupeLatLon(points.slice().reverse());
    return latest;
  }

  function parsePlacemark(pm) {
    const data = {};
    for (const d of Array.from(pm.getElementsByTagNameNS('*', 'Data'))) {
      const name = d.getAttribute('name');
      const valueEl = Array.from(d.childNodes).find((n) => n.localName === 'value');
      if (name && valueEl) data[name] = valueEl.textContent.trim();
    }

    const coordEl = Array.from(pm.getElementsByTagNameNS('*', 'coordinates'))[0];
    const coordText = coordEl ? coordEl.textContent.trim().split(/\s+/)[0] : '';
    const coord = coordText ? coordText.split(',').map(Number) : [];
    const lon = Number(data.Longitude ?? coord[0]);
    const lat = Number(data.Latitude ?? coord[1]);
    const ele = Number.parseFloat(data.Elevation || coord[2] || '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      id: data.Id || '',
      name: data['Map Display Name'] || data.Name || textOf(pm, 'name') || cfg.mapName,
      lat,
      lon,
      ele: Number.isFinite(ele) ? ele : null,
      speedText: data.Velocity || '—',
      speedKmh: Number.parseFloat(data.Velocity || ''),
      courseText: data.Course || '—',
      courseDeg: Number.parseFloat(data.Course || ''),
      time: data.Time || '',
      timeUtc: data['Time UTC'] || '',
      utcMs: parseGarminUtc(data['Time UTC']),
      gpsFix: data['Valid GPS Fix'] || '',
      emergency: data['In Emergency'] || '',
      text: data.Text || data.Note || '',
      event: data.Event || '',
    };
  }

  function textOf(el, localName) {
    const found = Array.from(el.childNodes).find((n) => n.localName === localName);
    return found ? found.textContent.trim() : '';
  }

  function parseGarminUtc(s) {
    if (!s) return 0;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i);
    if (!m) return Date.parse(`${s} UTC`) || Date.parse(s) || 0;
    let [, mo, da, yr, hr, mi, se, ap] = m;
    let h = Number(hr) % 12;
    if (ap.toUpperCase() === 'PM') h += 12;
    return Date.UTC(Number(yr), Number(mo) - 1, Number(da), h, Number(mi), Number(se));
  }

  function updateRacerLayer() {
    const r = state.racer;
    const L = window.L;
    const ll = [r.lat, r.lon];
    const icon = L.divIcon({
      className: 'grt-racer-icon-wrap',
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -20],
      html: `<div class="grt-racer-icon"><div class="grt-racer-arrow" style="transform:rotate(${Number.isFinite(r.courseDeg) ? r.courseDeg : 0}deg);opacity:${Number.isFinite(r.courseDeg) ? 1 : 0.25}"></div></div>`,
    });
    if (!state.racerMarker) {
      state.racerMarker = L.marker(ll, { icon, zIndexOffset: 4000, title: r.name }).addTo(state.layers);
    } else {
      state.racerMarker.setLatLng(ll);
      state.racerMarker.setIcon(icon);
    }
    state.racerMarker.bindPopup(racerPopup(r));
    updateRacerTrail();
    updateConnector();
  }

  function updateRacerTrail() {
    if (!state.racerTrail || !state.racer || !state.racer.history) return;
    state.racerTrail.setLatLngs(state.racer.history.map((p) => [p.lat, p.lon]));
  }

  function dedupeLatLon(points) {
    const out = [];
    let prev = null;
    for (const p of points) {
      if (!prev || Math.abs(prev.lat - p.lat) > 1e-7 || Math.abs(prev.lon - p.lon) > 1e-7) out.push(p);
      prev = p;
    }
    return out;
  }

  function startOwnLocation() {
    if (cfg.mockMe) return startMockMe();
    if (!navigator.geolocation) {
      setText('range', 'no GPS');
      return;
    }
    state.geoWatch = navigator.geolocation.watchPosition(onMePosition, onMeError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    });
  }

  function startMockMe() {
    const base = { lat: -18.181, lon: -40.735 };
    let t = 0;
    state.mockTimer = setInterval(() => {
      t += 1;
      onMe({
        lat: base.lat + Math.sin(t / 20) * 0.004,
        lon: base.lon + Math.cos(t / 20) * 0.004,
        accuracy: 12,
        heading: (t * 8) % 360,
        speed: 6,
        timestamp: Date.now(),
      });
    }, 1000);
  }

  function onMePosition(pos) {
    const c = pos.coords;
    const next = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
      heading: Number.isFinite(c.heading) ? c.heading : null,
      speed: Number.isFinite(c.speed) ? c.speed : null,
      timestamp: pos.timestamp || Date.now(),
    };
    if (next.heading == null && state.me) {
      const moved = distanceM(state.me.lat, state.me.lon, next.lat, next.lon);
      if (moved > 3) next.heading = bearingDeg(state.me.lat, state.me.lon, next.lat, next.lon);
    }
    onMe(next);
  }

  function onMeError(err) {
    setText('range', 'GPS denied');
    const msg = err && err.message ? err.message : String(err || 'GPS error');
    const info = state.racer ? infoText(state.racer) : '';
    setText('info', `${info}${info ? ' · ' : ''}Phone GPS: ${msg}`);
  }

  function onMe(next) {
    state.me = next;
    const L = window.L;
    const ll = [next.lat, next.lon];
    const icon = L.divIcon({
      className: 'grt-me-icon-wrap',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18],
      html: `<div class="grt-me-icon"><div class="grt-me-arrow" style="transform:rotate(${Number.isFinite(next.heading) ? next.heading : 0}deg);opacity:${Number.isFinite(next.heading) ? 1 : 0.25}"></div></div>`,
    });
    if (!state.meMarker) {
      state.meMarker = L.marker(ll, { icon, zIndexOffset: 5000, title: 'Me' }).addTo(state.layers);
    } else {
      state.meMarker.setLatLng(ll);
      state.meMarker.setIcon(icon);
    }
    state.meMarker.bindPopup(mePopup(next));

    if (!state.accuracyCircle) {
      state.accuracyCircle = L.circle(ll, accuracyStyle(next.accuracy)).addTo(state.layers);
    } else {
      state.accuracyCircle.setLatLng(ll);
      state.accuracyCircle.setRadius(next.accuracy || 0);
    }
    updateConnector();
    updatePanel();
    maybeInitialFit();
  }

  function accuracyStyle(accuracy) {
    return { radius: accuracy || 0, color: '#1a73e8', weight: 2, opacity: 0.65, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false };
  }

  function updateConnector() {
    if (!state.connector) return;
    if (state.racer && state.me) state.connector.setLatLngs([[state.me.lat, state.me.lon], [state.racer.lat, state.racer.lon]]);
    else state.connector.setLatLngs([]);
  }

  function updatePanel() {
    const r = state.racer;
    if (!r) return;
    const stale = staleMinutes(r);
    const staleText = stale != null && stale > cfg.staleAfterMin ? `stale ${Math.round(stale)} min` : 'live';
    setText('racer-status', r.gpsFix === 'False' ? 'no GPS fix' : staleText);
    setText('speed', r.speedText || '—');
    setText('course', r.courseText || '—');

    if (state.me) {
      const d = distanceM(state.me.lat, state.me.lon, r.lat, r.lon);
      const b = bearingDeg(state.me.lat, state.me.lon, r.lat, r.lon);
      setText('range', `${formatDistance(d)} · ${Math.round(b)}°`);
    } else {
      setText('range', 'waiting GPS');
    }
    setText('info', infoText(r));
  }

  function infoText(r) {
    const parts = [];
    parts.push(`Updated: ${r.time || r.timeUtc || '—'}`);
    if (r.ele != null) parts.push(`Elev: ${Math.round(r.ele)} m`);
    if (r.gpsFix) parts.push(`GPS fix: ${r.gpsFix}`);
    if (r.emergency === 'True') parts.push('EMERGENCY');
    if (r.text) parts.push(`Text: ${r.text}`);
    return parts.join(' · ');
  }

  function updateLinks() {
    if (!state.racer) return;
    const { lat, lon } = state.racer;
    const google = state.overlay.querySelector('[data-grt="google"]');
    const osm = state.overlay.querySelector('[data-grt="osm"]');
    google.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    osm.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
  }

  function racerPopup(r) {
    return `<b>${escapeHtml(r.name)}</b><br>${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}<br>Speed: ${escapeHtml(r.speedText)}<br>Course: ${escapeHtml(r.courseText)}<br>Updated: ${escapeHtml(r.time || r.timeUtc || '—')}`;
  }

  function mePopup(m) {
    const speed = m.speed == null ? '—' : `${(m.speed * 3.6).toFixed(1)} km/h`;
    const acc = m.accuracy == null ? '—' : `±${Math.round(m.accuracy)} m`;
    return `<b>Me</b><br>${m.lat.toFixed(6)}, ${m.lon.toFixed(6)}<br>Accuracy: ${acc}<br>Speed: ${speed}`;
  }

  function maybeInitialFit() {
    if (!cfg.autoFit || state.firstFitDone || !state.racer) return;
    if (state.me) {
      fitBoth();
      state.firstFitDone = true;
    } else {
      centerRacer();
    }
  }

  function fitBoth() {
    if (!state.map || !state.racer) return;
    if (state.me) {
      state.map.fitBounds([[state.me.lat, state.me.lon], [state.racer.lat, state.racer.lon]], { padding: [40, 40], maxZoom: 16 });
    } else {
      centerRacer();
    }
  }

  function centerRacer() {
    if (state.map && state.racer) state.map.setView([state.racer.lat, state.racer.lon], Math.max(state.map.getZoom(), 15));
  }

  function centerMe() {
    if (state.map && state.me) state.map.setView([state.me.lat, state.me.lon], Math.max(state.map.getZoom(), 15));
  }

  function destroy() {
    state.closed = true;
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    if (state.geoWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(state.geoWatch);
    if (state.mockTimer) clearInterval(state.mockTimer);
    if (state.map) state.map.remove();
    if (state.overlay) state.overlay.remove();
    document.getElementById('grt-style')?.remove();
    delete window[GLOBAL];
  }

  function setText(key, value) {
    const el = state.overlay && state.overlay.querySelector(`[data-grt="${key}"]`);
    if (el) el.textContent = value;
  }

  function addCacheBust(url) {
    const join = url.includes('?') ? '&' : '?';
    return `${url}${join}_=${Date.now()}`;
  }

  function staleMinutes(r) {
    if (!r.utcMs) return null;
    return (Date.now() - r.utcMs) / 60000;
  }

  function formatDistance(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }

  function distanceM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearingDeg(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function injectCss() {
    if (document.getElementById('grt-style')) return;
    const style = document.createElement('style');
    style.id = 'grt-style';
    style.textContent = `
      #grt-overlay{position:fixed;inset:0;z-index:2147483647;background:#0b1020;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;display:flex;flex-direction:column}
      #grt-overlay *{box-sizing:border-box}.grt-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;background:#111827;border-bottom:1px solid #2b3447}.grt-title{font-size:20px;font-weight:800}.grt-subtitle{font-size:12px;color:#cbd5e1}.grt-close{border:0;background:transparent;color:#fff;font-size:34px;line-height:1;padding:0 6px;cursor:pointer}
      .grt-stats{display:grid;grid-template-columns:repeat(4,1fr);background:#172554;border-bottom:1px solid #2b3447;text-align:center}.grt-stats div{padding:9px 6px;border-right:1px solid #2b3447}.grt-stats div:last-child{border-right:0}.grt-stats span{display:block;color:#93a4bd;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.grt-stats b{display:block;font-size:15px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .grt-actions{display:flex;gap:6px;padding:8px;background:#0f172a;border-bottom:1px solid #2b3447;overflow-x:auto}.grt-actions button,.grt-actions a{border:1px solid #475569;background:#1e293b;color:#fff;border-radius:7px;padding:8px 10px;text-decoration:none;font:700 13px system-ui;white-space:nowrap}.grt-actions a{background:#2563eb}.grt-info{padding:7px 10px;background:#111827;color:#d1d5db;font-size:12px;border-bottom:1px solid #2b3447;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#grt-map{flex:1;min-height:260px;background:#1f2937;color:#111}
      .grt-racer-icon-wrap,.grt-me-icon-wrap{background:transparent;border:0}.grt-racer-icon,.grt-me-icon{position:relative;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 8px rgba(0,0,0,.65)}.grt-racer-icon{width:32px;height:32px;background:#e03131}.grt-me-icon{width:28px;height:28px;background:#1a73e8}.grt-racer-icon:after,.grt-me-icon:after{content:"";position:absolute;border-radius:50%;background:#fff}.grt-racer-icon:after{left:10px;top:10px;width:6px;height:6px}.grt-me-icon:after{left:8px;top:8px;width:6px;height:6px}.grt-racer-arrow,.grt-me-arrow{position:absolute;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}.grt-racer-arrow{left:8px;top:-15px;border-bottom:18px solid #e03131;transform-origin:50% 31px}.grt-me-arrow{left:7px;top:-13px;border-bottom:16px solid #1a73e8;transform-origin:50% 27px}
      .grt-waypoint-wrap{background:transparent;border:0;overflow:visible!important}.grt-waypoint-flag{font-size:27px;line-height:27px;color:#111;text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff,0 2px 5px rgba(0,0,0,.5)}.grt-waypoint-label{position:absolute;left:17px;top:8px;background:rgba(255,255,255,.86);color:#111;border-radius:4px;padding:1px 4px;font:700 12px system-ui;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)}
      @media(max-width:620px){.grt-stats{grid-template-columns:repeat(2,1fr)}.grt-title{font-size:18px}.grt-stats b{font-size:14px}.grt-waypoint-label{font-size:11px}}
    `;
    document.head.appendChild(style);
  }
})();
