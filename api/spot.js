export const config = { runtime: 'edge' };

const TYPES = new Set(['message', 'latest']);

export default async function handler(request) {
  const url = new URL(request.url);
  const id = normalizeFeedId(url.searchParams.get('id') || url.searchParams.get('feedId') || '');
  const type = (url.searchParams.get('type') || 'message').toLowerCase();

  if (!id) {
    return json({ error: 'Missing or invalid SPOT feed ID.' }, 400);
  }
  if (!TYPES.has(type)) {
    return json({ error: `Invalid type. Use one of: ${Array.from(TYPES).join(', ')}` }, 400);
  }

  const upstream = upstreamUrl(id, type);
  try {
    const res = await fetch(upstream, {
      headers: {
        accept: 'application/json,*/*',
        'user-agent': 'Mozilla/5.0 MapShareCompanion/0.1',
      },
      cf: { cacheTtl: 150, cacheEverything: false },
    });

    const body = await res.text();
    if (!res.ok) {
      return json({ error: `SPOT returned HTTP ${res.status}`, upstream }, res.status);
    }

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, s-maxage=150, stale-while-revalidate=120',
        'access-control-allow-origin': '*',
      },
    });
  } catch (err) {
    return json({ error: err?.message || String(err), upstream }, 502);
  }
}

function upstreamUrl(id, type) {
  return `https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/${encodeURIComponent(id)}/${type}.json`;
}

function normalizeFeedId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9]{20,80}$/.test(id)) return '';
  return id;
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
