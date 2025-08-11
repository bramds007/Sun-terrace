// /api/terraces.js — REST paging; extract terrace polygons if available
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const bbox = url.searchParams.get('bbox') || '4.75,52.30,5.02,52.42'; // binnen de Ring
  const START = 'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=geojson';

  const fetchJSON = async (u) => {
    const r = await fetch(u, { headers: { 'Accept': 'application/geo+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  const restPaged = async (startUrl) => {
    let next = startUrl, all = { type: 'FeatureCollection', features: [] }, guard = 0;
    while (next && guard++ < 30) {
      const page = await fetchJSON(next);
      if (page?.features?.length) all.features.push(...page.features);
      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel || '').toLowerCase() === 'next'); if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && typeof page?.next === 'string') next = page.next;
    }
    return all;
  };

  // 1) Get everything (we’ll filter client-side by bbox already on the page load)
  let all;
  try {
    all = await restPaged(START);
  } catch (e) {
    // final ultra-small demo fallback
    const demo = {
      type: 'FeatureCollection',
      features: [
        { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
        { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } }
      ]
    };
    return res.status(200).json({ source: 'demo', bbox, count: demo.features.length, terracePolys: demo, placePoints: { type:'FeatureCollection', features: [] }});
  }

  // 2) Normalize names & split into polygons/points
  const polys = { type: 'FeatureCollection', features: [] };
  const points = { type: 'FeatureCollection', features: [] };

  let idx = 0;
  for (const f of (all.features || [])) {
    const p = f.properties || {};
    const name = p.zaaknaam || p.naam || p.bedrijfsnaam || p.adres || `Terras #${++idx}`;
    const id = f.id || p.identificatie || p.uuid || p.id || idx;

    // Try to read terrace geometry from properties
    let tg = p.terrasgeometrie || p.terras_geometrie || p.terrassen_geometrie;
    // Sometimes API delivers embedded GeoJSON object; if it's a string, try JSON.parse
    if (typeof tg === 'string') {
      try { const maybe = JSON.parse(tg); if (maybe && maybe.type) tg = maybe; } catch {}
    }

    if (tg && tg.type && (tg.type === 'Polygon' || tg.type === 'MultiPolygon')) {
      polys.features.push({ type:'Feature', id, properties:{ name, source:'poly' }, geometry: tg });
    } else if (f.geometry && f.geometry.type === 'Point') {
      points.features.push({ type:'Feature', id, properties:{ name, source:'point' }, geometry: f.geometry });
    }
  }

  return res.status(200).json({
    source: 'rest',
    bbox,
    count: (polys.features.length + points.features.length),
    terracePolys: polys,
    placePoints: points
  });
}
