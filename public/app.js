(() => {
  'use strict';

  const STORE_KEY = 'garminRaceTracker.mapName';
  const BASE_MAP_KEY = 'garminRaceTracker.baseMap';
  const KML_KEY = 'garminRaceTracker.importedKml';
  const SOURCE_FEATURES_KEY = 'garminRaceTracker.sourceFeaturesVisible';
  const TRANSCAPIXABA_PATH = '/race/transcapixaba-2026';
  const TRANSCAPIXABA_START = '2026-07-12T03:00:00Z';
  const TRANSCAPIXABA_END = '2026-07-26T02:59:59Z';
  const HISTORY_CACHE_VERSION = 1;
  const REFRESH_MS = 60000;
  const SPOT_REFRESH_MS = 150000;
  const STALE_AFTER_MIN = 15;
  const FLYMASTER_WS_URL = 'wss://lb.flymaster.net:8081';
  const FLYMASTER_EPOCH_MS = Date.UTC(2000, 0, 1);

  const $ = (id) => document.getElementById(id);
  const state = {
    mapName: '',
    soloSource: null,
    map: null,
    baseLayer: null,
    baseMapType: 'street',
    layers: null,
    featureLayers: null,
    waypointLayer: null,
    routeLayer: null,
    trackLayer: null,
    kmlLayer: null,
    raceTrackLayer: null,
    racerMarker: null,
    racerMarkers: new Map(),
    race: null,
    racers: [],
    selectedRacerIds: new Set(),
    visibleRaceTrackIds: new Set(),
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
    raceMode: false,
    mapFeatures: { waypoints: [], routes: [], collections: null, source: '' },
    flymasterTaskId: '',
    flymasterTaskLoading: null,
    sourceFeaturesVisible: true,
    sourceFeaturesDetected: false,
    sourceFeatureSource: null,
    importedKml: null,
    kmlVisible: true,
    firstFitDone: false,
    flymaster: null,
    flymasterSourceIndex: new Map(),
  };

  $('setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const source = parseSoloSource($('map-input').value);
    if (!source) return showSetupError('Paste a Garmin MapShare username/link or a FindMeSPOT feed ID/link.');
    if (source.type === 'garmin-mapshare') {
      saveMapName(source.name);
      location.assign(`/${encodeURIComponent(source.name)}`);
    } else if (source.type === 'spot') {
      location.assign(`/spot/${encodeURIComponent(source.id)}`);
    }
  });
  $('enter-race').addEventListener('click', () => location.assign(TRANSCAPIXABA_PATH));

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
  $('switch-race').addEventListener('click', switchRaceMode);
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
    const followButton = event.target.closest('[data-follow-racer]');
    if (followButton) {
      event.preventDefault();
      event.stopPropagation();
      toggleSelectedRacer(followButton.dataset.followRacer);
      return;
    }
    const trackButton = event.target.closest('[data-toggle-track-racer]');
    if (trackButton) {
      event.preventDefault();
      event.stopPropagation();
      toggleRaceTrack(trackButton.dataset.toggleTrackRacer);
      return;
    }
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
  $('toggle-source-features').addEventListener('click', toggleSourceFeatures);
  $('kml-file').addEventListener('change', importKmlFile);

  const launchParams = new URL(location.href).searchParams;
  if (launchParams.has('share-target')) {
    handleShareTargetLaunch();
    return;
  }

  const flymasterRace = parseFlymasterRaceParams(launchParams, location.pathname);
  if (flymasterRace) {
    startRaceFromFlymaster(flymasterRace);
    return;
  }

  const raceSheet = parseRaceSheetParams(launchParams, location.pathname);
  if (raceSheet) {
    startRaceFromSheet(raceSheet);
    return;
  }

  const sharedMap = parseSharedMap(launchParams);
  if (sharedMap) {
    saveMapName(sharedMap);
    location.replace(`/${encodeURIComponent(sharedMap)}`);
    return;
  }

  const explicitSource = parseSoloSource(launchParams.get('spot') || launchParams.get('source') || launchParams.get('map') || '') || parseSoloSourceFromPath();
  const savedMap = loadSavedMapName();
  if (explicitSource) {
    $('map-input').value = explicitSource.raw || explicitSource.name || explicitSource.id || '';
    startSolo(explicitSource);
  } else {
    $('map-input').value = savedMap || '';
  }

  async function startSolo(source) {
    disconnectFlymasterGroup();
    state.soloSource = source;
    state.mapName = source.type === 'garmin-mapshare' ? source.name : '';
    $('setup').classList.add('hidden');
    $('tracker').classList.remove('hidden');
    state.raceMode = false;
    updateHeader();
    updateRaceSwitchMenu();
    if (source.type === 'garmin-mapshare') saveMapName(source.name);

    if (!state.map) initMap();
    startOwnLocation();
    await refreshAll();
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(refreshAll, REFRESH_MS);
  }

  async function startRaceFromSheet(spec) {
    disconnectFlymasterGroup();
    state.raceMode = true;
    updateRaceSwitchMenu();
    $('setup').classList.add('hidden');
    $('tracker').classList.remove('hidden');
    updateHeader('Loading race…');
    if (!state.map) initMap();
    startOwnLocation();
    try {
      const race = await loadRaceFromSheet(spec);
      state.race = race;
      state.racers = race.racers;
      indexFlymasterSources();
      state.sourceFeatureSource = race.sourceFeatureSource;
      state.selectedRacerIds = loadSelectedRacers(race.id);
      state.visibleRaceTrackIds = loadVisibleRaceTracks(race.id);
      updateHeader();
      updateFitButton();
      await refreshAll();
      clearInterval(state.refreshTimer);
      state.refreshTimer = setInterval(refreshAll, REFRESH_MS);
    } catch (err) {
      console.error(err);
      setText('racer-status', 'race error');
      setText('info', err.message || String(err));
    }
  }

  async function startRaceFromFlymaster(spec) {
    disconnectFlymasterGroup();
    state.raceMode = true;
    updateRaceSwitchMenu();
    $('setup').classList.add('hidden');
    $('tracker').classList.remove('hidden');
    updateHeader('Loading Flymaster…');
    if (!state.map) initMap();
    startOwnLocation();
    const race = { id: `flymaster:${spec.groupId}`, name: spec.name || `Flymaster group ${spec.groupId}`, racers: [], sourceFeatureSource: null, flymasterGroupId: spec.groupId, flymasterDynamic: true };
    state.race = race;
    state.racers = race.racers;
    state.sourceFeatureSource = null;
    state.selectedRacerIds = loadSelectedRacers(race.id);
    state.visibleRaceTrackIds = loadVisibleRaceTracks(race.id);
    try {
      const info = await fetchJson(flymasterApiUrl('group', { grp: spec.groupId }));
      if (!spec.name && info?.name) race.name = info.name;
      const lat = Number(info?.center_lat);
      const lon = Number(info?.center_lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) state.map.setView([lat, lon], Number(info?.gZoom) || 8);
    } catch (err) {
      console.warn('Flymaster group metadata failed', err);
    }
    updateHeader();
    updateFitButton();
    try {
      await refreshAll();
      clearInterval(state.refreshTimer);
      state.refreshTimer = setInterval(refreshAll, REFRESH_MS);
    } catch (err) {
      console.error(err);
      setText('racer-status', 'Flymaster error');
      setText('info', err.message || String(err));
    }
  }

  async function refreshAll() {
    if (state.raceMode) {
      await Promise.allSettled([refreshRaceRacers()]);
    } else {
      const tasks = [refreshRacer()];
      if (state.soloSource?.type === 'garmin-mapshare') tasks.push(loadMapFeatures());
      await Promise.allSettled(tasks);
    }
  }

  function initMap() {
    state.map = L.map('map', { zoomControl: true }).setView([0, 0], 2);
    setBaseMap(loadBaseMapType());
    state.layers = L.layerGroup().addTo(state.map);
    state.sourceFeaturesVisible = loadSourceFeaturesVisible();
    state.featureLayers = L.layerGroup();
    if (state.sourceFeaturesVisible) state.featureLayers.addTo(state.map);
    state.routeLayer = L.layerGroup().addTo(state.featureLayers);
    state.trackLayer = L.layerGroup().addTo(state.featureLayers);
    state.waypointLayer = L.layerGroup().addTo(state.featureLayers);
    state.kmlLayer = L.layerGroup().addTo(state.map);
    state.raceTrackLayer = L.layerGroup().addTo(state.map);
    state.measureLayer = L.layerGroup().addTo(state.map);
    state.racerTrail = L.polyline([], { color: '#64748b', weight: 4, opacity: 0.55, dashArray: '8 8' }).addTo(state.trackLayer);
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
      let racer = null;
      if (state.soloSource?.type === 'spot') {
        racer = await fetchSpotPosition(state.soloSource);
      } else {
        const xmlText = await fetchText(apiUrl('feed'));
        racer = parseKml(xmlText);
      }
      if (!racer) throw new Error('No usable location found for this source.');
      racer.history = mergePositionHistory(state.racer, racer);
      state.racer = racer;
      updateHeader();
      updateRacerLayer();
      updatePanel();
      maybeInitialFit();
    } catch (err) {
      console.error(err);
      setText('racer-status', 'feed error');
      setText('info', err.message || String(err));
    }
  }

  async function refreshRaceRacers() {
    if (state.race?.flymasterDynamic) return refreshFlymasterRace();
    if (!state.racers.length) return;
    setText('racer-status', 'refreshing…');
    const tasks = state.race?.flymasterGroupId ? [connectFlymasterGroup(state.race.flymasterGroupId).catch((err) => console.warn('Flymaster connection failed', err))] : [];
    tasks.push(...state.racers.map(refreshRaceRacer));
    await Promise.allSettled(tasks);
    renderRaceRacers();
    updateRaceSourceFeatureTrack();
    updateSourceFeaturesMenu();
    updatePanel();
    updateConnector();
    maybeInitialFit();
  }

  async function refreshRaceRacer(racer) {
    const results = await Promise.allSettled(racer.sources.map((source) => refreshRacerSource(racer, source)));
    const positions = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    positions.sort((a, b) => (b.utcMs || 0) - (a.utcMs || 0));
    const latest = positions[0] || null;
    if (latest) latest.history = mergePositionHistory(racer.position, latest);
    racer.position = latest;
    racer.error = positions.length ? '' : (results.find((r) => r.status === 'rejected')?.reason?.message || 'No supported source position');
  }

  async function refreshRacerSource(racer, source) {
    let position = null;
    if (source.type === 'garmin-mapshare') {
      position = await fetchGarminPosition(source);
      if (!position) throw new Error(`No Garmin position for ${source.name}`);
    } else if (source.type === 'spot') {
      position = await fetchSpotPosition(source);
      if (!position) throw new Error(`No SPOT position for ${source.id}`);
    } else if (source.type === 'flymaster') {
      position = await fetchFlymasterPosition(source);
      if (!position) throw new Error(`No Flymaster position for ${source.id}`);
    } else {
      throw new Error(`Unsupported source: ${source.type || 'unknown'}`);
    }
    const normalized = decorateSourcePosition(position, racer, source);
    source.latestPosition = clonePosition(normalized);
    return normalized;
  }

  async function fetchGarminPosition(source) {
    const race = state.raceMode ? state.race : null;
    const cached = race ? loadSourceHistoryCache(race.id, source) : null;
    let historical = cached;
    if (race?.start && !historical) {
      try {
        const ranged = parseKml(await fetchText(apiUrlForName(source.name, 'feed', { d1: race.start, d2: race.end || new Date().toISOString() })));
        if (ranged) {
          historical = ranged;
          saveSourceHistoryCache(race.id, source, ranged);
        }
      } catch (err) {
        console.warn(`Garmin history backfill failed for ${source.name}`, err);
      }
    }

    let latest = null;
    try {
      latest = parseKml(await fetchText(apiUrlForName(source.name, 'feed')));
    } catch (err) {
      if (historical) return clonePosition(historical);
      throw err;
    }
    if (!latest) return historical ? clonePosition(historical) : null;
    if (historical) latest.history = mergePositionHistory(historical, latest);
    if (race?.start) saveSourceHistoryCache(race.id, source, latest);
    return latest;
  }

  async function fetchFlymasterPosition(source) {
    const groupId = state.race?.flymasterGroupId || source.groupId;
    if (!groupId) throw new Error('Missing Flymaster group id');
    await connectFlymasterGroup(groupId).catch((err) => {
      if (!source.flymasterPosition) throw err;
    });
    return source.flymasterPosition ? clonePosition(source.flymasterPosition) : null;
  }

  async function fetchSpotPosition(source) {
    const now = Date.now();
    if (source.spotFetchedAt && now - source.spotFetchedAt < SPOT_REFRESH_MS) {
      if (source.spotPosition) return clonePosition(source.spotPosition);
      throw new Error(source.spotError || 'No recent SPOT position');
    }
    if (source.spotInFlight) return clonePosition(await source.spotInFlight);
    source.spotInFlight = fetchJson(spotApiUrl(source.id)).then((data) => {
      const position = parseSpotFeed(data, source.id);
      if (!position) throw new Error('No SPOT position');
      source.spotPosition = clonePosition(position);
      source.spotError = '';
      return position;
    }).catch((err) => {
      source.spotPosition = null;
      source.spotError = err?.message || String(err);
      throw err;
    }).finally(() => {
      source.spotFetchedAt = Date.now();
      source.spotInFlight = null;
    });
    return clonePosition(await source.spotInFlight);
  }

  function decorateSourcePosition(position, racer, source) {
    return Object.assign(clonePosition(position), {
      racerId: racer.id,
      name: racer.name,
      sourceLabel: source.label,
      sourceName: source.name || source.id || '',
      sourceType: source.type,
    });
  }

  function clonePosition(position) {
    if (!position) return position;
    return Object.assign({}, position, { history: position.history ? position.history.map((p) => Object.assign({}, p)) : position.history });
  }

  function renderRaceRacers() {
    const seen = new Set();
    for (const racer of state.racers) {
      if (!racer.position) continue;
      seen.add(racer.id);
      const r = racer.position;
      const ll = [r.lat, r.lon];
      const selected = state.selectedRacerIds.has(racer.id);
      const color = racerColor(racer.id);
      const icon = L.divIcon({
        className: 'racer-icon-wrap', iconSize: [170, 38], iconAnchor: [19, 19], popupAnchor: [0, -20],
        html: `<div class="racer-icon ${selected ? 'selected' : ''}" style="background:${color}"><div class="racer-arrow" style="border-bottom-color:${color};transform:rotate(${Number.isFinite(r.courseDeg) ? r.courseDeg : 0}deg);opacity:${Number.isFinite(r.courseDeg) ? 1 : 0.25}"></div></div><div class="racer-label ${selected ? 'selected' : ''}">${escapeHtml(racer.name)}</div>`,
      });
      let marker = state.racerMarkers.get(racer.id);
      if (!marker) {
        marker = L.marker(ll, { icon, zIndexOffset: selected ? 4500 : 4000, title: racer.name, bubblingMouseEvents: false }).addTo(state.layers);
        state.racerMarkers.set(racer.id, marker);
      } else {
        marker.setLatLng(ll);
        marker.setIcon(icon);
        marker.setZIndexOffset(selected ? 4500 : 4000);
      }
      marker.bindPopup(raceRacerPopupHtml(racer));
    }
    for (const [id, marker] of state.racerMarkers.entries()) {
      if (!seen.has(id)) {
        state.layers.removeLayer(marker);
        state.racerMarkers.delete(id);
      }
    }
    renderRaceTracks();
  }

  function raceRacerPopupHtml(racer) {
    const r = racer.position;
    const selected = state.selectedRacerIds.has(racer.id);
    const trackVisible = state.visibleRaceTrackIds.has(racer.id);
    const hasTrack = !!(r.history && r.history.length > 1);
    const details = `Speed: ${escapeHtml(r.speedText)}<br>Elev: ${formatElevation(r.ele)}<br>Updated: ${escapeHtml(formatUpdatedTime(r))}<br>Source: ${escapeHtml(r.sourceLabel || r.sourceName || sourceTypeLabel(r.sourceType))}`;
    const trackButton = hasTrack
      ? `<button type="button" data-toggle-track-racer="${escapeHtml(racer.id)}">${trackVisible ? 'Hide track' : 'Show track'}</button>`
      : '<button type="button" disabled title="The tracking source has not published enough history points for this racer yet">No track yet</button>';
    return `${locationPopupHtml(racer.name, r.lat, r.lon, details)}<div class="map-popup-actions"><button type="button" data-follow-racer="${escapeHtml(racer.id)}">${selected ? 'Unfollow racer' : 'Follow racer'}</button>${trackButton}</div>`;
  }

  function renderRaceTracks() {
    if (!state.raceTrackLayer) return;
    state.raceTrackLayer.clearLayers();
    for (const racer of state.racers) {
      const history = racer.position?.history || [];
      if (!state.visibleRaceTrackIds.has(racer.id) || history.length < 2) continue;
      L.polyline(history.map((p) => [p.lat, p.lon]), {
        color: racerColor(racer.id),
        weight: 4,
        opacity: 0.85,
      }).bindPopup(`<b>${escapeHtml(racer.name)} track</b><br>${history.length} points`).addTo(state.raceTrackLayer);
    }
  }

  function toggleRaceTrack(id) {
    if (!id || !state.raceMode || !state.race) return;
    if (state.visibleRaceTrackIds.has(id)) state.visibleRaceTrackIds.delete(id);
    else state.visibleRaceTrackIds.add(id);
    saveVisibleRaceTracks(state.race.id, state.visibleRaceTrackIds);
    renderRaceTracks();
    refreshOpenRacerPopup(id);
  }

  function refreshOpenRacerPopup(id) {
    const racer = state.racers.find((item) => item.id === id);
    const marker = state.racerMarkers.get(id);
    if (!racer || !marker) return;
    const popup = marker.getPopup && marker.getPopup();
    if (popup) popup.setContent(raceRacerPopupHtml(racer));
  }

  async function loadMapFeatures(mapName = state.mapName) {
    if (!mapName) return;
    try {
      const [waypointsRes, routesRes, collectionsRes] = await Promise.allSettled([
        fetchJson(apiUrlForName(mapName, 'waypoints')),
        fetchJson(apiUrlForName(mapName, 'routes')),
        fetchJson(apiUrlForName(mapName, 'collections')),
      ]);
      state.mapFeatures = {
        waypoints: waypointsRes.status === 'fulfilled' ? normalizeWaypoints(waypointsRes.value) : [],
        routes: routesRes.status === 'fulfilled' ? normalizeRoutes(routesRes.value) : [],
        collections: collectionsRes.status === 'fulfilled' ? collectionsRes.value : null,
      };
      renderMapFeatures();
      updateSourceFeaturesMenu();
    } catch (err) {
      console.warn('Map feature load failed', err);
    }
  }

  function apiUrl(type) {
    return apiUrlForName(state.mapName, type);
  }

  function apiUrlForName(name, type, options = {}) {
    const params = new URLSearchParams({ name, type, _: String(Date.now()) });
    if (options.d1) params.set('d1', options.d1);
    if (options.d2) params.set('d2', options.d2);
    return `/api/garmin?${params}`;
  }

  function spotApiUrl(id) {
    return `/api/spot?id=${encodeURIComponent(id)}&type=message`;
  }

  function flymasterApiUrl(type, params = {}) {
    const query = new URLSearchParams({ type, _: String(Date.now()) });
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    return `/api/flymaster?${query}`;
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

  async function refreshFlymasterRace() {
    const groupId = state.race?.flymasterGroupId;
    if (!groupId) return;
    setText('racer-status', state.flymaster?.connected ? 'Flymaster live' : 'connecting…');
    try {
      await connectFlymasterGroup(groupId);
    } catch (err) {
      console.warn('Flymaster connection failed', err);
      setText('info', err.message || String(err));
    }
    updateFlymasterRaceView();
  }

  function connectFlymasterGroup(groupId) {
    const existing = state.flymaster;
    if (existing?.groupId === groupId && existing.ws && existing.ws.readyState <= WebSocket.OPEN) {
      return existing.firstDataPromise || Promise.resolve();
    }
    disconnectFlymasterGroup();
    const fm = {
      groupId,
      ws: null,
      pilots: new Map(),
      connected: false,
      lastMessageAt: 0,
      renderPending: false,
      reconnectTimer: null,
      firstDataDone: false,
      firstDataResolve: null,
      firstDataReject: null,
      firstDataPromise: null,
    };
    fm.firstDataPromise = new Promise((resolve, reject) => {
      fm.firstDataResolve = resolve;
      fm.firstDataReject = reject;
      setTimeout(() => {
        if (!fm.firstDataDone) reject(new Error('Timed out waiting for Flymaster data.'));
      }, 15000);
    });
    state.flymaster = fm;
    openFlymasterSocket(fm);
    return fm.firstDataPromise;
  }

  function openFlymasterSocket(fm) {
    if (typeof WebSocket !== 'function') throw new Error('This browser does not support WebSockets.');
    if (!window.msgpack?.decode) throw new Error('Flymaster MessagePack decoder did not load.');
    const ws = new WebSocket(FLYMASTER_WS_URL);
    fm.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      fm.connected = true;
      ws.send(JSON.stringify({ group_id: Number(fm.groupId), d: 0 }));
      updateFlymasterRaceView();
    };
    ws.onmessage = async (event) => {
      try {
        const data = await decodeFlymasterMessage(event.data);
        if (!data) return;
        fm.lastMessageAt = Date.now();
        handleFlymasterMessage(fm, data);
        if (!fm.firstDataDone) {
          fm.firstDataDone = true;
          fm.firstDataResolve();
        }
      } catch (err) {
        console.warn('Flymaster message decode failed', err);
      }
    };
    ws.onerror = () => {
      if (!fm.firstDataDone) fm.firstDataReject(new Error('Flymaster WebSocket error.'));
    };
    ws.onclose = () => {
      fm.connected = false;
      if (state.flymaster !== fm) return;
      updateFlymasterRaceView();
      if (!fm.reconnectTimer) {
        fm.reconnectTimer = setTimeout(() => {
          fm.reconnectTimer = null;
          if (state.flymaster === fm) openFlymasterSocket(fm);
        }, 5000);
      }
    };
  }

  function disconnectFlymasterGroup() {
    const fm = state.flymaster;
    if (!fm) return;
    if (fm.reconnectTimer) clearTimeout(fm.reconnectTimer);
    try { fm.ws?.close(); } catch (_) {}
    state.flymaster = null;
  }

  async function decodeFlymasterMessage(data) {
    if (data instanceof ArrayBuffer) return window.msgpack.decode(new Uint8Array(data));
    if (data instanceof Blob) return window.msgpack.decode(new Uint8Array(await data.arrayBuffer()));
    if (typeof data === 'string') return JSON.parse(data);
    return null;
  }

  function handleFlymasterMessage(fm, data) {
    if (data.tk) maybeLoadFlymasterTask(data.tk, fm.groupId);
    if (data.type === 'pilot_list' && Array.isArray(data.pilots)) {
      for (const pilot of data.pilots) {
        const sn = String(pilot.sn || '').trim();
        if (!sn) continue;
        fm.pilots.set(sn, pilot);
        const position = flymasterPositionFromPilot(pilot, pilot.nm, fm.groupId);
        if (position) applyFlymasterIncomingPosition(sn, position);
      }
      if (state.race?.flymasterDynamic) state.racers.sort((a, b) => a.name.localeCompare(b.name));
      scheduleFlymasterRaceRender(fm);
    } else if (data.type === 'tick' && Array.isArray(data.markers)) {
      for (const marker of data.markers) {
        const sn = String(marker[1] || '').trim();
        if (!sn) continue;
        const pilot = fm.pilots.get(sn);
        const position = flymasterPositionFromMarker(marker, pilot?.nm, fm.groupId);
        if (position) applyFlymasterIncomingPosition(sn, position);
      }
      scheduleFlymasterRaceRender(fm);
    }
  }

  function applyFlymasterIncomingPosition(sn, position) {
    if (state.race?.flymasterDynamic) {
      const racer = upsertFlymasterRacer(sn, position.name);
      position.name = racer.name;
      applyFlymasterPosition(racer, position);
      return;
    }

    const matches = state.flymasterSourceIndex.get(String(sn)) || [];
    for (const { racer, source } of matches) {
      const normalized = decorateSourcePosition(Object.assign({}, position, { name: racer.name }), racer, source);
      source.flymasterPosition = clonePosition(position);
      source.latestPosition = clonePosition(normalized);
      updateRacerFromSourceCache(racer);
    }
  }

  function updateRacerFromSourceCache(racer) {
    const positions = racer.sources.map((source) => source.latestPosition).filter(Boolean).map(clonePosition);
    positions.sort((a, b) => (b.utcMs || 0) - (a.utcMs || 0));
    const latest = positions[0] || null;
    if (latest) latest.history = mergePositionHistory(racer.position, latest);
    racer.position = latest;
    racer.error = positions.length ? '' : racer.error;
  }

  function indexFlymasterSources() {
    const index = new Map();
    for (const racer of state.racers) {
      for (const source of racer.sources) {
        if (source.type !== 'flymaster' || !source.id) continue;
        const id = String(source.id).trim();
        if (!index.has(id)) index.set(id, []);
        index.get(id).push({ racer, source });
      }
    }
    state.flymasterSourceIndex = index;
  }

  function maybeLoadFlymasterTask(taskId, groupId) {
    const id = String(taskId || '').trim();
    if (!/^\d{1,12}$/.test(id) || state.flymasterTaskId === id || state.flymasterTaskLoading === id) return;
    state.flymasterTaskLoading = id;
    fetchJson(flymasterApiUrl('task', { task: id, grp: groupId || state.race?.flymasterGroupId || '' }))
      .then((task) => {
        if (state.flymasterTaskLoading !== id && state.flymasterTaskId === id) return;
        state.flymasterTaskId = id;
        state.mapFeatures = normalizeFlymasterTask(task, id);
        renderMapFeatures();
        updateSourceFeaturesMenu();
      })
      .catch((err) => console.warn(`Flymaster task ${id} load failed`, err))
      .finally(() => {
        if (state.flymasterTaskLoading === id) state.flymasterTaskLoading = null;
      });
  }

  function upsertFlymasterRacer(sn, name) {
    const id = `flymaster-${sn}`;
    let racer = state.racers.find((item) => item.id === id);
    const cleanName = String(name || '').trim() || `Flymaster ${sn}`;
    if (!racer) {
      racer = { id, name: cleanName, sources: [{ type: 'flymaster', label: 'Flymaster', id: sn, groupId: state.race?.flymasterGroupId || '' }], unsupportedSources: [], position: null, error: '' };
      state.racers.push(racer);
    } else if (cleanName && racer.name !== cleanName && /^Flymaster \d+$/.test(racer.name)) {
      racer.name = cleanName;
    }
    return racer;
  }

  function flymasterPositionFromPilot(pilot, name, groupId) {
    const lat = Number(pilot.a);
    const lon = Number(pilot.o);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const ele = numberOrNull(pilot.h);
    const terrain = numberOrNull(pilot.s);
    const agl = ele != null && terrain != null ? ele - terrain : null;
    return makeFlymasterPosition({
      id: pilot.sn,
      name,
      groupId,
      lat,
      lon,
      ele,
      agl,
      speed: numberOrNull(pilot.v),
      course: numberOrNull(pilot.b),
      stamp: numberOrNull(pilot.d),
    });
  }

  function flymasterPositionFromMarker(marker, name, groupId) {
    const lat = Number(marker[2]) / 60000;
    const lon = Number(marker[3]) / 60000;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return makeFlymasterPosition({
      id: marker[1],
      name,
      groupId,
      lat,
      lon,
      ele: numberOrNull(marker[4]),
      agl: numberOrNull(marker[5]),
      speed: numberOrNull(marker[6]),
      course: numberOrNull(marker[7]),
      stamp: numberOrNull(marker[11]),
    });
  }

  function makeFlymasterPosition(data) {
    const utcMs = flymasterUtcMs(data.stamp);
    const aglText = data.agl != null && data.agl >= 0 ? `AGL: ${Math.round(data.agl)} m` : '';
    return {
      id: String(data.id || ''),
      name: data.name || 'Flymaster',
      lat: data.lat,
      lon: data.lon,
      ele: data.ele,
      aglM: data.agl,
      speedText: data.speed != null && data.speed >= 0 ? `${Math.round(data.speed)} km/h` : '—',
      speedKmh: data.speed ?? NaN,
      courseText: data.course != null ? `${Math.round(data.course)}°` : '—',
      courseDeg: data.course ?? NaN,
      time: formatFlymasterTime(utcMs),
      timeUtc: formatFlymasterTime(utcMs),
      utcMs,
      gpsFix: '',
      emergency: '',
      text: aglText,
      sourceLabel: 'Flymaster',
      sourceName: `grp ${data.groupId}`,
      sourceType: 'flymaster',
    };
  }

  function applyFlymasterPosition(racer, position) {
    position.history = mergePositionHistory(racer.position, position).slice(-1500);
    racer.position = position;
    racer.error = '';
  }

  function scheduleFlymasterRaceRender(fm) {
    if (fm.renderPending) return;
    fm.renderPending = true;
    requestAnimationFrame(() => {
      fm.renderPending = false;
      if (state.flymaster === fm) updateFlymasterRaceView();
    });
  }

  function updateFlymasterRaceView() {
    renderRaceRacers();
    updatePanel();
    updateConnector();
    maybeInitialFit();
  }

  function flymasterUtcMs(seconds) {
    const raw = Number(seconds);
    return Number.isFinite(raw) && raw > 0 ? FLYMASTER_EPOCH_MS + raw * 1000 : 0;
  }

  function formatFlymasterTime(utcMs) {
    return utcMs ? new Date(utcMs).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '';
  }

  function numberOrNull(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
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
    if (latest) {
      const trackPoints = extractKmlTrackPoints(doc);
      latest.history = trackPoints.length > 1 ? trackPoints : dedupeLatLon(points.slice().reverse());
    }
    return latest;
  }

  function extractKmlTrackPoints(doc) {
    const points = [];
    for (const line of Array.from(doc.getElementsByTagNameNS('*', 'LineString'))) {
      points.push(...parseKmlCoordinateObjects(textOf(line, 'coordinates')));
    }
    return dedupeLatLon(points);
  }

  function parseSpotFeed(data, fallbackName) {
    const root = data?.feedMessageResponse || data?.response?.feedMessageResponse || data?.response || data || {};
    const feedName = root.feed?.name || fallbackName || 'SPOT';
    const messageNode = root.messages?.message;
    const messages = Array.isArray(messageNode) ? messageNode : (messageNode ? [messageNode] : []);
    const points = messages.map((message) => parseSpotMessage(message, feedName)).filter(Boolean);
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

  function parseSpotMessage(message, feedName) {
    const lat = Number(message.latitude);
    const lon = Number(message.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const ele = Number.parseFloat(message.altitude ?? '');
    const utcMs = parseSpotUtc(message);
    const messageType = String(message.messageType || '').trim();
    const messageContent = String(message.messageContent || '').trim();
    const battery = String(message.batteryState || '').trim();
    const details = [messageType, messageContent, battery ? `Battery: ${battery}` : ''].filter(Boolean).join(' · ');
    return {
      id: String(message.id || ''),
      name: message.messengerName || feedName || 'SPOT',
      lat,
      lon,
      ele: Number.isFinite(ele) ? ele : null,
      speedText: '—',
      speedKmh: NaN,
      courseText: '—',
      courseDeg: NaN,
      time: spotTimeText(message, utcMs),
      timeUtc: spotTimeText(message, utcMs),
      utcMs,
      gpsFix: '',
      emergency: /(help|sos|911)/i.test(messageType) ? 'True' : '',
      text: details,
      messageType,
      batteryState: battery,
    };
  }

  function parseSpotUtc(message) {
    const unixTime = Number(message.unixTime);
    if (Number.isFinite(unixTime) && unixTime > 0) return unixTime * 1000;
    const raw = String(message.dateTime || '').trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    return raw ? Date.parse(raw) || 0 : 0;
  }

  function spotTimeText(message, utcMs) {
    const raw = String(message.dateTime || '').trim();
    if (raw) return raw.replace('T', ' ').replace(/\+0000$/, ' UTC');
    return utcMs ? new Date(utcMs).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '';
  }

  function parseKmlCoordinateObjects(text) {
    return String(text || '').trim().split(/\s+/).map((chunk) => {
      const [lon, lat, ele] = chunk.split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, ele: Number.isFinite(ele) ? ele : null };
    }).filter(Boolean);
  }

  function mergePositionHistory(previous, next) {
    const history = [];
    if (previous?.history?.length) history.push(...previous.history);
    else if (previous) history.push(previous);
    if (next?.history?.length) history.push(...next.history);
    else if (next) history.push(next);
    return dedupePositionHistory(history);
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

  function normalizeFlymasterTask(data, taskId) {
    const items = (Array.isArray(data?.items) ? data.items : []).map((item, index) => {
      const lat = Number(item.a);
      const lon = Number(item.o);
      const radiusM = Number.parseFloat(item.s || '') * 1000;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `${taskId}:${index}`,
        name: item.n || `TP${index}`,
        lat,
        lon,
        radiusM: Number.isFinite(radiusM) ? radiusM : 0,
        type: String(item.type || ''),
        distanceKm: Number.parseFloat(item.d || ''),
      };
    }).filter(Boolean);
    const routePoints = dedupeLatLon(items).map((p) => [p.lat, p.lon]);
    return {
      source: 'flymaster-task',
      taskId,
      waypoints: items,
      routes: routePoints.length >= 2 ? [{ id: taskId, name: `Flymaster task ${taskId}`, color: '#f59f00', points: routePoints }] : [],
      collections: data || null,
    };
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
      const details = wp.radiusM ? `Radius: ${formatDistance(wp.radiusM)}${wp.distanceKm ? `<br>Leg/Dist: ${Number(wp.distanceKm).toFixed(1)} km` : ''}` : '';
      marker.bindPopup(locationPopupHtml(`Waypoint: ${wp.name}`, wp.lat, wp.lon, details));
      if (wp.radiusM && wp.radiusM > 0) {
        L.circle([wp.lat, wp.lon], {
          radius: wp.radiusM,
          color: '#f59f00',
          weight: 2,
          opacity: 0.7,
          fillColor: '#f59f00',
          fillOpacity: 0.06,
          interactive: false,
        }).addTo(state.waypointLayer);
      }
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
    state.racerMarker.bindPopup(locationPopupHtml(r.name, r.lat, r.lon, `Speed: ${escapeHtml(r.speedText)}<br>Elev: ${formatElevation(r.ele)}<br>Course: ${escapeHtml(r.courseText)}<br>Updated: ${escapeHtml(formatUpdatedTime(r))}`));
    if (r.history) state.racerTrail.setLatLngs(r.history.map((p) => [p.lat, p.lon]));
    updateSourceFeaturesMenu();
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
    const target = state.raceMode ? connectorRaceTarget() : state.racer;
    if (target && state.me) {
      const a = [state.me.lat, state.me.lon];
      const b = [target.lat, target.lon];
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
    if (state.raceMode) return updateRacePanel();
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
    state.map.getContainer().classList.add('map-measuring');
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
    if (state.map) state.map.getContainer().classList.remove('map-measuring');
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
      await importKmlText(await file.text(), file.name || 'Imported KML', true);
    } catch (err) {
      console.error(err);
      setText('info', `KML import failed: ${err.message || err}`);
      alert(`KML import failed: ${err.message || err}`);
    }
  }

  async function handleShareTargetLaunch() {
    try {
      const res = await fetch('/share-target-data', { cache: 'no-store' });
      const data = res.ok ? await res.json() : null;
      if (data?.kmlText) await importKmlText(data.kmlText, data.kmlName || 'Shared KML', false);
      const sharedMap = parseSharedMapCandidates([data?.url, data?.text, data?.title].filter(Boolean));
      if (sharedMap) {
        saveMapName(sharedMap);
        location.replace(`/${encodeURIComponent(sharedMap)}`);
        return;
      }
    } catch (err) {
      console.warn('Shared launch failed', err);
    }
    const savedMap = loadSavedMapName();
    location.replace(savedMap ? `/${encodeURIComponent(savedMap)}` : '/');
  }

  async function importKmlText(text, name, fitAfterRender) {
    const imported = parseImportedKml(text, name || 'Imported KML');
    if (!imported.points.length && !imported.lines.length) throw new Error('No points or lines found in KML.');
    state.importedKml = imported;
    state.kmlVisible = true;
    saveImportedKml(text);
    renderImportedKml(fitAfterRender && !!state.map);
    setText('info', `Imported KML: ${imported.points.length} points, ${imported.lines.length} lines.`);
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
      button.classList.add('hidden');
      button.disabled = true;
      return;
    }
    button.classList.remove('hidden');
    button.disabled = false;
    button.textContent = state.kmlVisible ? 'Hide KML' : 'Show KML';
    button.title = `${state.importedKml.points.length} points, ${state.importedKml.lines.length} lines`;
  }

  function toggleSourceFeatures() {
    state.sourceFeaturesVisible = !state.sourceFeaturesVisible;
    saveSourceFeaturesVisible(state.sourceFeaturesVisible);
    if (state.sourceFeaturesVisible) state.featureLayers.addTo(state.map);
    else state.map.removeLayer(state.featureLayers);
    updateSourceFeaturesMenu();
    closeTrackMenu();
  }

  function updateRaceSourceFeatureTrack() {
    if (state.raceMode) state.racerTrail.setLatLngs([]);
  }

  function updateSourceFeaturesMenu() {
    const button = $('toggle-source-features');
    const history = state.raceMode ? [] : state.racer?.history;
    const hasHistory = !!(history && history.length > 1);
    const w = state.mapFeatures.waypoints.length;
    const r = state.mapFeatures.routes.length;
    state.sourceFeaturesDetected = hasHistory || w > 0 || r > 0;
    button.classList.toggle('hidden', !state.sourceFeaturesDetected);
    const label = state.raceMode ? 'race task' : 'Garmin features';
    button.textContent = state.sourceFeaturesVisible ? `Hide ${label}` : `Show ${label}`;
    button.title = state.raceMode ? `${w} turnpoints, ${r} route${state.flymasterTaskId ? ` · Flymaster task ${state.flymasterTaskId}` : ''}` : `${w} waypoints, ${r} routes${hasHistory ? ', history track' : ''}`;
  }

  function switchRaceMode() {
    closeTrackMenu();
    if (state.raceMode) {
      location.assign('/');
    } else {
      location.assign(TRANSCAPIXABA_PATH);
    }
  }

  function updateHeader(overrideTitle = '') {
    const title = overrideTitle || (state.raceMode ? (state.race?.name || 'Race') : 'MapShare Companion');
    const subtitle = state.raceMode ? '' : (state.racer?.name || state.soloSource?.name || state.soloSource?.id || state.mapName || '—');
    setText('app-title', title);
    setText('map-name', subtitle);
    $('app-subtitle').classList.toggle('hidden', !subtitle || state.raceMode);
    document.title = state.raceMode ? title : `${title}${subtitle && subtitle !== '—' ? ` · ${subtitle}` : ''}`;
  }

  function updateRaceSwitchMenu() {
    const button = $('switch-race');
    button.textContent = state.raceMode ? 'Leave race mode' : 'Enter race';
    button.title = state.raceMode ? 'Return to the launcher' : 'Enter Transcapixaba 2026 race mode';
    $('change-map').classList.toggle('hidden', state.raceMode);
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

  function updateRacePanel() {
    const positions = racePositions();
    const stale = positions.filter((r) => staleMinutes(r) != null && staleMinutes(r) > STALE_AFTER_MIN).length;
    const selected = selectedRacePositions();
    setText('racer-status', `${positions.length}/${state.racers.length} live`);
    setText('speed', state.selectedRacerIds.size ? `${selected.length} selected` : 'all');
    setText('elevation', stale ? `${stale} stale` : '—');
    const target = connectorRaceTarget();
    if (state.me && target) {
      const d = distanceM(state.me.lat, state.me.lon, target.lat, target.lon);
      const b = bearingDeg(state.me.lat, state.me.lon, target.lat, target.lon);
      setText('range', `${formatDistance(d)} · ${Math.round(b)}°`);
    } else setText('range', state.me ? 'no racers' : 'waiting GPS');
    const taskInfo = state.flymasterTaskId ? ` · Flymaster task ${state.flymasterTaskId}` : '';
    setText('info', `Race: ${state.race?.name || '—'} · ${state.racers.length} racers · ${supportedSourceSummary()} sources${taskInfo}`);
    updateFitButton();
  }

  function racePositions() { return state.racers.map((r) => r.position).filter(Boolean); }
  function selectedRacePositions() { return state.racers.filter((r) => state.selectedRacerIds.has(r.id)).map((r) => r.position).filter(Boolean); }
  function raceFitTargets() { const selected = selectedRacePositions(); return selected.length ? selected : racePositions(); }
  function connectorRaceTarget() {
    const targets = raceFitTargets();
    if (!targets.length) return null;
    if (!state.me) return targets[0];
    return targets.slice().sort((a, b) => distanceM(state.me.lat, state.me.lon, a.lat, a.lon) - distanceM(state.me.lat, state.me.lon, b.lat, b.lon))[0];
  }

  function fitRaceTargets() {
    const targets = raceFitTargets();
    const bounds = targets.map((r) => [r.lat, r.lon]);
    if (state.me) bounds.push([state.me.lat, state.me.lon]);
    if (bounds.length) state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

  function toggleSelectedRacer(id) {
    if (!id || !state.raceMode) return;
    if (state.selectedRacerIds.has(id)) state.selectedRacerIds.delete(id);
    else state.selectedRacerIds.add(id);
    saveSelectedRacers(state.race.id, state.selectedRacerIds);
    renderRaceRacers();
    refreshOpenRacerPopup(id);
    updatePanel();
    updateConnector();
  }

  function updateFitButton() {
    $('fit-both').textContent = state.raceMode && state.selectedRacerIds.size ? 'Fit selected' : state.raceMode ? 'Fit all' : 'Fit both';
    $('center-racer').textContent = state.raceMode ? 'Racers' : 'Racer';
  }

  function supportedSourceSummary() {
    const counts = state.racers.reduce((acc, racer) => {
      for (const source of racer.sources) acc[source.type] = (acc[source.type] || 0) + 1;
      return acc;
    }, {});
    const parts = [];
    if (counts['garmin-mapshare']) parts.push(`${counts['garmin-mapshare']} Garmin`);
    if (counts.spot) parts.push(`${counts.spot} SPOT`);
    if (counts.flymaster) parts.push(`${counts.flymaster} Flymaster`);
    return parts.length ? parts.join(', ') : '0';
  }

  function fitBoth() {
    if (state.raceMode) return fitRaceTargets();
    if (!state.racer) return;
    if (state.me) state.map.fitBounds([[state.me.lat, state.me.lon], [state.racer.lat, state.racer.lon]], { padding: [40, 40], maxZoom: 16 });
    else centerRacer();
  }

  function centerRacer() { if (state.raceMode) return fitRaceTargets(); if (state.racer) state.map.setView([state.racer.lat, state.racer.lon], Math.max(state.map.getZoom(), 15)); }
  function centerMe() { if (state.me) state.map.setView([state.me.lat, state.me.lon], Math.max(state.map.getZoom(), 15)); }
  function maybeInitialFit() { if (state.raceMode) { if (!state.firstFitDone && racePositions().length) { fitRaceTargets(); state.firstFitDone = true; } return; } if (!state.firstFitDone && state.racer && state.me) { fitBoth(); state.firstFitDone = true; } else if (!state.firstFitDone && state.racer) centerRacer(); }

  function parseRaceDateConfig(value, timezone) {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') return sheetSerialDateToIso(value, timezone);
    const raw = String(value || '').trim();
    if (!raw) return '';
    const native = Date.parse(raw);
    if (Number.isFinite(native) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return new Date(native).toISOString();
    const parsed = parseLocalDateTime(raw);
    if (!parsed) return Number.isFinite(native) ? new Date(native).toISOString() : raw;
    return new Date(zonedTimeToUtcMs(parsed, timezone || 'UTC')).toISOString();
  }

  function parseLocalDateTime(raw) {
    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4] || 0), minute: Number(m[5] || 0), second: Number(m[6] || 0) };
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?$/);
    if (m) return { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]), hour: Number(m[4] || 0), minute: Number(m[5] || 0), second: Number(m[6] || 0) };
    return null;
  }

  function sheetSerialDateToIso(value, timezone) {
    const days = Number(value);
    if (!Number.isFinite(days)) return '';
    const wholeDays = Math.floor(days);
    const fracMs = Math.round((days - wholeDays) * 86400000);
    const ms = Date.UTC(1899, 11, 30) + wholeDays * 86400000 + fracMs;
    const local = new Date(ms);
    return new Date(zonedTimeToUtcMs({ year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds() }, timezone || 'UTC')).toISOString();
  }

  function zonedTimeToUtcMs(parts, timezone) {
    const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
    return guess - timezoneOffsetMs(timezone, guess);
  }

  function timezoneOffsetMs(timezone, utcMs) {
    try {
      const dtf = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const vals = {};
      for (const part of dtf.formatToParts(new Date(utcMs))) if (part.type !== 'literal') vals[part.type] = Number(part.value);
      const hour = vals.hour === 24 ? 0 : vals.hour;
      return Date.UTC(vals.year, vals.month - 1, vals.day, hour, vals.minute, vals.second) - utcMs;
    } catch (_) {
      return 0;
    }
  }

  function parseFlymasterGroupId(value) {
    const raw = String(value || '').trim();
    return /^\d{1,10}$/.test(raw) ? raw : '';
  }

  function parseFlymasterRaceParams(params, pathname) {
    const pathGroup = pathname.match(/^\/race\/flymaster\/(\d{1,10})$/)?.[1] || '';
    const raw = pathGroup || params.get('flymasterGroup') || params.get('flymaster') || params.get('grp') || '';
    if (!/^\d{1,10}$/.test(raw)) return null;
    return { groupId: raw, name: params.get('race') || params.get('raceName') || '' };
  }

  function parseRaceSheetParams(params, pathname) {
    if (pathname === TRANSCAPIXABA_PATH) return { id: '1h-iNS8rby-P8WkEKP98rxMRpEMdOrUjznQxjr9weH8g', gid: '0', name: 'Transcapixaba 2026', start: TRANSCAPIXABA_START, end: TRANSCAPIXABA_END };
    const raw = params.get('raceSheet') || params.get('sheet') || params.get('sheetId') || '';
    if (!raw) return null;
    const parsed = parseGoogleSheetRef(raw);
    if (!parsed.id) return null;
    return { id: parsed.id, gid: params.get('gid') || parsed.gid || '0', name: params.get('race') || params.get('raceName') || '' };
  }

  function parseGoogleSheetRef(value) {
    const raw = String(value || '').trim();
    if (!raw) return { id: '', gid: '' };
    try {
      const url = new URL(raw);
      const id = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] || '';
      const gid = url.searchParams.get('gid') || url.hash.match(/gid=([^&]+)/)?.[1] || '';
      return { id, gid };
    } catch (_) {
      return { id: raw, gid: '' };
    }
  }

  async function loadRaceFromSheet(spec) {
    const config = await getSheetConfig(spec.id, spec.configSheet || 'Config').catch((err) => {
      console.warn('Race config sheet not found; using URL/gid settings', err);
      return {};
    });
    const raceTimezone = String(config.RaceTimezone || config.Timezone || spec.timezone || 'America/Sao_Paulo').trim();
    const rows = await getSheetDataByName(spec.id, config.RacersSheet || spec.racersSheet || 'Racers').catch(() => getSheetData(spec.id, spec.gid));
    const flymasterGroupId = parseFlymasterGroupId(config.FlymasterGroup || config.FlymasterGrp || config.Group || spec.flymasterGroupId || '');
    const racers = rows.map(rowToRacer).filter(Boolean);
    if (!racers.length) throw new Error('No racers with supported sources found in sheet.');
    return {
      id: `sheet:${spec.id}:${spec.gid || config.RacersSheet || 'Racers'}`,
      name: config.RaceName || config.Name || spec.name || 'Race sheet',
      start: parseRaceDateConfig(config.RaceStart || config.Start || spec.start || '', raceTimezone),
      end: parseRaceDateConfig(config.RaceEnd || config.End || spec.end || '', raceTimezone),
      timezone: raceTimezone,
      flymasterGroupId,
      racers,
      sourceFeatureSource: null,
    };
  }

  function rowToRacer(row, index) {
    const name = pickFirst(row, ['RacerName', 'racer_name', 'Racer', 'PilotName', 'Pilot', 'Name', 'name']) || `Racer ${index + 1}`;
    const id = slugify(name) || `racer-${index + 1}`;
    const useMapFeatures = rowFlag(row, ['UseMapFeatures', 'UseSourceFeatures', 'MapFeatures', 'CourseSource', 'UseCourse']);
    const reserved = new Set(['racername', 'racer', 'pilotname', 'pilot', 'name', 'notes', 'note', 'usemapfeatures', 'usesourcefeatures', 'mapfeatures', 'coursesource', 'usecourse']);
    const sources = [];
    const unsupportedSources = [];
    for (const [label, value] of Object.entries(row)) {
      if (!value || reserved.has(normalizeHeader(label))) continue;
      const garminName = parseGarminSource(value, label);
      const spotId = parseSpotSource(value, label);
      const flymasterId = parseFlymasterSource(value, label);
      if (garminName) sources.push({ type: 'garmin-mapshare', label, name: garminName, raw: String(value).trim() });
      else if (spotId) sources.push({ type: 'spot', label, id: spotId, raw: String(value).trim() });
      else if (flymasterId) sources.push({ type: 'flymaster', label, id: flymasterId, raw: String(value).trim() });
      else unsupportedSources.push({ type: 'unknown', label, raw: String(value).trim() });
    }
    if (!sources.length && !unsupportedSources.length) return null;
    return { id, name: String(name).trim(), sources, unsupportedSources, useMapFeatures, position: null, error: '' };
  }

  function parseGarminSource(value, label) {
    const raw = String(value || '').trim();
    const isGarminLabel = /garmin|mapshare|inreach/i.test(label || '');
    if (/share\.garmin\.com/i.test(raw) || /live\.garmin\.com/i.test(raw)) return parseMapName(raw);
    if (isGarminLabel && /^[A-Za-z0-9_-]{1,100}$/.test(raw)) return raw;
    return '';
  }

  function parseFlymasterSource(value, label) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const isFlymasterLabel = /flymaster|fly.?master|fm(id)?|tracker/i.test(label || '');
    const urlMatch = raw.match(/(?:[?&](?:p|pilot|sn|tracker)=|\/pilot\/)(\d{4,12})/i);
    if (urlMatch) return urlMatch[1];
    if (isFlymasterLabel && /^\d{4,12}$/.test(raw)) return raw;
    return '';
  }

  function parseSpotSource(value, label) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const isSpotLabel = /\bspot\b|findmespot/i.test(label || '');
    const idFromUrl = parseSpotFeedIdFromUrl(raw);
    if (idFromUrl) return idFromUrl;
    if ((isSpotLabel || /findmespot/i.test(raw)) && /^[A-Za-z0-9]{20,80}$/.test(raw)) return raw;
    return '';
  }

  function parseSpotFeedIdFromUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (!host.includes('findmespot.com')) return '';
      const fromParam = url.searchParams.get('glId') || url.searchParams.get('feedId') || url.searchParams.get('feed_id') || url.searchParams.get('id') || '';
      if (/^[A-Za-z0-9]{20,80}$/.test(fromParam)) return fromParam;
      const fromPath = url.pathname.match(/\/public\/feed\/([A-Za-z0-9]{20,80})\//)?.[1] || '';
      if (fromPath) return fromPath;
    } catch (_) {
      const match = String(value || '').match(/findmespot\.com\S*(?:glId=|\/public\/feed\/)([A-Za-z0-9]{20,80})/i);
      if (match) return match[1];
    }
    return '';
  }

  async function getSheetConfig(id, sheetName = 'Config') {
    const rows = await getSheetRowsWithHeaderOption(id, { sheet: sheetName, headers: 0 });
    const config = {};
    for (const row of rows.slice(1)) {
      const key = String(cellValue(row[0]) || '').trim();
      if (!key) continue;
      config[key] = cellValue(row[1]);
    }
    return config;
  }

  async function getSheetDataByName(id, sheetName) {
    const json = await getSheetJson(id, { sheet: sheetName });
    let headers = json.cols.map((column) => String(column.label || '').trim());
    let rows = json.rows || [];
    if (!headers.some(Boolean) && rows.length) {
      headers = (rows[0].c || []).map(cellValue).map((value) => String(value || '').trim());
      rows = rows.slice(1);
    }
    return rows.map((r) => rowFromCells(headers, r.c || [])).filter((row) => Object.values(row).some(Boolean));
  }

  async function getSheetRowsWithHeaderOption(id, options = {}) {
    const json = await getSheetJson(id, options);
    return (json.rows || []).map((r) => r.c || []);
  }

  async function getSheetJson(id, options = {}) {
    const params = new URLSearchParams({ tqx: 'out:json' });
    if (options.sheet) params.set('sheet', options.sheet);
    if (options.gid != null) params.set('gid', options.gid);
    if (options.headers != null) params.set('headers', String(options.headers));
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?${params}`);
    const text = await res.text();
    const jsonString = text.match(/(?<="table":).*(?=}\);)/s)?.[0];
    if (!jsonString) throw new Error('Could not parse Google Sheet response.');
    return JSON.parse(jsonString);
  }

  async function getSheetData(id, gid = 0) {
    const text = await (await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:json&gid=${encodeURIComponent(gid)}`)).text();
    const jsonString = text.match(/(?<="table":).*(?=}\);)/s)?.[0];
    if (!jsonString) throw new Error('Could not parse Google Sheet response.');
    const json = JSON.parse(jsonString);
    let headers = json.cols.map((column) => String(column.label || '').trim());
    let rows = json.rows || [];
    if (!headers.some(Boolean) && rows.length) {
      headers = (rows[0].c || []).map(cellValue).map((value) => String(value || '').trim());
      rows = rows.slice(1);
    }
    return rows.map((r) => {
      const row = {};
      headers.forEach((header, index) => {
        if (!header) return;
        row[header] = cellValue((r.c || [])[index]);
      });
      return row;
    }).filter((row) => Object.values(row).some(Boolean));
  }

  function rowFromCells(headers, cells) {
    const row = {};
    headers.forEach((header, index) => {
      if (!header) return;
      row[header] = cellValue(cells[index]);
    });
    return row;
  }

  function cellValue(cell) {
    let value = cell && (cell.f ?? cell.v ?? '');
    if (typeof value === 'string') {
      value = value.trim();
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return value;
  }

  function pickFirst(row, names) {
    const wanted = new Set(names.map(normalizeHeader));
    for (const [key, value] of Object.entries(row)) if (wanted.has(normalizeHeader(key)) && value) return value;
    return '';
  }
  function rowFlag(row, names) {
    const value = pickFirst(row, names);
    if (value === true) return true;
    if (typeof value === 'number') return value !== 0;
    return /^(true|yes|y|1|x)$/i.test(String(value || '').trim());
  }
  function normalizeHeader(value) { return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ''); }
  function slugify(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }

  function parseSoloSourceFromPath() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'race' || parts[0] === 'api') return null;
    if (parts[0] === 'spot') {
      const id = parseSpotSource(parts[1] || '', 'SPOT');
      return id ? { type: 'spot', id, raw: parts[1] || '' } : null;
    }
    const name = parseMapName(parts[0] || '');
    return name ? { type: 'garmin-mapshare', name, raw: parts[0] || '' } : null;
  }

  function parseMapNameFromPath() {
    const source = parseSoloSourceFromPath();
    return source?.type === 'garmin-mapshare' ? source.name : '';
  }

  function parseSharedMap(params) {
    return parseSharedMapCandidates([params.get('url'), params.get('text'), params.get('title')].filter(Boolean));
  }

  function parseSharedMapCandidates(candidates) {
    for (const candidate of candidates) {
      const garminUrl = String(candidate).match(/(?:https?:\/\/)?share\.garmin\.com\/[^\s<>"']+/i)?.[0];
      const parsed = parseMapName(garminUrl ? (garminUrl.includes('://') ? garminUrl : `https://${garminUrl}`) : candidate);
      if (parsed) return parsed;
    }
    return '';
  }

  function parseSoloSource(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const spotId = parseSpotSource(raw, 'SPOT');
    if (spotId) return { type: 'spot', id: spotId, raw };
    const garminName = parseMapName(raw);
    return garminName ? { type: 'garmin-mapshare', name: garminName, raw } : null;
  }

  function parseMapName(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw.includes('://') ? raw : `https://share.garmin.com/${raw}`);
      const parts = u.pathname.split('/').filter(Boolean);
      const lowerParts = parts.map((part) => part.toLowerCase());
      let name = '';
      if (lowerParts[0] === 'feed' && (lowerParts[1] === 'share' || lowerParts[1] === 'shareloader')) name = parts[2] || '';
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
  function loadSourceFeaturesVisible() { try { return localStorage.getItem(SOURCE_FEATURES_KEY) !== 'false'; } catch (_) { return true; } }
  function saveSourceFeaturesVisible(value) { try { localStorage.setItem(SOURCE_FEATURES_KEY, value ? 'true' : 'false'); } catch (_) {} }
  function selectedKey(raceId) { return `garminRaceTracker.selectedRacers.${raceId}`; }
  function loadSelectedRacers(raceId) { try { return new Set(JSON.parse(localStorage.getItem(selectedKey(raceId)) || '[]')); } catch (_) { return new Set(); } }
  function saveSelectedRacers(raceId, ids) { try { localStorage.setItem(selectedKey(raceId), JSON.stringify(Array.from(ids))); } catch (_) {} }
  function visibleTracksKey(raceId) { return `garminRaceTracker.visibleTracks.${raceId}`; }
  function loadVisibleRaceTracks(raceId) { try { return new Set(JSON.parse(localStorage.getItem(visibleTracksKey(raceId)) || '[]')); } catch (_) { return new Set(); } }
  function saveVisibleRaceTracks(raceId, ids) { try { localStorage.setItem(visibleTracksKey(raceId), JSON.stringify(Array.from(ids))); } catch (_) {} }
  function sourceHistoryKey(raceId, source) { return `garminRaceTracker.sourceHistory.${HISTORY_CACHE_VERSION}.${encodeURIComponent(raceId)}.${source.type}.${encodeURIComponent(source.name || source.id || source.raw || '')}`; }
  function loadSourceHistoryCache(raceId, source) {
    try {
      const cached = JSON.parse(localStorage.getItem(sourceHistoryKey(raceId, source)) || 'null');
      const position = cached?.position;
      if (cached?.version !== HISTORY_CACHE_VERSION || !position) return null;
      const lat = Number(position.lat);
      const lon = Number(position.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const history = Array.isArray(position.history) ? position.history.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), ele: p.ele == null ? null : Number(p.ele) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
      return Object.assign({}, position, { lat, lon, history: dedupePositionHistory(history.length ? history : [position]) });
    } catch (_) {
      return null;
    }
  }
  function saveSourceHistoryCache(raceId, source, position) {
    try {
      const copy = clonePosition(position);
      if (copy?.history) copy.history = dedupePositionHistory(copy.history).slice(-3000);
      localStorage.setItem(sourceHistoryKey(raceId, source), JSON.stringify({ version: HISTORY_CACHE_VERSION, savedAt: Date.now(), position: copy }));
    } catch (err) {
      console.warn('Could not save source history cache', err);
    }
  }
  function racerColor(id) {
    const index = state.racers.findIndex((racer) => racer.id === id);
    if (index >= 0) return `hsl(${Math.round((index * 137.508 + 8) % 360)}, 78%, 43%)`;
    let hash = 0;
    for (const ch of String(id)) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360}, 78%, 43%)`;
  }
  function loadSavedKml() { try { return localStorage.getItem(KML_KEY) || ''; } catch (_) { return ''; } }
  function saveImportedKml(text) { try { localStorage.setItem(KML_KEY, text); } catch (_) {} }
  function showSetupError(msg) { $('setup-error').textContent = msg; }
  function setText(id, text) { $(id).textContent = text; }
  function textOf(el, localName) { const found = Array.from(el.childNodes).find((n) => n.localName === localName); return found ? found.textContent.trim() : ''; }
  function dedupeLatLon(points) { const out = []; let prev = null; for (const p of points) { if (!prev || Math.abs(prev.lat - p.lat) > 1e-7 || Math.abs(prev.lon - p.lon) > 1e-7) out.push(p); prev = p; } return out; }
  function dedupePositionHistory(points) { const out = []; const seen = new Set(); for (const p of dedupeLatLon(points)) { const key = `${Number(p.lat).toFixed(7)},${Number(p.lon).toFixed(7)}`; if (seen.has(key)) continue; seen.add(key); out.push(p); } return out; }
  function parseGarminUtc(s) { if (!s) return 0; const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i); if (!m) return Date.parse(`${s} UTC`) || Date.parse(s) || 0; let [, mo, da, yr, hr, mi, se, ap] = m; let h = Number(hr) % 12; if (ap.toUpperCase() === 'PM') h += 12; return Date.UTC(Number(yr), Number(mo) - 1, Number(da), h, Number(mi), Number(se)); }
  function infoText(r) { const parts = [`Updated: ${formatUpdatedTime(r)}`]; if (r.ele != null) parts.push(`Elev: ${Math.round(r.ele)} m`); if (r.gpsFix) parts.push(`GPS fix: ${r.gpsFix}`); if (r.emergency === 'True') parts.push('EMERGENCY'); if (r.text) parts.push(`Text: ${r.text}`); return parts.join(' · '); }
  function formatUpdatedTime(r) {
    if (!r?.utcMs) return r?.time || r?.timeUtc || '—';
    const local = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(r.utcMs));
    const age = formatAge(Date.now() - r.utcMs);
    return age ? `${local} · ${age}` : local;
  }
  function formatAge(ageMs) {
    if (!Number.isFinite(ageMs)) return '';
    if (ageMs < -60000) return 'future';
    const seconds = Math.max(0, Math.round(ageMs / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return `${days} d ago`;
  }
  function staleMinutes(r) { return r.utcMs ? (Date.now() - r.utcMs) / 60000 : null; }
  function formatDistance(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`; }
  function formatKm(m) { return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`; }
  function formatElevation(m) { return m == null ? '—' : `${Math.round(m)} m`; }
  function accuracyStyle(accuracy) { return { radius: accuracy || 0, color: '#1a73e8', weight: 2, opacity: 0.65, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }; }
  function sourceTypeLabel(type) { return type === 'flymaster' ? 'Flymaster' : type === 'spot' ? 'SPOT' : type === 'garmin-mapshare' ? 'Garmin' : 'source'; }
  function distanceM(lat1, lon1, lat2, lon2) { const R = 6371000, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
  function bearingDeg(lat1, lon1, lat2, lon2) { const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const y = Math.sin(dl) * Math.cos(p2); const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (launchParams) => {
      for (const handle of launchParams.files || []) {
        try {
          const file = await handle.getFile();
          if (/\.kml$/i.test(file.name) || /kml|xml/i.test(file.type)) await importKmlText(await file.text(), file.name || 'Opened KML', true);
        } catch (err) {
          console.warn('File launch failed', err);
        }
      }
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker registration failed:', err));
    });
  }
})();
