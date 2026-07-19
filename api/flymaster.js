export const config = { runtime: 'edge' };

const TYPES = new Set(['group', 'trace', 'task']);

export default async function handler(request) {
  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || 'group').toLowerCase();
  const grp = normalizeDigits(url.searchParams.get('grp') || url.searchParams.get('group') || '');

  if (!TYPES.has(type)) {
    return json({ error: `Invalid type. Use one of: ${Array.from(TYPES).join(', ')}` }, 400);
  }
  if (!grp && type !== 'task') return json({ error: 'Missing or invalid Flymaster group id.' }, 400);

  const upstream = upstreamUrl(type, { grp, p: url.searchParams.get('p') || '', d: url.searchParams.get('d') || '', task: url.searchParams.get('task') || url.searchParams.get('tk') || '' });
  if (!upstream) return json({ error: 'Missing or invalid Flymaster trace parameters.' }, 400);

  try {
    const res = await fetch(upstream, {
      headers: {
        accept: 'application/json,*/*',
        referer: `https://lt.flymaster.net/bs.php?grp=${encodeURIComponent(grp)}`,
        'user-agent': 'Mozilla/5.0 MapShareCompanion/0.1',
      },
      cf: { cacheTtl: type === 'group' ? 60 : type === 'task' ? 300 : 15, cacheEverything: false },
    });
    const body = await res.text();
    if (!res.ok) return json({ error: `Flymaster returned HTTP ${res.status}`, upstream }, res.status);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': type === 'group' ? 'public, s-maxage=60, stale-while-revalidate=300' : type === 'task' ? 'public, s-maxage=300, stale-while-revalidate=3600' : 'public, s-maxage=15, stale-while-revalidate=30',
        'access-control-allow-origin': '*',
      },
    });
  } catch (err) {
    return json({ error: err?.message || String(err), upstream }, 502);
  }
}

function upstreamUrl(type, params) {
  if (type === 'group') return `https://lb.flymaster.net/groupi.php?grp=${encodeURIComponent(params.grp)}`;
  if (type === 'task') {
    const task = normalizeDigits(params.task);
    return task ? `https://lt.flymaster.net/json/kml/${encodeURIComponent(task)}.json` : '';
  }
  const p = normalizeDigits(params.p);
  const d = normalizeDigits(params.d);
  if (!p || !d) return '';
  return `https://lb.flymaster.net/trace.php?p=${encodeURIComponent(p)}&d=${encodeURIComponent(d)}&grp=${encodeURIComponent(params.grp)}`;
}

function normalizeDigits(value) {
  const raw = String(value || '').trim();
  return /^\d{1,12}$/.test(raw) ? raw : '';
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
