// /api/terraces.js — Echte terrassen met BBOX-filter (WFS → REST → DEMO)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // BBOX lezen uit query (?bbox=lon1,lat1,lon2,lat2) of standaard "Centrum"
  const url = new URL(req.url, `http://${req.headers.host}`);
  const bboxParam = url.searchParams.get('bbox');
  // Centrum (ongeveer: Westerdok → Oosterpark | Marnixstraat → Weesperzijde)
  const DEFAULT_BBOX = '4.84,52.35,4.92,52.39';
  const bbox = (bboxParam && /^[0-9\.\-\,]+$/.test(bboxParam)) ? bboxParam : DEFAULT_BBOX;

  // Helpers
  const fetchJSON = async (u, accept = 'application/json') => {
    const r = await fetch(u, { headers: { 'Accept': accept } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  const slim = (fc, nameFields) => {
    const out = { type: 'FeatureCollection', features: [] };
    (fc.features || []).forEach((f, i) => {
      if (!f || !f.geometry) return;
      const props = f.properties || {};
      const name = nameFields.map(k => props[k]).find(Boolean) || `Terras #${i+1}`;
      const id = f.id || props.identificatie || props.uuid || props.id || i;
      out.features.push({
        type: 'Feature',
        id,
        properties: { name },
        geometry: f.geometry
      });
    });
    return out;
  };

  // 1) WFS met BBOX (EPSG:4326 lon,lat)
  const WFS =
    'https://api.data.amsterdam.nl/v1/wfs/horeca/?' +
    'SERVICE=WFS&REQUEST=GetFeature&version=2.0.0' +
    '&typenames=exploitatievergunning-terrasgeometrie' +
    `&BBOX=${bbox},urn:ogc:def:crs:EPSG::4326` +
    '&outputformat=geojson&srsName=urn:ogc:def:crs:EPSG::4326' +
    '&count=10000';

  // 2) REST fallback (paged). NB: REST heeft geen simpele BBOX; we filteren desnoods client-side
  const REST_START = 'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=json';

  // 3) Demo fallback (4 polygonen)
  const demo = { type: 'FeatureCollection', features: [
    { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
    { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } },
    { type:'Feature', id:'thijssen',  properties:{ name:'Café Thijssen (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] } },
    { type:'Feature', id:'brandstof', properties:{ name:'Brandstof (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] } }
  ]};

  // Probeer WFS
  try {
    let data = await fetchJSON(WFS, 'application/json');
    if (data?.features?.length) {
      const slimmed = slim(data, ['naam','bedrijfsnaam','zaak','naambedrijf','zaaknaam','adres']);
      return res.status(200).json({ source: 'wfs', bbox, count: slimmed.features.length, ...slimmed });
    }
  } catch { /* ga door naar REST */ }

  // Probeer REST (paging)
  try {
    let next = REST_START;
    const all = { type: 'FeatureCollection', features: [] };
    let guard = 0;
    while (next && guard++ < 20) {
      const page = await fetchJSON(next, 'application/geo+json'); // juiste Accept
      if (page?.features?.length) all.features.push(...page.features);

      next = null;
      if (page?.links) {
        const n = page.links.find(l => (l.rel || '').toLowerCase() === 'next');
        if (n?.href) next = n.href;
      }
      if (!next && page?._links?.next?.href) next = page._links.next.href;
      if (!next && page?.next) next = page.next;
    }
    if (all.features.length) {
      const slimmed = slim(all, ['zaaknaam','naam','bedrijfsnaam','naambedrijf','adres']);
      // Optioneel: grofweg filteren op BBOX server-side
      const [minx,miny,maxx,maxy] = bbox.split(',').map(parseFloat);
      const within = {
        type: 'FeatureCollection',
        features: slimmed.features.filter(f => {
          try {
            // quick bbox per feature
            let fminx=Infinity,fminy=Infinity,fmaxx=-Infinity,fmaxy=-Infinity;
            const polys = (f.geometry.type === 'Polygon') ? [f.geometry.coordinates] : f.geometry.coordinates;
            polys.forEach(poly => poly[0].forEach(([x,y]) => {
              if (x<fminx) fminx=x; if (y<fminy) fminy=y;
              if (x>fmaxx) fmaxx=x; if (y>fmaxy) fmaxy=y;
            }));
            return !(fmaxx<minx || fminx>maxx || fmaxy<miny || fminy>maxy);
          } catch { return true; }
        })
      };
      return res.status(200).json({ source: 'rest', bbox, count: within.features.length, ...within });
    }
  } catch { /* val terug op demo */ }

  // Demo fallback
  return res.status(200).json({ source: 'demo', bbox, count: demo.features.length, ...demo });
}