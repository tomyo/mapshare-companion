export const config = { runtime: 'edge' };

const TYPES = new Set(['feed', 'waypoints', 'routes', 'collections']);

export default async function handler(request) {
  const url = new URL(request.url);
  const name = normalizeMapName(url.searchParams.get('name') || '');
  const type = (url.searchParams.get('type') || 'feed').toLowerCase();
  const d1 = normalizeDateParam(url.searchParams.get('d1') || url.searchParams.get('D1') || '');
  const d2 = normalizeDateParam(url.searchParams.get('d2') || url.searchParams.get('D2') || '');

  if (!name) {
    return json({ error: 'Missing or invalid Garmin MapShare name.' }, 400);
  }
  if (!TYPES.has(type)) {
    return json({ error: `Invalid type. Use one of: ${Array.from(TYPES).join(', ')}` }, 400);
  }

  const upstream = upstreamUrl(name, type, { d1, d2 });
  try {
    const res = await fetch(upstream, {
      headers: {
        'accept': type === 'feed' ? 'application/vnd.google-earth.kml+xml,text/xml,*/*' : 'application/json,*/*',
        'user-agent': 'Mozilla/5.0 MapShareCompanion/0.1',
      },
      cf: { cacheTtl: type === 'feed' ? 15 : 60, cacheEverything: false },
    });

    const body = await res.text();
    if (!res.ok) {
      return json({ error: `Garmin returned HTTP ${res.status}`, upstream }, res.status);
    }

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': contentType(type),
        'cache-control': type === 'feed' ? 's-maxage=15, stale-while-revalidate=30' : 's-maxage=60, stale-while-revalidate=300',
        'access-control-allow-origin': '*',
      },
    });
  } catch (err) {
    return json({ error: err?.message || String(err), upstream }, 502);
  }
}

function upstreamUrl(name, type, options = {}) {
  const safeName = encodeURIComponent(name);
  if (type === 'feed') {
    const params = new URLSearchParams();
    if (options.d1) params.set('d1', options.d1);
    if (options.d2) params.set('d2', options.d2);
    const query = params.toString();
    return `https://share.garmin.com/feed/share/${safeName}${query ? `?${query}` : ''}`;
  }
  if (type === 'waypoints') return `https://share.garmin.com/${safeName}/Waypoints`;
  if (type === 'routes') return `https://share.garmin.com/${safeName}/routes/`;
  return `https://share.garmin.com/${safeName}/Collections`;
}

function normalizeMapName(value) {
  const name = String(value).trim().replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(name)) return '';
  return name;
}

function normalizeDateParam(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 40 || !Number.isFinite(Date.parse(raw))) return '';
  return raw;
}

function contentType(type) {
  return type === 'feed' ? 'application/vnd.google-earth.kml+xml; charset=utf-8' : 'application/json; charset=utf-8';
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
