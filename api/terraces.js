// /api/terraces.js — DIAG build: test WFS/REST (zonder & met BBOX) en gebruik beste resultaat
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const bboxParam = url.searchParams.get('bbox');
  const diag = url.searchParams.get('diag'); // als gezet: geef ook diagnose terug
  const DEFAULT_BBOX = '4.75,52.30,5.02,52.42';
  const bbox = (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(bboxParam||'')) ? bboxParam : DEFAULT_BBOX;
  const [minx, miny, maxx, maxy] = bbox.split(',').map(parseFloat);

  const headers = { 'Accept': 'application/json' }; // géén speciale Accept; REST kan later geo+json krijgen

  const demo = { type:'FeatureCollection', features:[
    { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
    { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } },
    { type:'Feature', id:'thijssen',  properties:{ name:'Café Thijssen (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] } },
    { type:'Feature', id:'brandstof', properties:{ name:'Brandstof (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] } }
  ]};

  const fetchJSON = async (u, h=headers) => {
    const r = await fetch(u, { headers: h });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  const norm = (fc) => {
    const out = { type:'FeatureCollection', features:[] };
    (fc.features||[]).forEach((f,i)=>{
      if (!f?.geometry) return;
      const p=f.properties||{};
      const name = p.zaaknaam||p.naam||p.bedrijfsnaam||p.adres||`Terras #${i+1}`;
      const id = f.id||p.identificatie||p.uuid||p.id||i;
      out.features.push({ type:'Feature', id, properties:{ name }, geometry:f.geometry });
    });
    return out;
  };

  // Endpoints
  const WFS_ALL = 'https://api.data.amsterdam.nl/v1/wfs/horeca/?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=app:exploitatievergunning-terrasgeometrie&OUTPUTFORMAT=geojson&SRSNAME=urn:ogc:def:crs:EPSG::4326&count=10000';
  const WFS_BBOX = `${WFS_ALL}&BBOX=${bbox},urn:ogc:def:crs:EPSG::4326`;

  const REST_START = 'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=geojson';
  const WKT = `POLYGON((${minx} ${miny},${maxx} ${miny},${maxx} ${maxy},${minx} ${maxy},${minx} ${miny}))`;
  const REST_INTERSECTS = `${REST_START}&${encodeURIComponent('terrasgeometrie[intersects]')}=${encodeURIComponent(WKT)}`;

  const diagInfo = {
    bbox,
    wfs_all: { url: WFS_ALL, count: 0 },
    wfs_bbox:{ url: WFS_BBOX, count: 0 },
    rest_all:{ url: REST_START, count: 0 },
    rest_box:{ url: REST_INTERSECTS, count: 0 }
  };

  let best = null;

  // 1) WFS zonder bbox
  try {
    const d = await fetchJSON(WFS_ALL);
    const n = d?.features?.length||0; diagInfo.wfs_all.count = n;
    if (n && !best) best = { source:'wfs', data: norm(d) };
  } catch (e) { diagInfo.wfs_all.error = String(e); }

  // 2) WFS met bbox
  try {
    const d = await fetchJSON(WFS_BBOX);
    const n = d?.features?.length||0; diagInfo.wfs_bbox.count = n;
    if (n && (!best || n < best.data.features.length)) best = { source:'wfs', data: norm(d) }; // neem kleinste set
  } catch (e) { diagInfo.wfs_bbox.error = String(e); }

  // Helper: REST paging
  const restPaged = async (startUrl, accept='application/json') => {
    let next = startUrl, all = { type:'FeatureCollection', features:[] }, guard=0;
    while (next && guard++ < 30) {
      const page = await fetchJSON(next, { 'Accept': accept });
      if (page?.features?.length) all.features.push(...page.features);
      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel||'').toLowerCase()==='next'); if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && typeof page?.next === 'string') next = page.next;
    }
    return all;
  };

  // 3) REST zonder filter (alle pagina's)
  try {
    const all = await restPaged(REST_START, 'application/geo+json');
    const n = all.features.length; diagInfo.rest_all.count = n;
    if (n && !best) best = { source:'rest', data: norm(all) };
  } catch (e) { diagInfo.rest_all.error = String(e); }

  // 4) REST met intersects(BBOX)
  try {
    const box = await restPaged(REST_INTERSECTS, 'application/geo+json');
    const n = box.features.length; diagInfo.rest_box.count = n;
    if (n && (!best || n < best.data.features.length)) best = { source:'rest', data: norm(box) };
  } catch (e) { diagInfo.rest_box.error = String(e); }

  // Antwoord kiezen
  if (!best) {
    const out = { source:'demo', bbox, count: demo.features.length, ...demo };
    if (diag) return res.status(200).json({ ...out, diag: diagInfo });
    return res.status(200).json(out);
  } else {
    const out = { source: best.source, bbox, count: best.data.features.length, ...best.data };
    if (diag) return res.status(200).json({ ...out, diag: diagInfo });
    return res.status(200).json(out);
  }
}
