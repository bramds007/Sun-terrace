// /api/terraces.js — STRIKT: alleen vergunningen met terrasgeometrie (Polygon/MultiPolygon)
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

  // Pagineren tot alles binnen is
  const restPaged = async (startUrl) => {
    let next = startUrl, all = { type: 'FeatureCollection', features: [] }, guard = 0;
    while (next && guard++ < 40) {
      const page = await fetchJSON(next);
      if (page?.features?.length) all.features.push(...page.features);

      // vind "next" in diverse vormen
      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel || '').toLowerCase() === 'next'); if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && typeof page?.next === 'string') next = page.next;
    }
    return all;
  };

  let all;
  try { all = await restPaged(START); }
  catch (e) { return res.status(500).json({ source:'amsterdam-rest', error:e.message }); }

  const polys = { type:'FeatureCollection', features:[] };
  let i = 0;

  for (const f of (all.features || [])) {
    const p = f.properties || {};
    const name = p.zaaknaam || p.naam || p.bedrijfsnaam || p.adres || `Terras #${++i}`;
    const id   = f.id || p.identificatie || p.uuid || p.id || i;

    // terrasgeometrie kan stringified GeoJSON zijn
    let tg = p.terrasgeometrie || p.terras_geometrie || p.terrassen_geometrie;
    if (typeof tg === 'string') { try { const j = JSON.parse(tg); if (j && j.type) tg = j; } catch {} }

    if (tg && (tg.type === 'Polygon' || tg.type === 'MultiPolygon')) {
      polys.features.push({ type:'Feature', id, properties:{ name }, geometry: tg });
    }
  }

  res.status(200).json({
    source: 'amsterdam-rest',
    count: polys.features.length,
    terracePolys: polys,
    placePoints: { type:'FeatureCollection', features:[] } // bewust leeg
  });
}
