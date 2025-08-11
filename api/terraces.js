// WFS → REST (met intersects + paging) → DEMO
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // BBOX (lon,lat,lon,lat in EPSG:4326). Default: binnen de Ring
  const url = new URL(req.url, `http://${req.headers.host}`);
  const bboxParam = url.searchParams.get('bbox');
  const DEFAULT_BBOX = '4.75,52.30,5.02,52.42';
  const bbox = (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(bboxParam || ''))
    ? bboxParam : DEFAULT_BBOX;

  // optionele API-key (nu nog niet verplicht, straks mogelijk wel)
  const apiKey = process.env.AMS_API_KEY;
  const baseHeaders = { 'Accept': 'application/json' };
  if (apiKey) baseHeaders['X-Api-Key'] = apiKey;

  const [minx, miny, maxx, maxy] = bbox.split(',').map(parseFloat);

  // --- 1) WFS: app:exploitatievergunning-terrasgeometrie (GeoJSON + BBOX) ---
  const WFS = 'https://api.data.amsterdam.nl/v1/wfs/horeca/?' +
    'SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
    '&TYPENAMES=app:exploitatievergunning-terrasgeometrie' +
    '&OUTPUTFORMAT=geojson' +
    '&SRSNAME=urn:ogc:def:crs:EPSG::4326' +
    `&BBOX=${bbox},urn:ogc:def:crs:EPSG::4326` +
    '&count=10000';

  // --- 2) REST: GeoJSON + intersects(WKT) + paging ---
  const REST_START = 'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=geojson';
  const wkt = `POLYGON((${minx} ${miny},${maxx} ${miny},${maxx} ${maxy},${minx} ${maxy},${minx} ${miny}))`;
  const REST_URL = `${REST_START}&${encodeURIComponent('terrasgeometrie[intersects]')}=${encodeURIComponent(wkt)}`;

  const demo = {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
      { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } },
      { type:'Feature', id:'thijssen',  properties:{ name:'Café Thijssen (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] } },
      { type:'Feature', id:'brandstof', properties:{ name:'Brandstof (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] } }
    ]
  };

  const fetchJSON = async (u, headers = baseHeaders) => {
    const r = await fetch(u, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  const normalize = (fc) => {
    const out = { type: 'FeatureCollection', features: [] };
    (fc.features || []).forEach((f, i) => {
      if (!f || !f.geometry) return;
      const p = f.properties || {};
      const name = p.zaaknaam || p.naam || p.bedrijfsnaam || p.adres || `Terras #${i+1}`;
      const id = f.id || p.identificatie || p.uuid || p.id || i;
      out.features.push({ type:'Feature', id, properties:{ name }, geometry: f.geometry });
    });
    return out;
  };

  // 1) WFS eerst
  try {
    const wfs = await fetchJSON(WFS);
    if (wfs?.features?.length) {
      const slim = normalize(wfs);
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      return res.status(200).json({ source:'wfs', bbox, count: slim.features.length, ...slim });
    }
  } catch (e) {
    // doorgaan naar REST
  }

  // 2) REST met paging
  try {
    let next = REST_URL;
    const all = { type:'FeatureCollection', features: [] };
    let guard = 0;
    while (next && guard++ < 30) {
      const page = await fetchJSON(next);
      if (page?.features?.length) all.features.push(...page.features);

      // probeer verschillende next-links
      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel || '').toLowerCase() === 'next');
        if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && typeof page?.next === 'string') next = page.next;
    }

    if (all.features.length) {
      const slim = normalize(all);
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      return res.status(200).json({ source:'rest', bbox, count: slim.features.length, ...slim });
    }
  } catch (e) {
    // val terug op demo
  }

  // 3) DEMO
  return res.status(200).json({ source:'demo', bbox, count: demo.features.length, ...demo });
}
