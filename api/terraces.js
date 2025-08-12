// /api/terraces.js — haalt terrassen binnen bbox op (REST), splitst polygons & punten, dedup
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // bbox=lonMin,latMin,lonMax,latMax (WGS84)
  const bbox = (req.query.bbox || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    return res.status(400).json({ error: 'Missing or invalid bbox param. Use ?bbox=lonMin,latMin,lonMax,latMax' });
  }
  const [minx, miny, maxx, maxy] = bbox;
  const poly = { type:'Polygon', coordinates:[[[minx,miny],[maxx,miny],[maxx,maxy],[minx,maxy],[minx,miny]]] };

  const START = `https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=geojson&terrasgeometrie[intersects]=${encodeURIComponent(JSON.stringify(poly))}`;

  const fetchJSON = async (u) => {
    const r = await fetch(u, { headers: { 'Accept': 'application/geo+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  // REST paging
  const restPaged = async (startUrl) => {
    let next = startUrl, all = { type:'FeatureCollection', features:[] }, guard = 0;
    while (next && guard++ < 30) {
      const page = await fetchJSON(next);
      if (page?.features?.length) all.features.push(...page.features);
      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel || '').toLowerCase()==='next'); if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && typeof page?.next === 'string') next = page.next;
    }
    return all;
  };

  // Ophalen + normaliseren
  let all;
  try { all = await restPaged(START); }
  catch (e) { return res.status(500).json({ source:'rest', error: e.message }); }

  const polys  = { type:'FeatureCollection', features:[] };
  const points = { type:'FeatureCollection', features:[] };
  const polyKeys = new Set();
  let i = 0;

  for (const f of (all.features || [])) {
    const p = f.properties || {};
    const name = p.zaaknaam || p.naam || p.bedrijfsnaam || p.adres || `Terras #${++i}`;
    const id   = f.id || p.identificatie || p.uuid || p.id || i;

    // terrasgeometrie kan object of stringified GeoJSON zijn
    let tg = p.terrasgeometrie || p.terras_geometrie || p.terrassen_geometrie;
    if (typeof tg === 'string') { try { const j = JSON.parse(tg); if (j?.type) tg = j; } catch {} }

    if (tg && (tg.type==='Polygon' || tg.type==='MultiPolygon')) {
      polys.features.push({ type:'Feature', id, properties:{ name }, geometry: tg });
      polyKeys.add(id); polyKeys.add(name);
    } else if (f.geometry?.type === 'Point') {
      // skip punt als er al polygon met zelfde id/naam is
      if (!polyKeys.has(id) && !polyKeys.has(name)) {
        points.features.push({ type:'Feature', id, properties:{ name }, geometry: f.geometry });
      }
    }
  }

  res.status(200).json({
    source: 'rest',
    count: polys.features.length + points.features.length,
    terracePolys: polys,
    placePoints: points
  });
}
