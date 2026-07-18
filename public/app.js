(() => {
  'use strict';

  const STORE_KEY = 'garminRaceTracker.mapName';
  const BASE_MAP_KEY = 'garminRaceTracker.baseMap';
  const KML_KEY = 'garminRaceTracker.importedKml';
  const REFRESH_MS = 60000;
  const STALE_AFTER_MIN = 15;

  const $ = (id) => document.getElementById(id);
  const state = {
    mapName: '',
    map: null,
    baseLayer: null,
    baseMapType: 'street',
    layers: null,
    featureLayers: null,
    waypointLayer: null,
    routeLayer: null,
    trackLayer: null,
    kmlLayer: null,
    racerMarker: null,
    meMarker: null,
    accuracyCircle: null,
    connector: null,
    racerTrail: null,
    measureLayer: null,
    measureStart: null,
    measurePopup: null,
    refreshTimer: null,
    geoWatch: null,
    racer: null,
    me: null,
    mapFeatures: { waypoints: [], routes: [], collections: null },
    importedKml: null,
    kmlVisible: true,
    firstFitDone: false,
  };

  $('setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = parseMapName($('map-input').value);
    if (!name) return showSetupError('Paste a Garmin MapShare name or URL, e.g. nhayes or https://share.garmin.com/nhayes');
    saveMapName(name);
    location.assign(`/${encodeURIComponent(name)}`);
  });

  const menuToggle = $('track-menu-toggle');
  const trackMenu = $('track-menu');
  const closeTrackMenu = () => {
    trackMenu.classList.add('hidden');
    menuToggle.setAttribute('aria-expanded', 'false');
  };

  menuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = trackMenu.classList.contains('hidden');
    trackMenu.classList.toggle('hidden', !willOpen);
    menuToggle.setAttribute('aria-expanded', String(willOpen));
  });
  $('import-kml').addEventListener('click', () => {
    closeTrackMenu();
    $('kml-file').click();
  });
  $('change-map').addEventListener('click', () => {
    clearSavedMapName();
    location.assign('/');
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-wrap')) closeTrackMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeTrackMenu();
      clearMeasurement();
    }
  });
  document.addEventListener('click', (event) => {
    const measureButton = event.target.closest('[data-measure-lat]');
    if (measureButton) {
      event.preventDefault();
      event.stopPropagation();
      startMeasurement(Number(measureButton.dataset.measureLat), Number(measureButton.dataset.measureLon), measureButton.dataset.measureTitle || 'Selected location');
      return;
    }
    if (state.measureStart && state.map && !state.map.getContainer().contains(event.target)) clearMeasurement();
  });
  $('fit-both').addEventListener('click', fitBoth);
  $('center-racer').addEventListener('click', centerRacer);
  $('center-me').addEventListener('click', centerMe);
  $('refresh').addEventListener('click', () => refreshAll());
  $('toggle-basemap').addEventListener('click', toggleBaseMap);
  $('toggle-kml').addEventListener('click', toggleKmlLayer);
  $('kml-file').addEventListener('change', importKmlFile);

  const launchParams = new URL(location.href).searchParams;
  const sharedMap = parseSharedMap(launchParams);
  if (sharedMap) {
    saveMapName(sharedMap);
    location.replace(`/${encodeURIComponent(sharedMap)}`);
    return;
  }

  const explicitMap = parseMapName(launchParams.get('map') || '') || parseMapNameFromPath();
  const savedMap = loadSavedMapName();
  if (explicitMap) {
    $('map-input').value = explicitMap;
    start(explicitMap);
  } else if (savedMap) {
    location.replace(`/${encodeURIComponent(savedMap)}`);
  } else {
    $('map-input').value = '';
  }

  async function start(mapName) {
    state.mapName = mapName;
    $('setup').classList.add('hidden');
    $('tracker').classList.remove('hidden');
    $('map-name').textContent = mapName;
    saveMapName(mapName);

    if (!state.map) initMap();
    startOwnLocation();
    await refreshAll();
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(refreshAll, REFRESH_MS);
  }

  async function refreshAll() {
    await Promise.allSettled([refreshRacer(), loadMapFeatures()]);
  }

  function initMap() {
    state.map = L.map('map', { zoomControl: true }).setView([0, 0], 2);
    setBaseMap(loadBaseMapType());
    state.layers = L.layerGroup().addTo(state.map);
    state.featureLayers = L.layerGroup().addTo(state.map);
    state.routeLayer = L.layerGroup().addTo(state.featureLayers);
    state.trackLayer = L.layerGroup().addTo(state.featureLayers);
    state.waypointLayer = L.layerGroup().addTo(state.featureLayers);
    state.kmlLayer = L.layerGroup().addTo(state.map);
    state.measureLayer = L.layerGroup().addTo(state.map);
    state.racerTrail = L.polyline([], { color: '#0b73ff', weight: 4, opacity: 0.9 }).addTo(state.trackLayer);
    state.connector = L.polyline([], { color: '#ffd43b', weight: 3, opacity: 0.9, dashArray: '8 8' }).addTo(state.layers);
    state.map.on('click', (event) => {
      if (state.measureStart) updateMeasurement(event.latlng.lat, event.latlng.lng);
      else openLocationPopup(event.latlng.lat, event.latlng.lng, 'Selected location');
    });
    loadImportedKml();
  }

  async function refreshRacer() {
    setText('racer-status', 'refreshing…');
    try {
      const xmlText = await fetchText(apiUrl('feed'));
      const racer = parseKml(xmlText);
      if (!racer) throw new Error('No usable location found in Garmin KML.');
      state.racer = racer;
      updateRacerLayer();
      updatePanel();
      maybeInitialFit();
    } catch (err) {
      console.error(err);
      setText('racer-status', 'feed error');
      setText('info', err.message || String(err));
    }
  }

  async function loadMapFeatures() {
    try {
      const [waypointsRes, routesRes, collectionsRes] = await Promise.allSettled([
        fetchJson(apiUrl('waypoints')),
        fetchJson(apiUrl('routes')),
        fetchJson(apiUrl('collections')),
      ]);
      state.mapFeatures = {
        waypoints: waypointsRes.status === 'fulfilled' ? normalizeWaypoints(waypointsRes.value) : [],
        routes: routesRes.status === 'fulfilled' ? normalizeRoutes(routesRes.value) : [],
        collections: collectionsRes.status === 'fulfilled' ? collectionsRes.value : null,
      };
      renderMapFeatures();
    } catch (err) {
      console.warn('Map feature load failed', err);
    }
  }

  function apiUrl(type) {
    return `/api/garmin?name=${encodeURIComponent(state.mapName)}&type=${encodeURIComponent(type)}&_=${Date.now()}`;
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
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
      name: data['Map Display Name'] || data.Name || textOf(pm, 'name') || state.mapName,
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
    };
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
    state.routeLayer.clearLayers();
    state.waypointLayer.clearLayers();
    for (const route of state.mapFeatures.routes) {
      const line = L.polyline(route.points, { color: route.color || '#ff0000', weight: 5, opacity: 0.9 }).addTo(state.routeLayer);
      line.bindPopup(`<b>Route</b><br>${escapeHtml(route.name)}<br>${route.points.length} points`);
      L.circleMarker(route.points[0], { radius: 5, color: '#003b85', fillColor: '#0b73ff', fillOpacity: 1, weight: 2 }).addTo(state.routeLayer);
      L.circleMarker(route.points[route.points.length - 1], { radius: 5, color: '#003b85', fillColor: '#0b73ff', fillOpacity: 1, weight: 2 }).addTo(state.routeLayer);
    }
    for (const wp of state.mapFeatures.waypoints) {
      const marker = L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({
          className: 'waypoint-wrap',
          iconSize: [30, 30],
          iconAnchor: [11, 28],
          popupAnchor: [0, -28],
          html: `<div class="waypoint-flag">⚑</div><div class="waypoint-label">${escapeHtml(wp.name)}</div>`,
        }),
        title: wp.name,
        bubblingMouseEvents: false,
      }).addTo(state.waypointLayer);
      marker.bindPopup(locationPopupHtml(`Waypoint: ${wp.name}`, wp.lat, wp.lon));
    }
  }

  function updateRacerLayer() {
    const r = state.racer;
    const ll = [r.lat, r.lon];
    const icon = L.divIcon({
      className: 'racer-icon-wrap', iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -20],
      html: `<div class="racer-icon"><div class="racer-arrow" style="transform:rotate(${Number.isFinite(r.courseDeg) ? r.courseDeg : 0}deg);opacity:${Number.isFinite(r.courseDeg) ? 1 : 0.25}"></div></div>`,
    });
    if (!state.racerMarker) state.racerMarker = L.marker(ll, { icon, zIndexOffset: 4000, title: r.name, bubblingMouseEvents: false }).addTo(state.layers);
    else { state.racerMarker.setLatLng(ll); state.racerMarker.setIcon(icon); }
    state.racerMarker.bindPopup(locationPopupHtml(r.name, r.lat, r.lon, `Speed: ${escapeHtml(r.speedText)}<br>Elev: ${formatElevation(r.ele)}<br>Course: ${escapeHtml(r.courseText)}<br>Updated: ${escapeHtml(r.time || r.timeUtc || '—')}`));
    if (r.history) state.racerTrail.setLatLngs(r.history.map((p) => [p.lat, p.lon]));
    updateConnector();
  }

  function startOwnLocation() {
    if (state.geoWatch != null) return;
    if (!navigator.geolocation) return setText('range', 'no GPS');
    state.geoWatch = navigator.geolocation.watchPosition(onMePosition, onMeError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  }

  function onMePosition(pos) {
    const c = pos.coords;
    const next = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
      heading: Number.isFinite(c.heading) ? c.heading : null,
      speed: Number.isFinite(c.speed) ? c.speed : null,
    };
    if (next.heading == null && state.me && distanceM(state.me.lat, state.me.lon, next.lat, next.lon) > 3) {
      next.heading = bearingDeg(state.me.lat, state.me.lon, next.lat, next.lon);
    }
    state.me = next;
    updateMeLayer();
    updateConnector();
    updatePanel();
    maybeInitialFit();
  }

  function onMeError(err) {
    setText('range', 'GPS denied');
    const msg = err && err.message ? err.message : String(err || 'GPS error');
    setText('info', `${state.racer ? infoText(state.racer) + ' · ' : ''}Phone GPS: ${msg}`);
  }

  function updateMeLayer() {
    const m = state.me;
    const ll = [m.lat, m.lon];
    const icon = L.divIcon({
      className: 'me-icon-wrap', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18],
      html: `<div class="me-icon"><div class="me-arrow" style="transform:rotate(${Number.isFinite(m.heading) ? m.heading : 0}deg);opacity:${Number.isFinite(m.heading) ? 1 : 0.25}"></div></div>`,
    });
    if (!state.meMarker) state.meMarker = L.marker(ll, { icon, zIndexOffset: 5000, title: 'Me', bubblingMouseEvents: false }).addTo(state.layers);
    else { state.meMarker.setLatLng(ll); state.meMarker.setIcon(icon); }
    const speed = m.speed == null ? '—' : `${(m.speed * 3.6).toFixed(1)} km/h`;
    const acc = m.accuracy == null ? '—' : `±${Math.round(m.accuracy)} m`;
    state.meMarker.bindPopup(locationPopupHtml('Me', m.lat, m.lon, `Accuracy: ${acc}<br>Speed: ${speed}`));
    if (!state.accuracyCircle) state.accuracyCircle = L.circle(ll, accuracyStyle(m.accuracy)).addTo(state.layers);
    else { state.accuracyCircle.setLatLng(ll); state.accuracyCircle.setRadius(m.accuracy || 0); }
  }

  function updateConnector() {
    if (state.racer && state.me) {
      const a = [state.me.lat, state.me.lon];
      const b = [state.racer.lat, state.racer.lon];
      state.connector.setLatLngs([a, b]);
      if (state.connector.getTooltip()) state.connector.unbindTooltip();
      state.connector.bindTooltip(formatKm(distanceM(a[0], a[1], b[0], b[1])), {
        permanent: true,
        direction: 'center',
        className: 'distance-label connector-distance',
        opacity: 0.85,
      });
    } else {
      state.connector.setLatLngs([]);
      if (state.connector.getTooltip()) state.connector.unbindTooltip();
    }
  }

  function updatePanel() {
    const r = state.racer;
    if (!r) return;
    const stale = staleMinutes(r);
    setText('racer-status', r.gpsFix === 'False' ? 'no GPS fix' : stale != null && stale > STALE_AFTER_MIN ? `stale ${Math.round(stale)} min` : 'live');
    setText('speed', r.speedText || '—');
    setText('elevation', formatElevation(r.ele));
    if (state.me) {
      const d = distanceM(state.me.lat, state.me.lon, r.lat, r.lon);
      const b = bearingDeg(state.me.lat, state.me.lon, r.lat, r.lon);
      setText('range', `${formatDistance(d)} · ${Math.round(b)}°`);
    } else setText('range', 'waiting GPS');
    setText('info', infoText(r));
  }

  function openLocationPopup(lat, lon, title) {
    L.popup().setLatLng([lat, lon]).setContent(locationPopupHtml(title, lat, lon)).openOn(state.map);
  }

  function startMeasurement(lat, lon, title) {
    clearMeasurement();
    state.map.closePopup();
    state.measureStart = { lat, lon, title };
    state.measurePopup = L.popup({ closeOnClick: false, autoClose: false })
      .setLatLng([lat, lon])
      .setContent(`<b>Measuring from</b><br>${escapeHtml(title)}<br>${lat.toFixed(6)}, ${lon.toFixed(6)}<br><span class="measure-hint">Tap the map to update the endpoint. Close this popup to stop.</span>`);
    const popup = state.measurePopup;
    popup.on('remove', () => {
      if (state.measurePopup === popup) {
        state.measurePopup = null;
        clearMeasurement();
      }
    });
    popup.addTo(state.map);
    setText('info', 'Measuring: tap the map to choose or update the second point.');
  }

  function updateMeasurement(lat, lon) {
    if (!state.measureStart) return;
    const start = state.measureStart;
    const dist = distanceM(start.lat, start.lon, lat, lon);
    const label = formatDistance(dist);
    const mid = [(start.lat + lat) / 2, (start.lon + lon) / 2];
    state.measureLayer.clearLayers();
    L.polyline([[start.lat, start.lon], [lat, lon]], { color: '#f59e0b', weight: 3, opacity: 0.95, dashArray: '6 8' }).addTo(state.measureLayer);
    L.marker(mid, {
      interactive: false,
      icon: L.divIcon({
        className: 'measure-label-wrap',
        iconSize: [96, 24],
        iconAnchor: [48, 12],
        html: `<div class="measure-label">${label}</div>`,
      }),
    }).addTo(state.measureLayer);
    setText('info', `Measured distance: ${label}`);
  }

  function clearMeasurement() {
    state.measureStart = null;
    if (state.measureLayer) state.measureLayer.clearLayers();
    if (state.measurePopup) {
      const popup = state.measurePopup;
      state.measurePopup = null;
      popup.off('remove');
      state.map.removeLayer(popup);
    }
  }

  function locationPopupHtml(title, lat, lon, details = '') {
    return `<b>${escapeHtml(title)}</b><br>${lat.toFixed(6)}, ${lon.toFixed(6)}${details ? `<br>${details}` : ''}${mapLinksHtml(lat, lon, title)}`;
  }

  function mapLinksHtml(lat, lon, title) {
    return `<div class="map-popup-actions"><a href="${googlePointUrl(lat, lon)}" target="_blank" rel="noopener">Google Maps</a><a href="${osmPointUrl(lat, lon)}" target="_blank" rel="noopener">OSM</a><button type="button" data-measure-lat="${lat}" data-measure-lon="${lon}" data-measure-title="${escapeHtml(title)}">Measure from here</button></div>`;
  }

  function googlePointUrl(lat, lon) { return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`; }
  function osmPointUrl(lat, lon) { return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`; }

  async function importKmlFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseImportedKml(text, file.name || 'Imported KML');
      if (!imported.points.length && !imported.lines.length) throw new Error('No points or lines found in KML.');
      state.importedKml = imported;
      state.kmlVisible = true;
      saveImportedKml(text);
      renderImportedKml(true);
      setText('info', `Imported KML: ${imported.points.length} points, ${imported.lines.length} lines.`);
    } catch (err) {
      console.error(err);
      setText('info', `KML import failed: ${err.message || err}`);
      alert(`KML import failed: ${err.message || err}`);
    }
  }

  function loadImportedKml() {
    const text = loadSavedKml();
    if (!text) return updateKmlButton();
    try {
      const imported = parseImportedKml(text, 'Imported KML');
      if (!imported.points.length && !imported.lines.length) return updateKmlButton();
      state.importedKml = imported;
      renderImportedKml(false);
    } catch (err) {
      console.warn('Saved KML could not be loaded', err);
      updateKmlButton();
    }
  }

  function parseImportedKml(xmlText, fallbackName) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('KML XML parse error.');
    const out = { name: textOf(doc, 'name') || fallbackName || 'Imported KML', points: [], lines: [] };
    for (const pm of Array.from(doc.getElementsByTagNameNS('*', 'Placemark'))) {
      const name = textOf(pm, 'name') || 'KML feature';
      for (const point of Array.from(pm.getElementsByTagNameNS('*', 'Point'))) {
        const coords = parseKmlCoordinates(textOf(point, 'coordinates'));
        if (coords[0]) out.points.push({ name, lat: coords[0][0], lon: coords[0][1] });
      }
      for (const line of Array.from(pm.getElementsByTagNameNS('*', 'LineString'))) {
        const coords = parseKmlCoordinates(textOf(line, 'coordinates'));
        if (coords.length >= 2) out.lines.push({ name, points: coords });
      }
      for (const ring of Array.from(pm.getElementsByTagNameNS('*', 'LinearRing'))) {
        const coords = parseKmlCoordinates(textOf(ring, 'coordinates'));
        if (coords.length >= 2) out.lines.push({ name, points: coords });
      }
    }
    return out;
  }

  function parseKmlCoordinates(text) {
    return String(text || '').trim().split(/\s+/).map((chunk) => {
      const [lon, lat] = chunk.split(',').map(Number);
      return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    }).filter(Boolean);
  }

  function renderImportedKml(fitAfterRender) {
    if (!state.kmlLayer) return;
    state.kmlLayer.clearLayers();
    const imported = state.importedKml;
    if (!imported) return updateKmlButton();
    const bounds = [];
    for (const line of imported.lines) {
      L.polyline(line.points, { color: '#f97316', weight: 4, opacity: 0.9 }).bindPopup(`<b>KML</b><br>${escapeHtml(line.name)}<br>${line.points.length} points`).addTo(state.kmlLayer);
      bounds.push(...line.points);
    }
    for (const point of imported.points) {
      L.circleMarker([point.lat, point.lon], { radius: 6, color: '#9a3412', fillColor: '#f97316', fillOpacity: 1, weight: 2 })
        .bindPopup(locationPopupHtml(`KML: ${point.name}`, point.lat, point.lon))
        .addTo(state.kmlLayer);
      bounds.push([point.lat, point.lon]);
    }
    if (state.kmlVisible) state.kmlLayer.addTo(state.map);
    else state.map.removeLayer(state.kmlLayer);
    updateKmlButton();
    if (fitAfterRender && bounds.length) state.map.fitBounds(bounds, { padding: [35, 35], maxZoom: 16 });
  }

  function toggleKmlLayer() {
    if (!state.importedKml) return;
    state.kmlVisible = !state.kmlVisible;
    if (state.kmlVisible) state.kmlLayer.addTo(state.map);
    else state.map.removeLayer(state.kmlLayer);
    updateKmlButton();
  }

  function updateKmlButton() {
    const button = $('toggle-kml');
    if (!state.importedKml) {
      button.textContent = 'No KML';
      button.title = 'Import a KML from the top-right menu';
      button.disabled = true;
      return;
    }
    button.disabled = false;
    button.textContent = state.kmlVisible ? 'Hide KML' : 'Show KML';
    button.title = `${state.importedKml.points.length} points, ${state.importedKml.lines.length} lines`;
  }

  function toggleBaseMap() {
    setBaseMap(state.baseMapType === 'topo' ? 'street' : 'topo');
  }

  function setBaseMap(type) {
    const nextType = type === 'topo' ? 'topo' : 'street';
    if (state.baseLayer) state.map.removeLayer(state.baseLayer);
    state.baseLayer = createBaseLayer(nextType).addTo(state.map);
    state.baseMapType = nextType;
    saveBaseMapType(nextType);
    updateBaseMapButton();
  }

  function createBaseLayer(type) {
    if (type === 'topo') {
      return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
      });
    }
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    });
  }

  function updateBaseMapButton() {
    const button = $('toggle-basemap');
    const current = state.baseMapType === 'topo' ? 'Topo' : 'Street';
    const next = state.baseMapType === 'topo' ? 'Street' : 'Topo';
    button.textContent = `🗺️ ${next}`;
    button.title = `Map: ${current}. Switch to ${next}.`;
  }

  function fitBoth() {
    if (!state.racer) return;
    if (state.me) state.map.fitBounds([[state.me.lat, state.me.lon], [state.racer.lat, state.racer.lon]], { padding: [40, 40], maxZoom: 16 });
    else centerRacer();
  }

  function centerRacer() { if (state.racer) state.map.setView([state.racer.lat, state.racer.lon], Math.max(state.map.getZoom(), 15)); }
  function centerMe() { if (state.me) state.map.setView([state.me.lat, state.me.lon], Math.max(state.map.getZoom(), 15)); }
  function maybeInitialFit() { if (!state.firstFitDone && state.racer && state.me) { fitBoth(); state.firstFitDone = true; } else if (!state.firstFitDone && state.racer) centerRacer(); }

  function parseMapNameFromPath() {
    const first = location.pathname.split('/').filter(Boolean)[0] || '';
    return first && first !== 'api' ? sanitizeName(first) : '';
  }

  function parseSharedMap(params) {
    const candidates = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean);
    for (const candidate of candidates) {
      const garminUrl = String(candidate).match(/(?:https?:\/\/)?share\.garmin\.com\/[^\s<>"']+/i)?.[0];
      const parsed = parseMapName(garminUrl ? (garminUrl.includes('://') ? garminUrl : `https://${garminUrl}`) : candidate);
      if (parsed) return parsed;
    }
    return '';
  }

  function parseMapName(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw.includes('://') ? raw : `https://share.garmin.com/${raw}`);
      const parts = u.pathname.split('/').filter(Boolean);
      let name = '';
      if (parts[0] === 'feed' && parts[1] === 'share') name = parts[2] || '';
      else name = parts[0] || '';
      return sanitizeName(name);
    } catch (_) {
      return sanitizeName(raw.replace(/^\/+|\/+$/g, ''));
    }
  }

  function sanitizeName(name) { return /^[A-Za-z0-9_-]{1,100}$/.test(name) ? name : ''; }
  function loadSavedMapName() { try { return sanitizeName(localStorage.getItem(STORE_KEY) || ''); } catch (_) { return ''; } }
  function saveMapName(name) { try { localStorage.setItem(STORE_KEY, name); } catch (_) {} }
  function clearSavedMapName() { try { localStorage.removeItem(STORE_KEY); } catch (_) {} }
  function loadBaseMapType() { try { return localStorage.getItem(BASE_MAP_KEY) === 'topo' ? 'topo' : 'street'; } catch (_) { return 'street'; } }
  function saveBaseMapType(type) { try { localStorage.setItem(BASE_MAP_KEY, type); } catch (_) {} }
  function loadSavedKml() { try { return localStorage.getItem(KML_KEY) || ''; } catch (_) { return ''; } }
  function saveImportedKml(text) { try { localStorage.setItem(KML_KEY, text); } catch (_) {} }
  function showSetupError(msg) { $('setup-error').textContent = msg; }
  function setText(id, text) { $(id).textContent = text; }
  function textOf(el, localName) { const found = Array.from(el.childNodes).find((n) => n.localName === localName); return found ? found.textContent.trim() : ''; }
  function dedupeLatLon(points) { const out = []; let prev = null; for (const p of points) { if (!prev || Math.abs(prev.lat - p.lat) > 1e-7 || Math.abs(prev.lon - p.lon) > 1e-7) out.push(p); prev = p; } return out; }
  function parseGarminUtc(s) { if (!s) return 0; const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i); if (!m) return Date.parse(`${s} UTC`) || Date.parse(s) || 0; let [, mo, da, yr, hr, mi, se, ap] = m; let h = Number(hr) % 12; if (ap.toUpperCase() === 'PM') h += 12; return Date.UTC(Number(yr), Number(mo) - 1, Number(da), h, Number(mi), Number(se)); }
  function infoText(r) { const parts = [`Updated: ${r.time || r.timeUtc || '—'}`]; if (r.ele != null) parts.push(`Elev: ${Math.round(r.ele)} m`); if (r.gpsFix) parts.push(`GPS fix: ${r.gpsFix}`); if (r.emergency === 'True') parts.push('EMERGENCY'); if (r.text) parts.push(`Text: ${r.text}`); return parts.join(' · '); }
  function staleMinutes(r) { return r.utcMs ? (Date.now() - r.utcMs) / 60000 : null; }
  function formatDistance(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`; }
  function formatKm(m) { return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`; }
  function formatElevation(m) { return m == null ? '—' : `${Math.round(m)} m`; }
  function accuracyStyle(accuracy) { return { radius: accuracy || 0, color: '#1a73e8', weight: 2, opacity: 0.65, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }; }
  function distanceM(lat1, lon1, lat2, lon2) { const R = 6371000, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
  function bearingDeg(lat1, lon1, lat2, lon2) { const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const y = Math.sin(dl) * Math.cos(p2); const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker registration failed:', err));
    });
  }
})();
