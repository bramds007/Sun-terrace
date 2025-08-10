// /api/terraces.js — WFS → REST → DEMO + debug errors
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const headers = { 'Accept': 'application/json' };
  const errors = {};

  const WFS =
    'https://api.data.amsterdam.nl/v1/wfs/horeca/?' +
    'SERVICE=WFS&REQUEST=GetFeature&version=2.0.0' +
    '&typenames=exploitatievergunning-terrasgeometrie' +
    '&BBOX=4.55,52.20,5.10,52.50,urn:ogc:def:crs:EPSG::4326' +
    '&outputformat=geojson&srsName=urn:ogc:def:crs:EPSG::4326' +
    '&count=10000';

  const REST_START =
    'https://api.data.amsterdam.nl/v1/horeca/exploitatievergunning?_format=geojson';

  const demo = { type: 'FeatureCollection', features: [
    { type:'Feature', id:'jaren',     properties:{ name:'Café de Jaren (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.89451,52.36620],[4.89475,52.36620],[4.89475,52.36608],[4.89451,52.36608],[4.89451,52.36620]]] } },
    { type:'Feature', id:'waterkant', properties:{ name:'Waterkant (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.88061,52.36759],[4.88084,52.36759],[4.88084,52.36748],[4.88061,52.36748],[4.88061,52.36759]]] } },
    { type:'Feature', id:'thijssen',  properties:{ name:'Café Thijssen (demo)' }, geometry:{ type:'Polygon', coordinates:[[[4.88662,52.37688],[4.88674,52.37688],[4.88674,52.37680],[4.88662,52.37680],[4.88662,52.37688]]] } },
    { type:'Feature', id:'brandstof', properties:{ name:'Brandstof (demo)'     }, geometry:{ type:'Polygon', coordinates:[[[4.89546,52.35636],[4.89564,52.35636],[4.89564,52.35625],[4.89546,52.35625],[4.89546,52.35636]]] } }
  ]};

  const norm = (fc, nameFields) => {
    fc.features.forEach((f, i) => {
      f.properties = f.properties || {};
      const name = nameFields.map(k => f.properties[k]).find(Boolean);
      f.properties.name = name || `Terras #${i+1}`;
      f.id = f.id || f.properties.identificatie || f.properties.uuid || f.properties.id || i;
    });
    return fc;
  };

  const fetchJSON = async url => {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json();
  };

  // 1) WFS
  try {
    let data = await fetchJSON(WFS);
    if (data?.features?.length) {
      data = norm(data, ['naam','bedrijfsnaam','zaak','naambedrijf','zaaknaam','adres']);
      return res.status(200).json({ source: 'wfs', count: data.features.length, ...data });
    } else {
      errors.error_wfs = 'WFS gaf 0 features terug';
    }
  } catch (e) {
    errors.error_wfs = String(e);
  }

  // 2) REST
  try {
    let url = REST_START;
    const all = { type: 'FeatureCollection', features: [] };
    let guard = 0;
    while (url && guard++ < 20) {
      const page = await fetchJSON(url);
      if (page?.features?.length) all.features.push(...page.features);

      url = null;
      if (page?.links) {
        const next = page.links.find(l => (l.rel || '').toLowerCase() === 'next');
        if (next?.href) url = next.href;
      }
      if (!url && page?._links?.next?.href) url = page._links.next.href;
      if (!url && page?.next) url = page.next;
    }

    if (all.features.length) {
      const data = norm(all, ['zaaknaam','naam','bedrijfsnaam','naambedrijf','adres']);
      return res.status(200).json({ source: 'rest', count: data.features.length, ...data });
    } else {
      errors.error_rest = 'REST gaf 0 features terug';
    }
  } catch (e) {
    errors.error_rest = String(e);
  }

  // 3) DEMO met foutinfo
  return res.status(200).json({ source: 'demo', ...errors, count: demo.features.length, ...demo });
}