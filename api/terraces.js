// /api/terraces.js — REST paging; polygons uit 'terrasgeometrie' + puntenfallback (zonder dubbels)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

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
      // vind "next" (3 varianten)
      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel || '').toLowerCase() === 'next'); if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && typeof page?.next === 'string') next = page.next;
    }
    return all;
  };

  // 1) Alles ophalen (paging)
  let all;
  try {
    all = await restPaged(START);
  } catch (e) {
    // mini demo fallback
    const demo = {
      type: 'FeatureCollection',
      features: [
        { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
        { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } }
      ]
    };
    return res.status(200).json({ source: 'demo', count: demo.features.length, terracePolys: demo, placePoints: { type:'FeatureCollection', features: [] }});
  }

  // 2) Namen normaliseren + split: polygons/points + dedup
  const polys = { type: 'FeatureCollection', features: [] };
  const points = { type: 'FeatureCollection', features: [] };

  // om dubbels te voorkomen (veel punten horen bij hetzelfde terras als polygon)
  const polyKeys = new Set();

  let i = 0;
  for (const f of (all.features || [])) {
    const p = f.properties || {};
    const name = p.zaaknaam || p.naam || p.bedrijfsnaam || p.adres || `Terras #${++i}`;
    const id = f.id || p.identificatie || p.uuid || p.id || i;

    // terrasgeometrie kan object of stringified GeoJSON zijn
    let tg = p.terrasgeometrie || p.terras_geometrie || p.terrassen_geometrie;
    if (typeof tg === 'string') { try { const j = JSON.parse(tg); if (j && j.type) tg = j; } catch {} }

    if (tg && tg.type && (tg.type === 'Polygon' || tg.type === 'MultiPolygon')) {
      polys.features.push({ type:'Feature', id, properties:{ name, source:'poly' }, geometry: tg });
      polyKeys.add(id);
      polyKeys.add(name); // extra guard wanneer id ontbreekt
    } else if (f.geometry && f.geometry.type === 'Point') {
      // sla punt over als er al een polygon met zelfde id of naam is
      if (!polyKeys.has(id) && !polyKeys.has(name)) {
        points.features.push({ type:'Feature', id, properties:{ name, source:'point' }, geometry: f.geometry });
      }
    }
  }

  return res.status(200).json({
    source: 'rest',
    count: polys.features.length + points.features.length,
    terracePolys: polys,
    placePoints: points
  });
}
