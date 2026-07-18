// ==UserScript==
// @name         Flymaster My Location
// @namespace    https://lt.flymaster.net/
// @version      0.1.0
// @description  Add your own live GPS marker, accuracy circle, heading, and breadcrumb trail to Flymaster Live Tracking.
// @match        https://lt.flymaster.net/bs.php*
// @match        https://lt.flymaster.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.1.0';
  const GLOBAL = 'FMMyLocation';
  const DEFAULTS = {
    autoStart: true,
    follow: false,
    mock: false,
    highAccuracy: true,
    maxBreadcrumbPoints: 500,
    minBreadcrumbDistanceM: 8,
    mapWaitMs: 30000,
    mapPollMs: 400,
  };

  const cfg = Object.assign(
    {},
    DEFAULTS,
    window.FM_MY_LOCATION_CONFIG || {},
    parseHashConfig()
  );

  if (window[GLOBAL] && typeof window[GLOBAL].destroy === 'function') {
    window[GLOBAL].destroy();
  }

  const state = {
    map: null,
    layer: null,
    marker: null,
    accuracyCircle: null,
    track: null,
    control: null,
    watchId: null,
    mockTimer: null,
    started: false,
    follow: !!cfg.follow,
    last: null,
    trackPoints: [],
    status: 'loading',
    error: '',
  };

  const api = {
    version: VERSION,
    start,
    stop,
    toggleFollow,
    center,
    destroy,
    useMockLocation,
    getState: () => Object.assign({}, state, { map: !!state.map }),
  };
  window[GLOBAL] = api;

  injectCss();
  waitForMap().then((map) => {
    state.map = map;
    install(map);
    setStatus('ready');
    if (cfg.autoStart) start();
  }).catch((err) => {
    setStatus('error', err.message || String(err));
    showFloatingError(err.message || String(err));
  });

  function parseHashConfig() {
    const text = `${location.search || ''}&${location.hash || ''}`;
    const out = {};
    if (/(?:[?#&]|^)fmml_mock=1(?:&|$)/.test(text)) out.mock = true;
    if (/(?:[?#&]|^)fmml_follow=1(?:&|$)/.test(text)) out.follow = true;
    return out;
  }

  function waitForMap() {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tryNow = () => {
        const map = findLeafletMap();
        if (map) return resolve(map);
        if (Date.now() - started > cfg.mapWaitMs) {
          return reject(new Error('Could not find the Flymaster Leaflet map. Wait until the map is visible, then run the bookmarklet again.'));
        }
        setTimeout(tryNow, cfg.mapPollMs);
      };
      tryNow();
    });
  }

  function findLeafletMap() {
    const L = window.L;
    if (!L || !L.Map) return null;

    if (window.animator && typeof window.animator.getMap === 'function') {
      const m = safeCall(() => window.animator.getMap());
      if (isLeafletMap(m)) return m;
    }

    if (isLeafletMap(window.map)) return window.map;

    // Last resort: scan globals. Useful if Flymaster changes the variable name.
    for (const key of Object.keys(window)) {
      if (!/map|leaflet|animator/i.test(key)) continue;
      const value = safeCall(() => window[key]);
      if (isLeafletMap(value)) return value;
      if (value && typeof value.getMap === 'function') {
        const nested = safeCall(() => value.getMap());
        if (isLeafletMap(nested)) return nested;
      }
    }
    return null;
  }

  function isLeafletMap(value) {
    return !!(value && window.L && value instanceof window.L.Map && typeof value.latLngToContainerPoint === 'function');
  }

  function safeCall(fn) {
    try { return fn(); } catch (_) { return null; }
  }

  function install(map) {
    const L = window.L;
    state.layer = L.layerGroup().addTo(map);
    state.track = L.polyline([], {
      color: '#1a73e8',
      weight: 3,
      opacity: 0.85,
      interactive: false,
    }).addTo(state.layer);

    const MyLocationControl = createMyLocationControlClass();
    state.control = new MyLocationControl({ position: 'topleft' });
    state.control.addTo(map);
    updatePanel();
  }

  function start() {
    if (!state.map) return setStatus('loading');
    if (state.started) return;
    state.started = true;
    setStatus('starting');

    if (cfg.mock) return useMockLocation();

    if (!navigator.geolocation) {
      state.started = false;
      setStatus('error', 'This browser does not support geolocation.');
      return;
    }

    try {
      state.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
        enableHighAccuracy: !!cfg.highAccuracy,
        maximumAge: 1000,
        timeout: 15000,
      });
    } catch (err) {
      state.started = false;
      setStatus('error', err.message || String(err));
    }
  }

  function stop() {
    if (state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    if (state.mockTimer) {
      clearInterval(state.mockTimer);
      state.mockTimer = null;
    }
    state.started = false;
    setStatus('stopped');
  }

  function destroy() {
    stop();
    if (state.control && state.map) state.map.removeControl(state.control);
    if (state.layer && state.map) state.map.removeLayer(state.layer);
    document.getElementById('fmml-style')?.remove();
    document.getElementById('fmml-floating-error')?.remove();
    delete window[GLOBAL];
  }

  function onGeoError(err) {
    let msg = err && err.message ? err.message : String(err || 'Unknown geolocation error');
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      msg += ' Geolocation requires HTTPS.';
    }
    setStatus('error', msg);
  }

  function onPosition(position) {
    const c = position.coords;
    const next = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
      heading: Number.isFinite(c.heading) ? c.heading : null,
      speed: Number.isFinite(c.speed) ? c.speed : null,
      timestamp: position.timestamp || Date.now(),
    };

    if (next.heading == null && state.last) {
      const moved = distanceM(state.last.lat, state.last.lon, next.lat, next.lon);
      if (moved > 3) next.heading = bearingDeg(state.last.lat, state.last.lon, next.lat, next.lon);
    }

    updateLocation(next);
  }

  function updateLocation(next) {
    state.last = next;
    setStatus('live');

    const L = window.L;
    const ll = [next.lat, next.lon];

    if (!state.marker) {
      state.marker = L.marker(ll, {
        icon: makeIcon(next.heading),
        zIndexOffset: 5000,
        interactive: true,
        title: 'My location',
      }).addTo(state.layer);
      state.marker.bindPopup(() => popupHtml(next));
    } else {
      state.marker.setLatLng(ll);
      state.marker.setIcon(makeIcon(next.heading));
      if (state.marker.isPopupOpen()) state.marker.setPopupContent(popupHtml(next));
    }

    if (!state.accuracyCircle) {
      state.accuracyCircle = L.circle(ll, accuracyStyle(next.accuracy)).addTo(state.layer);
    } else {
      state.accuracyCircle.setLatLng(ll);
      state.accuracyCircle.setRadius(next.accuracy || 0);
    }

    addBreadcrumb(ll);

    if (state.follow) {
      state.map.panTo(ll, { animate: false });
    }

    updatePanel();
  }

  function addBreadcrumb(ll) {
    const lastPoint = state.trackPoints[state.trackPoints.length - 1];
    if (!lastPoint || distanceM(lastPoint[0], lastPoint[1], ll[0], ll[1]) >= cfg.minBreadcrumbDistanceM) {
      state.trackPoints.push(ll);
      if (state.trackPoints.length > cfg.maxBreadcrumbPoints) state.trackPoints.shift();
      if (state.track) state.track.setLatLngs(state.trackPoints);
    }
  }

  function center() {
    if (state.map && state.last) {
      state.map.setView([state.last.lat, state.last.lon], Math.max(state.map.getZoom(), 15), { animate: true });
    }
  }

  function toggleFollow(force) {
    state.follow = typeof force === 'boolean' ? force : !state.follow;
    if (state.follow) center();
    updatePanel();
  }

  function useMockLocation() {
    cfg.mock = true;
    if (!state.map) return;
    if (state.mockTimer) clearInterval(state.mockTimer);
    setStatus('mock');
    const center = state.map.getCenter();
    const startLat = center.lat || 41.15;
    const startLon = center.lng || -8.61;
    let t = 0;
    state.mockTimer = setInterval(() => {
      t += 1;
      const r = 0.0025;
      const lat = startLat + Math.sin(t / 18) * r;
      const lon = startLon + Math.cos(t / 18) * r;
      updateLocation({
        lat,
        lon,
        accuracy: 12 + 8 * Math.abs(Math.sin(t / 7)),
        heading: (t * 20) % 360,
        speed: 8,
        timestamp: Date.now(),
      });
    }, 1000);
  }

  function setStatus(status, error) {
    state.status = status;
    state.error = error || '';
    updatePanel();
  }

  function updatePanel() {
    const root = document.querySelector('.fmml-panel');
    if (!root) return;

    const status = root.querySelector('[data-fmml=status]');
    const detail = root.querySelector('[data-fmml=detail]');
    const startButton = root.querySelector('[data-fmml=start]');
    const followButton = root.querySelector('[data-fmml=follow]');

    if (status) status.textContent = labelForStatus();
    if (detail) detail.textContent = detailText();
    if (startButton) startButton.textContent = state.started ? 'Stop' : 'Start';
    if (followButton) followButton.textContent = state.follow ? 'Follow: on' : 'Follow: off';
    root.classList.toggle('is-error', state.status === 'error');
    root.classList.toggle('is-live', state.status === 'live' || state.status === 'mock');
  }

  function labelForStatus() {
    if (state.status === 'mock') return 'My location: mock';
    if (state.status === 'live') return 'My location: live';
    if (state.status === 'starting') return 'Requesting GPS…';
    if (state.status === 'stopped') return 'My location: stopped';
    if (state.status === 'error') return 'My location: error';
    if (state.status === 'ready') return 'My location: ready';
    return 'Finding map…';
  }

  function detailText() {
    if (state.error) return state.error;
    if (!state.last) return state.status === 'ready' ? 'Press Start if GPS did not prompt automatically.' : '';
    const speed = state.last.speed == null ? '' : ` · ${(state.last.speed * 3.6).toFixed(0)} km/h`;
    const acc = state.last.accuracy == null ? '' : `±${Math.round(state.last.accuracy)} m`;
    return `${state.last.lat.toFixed(5)}, ${state.last.lon.toFixed(5)} ${acc}${speed}`;
  }

  function popupHtml(p) {
    const speed = p.speed == null ? '—' : `${(p.speed * 3.6).toFixed(1)} km/h`;
    const heading = p.heading == null ? '—' : `${Math.round(p.heading)}°`;
    const acc = p.accuracy == null ? '—' : `±${Math.round(p.accuracy)} m`;
    return `<b>My location</b><br>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}<br>Accuracy: ${acc}<br>Speed: ${speed}<br>Heading: ${heading}`;
  }

  function accuracyStyle(accuracy) {
    return {
      radius: accuracy || 0,
      color: '#1a73e8',
      weight: 2,
      opacity: 0.65,
      fillColor: '#1a73e8',
      fillOpacity: 0.12,
      interactive: false,
    };
  }

  function makeIcon(heading) {
    const rot = Number.isFinite(heading) ? heading : 0;
    const arrowOpacity = Number.isFinite(heading) ? 1 : 0.25;
    return window.L.divIcon({
      className: 'fmml-icon-wrap',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18],
      html: `<div class="fmml-dot"><div class="fmml-arrow" style="transform: rotate(${rot}deg); opacity:${arrowOpacity}"></div></div>`,
    });
  }

  function createMyLocationControlClass() {
    return window.L.Control.extend({
      onAdd: function () {
        const div = window.L.DomUtil.create('div', 'fmml-panel leaflet-bar');
        div.innerHTML = `
          <div class="fmml-title" data-fmml="status">My location</div>
          <div class="fmml-detail" data-fmml="detail"></div>
          <div class="fmml-actions">
            <button type="button" data-fmml="start">Start</button>
            <button type="button" data-fmml="center">Center</button>
            <button type="button" data-fmml="follow">Follow: off</button>
          </div>`;
        window.L.DomEvent.disableClickPropagation(div);
        window.L.DomEvent.disableScrollPropagation(div);
        div.querySelector('[data-fmml=start]').addEventListener('click', () => state.started ? stop() : start());
        div.querySelector('[data-fmml=center]').addEventListener('click', center);
        div.querySelector('[data-fmml=follow]').addEventListener('click', () => toggleFollow());
        return div;
      },
    });
  }

  function injectCss() {
    if (document.getElementById('fmml-style')) return;
    const css = `
      .fmml-panel{background:rgba(255,255,255,.94);padding:8px 9px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.25);font:13px/1.25 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:270px;border:2px solid #aaa!important}
      .fmml-panel.is-live{border-color:#1a73e8!important}.fmml-panel.is-error{border-color:#d93025!important}
      .fmml-title{font-weight:700;margin-bottom:3px}.fmml-detail{font-size:12px;color:#333;margin-bottom:6px;word-break:break-word}.fmml-actions{display:flex;gap:5px;flex-wrap:wrap}
      .fmml-actions button{appearance:none;border:1px solid #999;background:#fff;border-radius:6px;padding:5px 7px;font:inherit;line-height:1;cursor:pointer}.fmml-actions button:active{background:#e8f0fe}
      .fmml-icon-wrap{background:transparent;border:0}.fmml-dot{position:relative;width:28px;height:28px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 1px 7px rgba(0,0,0,.55);box-sizing:border-box}
      .fmml-dot:after{content:"";position:absolute;left:8px;top:8px;width:6px;height:6px;border-radius:50%;background:#fff}.fmml-arrow{position:absolute;left:9px;top:-13px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:16px solid #1a73e8;transform-origin:50% 27px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.45))}
      #fmml-floating-error{position:fixed;z-index:2147483647;left:12px;right:12px;top:12px;background:#fff3f3;color:#7a0000;border:2px solid #d93025;border-radius:8px;padding:10px;font:14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 3px 14px rgba(0,0,0,.3)}
    `;
    const style = document.createElement('style');
    style.id = 'fmml-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showFloatingError(message) {
    let div = document.getElementById('fmml-floating-error');
    if (!div) {
      div = document.createElement('div');
      div.id = 'fmml-floating-error';
      document.body.appendChild(div);
    }
    div.textContent = `Flymaster My Location: ${message}`;
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
})();

